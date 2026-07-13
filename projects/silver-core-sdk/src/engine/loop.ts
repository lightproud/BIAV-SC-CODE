/**
 * The agentic loop: stream one assistant turn, dispatch tool calls through
 * hooks + permission gate, feed results back, repeat until a natural stop,
 * a limit (maxTurns / maxBudgetUsd), or an error.
 */

import { randomUUID } from 'node:crypto';

import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  errorCodeOf,
  isAbortError,
} from '../errors.js';
import type {
  APIAssistantMessage,
  APIMessageParam,
  APIToolDefinitionParam,
  CallToolResult,
  ContentBlock,
  DocumentBlockParam,
  ImageBlockParam,
  JSONSchema,
  ModelUsage,
  NonNullableUsage,
  RawMessageStreamEvent,
  SDKMessage,
  SDKPermissionDeniedMessage,
  SDKResultMessage,
  SDKRunMetrics,
  SDKToolMetrics,
  SDKTransportHealth,
  SDKTurnMetrics,
  StopReason,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '../types.js';
import type {
  AggregatedHookResult,
  EngineConfig,
  EngineDeps,
  RetryInfo,
  StreamRequest,
  ToolResultPayload,
} from '../internal/contracts.js';
import { MessageAccumulator } from './accumulator.js';
import { addUsage, estimateCostUsd, normalizeUsage } from './pricing.js';
import { contextWindowFor } from './context-window.js';
import { createToolDispatcher, mkToolError, type ToolExecOutcome } from './tool-dispatch.js';
import { deriveSystemField } from './system-field.js';
import { supportsAdaptiveThinking } from './thinking-model.js';
import { estimateToolDefsTokens } from './tokens.js';
import {
  maybeAutoCompact,
  runManualCompact,
  detectManualCompact,
  wouldAutoCompact,
} from './compaction.js';
import {
  DEFAULT_STRUCTURED_OUTPUT_RETRIES,
  evaluateStructuredOutput,
} from './structured-output.js';
import { applyCacheControl } from './cache-control.js';
import { analyzeRequestComposition } from './prompt-composition.js';
import {
  protectedTurnIndex,
  signingModelOf,
  stampSigningModel,
  stripStaleThinking,
} from './thinking-provenance.js';

const DEFAULT_THINKING_BUDGET = 10_000;

/** Resilience P0-1: per-turn budget for replay-safe turn replays. Bounded and
 *  small on purpose — replays fight transient link faults (a cut socket, a
 *  zero-event stall), not systemic ones; a link that kills three attempts in
 *  a row needs the error surfaced, not a longer fuse. */
export const TURN_REPLAY_LIMIT = 2;
const REPLAY_BACKOFF_BASE_MS = 500;

/** Short exponential pause between turn replays; abortable. */
function replayBackoff(attempt: number, signal: AbortSignal): Promise<void> {
  const delay = REPLAY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    // Deliberately ref'd: an in-flight replay backoff IS active work. This
    // fires exactly when the connection just died — often the process's LAST
    // live handle — and an unref'd timer here drains the event loop, so a
    // plain-script consumer exits mid-recovery with Node's code 13 (unsettled
    // top-level await). Vitest's own handles masked this; the first LIVE eval
    // round (2026-07-12, run 29178257816) died on it. unref() belongs to idle
    // watchdogs and pooled sockets (stall-watchdog.ts, node-http.ts), never
    // to a pending retry.
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wrap any abort-shaped error into this SDK's AbortError. */
function toAbortError(err: unknown): AbortError {
  if (err instanceof AbortError) return err;
  const message =
    err instanceof Error ? err.message : 'The operation was aborted';
  return new AbortError(message);
}

/** Fallback-eligible API statuses: rate limit and server-side failures. */
function isFallbackStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Concatenated text of an assistant message's text blocks. */
function concatText(content: ContentBlock[]): string {
  let out = '';
  for (const block of content) {
    if (block.type === 'text') out += block.text;
  }
  return out;
}

/**
 * Drop content blocks the Messages API rejects in a persisted history: empty
 * text blocks. tool_use / thinking / redacted_thinking blocks are kept as-is.
 * An assistant message whose blocks are all empty text would make the NEXT
 * request (a follow-up turn or a resume) 400 with "content must not be empty".
 */
function nonEmptyContent(content: ContentBlock[]): ContentBlock[] {
  return content.filter((b) => (b.type === 'text' ? b.text.length > 0 : true));
}



/** Mutable holder for a stream attempt's usage-so-far (survives a throw). */
type UsageSink = { usage?: NonNullableUsage };

/**
 * Fold the usage carried by one raw stream event into the sink. Lets the loop
 * recover a FAILED attempt's partial usage (message_start input tokens, any
 * message_delta output tokens) before a fallback retry, so budget/cost totals
 * stay honest even though the attempt's accumulator output is discarded.
 */
function foldUsageEvent(sink: UsageSink, event: RawMessageStreamEvent): void {
  if (event.type === 'message_start') {
    sink.usage = normalizeUsage(event.message.usage);
  } else if (event.type === 'message_delta') {
    const base: NonNullableUsage = sink.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    const du = event.usage;
    sink.usage = {
      ...base,
      output_tokens: du.output_tokens ?? base.output_tokens,
      input_tokens:
        du.input_tokens !== undefined
          ? Math.max(base.input_tokens, du.input_tokens)
          : base.input_tokens,
    };
  }
}



/**
 * Run the agent loop over `history` (which already contains the new user
 * turn). Yields SDK messages; always finishes with exactly one result
 * message unless aborted (AbortError is rethrown for the query layer).
 */
export async function* runAgentLoop(
  history: APIMessageParam[],
  deps: EngineDeps,
  config: EngineConfig,
): AsyncGenerator<SDKMessage, void> {
  const startedAt = Date.now();
  const signal = deps.toolContext.signal;

  let durationApiMs = 0;
  let numTurns = 0;
  // Monotonic index across MessageDisplay emits (NEW-IN-DOCS incremental
  // protocol). We fire once per completed message, so this counts messages.
  let messageDisplayIndex = 0;
  let structuredRetries = 0;
  // Official Stop-hook block semantics (v0.39, /goal-gating primitive): true
  // once a Stop hook has blocked a stop in THIS loop, reported back on every
  // subsequent Stop hook input so a well-behaved hook can break the cycle.
  let stopHookActive = false;
  // E3: non-fatal stream-truncation notes for the terminal result's `errors`
  // (a truncated turn degrades gracefully; the note keeps the fault visible).
  const streamErrors: string[] = [];
  // Resilience P0-2: disconnect-taxonomy ledger for this run (metrics
  // `transportHealth`). Counted here at the loop level so request-phase
  // retries, salvages, and turn replays all land in ONE per-run ledger.
  const transportHealth: SDKTransportHealth = {
    networkRetries: 0,
    httpRetries: 0,
    emptyStreamRetries: 0,
    midStreamDrops: 0,
    idleStalls: 0,
    maxDurationAborts: 0,
    turnsSalvaged: 0,
    turnReplays: 0,
  };
  /** Classify a terminal stream failure into the taxonomy ledger. */
  const recordStreamFailure = (err: APIConnectionError): void => {
    if (err.code === 'stream_idle_timeout') transportHealth.idleStalls += 1;
    else if (err.code === 'stream_max_duration') transportHealth.maxDurationAborts += 1;
    else if (err.midStreamTruncation === true || err.turnReplaySafe === true) {
      transportHealth.midStreamDrops += 1;
    }
  };
  // E3: set when the CURRENT turn's assistant message was salvaged from a
  // truncated stream (per-attempt; consumed by the tool-dispatch decision -
  // official 2.1.201 acts on complete tool_use blocks even when the cut
  // landed before stop_reason arrived).
  let turnTruncated = false;
  // Last API stop_reason observed across the run; carried onto error results
  // (official surface: stop_reason is required on BOTH result arms). Null
  // until the first assistant turn completes.
  let lastStopReason: StopReason = null;
  let firstTokenAtMs: number | undefined; // wall-clock of the first content event
  let firstStreamStartMs: number | undefined; // apiStart of the stream that produced it
  // Real prompt size (usage input + cache read/creation) of the last billed
  // request: a hard floor for the compaction trigger's heuristic estimate
  // (audit 2026-07-10 P1-1/D). Cleared when a fold shrinks the view.
  let lastActualPromptTokens: number | undefined;
  let totalCostUsd = 0;
  let totalUsage: NonNullableUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const modelUsage: Record<string, ModelUsage> = {};
  // v0.3 budget instrumentation: per-turn + per-tool metrics.
  const perTurn: SDKTurnMetrics[] = [];
  const perTool = new Map<string, { calls: number; totalMs: number; errors: number }>();
  const recordTool = (name: string, ms: number, isError: boolean): void => {
    const e = perTool.get(name) ?? { calls: 0, totalMs: 0, errors: 0 };
    e.calls += 1;
    e.totalMs += ms;
    if (isError) e.errors += 1;
    perTool.set(name, e);
  };
  const buildMetrics = (): SDKRunMetrics => {
    const cacheable =
      totalUsage.input_tokens +
      totalUsage.cache_read_input_tokens +
      totalUsage.cache_creation_input_tokens;
    const cacheHitRatio =
      cacheable > 0 ? totalUsage.cache_read_input_tokens / cacheable : 0;
    const perToolArr: SDKToolMetrics[] = [...perTool.entries()].map(
      ([name, e]) => ({ name, calls: e.calls, totalMs: e.totalMs, errors: e.errors }),
    );
    const m: SDKRunMetrics = {
      numTurns,
      durationMs: Date.now() - startedAt,
      durationApiMs,
      usage: { ...totalUsage },
      totalCostUsd,
      cacheHitRatio,
      perTurn: perTurn.map((t) => ({ ...t, usage: { ...t.usage } })),
      perTool: perToolArr,
      modelUsage: Object.fromEntries(
        Object.entries(modelUsage).map(([k, v]) => [k, { ...v }]),
      ),
    };
    if (firstTokenAtMs !== undefined) m.ttftMs = firstTokenAtMs - startedAt;
    // P0-2: the disconnect ledger rides every result (all-zero = clean run).
    m.transportHealth = { ...transportHealth };
    // Memory spec R8: memory-operation counters ride the metrics whenever the
    // query enabled the memory system (root loop only).
    if (deps.memoryHealth !== undefined) m.memoryHealth = { ...deps.memoryHealth() };
    return m;
  };
  // Once a fallback retry fires the run stays on the fallback model; until then
  // each turn re-reads config.model (a shared mutable object) so a live
  // setModel() applies from the next assistant turn.
  let fallbackModel: string | undefined;
  // Memory spec R7: true once this compaction episode's flush turn has been
  // injected (or vetoed); re-armed after a fold actually happens, so exactly
  // one write opportunity precedes each fold.
  let memoryFlushInjected = false;

  // Request-message view: when the query layer supplies a shared, cross-turn
  // view we stream from it (compactable) and mirror our own appends into it;
  // `history` stays full + append-only for persistence + the query layer's
  // tool_result-user scan. Absent -> stream straight from `history` (v0.1).
  const reqMsgs: APIMessageParam[] = deps.requestView?.messages ?? history;
  const mirror = (turn: APIMessageParam): void => {
    if (deps.requestView !== undefined) deps.requestView.messages.push(turn);
  };

  // FORK support: expose the current parent context so the Agent tool can
  // EAGERLY snapshot it at spawn time (a shallow copy; the runtime owns any
  // sanitisation before seeding a fork child). query.ts builds a fresh
  // toolContext per turn, so there is no cross-turn leakage of this getter.
  deps.toolContext.getForkHistory = (): APIMessageParam[] => reqMsgs.slice();

  const baseHookFields = {
    session_id: config.sessionId,
    cwd: config.cwd,
    // Official BaseHookInput.transcript_path: this loop's own transcript path
    // (path-backed stores only; query.ts / the subagent runtime resolve it).
    ...(config.transcriptPath !== undefined
      ? { transcript_path: config.transcriptPath }
      : {}),
  };

  /** Time-to-first-token fields; empty when no content token ever arrived. */
  const ttftFields = (): { ttft_ms?: number; ttft_stream_ms?: number } => {
    if (firstTokenAtMs === undefined) return {};
    const out: { ttft_ms?: number; ttft_stream_ms?: number } = {
      ttft_ms: firstTokenAtMs - startedAt,
    };
    if (firstStreamStartMs !== undefined) {
      out.ttft_stream_ms = firstTokenAtMs - firstStreamStartMs;
    }
    return out;
  };

  /** Common fields shared by every result-message variant. */
  const resultBase = () => ({
    uuid: randomUUID(),
    session_id: config.sessionId,
    duration_ms: Date.now() - startedAt,
    duration_api_ms: durationApiMs,
    num_turns: numTurns,
    total_cost_usd: totalCostUsd,
    usage: { ...totalUsage },
    modelUsage: Object.fromEntries(
      Object.entries(modelUsage).map(([k, v]) => [k, { ...v }]),
    ),
    permission_denials: deps.permissions.denials(),
    metrics: buildMetrics(),
    ...ttftFields(),
    // E3: non-fatal truncation notes ride the terminal result (success
    // included) so a degraded turn stays observable without voiding the run.
    ...(streamErrors.length > 0 ? { errors: [...streamErrors] } : {}),
  });

  const errorResult = (
    subtype:
      | 'error_max_turns'
      | 'error_during_execution'
      | 'error_max_budget_usd'
      | 'error_max_structured_output_retries',
    errorMessage: string,
    apiErrorStatus?: number,
    // SM-乙b: stable machine code of the underlying SDK error (E6c), carried so
    // a SessionManager can classify a recoverable-vs-terminal API failure by
    // CODE rather than by parsing errorMessage. Absent for non-SDK / codeless
    // failures. Additive; does not touch the request wire.
    errorCode?: string,
  ): SDKResultMessage => ({
    type: 'result',
    subtype,
    is_error: true,
    errorMessage,
    // Official surface: stop_reason is required on the error arm too. Report
    // the last API stop_reason observed, or null when no turn completed.
    stop_reason: lastStopReason,
    ...(apiErrorStatus !== undefined ? { api_error_status: apiErrorStatus } : {}),
    ...(errorCode !== undefined ? { error_code: errorCode } : {}),
    ...resultBase(),
    // Official-surface parallel: the reference SDK reports error text as a
    // string[]. Placed AFTER the resultBase spread so the fatal message wins
    // the field, with any E3 truncation notes appended.
    errors: [errorMessage, ...streamErrors],
  });

  /** Fold one attempt's usage into the running totals + per-model ledger. */
  const recordUsage = (responseModel: string, usage: NonNullableUsage): void => {
    totalUsage = addUsage(totalUsage, usage);
    const cost = estimateCostUsd(responseModel, usage, config.cacheTtl, config.pricing);
    totalCostUsd += cost;
    // Add THIS loop's own spend to the shared family ceiling (root + every
    // subagent loop reference the same object), so the aggregate budget gate
    // below sees concurrent-child spend the parent's own totalCostUsd never
    // carries. Bumped once per billed attempt here — the single site all of
    // the loop's own cost flows through.
    if (deps.familyBudget !== undefined) deps.familyBudget.spentUsd += cost;
    const prev = modelUsage[responseModel];
    modelUsage[responseModel] = {
      inputTokens: (prev?.inputTokens ?? 0) + usage.input_tokens,
      outputTokens: (prev?.outputTokens ?? 0) + usage.output_tokens,
      cacheReadInputTokens:
        (prev?.cacheReadInputTokens ?? 0) + usage.cache_read_input_tokens,
      cacheCreationInputTokens:
        (prev?.cacheCreationInputTokens ?? 0) + usage.cache_creation_input_tokens,
      webSearchRequests: prev?.webSearchRequests ?? 0,
      costUSD: (prev?.costUSD ?? 0) + cost,
      // Official ModelUsage fields (T2-4): the static public window table
      // (an estimate, same provenance as the price table) and the ACTUAL
      // per-request max_tokens cap this engine sends for this model.
      contextWindow: contextWindowFor(responseModel),
      maxOutputTokens: config.maxOutputTokens,
    };
  };

  /**
   * The reason string when the budget is spent, else undefined. Checks the
   * per-loop self-cap FIRST (so a childless single loop reports the exact same
   * message it always did — the self path is byte-identical), then the shared
   * family ceiling (only reachable when concurrent subagent spend has pushed
   * the aggregate past the absolute cap). Consulted at every point the loop is
   * about to make ANOTHER billable API call.
   */
  const budgetStopReason = (): string | undefined => {
    if (config.maxBudgetUsd !== undefined && totalCostUsd > config.maxBudgetUsd) {
      return `Estimated cost $${totalCostUsd.toFixed(6)} exceeded maxBudgetUsd ($${config.maxBudgetUsd})`;
    }
    const fb = deps.familyBudget;
    if (fb !== undefined && fb.spentUsd > fb.capUsd) {
      return (
        `Estimated agent-tree cost $${fb.spentUsd.toFixed(6)} exceeded ` +
        `maxBudgetUsd ($${fb.capUsd}) across the subagent family`
      );
    }
    return undefined;
  };

  /**
   * Append the assistant turn to history, dropping empty text blocks first.
   * An all-empty assistant message is skipped entirely: persisting a
   * {role:'assistant',content:[]} turn would make the next request (a
   * follow-up turn or a resume) 400 with "content must not be empty".
   */
  const pushAssistant = (content: ContentBlock[], signingModel: string): void => {
    const filtered = nonEmptyContent(content);
    if (filtered.length === 0) {
      deps.debug(
        'engine: assistant message has no non-empty content blocks; ' +
          'skipping history push to keep the transcript API-valid',
      );
      return;
    }
    const turn: APIMessageParam = { role: 'assistant', content: filtered };
    // Record which model SIGNED this turn's thinking blocks, so a later
    // cross-model replay (fallback switch / resume to another model) strips the
    // now-unverifiable signatures instead of 400-ing forever (BPT 2026-07-07).
    stampSigningModel(turn, signingModel);
    history.push(turn);
    mirror(turn);
  };

  /** Tool defs are rebuilt once per TURN (loop iteration) so tool-search
   *  "load on demand" surfaces newly-loaded schemas per turn — for BOTH
   *  deferred MCP tools (via deps.mcp.allTools() filtering) and deferred COLD
   *  built-ins (via deps.isBuiltinDeferred). Loads only happen through tool
   *  execution BETWEEN turns, so one build per iteration (shared by the
   *  compaction estimate and every stream attempt of that turn, replay and
   *  fallback included) is equivalent to the previous per-attempt rebuild —
   *  minus the redundant allocations. A cold-and-unloaded built-in is skipped
   *  here so its schema is not written this turn; it reappears the turn after
   *  a ToolSearch load. Absent isBuiltinDeferred -> every built-in is inline
   *  (exact pre-unification behavior). */
  /** A tools[] entry with a missing/invalid input_schema (null, array,
   *  primitive — seen from lax MCP servers) makes the gateway reject the
   *  ENTIRE request (`tools.N.custom.input_schema: Field required`, BPT
   *  2026-07-13), killing every conversation that shares the tool list.
   *  Normalize such schemas to the safe empty-object schema and say so in
   *  the debug log, instead of letting one bad tool take the request down. */
  const normalizeInputSchema = (name: string, schema: unknown): JSONSchema => {
    if (typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
      return schema as JSONSchema;
    }
    deps.debug(
      `engine: tool "${name}" has ${
        schema === undefined || schema === null ? 'no input schema' : 'a non-object input schema'
      }; normalized to the empty object schema`,
    );
    return { type: 'object', properties: {} };
  };
  /** Server-declared typed entries are sent WITHOUT input_schema — only
   *  types the API defines server-side (e.g. memory_20250818) may do that.
   *  A `type:'custom'` (or type-less) entry is a misconfiguration: the API
   *  reads it as a custom tool and 400s the whole request on the missing
   *  input_schema, so it is skipped loudly rather than advertised. */
  const isValidServerTool = (st: { type: string; name: string }): boolean =>
    typeof st.type === 'string' && st.type.length > 0 && st.type !== 'custom';
  const buildToolDefs = (): APIToolDefinitionParam[] => {
    const defs: APIToolDefinitionParam[] = [];
    const serverToolEntries = (config.serverTools ?? []).filter((st) => {
      if (isValidServerTool(st)) return true;
      deps.debug(
        `engine: serverTools entry "${st.name}" (type ${JSON.stringify(st.type)}) ` +
          'is not a server-defined tool type and would be rejected as a custom ' +
          'tool without input_schema; entry skipped',
      );
      return false;
    });
    // Server-declared tool entries (config.serverTools, e.g. the native-mode
    // memory tool): the typed entry is advertised verbatim and a builtin of
    // the SAME name is skipped from schema advertisement — that builtin is
    // the execution loop for the server-declared tool, not a second
    // definition of it. Skipped-invalid entries do NOT suppress a builtin.
    const serverDeclared =
      serverToolEntries.length > 0
        ? new Set(serverToolEntries.map((t) => t.name))
        : undefined;
    for (const tool of deps.builtinTools.values()) {
      if (serverDeclared?.has(tool.name) === true) continue;
      if (deps.isBuiltinDeferred?.(tool.name) === true) continue;
      defs.push({
        name: tool.name,
        description: tool.description,
        input_schema: normalizeInputSchema(tool.name, tool.inputSchema),
      });
    }
    for (const entry of deps.mcp.allTools()) {
      defs.push({
        name: entry.qualifiedName,
        description: entry.description,
        input_schema: normalizeInputSchema(entry.qualifiedName, entry.inputSchema),
      });
    }
    for (const st of serverToolEntries) {
      defs.push({ type: st.type, name: st.name });
    }
    return defs;
  };
  // Thinking is recomputed PER TURN (not snapshotted before the loop) so a
  // mid-run setMaxThinkingTokens() — which mutates the shared config object —
  // takes effect on the next assistant sub-turn, mirroring the per-turn re-read
  // of config.model below (finding #12).
  const computeThinking = (): StreamRequest['thinking'] => {
    const t = config.thinking;
    if (t === undefined || t.type === 'disabled') {
      return undefined; // unset / explicitly disabled -> omit the param entirely
    }
    // Forward the caller's `display` ('summarized'|'omitted') sub-option onto
    // whichever wire form the model takes (P2 parity: was typed-not-populated).
    const display = t.display;
    // Resolve "thinking on?" + a fallback budget from either an adaptive or an
    // enabled config. `adaptive` carries no budget of its own; a budget only
    // matters when the live model is pre-adaptive (below) or as the on/off gate.
    const requested =
      (t.type === 'enabled'
        ? (t.budgetTokens ?? t.budget_tokens ?? t.budget)
        : undefined) ??
      config.maxThinkingTokens ??
      DEFAULT_THINKING_BUDGET;
    // A resolved budget of 0 (or less) means "thinking off": it lets a live
    // setMaxThinkingTokens(0) disable thinking mid-run (the preset default
    // injects its budget via maxThinkingTokens precisely so this works), and
    // the API would reject budget_tokens < 1024 anyway.
    if (requested <= 0) {
      return undefined;
    }
    // Model-aware wire form (root-cause fix for the v0.7 haiku 400 storm, run
    // 28753349435): `{type:'adaptive'}` is valid ONLY on 4.6+ models and
    // budget_tokens is REJECTED there; pre-4.6 models are the mirror image and
    // 400 on `adaptive`. Emit whichever form the LIVE model accepts, regardless
    // of which the caller/preset expressed. Recomputed per turn, so a mid-run
    // setModel() to a different generation is handled. See thinking-model.ts.
    if (supportsAdaptiveThinking(config.model)) {
      return { type: 'adaptive', ...(display !== undefined ? { display } : {}) };
    }
    // Pre-adaptive model: enabled + clamped budget. The Messages API requires
    // budget_tokens < max_tokens or it 400s; the default budget (10000) exceeds
    // the default max_tokens (8192), so clamp below max_tokens and warn.
    const ceiling = config.maxOutputTokens - 1;
    const budget_tokens = requested > ceiling ? ceiling : requested;
    if (budget_tokens < requested) {
      deps.debug(
        `engine: thinking budget_tokens ${requested} >= max_tokens ` +
          `${config.maxOutputTokens}; clamped to ${budget_tokens} to satisfy the API`,
      );
    }
    return {
      type: 'enabled',
      budget_tokens,
      ...(display !== undefined ? { display } : {}),
    };
  };

  // Per-request overhead folded into the compaction token estimate. The system
  // prompt term is static, but the tool-schema term is NOT: tool-search / lazy
  // MCP load rebuild buildToolDefs() each attempt (see its comment), so newly
  // loaded schemas must be re-counted per turn or the compaction trigger
  // under-counts the real request size (finding #11). Only the system-prompt
  // term is hoisted; the tool-def term is recomputed each iteration.
  // System-prompt term = stable prefix + volatile (cwd) tail, OR the caller's
  // segment blocks when present; all are sent every request, so all count
  // toward the compaction overhead estimate.
  const systemCharLen =
    config.systemBlocks !== undefined
      ? config.systemBlocks.reduce((n, b) => n + (b.text?.length ?? 0), 0)
      : (config.systemPrompt?.length ?? 0) + (config.systemPromptSuffix?.length ?? 0);
  const systemPromptTokens = Math.ceil(systemCharLen / 4);
  // Tool-def token estimate, cached by the tool-NAME set: the estimate walks
  // a JSON.stringify of every schema, and the def list only changes when the
  // advertised tool set changes (ToolSearch load / MCP setServers) — which
  // always changes the name set. Same-name schemas are static objects.
  let toolDefsEstimateKey: string | undefined;
  let toolDefsEstimate = 0;
  const currentOverheadTokens = (defs: APIToolDefinitionParam[]): number => {
    const key = defs.map((d) => d.name).join(' ');
    if (key !== toolDefsEstimateKey) {
      toolDefsEstimate = estimateToolDefsTokens(defs);
      toolDefsEstimateKey = key;
    }
    return toolDefsEstimate + systemPromptTokens;
  };

  /** One streaming attempt; yields partial events, returns the final message.
   *  `sink` (when given) captures usage seen so far so a FAILED attempt's
   *  tokens can be folded into totals before a fallback retry. */
  async function* streamAttempt(
    useModel: string,
    toolDefs: APIToolDefinitionParam[],
    sink?: UsageSink,
  ): AsyncGenerator<SDKMessage, APIAssistantMessage> {
    const accumulator = new MessageAccumulator();
    // Retry observability: the transport calls onRetry (in the request phase,
    // before any stream event) for each 429/5xx/network retry. We buffer a
    // rate_limit_event (429) / api_retry (else) per retry and yield them at the
    // top of the event loop, so they surface just before this attempt's stream.
    const retryMessages: SDKMessage[] = [];
    const onRetry = (info: RetryInfo): void => {
      // P0-2: count request-phase retries by disconnect-taxonomy class.
      if (info.kind === 'network') transportHealth.networkRetries += 1;
      else if (info.kind === 'empty_stream') transportHealth.emptyStreamRetries += 1;
      else if (info.kind === 'http_status' || info.status !== undefined) {
        transportHealth.httpRetries += 1;
      }
      const base = { uuid: randomUUID(), session_id: config.sessionId };
      if (info.status === 429) {
        retryMessages.push({
          type: 'rate_limit_event',
          ...base,
          // Official envelope (B2b): this 429 WAS a rejection; resetsAt is
          // derived from the server's real Retry-After when present. KD-12
          // trigger semantics unchanged (see the type's JSDoc).
          rate_limit_info: {
            status: 'rejected',
            ...(info.retryAfterMs !== undefined
              ? { resetsAt: Math.ceil((Date.now() + info.retryAfterMs) / 1000) }
              : {}),
          },
          // Deprecated dual-track flat fields, still populated.
          retry_after_ms: info.retryAfterMs ?? 0,
          limit_type: 'api',
        });
      } else {
        retryMessages.push({
          type: 'api_retry',
          ...base,
          attempt: info.attempt,
          max_retries: info.maxRetries,
          ...(info.status !== undefined ? { status: info.status } : {}),
          ...(info.errorType !== undefined ? { reason: info.errorType } : {}),
        });
      }
    };
    // System wire field: single interpretation point in engine/system-field.ts
    // (audit 2026-07-10 P2-2) — the assembly side lives in config-builder and
    // the pairing is pinned by tests/system-field.test.ts.
    const cachingOn = config.promptCaching === true;
    const derived = deriveSystemField(config);
    const request: StreamRequest = {
      model: useModel,
      max_tokens: config.maxOutputTokens,
      system: derived.system,
      // Strip cross-model thinking signatures from CLOSED history turns before
      // they replay (BPT 2026-07-07): same-model turns pass through untouched
      // (identity return -> cache intact); a fallback switch or a resume to a
      // different model would otherwise 400 forever on the stale signature.
      messages: stripStaleThinking(reqMsgs, useModel),
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      // tool_choice rides only when tools are actually advertised — the API
      // 400s on a tool_choice with no tools, so an empty tool set omits it.
      ...(config.toolChoice !== undefined && toolDefs.length > 0
        ? { tool_choice: config.toolChoice }
        : {}),
      // Native structured outputs (C9): forward the schema as the official
      // `output_config.format` ONLY when the caller opted in — the wire path is
      // supported-models-only and constrains the schema, so an unconditional
      // send would 400 elsewhere. Local validation still runs regardless (the
      // complement / fallback), so opting in never loses a constraint.
      ...(config.outputFormat?.native === true
        ? {
            output_config: {
              format: { type: 'json_schema' as const, schema: config.outputFormat.schema },
            },
          }
        : {}),
      thinking: computeThinking(),
      signal,
      onRetry,
    };
    // cache-control is the outermost request shaper; it never mutates `request`.
    const outgoing = applyCacheControl(request, {
      enabled: cachingOn,
      cacheTtl: config.cacheTtl,
      // Caller-authored segments already carry their own breakpoints; don't add
      // a message breakpoint too or the request could exceed the 4-cap.
      cacheMessages: !derived.callerBlocks,
      cacheSystemBoundary: derived.boundary,
    });
    // Prompt-composition observability (BPT-EXTENSION): describe the request the
    // SDK is about to send — its per-part token estimate (需求 A) and its
    // cache_control breakpoint map (需求 B) — computed from `outgoing` (the final
    // wire request) so the breakpoint walk reads the real markers. Read-only; the
    // request is unchanged. Off by default.
    if (config.includePromptComposition === true) {
      // 需求 A estimates the pre-cache `request` (matches the compaction口径);
      // 需求 B walks `outgoing` for the real cache_control markers.
      const { promptComposition, cacheBreakpoints } = analyzeRequestComposition(
        request,
        config.systemComposition,
        outgoing,
      );
      yield {
        type: 'system',
        subtype: 'prompt_composition',
        uuid: randomUUID(),
        session_id: config.sessionId,
        model: useModel,
        promptComposition,
        cacheBreakpoints,
      };
    }
    const apiStart = Date.now();
    turnTruncated = false;
    try {
      for await (const event of deps.transport.stream(outgoing)) {
        // Surface any retries that happened in the request phase (all buffered
        // before the first event) ahead of this attempt's stream.
        while (retryMessages.length > 0) yield retryMessages.shift()!;
        if (firstTokenAtMs === undefined && event.type === 'content_block_start') {
          firstTokenAtMs = Date.now();
          firstStreamStartMs = apiStart;
        }
        if (sink !== undefined) foldUsageEvent(sink, event);
        if (config.includePartialMessages) {
          yield {
            type: 'stream_event',
            uuid: randomUUID(),
            session_id: config.sessionId,
            event,
            parent_tool_use_id: config.parentToolUseId ?? null,
            // P2 parity: attach ttft once the first token has been latched
            // (same figure as the result's ttft_ms); absent on earlier events.
            ...(firstTokenAtMs !== undefined
              ? { ttft_ms: firstTokenAtMs - startedAt }
              : {}),
          };
        }
        accumulator.feed(event);
      }
    } catch (err) {
      // Retry observability on FAILURE (audit 2026-07-10 L2): when every retry
      // was exhausted and the attempt throws before its first stream event,
      // the buffered rate_limit_event / api_retry messages would otherwise
      // vanish — precisely the run where the retry log matters most. Drain
      // them here (not on caller aborts: the consumer is going away).
      if (!signal.aborted) {
        while (retryMessages.length > 0) yield retryMessages.shift()!;
      }
      // E3: graceful degradation for a truncated stream — a MID-STREAM
      // connection drop, the streamMaxDurationMs hard cap, or the fallback
      // body timeout (flagged by the transport; never an idle stall or caller
      // abort). Salvage the blocks the wire delivered whole instead of voiding
      // the turn - official 2.1.201 keeps the partial text and even executes
      // complete tool_use blocks (conformance run-l4 KD-L4-02/04). Nothing
      // salvageable (no message_start, zero whole blocks) falls through to the
      // error path, where the bounded turn replay (P0-1) picks it up.
      if (
        err instanceof APIConnectionError &&
        err.midStreamTruncation === true &&
        !signal.aborted &&
        config.salvageMode !== 'continue'
      ) {
        const salvaged = accumulator.salvageTruncated();
        if (salvaged !== undefined) {
          // P0-2: a salvaged truncation is a fault the run absorbed — classify
          // it (mid-stream drop / hard-cap abort) and count the salvage.
          recordStreamFailure(err);
          transportHealth.turnsSalvaged += 1;
          turnTruncated = true;
          streamErrors.push(err.message);
          deps.debug(
            `engine: truncated stream salvaged (${salvaged.content.length} ` +
              `whole block(s) kept): ${err.message}`,
          );
          return salvaged;
        }
      }
      throw err;
    } finally {
      durationApiMs += Date.now() - apiStart;
    }
    return accumulator.finalize();
  }

  // Tool dispatch pipeline extracted to engine/tool-dispatch.ts (audit
  // 2026-07-10 F5): hooks -> gate -> execute -> hooks, plus read-only
  // classification. Touches no streaming state — a per-run factory bound to
  // this loop's deps/hook fields/metrics recorder.
  const { isReadOnlyTool, executeToolUse } = createToolDispatcher({
    deps,
    sessionId: config.sessionId,
    baseHookFields,
    signal,
    recordTool,
    // S3 structured tool-call records: threaded from the query layer (root)
    // or the subagent runtime (children, parentToolUseId stamped).
    ...(deps.onToolRecord !== undefined ? { onToolRecord: deps.onToolRecord } : {}),
  });

  // v0.4: surface buffered task_* / hook_* lifecycle messages (the subagent
  // runtime and hook runner cannot yield) at the loop's message boundaries.
  // The query layer drains the same queue at its own yield points, so events
  // produced between engine turns are never stranded.
  function* drainObs(): Generator<SDKMessage> {
    if (deps.drainObservability === undefined) return;
    for (const msg of deps.drainObservability()) yield msg;
  }

  try {
    for (;;) {
      if (signal.aborted) throw new AbortError();
      yield* drainObs();

      // ONE tool-def build per turn, shared by the compaction estimate and
      // every stream attempt below (replay / fallback included) — the set can
      // only change between turns (tool execution), never mid-turn.
      const turnToolDefs = buildToolDefs();

      // --- Context compaction (only when a shared request view exists). -----
      if (deps.requestView !== undefined && config.compaction?.enabled !== false) {
        const cfg = config.compaction;
        // Recompute the tool-def overhead THIS turn so mid-run tool growth
        // (tool-search / lazy MCP load) is counted in the trigger (finding #11).
        const overheadTokens = currentOverheadTokens(turnToolDefs);
        const onSummaryCall = (
          m: string,
          u: NonNullableUsage,
          apiMs: number,
        ): void => {
          recordUsage(m, u);
          durationApiMs += apiMs;
        };
        if (cfg !== undefined) {
          const manual = cfg.recognizeCommand
            ? detectManualCompact(deps.requestView.messages, cfg)
            : null;
          if (manual !== null) {
            yield* runManualCompact(
              deps.requestView,
              manual.customInstructions,
              deps,
              config,
              overheadTokens,
              signal,
              onSummaryCall,
            );
            // Manual /compact consumes the turn (no model call): emit a success
            // result so the query layer advances to the next input.
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: '',
              stop_reason: 'end_turn',
              ...resultBase(),
            };
            return;
          }
          // Memory spec R7: when the auto trigger WOULD fire, first inject
          // ONE memory-write opportunity and fold on the following check, so
          // un-saved progress can reach the store before it is summarized
          // away. A PreCompact hook deny suppresses the flush AND this
          // iteration's fold (the fold's own hook run would veto it anyway).
          if (
            config.memoryFlush !== undefined &&
            !memoryFlushInjected &&
            wouldAutoCompact(deps.requestView, config, overheadTokens, lastActualPromptTokens)
          ) {
            memoryFlushInjected = true;
            let flushVetoed = false;
            if (deps.hooks.hasHooks('PreCompact')) {
              const agg = await deps.hooks.run(
                'PreCompact',
                {
                  ...baseHookFields,
                  hook_event_name: 'PreCompact',
                  trigger: 'auto',
                  custom_instructions: cfg.customInstructions ?? null,
                },
                undefined,
                'auto',
                signal,
              );
              if (agg.continue === false || agg.decision === 'deny') {
                flushVetoed = true;
                deps.debug('memory flush: PreCompact hook vetoed the write opportunity');
              }
            }
            if (!flushVetoed) {
              const flushTurn: APIMessageParam = {
                role: 'user',
                content: [{ type: 'text', text: config.memoryFlush.prompt }],
              };
              history.push(flushTurn);
              mirror(flushTurn);
              deps.debug('memory flush: injected pre-compaction write opportunity');
            }
          } else {
            const compacted = yield* maybeAutoCompact(
              deps.requestView,
              deps,
              config,
              overheadTokens,
              signal,
              onSummaryCall,
              lastActualPromptTokens,
            );
            // A fold shrank the view: the previous request's real prompt size
            // is no longer a valid floor for the (now smaller) context.
            if (compacted) {
              lastActualPromptTokens = undefined;
              // Re-arm the R7 flush for the next compaction episode.
              memoryFlushInjected = false;
            }
          }
        }
      }

      // Re-read the current model each turn so a mid-run setModel() takes
      // effect, unless a fallback has permanently switched us.
      let model = fallbackModel ?? config.model;

      // --- Stream one assistant turn (bounded replay + one-shot fallback). --
      let assistant: APIAssistantMessage;
      const apiMsBefore = durationApiMs; // for this turn's isolated apiMs metric
      // ttft anchors as of BEFORE this turn's first attempt. If the attempt
      // fails and we retry on the fallback model, the failed attempt's
      // content_block_start may have already latched firstTokenAtMs /
      // firstStreamStartMs; roll them back so ttft measures the attempt actually
      // delivered, not the discarded one (finding #13). On turn 1 these are
      // undefined so the fallback attempt latches fresh; on a later turn they
      // hold the run's real (earlier) first token, which must be preserved.
      const ttftTokenBefore = firstTokenAtMs;
      const ttftStreamBefore = firstStreamStartMs;
      // Resilience P0-1: bounded turn replay. A stream failure that consumed
      // NOTHING (turnReplaySafe: zero events / zero-event stall) or whose
      // partial delivery was fully DISCARDED (midStreamTruncation rethrown
      // here means salvage found no whole block) executed no tool and accepted
      // no content — re-issuing the turn cannot double-consume anything. The
      // commercial-agent "never disconnects" feel is exactly this layer: the
      // user sees a few seconds of retry, not a dead session. Budget is
      // per-turn; every replay is visible (api_retry message + ledger).
      let turnReplaysLeft = TURN_REPLAY_LIMIT;
      let firstSink: UsageSink = {};
      replay: for (;;) {
        firstSink = {};
        try {
          assistant = yield* streamAttempt(model, turnToolDefs, firstSink);
          break;
        } catch (err) {
          if (isAbortError(err)) throw toAbortError(err);
          if (
            err instanceof APIConnectionError &&
            !signal.aborted &&
            (err.turnReplaySafe === true || err.midStreamTruncation === true) &&
            turnReplaysLeft > 0
          ) {
            recordStreamFailure(err);
            turnReplaysLeft -= 1;
            transportHealth.turnReplays += 1;
            const replayN = TURN_REPLAY_LIMIT - turnReplaysLeft;
            // The doomed attempt may still have billed tokens (input tokens on
            // its message_start); fold them so cost totals stay honest.
            if (firstSink.usage !== undefined) recordUsage(model, firstSink.usage);
            firstTokenAtMs = ttftTokenBefore;
            firstStreamStartMs = ttftStreamBefore;
            deps.debug(
              `engine: replay-safe stream failure (${err.code}): ${err.message}; ` +
                `replaying turn (${replayN}/${TURN_REPLAY_LIMIT})`,
            );
            yield {
              type: 'api_retry',
              uuid: randomUUID(),
              session_id: config.sessionId,
              attempt: replayN,
              max_retries: TURN_REPLAY_LIMIT,
              reason: `turn_replay:${err.code}`,
            };
            await replayBackoff(replayN, signal);
            // A mid-run setModel()/latched fallback applies to the replay too.
            model = fallbackModel ?? config.model;
            continue replay;
          }
          // Terminal for this attempt: classify it for the ledger, then fall
          // through to the one-shot model fallback / the error path.
          if (err instanceof APIConnectionError) recordStreamFailure(err);
          if (
            config.fallbackModel !== undefined &&
            model !== config.fallbackModel &&
            err instanceof APIStatusError &&
            isFallbackStatus(err.status)
          ) {
            // §4 hard edge: if we are mid-tool-loop, the in-flight assistant turn
            // (its thinking is API-REQUIRED before its tool_use, so it can't be
            // stripped) was signed by the now-failing model. Retrying it on the
            // fallback model would 400 on its stale signature — trading one
            // failure for a worse, un-strippable one. Withhold the switch and
            // surface the ORIGINAL error instead: no invalid-signature 400 loop,
            // no double tool execution. (Auto-recovering read-only rewind-restart
            // is a scoped follow-up; clean-fail is the stable choice for now.)
            const protIdx = protectedTurnIndex(reqMsgs);
            if (protIdx >= 0 && signingModelOf(reqMsgs[protIdx]!) !== config.fallbackModel) {
              deps.debug(
                `engine: fallback to ${config.fallbackModel} withheld — the in-flight ` +
                  `tool-loop turn is signed by the failing model ${model} and its thinking ` +
                  `is API-required; surfacing the original error to avoid an invalid-signature 400`,
              );
              throw err;
            }
            deps.debug(
              `engine: model ${model} failed with status ${err.status}; retrying turn with fallback model ${config.fallbackModel}`,
            );
            // The failed attempt already burned tokens (at least the prompt's
            // input tokens reported on its message_start). Fold them into the
            // running totals so budget/cost reporting is not understated.
            if (firstSink.usage !== undefined) recordUsage(model, firstSink.usage);
            fallbackModel = config.fallbackModel; // stays switched for the rest of the run
            model = fallbackModel;
            // Discard any ttft the discarded attempt latched so the metric tracks
            // the fallback attempt actually returned to the consumer (finding #13).
            firstTokenAtMs = ttftTokenBefore;
            firstStreamStartMs = ttftStreamBefore;
            // The retry emits its OWN message_start; downstream consumers of
            // includePartialMessages must treat a fresh message_start as
            // superseding the discarded attempt's partial stream_events.
            // The fallback attempt gets its own usage sink: if IT fails too,
            // the tokens it burned (its message_start already billed the
            // prompt) must reach the totals the terminal error result reports,
            // exactly as the first attempt's sink was folded above. A caller
            // abort keeps the plain throw-through — no result is produced, so
            // there is no report to keep honest.
            const fallbackSink: UsageSink = {};
            try {
              assistant = yield* streamAttempt(model, turnToolDefs, fallbackSink);
            } catch (fallbackErr) {
              if (!isAbortError(fallbackErr) && fallbackSink.usage !== undefined) {
                recordUsage(model, fallbackSink.usage);
              }
              throw fallbackErr; // 2nd failure -> outer catch
            }
            break;
          }
          throw err;
        }
      }

      numTurns += 1;
      lastStopReason = assistant.stop_reason;

      // --- Yield assistant message + MessageDisplay hooks. ------------------
      const assistantUuid = randomUUID();
      yield {
        type: 'assistant',
        uuid: assistantUuid,
        session_id: config.sessionId,
        message: assistant,
        parent_tool_use_id: config.parentToolUseId ?? null,
      };
      const text = concatText(assistant.content);
      if (deps.hooks.hasHooks('MessageDisplay')) {
        // Non-blocking semantics: outcome only surfaces via debug logging.
        // NEW-IN-DOCS incremental protocol: this engine is NOT a true delta
        // stream — one emit per COMPLETED message, so final is always true and
        // delta carries the whole segment; index is monotonic across emits.
        const displayIndex = messageDisplayIndex++;
        const agg = await deps.hooks.run(
          'MessageDisplay',
          {
            ...baseHookFields,
            hook_event_name: 'MessageDisplay',
            turn_id: String(numTurns),
            message_id: assistant.id ?? assistantUuid,
            index: displayIndex,
            final: true,
            delta: text,
            message_text: text,
          },
          undefined,
          undefined,
          signal,
        );
        for (const m of agg.systemMessages) deps.debug(`MessageDisplay hook: ${m}`);
      }

      // --- Usage/cost tracking per response model. --------------------------
      recordUsage(assistant.model, normalizeUsage(assistant.usage));
      // Ground-truth prompt-size floor for the compaction trigger (audit
      // 2026-07-10 P1-1/D): input + cache read/creation is the REAL prompt
      // size of the request just billed — a hard lower bound on the current
      // context until a fold shrinks it (cleared there).
      {
        const u = assistant.usage;
        lastActualPromptTokens =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
      }

      // NOTE on budget placement: a turn that has just naturally ended
      // (end_turn / stop_sequence / etc.) must still yield its completed
      // answer as a success result even if its cost tipped the budget - the
      // money is already spent and there is nothing further to bill. But a
      // turn that REQUESTS TOOLS while the budget is already exceeded is
      // stopped BEFORE any tool executes (E5 below), matching official
      // 2.1.201 (conformance run-l2 s12: the official arm trips the cap
      // before the tool's side effects, same subtype and POST count).

      // --- Tool dispatch or natural end. -------------------------------------
      // E3: a salvaged truncated turn is actionable on its complete tool_use
      // blocks even when the cut landed before message_delta delivered
      // stop_reason (official 2.1.201 executes at either cut depth -
      // conformance run-l4 l4-sse-truncated-tool-incomplete).
      const toolUses =
        assistant.stop_reason === 'tool_use' || turnTruncated
          ? assistant.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
          : [];

      // v0.3: record this turn's isolated metrics (usage/cost/apiMs/toolCalls).
      {
        const turnUsage = normalizeUsage(assistant.usage);
        perTurn.push({
          index: numTurns - 1,
          model: assistant.model,
          usage: turnUsage,
          costUsd: estimateCostUsd(assistant.model, turnUsage, config.cacheTtl, config.pricing),
          apiMs: durationApiMs - apiMsBefore,
          stopReason: assistant.stop_reason,
          toolCalls: toolUses.length,
        });
      }
      // C5 (refusal, BPT audit 2026-07-07): a safety decline (Fable 5 / newer
      // models) returns stop_reason 'refusal' on a 200 with possibly-empty /
      // partial content. It is NOT a valid answer — surface a dedicated ERROR
      // result (never a success, so it can't be mistaken for a real reply nor
      // fed into the structured-output retry loop below). error_code 'refusal'
      // lets a host classify + opt into a fallback. Partial content is dropped.
      if (assistant.stop_reason === 'refusal') {
        // Apply the C6 orphan filter (as natural-end / structured-invalid /
        // bg-drain do): a refusal can carry a COMPLETED but unexecuted tool_use,
        // and persisting it unpaired 400s every later same-session request with
        // "tool_use ids without tool_result". Keep any text/thinking for context,
        // drop the orphan tool_use.
        pushAssistant(
          assistant.content.filter((b) => b.type !== 'tool_use'),
          assistant.model,
        );
        deps.debug('engine: model declined (stop_reason: refusal)');
        yield errorResult(
          'error_during_execution',
          'The model declined to respond (stop_reason: refusal).',
          undefined,
          'refusal',
        );
        return;
      }

      // C4 (pause_turn, BPT audit 2026-07-07): the API paused a long agentic /
      // server-tool turn. It is NOT complete — persist the partial assistant
      // content and RE-STREAM so the model continues it (no user turn appended,
      // no success emitted). The maxTurns guard bounds the continuation (this
      // for(;;) has no top-of-loop turn check, so a runaway pause loop would
      // otherwise never terminate).
      if (assistant.stop_reason === 'pause_turn') {
        pushAssistant(assistant.content, assistant.model);
        if (config.maxTurns !== undefined && numTurns >= config.maxTurns) {
          yield errorResult('error_max_turns', `Reached maxTurns limit (${config.maxTurns})`);
          return;
        }
        deps.debug('engine: turn paused (stop_reason: pause_turn); continuing the turn');
        continue;
      }

      // stop_reason tool_use but ZERO tool_use blocks (malformed / gateway-
      // rewritten response): treat as a natural end rather than pushing an
      // empty {role:'user',content:[]} turn that would poison the history.
      if (toolUses.length > 0) {
        // E5: budget pre-stop. The turn's cost was recorded above; if it
        // already exceeds maxBudgetUsd, the requested tools are NOT executed
        // (no side effects past the cap) and the run ends terminally. No
        // tool_result user turn is emitted - matching the official public
        // stream shape (assistant tool_use -> result/error_max_budget_usd);
        // the persisted trailing assistant tool_use is healed on resume by
        // the session store's repairPairing.
        const preToolBudgetStop = budgetStopReason();
        if (preToolBudgetStop !== undefined) {
          pushAssistant(assistant.content, assistant.model);
          deps.debug(
            `engine: budget pre-stop - ${toolUses.length} requested tool call(s) ` +
              `not executed (${preToolBudgetStop})`,
          );
          yield errorResult('error_max_budget_usd', preToolBudgetStop);
          return;
        }
        const results: ToolResultBlockParam[] = [];
        let batchStop: ToolExecOutcome['stop'];
        let batchDefer: ToolExecOutcome['defer'];
        // Execute in content order, but run a maximal run of >= 2 consecutive
        // read-only tools CONCURRENTLY (they have no side effects and are
        // order-independent). Non-read-only and lone read-only tools run
        // sequentially, exactly as before. Results stay in tool_use order (the
        // API pairs by id; history keeps them ordered). A stop/defer from any
        // executed tool suppresses all LATER tools with a "Not executed"
        // placeholder. "Read-only" covers builtins (readOnly flag) and MCP
        // tools whose server annotation sets readOnlyHint (isReadOnlyTool).
        const isReadOnly = (b: ToolUseBlock): boolean => isReadOnlyTool(b.name);
        let ti = 0;
        while (ti < toolUses.length) {
          if (batchStop !== undefined || batchDefer !== undefined) {
            // A prior block asked to stop/defer: every remaining tool_use still
            // needs a matching tool_result or the next API request would 400.
            results.push(
              mkToolError(
                toolUses[ti]!.id,
                `Not executed: ${batchStop?.reason ?? 'a prior tool call was deferred'}`,
              ),
            );
            ti += 1;
            continue;
          }
          let groupEnd = ti;
          while (groupEnd < toolUses.length && isReadOnly(toolUses[groupEnd]!)) groupEnd += 1;
          const outcomes: ToolExecOutcome[] =
            groupEnd - ti >= 2
              ? await Promise.all(toolUses.slice(ti, groupEnd).map((b) => executeToolUse(b)))
              : [await executeToolUse(toolUses[ti]!)];
          // Process outcomes in tool_use order. Once one stops/defers the run,
          // OVERRIDE the rest of this concurrent group with the skip marker so
          // the observable contract matches sequential execution: the group
          // already ran, but its members are read-only, so that was
          // side-effect-free. Later GROUPS are skipped by the outer guard.
          let stoppedInGroup = false;
          for (let g = 0; g < outcomes.length; g += 1) {
            if (stoppedInGroup) {
              results.push(
                mkToolError(
                  toolUses[ti + g]!.id,
                  `Not executed: ${batchStop?.reason ?? 'a prior tool call was deferred'}`,
                ),
              );
              continue;
            }
            const outcome = outcomes[g]!;
            // Surface observability (e.g. permission_denied) before the
            // tool_result is folded into the next turn.
            if (outcome.observability !== undefined) {
              for (const msg of outcome.observability) yield msg;
            }
            results.push(outcome.result);
            if (outcome.stop !== undefined) {
              batchStop = outcome.stop;
              stoppedInGroup = true;
            }
            if (outcome.defer !== undefined) {
              batchDefer = outcome.defer;
              stoppedInGroup = true;
            }
          }
          ti += outcomes.length;
          // Surface lifecycle events produced by the group just executed
          // (foreground subagent task_*, hook_started/hook_response) before
          // the next group runs.
          yield* drainObs();
        }
        pushAssistant(assistant.content, assistant.model);
        const userTurn: APIMessageParam = { role: 'user', content: results };
        history.push(userTurn);
        mirror(userTurn);

        // A deferred tool call ends this turn immediately (before the stop
        // terminal check, PostToolBatch, subagent drain, or compaction): the
        // query layer surfaces deferred_tool_use and awaits an external answer.
        if (batchDefer !== undefined) {
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: '',
            // Official defer protocol: consumers detect a deferred turn via
            // stop_reason === 'tool_deferred' + deferred_tool_use.
            stop_reason: 'tool_deferred',
            deferred_tool_use: batchDefer,
            ...resultBase(),
          };
          return;
        }

        // A permission interrupt or a PostToolUse continue:false terminates the
        // run after the batch is completed and recorded.
        if (batchStop !== undefined) {
          yield errorResult('error_during_execution', batchStop.reason);
          return;
        }

        if (deps.hooks.hasHooks('PostToolBatch')) {
          const batch = await deps.hooks.run(
            'PostToolBatch',
            {
              ...baseHookFields,
              hook_event_name: 'PostToolBatch',
              // Official field (P2): full tool_use blocks. `tool_names` rides
              // along deprecated for existing consumers.
              tool_calls: toolUses.map((b) => ({
                tool_name: b.name,
                tool_input: b.input,
                tool_use_id: b.id,
              })),
              tool_names: toolUses.map((b) => b.name),
            },
            undefined,
            undefined,
            signal,
          );
          for (const m of batch.systemMessages) deps.debug(`PostToolBatch hook: ${m}`);
        }

        // Append any completed background-subagent results as extra text blocks
        // on the tool_result user turn pushed just above, so the model sees them
        // on its next turn (background subagents run detached from this loop).
        if (deps.drainSubagentResults !== undefined) {
          const extra = deps.drainSubagentResults();
          if (extra.length > 0) {
            const lastTurn = history[history.length - 1];
            if (
              lastTurn !== undefined &&
              lastTurn.role === 'user' &&
              Array.isArray(lastTurn.content)
            ) {
              lastTurn.content.push(...extra);
            }
          }
        }

        if (config.maxTurns !== undefined && numTurns >= config.maxTurns) {
          yield errorResult(
            'error_max_turns',
            `Reached maxTurns limit (${config.maxTurns})`,
          );
          return;
        }
        // Budget gate: only fires when about to CONTINUE the loop with another
        // billable API call (a completed answer above is never voided here).
        const continueBudgetStop = budgetStopReason();
        if (continueBudgetStop !== undefined) {
          yield errorResult('error_max_budget_usd', continueBudgetStop);
          return;
        }
        continue;
      }

      // Structured-output gate: when a schema is required, validate the final
      // text before ending. On mismatch, push the invalid answer into history,
      // inject a corrective user turn, and continue the loop (bounded).
      let structuredValue: unknown;
      if (config.outputFormat !== undefined) {
        const outcome = evaluateStructuredOutput(text, config.outputFormat.schema);
        if (outcome.status === 'invalid') {
          // Keep the invalid answer in history — but apply the same C6 orphan
          // filter as the natural-end path below: a max_tokens cut mid-tool-use
          // leaves an unexecuted tool_use here, and persisting it unpaired
          // 400s EVERY later request of this query (audit 2026-07-10 P0-2).
          pushAssistant(
            assistant.content.filter((b) => b.type !== 'tool_use'),
            assistant.model,
          );
          const maxRetries =
            config.maxStructuredOutputRetries ?? DEFAULT_STRUCTURED_OUTPUT_RETRIES;
          if (structuredRetries >= maxRetries) {
            yield errorResult(
              'error_max_structured_output_retries',
              `Could not produce output matching the JSON schema after ` +
                `${maxRetries + 1} attempt(s): ${outcome.summary}`,
            );
            return;
          }
          structuredRetries += 1;
          // A retry is another billable assistant turn: honor the same caps as
          // the tool-continue path so structured retries cannot bust maxTurns/budget.
          if (config.maxTurns !== undefined && numTurns >= config.maxTurns) {
            yield errorResult('error_max_turns', `Reached maxTurns limit (${config.maxTurns})`);
            return;
          }
          const budgetStop = budgetStopReason();
          if (budgetStop !== undefined) {
            yield errorResult('error_max_budget_usd', budgetStop);
            return;
          }
          // Push the corrective turn to BOTH history (persistence + query scan)
          // and the request view (what the engine actually re-streams).
          const correctionTurn: APIMessageParam = {
            role: 'user',
            content: outcome.correction,
          };
          history.push(correctionTurn);
          mirror(correctionTurn);
          continue;
        }
        structuredValue = outcome.value;
      }

      // Background-subagent drain at NATURAL END (finding #4). A background
      // child that finished while this turn ran pushed its result note into the
      // runtime buffer. The tool_use branch drains it onto its tool_result turn,
      // but a natural-end turn has no such turn, so the note would be dropped and
      // the whole subagent output silently vanish. Surface it as a follow-up
      // user turn and CONTINUE the loop so the model can react to it, matching
      // the tool_use path's semantics.
      if (deps.drainSubagentResults !== undefined) {
        const extra = deps.drainSubagentResults();
        if (extra.length > 0) {
          // Keep this turn's answer in history — with the same C6 orphan filter
          // as the natural-end path (audit 2026-07-10 P0-2): this is a natural
          // end too, so any tool_use here is an unexecuted max_tokens orphan.
          pushAssistant(
            assistant.content.filter((b) => b.type !== 'tool_use'),
            assistant.model,
          );
          const bgTurn: APIMessageParam = { role: 'user', content: extra };
          history.push(bgTurn);
          mirror(bgTurn);
          // A follow-up assistant turn now becomes billable; honor the same caps
          // as the tool-continue / structured-retry paths so surfacing a drained
          // result cannot bust maxTurns / maxBudgetUsd.
          if (config.maxTurns !== undefined && numTurns >= config.maxTurns) {
            yield errorResult(
              'error_max_turns',
              `Reached maxTurns limit (${config.maxTurns})`,
            );
            return;
          }
          const budgetStop = budgetStopReason();
          if (budgetStop !== undefined) {
            yield errorResult('error_max_budget_usd', budgetStop);
            return;
          }
          continue;
        }
      }

      // Natural end: keep history complete for follow-up turns in the same
      // session, fire Stop hooks, emit the success result.
      // C6 (max_tokens mid-tool-use, BPT audit 2026-07-07): a natural-end turn
      // (end_turn / stop_sequence / max_tokens) should carry no actionable
      // tool_use — an actionable one would have set stop_reason 'tool_use' and
      // been dispatched above. A tool_use present here is an ORPHAN (typically a
      // max_tokens cut mid-tool-use) that was never executed; persisting it
      // unpaired 400s the next same-session request ("tool_use ids without
      // tool_result"). Drop such orphans from the PERSISTED turn (the yielded
      // assistant message already carried the raw content).
      const naturalEndContent = assistant.content.filter((b) => b.type !== 'tool_use');
      pushAssistant(naturalEndContent, assistant.model);
      if (deps.hooks.hasHooks('Stop')) {
        const stopAgg = await deps.hooks.run(
          'Stop',
          { ...baseHookFields, hook_event_name: 'Stop', stop_hook_active: stopHookActive },
          undefined,
          undefined,
          signal,
        );
        for (const m of stopAgg.systemMessages) deps.debug(`Stop hook: ${m}`);
        // Official Stop-hook block semantics (v0.39): a 'block' decision
        // PREVENTS the stop — the reason is fed back as a user turn and the
        // loop runs another assistant turn (the /goal goal-gating primitive).
        // `continue:false` forces the stop and WINS over block (official
        // precedence). ROOT LOOP ONLY: a subagent's natural end is governed
        // by SubagentStop (runtime-level), so a goal-gate registered on Stop
        // must not capture every child (parentToolUseId marks child loops).
        const isRootLoop =
          config.parentToolUseId === undefined || config.parentToolUseId === null;
        if (isRootLoop && stopAgg.continue && stopAgg.decision === 'deny') {
          const reason =
            stopAgg.decisionReason ?? 'Stop hook blocked stopping (no reason given)';
          deps.debug(`engine: Stop hook blocked the stop; continuing (${reason})`);
          stopHookActive = true;
          const blockTurn: APIMessageParam = { role: 'user', content: reason };
          history.push(blockTurn);
          mirror(blockTurn);
          // The forced follow-up assistant turn is billable: honor the same
          // caps as the tool-continue / structured-retry / bg-drain paths so a
          // stubborn Stop hook cannot bust maxTurns / maxBudgetUsd.
          if (config.maxTurns !== undefined && numTurns >= config.maxTurns) {
            yield errorResult(
              'error_max_turns',
              `Reached maxTurns limit (${config.maxTurns})`,
            );
            return;
          }
          const budgetStop = budgetStopReason();
          if (budgetStop !== undefined) {
            yield errorResult('error_max_budget_usd', budgetStop);
            return;
          }
          continue;
        }
      }
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: text,
        stop_reason: assistant.stop_reason,
        ...(config.outputFormat !== undefined ? { structured_output: structuredValue } : {}),
        ...resultBase(),
      };
      return;
    }
  } catch (err) {
    if (isAbortError(err)) throw toAbortError(err);
    const message = err instanceof Error ? err.message : String(err);
    deps.debug(`engine: error during execution: ${message}`);
    const apiStatus = err instanceof APIStatusError ? err.status : undefined;
    yield errorResult('error_during_execution', message, apiStatus, errorCodeOf(err));
    return;
  }
}
