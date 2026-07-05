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
  /** v0.4 task-lifecycle sink: task_started / task_progress / task_updated /
   *  task_notification messages are pushed here (the runtime cannot yield);
   *  the query layer drains them into the SDKMessage stream. */
  emitObservability?: (msg: SDKMessage) => void;
  /** v0.5 query-wide shell session (shared with children's ToolContext). */
  shells?: ShellManager;
  /** v0.6 sandbox context (shared with children's ToolContext). */
  sandbox?: SandboxContext;
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
  /** Terminal task_updated for a finished (non-cancelled) child. */
  const emitTaskFinished = (agentId: string, res: { text: string; isError: boolean }): void => {
    emitTask({
      type: 'task_updated',
      task_id: agentId,
      status: res.isError ? 'failed' : 'completed',
      ...(res.isError
        ? { error: resultPreview(res.text) }
        : { result: resultPreview(res.text) }),
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
    try {
      const agg = await hooks.run(
        'SubagentStart',
        {
          session_id: sessionId(),
          cwd,
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
    try {
      const agg = await hooks.run(
        'SubagentStop',
        {
          session_id: sessionId(),
          cwd,
          hook_event_name: 'SubagentStop',
          stop_hook_active: false,
          agent_id: agentId,
          agent_type: type,
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
  };

  async function runChildToCompletion(
    history: APIMessageParam[],
    deps: EngineDeps,
    config: EngineConfig,
    agentId: string,
    sidechain: SidechainInfo,
  ): Promise<{ text: string; isError: boolean }> {
    let lastText = '';
    let sawError = false;
    let errMsg: string | undefined;
    // task_progress: turn-budget share consumed. The child's maxTurns is always
    // resolved by spawn() (agentDef -> parent -> DEFAULT), so the denominator
    // is a real cap, not a guess; capped at 99 (100 is the terminal update's).
    const turnCap = config.maxTurns ?? DEFAULT_SUBAGENT_MAX_TURNS;
    let childTurns = 0;

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
      if (msg.type === 'assistant') {
        childTurns += 1;
        emitTask({
          type: 'task_progress',
          task_id: agentId,
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

      emitTask({
        type: 'task_started',
        task_id: agentId,
        task_name: params.description ?? resolved.type,
        agent_id: agentId,
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

      const childConfig: EngineConfig = {
        // Fork inherits the parent model; isolated resolves agentDef.model.
        model: forkActive
          ? engineConfig.model
          : resolveModelAlias(agentDef.model, engineConfig.model),
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
        includePartialMessages: false,
        sessionId: agentId,
        cwd,
        // The loop does not expose the spawning tool_use id to the tool; use a
        // stable correlation id (the child agentId) when the tool passed none.
        parentToolUseId:
          params.toolUseId !== '' ? params.toolUseId : agentId,
      };

      const childController = new AbortController();
      const parentSignal = isBackground ? outerSignal : params.signal;
      const childSignal = AbortSignal.any([parentSignal, childController.signal]);
      const childToolContext: ToolContext = {
        cwd,
        additionalDirectories,
        env,
        signal: childSignal,
        debug,
        spawnSubagent: makeSpawnFn(childDepth),
        // One shell session per query: children see the same background
        // shells and persistent cwd/env as the root loop.
        shells: opts.shells,
        // Children inherit the same sandbox as the root loop.
        sandbox: opts.sandbox,
      };
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
      };

      if (isBackground) {
        const promise = (async (): Promise<void> => {
          try {
            const result = await runChildToCompletion(
              childHistory,
              childDeps,
              childConfig,
              agentId,
              sidechainInfo,
            );
            completedBuffer.push({
              type: 'text',
              text:
                `[background subagent '${resolved.type}' (agentId: ${agentId}) ` +
                `completed]\n${result.text}`,
            });
            emitTaskFinished(agentId, result);
            emitTask({
              type: 'task_notification',
              task_id: agentId,
              event: result.isError ? 'failed' : 'completed',
              message: `background subagent '${resolved.type}' ${result.isError ? 'failed' : 'completed'}`,
            });
          } catch (err) {
            debug(
              `background subagent ${agentId} failed: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
            // An abort here is a stopTask()/query-close cancellation whose
            // lifecycle events are emitted at the cancellation site; only a
            // real failure is reported as failed.
            if (!isAbortError(err)) {
              const message = err instanceof Error ? err.message : String(err);
              emitTask({
                type: 'task_updated',
                task_id: agentId,
                status: 'failed',
                error: resultPreview(message),
              });
              emitTask({
                type: 'task_notification',
                task_id: agentId,
                event: 'failed',
                message: `background subagent '${resolved.type}' failed: ${resultPreview(message)}`,
              });
            }
          } finally {
            backgroundTasks.delete(agentId);
            // Fresh signal: the stop hook must fire even after an outer abort.
            await fireSubagentStop(
              agentId,
              resolved.type,
              new AbortController().signal,
            ).catch(() => undefined);
          }
        })();
        backgroundTasks.set(agentId, { controller: childController, promise });
        return {
          content:
            `Launched background subagent '${resolved.type}' ` +
            `(agentId: ${agentId}). Its result will be delivered on a later turn.`,
          isError: false,
          agentId,
          background: true,
        };
      }

      // Foreground: block until the child finishes.
      const result = await runChildToCompletion(
        childHistory,
        childDeps,
        childConfig,
        agentId,
        sidechainInfo,
      );
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
      emitTask({ type: 'task_updated', task_id: taskId, status: 'cancelled' });
      emitTask({
        type: 'task_notification',
        task_id: taskId,
        event: 'stopped',
        message: `background subagent "${taskId}" stopped via stopTask`,
      });
      debug(`stopTask: aborted background subagent "${taskId}"`);
    },
    abortAll(): void {
      for (const { controller } of backgroundTasks.values()) {
        controller.abort();
      }
      backgroundTasks.clear();
    },
  };
}
