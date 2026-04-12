/**
 * bpe-ipc.ts — Register BPE IPC handlers for the renderer.
 *
 * Why separate from ipc-trunk: BPE handlers depend on loaded SQLite indexes.
 * They're registered synchronously (returning "not ready" if indexes aren't
 * loaded yet), and initBpe() loads them asynchronously.
 */

import { ipcMain } from 'electron';
import path from 'node:path';
import { loadBpeIndexes, closeBpeIndexes, type BpeIndexes } from './index-loader';
import { searchFts5, searchHybrid, lookupSymbol } from './search';
import { chunkToCiteBlock } from './cite';
import type { BPEChunk } from '../../src/types';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';

let indexes: BpeIndexes | null = null;

export function registerBpeIpc(): void {
  // Use hybrid search (vector + FTS5 + optional rerank). Falls back to
  // FTS5-only if vectors.db or bge-m3 model is unavailable.
  ipcMain.handle('bpe:search', async (_event, query: string, limit?: number) => {
    if (!indexes) return { results: [], error: 'BPE indexes not loaded' };
    const results = await searchHybrid(indexes, query, limit ?? 5);
    return { query, results };
  });

  ipcMain.handle('bpe:lookup', async (_event, symbol: string, limit?: number) => {
    if (!indexes) return { results: [], error: 'BPE indexes not loaded' };
    const results = lookupSymbol(indexes, symbol, limit ?? 3);
    return { symbol, results };
  });

  // @Cite: convert a BPE chunk into a CiteBlock for conversation injection.
  // The renderer calls this when the user clicks "Cite" on a search result.
  ipcMain.handle('cite:inject', (_event, chunk: BPEChunk) => {
    return chunkToCiteBlock(chunk);
  });

  ipcMain.handle('bpe:status', () => {
    return {
      loaded: indexes !== null,
      hasChunks: indexes?.chunks !== null,
      hasKeywords: indexes?.keywords !== null,
      hasVectors: indexes?.vectors !== null,
    };
  });
}

export async function initBpe(): Promise<void> {
  const repoRoot = (getConfig('repoRoot') as string) || findRepoRoot();
  const indexDir = path.join(repoRoot, 'projects', 'bpt', '.bpe-index');

  logger.info('bpe', 'Loading BPE indexes', { indexDir });

  indexes = loadBpeIndexes(indexDir);

  const status = {
    chunks: indexes.chunks !== null,
    keywords: indexes.keywords !== null,
    vectors: indexes.vectors !== null,
  };
  logger.info('bpe', 'BPE indexes loaded', status);
}

export function getBpeIndexes(): BpeIndexes | null {
  return indexes;
}

export function shutdownBpe(): void {
  if (indexes) {
    closeBpeIndexes(indexes);
    indexes = null;
  }
}

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir);
  }
  return dir;
}
