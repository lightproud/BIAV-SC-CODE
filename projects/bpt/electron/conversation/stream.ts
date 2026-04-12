/**
 * stream.ts — Chat streaming IPC handler.
 *
 * Why here and not in ipc-trunk: This handler depends on LlmProvider,
 * tool-registry, and token-accounting — all runtime state. It's the
 * "orchestrator" that ties L3 together.
 *
 * Flow:
 * 1. Renderer calls chat:send(conversationId, userMessage, gear)
 * 2. We build the request (system prompt + history + tools for current gear)
 * 3. We estimate pre-send token breakdown
 * 4. We call provider.stream() and forward events to renderer via chat:stream
 * 5. If the response contains tool_use, we enter the tool loop
 * 6. On message_end, we merge usage and log to SQLite
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ClaudeProvider } from '../llm/claude';
import { getActiveTools } from '../llm/tool-registry';
import { estimateRequestTokens, mergeUsage } from '../llm/token-accounting';
import { logTokenUsage } from '../core/logger';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import type { LlmProvider, LlmStreamEvent, LlmMessage } from '../llm/provider';
import type { Gear, TokenUsage } from '../../src/types';

let provider: LlmProvider | null = null;

/**
 * Get or create the LLM provider based on current config.
 */
function getProvider(): LlmProvider {
  const endpoint = getConfig('endpoint') as {
    baseUrl: string;
    apiKey: string;
    model: string;
  };

  if (!endpoint?.apiKey) {
    throw new Error('API Key not configured. Please set it in Settings.');
  }

  // Recreate provider if config changed (simple approach for Phase 0)
  provider = new ClaudeProvider(endpoint.baseUrl, endpoint.apiKey);
  return provider;
}

const SYSTEM_PROMPT = `You are BPT (Black Pool Terminal), an AI assistant deeply integrated with the 忘却前夜 (Morimens) project.
You have access to Silver Core memory tools and Black Pool Explorer for searching the project's codebase and configurations.
Always respond in Chinese unless the user explicitly asks for another language.
Be concise and precise. When using tools, explain what you're doing and why.`;

export function registerChatIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('chat:send', async (_event, conversationId: string, userMessage: string, gear: string) => {
    const win = getWindow();
    if (!win) return { error: 'No window' };

    try {
      const currentProvider = getProvider();
      const currentGear = (gear || 'chat') as Gear;
      const tools = getActiveTools(currentGear);
      const endpoint = getConfig('endpoint') as { model: string };

      // Build messages (Phase 0: simple — just the current user message)
      // TODO Phase 1: Full conversation history from SQLite
      const messages: LlmMessage[] = [
        { role: 'user', content: userMessage },
      ];

      // Pre-estimate token breakdown
      const preEstimate = estimateRequestTokens(
        SYSTEM_PROMPT,
        tools,
        JSON.stringify(messages),
      );

      // Stream to renderer
      await currentProvider.stream(
        {
          model: endpoint.model,
          systemPrompt: SYSTEM_PROMPT,
          messages,
          tools,
          maxTokens: 4096,
          cacheControl: true,
        },
        (event: LlmStreamEvent) => {
          // Forward every event to the renderer
          if (!win.isDestroyed()) {
            win.webContents.send('chat:stream', event);
          }

          // On message_end, log token usage
          if (event.type === 'message_end') {
            const merged = mergeUsage(preEstimate, event.usage);
            logTokenUsage({
              conversationId,
              ...merged,
              toolsUsed: tools.map((t) => t.name),
              gear: currentGear,
            });
          }
        },
      );

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('chat', 'Chat send failed', { error: message });
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream', { type: 'error', error: message });
      }
      return { error: message };
    }
  });

  ipcMain.handle('chat:abort', () => {
    provider?.abort();
    return { success: true };
  });
}
