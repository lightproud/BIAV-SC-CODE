/**
 * index-loader.ts — Load BPE SQLite indexes via sql.js (pure WASM).
 *
 * Why sql.js instead of better-sqlite3: better-sqlite3 requires native C++
 * compilation (Visual Studio Build Tools on Windows). sql.js is pure WASM,
 * zero native dependencies, works everywhere Electron runs.
 *
 * BPE indexes are read-only (built by scripts/bpe_indexer.py, distributed
 * via SVN). sql.js loads the entire file into memory which is fine for our
 * index sizes (~50MB combined).
 *
 * Expected files (distributed via SVN):
 *   chunks.db   — chunk text + metadata (file, lineStart, lineEnd, language)
 *   keywords.db — FTS5 full-text index over chunk text
 *   vectors.db  — sqlite-vss vector index (Phase 0.5, not loaded in Phase 0)
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../core/logger';

export interface BpeIndexes {
  chunks: SqlJsDatabase | null;
  keywords: SqlJsDatabase | null;
  vectors: SqlJsDatabase | null;
}

/**
 * Load BPE indexes from the given directory.
 * Returns null for any index file that doesn't exist yet.
 *
 * Must be awaited — sql.js requires async WASM initialization.
 */
export async function loadBpeIndexes(indexDir: string): Promise<BpeIndexes> {
  const result: BpeIndexes = { chunks: null, keywords: null, vectors: null };

  const SQL = await initSqlJs();

  const chunksPath = path.join(indexDir, 'chunks.db');
  const keywordsPath = path.join(indexDir, 'keywords.db');
  const vectorsPath = path.join(indexDir, 'vectors.db');

  if (fs.existsSync(chunksPath)) {
    try {
      const buf = fs.readFileSync(chunksPath);
      result.chunks = new SQL.Database(buf);
      logger.info('bpe-index', `Loaded chunks.db from ${chunksPath}`);
    } catch (err) {
      logger.error('bpe-index', 'Failed to load chunks.db', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn('bpe-index', `chunks.db not found at ${chunksPath}. BPE search unavailable.`);
  }

  if (fs.existsSync(keywordsPath)) {
    try {
      const buf = fs.readFileSync(keywordsPath);
      result.keywords = new SQL.Database(buf);
      logger.info('bpe-index', `Loaded keywords.db from ${keywordsPath}`);
    } catch (err) {
      logger.error('bpe-index', 'Failed to load keywords.db', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn('bpe-index', `keywords.db not found at ${keywordsPath}. FTS5 search unavailable.`);
  }

  // Phase 0.5: vectors.db (sqlite-vss)
  if (fs.existsSync(vectorsPath)) {
    try {
      const buf = fs.readFileSync(vectorsPath);
      result.vectors = new SQL.Database(buf);
      logger.info('bpe-index', `Loaded vectors.db from ${vectorsPath}`);
    } catch (err) {
      logger.warn('bpe-index', 'vectors.db exists but failed to load (expected in Phase 0)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Close all open database connections.
 */
export function closeBpeIndexes(indexes: BpeIndexes): void {
  indexes.chunks?.close();
  indexes.keywords?.close();
  indexes.vectors?.close();
}
