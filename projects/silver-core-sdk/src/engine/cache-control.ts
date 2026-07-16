/**
 * Silver Core SDK - automatic prompt-caching request shaper.
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
 * The API allows up to 4 ephemeral breakpoints; this layer places at most 4
 * (tools, up to TWO system breakpoints, last message), honoring the documented
 * prefix hierarchy. The 2nd system breakpoint is used only for the engine's
 * three-block [base, project, cwd] layout (boundary 'dual'): the shared base
 * harness and the per-project instructions/append tail then cache as two
 * independently-reusable segments. Writes happen only at a breakpoint; reads
 * match the longest prior prefix automatically within a 20-block lookback, so
 * the moving last-message breakpoint yields incremental conversation caching
 * without touching the earlier (tools/system) breakpoints.
 *
 * KD (E7-03, kept divergence, 2026-07-05): the official arm sends ZERO
 * cache_control breakpoints on tool blocks; we keep ONE (last tool). Offline
 * strategy replay over real captured request bodies
 * (tests/cache-breakpoint-analysis.test.ts) measured:
 *  - same-session / same-cwd / cross-cwd traces: identical cache hits either
 *    way (the system breakpoints already cover the tools prefix);
 *  - same tools + DIFFERENT system (custom systemPrompt consumers; the shape
 *    subagent presets take): only the tool breakpoint salvages the serialized
 *    tools prefix - measured 33,907 bytes (~8.5k tokens) read vs 0, and
 *    48,340 vs 82,247 bytes re-written on the divergent request.
 * Aligning would therefore never gain a byte and strictly lose the shared
 * tools prefix whenever the system diverges, so the divergence is kept and
 * `toolCacheBreakpoints` stays a documented entry in WIRE_ALIGNMENT_GAPS
 * (tests/conformance-wire.test.ts). Cost: one of the four breakpoint slots
 * (we sit exactly at 4 with boundary 'dual' + message; callers of the
 * 'preserve' seam get 3 slots for their own system breakpoints, see the
 * cacheMessages note in engine/loop.ts). Re-examine if the premise tests
 * ever go red.
 */

import type { StreamRequest } from '../internal/contracts.js';
import type {
  APIToolDefinitionParam,
  CacheControlEphemeral,
  ContentBlockParam,
  TextBlockParam,
} from '../types.js';

/**
 * The cache_control marker for a breakpoint. `ttl` undefined / '5m' yields the
 * bare `{ type: 'ephemeral' }` (byte-identical to the pre-cacheTtl default, so
 * the wire ratchet is unaffected); '1h' adds `ttl: '1h'`.
 */
function ephemeral(cacheTtl?: '5m' | '1h'): CacheControlEphemeral {
  return cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

/** Content-block param types that legally carry a cache_control breakpoint. */
type CacheableLastBlock = 'text' | 'tool_result' | 'image';

/**
 * Return a new StreamRequest with automatic prompt-caching breakpoints.
 *
 * When `enabled` is false, the input is returned unchanged (identity). When
 * enabled, up to four breakpoints are attached without mutating the input:
 *  - tools:    last tool gets cache_control (skipped when no tools);
 *  - system:   string -> single cached text block; TextBlockParam[] -> last
 *              (or first / first-two) block cached (skipped when empty/undefined);
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
     * - 'dual': cache the FIRST TWO blocks. Used only for the engine's
     *   three-block [base, project, cwd] layout: block 0 (shared base harness)
     *   and block 1 (per-project instructions/append tail) each get a
     *   breakpoint so they cache as two independently-reusable segments, while
     *   the per-run cwd tail (block 2) stays uncached.
     * - 'preserve': leave the system untouched. Used for the segments seam,
     *   where the CALLER authored the blocks and their own cache_control
     *   breakpoints; the engine must not add or move any.
     */
    cacheSystemBoundary?: 'first' | 'last' | 'dual' | 'preserve';
    /**
     * Cache lifetime for every breakpoint placed here. Omitted / '5m' keeps the
     * bare `{ type: 'ephemeral' }` marker (5-minute default); '1h' stamps
     * `ttl: '1h'` on all of them. BPT-EXTENSION (Provider.cacheTtl).
     */
    cacheTtl?: '5m' | '1h';
  },
): StreamRequest {
  if (!opts.enabled) return req;

  const marker = ephemeral(opts.cacheTtl);
  const next: StreamRequest = { ...req };

  // (a) TOOLS breakpoint - last tool.
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    const tools = req.tools.slice();
    const lastIdx = tools.length - 1;
    const lastTool = tools[lastIdx] as APIToolDefinitionParam;
    tools[lastIdx] = { ...lastTool, cache_control: marker };
    next.tools = tools;
  }

  // (b) SYSTEM breakpoint - last text block (or first, for the engine split;
  // or preserve, when the caller authored the blocks + their own breakpoints).
  const boundary = opts.cacheSystemBoundary ?? 'last';
  next.system =
    boundary === 'preserve' ? req.system : cacheSystem(req.system, boundary, marker);

  // (c) MESSAGES breakpoint - last content block of the last message.
  const last =
    opts.cacheMessages !== false ? req.messages[req.messages.length - 1] : undefined;
  if (last !== undefined) {
    const cachedContent = cacheMessageContent(last.content, marker);
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
  boundary: 'first' | 'last' | 'dual',
  marker: CacheControlEphemeral,
): string | TextBlockParam[] | undefined {
  if (typeof system === 'string') {
    if (system.length === 0) return system;
    return [{ type: 'text', text: system, cache_control: marker }];
  }
  if (Array.isArray(system) && system.length > 0) {
    const blocks = system.slice();
    if (boundary === 'dual') {
      // Engine's three-block [base, project, cwd] layout: cache block 0 (shared
      // base harness) AND block 1 (per-project tail) — two reusable segments —
      // leaving block 2 (per-run cwd) uncached. Guard by existence so a
      // degenerate array only touches indices that exist.
      const base = blocks[0] as TextBlockParam;
      blocks[0] = { ...base, cache_control: marker };
      if (blocks.length > 1) {
        const project = blocks[1] as TextBlockParam;
        blocks[1] = { ...project, cache_control: marker };
      }
      return blocks;
    }
    // 'first' caches the stable prefix block (engine's [stable, cwd] split);
    // 'last' caches the final block (default for caller-supplied systems).
    const idx = boundary === 'first' ? 0 : blocks.length - 1;
    const target = blocks[idx] as TextBlockParam;
    blocks[idx] = { ...target, cache_control: marker };
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
  marker: CacheControlEphemeral,
): string | ContentBlockParam[] | undefined {
  if (typeof content === 'string') {
    if (content.length === 0) return undefined;
    return [{ type: 'text', text: content, cache_control: marker }];
  }
  if (content.length === 0) return undefined;
  const lastIdx = content.length - 1;
  const lastBlock = content[lastIdx] as ContentBlockParam;
  if (!isCacheableLastBlock(lastBlock.type)) return undefined;
  const blocks = content.slice();
  blocks[lastIdx] = { ...lastBlock, cache_control: marker } as ContentBlockParam;
  return blocks;
}

function isCacheableLastBlock(type: string): type is CacheableLastBlock {
  return type === 'text' || type === 'tool_result' || type === 'image';
}
