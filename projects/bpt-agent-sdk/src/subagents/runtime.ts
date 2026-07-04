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
  McpServerStatus,
  ModelUsage,
  NonNullableUsage,
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
};

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
  } = opts;
  const persist = opts.persist === true && store !== undefined;

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
  async function runChildToCompletion(
    history: APIMessageParam[],
    deps: EngineDeps,
    config: EngineConfig,
    agentId: string,
  ): Promise<{ text: string; isError: boolean }> {
    let lastText = '';
    let sawError = false;
    let errMsg: string | undefined;

    for await (const msg of runAgentLoop(history, deps, config)) {
      if (msg.type === 'assistant') {
        const t = concatText(msg.message.content);
        if (t.length > 0) lastText = t;
        if (persist && store !== undefined) {
          store.append(agentId, {
            type: 'assistant',
            timestamp: new Date().toISOString(),
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

    if (!sawError) return { text: lastText, isError: false };
    // Partial-output handling: surface any produced text rather than dropping
    // it, treating a non-empty partial as a soft (non-error) result.
    if (lastText.length > 0) {
      return {
        text: `${lastText}\n\n(subagent did not finish: ${errMsg ?? 'unknown error'})`,
        isError: false,
      };
    }
    return {
      text: `Agent terminated early due to an API error: ${errMsg ?? 'unknown error'}`,
      isError: true,
    };
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

      const childBuiltins = buildChildBuiltins(agentDef, childDepth);
      const childMcp = buildChildMcp(agentDef);
      const childGate = new DefaultPermissionGate({
        mode: agentDef.permissionMode ?? parentGate.getMode(),
        allowedTools,
        disallowedTools: [
          ...(disallowedTools ?? []),
          ...(agentDef.disallowedTools ?? []),
        ],
        canUseTool,
        debug,
      });

      const childConfig: EngineConfig = {
        model: resolveModelAlias(agentDef.model, engineConfig.model),
        fallbackModel,
        maxOutputTokens: engineConfig.maxOutputTokens,
        systemPrompt: agentDef.prompt,
        maxTurns: agentDef.maxTurns,
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
      const childHistory: APIMessageParam[] = [
        { role: 'user', content: params.prompt },
      ];

      if (isBackground) {
        const promise = (async (): Promise<void> => {
          try {
            const result = await runChildToCompletion(
              childHistory,
              childDeps,
              childConfig,
              agentId,
            );
            completedBuffer.push({
              type: 'text',
              text:
                `[background subagent '${resolved.type}' (agentId: ${agentId}) ` +
                `completed]\n${result.text}`,
            });
          } catch (err) {
            debug(
              `background subagent ${agentId} failed: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
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
      );
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
