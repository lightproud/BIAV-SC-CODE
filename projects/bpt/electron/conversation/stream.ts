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
import { addMessage, getMessages, deleteMessages } from './store';
import { getSilverApi } from '../silver/silver-ipc';
import type { LlmProvider, LlmStreamEvent, LlmMessage, LlmContentBlock } from '../llm/provider';
import type { Gear } from '../../src/types';

// ── Conversation history store (in-memory, backed by SQLite) ────
// Key: conversationId, Value: LlmMessage[] (full history)
const histories = new Map<string, LlmMessage[]>();

let provider: LlmProvider | null = null;
let lastProviderKey = '';

const MAX_TOOL_LOOPS = 10;
const MAX_TOKENS_BY_GEAR: Record<Gear, number> = {
  chat: 4096,
  work: 8192,
};

const BASE_SYSTEM_PROMPT = `You are BPT (Black Pool Terminal), an AI assistant deeply integrated with the 忘却前夜 (Morimens) project.
You have access to Silver Core memory tools and Black Pool Explorer for searching the project's codebase and configurations.
Always respond in Chinese unless the user explicitly asks for another language.
Be concise and precise. When using tools, explain what you're doing and why.`;

/**
 * Build the full system prompt by injecting relevant Silver Core context.
 *
 * Why: Plan §6 Tier 1 requires "auto-inject top-3 memories per turn".
 * recommend_context runs as a direct Python call (zero LLM cost), and its
 * results are appended to the system prompt so the LLM starts each turn
 * with awareness of the most relevant project knowledge.
 */
async function buildSystemPrompt(userMessage: string): Promise<string> {
  const silverApi = getSilverApi();
  if (!silverApi) return BASE_SYSTEM_PROMPT;

  try {
    const recommended = await silverApi.recommendContext(userMessage) as {
      recommended_files?: Array<{ file: string; reason: string; preview?: string }>;
    };

    const files = recommended?.recommended_files;
    if (!files || files.length === 0) return BASE_SYSTEM_PROMPT;

    // Take top 3 recommendations, format as concise context block
    const contextLines = files.slice(0, 3).map((f) => {
      const preview = f.preview ? `\n  ${f.preview.slice(0, 200)}` : '';
      return `- ${f.file}: ${f.reason}${preview}`;
    });

    return `${BASE_SYSTEM_PROMPT}

## Relevant project context (auto-injected from Silver Core)
${contextLines.join('\n')}`;
  } catch (err) {
    // recommend_context failure must never block the LLM call
    logger.warn('stream', 'recommend_context failed, using base prompt', {
      error: err instanceof Error ? err.message : String(err),
    });
    return BASE_SYSTEM_PROMPT;
  }
}

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
 * Get conversation history, loading from SQLite if not in memory.
 */
function getHistory(conversationId: string): LlmMessage[] {
  if (!histories.has(conversationId)) {
    // Try to load from SQLite
    const rows = getMessages(conversationId);
    const messages: LlmMessage[] = rows.map((row) => ({
      role: row.role as 'user' | 'assistant' | 'system',
      content: safeParseContentJson(row.content_json),
    }));
    histories.set(conversationId, messages);
  }
  return histories.get(conversationId) as LlmMessage[];
}

/**
 * Parse content_json from SQLite. Returns string or LlmContentBlock[].
 */
function safeParseContentJson(json: string): string | LlmContentBlock[] {
  try {
    const parsed = JSON.parse(json);
    // If it's an array of content blocks, return as-is
    if (Array.isArray(parsed)) return parsed as LlmContentBlock[];
    // If it's a string, return as string
    if (typeof parsed === 'string') return parsed;
    return json;
  } catch {
    return json;
  }
}

/**
 * Persist a message to SQLite.
 */
function persistMessage(conversationId: string, role: string, content: string | LlmContentBlock[]): void {
  const contentJson = typeof content === 'string'
    ? JSON.stringify(content)
    : JSON.stringify(content);
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    addMessage(msgId, conversationId, role, contentJson, Date.now());
  } catch (err) {
    logger.error('stream', 'Failed to persist message', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send an event to the renderer window (safely handles destroyed windows).
 */
function sendToRenderer(win: BrowserWindow, event: Record<string, unknown>): void {
  try {
    if (!win.isDestroyed()) {
      win.webContents.send('chat:stream', event);
    }
  } catch (err) {
    // Window was destroyed between check and send
    logger.warn('stream', 'Failed to send to renderer', {
      error: err instanceof Error ? err.message : String(err),
    });
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
      const endpoint = getConfig('endpoint') as { model: string; provider?: string };

      // Only enable cache_control for Claude provider
      const useCacheControl = (endpoint.provider ?? 'claude') !== 'openai';

      // Get or load conversation history
      const history = getHistory(conversationId);

      // Append user message to history + persist
      history.push({ role: 'user', content: userMessage });
      persistMessage(conversationId, 'user', userMessage);

      // Build system prompt once per user turn (auto-inject Silver Core context)
      const systemPrompt = await buildSystemPrompt(userMessage);

      // Tool loop: stream -> collect tool_use -> execute -> re-stream
      let totalUsage = emptyUsage();
      let loopCount = 0;

      while (loopCount < MAX_TOOL_LOOPS) {
        loopCount++;

        // Apply compression before sending (operates on a copy)
        const { messages: messagesToSend, wasCompressed, droppedTurns } = await compressHistory([...history], endpoint.model);

        if (wasCompressed) {
          logger.info('stream', `Compressed history: dropped ${droppedTurns} turns`);
        }

        // Pre-estimate token breakdown
        const preEstimate = estimateRequestTokens(
          systemPrompt,
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
            systemPrompt: systemPrompt,
            messages: messagesToSend,
            tools,
            maxTokens: MAX_TOKENS_BY_GEAR[currentGear],
            cacheControl: useCacheControl,
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
                  input: safeParseToolInput(toolInputJson),
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

        // Append assistant message to history + persist
        const assistantContent = contentBlocks.length > 0
          ? contentBlocks
          : [{ type: 'text' as const, text: currentText }];
        history.push({ role: 'assistant', content: assistantContent });
        persistMessage(conversationId, 'assistant', assistantContent);

        // Check for tool_use blocks
        const toolUseBlocks = contentBlocks.filter(
          (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0) {
          // No tool calls — we're done
          break;
        }

        // Check if we're about to exceed the loop limit
        if (loopCount >= MAX_TOOL_LOOPS) {
          logger.warn('stream', 'Max tool loop iterations reached', {
            conversationId,
            loopCount,
            lastToolNames: toolUseBlocks.map((b) => b.name),
          });
          sendToRenderer(win, {
            type: 'error',
            error: `Tool loop reached maximum ${MAX_TOOL_LOOPS} iterations. Stopping.`,
          });
          break;
        }

        // Execute each tool and collect results
        const toolResults: LlmContentBlock[] = [];
        for (const toolBlock of toolUseBlocks) {
          const result = await executeTool(toolBlock.name, toolBlock.input, conversationId);

          // Send tool_result event to renderer for display
          sendToRenderer(win, {
            type: 'tool_result',
            toolUseId: toolBlock.id,
            name: toolBlock.name,
            content: result.content,
            isError: result.isError,
            artifactId: result.artifactId,
          });

          toolResults.push({
            type: 'tool_result',
            toolUseId: toolBlock.id,
            content: result.content,
            isError: result.isError,
          });
        }

        // Append tool results as a user message (Anthropic API format) + persist
        history.push({ role: 'user', content: toolResults });
        persistMessage(conversationId, 'user', toolResults);

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

  // Load conversation history from SQLite into memory
  ipcMain.handle('conv:loadMessages', (_event, conversationId: string) => {
    const history = getHistory(conversationId);
    // Return simplified message format for renderer to display
    return history.map((msg, i) => {
      const content = typeof msg.content === 'string'
        ? [{ type: 'text', text: msg.content }]
        : msg.content;
      return {
        id: `loaded_${i}_${Date.now()}`,
        role: msg.role,
        content,
        timestamp: Date.now() - (history.length - i) * 1000, // Approximate ordering
      };
    });
  });

  // Clear conversation history (called when user deletes a conversation)
  ipcMain.handle('conv:clearHistory', (_event, conversationId: string) => {
    histories.delete(conversationId);
    deleteMessages(conversationId);
    return { success: true };
  });
}

/**
 * Safely parse tool input JSON, logging on failure.
 */
function safeParseToolInput(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    logger.warn('stream', 'Failed to parse tool input JSON', {
      json: json.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
