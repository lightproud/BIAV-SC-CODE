/**
 * embed.ts -- Query embedding via Python subprocess.
 *
 * Why Python subprocess: bge-m3 runs via sentence-transformers (Python).
 * Electron spawns scripts/embed_query.py, reads the JSON result from stdout.
 * If the model is not available, returns null and the caller falls back to FTS5.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { getConfig, findAppRoot } from '../core/config';
import { logger } from '../core/logger';

interface EmbedResult {
  embedding: number[];
  dimension: number;
}

/**
 * Embed a query string using bge-m3 via Python subprocess.
 * Returns null if the model is unavailable or any error occurs.
 */
export async function embedQuery(query: string): Promise<Float32Array | null> {
  const appRoot = findAppRoot();
  const modelPath = path.join(appRoot, 'models', 'bge-m3');
  const scriptPath = path.join(appRoot, 'server', 'embed_query.py');

  return new Promise((resolve) => {
    const proc = spawn('python3', [
      scriptPath,
      '--model-path', modelPath,
      '--query', query,
    ], {
      timeout: 30000, // 30s timeout for model loading + embedding
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn('bpe-embed', 'Query embedding failed', {
          code,
          stderr: stderr.slice(0, 200),
        });
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as EmbedResult;
        if (result.embedding) {
          resolve(new Float32Array(result.embedding));
        } else {
          logger.warn('bpe-embed', 'No embedding in result', { stdout: stdout.slice(0, 200) });
          resolve(null);
        }
      } catch (err) {
        logger.warn('bpe-embed', 'Failed to parse embedding result', {
          error: err instanceof Error ? err.message : String(err),
        });
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      logger.warn('bpe-embed', 'Failed to spawn embedding process', {
        error: err.message,
      });
      resolve(null);
    });
  });
}
