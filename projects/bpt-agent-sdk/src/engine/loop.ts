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
  SDKMessage,
  SDKResultMessage,
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
  let totalCostUsd = 0;
  let totalUsage: NonNullableUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const modelUsage: Record<string, ModelUsage> = {};
  // Current model; permanently switched to fallbackModel after a fallback.
  let model = config.model;

  const baseHookFields = {
    session_id: config.sessionId,
    cwd: config.cwd,
  } as const;

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
  });

  const errorResult = (
    subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget',
    errorMessage: string,
  ): SDKResultMessage => ({
    type: 'result',
    subtype,
    is_error: true,
    errorMessage,
    ...resultBase(),
  });

  /** Static per-request pieces (tool defs and thinking do not change mid-run). */
  const toolDefs: APIToolDefinition[] = [];
  for (const tool of deps.builtinTools.values()) {
    toolDefs.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    });
  }
  for (const entry of deps.mcp.allTools()) {
    toolDefs.push({
      name: entry.qualifiedName,
      description: entry.description,
      input_schema: entry.inputSchema,
    });
  }
  const thinking: StreamRequest['thinking'] =
    config.thinking?.type === 'enabled'
      ? {
          type: 'enabled',
          budget_tokens:
            config.thinking.budget_tokens ??
            config.thinking.budget ??
            config.maxThinkingTokens ??
            DEFAULT_THINKING_BUDGET,
        }
      : undefined; // adaptive/disabled/unset -> omit the param entirely

  /** One streaming attempt; yields partial events, returns the final message. */
  async function* streamAttempt(
    useModel: string,
  ): AsyncGenerator<SDKMessage, APIAssistantMessage> {
    const accumulator = new MessageAccumulator();
    const request: StreamRequest = {
      model: useModel,
      max_tokens: config.maxOutputTokens,
      system: config.systemPrompt,
      messages: history,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      thinking,
      signal,
    };
    const apiStart = Date.now();
    try {
      for await (const event of deps.transport.stream(request)) {
        if (config.includePartialMessages) {
          yield {
            type: 'stream_event',
            uuid: randomUUID(),
            session_id: config.sessionId,
            event,
            parent_tool_use_id: null,
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
  async function executeToolUse(block: ToolUseBlock): Promise<ToolResultBlockParam> {
    const toolName = block.name;
    let input = block.input;

    const errorToolResult = (message: string): ToolResultBlockParam => ({
      type: 'tool_result',
      tool_use_id: block.id,
      content: message,
      is_error: true,
    });

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
        },
        block.id,
        toolName,
        signal,
      );
      for (const m of pre.systemMessages) deps.debug(`PreToolUse hook: ${m}`);
      if (!pre.continue) {
        return errorToolResult(
          pre.stopReason ?? `PreToolUse hook stopped execution of ${toolName}`,
        );
      }
    }

    // 2. Permission gate (hook decision folded in; gate records denials).
    const builtin = deps.builtinTools.get(toolName);
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
      return errorToolResult(check.message);
    }
    input = check.updatedInput;

    // 3. Execute: builtin -> MCP -> unknown.
    let payload: ToolResultPayload;
    try {
      if (builtin !== undefined) {
        payload = await builtin.execute(input, deps.toolContext);
      } else if (deps.mcp.has(toolName)) {
        payload = mapMcpResult(await deps.mcp.call(toolName, input, signal));
      } else {
        return errorToolResult(`No such tool: ${toolName}`);
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
          },
          block.id,
          toolName,
          signal,
        );
      }
      return errorToolResult(`Tool ${toolName} failed: ${message}`);
    }

    // 4. PostToolUse hooks (fires for completed calls, including isError
    //    payloads such as a non-zero Bash exit; only thrown errors go to
    //    PostToolUseFailure above).
    let content = payload.content;
    if (deps.hooks.hasHooks('PostToolUse')) {
      const post = await deps.hooks.run(
        'PostToolUse',
        {
          ...baseHookFields,
          hook_event_name: 'PostToolUse',
          tool_name: toolName,
          tool_input: input,
          tool_response: payload,
        },
        block.id,
        toolName,
        signal,
      );
      for (const m of post.systemMessages) deps.debug(`PostToolUse hook: ${m}`);
      if (post.updatedToolOutput !== undefined) {
        content =
          typeof post.updatedToolOutput === 'string'
            ? post.updatedToolOutput
            : JSON.stringify(post.updatedToolOutput);
      }
      content = appendContext(content, post.additionalContext);
    }

    const result: ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: block.id,
      content,
    };
    if (payload.isError === true) result.is_error = true;
    return result;
  }

  try {
    for (;;) {
      if (signal.aborted) throw new AbortError();

      // --- Stream one assistant turn (with one-shot fallback retry). -------
      let assistant: APIAssistantMessage;
      try {
        assistant = yield* streamAttempt(model);
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
          model = config.fallbackModel; // stays switched for the rest of the run
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
        parent_tool_use_id: null,
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
      const usage = normalizeUsage(assistant.usage);
      totalUsage = addUsage(totalUsage, usage);
      const cost = estimateCostUsd(assistant.model, usage);
      totalCostUsd += cost;
      const prev = modelUsage[assistant.model];
      modelUsage[assistant.model] = {
        inputTokens: (prev?.inputTokens ?? 0) + usage.input_tokens,
        outputTokens: (prev?.outputTokens ?? 0) + usage.output_tokens,
        cacheReadInputTokens:
          (prev?.cacheReadInputTokens ?? 0) + usage.cache_read_input_tokens,
        cacheCreationInputTokens:
          (prev?.cacheCreationInputTokens ?? 0) + usage.cache_creation_input_tokens,
        webSearchRequests: prev?.webSearchRequests ?? 0,
        costUSD: (prev?.costUSD ?? 0) + cost,
      };

      if (config.maxBudgetUsd !== undefined && totalCostUsd > config.maxBudgetUsd) {
        yield errorResult(
          'error_max_budget',
          `Estimated cost $${totalCostUsd.toFixed(6)} exceeded maxBudgetUsd ($${config.maxBudgetUsd})`,
        );
        return;
      }

      // --- Tool dispatch or natural end. -------------------------------------
      if (assistant.stop_reason === 'tool_use') {
        const toolUses = assistant.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        );
        const results: ToolResultBlockParam[] = [];
        for (const block of toolUses) {
          // Sequential, in content order.
          results.push(await executeToolUse(block));
        }
        history.push({ role: 'assistant', content: assistant.content });
        history.push({ role: 'user', content: results });

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

        if (config.maxTurns !== undefined && numTurns >= config.maxTurns) {
          yield errorResult(
            'error_max_turns',
            `Reached maxTurns limit (${config.maxTurns})`,
          );
          return;
        }
        continue;
      }

      // Natural end: keep history complete for follow-up turns in the same
      // session, fire Stop hooks, emit the success result.
      history.push({ role: 'assistant', content: assistant.content });
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
