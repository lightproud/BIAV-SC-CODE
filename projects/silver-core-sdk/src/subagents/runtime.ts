/**
 * Subagent runtime: recursive child agent-loop execution.
 *
 * createSubagentRuntime() holds the shared collaborators (transport, base tool
 * map, MCP registry, parent hook runner + gate config, live parent engine
 * config, cwd/env, the outer abort signal) and hands out a SpawnSubagentFn per
 * nesting depth via makeSpawnFn(depth). Each spawn:
 *   1. resolves the AgentDefinition + model alias for the requested type,
 *   2. mints an agentId and fires the SubagentStart hook,
 *   3. builds a CHILD EngineConfig/EngineDeps (isolated tool set, dedicated
 *      permission gate, shared transport + hooks) whose ToolContext carries
 *      makeSpawnFn(depth+1) so nesting is structurally self-limiting, and
 *   4. drives runAgentLoop to completion:
 *        - foreground: awaits the child, fires SubagentStop, returns its final
 *          text (with an agentId trailer),
 *        - background (depth 0 only): launches detached, returns an ack, and on
 *          completion buffers a note the root loop drains onto its next turn.
 *
 * The child's usage/cost/modelUsage is folded into a ledger the parent query
 * drains into the session totals, so subagent tokens appear in the parent
 * result. Only the child's final message ever crosses back to the parent
 * (context isolation).
 */

import { randomUUID } from 'node:crypto';

import { isAbortError } from '../errors.js';
import type {
  AgentDefinition,
  APIMessageParam,
  CallToolResult,
  ContentBlock,
  McpResource,
  McpResourceContent,
  McpServerStatus,
  ModelUsage,
  NonNullableUsage,
  SDKMessage,
  SDKTaskNotificationMessage,
  SandboxContext,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  TextBlockParam,
  ProviderConfig,
  SubagentTransportHandle,
  SubagentTransportResolution,
  SubagentTransportResolver,
} from '../types.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
  McpToolEntry,
  PermissionGate,
  SessionStore,
  ShellManager,
  SpawnSubagentFn,
  SpawnSubagentParams,
  SpawnSubagentResult,
  ToolContext,
  ToolDispatchRecord,
  Transport,
} from '../internal/contracts.js';
import type { CanUseTool } from '../types.js';
import { DefaultPermissionGate } from '../permissions/gate.js';
import { forkShellSession } from '../tools/shells.js';
import { runAgentLoop } from '../engine/loop.js';
import { matchToolName, parseRule } from '../permissions/rules.js';
import { addUsage } from '../engine/pricing.js';
import { resolveTranscriptPath } from '../sessions/store.js';
import {
  StallWatchdog,
  resolveStallTimeoutMs,
} from '../transport/stall-watchdog.js';
import { addWorktree, removeWorktreeIfClean } from '../internal/worktree.js';
import {
  DEFAULT_SUBAGENT_MAX_TURNS,
  MAX_SUBAGENT_DEPTH,
  resolveAgentDefinition,
  resolveModelAlias,
} from './agents.js';

/** Accumulated subagent usage drained by the parent query into session totals. */
export type SubagentUsageLedger = {
  usage: NonNullableUsage;
  cost: number;
  modelUsage: Record<string, ModelUsage>;
};

export interface SubagentRuntime {
  /**
   * SpawnSubagentFn bound to a nesting depth (root ToolContext uses depth 0).
   * `parentShells` is the SPAWNING context's shell session — each spawned
   * child forks its persistent cwd/env namespace from it (audit 2026-07-14
   * M-10), so nested children seed from their immediate parent, not the root.
   * Omitted -> the runtime's query-wide manager (the root loop's session).
   */
  makeSpawnFn(depth: number, parentShells?: ShellManager): SpawnSubagentFn;
  /** Pull + clear completed background-subagent result notes (root loop drains). */
  drainCompletedResults(): TextBlockParam[];
  /** Pull + reset the accumulated child usage/cost/modelUsage. */
  drainUsageLedger(): SubagentUsageLedger;
  /** Spawnable subagent type names (options.agents keys + 'general-purpose'). */
  agentNames(): string[];
  /** Stop a running background subagent task by id (agentId). */
  stopTask(taskId: string): void;
  /**
   * O-B2 SendMessage: continue a previously spawned subagent's conversation
   * with its context intact. `to` is the child agentId from its spawn result.
   * A non-background child blocks and returns the reply as `content`; a
   * background child returns a delivery ack and its reply arrives on a later
   * drained turn as a <task-notification> block. Messages to the same agent
   * serialize (a continuation queues behind the active run).
   */
  sendMessage(params: {
    to: string;
    message: string;
    signal: AbortSignal;
  }): Promise<{ content: string; isError: boolean }>;
  /**
   * TaskStop bridge (official v2.1.198: `task_id` also accepts an agent id):
   * stop a known subagent by agentId. Returns a human-readable outcome when
   * the id names a known subagent, undefined when it does not (the caller
   * falls through to other id spaces, e.g. background shells).
   */
  stopAgent(taskId: string): string | undefined;
  /** Abort every outstanding background subagent (query close). */
  abortAll(): void;
  /**
   * Await the finalizers of every background subagent ever launched (bounded
   * by `timeoutMs`, default 2000). abortAll() only SIGNALS the children; their
   * finally blocks (worktree cleanup, SubagentStop hook, sidechain_end
   * persistence) settle asynchronously — a query teardown that flushes the
   * session store before they land loses those trailing records on a mirrored
   * store (audit 2026-07-10 M4). Never throws.
   */
  settleAll(timeoutMs?: number): Promise<void>;
}

export type SubagentRuntimeOptions = {
  agents: Record<string, AgentDefinition>;
  /** Base built-in tool map (already includes the Agent tool). */
  baseBuiltins: Map<string, BuiltinTool>;
  /** Real MCP registry (children get a filtered view of it). */
  mcp: McpRegistry;
  transport: Transport;
  /** Shared parent hook runner (SubagentStart/Stop + nested tool hooks). */
  hooks: HookRunner;
  /** Parent permission gate (children read its mode as their default). */
  parentGate: PermissionGate;
  canUseTool?: CanUseTool;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** Live parent engine config (model/thinking read at spawn time). */
  engineConfig: EngineConfig;
  /** The query's provider config: resolver-callback context + the parent
   *  protocol on the spawn transport log line. */
  provider?: ProviderConfig;
  /** Cross-protocol transport routing (Options.resolveSubagentTransport):
   *  consulted once per ISOLATED spawn after the child model resolves; forks
   *  never consult it. Absent -> children share the parent transport. */
  resolveSubagentTransport?: SubagentTransportResolver;
  /** Query-composed engine-internal routing (compaction summarizer inside a
   *  child loop); forwarded into every childDeps verbatim. Owned-transport
   *  disposal belongs to the query layer that composed it. */
  transportForModel?: EngineDeps['transportForModel'];
  /** Transcript store; child transcripts persist under {agentId} when set. */
  store?: SessionStore;
  persist?: boolean;
  cwd: string;
  env: Record<string, string | undefined>;
  additionalDirectories: string[];
  fallbackModel?: string;
  /** Background children live/die with the query (outer AbortController). */
  outerSignal: AbortSignal;
  /** Resolved session id at spawn time (for hook input). */
  sessionId: () => string;
  debug: (msg: string) => void;
  /** v0.4 task-lifecycle sink: system/task_started / task_progress /
   *  task_updated / task_notification messages (official `system`+subtype
   *  encoding since v0.7) are pushed here (the runtime cannot yield);
   *  the query layer drains them into the SDKMessage stream. */
  emitObservability?: (msg: SDKMessage) => void;
  /** v0.5 query-wide shell session. The BACKGROUND-shell registry is shared
   *  with children's ToolContext as-is; the PERSISTENT cwd/env namespace is
   *  forked per spawned child (audit 2026-07-14 M-10), seeded from the
   *  spawning context's snapshot at spawn time. */
  shells?: ShellManager;
  /** v0.6 sandbox context (shared with children's ToolContext). */
  sandbox?: SandboxContext;
  /** E4 read-before-write gate: the query-wide read-paths Set (the SAME
   *  reference as the root ToolContext, so the gate spans the session). */
  readFilePaths?: Set<string>;
  /** Formal per-query WeakMap key threaded into child contexts (F6). */
  sessionKey?: object;
  /** Checkpoint pre-image recorder, resolved at SPAWN time (the checkpoint
   *  store binds after this runtime is constructed). Children thread it into
   *  their ToolContext so subagent Write/Edit pre-images land in the SAME
   *  per-turn checkpoint index as the root loop's — without it, rewind()
   *  reports success while child edits stay un-rolled-back (audit 2026-07-14
   *  H-3). Returns undefined while checkpoints are off, so child fs tools
   *  skip pre-image capture exactly like the root context does. */
  getRecordFileChange?: () => ((absPath: string, preImage: string | null) => void) | undefined;
  /** Aggregate agent-tree budget ceiling (P0 fix): the SAME object the root
   *  loop holds, threaded into every child loop so the whole family shares one
   *  spend total and one cap — a child cannot spend past the family ceiling
   *  even though it is handed a full copy of the per-loop maxBudgetUsd. */
  familyBudget?: { spentUsd: number; capUsd: number };
  /** S3 structured tool-call records: the parent query's recorder. Children
   *  forward every dispatched call with parentToolUseId stamped, so the
   *  session audit trail covers subagent tool calls too. */
  onToolRecord?: (rec: ToolDispatchRecord) => void;
};

/** task_updated.result carries a bounded preview, not the full child text
 *  (the full text already crosses via the Agent tool_result). */
const TASK_RESULT_PREVIEW_CHARS = 500;

type TaskLifecycleMessage =
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKTaskUpdatedMessage
  | SDKTaskNotificationMessage;

/** Omit that distributes over a union (plain Omit collapses to common keys). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

const zeroUsage = (): NonNullableUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

/** Concatenated text of an assistant message's text blocks. */
function concatText(content: ContentBlock[]): string {
  let out = '';
  for (const block of content) {
    if (block.type === 'text') out += block.text;
  }
  return out;
}

/** True when an assistant turn carries any tool_use block (an in-flight call). */
function hasToolUse(msg: APIMessageParam): boolean {
  if (typeof msg.content === 'string') return false;
  return msg.content.some(
    (block) => (block as { type?: string }).type === 'tool_use',
  );
}

/** Append a text instruction to a user turn (string or block-array content). */
function appendUserText(msg: APIMessageParam, text: string): APIMessageParam {
  if (typeof msg.content === 'string') {
    return { role: 'user', content: `${msg.content}\n\n${text}` };
  }
  return { role: 'user', content: [...msg.content, { type: 'text', text }] };
}

/**
 * Build the seed history for a FORK child: a shallow copy of the parent history
 * (which INHERITS the parent's context — the whole point of fork) with the
 * delegated task added as the trailing instruction.
 *
 * The parent snapshot (reqMsgs at spawn time) is the messages the parent last
 * sent, so it is already API-valid and ends on a user turn (it does not include
 * the in-flight assistant Agent tool_use turn — the child should not see the
 * call that spawned it). Two adjustments keep the seed valid WITHOUT discarding
 * the inherited context:
 *  - Drop ONLY a genuinely dangling trailing assistant tool_use (one with no
 *    following tool_result, which would 400). Completed tool_use/tool_result
 *    pairs are KEPT — the earlier version walked back through every pair and
 *    collapsed the history to the isolated shape (the G4 blocker).
 *  - Append the task. Consecutive user turns are invalid, so when the seed
 *    already ends on a user turn (the common case) the task is MERGED into it;
 *    otherwise it is added as a new user turn.
 * An empty parent history degrades to a lone `[{user, prompt}]` (isolated shape).
 */
export function buildForkSeed(
  parentHistory: APIMessageParam[],
  prompt: string,
): APIMessageParam[] {
  const seed = parentHistory.slice();
  const last = seed[seed.length - 1];
  if (last !== undefined && last.role === 'assistant' && hasToolUse(last)) {
    seed.pop(); // dangling in-flight call at the tail — cannot be answered here
  }
  const tail = seed[seed.length - 1];
  if (tail !== undefined && tail.role === 'user') {
    seed[seed.length - 1] = appendUserText(tail, prompt);
  } else {
    seed.push({ role: 'user', content: prompt });
  }
  return seed;
}

/**
 * Worktree isolation (Agent tool `isolation: 'worktree'`, E7-02): create a
 * temporary DETACHED git worktree of the repository at `repoCwd` for a child
 * to use as its cwd. Shared with the EnterWorktree tool via
 * src/internal/worktree.ts (extracted byte-equal from this module).
 */

/**
 * McpRegistry view that hides qualified tool names a subagent may not use: any
 * name outside an explicit `tools` allowlist, or any name matched by a bare
 * disallowedTools/MCP pattern. Mirrors query.ts's ToolFilterMcpRegistry shape.
 */
class ChildMcpFilter implements McpRegistry {
  constructor(
    private readonly inner: McpRegistry,
    private readonly hidden: (qualifiedName: string) => boolean,
  ) {}
  connectAll(): Promise<void> {
    return this.inner.connectAll();
  }
  statuses(): McpServerStatus[] {
    return this.inner.statuses();
  }
  allTools(): McpToolEntry[] {
    return this.inner.allTools().filter((t) => !this.hidden(t.qualifiedName));
  }
  has(qualifiedName: string): boolean {
    if (this.hidden(qualifiedName)) return false;
    return this.inner.has(qualifiedName);
  }
  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    return this.inner.call(qualifiedName, args, signal);
  }
  listResources(server: string | undefined, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.listResources(server, signal);
  }
  readResource(server: string, uri: string, signal: AbortSignal): Promise<McpResourceContent[]> {
    return this.inner.readResource(server, uri, signal);
  }
  readResourceDir(server: string, uri: string, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.readResourceDir(server, uri, signal);
  }
  reconnect(serverName: string): Promise<void> {
    // Reconnect is shared RECOVERY (a failed server is failed for every
    // borrower; reconnecting fixes it for all), not a per-session preference —
    // safe to pass through, same as SharedMcpRegistry.
    return this.inner.reconnect(serverName);
  }
  // Finding L1 — the child view narrows tool VISIBILITY only; it must not carry
  // a subagent's lifecycle mutations into the registry the parent and every
  // sibling subagent share. setEnabled would blank a server for all of them,
  // setServers closes every connection before swapping the set, and closeAll
  // tears the shared pool down mid-conversation — so these are inert on a child
  // view. Teardown/reconfiguration authority stays with the query/manager that
  // owns the registry.
  setEnabled(): void {
    // no-op: a subagent cannot toggle a shared server for its siblings.
  }
  setServers(): Promise<void> {
    // no-op: a subagent cannot swap the shared server set.
    return Promise.resolve();
  }
  closeAll(): Promise<void> {
    // no-op: a subagent cannot tear down the shared connection pool.
    return Promise.resolve();
  }
}

export function createSubagentRuntime(
  opts: SubagentRuntimeOptions,
): SubagentRuntime {
  const {
    agents,
    baseBuiltins,
    mcp,
    transport,
    hooks,
    parentGate,
    canUseTool,
    allowedTools,
    disallowedTools,
    engineConfig,
    store,
    cwd,
    env,
    additionalDirectories,
    fallbackModel,
    outerSignal,
    sessionId,
    debug,
    emitObservability,
  } = opts;
  const persist = opts.persist === true && store !== undefined;
  // Wire protocol of the parent transport (spawn log + resolver input). The
  // provider protocol field is the same single switch point factory.ts uses.
  const parentProtocol: 'anthropic' | 'openai-chat' =
    opts.provider?.protocol === 'openai-chat' ? 'openai-chat' : 'anthropic';
  // Transports handed over with `owned: true` by resolveSubagentTransport.
  // Children survive their runs for SendMessage continuation, so per-child
  // disposal would kill a revivable worker's transport — owned transports are
  // released once, at query teardown (settleAll), after every child settled.
  const ownedTransports = new Set<Transport>();
  const disposeOwnedTransports = (): void => {
    for (const t of ownedTransports) {
      try {
        t.dispose?.();
      } catch (err) {
        debug(
          `subagent transport dispose failed (ignored): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    ownedTransports.clear();
  };

  // --- Task-lifecycle observability (v0.4) ----------------------------------
  const emitTask = (
    msg: DistributiveOmit<TaskLifecycleMessage, 'uuid' | 'session_id'>,
  ): void => {
    if (emitObservability === undefined) return;
    emitObservability({
      ...msg,
      uuid: randomUUID(),
      session_id: sessionId(),
    } as TaskLifecycleMessage);
  };
  const resultPreview = (text: string): string =>
    text.length > TASK_RESULT_PREVIEW_CHARS
      ? `${text.slice(0, TASK_RESULT_PREVIEW_CHARS)}...`
      : text;
  /** Terminal task_updated for a finished (non-killed) child (official
   *  `patch` envelope since v0.7). */
  const emitTaskFinished = (agentId: string, res: { text: string; isError: boolean }): void => {
    emitTask({
      type: 'system',
      subtype: 'task_updated',
      task_id: agentId,
      patch: {
        status: res.isError ? 'failed' : 'completed',
        end_time: Date.now(),
        ...(res.isError ? { error: resultPreview(res.text) } : {}),
      },
      ...(res.isError ? {} : { result: resultPreview(res.text) }),
    });
  };

  /**
   * Official <task-notification> XML block (archive slug
   * system-prompt-coordinator-mode-orchestration, "Agent Results" section):
   * background subagent results reach the model in this wire shape, so the
   * reproduced coordinator preset's Results contract holds verbatim.
   * `<result>` and `<usage>` are optional sections, exactly as documented.
   */
  // XML-escape the CHILD-controlled free-text fields (summary carries the task
  // description + a result preview; result is the child's returned text). The
  // official harness escapes these before embedding them, so a child whose
  // output contains `</result>` / `<task-notification>` cannot forge block
  // structure into the parent's view (a prompt-injection vector when the child
  // processed untrusted data). `&` first so already-escaped output is not
  // double-mangled inconsistently. agentId/status/usage are SDK-controlled.
  const escapeXmlText = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const formatTaskNotification = (p: {
    agentId: string;
    status: 'completed' | 'failed' | 'killed';
    summary: string;
    result?: string;
    usage?: { totalTokens: number; toolUses: number; durationMs: number };
  }): string => {
    const lines = [
      '<task-notification>',
      `<task-id>${p.agentId}</task-id>`,
      `<status>${p.status}</status>`,
      `<summary>${escapeXmlText(p.summary)}</summary>`,
    ];
    if (p.result !== undefined && p.result.length > 0) {
      lines.push(`<result>${escapeXmlText(p.result)}</result>`);
    }
    if (p.usage !== undefined) {
      lines.push(
        '<usage>',
        `  <subagent_tokens>${p.usage.totalTokens}</subagent_tokens>`,
        `  <tool_uses>${p.usage.toolUses}</tool_uses>`,
        `  <duration_ms>${p.usage.durationMs}</duration_ms>`,
        '</usage>',
      );
    }
    lines.push('</task-notification>');
    return lines.join('\n');
  };

  // Bare-name (no `Tool(spec)` specifier) parent disallow patterns propagate to
  // child tool-set filtering, so a fully-denied parent tool never re-surfaces
  // inside a subagent.
  const parentBareDisallowed: string[] = (disallowedTools ?? []).filter(
    (raw) => parseRule(raw).specifier === undefined,
  );

  // --- Usage ledger --------------------------------------------------------
  let ledgerUsage = zeroUsage();
  let ledgerCost = 0;
  let ledgerModelUsage: Record<string, ModelUsage> = {};

  const recordUsage = (
    usage: NonNullableUsage,
    cost: number,
    modelUsage: Record<string, ModelUsage>,
  ): void => {
    ledgerUsage = addUsage(ledgerUsage, usage);
    ledgerCost += cost;
    for (const [modelId, mu] of Object.entries(modelUsage)) {
      const prev = ledgerModelUsage[modelId];
      ledgerModelUsage[modelId] =
        prev === undefined
          ? { ...mu }
          : {
              inputTokens: prev.inputTokens + mu.inputTokens,
              outputTokens: prev.outputTokens + mu.outputTokens,
              cacheReadInputTokens:
                prev.cacheReadInputTokens + mu.cacheReadInputTokens,
              cacheCreationInputTokens:
                prev.cacheCreationInputTokens + mu.cacheCreationInputTokens,
              webSearchRequests: prev.webSearchRequests + mu.webSearchRequests,
              costUSD: prev.costUSD + mu.costUSD,
              // Static per-model metering (T2-4): same model -> same values;
              // keep the freshest non-undefined ones across merges.
              ...(mu.contextWindow ?? prev.contextWindow
                ? { contextWindow: mu.contextWindow ?? prev.contextWindow }
                : {}),
              ...(mu.maxOutputTokens ?? prev.maxOutputTokens
                ? { maxOutputTokens: mu.maxOutputTokens ?? prev.maxOutputTokens }
                : {}),
            };
    }
  };

  const drainUsageLedger = (): SubagentUsageLedger => {
    const out: SubagentUsageLedger = {
      usage: { ...ledgerUsage },
      cost: ledgerCost,
      modelUsage: Object.fromEntries(
        Object.entries(ledgerModelUsage).map(([k, v]) => [k, { ...v }]),
      ),
    };
    ledgerUsage = zeroUsage();
    ledgerCost = 0;
    ledgerModelUsage = {};
    return out;
  };

  // --- Background bookkeeping ----------------------------------------------
  const completedBuffer: TextBlockParam[] = [];
  const backgroundTasks = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  // Every background finalizer ever launched (settleAll awaits these; entries
  // are already-settled promises after completion, so the array stays cheap).
  const allBackgroundPromises: Array<Promise<void>> = [];

  const drainCompletedResults = (): TextBlockParam[] => {
    if (completedBuffer.length === 0) return [];
    return completedBuffer.splice(0, completedBuffer.length);
  };

  // --- Hooks ----------------------------------------------------------------
  const fireSubagentStart = async (
    agentId: string,
    type: string,
    signal: AbortSignal,
  ): Promise<void> => {
    if (!hooks.hasHooks('SubagentStart')) return;
    // Base `transcript_path` = the MAIN session transcript (the subagent's own
    // transcript may not exist yet at start, so no agent_transcript_path here).
    const transcriptPath = persist ? resolveTranscriptPath(store, sessionId()) : undefined;
    try {
      const agg = await hooks.run(
        'SubagentStart',
        {
          session_id: sessionId(),
          cwd,
          ...(transcriptPath !== undefined ? { transcript_path: transcriptPath } : {}),
          hook_event_name: 'SubagentStart',
          agent_id: agentId,
          agent_type: type,
        },
        undefined,
        type,
        signal,
      );
      for (const m of agg.systemMessages) debug(`SubagentStart hook: ${m}`);
      if (!agg.continue) {
        // Non-blocking semantics: a continue:false is logged, not enforced.
        debug(
          `SubagentStart hook requested stop for agent ${agentId}; ` +
            'logged but not enforced',
        );
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      debug(
        `SubagentStart hook failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const fireSubagentStop = async (
    agentId: string,
    type: string,
    signal: AbortSignal,
  ): Promise<void> => {
    if (!hooks.hasHooks('SubagentStop')) return;
    // Official parity: `agent_transcript_path` = the SUBAGENT's transcript (child
    // transcripts append under {agentId}); base `transcript_path` = the MAIN
    // session's transcript (the session_id this hook reports). Both are path-
    // backed-store concretions duck-typed via resolveTranscriptPath; absent for
    // non-path stores / persistence off.
    const agentTranscriptPath = persist ? resolveTranscriptPath(store, agentId) : undefined;
    const transcriptPath = persist ? resolveTranscriptPath(store, sessionId()) : undefined;
    try {
      const agg = await hooks.run(
        'SubagentStop',
        {
          session_id: sessionId(),
          cwd,
          ...(transcriptPath !== undefined ? { transcript_path: transcriptPath } : {}),
          hook_event_name: 'SubagentStop',
          stop_hook_active: false,
          agent_id: agentId,
          agent_type: type,
          ...(agentTranscriptPath !== undefined
            ? { agent_transcript_path: agentTranscriptPath }
            : {}),
        },
        undefined,
        type,
        signal,
      );
      for (const m of agg.systemMessages) debug(`SubagentStop hook: ${m}`);
    } catch (err) {
      if (isAbortError(err)) throw err;
      debug(
        `SubagentStop hook failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // --- Child tool-set / mcp / gate construction ----------------------------
  function buildChildBuiltins(
    agentDef: AgentDefinition,
    childDepth: number,
  ): Map<string, BuiltinTool> {
    const childBuiltins = new Map(baseBuiltins);

    // tools: explicit allowlist (intersection).
    if (Array.isArray(agentDef.tools)) {
      const allow = new Set(agentDef.tools);
      for (const name of [...childBuiltins.keys()]) {
        if (!allow.has(name)) childBuiltins.delete(name);
      }
    }

    // disallowedTools (bare) + parent bare disallow.
    const bareDeny = [
      ...parentBareDisallowed,
      ...(agentDef.disallowedTools ?? [])
        .filter((raw) => parseRule(raw).specifier === undefined),
    ];
    if (bareDeny.length > 0) {
      for (const name of [...childBuiltins.keys()]) {
        if (bareDeny.some((p) => matchToolName(p, name))) {
          childBuiltins.delete(name);
        }
      }
    }

    // Depth cap: a child AT the max depth cannot itself spawn agents.
    if (childDepth >= MAX_SUBAGENT_DEPTH) childBuiltins.delete('Agent');

    return childBuiltins;
  }

  function buildChildMcp(agentDef: AgentDefinition): McpRegistry {
    const allowList = Array.isArray(agentDef.tools) ? agentDef.tools : undefined;
    const bareDeny = [
      ...parentBareDisallowed,
      ...(agentDef.disallowedTools ?? [])
        .filter((raw) => parseRule(raw).specifier === undefined),
    ];
    if (allowList === undefined && bareDeny.length === 0) return mcp;
    const hidden = (qualifiedName: string): boolean => {
      if (
        allowList !== undefined &&
        !allowList.some((entry) => matchToolName(entry, qualifiedName))
      ) {
        return true;
      }
      return bareDeny.some((p) => matchToolName(p, qualifiedName));
    };
    return new ChildMcpFilter(mcp, hidden);
  }

  function warnNoOpFields(agentDef: AgentDefinition, type: string): void {
    const noop: Array<[keyof AgentDefinition, string]> = [
      ['skills', 'skills'],
      ['mcpServers', 'mcpServers'],
      ['memory', 'memory'],
      ['effort', 'effort'],
      ['initialPrompt', 'initialPrompt'],
    ];
    for (const [key, label] of noop) {
      if (agentDef[key] !== undefined) {
        debug(
          `subagent "${type}": AgentDefinition.${label} is accepted but has ` +
            'no effect in v0.2 (see docs/COMPAT.md)',
        );
      }
    }
  }

  // --- Drive one child loop to completion ----------------------------------
  /** Sidechain metadata: distinguishes fork vs isolated + threads correlation. */
  type SidechainInfo = {
    agentType: string;
    fork: boolean;
    parentToolUseId: string | null | undefined;
    /** Delegated-task description (task_progress.description, official field). */
    description: string;
    /** The RAW spawning tool_use id ('' when the tool passed none) — NOT the
     *  agentId-fallback correlation id; task_*.tool_use_id must be honest. */
    toolUseId: string;
  };

  /** Cumulative real figures from one child run (feeds <usage> notification). */
  type ChildRunUsage = { totalTokens: number; toolUses: number; durationMs: number };

  // --- O-B2 continuation registry -------------------------------------------
  // Every spawned child is retained here for the runtime's lifetime so a later
  // SendMessage can CONTINUE its conversation with context intact: `history`
  // is the SAME array runAgentLoop mutates in place, so after a run it holds
  // the child's full transcript (every tool call, file read and decision — not
  // a summary). Retention is bounded by the query's life (the runtime dies
  // with the query). `queue` serializes continuations behind the active run so
  // transcript turns never interleave.
  type ChildRecord = {
    agentType: string;
    description: string;
    background: boolean;
    status: 'running' | 'completed' | 'failed' | 'killed';
    history: APIMessageParam[];
    deps: EngineDeps;
    config: EngineConfig;
    sidechain: SidechainInfo;
    controller: AbortController;
    queue: Promise<unknown>;
  };
  const childRegistry = new Map<string, ChildRecord>();

  // Sidechain marker lifecycle (待裁② — keeper 2026-07-16 "只初次写 start + 重构
  // end"): ONE sidechain_start at the child's birth and ONE sidechain_end at its
  // final teardown, bracketing every SendMessage continuation episode in
  // between — instead of a fresh start/end pair per run. `finalizeSidechain`
  // (called from killAgent + settleAll) writes the single end idempotently.
  const sidechainStarted = new Set<string>();
  const sidechainEnded = new Set<string>();
  const sidechainLastError = new Map<string, boolean>();
  const sidechainMeta = new Map<string, { agentType: string; fork: boolean }>();
  function finalizeSidechain(agentId: string, opts?: { error?: boolean }): void {
    if (!persist || store === undefined) return;
    if (!sidechainStarted.has(agentId) || sidechainEnded.has(agentId)) return;
    sidechainEnded.add(agentId);
    const meta = sidechainMeta.get(agentId);
    store.append(agentId, {
      type: 'sidechain_end',
      timestamp: new Date().toISOString(),
      agent_type: meta?.agentType ?? '',
      fork: meta?.fork ?? false,
      is_error: opts?.error ?? sidechainLastError.get(agentId) ?? false,
    });
  }

  async function runChildToCompletion(
    history: APIMessageParam[],
    deps: EngineDeps,
    config: EngineConfig,
    agentId: string,
    sidechain: SidechainInfo,
    liveness?: { touch(): void },
  ): Promise<{ text: string; isError: boolean; usage: ChildRunUsage }> {
    let lastText = '';
    let sawError = false;
    let errMsg: string | undefined;
    // task_progress: turn-budget share consumed. The child's maxTurns is always
    // resolved by spawn() (agentDef -> parent -> DEFAULT), so the denominator
    // is a real cap, not a guess; capped at 99 (100 is the terminal update's).
    const turnCap = config.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS;
    let childTurns = 0;
    // Official task_progress.usage (required): cumulative real figures from
    // the child's own stream — tokens from each assistant turn's API usage,
    // tool_uses from its tool_use blocks, duration from the wall clock.
    const startedAtMs = Date.now();
    let childTokens = 0;
    let childToolUses = 0;
    let lastToolName: string | undefined;

    // SIDECHAIN: the child's turns are recorded under key=agentId (NEVER the
    // parent sessionId), tagged isSidechain, so they can be persisted/observed
    // without polluting the parent transcript. Applies to BOTH fork + isolated
    // children; the `fork` flag on the markers distinguishes them.
    const recordSidechain = persist && store !== undefined;
    const parentToolUseId = sidechain.parentToolUseId ?? null;
    if (recordSidechain && store !== undefined) {
      // sidechain_start ONCE, at the child's birth (待裁②). A SendMessage
      // continuation re-enters this function but must NOT write a second start;
      // the single end is written by finalizeSidechain at teardown.
      if (!sidechainStarted.has(agentId)) {
        sidechainStarted.add(agentId);
        sidechainMeta.set(agentId, { agentType: sidechain.agentType, fork: sidechain.fork });
        store.append(agentId, {
          type: 'sidechain_start',
          timestamp: new Date().toISOString(),
          agent_type: sidechain.agentType,
          fork: sidechain.fork,
          parent_session_id: sessionId(),
          parent_tool_use_id: parentToolUseId,
          seeded_messages: history.length,
        });
      }
      // Record THIS episode's triggering user turn EVERY run — the delegated
      // task on the initial run, or the continuation message on a continuation —
      // so the single-bracket transcript stays self-contained across episodes.
      const seedTurn = history[history.length - 1];
      if (seedTurn !== undefined) {
        store.append(agentId, {
          type: 'user',
          timestamp: new Date().toISOString(),
          isSidechain: true,
          parent_tool_use_id: parentToolUseId,
          message: { role: seedTurn.role, content: seedTurn.content },
        });
      }
    }

    // Track this run episode's terminal error state (pessimistic until a clean
    // result is computed). It is stashed in the finally; the single
    // sidechain_end is emitted at the child's teardown by finalizeSidechain,
    // which settleAll invokes for every started child before it resolves — so
    // the M4 "transcript complete before the child settles" contract still holds.
    let result: { text: string; isError: boolean; usage: ChildRunUsage };
    let sidechainErrored = true; // pessimistic until a clean result is computed
    try {
    for await (const msg of runAgentLoop(history, deps, config)) {
      liveness?.touch();
      if (msg.type === 'assistant') {
        childTurns += 1;
        const u = msg.message.usage;
        childTokens +=
          (u?.input_tokens ?? 0) +
          (u?.output_tokens ?? 0) +
          (u?.cache_creation_input_tokens ?? 0) +
          (u?.cache_read_input_tokens ?? 0);
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            childToolUses += 1;
            lastToolName = block.name;
          }
        }
        emitTask({
          type: 'system',
          subtype: 'task_progress',
          task_id: agentId,
          ...(sidechain.toolUseId !== '' ? { tool_use_id: sidechain.toolUseId } : {}),
          description: sidechain.description,
          subagent_type: sidechain.agentType,
          usage: {
            total_tokens: childTokens,
            tool_uses: childToolUses,
            duration_ms: Date.now() - startedAtMs,
          },
          ...(lastToolName !== undefined ? { last_tool_name: lastToolName } : {}),
          progress: Math.min(99, Math.floor((childTurns / turnCap) * 100)),
          status: `turn ${childTurns}/${turnCap}`,
        });
        const t = concatText(msg.message.content);
        if (t.length > 0) lastText = t;
        if (recordSidechain && store !== undefined) {
          store.append(agentId, {
            type: 'assistant',
            timestamp: new Date().toISOString(),
            isSidechain: true,
            parent_tool_use_id: parentToolUseId,
            message: { role: 'assistant', content: msg.message.content },
          });
        }
      } else if (msg.type === 'result') {
        recordUsage(msg.usage, msg.total_cost_usd, msg.modelUsage);
        if (msg.subtype !== 'success') {
          sawError = true;
          errMsg = msg.errorMessage;
        }
      }
    }

    const runUsage: ChildRunUsage = {
      totalTokens: childTokens,
      toolUses: childToolUses,
      durationMs: Date.now() - startedAtMs,
    };
    if (!sawError) {
      result = { text: lastText, isError: false, usage: runUsage };
    } else if (lastText.length > 0) {
      // Partial-output handling: surface any produced text rather than dropping
      // it, treating a non-empty partial as a soft (non-error) result.
      result = {
        text: `${lastText}\n\n(subagent did not finish: ${errMsg ?? 'unknown error'})`,
        isError: false,
        usage: runUsage,
      };
    } else {
      result = {
        text: `Agent terminated early due to an API error: ${errMsg ?? 'unknown error'}`,
        isError: true,
        usage: runUsage,
      };
    }
    sidechainErrored = result.isError;
    } finally {
      // Do NOT write sidechain_end per run (待裁② — keeper 2026-07-16): a
      // SendMessage continuation would revive this child, so the terminal marker
      // belongs to the child's final teardown, not each episode. Record this
      // episode's error state; finalizeSidechain (killAgent + settleAll) emits
      // the single end idempotently.
      if (recordSidechain && store !== undefined) {
        sidechainLastError.set(agentId, sidechainErrored);
      }
    }
    return result;
  }

  // --- The spawn closure factory -------------------------------------------
  function makeSpawnFn(depth: number, parentShells?: ShellManager): SpawnSubagentFn {
    // The shell session this spawner's CALLER runs on: children fork their
    // persistent cwd/env namespace from it (audit 2026-07-14 M-10). The root
    // loop's spawner (depth 0, no override) forks from the query-wide manager.
    const sessionShells = parentShells ?? opts.shells;
    return async function spawn(
      params: SpawnSubagentParams,
    ): Promise<SpawnSubagentResult> {
      // Guard (also structurally impossible: the Agent tool is absent from a
      // depth-MAX child's tool set).
      if (depth >= MAX_SUBAGENT_DEPTH) {
        debug(
          `subagent: nesting limit (${MAX_SUBAGENT_DEPTH}) reached at depth ${depth}`,
        );
        return {
          content:
            `Subagent nesting limit (${MAX_SUBAGENT_DEPTH}) reached; ` +
            'cannot spawn further agents.',
          isError: true,
          agentId: '',
          background: false,
        };
      }

      const resolved = resolveAgentDefinition(params.subagentType, agents, debug);
      if ('error' in resolved) {
        return {
          content: `Agent failed: ${resolved.error}`,
          isError: true,
          agentId: '',
          background: false,
        };
      }
      const agentDef = resolved.definition;
      warnNoOpFields(agentDef, resolved.type);

      const agentId = randomUUID();
      const childDepth = depth + 1;

      // Worktree isolation (E7-02): created BEFORE task_started so a creation
      // failure is reported synchronously with no dangling lifecycle events.
      // The worktree always derives from the runtime cwd (the root repo), even
      // for nested spawns — the spawn closure does not track per-child cwds.
      let childCwd = cwd;
      let worktreeDir: string | undefined;
      let worktreeBaseHead: string | undefined;
      if (params.isolation === 'worktree') {
        const wt = await addWorktree(cwd);
        if ('error' in wt) {
          return {
            content: `Agent failed: could not create an isolation worktree: ${wt.error}`,
            isError: true,
            agentId: '',
            background: false,
          };
        }
        worktreeDir = wt.dir;
        worktreeBaseHead = wt.baseHead;
        childCwd = wt.dir;
        debug(`subagent ${agentId}: isolation worktree at ${worktreeDir}`);
      }
      /** Post-run worktree cleanup: removed only when the child left NO work —
       *  neither uncommitted changes NOR commits past the base HEAD. */
      const releaseWorktree = async (): Promise<void> => {
        if (worktreeDir === undefined) return;
        const outcome = await removeWorktreeIfClean(cwd, worktreeDir, worktreeBaseHead);
        if (outcome === 'kept') {
          debug(
            `subagent ${agentId}: worktree ${worktreeDir} kept ` +
              '(uncommitted changes, committed work, or git failure)',
          );
        }
      };

      const taskDescription = params.description ?? resolved.type;
      emitTask({
        type: 'system',
        subtype: 'task_started',
        task_id: agentId,
        ...(params.toolUseId !== '' ? { tool_use_id: params.toolUseId } : {}),
        description: taskDescription,
        // This engine only spawns in-process subagents (never local_bash /
        // remote_agent tasks), so the official task_type is always
        // 'local_agent'.
        task_type: 'local_agent',
      });
      // The isolation worktree is created ABOVE but the try/finally blocks that
      // release it are the per-branch run bodies below. A throw here (an aborted
      // SubagentStart hook, a hook that rethrows) would otherwise leak the
      // worktree AND its `git worktree list` registration. Release it (clean =
      // removed) before propagating.
      try {
        await fireSubagentStart(agentId, params.subagentType, params.signal);
      } catch (err) {
        await releaseWorktree().catch(() => undefined);
        throw err;
      }

      // Background is a depth-0-only feature (keeps the drain wiring root-only).
      const wantBackground =
        agentDef.background === true || params.runInBackground === true;
      const isBackground = wantBackground && depth === 0;
      if (wantBackground && depth !== 0) {
        debug(
          `subagent "${resolved.type}": background requested at depth ${depth}; ` +
            'running in the foreground instead',
        );
      }

      // FORK mode: continue from the parent's context (shared cached prefix)
      // instead of a fresh isolated one. Requested via the Agent tool input OR
      // declared on the AgentDefinition; only ACTIVE when the tool eagerly
      // snapshotted a non-empty parent history (otherwise it degrades to
      // isolated). A prefix is only cache-shareable if tools + system + model +
      // message-prefix all byte-match the parent, so a fork child INHERITS the
      // parent model/system/tool set/permission mode and INTENTIONALLY ignores
      // agentDef.model/tools/disallowedTools/permissionMode/prompt-as-system.
      // This makes a fork child as privileged as the parent (documented
      // trade-off, guarded by the opt-in flag).
      const forkRequested = params.fork === true || agentDef.fork === true;
      const forkActive =
        forkRequested &&
        Array.isArray(params.parentHistory) &&
        params.parentHistory.length > 0;
      if (forkRequested && !forkActive) {
        debug(
          `subagent "${resolved.type}": fork requested but no parent context ` +
            'was available; running an isolated child instead',
        );
      }
      if (forkActive && engineConfig.promptCaching === false) {
        debug(
          `subagent "${resolved.type}": fork with promptCaching disabled pays ` +
            'the full parent-prefix input tokens with no cache read (more ' +
            'expensive than an isolated child, not less)',
        );
      }

      // Tool set: a fork child inherits the parent's FULL builtin set (losing
      // only Agent at max depth so nesting stays bounded) so its tools block
      // byte-matches the parent's cached prefix; an isolated child gets the
      // agentDef-filtered set.
      let childBuiltins: Map<string, BuiltinTool>;
      if (forkActive) {
        childBuiltins = new Map(baseBuiltins);
        if (childDepth >= MAX_SUBAGENT_DEPTH) childBuiltins.delete('Agent');
        // SendMessage stays IN a fork child's tool block (prefix byte-match
        // with the parent); its execute fails honestly there because the
        // child ToolContext carries no `subagents` bridge.
      } else {
        childBuiltins = buildChildBuiltins(agentDef, childDepth);
        // Subagent messaging is root-loop-only in this SDK: an isolated child
        // has no use for the tool, so its schema is withheld outright.
        childBuiltins.delete('SendMessage');
      }
      const childMcp = forkActive ? mcp : buildChildMcp(agentDef);
      const childGate = new DefaultPermissionGate({
        mode: forkActive
          ? parentGate.getMode()
          : agentDef.permissionMode ?? parentGate.getMode(),
        allowedTools,
        disallowedTools: forkActive
          ? [...(disallowedTools ?? [])]
          : [...(disallowedTools ?? []), ...(agentDef.disallowedTools ?? [])],
        canUseTool,
        debug,
      });

      // Per-call model override (Agent tool `model`, E7-02): beats
      // agentDef.model for an isolated child; a fork ALWAYS inherits the
      // parent model (the cached prefix must byte-match), so the override is
      // ignored there with a debug note.
      if (params.model !== undefined && forkActive) {
        debug(
          `subagent "${resolved.type}": model override "${params.model}" ` +
            'ignored in fork mode (fork inherits the parent model)',
        );
      }
      // Fork inherits the parent model; isolated resolves the per-call
      // override, then agentDef.model, through the same alias path.
      const childModel = forkActive
        ? engineConfig.model
        : resolveModelAlias(params.model ?? agentDef.model, engineConfig.model);

      // --- Cross-protocol transport routing (P0, 2026-07-13) ---------------
      // An isolated child whose resolved model is only served on a different
      // wire protocol must not ride the parent transport (the gateway 400s
      // "model not found" on the wrong route). The host's
      // resolveSubagentTransport callback owns the model->protocol policy;
      // absent (or returning undefined) the child shares the parent transport
      // — byte-for-byte the previous behavior. Forks NEVER consult it: a
      // fork's whole point is the parent's cached prefix, which requires the
      // parent model and transport.
      let childTransport: Transport = transport;
      let resolution: SubagentTransportResolution | undefined;
      if (!forkActive && opts.resolveSubagentTransport !== undefined) {
        try {
          resolution = await opts.resolveSubagentTransport({
            model: childModel,
            purpose: 'subagent',
            parentModel: engineConfig.model,
            parentProtocol,
            parentTransport: transport as SubagentTransportHandle,
            parentProvider: opts.provider,
            env,
            fork: false,
            debug,
          });
        } catch (err) {
          // Fail the spawn honestly: a child sent through a transport the
          // host failed to resolve would hit the exact wrong-route 400 this
          // hook exists to prevent.
          const message = err instanceof Error ? err.message : String(err);
          await releaseWorktree().catch(() => undefined);
          emitTask({
            type: 'system',
            subtype: 'task_updated',
            task_id: agentId,
            patch: {
              status: 'failed',
              end_time: Date.now(),
              error: resultPreview(`transport resolution failed: ${message}`),
            },
          });
          return {
            content: `Agent failed: subagent transport resolution failed: ${message}`,
            isError: true,
            agentId,
            background: false,
          };
        }
      }
      if (
        resolution !== undefined &&
        (resolution.transport as unknown as Transport) !== transport
      ) {
        childTransport = resolution.transport as unknown as Transport;
        if (resolution.owned === true) ownedTransports.add(childTransport);
      }
      const transportSwitched = childTransport !== transport;
      const transportMode = !transportSwitched
        ? 'shared-parent'
        : resolution?.owned === true
          ? 'child-owned'
          : 'resolver-shared';
      const childProtocol = transportSwitched
        ? resolution?.protocol
        : parentProtocol;
      debug(
        `subagent ${agentId}: transport ${JSON.stringify({
          parentModel: engineConfig.model,
          childModel,
          parentProtocol,
          ...(childProtocol !== undefined ? { childProtocol } : {}),
          transportMode,
        })}`,
      );
      // Thinking must be re-derived for a transport-switched child: the
      // engine already re-fits the WIRE FORM per live model (computeThinking,
      // adaptive vs budget_tokens), but its capability check only knows
      // Claude generations — an unknown model id defaults to adaptive, and a
      // Claude-shaped `thinking` param sent to a non-Claude model is
      // gateway-rejected more often than honored. Resolution values win;
      // otherwise a switched child whose model id is not Claude-family drops
      // the inherited config (safe degradation), and a shared-transport child
      // inherits unchanged (existing behavior).
      const degradeThinking =
        transportSwitched &&
        resolution?.thinking === undefined &&
        !/claude/i.test(childModel);
      const childThinking =
        resolution?.thinking ?? (degradeThinking ? undefined : engineConfig.thinking);
      const childMaxThinkingTokens =
        resolution?.maxThinkingTokens ??
        (degradeThinking ? undefined : engineConfig.maxThinkingTokens);
      if (degradeThinking && engineConfig.thinking !== undefined) {
        debug(
          `subagent ${agentId}: inherited thinking config dropped for ` +
            `non-Claude child model "${childModel}" on a switched transport`,
        );
      }

      const childConfig: EngineConfig = {
        model: childModel,
        fallbackModel,
        maxOutputTokens: engineConfig.maxOutputTokens,
        // Fork inherits the parent system prompt (prefix match); isolated uses
        // the agent's own prompt as its system.
        systemPrompt: forkActive ? engineConfig.systemPrompt : agentDef.prompt,
        // Inherit a turn/cost ceiling so a delegated child cannot loop tool
        // calls unbounded (hanging the parent when foreground) or spend past the
        // parent's budget: maxTurns falls back agentDef -> parent -> a sane
        // default; maxBudgetUsd propagates from the live parent EngineConfig.
        // These caps apply identically in fork mode.
        maxTurns:
          agentDef.maxTurns ??
          engineConfig.maxTurns ??
          DEFAULT_SUBAGENT_MAX_TURNS,
        maxBudgetUsd: engineConfig.maxBudgetUsd,
        // Re-derived above for transport-switched children (resolution wins,
        // non-Claude models degrade safely); inherited unchanged otherwise.
        thinking: childThinking,
        maxThinkingTokens: childMaxThinkingTokens,
        promptCaching: resolution?.promptCaching ?? engineConfig.promptCaching,
        // Children estimate cost with the same custom price entries as the
        // parent, so subagent spend counts toward maxBudgetUsd on non-Claude
        // models too (audit 2026-07-10 P1-4).
        pricing: engineConfig.pricing,
        includePartialMessages: false,
        sessionId: agentId,
        // The child's own transcript, so hooks fired INSIDE the subagent loop
        // (PreToolUse/Stop/…) carry the official base `transcript_path`.
        transcriptPath: persist ? resolveTranscriptPath(store, agentId) : undefined,
        // The isolation worktree (when requested) is the child's cwd.
        cwd: childCwd,
        // The loop does not expose the spawning tool_use id to the tool; use a
        // stable correlation id (the child agentId) when the tool passed none.
        parentToolUseId:
          params.toolUseId !== '' ? params.toolUseId : agentId,
        // FORK inherits the parent's FULL system + compaction shape. Fork's whole
        // point is a byte-identical prefix so the child reads the parent's warm
        // cache instead of re-billing the shared history cold; inheriting only
        // `systemPrompt` broke that (the default preset carries its instructions
        // in systemPromptSuffix, and a segments host puts EVERYTHING in
        // systemBlocks with an empty systemPrompt — a fork then had no system at
        // all). Not inherited on purpose: serverTools (the memory tool is
        // root-only in v1, so a child must not advertise a tool it cannot run).
        ...(forkActive
          ? {
              ...(engineConfig.systemPromptSuffix !== undefined
                ? { systemPromptSuffix: engineConfig.systemPromptSuffix }
                : {}),
              ...(engineConfig.systemPromptBaseLen !== undefined
                ? { systemPromptBaseLen: engineConfig.systemPromptBaseLen }
                : {}),
              ...(engineConfig.systemBlocks !== undefined
                ? { systemBlocks: engineConfig.systemBlocks }
                : {}),
              ...(engineConfig.systemComposition !== undefined
                ? { systemComposition: engineConfig.systemComposition }
                : {}),
              ...(engineConfig.cacheTtl !== undefined
                ? { cacheTtl: engineConfig.cacheTtl }
                : {}),
              ...(engineConfig.compaction !== undefined
                ? { compaction: engineConfig.compaction }
                : {}),
            }
          : {}),
      };

      const childController = new AbortController();
      const parentSignal = isBackground ? outerSignal : params.signal;
      const childSignal = AbortSignal.any([parentSignal, childController.signal]);
      // Persistent shell state is FORKED per spawned child (audit 2026-07-14
      // M-10): the child's namespace is seeded from the parent's cwd/env
      // snapshot as of spawn time (it still sees the parent's persistent
      // state), but its own cd/exports stay private — they never replay into
      // concurrent batch-mates' Bash calls nor back into the parent's next
      // foreground Bash. The BACKGROUND-shell registry stays query-wide:
      // forkShellSession delegates spawnBackground/get/kill to the shared
      // manager, so BashOutput/KillShell see the same shells everywhere.
      const childShells =
        sessionShells !== undefined ? forkShellSession(sessionShells) : undefined;
      const childToolContext: ToolContext = {
        cwd: childCwd,
        additionalDirectories,
        env,
        signal: childSignal,
        debug,
        // Nested spawns fork their shell namespace from THIS child's session
        // (lineage seeding), not from the root manager.
        spawnSubagent: makeSpawnFn(childDepth, childShells),
        // KNOWN LIMIT for worktree isolation: the SEED is the parent's last
        // recorded cwd, which may lie outside the worktree, so the child's
        // first Bash call can still start outside it (its later cds are its
        // own); Read/Write/Edit and childConfig.cwd stay confined.
        shells: childShells,
        // Children inherit the same sandbox as the root loop.
        sandbox: opts.sandbox,
        // Same SESSION for the read-before-write gate: a parent Read
        // satisfies a child's Write gate and vice versa.
        readFilePaths: opts.readFilePaths,
        sessionKey: opts.sessionKey,
        // Same per-turn checkpoint index as the root loop: child Write/Edit
        // pre-images must be captured, or rewind() silently skips them.
        recordFileChange: opts.getRecordFileChange?.(),
      };
      // ExitPlanMode bridge: the child flips ITS OWN gate (childGate), never
      // the parent's. Attached via the tool's context extension because the
      // bridge is deliberately not part of the core ToolContext contract.
      childToolContext.permissionGate =
        childGate;
      const childDeps: EngineDeps = {
        // Parent transport, or the resolver's cross-protocol replacement.
        transport: childTransport,
        // Child compaction may route ITS summary model cross-protocol too
        // (query-composed closure; owned disposal stays with the composer).
        ...(opts.transportForModel !== undefined
          ? { transportForModel: opts.transportForModel }
          : {}),
        builtinTools: childBuiltins,
        mcp: childMcp,
        permissions: childGate,
        hooks,
        toolContext: childToolContext,
        debug,
        // Share the aggregate agent-tree budget ceiling: this child's own
        // billed cost lands in the same spentUsd the root loop and its sibling
        // children see, so no branch of the tree can exceed maxBudgetUsd in
        // aggregate (P0 fix — the per-loop maxBudgetUsd self-cap only bounds one
        // loop in isolation).
        ...(opts.familyBudget !== undefined ? { familyBudget: opts.familyBudget } : {}),
        // S3: forward the parent recorder with the spawning Task tool_use id
        // stamped, so the session audit trail attributes child tool calls.
        ...(opts.onToolRecord !== undefined
          ? {
              onToolRecord: (rec: ToolDispatchRecord): void =>
                // Use the SAME stable correlation id childConfig uses: the Agent
                // tool always passes toolUseId '' , so stamp the child agentId as
                // the fallback — otherwise the audit trail records an empty
                // parent_tool_use_id and cannot attribute the child's tool calls.
                opts.onToolRecord!({
                  ...rec,
                  parentToolUseId: params.toolUseId !== '' ? params.toolUseId : agentId,
                }),
            }
          : {}),
      };
      // Fork seeds the child with a trimmed copy of the parent history plus the
      // delegated task as a trailing user turn; isolated starts from just the
      // prompt (byte-for-byte the pre-fork behaviour).
      const childHistory: APIMessageParam[] = forkActive
        ? buildForkSeed(params.parentHistory as APIMessageParam[], params.prompt)
        : [{ role: 'user', content: params.prompt }];
      const sidechainInfo: SidechainInfo = {
        agentType: resolved.type,
        fork: forkActive,
        parentToolUseId: childConfig.parentToolUseId,
        description: taskDescription,
        toolUseId: params.toolUseId,
      };

      // O-B2: retain the child for later SendMessage continuation. `history`
      // is the live array runAgentLoop mutates, so the record's transcript
      // stays current across the initial run and every continuation.
      const record: ChildRecord = {
        agentType: resolved.type,
        description: taskDescription,
        background: isBackground,
        status: 'running',
        history: childHistory,
        deps: childDeps,
        config: childConfig,
        sidechain: sidechainInfo,
        controller: childController,
        queue: Promise.resolve(),
      };
      childRegistry.set(agentId, record);

      if (isBackground) {
        // T2-6 background stall watchdog: a child whose stream goes silent for
        // the resolved window is aborted (env-tunable, 0 disables); touch()
        // rides every stream message via the liveness hook.
        const stallWatchdog = new StallWatchdog({
          timeoutMs: resolveStallTimeoutMs(env),
          onStall: () => childController.abort(),
        });
        const promise = (async (): Promise<void> => {
          try {
            const result = await runChildToCompletion(
              childHistory,
              childDeps,
              childConfig,
              agentId,
              sidechainInfo,
              stallWatchdog,
            );
            // Finding (killAgent race) — only report completion if the task is
            // still RUNNING. If stopTask()/killAgent raced in first (status now
            // 'killed'), respect that terminal decision: do NOT overwrite the
            // status back to completed nor emit a 'completed' notification that
            // contradicts the 'stopped' one the kill site already sent. Mirrors
            // the catch arm's existing `status === 'running'` guard.
            if (record.status === 'running') {
              record.status = result.isError ? 'failed' : 'completed';
              completedBuffer.push({
                type: 'text',
                text: formatTaskNotification({
                  agentId,
                  status: result.isError ? 'failed' : 'completed',
                  summary: `Agent "${taskDescription}" ${
                    result.isError
                      ? `failed: ${resultPreview(result.text)}`
                      : 'completed'
                  }`,
                  result: result.text,
                  usage: result.usage,
                }),
              });
              emitTaskFinished(agentId, result);
              emitTask({
                type: 'system',
                subtype: 'task_notification',
                task_id: agentId,
                ...(params.toolUseId !== '' ? { tool_use_id: params.toolUseId } : {}),
                status: result.isError ? 'failed' : 'completed',
                // No task output files in this engine (official field, required).
                output_file: '',
                summary: `background subagent '${resolved.type}' ${result.isError ? 'failed' : 'completed'}`,
              });
            }
          } catch (err) {
            if (record.status === 'running') record.status = 'failed';
            debug(
              `background subagent ${agentId} failed: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
            // An abort here is a stopTask()/query-close cancellation whose
            // lifecycle events are emitted at the cancellation site — EXCEPT a
            // stall-watchdog abort, which has no cancellation site and must
            // report as failed here; other real failures likewise.
            if (!isAbortError(err) || stallWatchdog.stalled) {
              const message = stallWatchdog.stalled
                ? `stalled: no stream event for ${resolveStallTimeoutMs(env)}ms; aborted by the stall watchdog`
                : err instanceof Error
                  ? err.message
                  : String(err);
              // The model ONLY ever sees completedBuffer (drained onto a later
              // tool_result turn); the emitTask events below are host-visible
              // observability only. Without a completedBuffer entry a stalled or
              // crashed BACKGROUND worker never reaches its coordinator — whose
              // prompt says "workers will notify you when they are done" — so the
              // coordinator waits forever. Surface the failure to the model too
              // (intentional stopTask/close aborts are excluded by the guard).
              completedBuffer.push({
                type: 'text',
                text: formatTaskNotification({
                  agentId,
                  status: 'failed',
                  summary: `Agent "${taskDescription}" failed: ${resultPreview(message)}`,
                  result: message,
                }),
              });
              emitTask({
                type: 'system',
                subtype: 'task_updated',
                task_id: agentId,
                patch: {
                  status: 'failed',
                  end_time: Date.now(),
                  error: resultPreview(message),
                },
              });
              emitTask({
                type: 'system',
                subtype: 'task_notification',
                task_id: agentId,
                ...(params.toolUseId !== '' ? { tool_use_id: params.toolUseId } : {}),
                status: 'failed',
                output_file: '',
                summary: `background subagent '${resolved.type}' failed: ${resultPreview(message)}`,
              });
            }
          } finally {
            stallWatchdog.dispose();
            backgroundTasks.delete(agentId);
            // Worktree cleanup runs on every exit path (incl. abort), before
            // the stop hook; a dirty worktree is kept (never destroy work).
            await releaseWorktree().catch(() => undefined);
            // Fresh signal: the stop hook must fire even after an outer abort.
            await fireSubagentStop(
              agentId,
              resolved.type,
              new AbortController().signal,
            ).catch(() => undefined);
          }
        })();
        backgroundTasks.set(agentId, { controller: childController, promise });
        allBackgroundPromises.push(promise);
        record.queue = promise;
        return {
          content:
            `Launched background subagent '${resolved.type}' ` +
            `(agentId: ${agentId}). Its result will be delivered on a later turn.`,
          isError: false,
          agentId,
          background: true,
        };
      }

      // Foreground: block until the child finishes. Worktree cleanup runs on
      // every exit path (finally covers an abort thrown out of the loop).
      let result: { text: string; isError: boolean; usage: ChildRunUsage };
      const run = (async () =>
        runChildToCompletion(
          childHistory,
          childDeps,
          childConfig,
          agentId,
          sidechainInfo,
        ))();
      record.queue = run.then(
        () => undefined,
        () => undefined,
      );
      try {
        result = await run;
      } catch (err) {
        // Do not clobber a terminal status: killAgent may have set 'killed'
        // before this catch runs — same guard as the background path (audit
        // 2026-07-14 M-11a).
        if (record.status === 'running') record.status = 'failed';
        // killAgent on a FOREGROUND child aborts only that child: resolve the
        // spawn to an error result so the Agent tool returns "stopped" and
        // the PARENT loop continues — rethrowing the AbortError here would
        // propagate through the Agent tool and kill the whole parent query
        // (audit 2026-07-14 M-11c). A genuine parent-side abort (the spawning
        // tool call's signal or the query-wide signal) still rethrows: the
        // parent itself is being cancelled, and swallowing that would fake a
        // completed turn.
        if (
          isAbortError(err) &&
          record.status === 'killed' &&
          !params.signal.aborted &&
          !outerSignal.aborted
        ) {
          // The child is done (stopped); fire its stop hook like every other
          // terminal path, with a fresh signal, never gating the return.
          await fireSubagentStop(
            agentId,
            resolved.type,
            new AbortController().signal,
          ).catch(() => undefined);
          return {
            content: `Subagent was stopped before completing (agentId: ${agentId}).`,
            isError: true,
            agentId,
            background: false,
          };
        }
        throw err;
      } finally {
        await releaseWorktree().catch(() => undefined);
      }
      record.status = result.isError ? 'failed' : 'completed';
      emitTaskFinished(agentId, result);
      // Fire the stop hook with a FRESH signal and swallow its errors, mirroring
      // the background path: the child has already finished (result + usage are
      // computed), so an outer abort landing during the stop-hook await must not
      // reject spawn() and DISCARD the completed answer. The hook is a
      // notification here, not a gate on returning the result.
      await fireSubagentStop(
        agentId,
        resolved.type,
        new AbortController().signal,
      ).catch(() => undefined);
      return {
        content: `${result.text}\n\nagentId: ${agentId}`,
        isError: result.isError,
        agentId,
        background: false,
      };
    };
  }

  // --- O-B2: SendMessage continuation ---------------------------------------

  /** One continuation episode: append the message, re-enter the child loop. */
  async function runContinuation(
    agentId: string,
    record: ChildRecord,
    params: { message: string; signal: AbortSignal },
  ): Promise<{ text: string; isError: boolean; usage: ChildRunUsage }> {
    // A stopped (killed) worker can be continued — official semantics. Its
    // spawn-time controller is already aborted, so mint a fresh one; the old
    // composed signals die with the finished run.
    if (record.controller.signal.aborted) {
      record.controller = new AbortController();
    }
    const contController = record.controller;
    record.status = 'running';
    record.history.push({ role: 'user', content: params.message });
    // Fresh signal composition: the spawn-time ToolContext signal belonged to
    // the ORIGINAL Agent call's turn. A continuation aborts with ITS OWN call
    // signal, the child's controller (stopTask/stopAgent), and the query-wide
    // signal — never the stale spawn-turn signal.
    const contSignal = AbortSignal.any([
      outerSignal,
      params.signal,
      contController.signal,
    ]);
    const contDeps: EngineDeps = {
      ...record.deps,
      toolContext: { ...record.deps.toolContext, signal: contSignal },
    };
    // Stall watchdog for the continuation too (twin of the initial background
    // launch). Without it a SendMessage continuation whose stream goes silent
    // never aborts, so `turn` never settles, the background delivery promise
    // never pushes its <task-notification>, and a coordinator waiting on the
    // reply hangs until whole-query teardown. touch() rides every stream event.
    const stallWatchdog = new StallWatchdog({
      timeoutMs: resolveStallTimeoutMs(env),
      onStall: () => contController.abort(),
    });
    try {
      const result = await runChildToCompletion(
        record.history,
        contDeps,
        record.config,
        agentId,
        record.sidechain,
        stallWatchdog,
      );
      record.status = result.isError ? 'failed' : 'completed';
      emitTaskFinished(agentId, result);
      return result;
    } catch (err) {
      if (record.status === 'running') record.status = 'failed';
      // A stall-watchdog abort has NO cancellation site (unlike stopTask/close,
      // whose notes are emitted at the kill site). Surface it as an error RESULT
      // rather than throwing: for a BACKGROUND continuation the delivery promise
      // only pushes a <task-notification> on the .then (success/error result),
      // so a thrown abort is swallowed by its .catch and the coordinator polling
      // completedBuffer never learns the continuation died. Returning an error
      // result routes through the .then and surfaces a FAILED note — mirroring
      // the initial background run's stallWatchdog.stalled handling.
      if (stallWatchdog.stalled) {
        const message =
          `stalled: no stream event for ${resolveStallTimeoutMs(env)}ms; ` +
          `aborted by the stall watchdog`;
        emitTaskFinished(agentId, { text: message, isError: true });
        return { text: message, isError: true, usage: { totalTokens: 0, toolUses: 0, durationMs: 0 } };
      }
      throw err;
    } finally {
      stallWatchdog.dispose();
    }
  }

  /** Shared kill path for stopTask (Query API) and stopAgent (TaskStop bridge). */
  function killAgent(
    taskId: string,
  ):
    | { outcome: 'stopped'; kind: 'foreground' | 'background' }
    | { outcome: 'not_running'; status: string }
    | { outcome: 'unknown' } {
    const task = backgroundTasks.get(taskId);
    const record = childRegistry.get(taskId);
    if (task === undefined && record === undefined) return { outcome: 'unknown' };
    // Finding (killAgent race) — if the record already reached a TERMINAL status
    // (the child finished, or a prior kill landed), do not abort/clobber it or
    // emit a contradictory 'stopped' notification. This covers the completed→
    // kill direction (the child's completion continuation ran first); the
    // completion body covers the kill→completed direction. Clean up any stale
    // task entry either way.
    if (record !== undefined && record.status !== 'running') {
      backgroundTasks.delete(taskId);
      return { outcome: 'not_running', status: record.status };
    }
    // Word the kill honestly by the record (audit 2026-07-14 M-11b): this
    // path also stops FOREGROUND children (their agentId is registered too),
    // and the old text hardcoded "background". A bare backgroundTasks entry
    // with no record is by construction background.
    const kind: 'foreground' | 'background' =
      record !== undefined && !record.background ? 'foreground' : 'background';
    (task?.controller ?? record?.controller)?.abort();
    backgroundTasks.delete(taskId);
    if (record !== undefined) record.status = 'killed';
    // A killed child is torn down here: emit its single sidechain_end now
    // (is_error: true), idempotently (待裁②). settleAll catches non-killed ones.
    finalizeSidechain(taskId, { error: true });
    // Official patch.status vocabulary has 'killed' (not 'cancelled') for an
    // externally stopped task; the paired notification uses 'stopped'.
    emitTask({
      type: 'system',
      subtype: 'task_updated',
      task_id: taskId,
      patch: { status: 'killed', end_time: Date.now() },
    });
    emitTask({
      type: 'system',
      subtype: 'task_notification',
      task_id: taskId,
      status: 'stopped',
      output_file: '',
      summary: `${kind} subagent "${taskId}" stopped via stopTask`,
    });
    debug(`stopTask: aborted ${kind} subagent "${taskId}"`);
    return { outcome: 'stopped', kind };
  }

  return {
    makeSpawnFn,
    drainCompletedResults,
    drainUsageLedger,
    agentNames(): string[] {
      return [...Object.keys(agents), 'general-purpose'];
    },
    stopTask(taskId: string): void {
      const res = killAgent(taskId);
      if (res.outcome === 'unknown') {
        debug(`stopTask: no subagent with id "${taskId}"`);
      } else if (res.outcome === 'not_running') {
        debug(`stopTask: subagent "${taskId}" already ${res.status}`);
      }
    },
    stopAgent(taskId: string): string | undefined {
      const res = killAgent(taskId);
      if (res.outcome === 'unknown') return undefined;
      if (res.outcome === 'not_running') {
        return `Subagent ${taskId} already ${res.status}.`;
      }
      // Honest wording per record (audit 2026-07-14 M-11b).
      return `Stopped ${res.kind} subagent ${taskId}.`;
    },
    async sendMessage(params: {
      to: string;
      message: string;
      signal: AbortSignal;
    }): Promise<{ content: string; isError: boolean }> {
      const agentId = params.to;
      const record = childRegistry.get(agentId);
      if (record === undefined) {
        const known = [...childRegistry.keys()];
        const hint =
          known.length === 0
            ? 'no subagents have been spawned in this query'
            : `known agentIds: ${known.slice(-8).join(', ')}`;
        return {
          content: `SendMessage: no subagent with agentId "${agentId}" (${hint}).`,
          isError: true,
        };
      }
      // Serialize per agent: queue behind the active run + earlier messages.
      const turn = record.queue.then(() =>
        runContinuation(agentId, record, params),
      );
      record.queue = turn.then(
        () => undefined,
        () => undefined,
      );
      if (record.background) {
        // Official flow for a background agent: ack the delivery now; the
        // reply arrives on a later drained turn as a <task-notification>.
        const delivery = turn
          .then((result) => {
            completedBuffer.push({
              type: 'text',
              text: formatTaskNotification({
                agentId,
                status: result.isError ? 'failed' : 'completed',
                summary: `Agent "${record.description}" ${
                  result.isError
                    ? `failed: ${resultPreview(result.text)}`
                    : 'replied'
                }`,
                result: result.text,
                usage: result.usage,
              }),
            });
            emitTask({
              type: 'system',
              subtype: 'task_notification',
              task_id: agentId,
              status: result.isError ? 'failed' : 'completed',
              output_file: '',
              summary: `background subagent '${record.agentType}' ${
                result.isError ? 'failed' : 'replied'
              }`,
            });
          })
          .catch((err) => {
            debug(
              `SendMessage continuation for ${agentId} failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        allBackgroundPromises.push(delivery);
        return {
          content:
            `Message delivered to background subagent (agentId: ${agentId}). ` +
            'Its reply will be delivered on a later turn.',
          isError: false,
        };
      }
      try {
        const result = await turn;
        return { content: result.text, isError: result.isError };
      } catch (err) {
        // Aborts propagate (same contract as a foreground Agent spawn); real
        // failures degrade to an honest error result.
        if (isAbortError(err)) throw err;
        return {
          content: `SendMessage: continuation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }
    },
    async settleAll(timeoutMs = 2_000): Promise<void> {
      if (allBackgroundPromises.length > 0) {
        await Promise.race([
          Promise.allSettled(allBackgroundPromises),
          new Promise<void>((resolve) => {
            const t = setTimeout(resolve, timeoutMs);
            (t as { unref?: () => void }).unref?.();
          }),
        ]);
      }
      // Query teardown: every started sidechain is now truly done (no further
      // SendMessage continuation can revive it past this point), so emit each
      // child's single sidechain_end (待裁②). Idempotent — a child already
      // finalized by killAgent is skipped.
      for (const agentId of sidechainStarted) finalizeSidechain(agentId);
      // Release transports the resolver handed over with owned: true (AFTER the
      // children settled — a SendMessage continuation can revive a finished
      // child any time before this point).
      disposeOwnedTransports();
    },
    abortAll(): void {
      for (const { controller } of backgroundTasks.values()) {
        controller.abort();
      }
      backgroundTasks.clear();
      // Continuations in flight (not tracked in backgroundTasks) abort via
      // their record controller; completed records are left untouched.
      for (const record of childRegistry.values()) {
        if (record.status === 'running') record.controller.abort();
      }
    },
  };
}
