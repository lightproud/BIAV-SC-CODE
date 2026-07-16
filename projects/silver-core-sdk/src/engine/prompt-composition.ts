/**
 * Prompt-composition analyzer (BPT-EXTENSION, spec 2026-07-09).
 *
 * A build-time, offline description of what a request is made of and where its
 * prompt-cache breakpoints fall — the two things the SDK knows for certain the
 * moment it assembles a request, and which a downstream "context composition"
 * panel otherwise can only reverse-engineer from a transcript by guessing.
 *
 *  - 需求 A (per-part estimate): the request decomposed into systemBase /
 *    systemAppend[] / toolDefs / messages, each with an estimated token count
 *    from the SAME estimator (engine/tokens.ts) the compaction layer uses to
 *    size the context window — so the panel's per-part numbers share the SDK's
 *    context-window accounting口径 instead of a re-implemented tokenizer.
 *  - 需求 B (cache-breakpoint map): the request's cache_control breakpoints,
 *    each annotated with the estimated token size of the prefix it seals. With
 *    this the panel can map the API's REAL usage counts onto content buckets at
 *    zero extra calls: cache_read_input_tokens ≈ a matched cached prefix
 *    (stable layers), input_tokens + cache_creation ≈ this turn's new tail
 *    (dynamic memory + latest message).
 *
 * Every number here is an ESTIMATE (see engine/tokens.ts) — this module makes
 * the estimate more precise and adds a real coarse cache map; per-segment EXACT
 * truth still requires the Messages API `count_tokens` endpoint (out of scope,
 * complementary). Pure and allocation-light; no network, no mutation of `req`.
 */

import type {
  StreamRequest,
  SystemComposition,
  SystemCompositionPart,
} from '../internal/contracts.js';
import type {
  CacheBreakpoint,
  CacheControlEphemeral,
  PromptComposition,
  PromptCompositionPart,
  RequestComposition,
} from '../types.js';
import {
  estimateMessagesTokens,
  estimateTextTokens,
  estimateToolDefsTokens,
} from './tokens.js';

function hasCache(cc: CacheControlEphemeral | null | undefined): boolean {
  return cc !== null && cc !== undefined && cc.type === 'ephemeral';
}

/** Exact UTF-8 byte length (no Buffer dependency — TextEncoder is universal). */
const BYTE_ENCODER = new TextEncoder();
function utf8Bytes(s: string): number {
  return BYTE_ENCODER.encode(s).length;
}

/** Exact bytes of the wire `system` field (string, block array, or absent).
 *  Only the text content is counted — the cache_control/type wrapper bytes
 *  are wire framing, not prompt content. */
function systemFieldBytes(sys: StreamRequest['system']): number {
  if (typeof sys === 'string') return utf8Bytes(sys);
  if (Array.isArray(sys)) return sys.reduce((sum, b) => sum + utf8Bytes(b.text), 0);
  return 0;
}

/** Human label for a part, defaulting to its role name when none was supplied. */
function partLabel(part: SystemCompositionPart): string {
  return part.label ?? part.role;
}

/**
 * Describe a request's composition (需求 A) and cache-breakpoint map (需求 B).
 *
 * `req` is the CONTENT source for 需求 A — pass the request BEFORE cache_control
 * is applied so the per-part estimate matches the SDK's own context-window口径
 * (the compaction layer estimates the raw, un-blockified messages + tool defs;
 * cache_control markers add a few wire bytes and blockify the last message,
 * which A should not inherit). `system` is the engine's labeled per-part system
 * breakdown (built by the query layer where the parts are still separate
 * strings); when omitted, systemBase/systemAppend are derived best-effort from
 * the wire `system` field (block 0 = base, the rest = append). `outgoing` is the
 * FINAL wire request (after cache_control) whose real markers 需求 B walks;
 * defaults to `req` (so a single-arg call on an already-shaped request still
 * finds its breakpoints — at the cost of the小 wire artifacts leaking into A).
 */
export function analyzeRequestComposition(
  req: StreamRequest,
  system?: SystemComposition,
  outgoing?: StreamRequest,
): RequestComposition {
  const wire = outgoing ?? req;
  const tools = req.tools ?? [];
  const toolDefsEst = estimateToolDefsTokens(tools);
  const messagesEst = estimateMessagesTokens(req.messages);

  // --- 需求 A: per-part system decomposition ---
  let systemBase = { estTokens: 0 };
  const systemAppend: PromptCompositionPart[] = [];
  if (system !== undefined) {
    for (const part of system.parts) {
      if (part.role === 'base') {
        systemBase = { estTokens: part.estTokens };
      } else {
        systemAppend.push({ label: partLabel(part), estTokens: part.estTokens });
      }
    }
  } else {
    const sys = req.system;
    if (typeof sys === 'string') {
      systemBase = { estTokens: estimateTextTokens(sys) };
    } else if (Array.isArray(sys)) {
      sys.forEach((block, i) => {
        const est = estimateTextTokens(block.text);
        if (i === 0) systemBase = { estTokens: est };
        else systemAppend.push({ estTokens: est });
      });
    }
  }
  const systemAppendTotal = systemAppend.reduce((sum, p) => sum + p.estTokens, 0);

  // EXACT byte sizes from the request content (complementary to the token
  // estimates). System bytes come from the wire `system` field so the total
  // matches what the API receives regardless of the labeled-parts path.
  const systemBytes = systemFieldBytes(req.system);
  const toolDefsBytes = tools.length > 0 ? utf8Bytes(JSON.stringify(tools)) : 0;
  const messagesBytes = utf8Bytes(JSON.stringify(req.messages));

  const promptComposition: PromptComposition = {
    systemBase,
    systemAppend,
    toolDefs: { estTokens: toolDefsEst, count: tools.length },
    messages: { estTokens: messagesEst, count: req.messages.length },
    totalEstTokens:
      systemBase.estTokens + systemAppendTotal + toolDefsEst + messagesEst,
    bytes: {
      system: systemBytes,
      toolDefs: toolDefsBytes,
      messages: messagesBytes,
      total: systemBytes + toolDefsBytes + messagesBytes,
    },
  };

  // --- 需求 B: cache-breakpoint map, walked over the WIRE request in prefix
  // order. The Messages API builds the cached prefix as tools → system →
  // messages; a cache_control marker seals everything from the start up to that
  // marker. Estimates here reflect the actual wire bytes (markers/blockified
  // last message included) so the prefix sizes match what the API caches.
  const cacheBreakpoints: CacheBreakpoint[] = [];
  const wireTools = wire.tools ?? [];
  let prefix = 0;
  if (wireTools.length > 0) {
    prefix += estimateToolDefsTokens(wireTools);
    // This SDK marks the last tool; treat any tool marker as sealing the whole
    // (single-prefix) tools block.
    if (wireTools.some((t) => hasCache(t.cache_control))) {
      cacheBreakpoints.push({ afterPart: 'toolDefs', prefixEstTokens: prefix });
    }
  }
  const sys = wire.system;
  if (Array.isArray(sys)) {
    sys.forEach((block, i) => {
      prefix += estimateTextTokens(block.text);
      if (hasCache(block.cache_control)) {
        cacheBreakpoints.push({
          afterPart: i === 0 ? 'systemBase' : `systemAppend[${i - 1}]`,
          prefixEstTokens: prefix,
        });
      }
    });
  } else if (typeof sys === 'string') {
    // A bare string carries no cache_control (applyCacheControl would have
    // wrapped it in a block); it still contributes to the running prefix.
    prefix += estimateTextTokens(sys);
  }
  // Messages breakpoint: the marker sits on the last block of the last message,
  // so the sealed prefix is tools + all system + all messages.
  prefix += estimateMessagesTokens(wire.messages);
  if (lastMessageHasCache(wire)) {
    cacheBreakpoints.push({ afterPart: 'messages[last]', prefixEstTokens: prefix });
  }

  return { promptComposition, cacheBreakpoints };
}

/** Whether the last message's last content block carries a cache breakpoint. */
function lastMessageHasCache(req: StreamRequest): boolean {
  const last = req.messages[req.messages.length - 1];
  if (last === undefined) return false;
  const content = last.content;
  if (typeof content === 'string' || content.length === 0) return false;
  const block = content[content.length - 1];
  if (
    block === undefined ||
    block.type === 'thinking' ||
    block.type === 'redacted_thinking' ||
    block.type === 'tool_use'
  ) {
    return false;
  }
  return hasCache(
    (block as { cache_control?: CacheControlEphemeral | null }).cache_control,
  );
}
