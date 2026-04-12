/**
 * tool-loop.ts — Tool use execution loop.
 *
 * Why a dedicated module: When the LLM returns a tool_use block, we need to:
 * 1. Execute the tool (MCP call, BPE search, or builtin)
 * 2. Truncate the result if > threshold (Prime Directive T2)
 * 3. Return the result to the LLM for the next turn
 * 4. Repeat until the LLM stops requesting tools
 *
 * Phase 0: Basic loop. Phase 1 adds full tool result streaming and artifact storage.
 */

import { getSilverApi } from '../silver/silver-ipc';
import { getBpeIndexes } from '../bpe/bpe-ipc';
import { searchFts5, lookupSymbol } from '../bpe/search';
import { getConfig } from '../core/config';
import { logger } from '../core/logger';

interface ToolCallResult {
  content: string;
  isError: boolean;
}

/**
 * Execute a single tool call and return the result.
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    const result = await dispatchTool(toolName, toolInput);
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    // Prime Directive T2: Truncate if over threshold
    const threshold = (getConfig('truncateThreshold') as number) ?? 2000;
    const truncated = truncateResult(resultStr, threshold);

    return { content: truncated, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('tool-loop', `Tool ${toolName} failed`, { error: message });
    return { content: `Error: ${message}`, isError: true };
  }
}

async function dispatchTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const silverApi = getSilverApi();

  switch (name) {
    // Silver Core MCP tools
    case 'memory_search':
      return silverApi?.memorySearch(input.query as string, input.top_k as number);
    case 'graph_query':
      return silverApi?.graphQuery(input.entity as string, input.depth as number);
    case 'graph_related_files':
      return silverApi?.graphRelatedFiles(input.entity as string);
    case 'store_facts':
      return silverApi?.storeFacts(
        typeof input.facts === 'string' ? JSON.parse(input.facts) : input.facts as Array<{ content: string }>,
      );

    // BPE tools
    case 'bpe_semantic_search': {
      const indexes = getBpeIndexes();
      if (!indexes) return { results: [], error: 'BPE not loaded' };
      return searchFts5(indexes, input.query as string, (input.limit as number) ?? 5);
    }
    case 'bpe_lookup_symbol': {
      const indexes = getBpeIndexes();
      if (!indexes) return { results: [], error: 'BPE not loaded' };
      return lookupSymbol(indexes, input.name as string, (input.limit as number) ?? 3);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Truncate a tool result to fit within the token budget.
 * The full result should be saved as a local artifact (Phase 1).
 */
function truncateResult(text: string, maxChars: number): string {
  // Rough: 4 chars ≈ 1 token, so maxChars = threshold * 4
  const charLimit = maxChars * 4;
  if (text.length <= charLimit) return text;

  return (
    text.slice(0, charLimit) +
    `\n\n[... result truncated at ${maxChars} tokens. Full result saved locally.]`
  );
}
