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
  APIToolDefinition,
  CallToolResult,
  ContentBlock,
  DocumentBlockParam,
  ImageBlockParam,
  ModelUsage,
  NonNullableUsage,
  RawMessageStreamEvent,
  SDKMessage,
  SDKPermissionDeniedMessage,
  SDKResultMessage,
  SDKRunMetrics,
  SDKToolMetrics,
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
import { supportsAdaptiveThinking } from './thinking-model.js';
import { estimateToolDefsTokens } from './tokens.js';
import {
  maybeAutoCompact,
  runManualCompact,
  detectManualCompact,
} from './compaction.js';
import {
  DEFAULT_STRUCTURED_OUTPUT_RETRIES,
  evaluateStructuredOutput,
} from './structured-output.js';
import { applyCacheControl } from './cache-control.js';

const DEFAULT_THINKING_BUDGET = 10_000;

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

/** An error tool_result for a given tool_use id. */
function mkToolError(toolUseId: string, message: string): ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content: message, is_error: true };
}

/**
 * Outcome of one tool_use dispatch. `stop`, when set, means the whole run must
 * terminate after the current batch finishes (a permission deny with
 * interrupt:true, or a PostToolUse hook returning continue:false); the loop
 * fills the remaining blocks with error results and yields a terminal result.
 */
type ToolExecOutcome = {
  result: ToolResultBlockParam;
  stop?: { reason: string };
  defer?: {
    // Official field names (canonical) + legacy names, dual-track per T1-4.
    id: string;
    name: string;
    input: Record<string, unknown>;
    tool_use_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
  };
  /** Observability messages (e.g. permission_denied) to yield before the batch
   * continues. Sourced inside executeToolUse, which cannot yield itself. */
  observability?: SDKMessage[];
};

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

/** Map an MCP CallToolResult into a builtin-style tool result payload. */
function mapMcpResult(res: CallToolResult): ToolResultPayload {
  const parts: Array<TextBlockParam | ImageBlockParam> = [];
  for (const part of res.content) {
    switch (part.type) {
      case 'text':
        parts.push({ type: 'text', text: part.text });
        break;
      case 'image':
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: part.mimeType, data: part.data },
        });
        break;
      case 'audio':
        parts.push({ type: 'text', text: `[audio ${part.mimeType}]` });
        break;
      case 'resource_link':
        parts.push({
          type: 'text',
          text: part.name ? `[resource ${part.name}: ${part.uri}]` : `[resource ${part.uri}]`,
        });
        break;
      case 'resource':
        // Embedded resources are flattened to text (uri fallback).
        parts.push({ type: 'text', text: part.resource.text ?? part.resource.uri });
        break;
    }
  }
  // Surface a structuredContent payload as trailing JSON text so the model
  // can read it (the API tool_result carries no structured channel).
  if (res.structuredContent !== undefined) {
    try {
      parts.push({
        type: 'text',
        text: `[structuredContent] ${JSON.stringify(res.structuredContent)}`,
      });
    } catch {
      // Non-serializable payload: skip rather than throw.
    }
  }
  return { content: parts.length > 0 ? parts : '', isError: res.isError === true };
}

/** Append hook additionalContext entries after existing tool_result content. */
function appendContext(
  content: string | Array<TextBlockParam | ImageBlockParam | DocumentBlockParam>,
  extra: string[],
): string | Array<TextBlockParam | ImageBlockParam | DocumentBlockParam> {
  if (extra.length === 0) return content;
  if (typeof content === 'string') {
    return content.length > 0 ? `${content}\n${extra.join('\n')}` : extra.join('\n');
  }
  return [...content, ...extra.map((text): TextBlockParam => ({ type: 'text', text }))];
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
  // E3: non-fatal stream-truncation notes for the terminal result's `errors`
  // (a truncated turn degrades gracefully; the note keeps the fault visible).
  const streamErrors: string[] = [];
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
    return m;
  };
  // Once a fallback retry fires the run stays on the fallback model; until then
  // each turn re-reads config.model (a shared mutable object) so a live
  // setModel() applies from the next assistant turn.
  let fallbackModel: string | undefined;

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
  } as const;

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
    const cost = estimateCostUsd(responseModel, usage);
    totalCostUsd += cost;
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
   * Append the assistant turn to history, dropping empty text blocks first.
   * An all-empty assistant message is skipped entirely: persisting a
   * {role:'assistant',content:[]} turn would make the next request (a
   * follow-up turn or a resume) 400 with "content must not be empty".
   */
  const pushAssistant = (content: ContentBlock[]): void => {
    const filtered = nonEmptyContent(content);
    if (filtered.length === 0) {
      deps.debug(
        'engine: assistant message has no non-empty content blocks; ' +
          'skipping history push to keep the transcript API-valid',
      );
      return;
    }
    const turn: APIMessageParam = { role: 'assistant', content: filtered };
    history.push(turn);
    mirror(turn);
  };

  /** Built-in tool defs are static; MCP tool defs are rebuilt each attempt so
   *  tool-search "load on demand" surfaces newly-loaded schemas per turn. */
  const builtinToolDefs: APIToolDefinition[] = [];
  for (const tool of deps.builtinTools.values()) {
    builtinToolDefs.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    });
  }
  const buildToolDefs = (): APIToolDefinition[] => {
    const defs = [...builtinToolDefs];
    for (const entry of deps.mcp.allTools()) {
      defs.push({
        name: entry.qualifiedName,
        description: entry.description,
        input_schema: entry.inputSchema,
      });
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
  const currentOverheadTokens = (): number =>
    estimateToolDefsTokens(buildToolDefs()) + systemPromptTokens;

  // Static per-request overhead (system prompt + tool schemas) folded into the
  // compaction token estimate; both pieces are stable across the run.
  const overheadTokens =
    estimateToolDefsTokens(buildToolDefs()) + Math.ceil(systemCharLen / 4);

  /** One streaming attempt; yields partial events, returns the final message.
   *  `sink` (when given) captures usage seen so far so a FAILED attempt's
   *  tokens can be folded into totals before a fallback retry. */
  async function* streamAttempt(
    useModel: string,
    sink?: UsageSink,
  ): AsyncGenerator<SDKMessage, APIAssistantMessage> {
    const accumulator = new MessageAccumulator();
    const toolDefs = buildToolDefs();
    // Retry observability: the transport calls onRetry (in the request phase,
    // before any stream event) for each 429/5xx/network retry. We buffer a
    // rate_limit_event (429) / api_retry (else) per retry and yield them at the
    // top of the event loop, so they surface just before this attempt's stream.
    const retryMessages: SDKMessage[] = [];
    const onRetry = (info: RetryInfo): void => {
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
    // System prompt shapes:
    //  - Caller segments (config.systemBlocks): forwarded VERBATIM; the caller
    //    owns the blocks + their cache_control, so cache-control preserves them
    //    (and message caching is off to stay within the 4-breakpoint budget).
    //  - Otherwise, split into stable prefix + volatile (cwd) tail when caching
    //    is on so the breakpoint lands on the stable block and the cwd tail
    //    rides after it (cross-query reuse). Caching off -> flat single string.
    const cachingOn = config.promptCaching === true;
    const callerBlocks = config.systemBlocks;
    const hasSuffix =
      config.systemPromptSuffix !== undefined && config.systemPromptSuffix.length > 0;
    const splitSystem = cachingOn && hasSuffix && callerBlocks === undefined;
    // Dual-split: when the stable prompt has a [base harness | project tail]
    // boundary, emit a THREE-block [base, project, cwd] system so the shared
    // base and the per-project tail cache as two reusable segments (the 4th
    // breakpoint). The strict 0 < baseLen < length guard degrades cleanly to
    // the old [stable, cwd] layout (and protects against a stale/oversized
    // offset from any caller).
    const baseLen = config.systemPromptBaseLen;
    const hasProjectTail =
      baseLen !== undefined && baseLen > 0 && baseLen < config.systemPrompt.length;
    const dualSplit = splitSystem && hasProjectTail;
    const systemField: string | TextBlockParam[] =
      callerBlocks !== undefined
        ? callerBlocks
        : dualSplit
          ? [
              { type: 'text', text: config.systemPrompt.slice(0, baseLen) },
              { type: 'text', text: config.systemPrompt.slice(baseLen) },
              { type: 'text', text: config.systemPromptSuffix! },
            ]
          : splitSystem
            ? [
                { type: 'text', text: config.systemPrompt },
                { type: 'text', text: config.systemPromptSuffix! },
              ]
            : hasSuffix
              ? `${config.systemPrompt}\n${config.systemPromptSuffix}`
              : config.systemPrompt;
    const request: StreamRequest = {
      model: useModel,
      max_tokens: config.maxOutputTokens,
      system: systemField,
      messages: reqMsgs,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
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
      cacheMessages: callerBlocks === undefined,
      cacheSystemBoundary:
        callerBlocks !== undefined
          ? 'preserve'
          : dualSplit
            ? 'dual'
            : splitSystem
              ? 'first'
              : 'last',
    });
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
      // E3: graceful degradation for a MID-STREAM connection drop (flagged by
      // the transport; never a timeout/idle/abort). Salvage the blocks the
      // wire delivered whole instead of voiding the turn - official 2.1.201
      // keeps the partial text and even executes complete tool_use blocks
      // (conformance run-l4 KD-L4-02/04). Nothing salvageable (no
      // message_start, zero whole blocks) falls through to the error path.
      if (
        err instanceof APIConnectionError &&
        err.midStreamTruncation === true &&
        !signal.aborted
      ) {
        const salvaged = accumulator.salvageTruncated();
        if (salvaged !== undefined) {
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

  /** Full pipeline for one tool_use block: hooks -> gate -> execute -> hooks. */
  /** A tool is read-only if a builtin flags it, or a connected MCP tool's
   * server annotation sets readOnlyHint. Feeds the gate's auto-approve
   * (default/plan/acceptEdits read-only allow) and parallel grouping. */
  const isReadOnlyTool = (name: string): boolean => {
    const builtin = deps.builtinTools.get(name);
    if (builtin !== undefined) return builtin.readOnly === true;
    return deps.mcp
      .allTools()
      .some((t) => t.qualifiedName === name && t.annotations?.readOnlyHint === true);
  };

  async function executeToolUse(block: ToolUseBlock): Promise<ToolExecOutcome> {
    const toolName = block.name;
    let input = block.input;

    const errorToolResult = (message: string): ToolResultBlockParam =>
      mkToolError(block.id, message);

    // 0. Existence check FIRST. A hallucinated tool name is a "No such tool"
    //    error, NOT a permission denial: running unknown names through the
    //    hooks + gate would mislabel them as denials and pollute the denial
    //    ledger (and could even prompt the user to authorize a nonexistent
    //    tool). Only real tools reach the hook/permission pipeline below.
    const builtin = deps.builtinTools.get(toolName);
    if (builtin === undefined && !deps.mcp.has(toolName)) {
      return { result: errorToolResult(`No such tool: ${toolName}`) };
    }

    // 1. PreToolUse hooks. continue:false is conservatively a deny for this call.
    let pre: AggregatedHookResult | undefined;
    if (deps.hooks.hasHooks('PreToolUse')) {
      pre = await deps.hooks.run(
        'PreToolUse',
        {
          ...baseHookFields,
          hook_event_name: 'PreToolUse',
          tool_name: toolName,
          tool_input: input,
          tool_use_id: block.id,
        },
        block.id,
        toolName,
        signal,
      );
      for (const m of pre.systemMessages) deps.debug(`PreToolUse hook: ${m}`);
      if (!pre.continue) {
        // PreToolUse continue:false is (per ARCHITECTURE) a deny-and-continue
        // for THIS call only; it does not terminate the whole run.
        return {
          result: errorToolResult(
            pre.stopReason ?? `PreToolUse hook stopped execution of ${toolName}`,
          ),
        };
      }
    }

    // v0.6 G-SANDBOX: a Bash call requesting `dangerouslyDisableSandbox` under
    // an active, escape-allowing sandbox must be gated as its OWN ask (see
    // gate.check.sandboxEscape). Mandatory mode (allowEscape false) is refused
    // inside the Bash tool, so it is not flagged here.
    const sbx = deps.toolContext.sandbox;
    const sandboxEscape =
      toolName === 'Bash' &&
      input['dangerouslyDisableSandbox'] === true &&
      sbx !== undefined &&
      sbx.allowEscape;

    // 2. Permission gate (hook decision folded in; gate records denials).
    const check = await deps.permissions.check(toolName, input, {
      toolUseID: block.id,
      signal,
      readOnly: isReadOnlyTool(toolName),
      isFileEdit: builtin?.isFileEdit ?? false,
      sandboxEscape,
      decisionReason: sandboxEscape
        ? 'dangerouslyDisableSandbox requested (command will run OUTSIDE the sandbox)'
        : pre?.decisionReason,
      hook:
        pre !== undefined &&
        (pre.decision !== undefined || pre.updatedInput !== undefined)
          ? {
              decision: pre.decision,
              reason: pre.decisionReason,
              updatedInput: pre.updatedInput,
            }
          : undefined,
    });
    if (check.decision === 'deny') {
      // Surface a permission_denied observability message (task #16) alongside
      // the tool_result. blocker: a canUseTool interrupt is the only source we
      // can distinguish at this seam; rule/mode/hook denials carry their detail
      // in `reason`, so blocker is left off rather than guessed.
      const denied: SDKPermissionDeniedMessage = {
        type: 'permission_denied',
        uuid: randomUUID(),
        session_id: config.sessionId,
        tool_name: toolName,
        tool_use_id: block.id,
        reason: check.message,
        ...(check.interrupt === true ? { blocker: 'canUseTool' as const } : {}),
      };
      // interrupt:true (e.g. canUseTool returned behavior:'deny', interrupt)
      // means "deny AND stop the whole run", not just skip this call.
      if (check.interrupt === true) {
        return {
          result: errorToolResult(check.message),
          stop: { reason: check.message },
          observability: [denied],
        };
      }
      return { result: errorToolResult(check.message), observability: [denied] };
    }
    if (check.decision === 'skip') {
      // canUseTool returned null: the app is resolving this call out of band.
      // Emit a placeholder tool_result so the API turn stays valid; record NO denial.
      return { result: errorToolResult(check.message) };
    }
    if (check.decision === 'defer') {
      return {
        result: errorToolResult(check.message),
        defer: {
          id: block.id,
          name: toolName,
          input,
          tool_use_id: block.id,
          tool_name: toolName,
          tool_input: input,
        },
      };
    }
    input = check.updatedInput; // union now narrows to {decision:'allow'; updatedInput}

    // 3. Execute: builtin -> MCP. Existence was verified at step 0, so exactly
    //    one branch runs; the final else is an unreachable safety net.
    const execStart = Date.now();
    let payload: ToolResultPayload;
    try {
      if (builtin !== undefined) {
        payload = await builtin.execute(input, deps.toolContext);
      } else if (deps.mcp.has(toolName)) {
        payload = mapMcpResult(await deps.mcp.call(toolName, input, signal));
      } else {
        return { result: errorToolResult(`No such tool: ${toolName}`) };
      }
    } catch (err) {
      if (isAbortError(err)) throw toAbortError(err);
      const message = err instanceof Error ? err.message : String(err);
      if (deps.hooks.hasHooks('PostToolUseFailure')) {
        await deps.hooks.run(
          'PostToolUseFailure',
          {
            ...baseHookFields,
            hook_event_name: 'PostToolUseFailure',
            tool_name: toolName,
            tool_input: input,
            error: message,
            tool_use_id: block.id,
            duration_ms: Date.now() - execStart,
          },
          block.id,
          toolName,
          signal,
        );
      }
      recordTool(toolName, Date.now() - execStart, true);
      return { result: errorToolResult(`Tool ${toolName} failed: ${message}`) };
    }
    const durationMs = Date.now() - execStart;
    recordTool(toolName, durationMs, payload.isError === true);

    // 4. PostToolUse hooks (fires for completed calls, including isError
    //    payloads such as a non-zero Bash exit; only thrown errors go to
    //    PostToolUseFailure above).
    let content = payload.content;
    let stop: ToolExecOutcome['stop'];
    if (deps.hooks.hasHooks('PostToolUse')) {
      const post = await deps.hooks.run(
        'PostToolUse',
        {
          ...baseHookFields,
          hook_event_name: 'PostToolUse',
          tool_name: toolName,
          tool_input: input,
          tool_response: payload,
          tool_use_id: block.id,
          duration_ms: durationMs,
        },
        block.id,
        toolName,
        signal,
      );
      for (const m of post.systemMessages) deps.debug(`PostToolUse hook: ${m}`);
      if (post.updatedToolOutput !== undefined) {
        if (typeof post.updatedToolOutput === 'string') {
          content = post.updatedToolOutput;
        } else {
          // A hook may hand back a non-serializable object (e.g. a circular
          // internal state). Never let one hook's bad output crash the run:
          // keep the original tool output and warn.
          try {
            content = JSON.stringify(post.updatedToolOutput);
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            deps.debug(
              `engine: PostToolUse updatedToolOutput is not JSON-serializable ` +
                `(${why}); keeping the original tool output`,
            );
          }
        }
      }
      content = appendContext(content, post.additionalContext);
      // types.ts documents continue:false as "the agent stops after this hook".
      if (post.continue === false) {
        stop = {
          reason:
            post.stopReason ?? `PostToolUse hook stopped execution after ${toolName}`,
        };
      }
    }

    const result: ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: block.id,
      content,
    };
    if (payload.isError === true) result.is_error = true;
    return { result, stop };
  }

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

      // --- Context compaction (only when a shared request view exists). -----
      if (deps.requestView !== undefined && config.compaction?.enabled !== false) {
        const cfg = config.compaction;
        // Recompute the tool-def overhead THIS turn so mid-run tool growth
        // (tool-search / lazy MCP load) is counted in the trigger (finding #11).
        const overheadTokens = currentOverheadTokens();
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
          yield* maybeAutoCompact(
            deps.requestView,
            deps,
            config,
            overheadTokens,
            signal,
            onSummaryCall,
          );
        }
      }

      // Re-read the current model each turn so a mid-run setModel() takes
      // effect, unless a fallback has permanently switched us.
      let model = fallbackModel ?? config.model;

      // --- Stream one assistant turn (with one-shot fallback retry). -------
      let assistant: APIAssistantMessage;
      const firstSink: UsageSink = {};
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
      try {
        assistant = yield* streamAttempt(model, firstSink);
      } catch (err) {
        if (isAbortError(err)) throw toAbortError(err);
        if (
          config.fallbackModel !== undefined &&
          model !== config.fallbackModel &&
          err instanceof APIStatusError &&
          isFallbackStatus(err.status)
        ) {
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
          assistant = yield* streamAttempt(model); // 2nd failure -> outer catch
        } else {
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
          costUsd: estimateCostUsd(assistant.model, turnUsage),
          apiMs: durationApiMs - apiMsBefore,
          stopReason: assistant.stop_reason,
          toolCalls: toolUses.length,
        });
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
        if (config.maxBudgetUsd !== undefined && totalCostUsd > config.maxBudgetUsd) {
          pushAssistant(assistant.content);
          deps.debug(
            `engine: budget pre-stop - ${toolUses.length} requested tool call(s) ` +
              `not executed (estimated cost $${totalCostUsd.toFixed(6)} > ` +
              `maxBudgetUsd $${config.maxBudgetUsd})`,
          );
          yield errorResult(
            'error_max_budget_usd',
            `Estimated cost $${totalCostUsd.toFixed(6)} exceeded maxBudgetUsd ($${config.maxBudgetUsd})`,
          );
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
        pushAssistant(assistant.content);
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
        if (config.maxBudgetUsd !== undefined && totalCostUsd > config.maxBudgetUsd) {
          yield errorResult(
            'error_max_budget_usd',
            `Estimated cost $${totalCostUsd.toFixed(6)} exceeded maxBudgetUsd ($${config.maxBudgetUsd})`,
          );
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
          pushAssistant(assistant.content); // keep the invalid answer in history
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
          if (config.maxBudgetUsd !== undefined && totalCostUsd > config.maxBudgetUsd) {
            yield errorResult(
              'error_max_budget_usd',
              `Estimated cost $${totalCostUsd.toFixed(6)} exceeded maxBudgetUsd ($${config.maxBudgetUsd})`,
            );
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
          pushAssistant(assistant.content); // keep this turn's answer in history
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
          if (config.maxBudgetUsd !== undefined && totalCostUsd > config.maxBudgetUsd) {
            yield errorResult(
              'error_max_budget_usd',
              `Estimated cost $${totalCostUsd.toFixed(6)} exceeded maxBudgetUsd ($${config.maxBudgetUsd})`,
            );
            return;
          }
          continue;
        }
      }

      // Natural end: keep history complete for follow-up turns in the same
      // session, fire Stop hooks, emit the success result.
      pushAssistant(assistant.content);
      if (deps.hooks.hasHooks('Stop')) {
        const stopAgg = await deps.hooks.run(
          'Stop',
          { ...baseHookFields, hook_event_name: 'Stop', stop_hook_active: false },
          undefined,
          undefined,
          signal,
        );
        for (const m of stopAgg.systemMessages) deps.debug(`Stop hook: ${m}`);
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
