/**
 * BPT Agent SDK - automatic prompt-caching request shaper.
 *
 * Pure function: given a StreamRequest, returns a NEW StreamRequest annotated
 * with `cache_control: { type: 'ephemeral' }` breakpoints so the Messages API
 * caches the stable prefix (tools -> system -> prior messages) across turns.
 *
 * It NEVER mutates its input. The agent loop reuses a module-level toolDefs
 * array and the persisted, append-only history array; mutating either would
 * corrupt the transcript / resumes. Every level shallow-clones before adding a
 * breakpoint.
 *
 * The API allows up to 4 ephemeral breakpoints; this layer places at most 3
 * (tools, system, last message), honoring the documented prefix hierarchy.
 * Writes happen only at a breakpoint; reads match the longest prior prefix
 * automatically within a 20-block lookback, so the moving last-message
 * breakpoint yields incremental conversation caching without touching the
 * earlier (tools/system) breakpoints.
 */

import type { StreamRequest } from '../internal/contracts.js';
import type {
  APIToolDefinition,
  ContentBlockParam,
  TextBlockParam,
} from '../types.js';

const EPHEMERAL = { type: 'ephemeral' } as const;

/** Content-block param types that legally carry a cache_control breakpoint. */
type CacheableLastBlock = 'text' | 'tool_result' | 'image';

/**
 * Return a new StreamRequest with automatic prompt-caching breakpoints.
 *
 * When `enabled` is false, the input is returned unchanged (identity). When
 * enabled, up to three breakpoints are attached without mutating the input:
 *  - tools:    last tool gets cache_control (skipped when no tools);
 *  - system:   string -> single cached text block; TextBlockParam[] -> last
 *              block cached (skipped when empty/undefined);
 *  - messages: (only when cacheMessages !== false) the last message's last
 *              content block gets cache_control when it is text/tool_result/
 *              image; skipped when it is thinking/tool_use/redacted_thinking.
 */
export function applyCacheControl(
  req: StreamRequest,
  opts: {
    enabled: boolean;
    cacheMessages?: boolean;
    /**
     * Which block of a TextBlockParam[] system carries the breakpoint.
     * - 'last' (default): cache the final block (original behavior; a caller
     *   who hands us a multi-block system wants the whole thing cached).
     * - 'first': cache the FIRST block. The engine uses this for its
     *   [stable, volatile-cwd] split so the stable prefix is cached and the
     *   per-run cwd tail (block 2) stays out of the cached prefix, enabling
     *   cross-query reuse of the stable prefix.
     */
    cacheSystemBoundary?: 'first' | 'last';
  },
): StreamRequest {
  if (!opts.enabled) return req;

  const next: StreamRequest = { ...req };

  // (a) TOOLS breakpoint - last tool.
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    const tools = req.tools.slice();
    const lastIdx = tools.length - 1;
    const lastTool = tools[lastIdx] as APIToolDefinition;
    tools[lastIdx] = { ...lastTool, cache_control: EPHEMERAL };
    next.tools = tools;
  }

  // (b) SYSTEM breakpoint - last text block (or first, for the engine split).
  next.system = cacheSystem(req.system, opts.cacheSystemBoundary ?? 'last');

  // (c) MESSAGES breakpoint - last content block of the last message.
  const last =
    opts.cacheMessages !== false ? req.messages[req.messages.length - 1] : undefined;
  if (last !== undefined) {
    const cachedContent = cacheMessageContent(last.content);
    if (cachedContent !== undefined) {
      const messages = req.messages.slice();
      messages[messages.length - 1] = { ...last, content: cachedContent };
      next.messages = messages;
    }
  }

  return next;
}

/**
 * Annotate the system prompt's last text block. A non-empty string becomes a
 * single cached text block; a non-empty TextBlockParam[] is cloned with the
 * breakpoint on its last block; empty/undefined is left as-is.
 */
function cacheSystem(
  system: string | TextBlockParam[] | undefined,
  boundary: 'first' | 'last',
): string | TextBlockParam[] | undefined {
  if (typeof system === 'string') {
    if (system.length === 0) return system;
    return [{ type: 'text', text: system, cache_control: EPHEMERAL }];
  }
  if (Array.isArray(system) && system.length > 0) {
    const blocks = system.slice();
    // 'first' caches the stable prefix block (engine's [stable, cwd] split);
    // 'last' caches the final block (default for caller-supplied systems).
    const idx = boundary === 'first' ? 0 : blocks.length - 1;
    const target = blocks[idx] as TextBlockParam;
    blocks[idx] = { ...target, cache_control: EPHEMERAL };
    return blocks;
  }
  return system;
}

/**
 * Produce a cached copy of one message's content, or undefined when no
 * breakpoint can be placed (skip). A non-empty string becomes a single cached
 * text block; a ContentBlockParam[] gets the breakpoint on its last block when
 * that block is text/tool_result/image, else the message is skipped.
 */
function cacheMessageContent(
  content: string | ContentBlockParam[],
): string | ContentBlockParam[] | undefined {
  if (typeof content === 'string') {
    if (content.length === 0) return undefined;
    return [{ type: 'text', text: content, cache_control: EPHEMERAL }];
  }
  if (content.length === 0) return undefined;
  const lastIdx = content.length - 1;
  const lastBlock = content[lastIdx] as ContentBlockParam;
  if (!isCacheableLastBlock(lastBlock.type)) return undefined;
  const blocks = content.slice();
  blocks[lastIdx] = { ...lastBlock, cache_control: EPHEMERAL } as ContentBlockParam;
  return blocks;
}

function isCacheableLastBlock(type: string): type is CacheableLastBlock {
  return type === 'text' || type === 'tool_result' || type === 'image';
}
