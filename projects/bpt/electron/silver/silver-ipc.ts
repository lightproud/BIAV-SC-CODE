/**
 * silver-ipc.ts — Register Silver Core IPC handlers for the renderer.
 *
 * Why separate from ipc-trunk.ts: Silver Core handlers depend on runtime
 * state (McpClient instance, SilverDirectClient instance). They must be
 * registered after those objects exist, but the channel names are available
 * immediately so the renderer can call them and get "not ready" responses
 * while initialization is in progress.
 */

import { ipcMain } from 'electron';
import path from 'node:path';
import { McpClient } from './mcp-client';
import { SilverDirectClient } from './direct-client';
import { SilverCoreApi } from './memory-api';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';

let silverApi: SilverCoreApi | null = null;
let mcpClient: McpClient | null = null;

/**
 * Register IPC handlers. Called synchronously from main.ts.
 * Handlers return graceful "not ready" responses until initSilverCore() completes.
 */
export function registerSilverIpc(): void {
  ipcMain.handle('silver:search', async (_event, query: string, topK?: number) => {
    if (!silverApi) return { query, results: [], error: 'Silver Core not ready' };
    return silverApi.memorySearch(query, topK ?? 5);
  });

  ipcMain.handle('silver:graphQuery', async (_event, entity: string, depth?: number) => {
    if (!silverApi) return { error: 'Silver Core not ready' };
    return silverApi.graphQuery(entity, depth ?? 1);
  });

  ipcMain.handle('silver:graphFiles', async (_event, entity: string) => {
    if (!silverApi) return { error: 'Silver Core not ready' };
    return silverApi.graphRelatedFiles(entity);
  });

  ipcMain.handle('silver:recommend', async (_event, query: string) => {
    if (!silverApi) return { error: 'Silver Core not ready' };
    return silverApi.recommendContext(query);
  });

  ipcMain.handle('silver:status', () => {
    if (!silverApi) return { mcpConnected: false, mcpTools: [], directAvailable: false };
    return silverApi.getStatus();
  });
}

/**
 * Initialize Silver Core subsystem. Called async from main.ts.
 */
export async function initSilverCore(): Promise<void> {
  const repoRoot = (getConfig('repoRoot') as string) || findRepoRoot();
  const pythonPath = 'python';
  const serverScript = path.join(repoRoot, 'scripts', 'mcp_server.py');

  logger.info('silver', 'Initializing Silver Core', { repoRoot, serverScript });

  // Start MCP client
  mcpClient = new McpClient(pythonPath, serverScript, repoRoot);
  try {
    await mcpClient.start();
  } catch (err) {
    logger.error('silver', 'MCP client failed to start', {
      error: err instanceof Error ? err.message : String(err),
    });
    mcpClient = null;
  }

  // Create direct client
  const directClient = new SilverDirectClient(pythonPath, repoRoot);

  // Create unified API
  silverApi = new SilverCoreApi(mcpClient, directClient);

  logger.info('silver', 'Silver Core initialized', silverApi.getStatus());
}

export function getSilverApi(): SilverCoreApi | null {
  return silverApi;
}

export function getMcpClient(): McpClient | null {
  return mcpClient;
}

/**
 * Auto-detect repo root by walking up from this file's location.
 * BPT lives at <repo>/projects/bpt/, so we go up 3 levels from dist-electron/.
 */
function findRepoRoot(): string {
  // In dev: electron/ is at projects/bpt/electron/
  // In prod: dist-electron/ is at projects/bpt/dist-electron/
  // Either way, go up to projects/bpt/, then up twice more to repo root.
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir);
  }
  return dir;
}
