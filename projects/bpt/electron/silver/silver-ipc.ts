/**
 * silver-ipc.ts — Register knowledge engine IPC handlers for the renderer.
 *
 * Why "silver" name kept: The IPC channels (silver:search, silver:graphQuery, etc.)
 * are the same whether backed by Silver Core or BPT's own server. Renaming
 * channels would break renderer code for no benefit.
 *
 * Architecture change (2026-04-13): BPT Server replaces Silver Core.
 * All 11 tools now route through a single MCP client pointing to the local
 * server at projects/bpt/server/mcp_server.py. The separate direct-client
 * is no longer needed — BPT Server is local, so there's no security concern
 * about exposing management tools via MCP. The LLM's active tool set
 * (gear-based) still controls what the AI can actually call.
 */

import { ipcMain } from 'electron';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { McpClient } from './mcp-client';
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
    if (!silverApi) return { query, results: [], error: 'Knowledge engine not ready' };
    return silverApi.memorySearch(query, topK ?? 5);
  });

  ipcMain.handle('silver:graphQuery', async (_event, entity: string, depth?: number) => {
    if (!silverApi) return { error: 'Knowledge engine not ready' };
    return silverApi.graphQuery(entity, depth ?? 1);
  });

  ipcMain.handle('silver:graphFiles', async (_event, entity: string) => {
    if (!silverApi) return { error: 'Knowledge engine not ready' };
    return silverApi.graphRelatedFiles(entity);
  });

  ipcMain.handle('silver:recommend', async (_event, query: string) => {
    if (!silverApi) return { error: 'Knowledge engine not ready' };
    return silverApi.recommendContext(query);
  });

  ipcMain.handle('silver:status', () => {
    if (!silverApi) return { mcpConnected: false, mcpTools: [] };
    return silverApi.getStatus();
  });
}

/**
 * Initialize the knowledge engine. Called async from main.ts.
 *
 * Server resolution order:
 * 1. Config key "silverMcpPath" (user override)
 * 2. Local BPT server at <appRoot>/server/mcp_server.py
 * 3. Fallback: brain-in-a-vat scripts/mcp_server.py (dev only)
 */
export async function initSilverCore(): Promise<void> {
  const pythonPath = 'python';
  const serverScript = resolveServerScript();

  if (!serverScript) {
    logger.warn('silver', 'No MCP server found. Knowledge engine disabled.');
    return;
  }

  const serverDir = path.dirname(serverScript);
  logger.info('silver', 'Initializing knowledge engine', { serverScript });

  mcpClient = new McpClient(pythonPath, serverScript, serverDir);
  try {
    await mcpClient.start();
  } catch (err) {
    logger.error('silver', 'MCP client failed to start', {
      error: err instanceof Error ? err.message : String(err),
    });
    mcpClient = null;
  }

  // All tools route through MCP — no separate direct client needed
  silverApi = new SilverCoreApi(mcpClient);

  logger.info('silver', 'Knowledge engine initialized', silverApi.getStatus());
}

export function getSilverApi(): SilverCoreApi | null {
  return silverApi;
}

export function getMcpClient(): McpClient | null {
  return mcpClient;
}

/**
 * Find the MCP server script. Checks multiple locations.
 */
function resolveServerScript(): string | null {
  // 1. User-configured path
  const configPath = getConfig('silverMcpPath') as string;
  if (configPath && fs.existsSync(configPath)) {
    return configPath;
  }

  // 2. Local BPT server (primary — for independent deployment)
  const appRoot = findAppRoot();
  const localServer = path.join(appRoot, 'server', 'mcp_server.py');
  if (fs.existsSync(localServer)) {
    return localServer;
  }

  // 3. Dev fallback: brain-in-a-vat repo scripts/ (only during development)
  const repoRoot = getConfig('repoRoot') as string;
  if (repoRoot) {
    const repoServer = path.join(repoRoot, 'scripts', 'mcp_server.py');
    if (fs.existsSync(repoServer)) {
      logger.info('silver', 'Using dev fallback: brain-in-a-vat scripts/mcp_server.py');
      return repoServer;
    }
  }

  return null;
}

/**
 * Find the BPT app root directory.
 * In dev: projects/bpt/ (Vite serves from here)
 * In prod: the directory containing the packaged app resources
 */
function findAppRoot(): string {
  if (app.isPackaged) {
    return path.dirname(app.getAppPath());
  }
  // Dev mode: __dirname is projects/bpt/dist-electron/ or projects/bpt/electron/
  // Go up one level to projects/bpt/
  return path.dirname(__dirname);
}
