/**
 * stream.ts — Chat streaming orchestrator with tool-use loop.
 *
 * Why here and not in ipc-trunk: This handler depends on LlmProvider,
 * tool-registry, token-accounting, compressor, and tool-loop — all runtime
 * state. It's the "orchestrator" that ties L3 together.
 *
 * Flow:
 * 1. Renderer calls chat:send(conversationId, userMessage, gear)
 * 2. Main process appends user message to conversation history
 * 3. Apply compression if history exceeds thresholds
 * 4. Call provider.stream() with full history + tools for current gear
 * 5. Collect content blocks; if tool_use blocks present, execute tools
 * 6. Send tool_result to renderer, append to history, loop back to step 3
 * 7. On final message_end (no more tool_use), merge usage and log to SQLite
 *
 * The main process owns conversation history (in-memory Map). This is
 * essential for the tool loop — we need to append assistant + tool_result
 * messages between LLM calls without renderer involvement.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ClaudeProvider } from '../llm/claude';
import { OpenAiProvider } from '../llm/openai';
import { getActiveTools } from '../llm/tool-registry';
import { estimateRequestTokens, mergeUsage, accumulateUsage, emptyUsage } from '../llm/token-accounting';
import { logTokenUsage } from '../core/logger';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import { executeTool } from './tool-loop';
import { compressHistory } from './compressor';
import type { LlmProvider, LlmStreamEvent, LlmMessage, LlmContentBlock } from '../llm/provider';
import type { Gear } from '../../src/types';

// ── Conversation history store (in-memory) ──────────────────────
// Key: conversationId, Value: LlmMessage[] (full history)
const histories = new Map<string, LlmMessage[]>();

let provider: LlmProvider | null = null;
let lastProviderKey = '';

const MAX_TOOL_LOOPS = 10;

const SYSTEM_PROMPT = `You are BPT (Black Pool Terminal), an AI assistant deeply integrated with the 忘却前夜 (Morimens) project.
You have access to Silver Core memory tools and Black Pool Explorer for searching the project's codebase and configurations.
Always respond in Chinese unless the user explicitly asks for another language.
Be concise and precise. When using tools, explain what you're doing and why.`;

/**
 * Get or create the LLM provider based on current config.
 * Only recreates if config has changed.
 */
function getProvider(): LlmProvider {
  const endpoint = getConfig('endpoint') as {
    baseUrl: string;
    apiKey: string;
    model: string;
    provider?: string;
  };

  if (!endpoint?.apiKey) {
    throw new Error('API Key not configured. Please set it in Settings.');
  }

  // Cache provider — only recreate if endpoint changed
  const key = `${endpoint.baseUrl}:${endpoint.apiKey}:${endpoint.provider ?? ''}`;
  if (provider && key === lastProviderKey) {
    return provider;
  }

  if (endpoint.provider === 'openai') {
    provider = new OpenAiProvider(endpoint.baseUrl, endpoint.apiKey);
  } else {
    provider = new ClaudeProvider(endpoint.baseUrl, endpoint.apiKey);
  }
  lastProviderKey = key;
  return provider;
}

/**
 * Get conversation history, creating empty array if needed.
 */
function getHistory(conversationId: string): LlmMessage[] {
  if (!histories.has(conversationId)) {
    histories.set(conversationId, []);
  }
  return histories.get(conversationId) as LlmMessage[];
}

/**
 * Send an event to the renderer window (safely handles destroyed windows).
 */
function sendToRenderer(win: BrowserWindow, event: Record<string, unknown>): void {
  if (!win.isDestroyed()) {
    win.webContents.send('chat:stream', event);
  }
}

export function registerChatIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('chat:send', async (_event, conversationId: string, userMessage: string, gear: string) => {
    const win = getWindow();
    if (!win) return { error: 'No window' };

    try {
      const currentProvider = getProvider();
      const currentGear = (gear || 'chat') as Gear;
      const tools = getActiveTools(currentGear);
      const endpoint = getConfig('endpoint') as { model: string };

      // Append user message to history
      const history = getHistory(conversationId);
      history.push({ role: 'user', content: userMessage });

      // Tool loop: stream → collect tool_use → execute → re-stream
      let totalUsage = emptyUsage();
      let loopCount = 0;

      while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++;

        // Apply compression before sending
        const { messages: messagesToSend, wasCompressed, droppedTurns } = compressHistory(history);

        if (wasCompressed) {
          logger.info('stream', `Compressed history: dropped ${droppedTurns} turns`);
        }

        // Pre-estimate token breakdown
        const preEstimate = estimateRequestTokens(
          SYSTEM_PROMPT,
          tools,
          JSON.stringify(messagesToSend),
        );

        // Collect content blocks from this LLM call
        const contentBlocks: LlmContentBlock[] = [];
        let currentText = '';
        let currentToolId = '';
        let currentToolName = '';
        let toolInputJson = '';

        // Stream the LLM response
        await currentProvider.stream(
          {
            model: endpoint.model,
            systemPrompt: SYSTEM_PROMPT,
            messages: messagesToSend,
            tools,
            maxTokens: 4096,
            cacheControl: true,
          },
          (streamEvent: LlmStreamEvent) => {
            // Forward events to renderer (except message_end — we send our own at the end)
            if (streamEvent.type !== 'message_end') {
              sendToRenderer(win, streamEvent as unknown as Record<string, unknown>);
            }

            // Collect content blocks for tool loop decision
            switch (streamEvent.type) {
              case 'text_delta':
                currentText += streamEvent.text;
                break;

              case 'tool_use_start':
                // Flush accumulated text as a block
                if (currentText) {
                  contentBlocks.push({ type: 'text', text: currentText });
                  currentText = '';
                }
                currentToolId = streamEvent.id;
                currentToolName = streamEvent.name;
                toolInputJson = '';
                break;

              case 'tool_use_delta':
                toolInputJson += streamEvent.text;
                break;

              case 'tool_use_end':
                contentBlocks.push({
                  type: 'tool_use',
                  id: currentToolId,
                  name: currentToolName,
                  input: safeParse(toolInputJson),
                });
                currentToolId = '';
                currentToolName = '';
                toolInputJson = '';
                break;

              case 'message_end': {
                // Flush remaining text
                if (currentText) {
                  contentBlocks.push({ type: 'text', text: currentText });
                  currentText = '';
                }
                // Accumulate usage across loop iterations
                const turnUsage = mergeUsage(preEstimate, streamEvent.usage);
                totalUsage = accumulateUsage(totalUsage, turnUsage);
                break;
              }

              case 'error':
                // Errors are already forwarded to renderer above
                break;
            }
          },
        );

        // Append assistant message to history
        const assistantContent = contentBlocks.length > 0
          ? contentBlocks
          : [{ type: 'text' as const, text: currentText }];
        history.push({ role: 'assistant', content: assistantContent });

        // Check for tool_use blocks
        const toolUseBlocks = contentBlocks.filter(
          (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0) {
          // No tool calls — we're done
          break;
        }

        // Execute each tool and collect results
        const toolResults: LlmContentBlock[] = [];
        for (const toolBlock of toolUseBlocks) {
          const result = await executeTool(toolBlock.name, toolBlock.input);

          // Send tool_result event to renderer for display
          sendToRenderer(win, {
            type: 'tool_result',
            toolUseId: toolBlock.id,
            name: toolBlock.name,
            content: result.content,
            isError: result.isError,
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result.content,
            is_error: result.isError,
          });
        }

        // Append tool results as a user message (Anthropic API format)
        history.push({ role: 'user', content: toolResults });

        // Signal renderer that LLM will continue after tool results
        sendToRenderer(win, { type: 'assistant_continue' });
      }

      // Send final message_end with accumulated usage
      sendToRenderer(win, { type: 'message_end', usage: totalUsage });

      // Log token usage
      logTokenUsage({
        conversationId,
        ...totalUsage,
        toolsUsed: tools.map((t) => t.name),
        gear: currentGear,
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('chat', 'Chat send failed', { error: message });
      sendToRenderer(win, { type: 'error', error: message });
      return { error: message };
    }
  });

  ipcMain.handle('chat:abort', () => {
    provider?.abort();
    return { success: true };
  });

  // Clear conversation history (called when user deletes a conversation)
  ipcMain.handle('conv:clearHistory', (_event, conversationId: string) => {
    histories.delete(conversationId);
    return { success: true };
  });
}

/**
 * Safely parse JSON, returning empty object on failure.
 */
function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
