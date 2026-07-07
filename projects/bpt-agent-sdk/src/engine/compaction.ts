/**
 * Context-compaction engine.
 *
 * When the estimated token size of the running request-message view approaches
 * the model context window, older turns are folded into a synthetic summary so
 * the conversation can keep going. This module owns:
 *   - threshold math (auto trigger + budgets),
 *   - safe, pairing-preserving partitioning (never splits a tool_use from its
 *     tool_result),
 *   - the deterministic structural fold (default, offline, zero extra spend),
 *   - an optional real Messages API summarization fold,
 *   - PreCompact hook firing (deny/continue:false vetoes compaction),
 *   - SDKCompactBoundaryMessage emission.
 *
 * It operates on a shared mutable holder `view: { messages }` and mutates
 * `view.messages` IN PLACE via splice(0, prefix.length, ...synthetic) so the
 * reference held by the query layer stays valid. The query layer only ever
 * PUSHES to view.messages (never reads it by absolute index), which is what
 * makes front-replacement safe.
 */

import { randomUUID } from 'node:crypto';

import { AbortError, isAbortError } from '../errors.js';
import type {
  APIMessageParam,
  CompactionOptions,
  ContentBlockParam,
  NonNullableUsage,
  PreCompactHookInput,
  SDKCompactBoundaryMessage,
  SDKMessage,
} from '../types.js';
import type {
  CompactionConfig,
  EngineConfig,
  EngineDeps,
  StreamRequest,
} from '../internal/contracts.js';
import { resolveModelAlias } from '../subagents/agents.js';
import { MessageAccumulator } from './accumulator.js';
import { contextWindowFor } from './context-window.js';
import { normalizeUsage } from './pricing.js';
import { estimateMessagesTokens } from './tokens.js';

/**
 * Sink for a summary call's usage, so the engine folds the extra billable
 * call's tokens/cost/latency into its running totals + budget.
 */
export type SummaryCallSink = (
  model: string,
  usage: NonNullableUsage,
  apiMs: number,
) => void;

/** Fraction of the input budget below which folding is not worth it. */
const MIN_FOLD_RATIO = 0.15;
/**
 * Message count of a synthetic fold (the user->assistant summary pair produced
 * by foldDeterministic / foldViaApi). A prefix at or below this length cannot
 * be folded into fewer messages, so folding it is pure churn.
 */
const SYNTHETIC_FOLD_LENGTH = 2;
/** Hard cap (chars) on the deterministic recap body. */
const RECAP_CHAR_CAP = 4000;
/** Chars of message text kept per recap line. */
const RECAP_LINE_CHARS = 200;
/** Chars of tool-call args kept per recap line. */
const RECAP_ARGS_CHARS = 120;
/**
 * Default byte budget (chars) for a single string tool_result in the pre-tier.
 * Mirrors RECAP_CHAR_CAP's scale: content beyond this is head/tail pointer-ized.
 */
const PRE_TIER_DEFAULT_MAX_TOOL_RESULT_CHARS = 4000;

const SUMMARY_USER_PROMPT =
  'Please summarize our conversation so far, preserving key decisions, facts, ' +
  'file paths, tool results, and open tasks.';

/**
 * Summarizer system prompt — a faithful OPEN reproduction of the official
 * context-compaction summary prompt (archive slug
 * system-prompt-context-compaction-summary under
 * Public-Info-Pool/Reference/Claude-Code-System-Prompts/): the structured
 * 5-section continuation summary. Reproduced verbatim; the only adaptation is
 * that the `<summary></summary>` wrapper the official asks for is stripped by
 * the consumer (foldViaApi) since this SDK folds the raw summary text. Its
 * provenance is SUMMARIZER_SYSTEM_PROVENANCE and a corpus-sync guard
 * (tests/compaction.test.ts) holds it to the archive.
 */
export const SUMMARIZER_SYSTEM = [
  'You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:',
  '1. Task Overview',
  "The user's core request and success criteria",
  'Any clarifications or constraints they specified',
  '2. Current State',
  'What has been completed so far',
  'Files created, modified, or analyzed (with paths if relevant)',
  'Key outputs or artifacts produced',
  '3. Important Discoveries',
  'Technical constraints or requirements uncovered',
  'Decisions made and their rationale',
  'Errors encountered and how they were resolved',
  "What approaches were tried that didn't work (and why)",
  '4. Next Steps',
  'Specific actions needed to complete the task',
  'Any blockers or open questions to resolve',
  'Priority order if multiple steps remain',
  '5. Context to Preserve',
  'User preferences or style requirements',
  "Domain-specific details that aren't obvious",
  'Any promises made to the user',
  'Be concise but complete—err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.',
].join('\n');

/** Provenance for the compaction summarizer surface (Track B). */
export const SUMMARIZER_SYSTEM_PROVENANCE = {
  slug: 'system-prompt-context-compaction-summary',
  faithful: true,
} as const;

/**
 * No-tools guard — verbatim OPEN reproduction of
 * agent-prompt-summarization-no-tools-guard. Appended to the summarizer system
 * prompt at the foldViaApi call site (SUMMARIZER_SYSTEM stays byte-identical).
 * The summarization fold wires NO tools, so a tool_use reply is a real failure
 * mode (it yields non-text blocks and forces the buildRecap fallback); this
 * guard tells the model to answer in plain text only. Held to the archive by a
 * corpus-sync guard in tests/compaction.test.ts.
 */
export const SUMMARIZER_NO_TOOLS_GUARD = [
  'CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.',
  '',
  '- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.',
  '- You already have all the context you need in the conversation above.',
  '- Tool calls will be REJECTED and will waste your only turn — you will fail the task.',
  '- Your entire response must be plain text: an <analysis> block followed by a <summary> block.',
].join('\n');

/** Provenance for the no-tools guard surface. */
export const SUMMARIZER_NO_TOOLS_GUARD_PROVENANCE = {
  slug: 'agent-prompt-summarization-no-tools-guard',
  faithful: true,
} as const;

/**
 * Verbatim-preservation safety clause — verbatim OPEN reproduction of the
 * security-constraint preservation rule in system-prompt-partial-compaction-
 * instructions. Ensures user-stated security constraints survive the fold so
 * they keep applying after compaction. Held to the archive by a corpus-sync
 * guard in tests/compaction.test.ts.
 */
export const SUMMARIZER_VERBATIM_SAFETY_CLAUSE =
  'Note any security-relevant instructions or constraints the user stated (e.g., sensitive files or data to avoid, operations that must not be performed, credential or secret handling rules). These MUST be preserved verbatim in the summary so they continue to apply after compaction.';

/** Provenance for the verbatim-preservation safety clause surface. */
export const SUMMARIZER_VERBATIM_SAFETY_CLAUSE_PROVENANCE = {
  slug: 'system-prompt-partial-compaction-instructions',
  faithful: true,
} as const;

/**
 * Extract the fold text from a summarizer reply, honoring the no-tools guard's
 * declared output contract (an <analysis> scratchpad followed by a <summary>
 * block). Prefers explicit <summary> content; otherwise drops any <analysis>
 * scratchpad and strips stray <summary> tags. When the reply carries a
 * well-formed <summary> block, that block IS the summary (any stray text outside
 * it is intentionally dropped — the guard contract puts the summary in that
 * block). For a reply with NO <summary> block it is a strict superset of the old
 * `.replace(/<\/?summary>/gi,'').trim()`, so plain-text replies pass through
 * unchanged.
 */
export function extractSummaryFromReply(text: string): string {
  // The <summary> block is authoritative ONLY when the full guard contract is
  // present (an <analysis> scratchpad AND a <summary> block) — that is the
  // shape the no-tools guard declares. In that case we deliberately keep just
  // the summary block and drop the analysis scratchpad.
  const hasAnalysis = /<analysis>[\s\S]*?<\/analysis>/i.test(text);
  if (hasAnalysis) {
    const m = /<summary>([\s\S]*?)<\/summary>/i.exec(text);
    if (m) return (m[1] ?? '').trim();
    return text
      .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
      .replace(/<\/?summary>/gi, '')
      .trim();
  }
  // No <analysis> block: behave EXACTLY like the old strip so this is a strict
  // superset — a plain-text reply (or any reply without the full contract) is
  // never truncated to a lone <summary> block, no surrounding text is lost.
  return text.replace(/<\/?summary>/gi, '').trim();
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Resolve user CompactionOptions into a fully-defaulted CompactionConfig. */
export function buildCompactionConfig(
  opt: CompactionOptions | undefined,
): CompactionConfig {
  return {
    enabled: opt?.enabled ?? true,
    autoThresholdRatio: opt?.autoThresholdRatio ?? 0.85,
    keepRatio: opt?.keepRatio ?? 0.3,
    minRecentTurns: opt?.minRecentTurns ?? 2,
    useApiSummary: opt?.useApiSummary ?? false,
    recognizeCommand: opt?.recognizeCommand ?? true,
    customInstructions: opt?.customInstructions,
    contextWindowTokens: opt?.contextWindowTokens,
    model: opt?.model,
    preTier: opt?.preTier ?? true,
    preTierMaxToolResultChars:
      opt?.preTierMaxToolResultChars ?? PRE_TIER_DEFAULT_MAX_TOOL_RESULT_CHARS,
  };
}

// ---------------------------------------------------------------------------
// Threshold + command detection
// ---------------------------------------------------------------------------

/**
 * Decide whether an automatic compaction should fire. Returns { preTokens }
 * when the estimated request size has reached the trigger threshold, else null.
 */
export function shouldAutoCompact(
  messages: APIMessageParam[],
  overheadTokens: number,
  window: number,
  reservedOutputTokens: number,
  cfg: CompactionConfig,
): { preTokens: number } | null {
  // Degenerate config: the window cannot even hold the reserved output. There
  // is no positive input budget to fold toward, so compaction is impossible.
  // Returning null here prevents the old Math.max(1, …) clamp from yielding a
  // budget of 1 and triggerAt=0 (always-fire churn). The maybeAutoCompact /
  // performCompaction drivers emit a debug warning for this case.
  if (window <= reservedOutputTokens) return null;
  const effectiveInputBudget = window - reservedOutputTokens;
  const triggerAt = Math.floor(effectiveInputBudget * cfg.autoThresholdRatio);
  const preTokens = estimateMessagesTokens(messages) + overheadTokens;
  return preTokens >= triggerAt ? { preTokens } : null;
}

/**
 * Recognize a trailing `/compact [instructions]` user turn as a manual
 * compaction request. Returns the parsed instructions, or null when the last
 * message is not a plain-text `/compact` command.
 */
export function detectManualCompact(
  messages: APIMessageParam[],
  _cfg: CompactionConfig,
): { customInstructions: string | null } | null {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'user') return null;
  const text = plainTextIfPureText(last.content);
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '/compact') return { customInstructions: null };
  if (trimmed.startsWith('/compact ')) {
    const rest = trimmed.slice('/compact '.length).trim();
    return { customInstructions: rest.length > 0 ? rest : null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Partitioning (pairing-preserving)
// ---------------------------------------------------------------------------

/**
 * Choose a cut index i so messages[0..i) is folded and messages[i..] is kept
 * verbatim, NEVER splitting a tool_use/tool_result pair. Returns null when no
 * safe, worthwhile fold exists.
 */
export function partitionForCompaction(
  messages: APIMessageParam[],
  effectiveInputBudget: number,
  cfg: CompactionConfig,
): { prefix: APIMessageParam[]; suffix: APIMessageParam[] } | null {
  const keepBudget = Math.floor(effectiveInputBudget * cfg.keepRatio);
  const minFoldTokens = Math.floor(effectiveInputBudget * MIN_FOLD_RATIO);

  // Candidate cut points: indices of GENUINE user turns (a real prompt, i.e.
  // a user message that is NOT a tool_result-only turn). i=0 is excluded
  // (empty prefix); i=messages.length is a degenerate empty-suffix candidate.
  const genuine: number[] = [];
  for (let i = 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg !== undefined && isGenuineUserTurn(msg)) genuine.push(i);
  }
  if (genuine.length === 0) return null; // cannot compact safely

  const candidates = [...genuine, messages.length];
  const evaluated = candidates.map((i) => {
    const suffix = messages.slice(i);
    return {
      i,
      tokens: estimateMessagesTokens(suffix),
      turns: countGenuineUserTurns(suffix),
    };
  });

  const both = evaluated.filter(
    (c) => c.tokens <= keepBudget && c.turns >= cfg.minRecentTurns,
  );
  let chosen: number;
  if (both.length > 0) {
    // Largest cut index within budget that still keeps minRecentTurns -> the
    // minimal viable suffix, maximizing the fold.
    chosen = Math.max(...both.map((c) => c.i));
  } else {
    const withTurns = evaluated.filter((c) => c.turns >= cfg.minRecentTurns);
    if (withTurns.length > 0) {
      // minRecentTurns cannot fit in keepBudget: honor minRecentTurns anyway.
      chosen = Math.max(...withTurns.map((c) => c.i));
    } else {
      // Not enough genuine user turns exist to satisfy minRecentTurns: keep as
      // much as possible (smallest genuine cut index).
      chosen = Math.min(...genuine);
    }
  }

  const prefix = messages.slice(0, chosen);
  const suffix = messages.slice(chosen);
  if (prefix.length === 0) return null;
  // Folding replaces the prefix with a synthetic length-2 pair. If the prefix
  // is already <= that length (e.g. it IS just a prior synthetic pair), the
  // fold would not reduce the message count — it only re-summarizes and emits a
  // redundant boundary. Skip. This guard is robust even when minFoldTokens
  // degenerates to 0 (unlike the ratio check below).
  if (prefix.length <= SYNTHETIC_FOLD_LENGTH) return null;
  // Prefix too small to be worth folding: avoids re-folding an already-tiny
  // summarized prefix and stops per-iteration churn / boundary spam.
  if (estimateMessagesTokens(prefix) < minFoldTokens) return null;
  return { prefix, suffix };
}

// ---------------------------------------------------------------------------
// Pre-tier (G1): deterministic byte-shedding before the summarization fold
// ---------------------------------------------------------------------------

/**
 * Cheap, deterministic PRE-TIER over the folded prefix: shed tool_result bulk
 * BEFORE the (expensive) summarization step so fewer tokens reach the
 * summarizer (foldViaApi) / deterministic recap. Two transforms, applied per
 * STRING tool_result in prefix order:
 *   1. DEDUPE — a tool_result whose exact content string already appeared
 *      earlier is replaced with a `[…duplicate tool_result, N chars elided…]`
 *      pointer (only when that nets savings, so tiny repeats like "ok" are not
 *      inflated). Dedupe keys on the FULL original content, before truncation.
 *   2. TRUNCATE — a string longer than the budget is pointer-ized to head+tail
 *      with a `[…N chars elided…]` marker in the middle (only when it nets
 *      savings). Codepoint-safe so a head/tail boundary never splits a
 *      surrogate pair (important for the CJK workload).
 *
 * Guarantees: pure (never mutates the input), preserves message ordering and
 * tool_use<->tool_result pairing (tool_use_id / is_error / cache_control kept,
 * nothing removed or reordered), and NEVER touches user/assistant text or
 * non-tool_result blocks. Array-form tool_result content (image/document) is
 * left as-is (out of scope). Returns the same reference when nothing changes.
 */
export function preTierPrefix(
  prefix: APIMessageParam[],
  cfg: Pick<CompactionConfig, 'preTier' | 'preTierMaxToolResultChars'>,
): APIMessageParam[] {
  if (!cfg.preTier) return prefix;
  const budget = cfg.preTierMaxToolResultChars;
  const seen = new Set<string>();
  let anyChanged = false;

  const out = prefix.map((msg) => {
    // Only messages carrying a string tool_result block are candidates. Every
    // other message (string content, genuine prompt, assistant text/tool_use)
    // passes through untouched by reference.
    if (typeof msg.content === 'string') return msg;
    const hasStringToolResult = msg.content.some(
      (b) => b.type === 'tool_result' && typeof b.content === 'string',
    );
    if (!hasStringToolResult) return msg;

    let msgChanged = false;
    const blocks = msg.content.map((block) => {
      if (block.type !== 'tool_result' || typeof block.content !== 'string') {
        return block;
      }
      const original = block.content;
      const shed = shedToolResultContent(original, budget, seen);
      if (shed === original) return block;
      msgChanged = true;
      // Rebuild the tool_result preserving pairing + flags; only content changes.
      const rebuilt: Extract<ContentBlockParam, { type: 'tool_result' }> = {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: shed,
      };
      if (block.is_error !== undefined) rebuilt.is_error = block.is_error;
      if (block.cache_control !== undefined) rebuilt.cache_control = block.cache_control;
      return rebuilt;
    });
    if (!msgChanged) return msg;
    anyChanged = true;
    return { role: msg.role, content: blocks };
  });

  return anyChanged ? out : prefix;
}

/**
 * Shed one string tool_result: dedupe against `seen` first (keying on the full
 * original), then truncate. Returns the original string when neither transform
 * nets savings (so callers can detect "unchanged" by reference equality).
 */
function shedToolResultContent(
  content: string,
  budget: number,
  seen: Set<string>,
): string {
  // 1. DEDUPE — identical to an earlier tool_result seen in prefix order.
  if (seen.has(content)) {
    const marker = `[…duplicate tool_result, ${content.length} chars elided…]`;
    // Net-savings guard: never inflate a tiny repeat.
    return marker.length < content.length ? marker : content;
  }
  seen.add(content);

  // 2. TRUNCATE — head+tail pointer-ization for oversized content.
  if (budget <= 0) return content;
  const chars = Array.from(content); // codepoint array: no split surrogate pairs
  if (chars.length <= budget) return content;
  const headLen = Math.ceil(budget / 2);
  const tailLen = budget - headLen;
  const elided = chars.length - headLen - tailLen;
  const marker = `[…${elided} chars elided…]`;
  // Net-savings guard: skip when the marker would not shrink the content.
  if (marker.length >= elided) return content;
  const head = chars.slice(0, headLen).join('');
  const tail = tailLen > 0 ? chars.slice(chars.length - tailLen).join('') : '';
  return head + marker + tail;
}

// ---------------------------------------------------------------------------
// Folds
// ---------------------------------------------------------------------------

/**
 * Deterministic structural fold: a length-2 user->assistant pair. The assistant
 * content is an explicitly-LABELED summary so the model is not misled into
 * thinking it authored prior claims verbatim. Offline, no model call.
 */
export function foldDeterministic(
  prefix: APIMessageParam[],
  customInstructions: string | null,
): APIMessageParam[] {
  return [
    { role: 'user', content: summaryUserContent(customInstructions) },
    { role: 'assistant', content: [{ type: 'text', text: buildRecap(prefix) }] },
  ];
}

async function foldViaApi(
  prefix: APIMessageParam[],
  deps: EngineDeps,
  config: EngineConfig,
  customInstructions: string | null,
  signal: AbortSignal,
  onSummaryCall: SummaryCallSink | undefined,
): Promise<APIMessageParam[]> {
  // Ordered assembly: structure -> what-to-preserve (security constraints) ->
  // output/tool discipline (no-tools guard) last -> user custom instructions.
  // SUMMARIZER_SYSTEM stays byte-identical; the guards live in their own
  // constants so the existing provenance/byte-golden tests are untouched.
  const system = [
    SUMMARIZER_SYSTEM,
    SUMMARIZER_VERBATIM_SAFETY_CLAUSE,
    SUMMARIZER_NO_TOOLS_GUARD,
    customInstructions ?? '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');
  // Summarization is cheap and mechanical: route it to compaction.model (e.g.
  // Haiku) when set, resolving a short alias, else the session model.
  const summaryModel = resolveModelAlias(config.compaction?.model, config.model);
  // C7 (BPT audit 2026-07-07): the prefix carries assistant turns whose thinking
  // blocks were signed by the SESSION model. This summary request routes to
  // summaryModel — deliberately a DIFFERENT model (e.g. Haiku) — which would 400
  // on the foreign signatures (previously caught + silently degraded to the
  // deterministic fold, so useApiSummary never worked with a distinct model).
  // The summary is mechanical and needs no thinking, so strip it unconditionally.
  const summaryPrefix = prefix.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content)
      ? {
          ...m,
          content: m.content.filter(
            (b) => b.type !== 'thinking' && b.type !== 'redacted_thinking',
          ),
        }
      : m,
  );
  const req: StreamRequest = {
    model: summaryModel,
    max_tokens: Math.min(4096, config.maxOutputTokens),
    system,
    messages: [
      ...summaryPrefix,
      { role: 'user', content: 'Summarize the conversation above per the instructions.' },
    ],
    signal,
  };
  const started = Date.now();
  try {
    const acc = new MessageAccumulator();
    for await (const ev of deps.transport.stream(req)) {
      if (signal.aborted) throw new AbortError();
      acc.feed(ev);
    }
    const final = acc.finalize();
    const apiMs = Date.now() - started;
    onSummaryCall?.(summaryModel, normalizeUsage(final.usage), apiMs);
    const rawSummary = final.content
      .filter((b): b is { type: 'text'; text: string; citations?: unknown[] | null } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    // Honor the no-tools guard's declared contract (<analysis> then <summary>):
    // prefer explicit <summary> content, else drop the <analysis> scratchpad.
    // Strict superset of the old tag-strip, so a plain-text reply is unchanged.
    const summaryText = extractSummaryFromReply(rawSummary);
    const text = summaryText.length > 0 ? summaryText : buildRecap(prefix);
    return [
      { role: 'user', content: summaryUserContent(customInstructions) },
      { role: 'assistant', content: [{ type: 'text', text }] },
    ];
  } catch (err) {
    // Never fall back on abort: propagate cancellation as AbortError.
    if (isAbortError(err)) throw err instanceof AbortError ? err : new AbortError();
    deps.debug(
      `compaction: summary API call failed, using deterministic fold: ${String(err)}`,
    );
    return foldDeterministic(prefix, customInstructions);
  }
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/**
 * Auto-compaction step: fire at the top of a loop iteration. No-op when the
 * estimate is below the trigger threshold.
 */
export async function* maybeAutoCompact(
  view: { messages: APIMessageParam[] },
  deps: EngineDeps,
  config: EngineConfig,
  overheadTokens: number,
  signal: AbortSignal,
  onSummaryCall?: SummaryCallSink,
): AsyncGenerator<SDKMessage, void> {
  const cfg = config.compaction;
  if (cfg === undefined) return;
  const window = windowFor(config, cfg);
  if (window <= config.maxOutputTokens) {
    // Compaction impossible (window cannot hold reserved output). Skip with a
    // warning instead of always-firing on a degenerate budget of 1.
    deps.debug(
      `compaction: context window (${window}) <= maxOutputTokens ` +
        `(${config.maxOutputTokens}); compaction impossible, skipping`,
    );
    return;
  }
  const trig = shouldAutoCompact(
    view.messages,
    overheadTokens,
    window,
    config.maxOutputTokens,
    cfg,
  );
  if (trig === null) return;
  yield* performCompaction(
    view,
    'auto',
    cfg.customInstructions ?? null,
    deps,
    config,
    overheadTokens,
    signal,
    onSummaryCall,
  );
}

/**
 * Manual `/compact` compaction: first drop the trailing command turn (it is
 * never sent to the model), then attempt the fold. Because performCompaction
 * produces a fresh spliced array, view.messages diverges from the full
 * `history` transcript, which keeps the command.
 */
export async function* runManualCompact(
  view: { messages: APIMessageParam[] },
  customInstructions: string | null,
  deps: EngineDeps,
  config: EngineConfig,
  overheadTokens: number,
  signal: AbortSignal,
  onSummaryCall?: SummaryCallSink,
): AsyncGenerator<SDKMessage, void> {
  const cfg = config.compaction;
  if (cfg === undefined) return;
  // Remove the trailing '/compact' command so it never reaches the model.
  view.messages.pop();
  const instr = customInstructions ?? cfg.customInstructions ?? null;
  yield* performCompaction(
    view,
    'manual',
    instr,
    deps,
    config,
    overheadTokens,
    signal,
    onSummaryCall,
  );
}

/** Shared compaction core: PreCompact hook -> partition -> fold -> boundary. */
async function* performCompaction(
  view: { messages: APIMessageParam[] },
  trigger: 'auto' | 'manual',
  customInstructions: string | null,
  deps: EngineDeps,
  config: EngineConfig,
  overheadTokens: number,
  signal: AbortSignal,
  onSummaryCall: SummaryCallSink | undefined,
): AsyncGenerator<SDKMessage, void> {
  if (signal.aborted) throw new AbortError();
  const cfg = config.compaction;
  if (cfg === undefined) return;

  const preTokens = estimateMessagesTokens(view.messages) + overheadTokens;
  let effectiveInstructions = customInstructions;

  // PreCompact hooks: may veto (continue:false) or contribute extra guidance.
  if (deps.hooks.hasHooks('PreCompact')) {
    const input: PreCompactHookInput = {
      session_id: config.sessionId,
      cwd: config.cwd,
      hook_event_name: 'PreCompact',
      trigger,
      custom_instructions: customInstructions,
    };
    const agg = await deps.hooks.run('PreCompact', input, undefined, trigger, signal);
    if (agg.continue === false) {
      deps.debug('PreCompact hook cancelled compaction');
      return; // hook veto: no boundary, view unchanged.
    }
    if (agg.additionalContext.length > 0) {
      const extra = agg.additionalContext.join('\n');
      effectiveInstructions =
        effectiveInstructions !== null && effectiveInstructions.length > 0
          ? effectiveInstructions + '\n' + extra
          : extra;
    }
  }

  const window = windowFor(config, cfg);
  if (window <= config.maxOutputTokens) {
    // Compaction impossible: the context window cannot even hold the reserved
    // output, so there is no positive input budget to fold toward. Skip (do
    // NOT compact) rather than clamp to a degenerate budget of 1 — that clamp
    // caused triggerAt=0 / minFoldTokens=0 always-fold churn.
    deps.debug(
      `compaction: context window (${window}) <= maxOutputTokens ` +
        `(${config.maxOutputTokens}); compaction impossible, skipping`,
    );
    return; // no boundary, no mutation.
  }
  const budget = window - config.maxOutputTokens;
  const part = partitionForCompaction(view.messages, budget, cfg);
  if (part === null) {
    deps.debug('compaction: nothing safe to fold');
    return; // no boundary, no mutation.
  }

  // Pre-tier (G1): shed tool_result bulk from the prefix BEFORE summarizing so
  // fewer tokens reach the fold. shedPrefix has the SAME length as part.prefix
  // (only tool_result CONTENT changes), so the boundary/count math below is
  // unchanged. The prefix is discarded and replaced by `synthetic` anyway, so
  // this only shrinks what the summarizer / recap SEE, never what persists.
  const shedPrefix = preTierPrefix(part.prefix, cfg);

  const synthetic = cfg.useApiSummary
    ? await foldViaApi(shedPrefix, deps, config, effectiveInstructions, signal, onSummaryCall)
    : foldDeterministic(shedPrefix, effectiveInstructions);

  // In-place front replacement keeps the query layer's reference valid.
  view.messages.splice(0, part.prefix.length, ...synthetic);

  const boundary: SDKCompactBoundaryMessage = {
    type: 'system',
    subtype: 'compact_boundary',
    uuid: randomUUID(),
    session_id: config.sessionId,
    compact_metadata: { trigger, pre_tokens: preTokens },
  };
  yield boundary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowFor(config: EngineConfig, cfg: CompactionConfig): number {
  return cfg.contextWindowTokens ?? contextWindowFor(config.model);
}

function summaryUserContent(customInstructions: string | null): string {
  return (
    SUMMARY_USER_PROMPT + (customInstructions ? ' ' + customInstructions : '')
  );
}

/** A genuine user turn = a real prompt, not a tool_result-only turn. */
function isGenuineUserTurn(msg: APIMessageParam): boolean {
  if (msg.role !== 'user') return false;
  if (typeof msg.content === 'string') return true;
  return !msg.content.some((b) => b.type === 'tool_result');
}

function countGenuineUserTurns(messages: APIMessageParam[]): number {
  let n = 0;
  for (const msg of messages) {
    if (isGenuineUserTurn(msg)) n += 1;
  }
  return n;
}

/** Plain text of a user turn, or null when the content has non-text blocks. */
function plainTextIfPureText(content: string | ContentBlockParam[]): string | null {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type !== 'text') return null;
    parts.push(block.text);
  }
  return parts.join('');
}

/** Structural, deterministic recap of the folded prefix (capped). */
function buildRecap(prefix: APIMessageParam[]): string {
  const lines: string[] = [
    `[Conversation summary — the earlier ${prefix.length} messages were compacted to save context.]`,
  ];
  for (const msg of prefix) {
    lines.push(...recapLines(msg));
  }
  const body = lines.join('\n');
  if (body.length <= RECAP_CHAR_CAP) return body;
  return body.slice(0, RECAP_CHAR_CAP) + '…[truncated]';
}

function recapLines(msg: APIMessageParam): string[] {
  if (msg.role === 'user') {
    if (isGenuineUserTurn(msg)) {
      return ['User: ' + firstChars(textOf(msg.content), RECAP_LINE_CHARS)];
    }
    // tool_result-only user turn
    const results = toolResults(msg.content);
    const anyError = results.some((r) => r.is_error === true);
    return [
      `Tool results: ${results.length} result(s)` + (anyError ? ' (some errors)' : ''),
    ];
  }
  // assistant
  const out: string[] = [];
  const text = textOf(msg.content).trim();
  if (text.length > 0) {
    out.push('Assistant: ' + firstChars(text, RECAP_LINE_CHARS));
  }
  const calls = toolUses(msg.content);
  if (calls.length > 0) {
    const names = calls.map((c) => c.name).join(', ');
    const args = calls
      .map((c) => firstChars(JSON.stringify(c.input), RECAP_ARGS_CHARS))
      .join(' | ');
    out.push('Assistant called: ' + names + (args ? ' — ' + args : ''));
  }
  if (out.length === 0) out.push('Assistant: (no textual content)');
  return out;
}

function textOf(content: string | ContentBlockParam[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is Extract<ContentBlockParam, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

function toolResults(
  content: string | ContentBlockParam[],
): Array<Extract<ContentBlockParam, { type: 'tool_result' }>> {
  if (typeof content === 'string') return [];
  return content.filter(
    (b): b is Extract<ContentBlockParam, { type: 'tool_result' }> =>
      b.type === 'tool_result',
  );
}

function toolUses(
  content: string | ContentBlockParam[],
): Array<Extract<ContentBlockParam, { type: 'tool_use' }>> {
  if (typeof content === 'string') return [];
  return content.filter(
    (b): b is Extract<ContentBlockParam, { type: 'tool_use' }> => b.type === 'tool_use',
  );
}

function firstChars(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
