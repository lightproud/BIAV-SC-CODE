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

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
  Transport,
} from '../internal/contracts.js';
import type { CanUseTool } from '../types.js';
import { DefaultPermissionGate } from '../permissions/gate.js';
import { runAgentLoop } from '../engine/loop.js';
import { matchToolName, parseRule } from '../permissions/rules.js';
import { addUsage } from '../engine/pricing.js';
import { resolveTranscriptPath } from '../sessions/store.js';
import {
  StallWatchdog,
  resolveStallTimeoutMs,
} from '../transport/stall-watchdog.js';
import { addWorktree, removeWorktreeIfClean } from '../internal/worktree.js';
import type { ToolContextWithPermissionGate } from '../tools/exitplanmode.js';
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
  /** SpawnSubagentFn bound to a nesting depth (root ToolContext uses depth 0). */
  makeSpawnFn(depth: number): SpawnSubagentFn;
  /** Pull + clear completed background-subagent result notes (root loop drains). */
  drainCompletedResults(): TextBlockParam[];
  /** Pull + reset the accumulated child usage/cost/modelUsage. */
  drainUsageLedger(): SubagentUsageLedger;
  /** Spawnable subagent type names (options.agents keys + 'general-purpose'). */
  agentNames(): string[];
  /** Stop a running background subagent task by id (agentId). */
  stopTask(taskId: string): void;
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
  /** v0.5 query-wide shell session (shared with children's ToolContext). */
  shells?: ShellManager;
  /** v0.6 sandbox context (shared with children's ToolContext). */
  sandbox?: SandboxContext;
  /** E4 read-before-write gate: the query-wide read-paths Set (the SAME
   *  reference as the root ToolContext, so the gate spans the session). */
  readFilePaths?: Set<string>;
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

const execFileP = promisify(execFile);

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
  reconnect(serverName: string): Promise<void> {
    return this.inner.reconnect(serverName);
  }
  setEnabled(serverName: string, enabled: boolean): void {
    this.inner.setEnabled(serverName, enabled);
  }
  setServers(servers: Parameters<McpRegistry['setServers']>[0]) {
    return this.inner.setServers(servers);
  }
  closeAll(): Promise<void> {
    return this.inner.closeAll();
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

  async function runChildToCompletion(
    history: APIMessageParam[],
    deps: EngineDeps,
    config: EngineConfig,
    agentId: string,
    sidechain: SidechainInfo,
    liveness?: { touch(): void },
  ): Promise<{ text: string; isError: boolean }> {
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
      store.append(agentId, {
        type: 'sidechain_start',
        timestamp: new Date().toISOString(),
        agent_type: sidechain.agentType,
        fork: sidechain.fork,
        parent_session_id: sessionId(),
        parent_tool_use_id: parentToolUseId,
        seeded_messages: history.length,
      });
      // Append the seed's final (delegated task) user turn so the recorded
      // sidechain is self-contained.
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

    let result: { text: string; isError: boolean };
    if (!sawError) {
      result = { text: lastText, isError: false };
    } else if (lastText.length > 0) {
      // Partial-output handling: surface any produced text rather than dropping
      // it, treating a non-empty partial as a soft (non-error) result.
      result = {
        text: `${lastText}\n\n(subagent did not finish: ${errMsg ?? 'unknown error'})`,
        isError: false,
      };
    } else {
      result = {
        text: `Agent terminated early due to an API error: ${errMsg ?? 'unknown error'}`,
        isError: true,
      };
    }

    if (recordSidechain && store !== undefined) {
      store.append(agentId, {
        type: 'sidechain_end',
        timestamp: new Date().toISOString(),
        agent_type: sidechain.agentType,
        fork: sidechain.fork,
        is_error: result.isError,
      });
    }
    return result;
  }

  // --- The spawn closure factory -------------------------------------------
  function makeSpawnFn(depth: number): SpawnSubagentFn {
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
        childCwd = wt.dir;
        debug(`subagent ${agentId}: isolation worktree at ${worktreeDir}`);
      }
      /** Post-run worktree cleanup: removed only when left unchanged. */
      const releaseWorktree = async (): Promise<void> => {
        if (worktreeDir === undefined) return;
        const outcome = await removeWorktreeIfClean(cwd, worktreeDir);
        if (outcome === 'kept') {
          debug(
            `subagent ${agentId}: worktree ${worktreeDir} kept ` +
              '(uncommitted changes or git failure)',
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
      await fireSubagentStart(agentId, params.subagentType, params.signal);

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
      } else {
        childBuiltins = buildChildBuiltins(agentDef, childDepth);
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
      const childConfig: EngineConfig = {
        // Fork inherits the parent model; isolated resolves the per-call
        // override, then agentDef.model, through the same alias path.
        model: forkActive
          ? engineConfig.model
          : resolveModelAlias(params.model ?? agentDef.model, engineConfig.model),
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
        thinking: engineConfig.thinking,
        maxThinkingTokens: engineConfig.maxThinkingTokens,
        promptCaching: engineConfig.promptCaching,
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
      };

      const childController = new AbortController();
      const parentSignal = isBackground ? outerSignal : params.signal;
      const childSignal = AbortSignal.any([parentSignal, childController.signal]);
      const childToolContext: ToolContext = {
        cwd: childCwd,
        additionalDirectories,
        env,
        signal: childSignal,
        debug,
        spawnSubagent: makeSpawnFn(childDepth),
        // One shell session per query: children see the same background
        // shells and persistent cwd/env as the root loop. KNOWN LIMIT for
        // worktree isolation: the shared persistent-state replay may `cd` a
        // child Bash call back to the last recorded cwd (outside the
        // worktree); Read/Write/Edit and childConfig.cwd stay confined.
        shells: opts.shells,
        // Children inherit the same sandbox as the root loop.
        sandbox: opts.sandbox,
        // Same SESSION for the read-before-write gate: a parent Read
        // satisfies a child's Write gate and vice versa.
        readFilePaths: opts.readFilePaths,
      };
      // ExitPlanMode bridge: the child flips ITS OWN gate (childGate), never
      // the parent's. Attached via the tool's context extension because the
      // bridge is deliberately not part of the core ToolContext contract.
      (childToolContext as ToolContextWithPermissionGate).permissionGate =
        childGate;
      const childDeps: EngineDeps = {
        transport,
        builtinTools: childBuiltins,
        mcp: childMcp,
        permissions: childGate,
        hooks,
        toolContext: childToolContext,
        debug,
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
            completedBuffer.push({
              type: 'text',
              text:
                `[background subagent '${resolved.type}' (agentId: ${agentId}) ` +
                `completed]\n${result.text}`,
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
          } catch (err) {
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
      let result: { text: string; isError: boolean };
      try {
        result = await runChildToCompletion(
          childHistory,
          childDeps,
          childConfig,
          agentId,
          sidechainInfo,
        );
      } finally {
        await releaseWorktree().catch(() => undefined);
      }
      emitTaskFinished(agentId, result);
      await fireSubagentStop(agentId, resolved.type, params.signal);
      return {
        content: `${result.text}\n\nagentId: ${agentId}`,
        isError: result.isError,
        agentId,
        background: false,
      };
    };
  }

  return {
    makeSpawnFn,
    drainCompletedResults,
    drainUsageLedger,
    agentNames(): string[] {
      return [...Object.keys(agents), 'general-purpose'];
    },
    stopTask(taskId: string): void {
      const task = backgroundTasks.get(taskId);
      if (task === undefined) {
        debug(`stopTask: no background subagent with id "${taskId}"`);
        return;
      }
      task.controller.abort();
      backgroundTasks.delete(taskId);
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
        summary: `background subagent "${taskId}" stopped via stopTask`,
      });
      debug(`stopTask: aborted background subagent "${taskId}"`);
    },
    async settleAll(timeoutMs = 2_000): Promise<void> {
      if (allBackgroundPromises.length === 0) return;
      await Promise.race([
        Promise.allSettled(allBackgroundPromises),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, timeoutMs);
          (t as { unref?: () => void }).unref?.();
        }),
      ]);
    },
    abortAll(): void {
      for (const { controller } of backgroundTasks.values()) {
        controller.abort();
      }
      backgroundTasks.clear();
    },
  };
}
