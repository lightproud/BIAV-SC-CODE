/**
 * Tool dispatch pipeline (extracted from engine/loop.ts, audit 2026-07-10 F5).
 *
 * Full pipeline for one tool_use block: existence check -> PreToolUse hooks ->
 * permission gate (hook decision folded in) -> execute (builtin or MCP) ->
 * PostToolUse / PostToolUseFailure hooks. Plus the read-only classification
 * that feeds the gate's auto-approve and the loop's parallel grouping.
 *
 * Deliberately touches NO streaming state: everything it needs (deps, the
 * loop's base hook fields, its abort signal, the per-tool metrics recorder)
 * is bound once per run through createToolDispatcher, so the pipeline is
 * unit-testable without an agent loop around it.
 */

import { randomUUID } from 'node:crypto';

import { AbortError, isAbortError } from '../errors.js';
import type {
  CallToolResult,
  DocumentBlockParam,
  ImageBlockParam,
  SDKMessage,
  SDKPermissionDeniedMessage,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '../types.js';
import type {
  AggregatedHookResult,
  EngineDeps,
  ToolDispatchRecord,
  ToolResultPayload,
} from '../internal/contracts.js';
import {
  normalizeImageMediaType,
  SUPPORTED_IMAGE_MEDIA_TYPES_LIST,
} from '../internal/media.js';

/** Wrap any abort-shaped error into this SDK's AbortError. */
function toAbortError(err: unknown): AbortError {
  if (err instanceof AbortError) return err;
  const message =
    err instanceof Error ? err.message : 'The operation was aborted';
  return new AbortError(message);
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
export type ToolExecOutcome = {
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

/** Map an MCP CallToolResult into a builtin-style tool result payload.
 *  Exported for unit tests (pure function, no I/O). */
export function mapMcpResult(res: CallToolResult): ToolResultPayload {
  const parts: Array<TextBlockParam | ImageBlockParam> = [];
  for (const part of res.content) {
    switch (part.type) {
      case 'text':
        parts.push({ type: 'text', text: part.text });
        break;
      case 'image': {
        // Whitelist the mimeType HERE (v0.56.0): an MCP server is free to
        // label anything (image/bmp, image/tiff, ...), and an off-vocabulary
        // media_type riding into the next API request 400s the WHOLE turn on
        // the Anthropic protocol (and is unrepresentable on openai-chat).
        // Degrade to an explicit text marker instead — never dropped silently.
        const mediaType = normalizeImageMediaType(part.mimeType);
        parts.push(
          mediaType !== undefined
            ? {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: part.data },
              }
            : {
                type: 'text',
                text:
                  `[image omitted: unsupported media type "${part.mimeType}"; ` +
                  `supported: ${SUPPORTED_IMAGE_MEDIA_TYPES_LIST}]`,
              },
        );
        break;
      }
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

export { mkToolError, toAbortError };

export type ToolDispatcherConfig = {
  deps: Pick<
    EngineDeps,
    'builtinTools' | 'mcp' | 'hooks' | 'permissions' | 'toolContext' | 'debug'
  >;
  /** The running loop's session id (stamped on permission_denied messages). */
  sessionId: string;
  /** The loop's official base hook fields (session_id/cwd/transcript_path). */
  baseHookFields: { session_id: string; cwd: string; transcript_path?: string };
  signal: AbortSignal;
  /** Per-tool metrics recorder (calls/duration/errors). */
  recordTool: (name: string, ms: number, isError: boolean) => void;
  /** Structured tool-call telemetry (governance spec S3): one record per
   *  dispatched block, emitted at dispatch completion. Absent -> no records. */
  onToolRecord?: (rec: ToolDispatchRecord) => void;
};

const RECORD_SUMMARY_MAX_CHARS = 500;

/** Head of a tool_result's content for the S3 record; non-text blocks appear
 *  as their type tag so the record stays small and text-only. */
function summarizeResultContent(
  content: ToolResultBlockParam['content'],
): string {
  const text =
    content === undefined
      ? ''
      : typeof content === 'string'
        ? content
        : content
            .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
            .join(' ');
  return text.length > RECORD_SUMMARY_MAX_CHARS
    ? `${text.slice(0, RECORD_SUMMARY_MAX_CHARS)}…[truncated]`
    : text;
}

export function createToolDispatcher(cfg: ToolDispatcherConfig): {
  isReadOnlyTool: (name: string) => boolean;
  isParallelSafeTool: (name: string) => boolean;
  executeToolUse: (block: ToolUseBlock) => Promise<ToolExecOutcome>;
} {
  const { deps, sessionId, baseHookFields, signal, recordTool, onToolRecord } = cfg;
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

  /** A tool may join a concurrent batch group if it is read-only OR a builtin
   * explicitly marked parallelSafe (Agent: children run in isolated contexts,
   * so batched foreground spawns must overlap, not serialize). Grouping only —
   * the permission gate's readOnly flag is NOT widened by this. */
  const isParallelSafeTool = (name: string): boolean =>
    isReadOnlyTool(name) || deps.builtinTools.get(name)?.parallelSafe === true;

  /** S3 wrapper: time the whole dispatch and emit one structured record per
   *  block, including error/deny/stop outcomes. An abort still records (with
   *  '[aborted]') so the audit trail never loses a dispatched call, then
   *  rethrows. Absent recorder -> zero overhead passthrough. */
  async function executeToolUse(block: ToolUseBlock): Promise<ToolExecOutcome> {
    if (onToolRecord === undefined) return dispatchToolUse(block);
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const emit = (status: 'ok' | 'error', resultSummary: string): void => {
      try {
        onToolRecord({
          toolUseId: block.id,
          toolName: block.name,
          input: block.input,
          startedAt,
          durationMs: Date.now() - t0,
          status,
          resultSummary,
        });
      } catch {
        // Telemetry must never break a tool dispatch.
      }
    };
    let outcome: ToolExecOutcome;
    try {
      outcome = await dispatchToolUse(block);
    } catch (err) {
      emit('error', isAbortError(err) ? '[aborted]' : String(err));
      throw err;
    }
    emit(
      outcome.result.is_error === true ? 'error' : 'ok',
      summarizeResultContent(outcome.result.content),
    );
    return outcome;
  }

  async function dispatchToolUse(block: ToolUseBlock): Promise<ToolExecOutcome> {
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
        session_id: sessionId,
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

  return { isReadOnlyTool, isParallelSafeTool, executeToolUse };
}
