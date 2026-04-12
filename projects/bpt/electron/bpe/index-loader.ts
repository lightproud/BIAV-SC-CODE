/**
 * index-loader.ts — Load BPE SQLite indexes.
 *
 * Why SQLite: SVN-friendly (single files), cross-platform, no extra runtime.
 * Phase 0 uses FTS5 keyword index only. Vector search (sqlite-vss) is Phase 0.5.
 *
 * Expected files (distributed via SVN):
 *   chunks.db   — chunk text + metadata (file, lineStart, lineEnd, language)
 *   keywords.db — FTS5 full-text index over chunk text
 *   vectors.db  — sqlite-vss vector index (Phase 0.5, not loaded in Phase 0)
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../core/logger';

export interface BpeIndexes {
  chunks: Database.Database | null;
  keywords: Database.Database | null;
  vectors: Database.Database | null;
}

/**
 * Load BPE indexes from the given directory.
 * Returns null for any index file that doesn't exist yet.
 */
export function loadBpeIndexes(indexDir: string): BpeIndexes {
  const result: BpeIndexes = { chunks: null, keywords: null, vectors: null };

  const chunksPath = path.join(indexDir, 'chunks.db');
  const keywordsPath = path.join(indexDir, 'keywords.db');
  const vectorsPath = path.join(indexDir, 'vectors.db');

  if (fs.existsSync(chunksPath)) {
    try {
      result.chunks = new Database(chunksPath, { readonly: true });
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
      result.keywords = new Database(keywordsPath, { readonly: true });
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
      result.vectors = new Database(vectorsPath, { readonly: true });
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
