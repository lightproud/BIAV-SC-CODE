/**
 * search.ts — BPE search engine (FTS5 keyword + future vector).
 *
 * Why FTS5 first: Zero extra dependencies, works out of the box with
 * better-sqlite3. Phase 0 proves the BPE panel works end-to-end.
 * Vector search (bge-m3 + sqlite-vss) comes in Phase 0.5.
 *
 * Why Haiku reranker is optional: If the gateway is unreachable or
 * budget is tight, users can disable reranking and get raw FTS5/vector
 * scores. Reranking is a quality layer, not a correctness requirement.
 */

import type { BpeIndexes } from './index-loader';
import type { BPEChunk } from '../../src/types';
import { logger } from '../core/logger';

/**
 * Search BPE indexes using FTS5 keyword matching (Phase 0).
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
    // FTS5 match query. We use the simple tokenizer which handles CJK reasonably.
    const ftsResults = indexes.keywords.prepare(`
      SELECT rowid, rank
      FROM keywords_fts
      WHERE keywords_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(escapeQuery(query), limit) as Array<{ rowid: number; rank: number }>;

    if (ftsResults.length === 0) return [];

    // Fetch full chunk data from chunks.db
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
  } catch (err) {
    logger.error('bpe-search', 'FTS5 search failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Lookup a symbol by exact name (or prefix).
 * Uses the chunks table directly, not FTS5.
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
      text: c.text.slice(0, 600), // Hard cap: 600 chars per symbol result
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

/**
 * Escape special FTS5 query characters.
 * FTS5 treats double-quotes as phrase delimiters and other chars as operators.
 */
function escapeQuery(query: string): string {
  // Wrap in double quotes to treat as a phrase search,
  // escaping any internal double quotes.
  const escaped = query.replace(/"/g, '""');
  return `"${escaped}"`;
}
