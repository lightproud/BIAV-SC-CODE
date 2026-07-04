/**
 * The agentic loop: stream one assistant turn, dispatch tool calls through
 * hooks + permission gate, feed results back, repeat until a natural stop,
 * a limit (maxTurns / maxBudgetUsd), or an error.
 */

import { randomUUID } from 'node:crypto';

import { AbortError, APIStatusError, isAbortError } from '../errors.js';
import type {
  APIAssistantMessage,
  APIMessageParam,
  APIToolDefinition,
  CallToolResult,
  ContentBlock,
  ImageBlockParam,
  ModelUsage,
  NonNullableUsage,
  RawMessageStreamEvent,
  SDKMessage,
  SDKResultMessage,
  SDKRunMetrics,
  SDKToolMetrics,
  SDKTurnMetrics,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '../types.js';
import type {
  AggregatedHookResult,
  EngineConfig,
  EngineDeps,
  StreamRequest,
  ToolResultPayload,
} from '../internal/contracts.js';
import { MessageAccumulator } from './accumulator.js';
import { addUsage, estimateCostUsd, normalizeUsage } from './pricing.js';
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
  defer?: { tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> };
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
  return { content: parts.length > 0 ? parts : '', isError: res.isError === true };
}

/** Append hook additionalContext entries after existing tool_result content. */
function appendContext(
  content: string | Array<TextBlockParam | ImageBlockParam>,
  extra: string[],
): string | Array<TextBlockParam | ImageBlockParam> {
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
  let structuredRetries = 0;
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
  });

  const errorResult = (
    subtype:
      | 'error_max_turns'
      | 'error_during_execution'
      | 'error_max_budget_usd'
      | 'error_max_structured_output_retries',
    errorMessage: string,
  ): SDKResultMessage => ({
    type: 'result',
    subtype,
    is_error: true,
    errorMessage,
    ...resultBase(),
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
    if (config.thinking?.type !== 'enabled') {
      return undefined; // adaptive/disabled/unset -> omit the param entirely
    }
    const requested =
      config.thinking.budgetTokens ??
      config.thinking.budget_tokens ??
      config.thinking.budget ??
      config.maxThinkingTokens ??
      DEFAULT_THINKING_BUDGET;
    // The Messages API requires thinking.budget_tokens < max_tokens, otherwise
    // it 400s the request. The default budget (10000) exceeds the default
    // max_tokens (8192), so clamp the budget below max_tokens and warn.
    const ceiling = config.maxOutputTokens - 1;
    const budget_tokens = requested > ceiling ? ceiling : requested;
    if (budget_tokens < requested) {
      deps.debug(
        `engine: thinking budget_tokens ${requested} >= max_tokens ` +
          `${config.maxOutputTokens}; clamped to ${budget_tokens} to satisfy the API`,
      );
    }
    return { type: 'enabled', budget_tokens };
  };

  // Per-request overhead folded into the compaction token estimate. The system
  // prompt term is static, but the tool-schema term is NOT: tool-search / lazy
  // MCP load rebuild buildToolDefs() each attempt (see its comment), so newly
  // loaded schemas must be re-counted per turn or the compaction trigger
  // under-counts the real request size (finding #11). Only the system-prompt
  // term is hoisted; the tool-def term is recomputed each iteration.
  const systemPromptTokens = Math.ceil((config.systemPrompt?.length ?? 0) / 4);
  const currentOverheadTokens = (): number =>
    estimateToolDefsTokens(buildToolDefs()) + systemPromptTokens;

  // Static per-request overhead (system prompt + tool schemas) folded into the
  // compaction token estimate; both pieces are stable across the run.
  const overheadTokens =
    estimateToolDefsTokens(buildToolDefs()) +
    Math.ceil((config.systemPrompt?.length ?? 0) / 4);

  /** One streaming attempt; yields partial events, returns the final message.
   *  `sink` (when given) captures usage seen so far so a FAILED attempt's
   *  tokens can be folded into totals before a fallback retry. */
  async function* streamAttempt(
    useModel: string,
    sink?: UsageSink,
  ): AsyncGenerator<SDKMessage, APIAssistantMessage> {
    const accumulator = new MessageAccumulator();
    const toolDefs = buildToolDefs();
    const request: StreamRequest = {
      model: useModel,
      max_tokens: config.maxOutputTokens,
      system: config.systemPrompt,
      messages: reqMsgs,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      thinking: computeThinking(),
      signal,
    };
    // cache-control is the outermost request shaper; it never mutates `request`.
    const outgoing = applyCacheControl(request, {
      enabled: config.promptCaching === true,
      cacheMessages: true,
    });
    const apiStart = Date.now();
    try {
      for await (const event of deps.transport.stream(outgoing)) {
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
          };
        }
        accumulator.feed(event);
      }
    } finally {
      durationApiMs += Date.now() - apiStart;
    }
    return accumulator.finalize();
  }

  /** Full pipeline for one tool_use block: hooks -> gate -> execute -> hooks. */
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

    // 2. Permission gate (hook decision folded in; gate records denials).
    const check = await deps.permissions.check(toolName, input, {
      toolUseID: block.id,
      signal,
      readOnly: builtin?.readOnly ?? false,
      isFileEdit: builtin?.isFileEdit ?? false,
      hook:
        pre !== undefined &&
        (pre.decision !== undefined || pre.updatedInput !== undefined)
          ? {
              decision: pre.decision,
              reason: pre.decisionReason,
              updatedInput: pre.updatedInput,
            }
          : undefined,
      decisionReason: pre?.decisionReason,
    });
    if (check.decision === 'deny') {
      // interrupt:true (e.g. canUseTool returned behavior:'deny', interrupt)
      // means "deny AND stop the whole run", not just skip this call.
      if (check.interrupt === true) {
        return {
          result: errorToolResult(check.message),
          stop: { reason: check.message },
        };
      }
      return { result: errorToolResult(check.message) };
    }
    if (check.decision === 'skip') {
      // canUseTool returned null: the app is resolving this call out of band.
      // Emit a placeholder tool_result so the API turn stays valid; record NO denial.
      return { result: errorToolResult(check.message) };
    }
    if (check.decision === 'defer') {
      return {
        result: errorToolResult(check.message),
        defer: { tool_use_id: block.id, tool_name: toolName, tool_input: input },
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

  try {
    for (;;) {
      if (signal.aborted) throw new AbortError();

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

      // --- Yield assistant message + MessageDisplay hooks. ------------------
      yield {
        type: 'assistant',
        uuid: randomUUID(),
        session_id: config.sessionId,
        message: assistant,
        parent_tool_use_id: config.parentToolUseId ?? null,
      };
      const text = concatText(assistant.content);
      if (deps.hooks.hasHooks('MessageDisplay')) {
        // Non-blocking semantics: outcome only surfaces via debug logging.
        const agg = await deps.hooks.run(
          'MessageDisplay',
          { ...baseHookFields, hook_event_name: 'MessageDisplay', message_text: text },
          undefined,
          undefined,
          signal,
        );
        for (const m of agg.systemMessages) deps.debug(`MessageDisplay hook: ${m}`);
      }

      // --- Usage/cost tracking per response model. --------------------------
      recordUsage(assistant.model, normalizeUsage(assistant.usage));

      // NOTE: the maxBudgetUsd check is intentionally NOT here. A turn that has
      // just naturally ended (end_turn / stop_sequence / etc.) must still yield
      // its completed answer as a success result even if its cost tipped the
      // budget - the money is already spent and there is nothing further to
      // bill. The budget is enforced below, ONLY when about to CONTINUE the
      // loop with another (billable) API call.

      // --- Tool dispatch or natural end. -------------------------------------
      const toolUses =
        assistant.stop_reason === 'tool_use'
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
        const results: ToolResultBlockParam[] = [];
        let batchStop: ToolExecOutcome['stop'];
        let batchDefer: ToolExecOutcome['defer'];
        for (const block of toolUses) {
          if (batchStop !== undefined || batchDefer !== undefined) {
            // A prior block asked to stop/defer the run: do not execute the
            // rest, but every tool_use still needs a matching tool_result or the
            // next API request would 400.
            results.push(
              mkToolError(
                block.id,
                `Not executed: ${batchStop?.reason ?? 'a prior tool call was deferred'}`,
              ),
            );
            continue;
          }
          // Sequential, in content order.
          const outcome = await executeToolUse(block);
          results.push(outcome.result);
          if (outcome.stop !== undefined) batchStop = outcome.stop;
          if (outcome.defer !== undefined) batchDefer = outcome.defer;
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
            stop_reason: assistant.stop_reason,
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
    yield errorResult('error_during_execution', message);
    return;
  }
}
