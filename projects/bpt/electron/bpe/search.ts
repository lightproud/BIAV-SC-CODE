/**
 * search.ts -- BPE search engine (FTS5 keyword + vector + hybrid).
 *
 * Why FTS5 first: Zero extra dependencies, works out of the box with
 * better-sqlite3. Phase 0 proved the BPE panel end-to-end.
 *
 * Why brute-force cosine: sqlite-vss has cross-platform compilation risks.
 * For ~100k vectors at 1024 dims, brute-force scan takes <500ms on modern
 * hardware. Good enough for Phase 1. Can swap to HNSW if scale demands.
 *
 * Degradation chain: hybrid(vector+FTS5+rerank) > vector > FTS5 > empty.
 */

import type { BpeIndexes } from './index-loader';
import type { BPEChunk } from '../../src/types';
import { embedQuery } from './embed';
import { rerankWithHaiku } from './reranker';
import { logger } from '../core/logger';

// ── FTS5 Keyword Search ────────────────────────────────────────

/**
 * Search BPE indexes using FTS5 keyword matching.
 * Returns chunks sorted by relevance score.
 */
export function searchFts5(
  indexes: BpeIndexes,
  query: string,
  limit: number = 10,
): BPEChunk[] {
  if (!indexes.keywords || !indexes.chunks) {
    logger.warn('bpe-search', 'FTS5 search unavailable: indexes not loaded');
    return [];
  }

  try {
    const ftsResults = indexes.keywords.prepare(`
      SELECT rowid, rank
      FROM keywords_fts
      WHERE keywords_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(escapeQuery(query), limit) as Array<{ rowid: number; rank: number }>;

    if (ftsResults.length === 0) return [];

    return fetchChunks(indexes, ftsResults);
  } catch (err) {
    logger.error('bpe-search', 'FTS5 search failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Vector Search ──────────────────────────────────────────────

/**
 * Search BPE indexes using vector cosine similarity.
 * Loads all embeddings from vectors.db, computes similarity against the
 * query embedding, returns top-N results.
 *
 * Returns empty array if vectors.db is not loaded or query embedding fails.
 */
export async function searchVector(
  indexes: BpeIndexes,
  query: string,
  limit: number = 20,
): Promise<BPEChunk[]> {
  if (!indexes.vectors || !indexes.chunks) {
    return [];
  }

  // Get query embedding from bge-m3 via Python
  const queryVec = await embedQuery(query);
  if (!queryVec) {
    logger.info('bpe-search', 'Query embedding unavailable, skipping vector search');
    return [];
  }

  try {
    // Read all stored embeddings
    const rows = indexes.vectors.prepare(
      'SELECT chunk_id, embedding FROM vectors',
    ).all() as Array<{ chunk_id: number; embedding: Buffer }>;

    if (rows.length === 0) return [];

    // Compute cosine similarity for each stored embedding
    const dimension = queryVec.length;
    const scored: Array<{ chunkId: number; score: number }> = [];

    for (const row of rows) {
      const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, dimension);
      const sim = cosineSimilarity(queryVec, stored);
      scored.push({ chunkId: row.chunk_id, score: sim });
    }

    // Sort by similarity (highest first) and take top-N
    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit);

    // Fetch full chunk data
    const placeholders = topIds.map(() => '?').join(',');
    const chunks = indexes.chunks.prepare(`
      SELECT id, file, line_start, line_end, text, language
      FROM chunks
      WHERE id IN (${placeholders})
    `).all(...topIds.map((r) => r.chunkId)) as Array<{
      id: number;
      file: string;
      line_start: number;
      line_end: number;
      text: string;
      language: string;
    }>;

    const scoreMap = new Map(topIds.map((r) => [r.chunkId, r.score]));

    return chunks.map((c) => ({
      id: c.id,
      file: c.file,
      lineStart: c.line_start,
      lineEnd: c.line_end,
      text: c.text,
      language: c.language,
      score: scoreMap.get(c.id) ?? 0,
    }));
  } catch (err) {
    logger.error('bpe-search', 'Vector search failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Hybrid Search ──────────────────────────────────────────────

/**
 * Hybrid search: combine vector + FTS5 results, deduplicate, optionally rerank.
 *
 * Strategy:
 * 1. Run vector search (top-20) and FTS5 (top-20) in parallel
 * 2. Merge and deduplicate by chunk ID
 * 3. Score = RRF (Reciprocal Rank Fusion) of both rankings
 * 4. Optionally rerank top candidates with Haiku
 * 5. Return top `limit` results
 *
 * Falls back gracefully:
 * - No vectors.db or model → FTS5 only
 * - No keywords.db → vector only
 * - Both unavailable → empty
 */
export async function searchHybrid(
  indexes: BpeIndexes,
  query: string,
  limit: number = 5,
  rerank: boolean = true,
): Promise<BPEChunk[]> {
  // Run both searches (vector is async, FTS5 is sync)
  const [vectorResults, ftsResults] = await Promise.all([
    searchVector(indexes, query, 20),
    Promise.resolve(searchFts5(indexes, query, 20)),
  ]);

  // If only one source has results, use it directly
  if (vectorResults.length === 0 && ftsResults.length === 0) return [];
  if (vectorResults.length === 0) {
    return rerank
      ? await rerankWithHaiku(query, ftsResults, limit)
      : ftsResults.slice(0, limit);
  }
  if (ftsResults.length === 0) {
    return rerank
      ? await rerankWithHaiku(query, vectorResults, limit)
      : vectorResults.slice(0, limit);
  }

  // Reciprocal Rank Fusion (k=60 is standard)
  const k = 60;
  const fusedScores = new Map<number, { chunk: BPEChunk; score: number }>();

  vectorResults.forEach((chunk, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    fusedScores.set(chunk.id, { chunk, score: rrfScore });
  });

  ftsResults.forEach((chunk, rank) => {
    const rrfScore = 1 / (k + rank + 1);
    const existing = fusedScores.get(chunk.id);
    if (existing) {
      existing.score += rrfScore; // Boost chunks found by both
    } else {
      fusedScores.set(chunk.id, { chunk, score: rrfScore });
    }
  });

  // Sort by fused score
  const merged = [...fusedScores.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.chunk, score: entry.score }));

  // Optional Haiku rerank on top candidates
  const candidatesForRerank = merged.slice(0, Math.min(20, merged.length));
  if (rerank) {
    return await rerankWithHaiku(query, candidatesForRerank, limit);
  }
  return candidatesForRerank.slice(0, limit);
}

// ── Symbol Lookup ──────────────────────────────────────────────

/**
 * Lookup a symbol by exact name (or prefix).
 * Uses the chunks table directly, not FTS5 or vectors.
 */
export function lookupSymbol(
  indexes: BpeIndexes,
  name: string,
  limit: number = 3,
): BPEChunk[] {
  if (!indexes.chunks) return [];

  try {
    const results = indexes.chunks.prepare(`
      SELECT id, file, line_start, line_end, text, language
      FROM chunks
      WHERE text LIKE ? COLLATE NOCASE
      LIMIT ?
    `).all(`%${name}%`, limit) as Array<{
      id: number;
      file: string;
      line_start: number;
      line_end: number;
      text: string;
      language: string;
    }>;

    return results.map((c) => ({
      id: c.id,
      file: c.file,
      lineStart: c.line_start,
      lineEnd: c.line_end,
      text: c.text.slice(0, 1500),
      language: c.language,
      score: 1,
    }));
  } catch (err) {
    logger.error('bpe-search', 'Symbol lookup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Utilities ──────────────────────────────────────────────────

function fetchChunks(
  indexes: BpeIndexes,
  ftsResults: Array<{ rowid: number; rank: number }>,
): BPEChunk[] {
  if (!indexes.chunks) return [];

  const rowIds = ftsResults.map((r) => r.rowid);
  const rankMap = new Map(ftsResults.map((r) => [r.rowid, r.rank]));

  const placeholders = rowIds.map(() => '?').join(',');
  const chunks = indexes.chunks.prepare(`
    SELECT id, file, line_start, line_end, text, language
    FROM chunks
    WHERE id IN (${placeholders})
  `).all(...rowIds) as Array<{
    id: number;
    file: string;
    line_start: number;
    line_end: number;
    text: string;
    language: string;
  }>;

  return chunks.map((c) => ({
    id: c.id,
    file: c.file,
    lineStart: c.line_start,
    lineEnd: c.line_end,
    text: c.text,
    language: c.language,
    score: Math.abs(rankMap.get(c.id) ?? 0),
  }));
}

/**
 * Cosine similarity between two Float32Arrays.
 * Assumes both are already L2-normalized (bge-m3 with normalize_embeddings=True).
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Escape special FTS5 query characters.
 */
function escapeQuery(query: string): string {
  const escaped = query.replace(/"/g, '""');
  return `"${escaped}"`;
}
