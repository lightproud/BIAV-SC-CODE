/**
 * query() - the public entry point.
 *
 * Wires transport, built-in tools, permission gate, hook runner, MCP
 * registry and the JSONL session store around the engine loop, and wraps
 * the resulting async generator in the Query control interface.
 */

import { randomUUID } from 'node:crypto';

import { AbortError, ConfigurationError, isAbortError } from './errors.js';
import type {
  AgentInfo,
  APIMessageParam,
  APIUserMessage,
  CallToolResult,
  ContentBlock,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
  ModelInfo,
  ModelUsage,
  NonNullableUsage,
  Options,
  PermissionMode,
  Query,
  RewindFilesResult,
  SDKControlInitializeResponse,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKMirrorErrorMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SlashCommand,
  TextBlockParam,
} from './types.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  McpRegistry,
  McpToolEntry,
  SystemComposition,
  SystemCompositionPart,
  ToolContext,
  ToolDispatchRecord,
  Transport,
} from './internal/contracts.js';
import { createProviderTransport } from './transport/factory.js';
import { DefaultPermissionGate } from './permissions/gate.js';
import { DefaultHookRunner } from './hooks/runner.js';
import { DefaultMcpRegistry } from './mcp/registry.js';
import { matchToolName, parseRule } from './permissions/rules.js';
import { runAgentLoop } from './engine/loop.js';
import { hasPriceFor } from './engine/pricing.js';
import {
  expandSlashCommand,
  loadSlashCommands,
  pureTextOf,
  slashCommandInfos,
} from './engine/slash-commands.js';
import { SessionAccounting } from './query-accounting.js';
import { appendSystemInjection, buildEngineConfig } from './engine/config-builder.js';
import {
  MEMORY_COMPACTION_FLUSH_PROMPT,
  MEMORY_PROTOCOL_FRAGMENT,
  MEMORY_SESSION_END_PROMPT,
} from './engine/prompt-fragments.js';
import { estimateTextTokens } from './engine/tokens.js';
import { MEMORY_TOOL_NAME, resolveMemoryRuntime } from './tools/memory/index.js';
import { createSessionPersistence } from './sessions/persistence.js';
import { AsyncQueue, createDeferred, type Deferred } from './internal/async.js';
import { ToolFilterMcpRegistry } from './mcp/tool-filter.js';
import { SDK_VERSION } from './version.js';
import { JsonlSessionStore, resolveTranscriptPath } from './sessions/store.js';
import { MirroringSessionStore, encodeProjectKey } from './sessions/store-adapter.js';
import { FileCheckpointStore } from './sessions/checkpoints.js';
import {
  DeferredMcpRegistry,
  makeToolSearchTool,
  type DeferredBuiltinEntry,
} from './tools/toolsearch.js';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBuiltinTools, DEFAULT_DEFERRED_BUILTINS } from './tools/index.js';
import { createShellManager } from './tools/shells.js';
import { peekWorktreeSession } from './tools/enterworktree.js';
import { resolveSandboxBackend } from './sandbox/backend.js';
import type { SandboxContext } from './types.js';
import { createSubagentRuntime } from './subagents/runtime.js';
import { createAgentTool } from './subagents/agent-tool.js';
import { loadProjectMcpServers } from './mcp/project-config.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/** S3 tool-call record: cap on the persisted input JSON (the full input lives
 *  in the assistant message's tool_use block with the same tool_use_id). */
const TOOL_RECORD_INPUT_MAX_CHARS = 2048;
const CLAUDE_CODE_VERSION = SDK_VERSION;

/** Static model list surfaced by supportedModels()/initializationResult(). */
const SUPPORTED_MODELS: readonly ModelInfo[] = [
  { value: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
  { value: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
];

/**
 * Options accepted for @anthropic-ai/claude-agent-sdk type/runtime compat
 * but with no behavior (see docs/COMPAT.md). Each present key emits exactly
 * one debug warning. Since B2b (T2-3, 2026-07-05) every key below is ALSO on
 * the TS Options type with an honest support-level JSDoc, so official-SDK
 * object literals pass excess-property checking; runtime semantics are
 * unchanged (ACCEPTED-IGNORED).
 */
const ACCEPTED_OPTION_KEYS: readonly string[] = [
  // Official @anthropic-ai/claude-agent-sdk Options fields this SDK accepts for
  // migration compatibility but does not act on (audit v0.1.1): each present
  // key emits exactly one debug warning instead of being silently ignored.
  // (v0.2 removed: agents, outputFormat, onElicitation, sessionStore,
  //  enableFileCheckpointing, loadTimeoutMs -> now executed.)
  'agent',
  'settings',
  'permissionPromptToolName',
  'extraArgs',
  // settingSources REMOVED from this list (audit 2026-07-10 P0-5): it has real
  // behavior — it drives CLAUDE.md/AGENTS.md loading (preset/default path) and
  // project .mcp.json loading (all paths) — so the "has no effect" diagnostic
  // was a lie.
  'effort',
  'plugins',
  'skills',
  'toolAliases',
  'toolConfig',
  'managedSettings',
  'taskBudget',
  'planModeInstructions',
  'promptSuggestions',
  'agentProgressSummaries',
  'forwardSubagentText',
  'title',
  'resumeSessionAt',
  'pathToClaudeCodeExecutable',
  'executable',
  'executableArgs',
  'spawnClaudeCodeProcess',
];

// ---------------------------------------------------------------------------
// Small local utilities
// ---------------------------------------------------------------------------

const zeroUsage = (): NonNullableUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

/** Sum two usage records (session-wide accumulation across streaming turns). */

/** Plain text view of a user message (for hooks and session meta). */
function promptTextOf(message: APIUserMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b): b is TextBlockParam => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Append hook additionalContext lines to a user message's content. */
function appendContextLines(
  message: APIUserMessage,
  lines: string[],
): APIUserMessage {
  if (lines.length === 0) return message;
  if (typeof message.content === 'string') {
    const base = message.content;
    return {
      role: 'user',
      content: base.length > 0 ? `${base}\n${lines.join('\n')}` : lines.join('\n'),
    };
  }
  const extra = lines.map((text): TextBlockParam => ({ type: 'text', text }));
  return { role: 'user', content: [...message.content, ...extra] };
}



// ---------------------------------------------------------------------------
// query()
// ---------------------------------------------------------------------------

/**
 * @internal Shared-collaborator injection seam for the SessionManager
 * (src/session-manager.ts). NOT public API — the public Options surface is
 * unchanged and standalone query() behavior is byte-identical when this is
 * absent.
 *
 * Ownership contract (谁拥有谁拆 / "whoever constructs it closes it"):
 * a field left undefined means query() constructs its OWN collaborator and
 * tears it down exactly as before; a field provided means the collaborator is
 * BORROWED — the injector (the SessionManager) owns its lifecycle and this
 * query must never close it. Query-scoped resources (shells, sandbox tmp dir,
 * checkpoint store) are always owned and reclaimed by the query itself.
 */
export type QueryInternalInjection = {
  /** Shared Messages-API transport. Stateless per-request (each stream() is an
   *  independent fetch+SSE) so borrowing needs no teardown at all. */
  transport?: Transport;
  /** Shared MCP registry (manager-owned, already connect-coalesced). The query
   *  must NOT closeAll() it — sibling conversations are multiplexing the same
   *  server connections. */
  mcpRegistry?: McpRegistry;
};

export function query(args: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
  /** @internal See QueryInternalInjection. Absent for all public callers. */
  _internal?: QueryInternalInjection;
}): Query {
  const { prompt } = args;
  const options: Options = args.options ?? {};

  // --- Base option resolution ----------------------------------------------
  const cwd = options.cwd ?? process.cwd();
  const env: Record<string, string | undefined> = options.env ?? process.env;

  const debugEnabled = options.debug === true;
  const stderrCb = options.stderr;
  const debugFilePath = options.debugFile;
  const debug = (msg: string): void => {
    if (!debugEnabled) return;
    const line = `[silver-core-sdk] ${msg}\n`;
    if (stderrCb !== undefined) stderrCb(line);
    else process.stderr.write(line);
    // P2 parity: when `debugFile` is set, also persist each debug line to it.
    // Best-effort append (mirrors the session store): a debug-write failure must
    // never crash the run, so errors are swallowed.
    if (debugFilePath !== undefined) {
      try {
        appendFileSync(debugFilePath, line, 'utf8');
      } catch {
        // ignore — debug file is a diagnostic aid, not load-bearing
      }
    }
  };

  // ACCEPTED-IGNORED keys present on this call: still one debug line each, but
  // ALSO surfaced once as a typed `informational` stream message after init
  // (audit 2026-07-10 P1-6/#6) — a consumer without debug:true otherwise has
  // no way to learn a knob it set is silently inert.
  const presentAcceptedKeys: string[] = [];
  for (const key of ACCEPTED_OPTION_KEYS) {
    if ((options as Record<string, unknown>)[key] !== undefined) {
      presentAcceptedKeys.push(key);
      debug(
        `option '${key}' is accepted for compatibility but has no effect in this SDK (see docs/COMPAT.md)`,
      );
    }
  }

  const initialModel = options.model ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // --- Collaborators ---------------------------------------------------------
  const outer = options.abortController ?? new AbortController();
  // S2 incognito: zero SDK-side persistence. Forces the transcript writes off
  // (below), degrades memory to read-only (resolveMemoryRuntime), disables the
  // R7 write rounds and suppresses S3 tool-call records (all persist-gated).
  const incognito = options.incognito === true;
  if (incognito && options.sessionStore !== undefined) {
    throw new ConfigurationError(
      'sessionStore cannot be combined with incognito:true (an incognito ' +
        'session persists nothing)',
    );
  }
  const persist = !incognito && options.persistSession !== false;
  if (options.sessionStore !== undefined && !persist) {
    throw new ConfigurationError(
      'sessionStore cannot be combined with persistSession:false',
    );
  }
  if (options.sessionStore !== undefined && options.enableFileCheckpointing === true) {
    throw new ConfigurationError(
      'sessionStore cannot be combined with enableFileCheckpointing',
    );
  }
  const localStore = new JsonlSessionStore({
    sessionDir: options.sessionDir,
    env,
    debug,
  });
  const store =
    options.sessionStore !== undefined
      ? new MirroringSessionStore(localStore, options.sessionStore, {
          projectKey: encodeProjectKey(cwd),
          flush: options.sessionStoreFlush ?? 'batched',
          loadTimeoutMs: options.loadTimeoutMs ?? 60000,
          debug,
        })
      : localStore;
  // Shared-coordination seam (SessionManager 甲): an injected transport is
  // borrowed (manager-owned, stateless requester — nothing to tear down);
  // otherwise construct our own exactly as before.
  const injected = args._internal;
  const transport: Transport =
    injected?.transport ??
    createProviderTransport({
      provider: options.provider,
      env,
      debug,
      betas: options.betas,
    });
  // Safety interlock: bypassPermissions must be explicitly unlocked with
  // allowDangerouslySkipPermissions (matches @anthropic-ai/claude-agent-sdk).
  // Enforced for the initial mode here and for setPermissionMode() below.
  const allowDangerousBypass = options.allowDangerouslySkipPermissions === true;
  const assertBypassUnlocked = (mode: PermissionMode | undefined): void => {
    if (mode === 'bypassPermissions' && !allowDangerousBypass) {
      throw new ConfigurationError(
        "permissionMode 'bypassPermissions' requires allowDangerouslySkipPermissions: true",
      );
    }
  };
  assertBypassUnlocked(options.permissionMode);

  // Memory system (BPT-EXTENSION, docs/MEMORY.md): resolve Options.memory into
  // the store + assembly mode + builtin. Resolved BEFORE the permission gate so
  // the tool can ride an implicit allowedTools entry (official parity: memory
  // operations never permission-prompt; plan mode still denies writes). A
  // bare-name disallowedTools 'memory' entry disables the system outright.
  const memoryEnabled =
    options.memory !== undefined &&
    options.memory.enabled !== false &&
    !(options.disallowedTools ?? [])
      .filter((raw) => parseRule(raw).specifier === undefined)
      .some((pattern) => matchToolName(pattern, MEMORY_TOOL_NAME));
  const memory = memoryEnabled
    ? resolveMemoryRuntime({
        memory: options.memory!,
        cwd,
        protocol: options.provider?.protocol === 'openai-chat' ? 'openai-chat' : 'anthropic',
        incognito,
        debug,
      })
    : null;
  if (options.memory !== undefined && memory === null) {
    debug('memory: configured but disabled (enabled:false or bare-name disallowed)');
  }

  const gate = new DefaultPermissionGate({
    mode: options.permissionMode,
    allowedTools:
      memory !== null
        ? [...(options.allowedTools ?? []), MEMORY_TOOL_NAME]
        : options.allowedTools,
    disallowedTools: options.disallowedTools,
    canUseTool: options.canUseTool,
    debug,
  });
  // v0.4 observability queue: the subagent runtime (task_* lifecycle) and the
  // hook runner (hook_started/hook_response, behind includeHookEvents) cannot
  // yield into the stream, so they push here; the engine loop and this layer's
  // message pump drain it at message boundaries. Single queue, splice-drained:
  // each event surfaces exactly once, in production order.
  const obsQueue: SDKMessage[] = [];
  const emitObs = (msg: SDKMessage): void => {
    obsQueue.push(msg);
  };
  const drainObservability = (): SDKMessage[] => obsQueue.splice(0, obsQueue.length);

  // v0.5 shell session state: background shells (Bash run_in_background /
  // BashOutput / KillShell) + the persistent foreground cwd/env snapshot.
  // Shared with subagents (one shell session per query); disposed on exit.
  const shells = createShellManager(debug);

  // v0.6 sandbox (G-SANDBOX): resolve a backend (default-on when bwrap is
  // available on Linux) and build the per-query sandbox context. Absent ->
  // Bash runs unsandboxed and no sandbox guidance is emitted.
  const sandboxBackend = resolveSandboxBackend(options.sandbox, debug);
  let sandboxCtx: SandboxContext | undefined;
  let sandboxTmpDir = '';
  if (sandboxBackend !== null) {
    try {
      sandboxTmpDir = mkdtempSync(join(tmpdir(), 'bpt-sbx-'));
    } catch {
      sandboxTmpDir = '';
    }
    const sbxOpt = typeof options.sandbox === 'object' ? options.sandbox : undefined;
    const writablePaths = [
      cwd,
      ...(options.additionalDirectories ?? []),
      ...(sbxOpt?.writablePaths ?? []),
      ...(shells.stateDir !== '' ? [shells.stateDir] : []),
      ...(sandboxTmpDir !== '' ? [sandboxTmpDir] : []),
    ];
    sandboxCtx = {
      backend: sandboxBackend,
      tmpDir: sandboxTmpDir,
      writablePaths,
      allowNetwork: sbxOpt?.allowNetwork === true,
      allowEscape: sbxOpt?.allowEscape !== false,
    };
    debug(
      `sandbox: ACTIVE (backend=${sandboxBackend.name}, network=` +
        `${sandboxCtx.allowNetwork ? 'on' : 'off'}, escape=` +
        `${sandboxCtx.allowEscape ? 'allowed' : 'mandatory'})`,
    );
  }

  // Read-before-write gate state (E4): one shared Set per query. The subagent
  // runtime threads the SAME reference into child contexts (like shells /
  // sandbox), so "this session has read the file" spans parent and children.
  const readFilePaths = new Set<string>();
  // Stable per-query identity for WeakMap-keyed tool state (audit 2026-07-10
  // F6): worktree sessions / task stores key on THIS object, not on the
  // readFilePaths Set's identity.
  const toolSessionKey: object = {};

  const hooks = new DefaultHookRunner({
    hooks: options.hooks,
    debug,
    onLifecycleEvent: options.includeHookEvents === true ? emitObs : undefined,
    // v0.6 condition-gated matchers: thread the session credentials so a
    // matcher's `condition` can be evaluated (bounded single-shot call). A
    // matcher without a condition never triggers a call.
    conditionOptions: { provider: options.provider, betas: options.betas, env, debug },
    failureMode: options.hookFailureMode,
  });

  // Bare-name disallowedTools entries (no `Tool(spec)` specifier) REMOVE the
  // tool definition from the model request entirely (audit v0.1.1 P0): the
  // model must never see a fully-denied tool. Scoped `Tool(spec)` entries keep
  // a specifier and stay call-time gate decisions, so they are excluded here.
  const bareDisallowed: string[] = (options.disallowedTools ?? []).filter(
    (raw) => parseRule(raw).specifier === undefined,
  );
  const isBareDisallowed = (toolName: string): boolean =>
    bareDisallowed.some((pattern) => matchToolName(pattern, toolName));

  // Merge project .mcp.json servers (when settingSources includes 'project')
  // under the explicit options.mcpServers (which win on key collision).
  //
  // Shared-coordination seam (SessionManager 甲): an injected registry replaces
  // local construction entirely — the server set comes from the shared layer
  // (D1: no per-query private MCP overlay in v1), so no local merge happens
  // and `ownsMcp` gates every teardown site below (谁拥有谁拆: the query only
  // closes a registry it constructed itself; a borrowed one stays connected
  // for sibling conversations and is closed by SessionManager.close() alone).
  const ownsMcp = injected?.mcpRegistry === undefined;
  const projectServers = ownsMcp
    ? loadProjectMcpServers(cwd, options.settingSources, debug)
    : {};
  const mergedServers: Record<string, McpServerConfig> = {
    ...projectServers,
    ...(ownsMcp ? (options.mcpServers ?? {}) : {}),
  };
  // P2 parity: track config provenance for mcpServerStatus().scope. `.mcp.json`
  // servers are 'project'; programmatic options.mcpServers are 'local' (they win
  // over a same-named project entry, matching the merge order above). A server
  // that appears in statuses() but not here (added later via setMcpServers) is
  // reported 'dynamic'.
  const mcpScopeByName = new Map<string, 'project' | 'local'>();
  for (const name of Object.keys(projectServers)) mcpScopeByName.set(name, 'project');
  if (ownsMcp) {
    for (const name of Object.keys(options.mcpServers ?? {}))
      mcpScopeByName.set(name, 'local');
  }

  // Custom slash commands (.claude/commands, project + user per settingSources),
  // loaded ONCE at query construction — the set is static for the query's
  // lifetime, so commands_changed still has no source event (docs/COMPAT.md).
  const customSlashCommands = loadSlashCommands(cwd, options.settingSources);
  const realMcp: McpRegistry =
    injected?.mcpRegistry ??
    new DefaultMcpRegistry({
      servers: mergedServers,
      env,
      debug,
      elicitation: options.onElicitation,
    });
  // Configured MCP server count: drives ToolSearch deferral and MCP resource
  // tool visibility. On the borrowed path the shared registry is the source of
  // truth (statuses() lists every registered server, connected or not).
  const mcpServerCount = ownsMcp
    ? Object.keys(mergedServers).length
    : realMcp.statuses().length;
  const mcp: McpRegistry =
    bareDisallowed.length > 0
      ? new ToolFilterMcpRegistry(realMcp, isBareDisallowed)
      : realMcp;
  // Tool-search: defer tool schemas behind a ToolSearch builtin. MCP tools
  // defer when servers are configured (auto-activates past the threshold, or
  // forced by options.toolSearch). Unified extension: `toolSearch: true` ALSO
  // defers the cold built-in set (attached below), so it must construct the
  // registry even with zero MCP servers — that is where the ~16k of resident
  // built-in schemas is reclaimed. When null, mcpEff === mcp (exact v0.1
  // behavior: every tool inline).
  const deferred =
    options.toolSearch !== false && (mcpServerCount > 0 || options.toolSearch === true)
      ? new DeferredMcpRegistry(mcp, { debug })
      : null;
  const mcpEff: McpRegistry = deferred ?? mcp;

  // Built-in tools, optionally filtered by the array form of options.tools
  // (the claude_code preset and undefined both mean "all built-ins").
  const allBuiltins = createBuiltinTools({
    sandbox: sandboxCtx,
    readLimits: options.readLimits,
  });
  let builtinTools: Map<string, BuiltinTool>;
  if (Array.isArray(options.tools)) {
    builtinTools = new Map();
    for (const name of options.tools) {
      const t = allBuiltins.get(name);
      if (t !== undefined) builtinTools.set(name, t);
      else debug(`options.tools: unknown built-in tool '${name}' ignored`);
    }
  } else {
    builtinTools = allBuiltins;
  }
  // The MCP resource tools are only advertised by default when MCP servers
  // exist (they are no-ops otherwise). An explicit options.tools selection is
  // honored verbatim.
  if (!Array.isArray(options.tools) && mcpServerCount === 0) {
    builtinTools.delete('ListMcpResourcesTool');
    builtinTools.delete('ReadMcpResourceTool');
  }
  // Drop bare-name-disallowed built-ins so their definitions never reach the
  // model (nor the system prompt tool list nor the init message).
  for (const name of [...builtinTools.keys()]) {
    if (isBareDisallowed(name)) {
      builtinTools.delete(name);
      debug(
        `disallowedTools: built-in tool '${name}' removed from the model request (bare-name deny)`,
      );
    }
  }

  // Register the Agent (subagent) tool when not bare-disallowed and not filtered
  // out by an array-form options.tools.
  const agentDefs = options.agents ?? {};
  const agentNames = [...Object.keys(agentDefs), 'general-purpose'];
  const wantAgent =
    !isBareDisallowed('Agent') &&
    (!Array.isArray(options.tools) || options.tools.includes('Agent'));
  if (wantAgent) builtinTools.set('Agent', createAgentTool(agentNames));

  // Unified tool-search: register the cold built-in set on the deferred registry
  // so the ONE ToolSearch builtin can lazily load them. Only when the caller
  // opted in (`toolSearch: true`) — the default path (undefined) never defers a
  // built-in, keeping the drop-in request shape byte-identical. Built from the
  // FINAL map, so a bare-disallowed tool is never offered here, and only names
  // actually present are deferred (the Task quartet XOR TodoWrite). ToolSearch
  // and Agent are absent from the cold set, so they always stay inline.
  if (deferred !== null && options.toolSearch === true) {
    const cold: DeferredBuiltinEntry[] = [];
    for (const name of DEFAULT_DEFERRED_BUILTINS) {
      const t = builtinTools.get(name);
      if (t !== undefined) {
        cold.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    }
    deferred.attachColdBuiltins(cold);
  }

  // EngineConfig assembly extracted to engine/config-builder.ts (audit
  // 2026-07-10 P2-3C): structured-output normalization, system-prompt shapes
  // + composition breakdown, preset thinking default, the config literal.
  const { engineConfig, outputFormat, sessionGitBranch, isClaudeCodePreset } = buildEngineConfig({
    options,
    cwd,
    initialModel,
    builtinToolNames: [...builtinTools.keys()],
    debug,
  });
  // Memory mode A ("native"): advertise the official typed entry verbatim;
  // the memory BUILTIN below stays the execution loop but its schema is not
  // advertised (see EngineConfig.serverTools). Set on the ROOT config only —
  // the subagent runtime derives child configs field-by-field, so children
  // never inherit it (memory is main-loop-only in v1).
  if (memory?.serverTools !== undefined) {
    engineConfig.serverTools = memory.serverTools;
  }
  // Memory spec R7: arm the engine's pre-compaction flush turn (one write
  // opportunity before each fold). Root config only — child configs are
  // derived field-by-field, so subagents never flush (they have no memory
  // tool).
  if (memory !== null && memory.flushOnCompaction) {
    engineConfig.memoryFlush = { prompt: MEMORY_COMPACTION_FLUSH_PROMPT };
  }

  // S3 structured tool-call records (governance spec): one `tool_call` line in
  // the session JSONL per dispatched tool_use block — same level as the
  // message lines, machine-readable by `type`, so "the model SAID it called a
  // tool" is always checkable against "a call actually dispatched"
  // (getSessionToolCalls / auditToolClaims read them back). Persist-gated:
  // persistSession:false and incognito (S2) write zero records. The input is
  // truncated JSON — the untruncated input lives in the assistant message's
  // tool_use block under the same tool_use_id.
  let toolCallSeq = 0;
  const persistToolRecord = (rec: ToolDispatchRecord): void => {
    if (!persist || resolvedSessionId === '') return;
    toolCallSeq += 1;
    let inputJson: string;
    try {
      inputJson = JSON.stringify(rec.input) ?? 'null';
    } catch {
      inputJson = '"[unserializable input]"';
    }
    if (inputJson.length > TOOL_RECORD_INPUT_MAX_CHARS) {
      inputJson = `${inputJson.slice(0, TOOL_RECORD_INPUT_MAX_CHARS)}…[truncated]`;
    }
    store.append(resolvedSessionId, {
      type: 'tool_call',
      uuid: randomUUID(),
      session_id: resolvedSessionId,
      seq: toolCallSeq,
      timestamp: rec.startedAt,
      tool_use_id: rec.toolUseId,
      tool_name: rec.toolName,
      tool_input: inputJson,
      status: rec.status,
      duration_ms: rec.durationMs,
      result_summary: rec.resultSummary,
      ...(rec.parentToolUseId !== undefined
        ? { parent_tool_use_id: rec.parentToolUseId }
        : {}),
    });
  };

  // Subagent runtime: hands out per-depth spawn closures + drains child results
  // and usage. Children get the real (unfiltered) MCP registry and apply their
  // own per-child tool filtering.
  const subagentRuntime = createSubagentRuntime({
    agents: agentDefs,
    baseBuiltins: builtinTools,
    mcp: realMcp,
    transport,
    hooks,
    parentGate: gate,
    canUseTool: options.canUseTool,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    engineConfig,
    store,
    persist,
    cwd,
    env,
    additionalDirectories: options.additionalDirectories ?? [],
    fallbackModel: options.fallbackModel,
    outerSignal: outer.signal,
    sessionId: () => resolvedSessionId,
    debug,
    emitObservability: emitObs,
    shells,
    sandbox: sandboxCtx,
    readFilePaths,
    sessionKey: toolSessionKey,
    onToolRecord: persistToolRecord,
  });

  // Memory tool registration — MAIN LOOP ONLY (v1): a cloned map so the
  // subagent runtime's baseBuiltins (captured above) never sees it. In native
  // mode the entry is the execution loop for the server-declared tool; in
  // custom mode it is advertised like any other builtin.
  const mainLoopBuiltins =
    memory !== null
      ? new Map(builtinTools).set(MEMORY_TOOL_NAME, memory.tool)
      : builtinTools;

  // --- Input queue (unified for string and streaming-input modes) -----------
  const streamingMode = typeof prompt !== 'string';
  const queue = new AsyncQueue<SDKUserMessage>();
  let producers = 0;

  async function pump(source: AsyncIterable<SDKUserMessage>): Promise<void> {
    producers += 1;
    try {
      for await (const message of source) {
        if (!queue.push(message)) break; // closed underneath us
      }
    } catch (err) {
      if (!isAbortError(err)) {
        debug(
          `query: input stream threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      queue.fail(err);
    } finally {
      producers -= 1;
      if (producers === 0) queue.close();
    }
  }

  if (streamingMode) {
    void pump(prompt as AsyncIterable<SDKUserMessage>);
  } else {
    queue.push({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: prompt as string },
      parent_tool_use_id: null,
    });
    queue.close();
  }

  // --- Shared run state -------------------------------------------------------
  let turnController: AbortController | null = null;
  let interruptRequested = false;
  let closed = false;
  let sessionEndFired = false;
  let resolvedSessionId = '';
  let checkpointStore: FileCheckpointStore | null = null;
  // Official BaseHookInput.transcript_path for a query-layer hook: the main
  // session's transcript when persisted to a path-backed store, else omitted.
  const transcriptField = (sid: string): { transcript_path?: string } => {
    const tp = persist ? resolveTranscriptPath(store, sid) : undefined;
    return tp !== undefined ? { transcript_path: tp } : {};
  };
  const initDeferred = createDeferred<SDKControlInitializeResponse>();

  // Wake any pending input read when the outer controller aborts, and settle a
  // still-pending initializationResult() so awaiters never hang. A pre-aborted
  // controller never fires the event, so check up front. The listener is a
  // NAMED function removed on completion/close so reusing one AbortController
  // across many queries does not leak a listener per query (finding #16).
  const onOuterAbort = (): void => {
    if (!initDeferred.settled) {
      initDeferred.reject(
        new AbortError('The query was aborted before initialization completed'),
      );
    }
    queue.fail(new AbortError('The query was aborted'));
  };
  if (outer.signal.aborted) {
    onOuterAbort();
  } else {
    outer.signal.addEventListener('abort', onOuterAbort);
  }

  async function fireSessionEnd(reason: string): Promise<void> {
    if (sessionEndFired) return;
    sessionEndFired = true;
    if (!hooks.hasHooks('SessionEnd')) return;
    try {
      // Fresh signal: SessionEnd must be able to run after the outer abort.
      const agg = await hooks.run(
        'SessionEnd',
        {
          session_id: resolvedSessionId,
          cwd,
          ...transcriptField(resolvedSessionId),
          hook_event_name: 'SessionEnd',
          reason,
        },
        undefined,
        undefined,
        new AbortController().signal,
      );
      for (const m of agg.systemMessages) debug(`SessionEnd hook: ${m}`);
    } catch (err) {
      debug(
        `SessionEnd hooks failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Persistence + session resolution extracted to sessions/persistence.ts
  // (audit 2026-07-10 P2-3B): message appends, the §5.2 WAL checkpoint pair,
  // and resume/fork/continue resolution.
  const {
    persistParam,
    persistAssistant,
    persistPendingTurn,
    persistTurnComplete,
    resolveSession,
  } = createSessionPersistence({
    store,
    persist,
    options,
    cwd,
    sessionGitBranch,
    debug,
  });

  // --- The run generator -------------------------------------------------------
  async function* run(): AsyncGenerator<SDKMessage, void> {
    const startedAt = Date.now();
    let endReason = 'exit';

    // Session-wide accumulators (finding #33). In streaming-input mode the
    // engine loop runs once per user turn with its own fresh per-turn counters;
    // these carry the running totals across turns so maxBudgetUsd / maxTurns
    // are enforced SESSION-wide. Reporting follows the official per-result
    // semantics (E2, KD-L5-04 pinned live from run 28736460533): num_turns and
    // usage on each result are THAT turn's own figures, while total_cost_usd
    // and duration_api_ms report the session-cumulative (strictly increasing)
    // totals - enforcement stays cumulative, only the report fields differ.
    // Session accounting extracted to query-accounting.ts (audit 2026-07-10
    // P2-3A): additive counters + the single ModelUsage merge rule.
    const acct = new SessionAccounting();

    // Common fields for QUERY-LAYER synthetic results (hook-block, pre-turn
    // session-cap stop, interrupt): no engine turn ran for THIS result, so the
    // per-result fields are zero (E2) and the cumulative fields report the
    // session totals. The official shape for these paths is unobserved.
    const resultCommon = () => ({
      duration_ms: Date.now() - startedAt,
      duration_api_ms: acct.apiMs,
      num_turns: 0,
      total_cost_usd: acct.cost,
      usage: zeroUsage(),
      modelUsage: acct.snapshotModelUsage(),
      permission_denials: gate.denials(),
    });

    const terminalResult = (
      subtype: 'error_during_execution' | 'error_max_budget_usd' | 'error_max_turns',
      sessionId: string,
      errorMessage: string,
    ): SDKResultMessage => ({
      type: 'result',
      subtype,
      uuid: randomUUID(),
      session_id: sessionId,
      is_error: true,
      errorMessage,
      // Official surface: stop_reason is required on the error arm. These are
      // QUERY-LAYER synthetic results (no engine turn ran), so null is the
      // honest value — no API stop_reason exists for this result.
      stop_reason: null,
      // Official-surface parallel of errorMessage (reference SDK: string[]).
      errors: [errorMessage],
      ...resultCommon(),
    });

    const blockedResult = (
      sessionId: string,
      errorMessage: string,
    ): SDKResultMessage =>
      terminalResult('error_during_execution', sessionId, errorMessage);

    /** Drain any queued mirror-error system messages from the session store. */
    const drainMirror = function* (): Generator<SDKMirrorErrorMessage> {
      if (store instanceof MirroringSessionStore) {
        for (const e of store.takePendingEvents()) yield e;
      }
    };

    /** v0.4: flush buffered task/hook lifecycle events into the stream. */
    const drainObs = function* (): Generator<SDKMessage> {
      for (const m of drainObservability()) yield m;
    };

    /**
     * Rewrite an engine-turn result to the OFFICIAL reporting semantics (E2,
     * KD-L5-04): num_turns and usage pass through as THIS turn's own figures
     * (the engine already reports per-run values); total_cost_usd and
     * duration_api_ms are rewritten to the session-cumulative totals (the
     * accumulators were just updated with this result, so the cumulative
     * value includes it - deltas between consecutive results recover the
     * per-turn figures). modelUsage stays session-cumulative: the official
     * per-result semantics for it are unobserved (COMPAT notes our choice).
     */
    const rewriteResult = (r: SDKResultMessage): SDKResultMessage => ({
      ...r,
      total_cost_usd: acct.cost,
      duration_api_ms: acct.apiMs,
      modelUsage: acct.snapshotModelUsage(),
    });

    try {
      const sess = await resolveSession();
      resolvedSessionId = sess.sessionId;
      engineConfig.sessionId = sess.sessionId;
      // Resolve the main-session transcript path so every engine-layer hook
      // (via baseHookFields) carries the official base `transcript_path`.
      engineConfig.transcriptPath = persist
        ? resolveTranscriptPath(store, sess.sessionId)
        : undefined;

      // Memory system-prompt injection, ONCE per run, before the first
      // request: (R5) the behavior-protocol fragment in CUSTOM mode only —
      // native mode gets it API-side, doubling it would skew behavior — plus
      // any consumer instructions; (R6) the resident memory index (async
      // store read; zero injection when /memories/MEMORY.md is absent). Both
      // land in the stable system tail (see appendSystemInjection), so the
      // cache-breakpoint structure is unchanged.
      if (memory !== null) {
        const parts: Array<{ label: string; text: string }> = [];
        if (memory.mode === 'custom') {
          parts.push({ label: 'memory-protocol', text: MEMORY_PROTOCOL_FRAGMENT.text });
        }
        // Consumer guidance applies in BOTH modes (the docs' "guide what
        // Claude writes to memory" prompting pattern).
        if (memory.instructions !== undefined && memory.instructions.length > 0) {
          parts.push({ label: 'memory-instructions', text: memory.instructions });
        }
        const index = await memory.buildIndexInjection();
        if (index !== null) {
          parts.push(index);
          // R8: the read-side residency cost is part of the memory bill.
          memory.health.indexInjectionTokens = estimateTextTokens(index.text);
        }
        appendSystemInjection(engineConfig, parts);
      }

      const history = sess.history;
      let needMeta = sess.needMeta;

      // File checkpointing: bind the disk-backed store to this session so
      // Write/Edit pre-images are captured and Query.rewindFiles() can restore.
      if (options.enableFileCheckpointing === true) {
        checkpointStore = new FileCheckpointStore({
          sessionDir: options.sessionDir,
          env,
          debug,
        });
        checkpointStore.bind(sess.sessionId);
      }

      // Cross-turn request-message view: seeded from the (possibly resumed)
      // history, kept in sync with the top-level user prompts below, mirrored
      // by the engine for its own turns, and compacted in place by the engine.
      const requestView = { messages: [...history] };

      /**
       * Drive ONE user turn's engine loop: build the per-turn deps, bracket
       * the API request segment with the §5.2 write-ahead checkpoint, run the
       * engine, and yield/persist its output exactly as the input loop did
       * before SM-乙b (byte-identical message stream — the full suite is the
       * regression guard). Shared by the input loop (fresh pending_turn) AND
       * the redrive-on-resume path (settles an EXISTING dangling pending_turn
       * without writing a new one). Returns 'stop' to end run() (string-mode
       * interrupt) or 'continue' to proceed to the next input.
       */
      async function* driveTurn(
        userUuid: string,
        existingPendingUuid?: string,
      ): AsyncGenerator<SDKMessage, 'stop' | 'continue'> {
        checkpointStore?.beginTurn(userUuid);
        turnController = new AbortController();
        // A cancel requested while no turn was active (interrupt() between turns
        // or right after init) aborts THIS turn immediately (finding #36).
        if (interruptRequested) {
          interruptRequested = false;
          turnController.abort(new AbortError('The turn was interrupted'));
        }
        const turnSignal = AbortSignal.any([outer.signal, turnController.signal]);
        const toolContext: ToolContext = {
          // EnterWorktree survives turn-boundary context rebuilds: the session
          // state is keyed on the shared readFilePaths Set, so the per-turn
          // context picks the active worktree up again (Bash follows via its
          // persistent state; this covers the fs tools and subagent spawns).
          cwd:
            peekWorktreeSession({ sessionKey: toolSessionKey } as ToolContext)?.dir ?? cwd,
          // Recomputed per turn so session addDirectories / removeDirectories
          // permission updates take real effect on the fs tools (T2-7:
          // removeDirectories revokes; addDirectories grants).
          additionalDirectories: gate.effectiveAdditionalDirectories(
            options.additionalDirectories ?? [],
          ),
          env,
          signal: turnSignal,
          debug,
          spawnSubagent: subagentRuntime.makeSpawnFn(0),
          // O-B2 SendMessage/TaskStop bridge — ROOT loop only by design (the
          // subagent runtime never threads this into a child ToolContext).
          subagents: {
            send: (p) => subagentRuntime.sendMessage(p),
            stop: (taskId) => subagentRuntime.stopAgent(taskId),
          },
          webSearch: options.webSearch,
          askUser: options.onUserQuestion,
          mcpResources: {
            list: (server, signal) => mcpEff.listResources(server, signal),
            read: (server, uri, signal) => mcpEff.readResource(server, uri, signal),
          },
          allowPrivateWebFetch: options.allowPrivateWebFetch === true,
          recordFileChange: checkpointStore
            ? (abs, pre): void => checkpointStore!.record(abs, pre)
            : undefined,
          shells,
          sandbox: sandboxCtx,
          readFilePaths,
          sessionKey: toolSessionKey,
        };
        // ExitPlanMode bridge: the tool flips this query's own gate (a formal
        // optional ToolContext field since the 2026-07-10 audit batch).
        toolContext.permissionGate = gate;
        const deps: EngineDeps = {
          transport,
          builtinTools: mainLoopBuiltins,
          mcp: mcpEff,
          permissions: gate,
          hooks,
          toolContext,
          debug,
          requestView,
          drainSubagentResults: () => subagentRuntime.drainCompletedResults(),
          drainObservability,
          // S3: root-loop tool-call records (children record via the runtime).
          onToolRecord: persistToolRecord,
          // Memory spec R8: metrics.memoryHealth snapshot source (root only).
          ...(memory !== null ? { memoryHealth: () => memory.health } : {}),
          // Unified tool-search: withhold a cold built-in's schema from this
          // turn's tools[] while deferral is active and it is unloaded. Absent
          // when no deferred registry exists -> every built-in stays inline.
          ...(deferred !== null
            ? { isBuiltinDeferred: (name: string) => deferred.isBuiltinDeferred(name) }
            : {}),
        };

        // The engine appends assistant + tool_result-user messages to `history`
        // in place. It YIELDS assistant messages (persisted here at yield time,
        // finding #34) but NOT the tool_result user turns, so we surface each
        // appended user turn as an SDKUserMessage (finding #27) and persist it,
        // in order, before the engine message that follows it.
        let historyTail = history.length;
        const flushToolResultUsers = function* (): Generator<SDKUserMessage> {
          while (historyTail < history.length) {
            const entry = history[historyTail];
            historyTail += 1;
            // Assistant entries are persisted at their own yield time; only the
            // engine-appended tool_result user turns need surfacing here.
            if (entry !== undefined && entry.role === 'user') {
              persistParam(sess.sessionId, entry);
              yield {
                type: 'user',
                uuid: randomUUID(),
                session_id: sess.sessionId,
                message: { role: 'user', content: entry.content },
                parent_tool_use_id: null,
              };
            }
          }
        };

        // §5.2 write-ahead checkpoint: open a pending_turn just before the
        // request segment (fresh id for a normal turn; the redrive path passes
        // the EXISTING dangling id so it does not double-write the record).
        const pendingUuid = existingPendingUuid ?? randomUUID();
        if (existingPendingUuid === undefined) {
          persistPendingTurn(sess.sessionId, pendingUuid, userUuid);
        }
        // Track whether the turn ended in an EXECUTION-CRASH error result. The
        // engine converts API/connection failures into an is_error
        // `error_during_execution` result (only AbortError is thrown), so a
        // "successful iteration" can still be a failed turn — in which case
        // the pending_turn is left dangling so a resume re-drives the
        // interrupted request segment.
        //
        // TERMINAL engine decisions are NOT crashes (audit 2026-07-10 P1-6):
        // error_max_turns / error_max_budget_usd /
        // error_max_structured_output_retries and a model refusal are the
        // engine deliberately ENDING the turn. Leaving those pending would
        // make a later resume auto-re-drive the request in a fresh process —
        // where sessionCost/sessionTurns restart at zero — silently re-asking
        // a refused prompt or billing a whole extra turn past a spent budget
        // cap. Those settle the pending_turn like a success.
        let turnErrored = false;

        try {
          for await (const msg of runAgentLoop(history, deps, engineConfig)) {
            yield* flushToolResultUsers();
            yield* drainMirror();
            yield* drainObs();
            if (msg.type === 'assistant') {
              persistAssistant(sess.sessionId, msg.message.content);
              yield msg;
            } else if (msg.type === 'result') {
              if (msg.is_error === true) {
                const m = msg as { subtype?: string; error_code?: string };
                // Only an execution crash (API/tool failure) re-drives on
                // resume; deliberate terminal decisions settle (see above).
                turnErrored =
                  m.subtype === 'error_during_execution' && m.error_code !== 'refusal';
              }
              // Fold any completed subagent usage into the session totals before
              // the result is rewritten so subagent tokens/cost are reported.
              acct.foldSubagentUsage(subagentRuntime.drainUsageLedger());
              acct.accumulateResult(msg);
              yield rewriteResult(msg);
            } else {
              yield msg;
            }
          }
          yield* flushToolResultUsers();
          yield* drainMirror();
          // Trailing lifecycle events (a background subagent that finished as
          // the turn ended, Stop-hook responses) surface before the next turn.
          yield* drainObs();
          // §5.2: settle the pending_turn ONLY when the request segment
          // actually completed. An errored turn leaves it dangling so a later
          // resume re-drives it.
          if (!turnErrored) {
            persistTurnComplete(sess.sessionId, pendingUuid);
          }
        } catch (err) {
          // Persist (but do not re-yield on error) any trailing tool_result
          // user turn so the transcript stays durable across the failure. The
          // pending_turn is deliberately LEFT dangling: a resume re-drives it.
          while (historyTail < history.length) {
            const entry = history[historyTail];
            historyTail += 1;
            if (entry !== undefined && entry.role === 'user') {
              persistParam(sess.sessionId, entry);
            }
          }
          if (isAbortError(err)) {
            if (outer.signal.aborted) {
              throw err instanceof AbortError ? err : new AbortError();
            }
            // Turn-level interrupt(): streaming mode keeps accepting input;
            // string mode ends the run WITH a terminal result so an awaiting
            // consumer is not left hanging with no explanation (finding #36).
            debug('query: turn interrupted');
            if (!streamingMode) {
              endReason = 'interrupt';
              yield terminalResult(
                'error_during_execution',
                sess.sessionId,
                'The turn was interrupted',
              );
              return 'stop';
            }
            return 'continue';
          }
          throw err;
        } finally {
          turnController = null;
        }
        return 'continue';
      }

      // 1. SessionStart hooks (matchValue is the start source).
      const source: 'startup' | 'resume' = sess.resumed ? 'resume' : 'startup';
      let sessionStartContext: string[] = [];
      let sessionStartBlocked: string | undefined;
      if (hooks.hasHooks('SessionStart')) {
        const agg = await hooks.run(
          'SessionStart',
          {
            session_id: sess.sessionId,
            cwd,
            ...transcriptField(sess.sessionId),
            hook_event_name: 'SessionStart',
            source,
          },
          undefined,
          source,
          outer.signal,
        );
        for (const m of agg.systemMessages) debug(`SessionStart hook: ${m}`);
        sessionStartContext = [...agg.additionalContext];
        if (!agg.continue) {
          sessionStartBlocked =
            agg.stopReason ?? 'SessionStart hook stopped the session';
        }
      }

      // 2. Connect MCP servers, then emit the init system message.
      if (sessionStartBlocked === undefined) {
        await mcpEff.connectAll();
      }
      // Tool-search: decide activation now that tools are known; when active,
      // register the ToolSearch builtin so the model can load deferred schemas.
      if (deferred !== null) {
        deferred.activateIfNeeded(options.toolSearch);
        if (deferred.isActive()) {
          builtinTools.set('ToolSearch', makeToolSearchTool(deferred));
        }
      }
      const initMessage: SDKSystemMessage = {
        type: 'system',
        subtype: 'init',
        uuid: randomUUID(),
        session_id: sess.sessionId,
        apiKeySource: transport.apiKeySource(),
        cwd,
        tools: [
          ...mainLoopBuiltins.keys(),
          ...mcpEff.allTools().map((t) => t.qualifiedName),
        ],
        mcp_servers: mcpEff
          .statuses()
          .map((s) => ({ name: s.name, status: s.status })),
        model: engineConfig.model,
        permissionMode: gate.getMode(),
        slash_commands: slashCommandInfos(customSlashCommands).map((c) => c.name),
        output_style: 'default',
        agents: wantAgent ? Object.keys(agentDefs) : [],
        claude_code_version: CLAUDE_CODE_VERSION,
        betas: options.betas ?? [],
        skills: [],
        plugins: [],
      };
      initDeferred.resolve({
        commands: slashCommandInfos(customSlashCommands),
        agents: Object.keys(agentDefs).map((name) => ({ name })),
        output_style: 'default',
        available_output_styles: ['default'],
        models: SUPPORTED_MODELS.map((m) => ({ ...m })),
        account: { apiKeySource: transport.apiKeySource() },
      });
      yield initMessage;
      yield* drainMirror();
      const informational = (message: string): void => {
        emitObs({
          type: 'informational',
          uuid: randomUUID(),
          session_id: sess.sessionId,
          level: 'warning',
          message,
        });
      };
      // ACCEPTED-IGNORED knobs present on this call surface once as a typed
      // stream message, not only behind debug:true (audit 2026-07-10 #6).
      if (presentAcceptedKeys.length > 0) {
        informational(
          `Options accepted for compatibility but with NO effect in this SDK: ` +
            `${presentAcceptedKeys.join(', ')} (see docs/COMPAT.md).`,
        );
      }
      // OpenAI-protocol silent-failure surfacing (audit 2026-07-10 P1-4): a
      // knob the wire cannot honor must SAY so once, not no-op quietly. One
      // informational message per condition, right after init.
      if (options.provider?.protocol === 'openai-chat') {
        if (
          options.maxBudgetUsd !== undefined &&
          !hasPriceFor(engineConfig.model, options.provider.pricing)
        ) {
          informational(
            `maxBudgetUsd is set but model "${engineConfig.model}" has no price entry — ` +
              `the cap can never trip (estimates stay $0). Add provider.pricing ` +
              `entries to make the budget enforceable on this protocol.`,
          );
        }
        if (engineConfig.thinking !== undefined && engineConfig.thinking.type !== 'disabled') {
          informational(
            `The Anthropic 'thinking' configuration has no Chat Completions equivalent ` +
              `and is dropped from the wire on protocol 'openai-chat'. Use ` +
              `provider.openai.reasoningEffort for OpenAI-style reasoning models.`,
          );
        }
        if (options.betas !== undefined && options.betas.length > 0) {
          informational(
            `'betas' flags are Anthropic header concepts and are ignored on protocol 'openai-chat'.`,
          );
        }
        if (options.provider.apiVersion !== undefined) {
          informational(
            `provider.apiVersion is an Anthropic header concept and is ignored on protocol ` +
              `'openai-chat' (Azure-style gateways: use provider.openai.extraQueryParams).`,
          );
        }
      }
      // SessionStart hook lifecycle events (includeHookEvents) surface right
      // after init — they fired before the stream had anywhere to go.
      yield* drainObs();

      if (sessionStartBlocked !== undefined) {
        yield blockedResult(sess.sessionId, sessionStartBlocked);
        return;
      }

      // 2b. Redrive-on-resume (SM-乙b §5.2/§6): a resumed transcript whose
      // last replayed message is a user turn AND that carries a dangling
      // pending_turn means the prior run crashed inside that turn's API
      // request segment. Re-drive exactly that segment ONCE against the
      // existing history before consuming new input. Correctness: the engine
      // never re-runs a tool that already has a tool_result on disk — history
      // only carries settled tool calls, and repairPairing already healed any
      // trailing unpaired tool_use — so this re-issues only the interrupted
      // API request, never a side-effecting tool. driveTurn settles the
      // existing pending_turn on completion; a 'stop' outcome ends the run.
      if (
        sess.redrivePending === true &&
        sess.pendingTurnUuid !== undefined &&
        history.length > 0 &&
        history[history.length - 1]?.role === 'user'
      ) {
        debug(
          `query: redriving interrupted request segment (pending ${sess.pendingTurnUuid})`,
        );
        const outcome = yield* driveTurn(
          sess.pendingTurnRef ?? randomUUID(),
          sess.pendingTurnUuid,
        );
        if (outcome === 'stop') return;
      }

      // 3. Consume user turns until the input queue closes.
      for (;;) {
        yield* drainMirror();
        let item: IteratorResult<SDKUserMessage, undefined>;
        try {
          item = await queue.next();
        } catch (err) {
          if (isAbortError(err)) throw new AbortError();
          yield blockedResult(
            sess.sessionId,
            `input stream failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        if (item.done === true) break;
        const incoming = item.value;

        let message: APIUserMessage = incoming.message;
        const promptText = promptTextOf(message);

        // UserPromptSubmit hooks. A block SKIPS this prompt: in streaming-input
        // mode the session keeps accepting further inputs (finding #35); in
        // string mode there is only one prompt, so a block ends the run.
        // additionalContext is appended to the prompt (SessionStart context
        // rides the first turn).
        const extraLines: string[] = sessionStartContext;
        sessionStartContext = [];
        if (hooks.hasHooks('UserPromptSubmit')) {
          const agg = await hooks.run(
            'UserPromptSubmit',
            {
              session_id: sess.sessionId,
              cwd,
              ...transcriptField(sess.sessionId),
              hook_event_name: 'UserPromptSubmit',
              prompt: promptText,
            },
            undefined,
            undefined,
            outer.signal,
          );
          for (const m of agg.systemMessages) debug(`UserPromptSubmit hook: ${m}`);
          if (!agg.continue || agg.decision === 'deny') {
            const reason =
              agg.stopReason ??
              agg.decisionReason ??
              'UserPromptSubmit hook blocked the prompt';
            if (streamingMode) {
              // Skip this prompt only; do not persist/echo it, keep going.
              debug(`query: UserPromptSubmit blocked a prompt; skipping it (${reason})`);
              // Preserve any first-turn SessionStart context for the next prompt.
              sessionStartContext = extraLines;
              continue;
            }
            yield blockedResult(sess.sessionId, reason);
            return;
          }
          extraLines.push(...agg.additionalContext);
        }

        // Custom slash-command expansion (.claude/commands): a PURE-TEXT
        // `/name [args]` prompt becomes the command body with $ARGUMENTS /
        // $1..$9 substituted. Hooks above saw the raw typed text; history and
        // persistence carry the EXPANDED body (that is what the model sees,
        // so resume replays correctly). Unknown names pass through as plain
        // text; the built-in /compact is never shadowed (engine handles it
        // downstream via detectManualCompact).
        if (customSlashCommands.length > 0) {
          const pure = pureTextOf(message);
          const expansion =
            pure === null ? null : expandSlashCommand(pure, customSlashCommands);
          if (expansion !== null) {
            debug(`query: expanded custom slash command /${expansion.name}`);
            message = { role: 'user', content: expansion.expanded };
          }
        }
        message = appendContextLines(message, extraLines);

        // Echo the user message, then append to history + store.
        const userUuid = incoming.uuid ?? randomUUID();
        const echoed: SDKUserMessage = {
          type: 'user',
          uuid: userUuid,
          session_id: sess.sessionId,
          message,
          parent_tool_use_id: incoming.parent_tool_use_id ?? null,
        };
        if (persist && needMeta) {
          store.append(sess.sessionId, {
            type: 'meta',
            sessionId: sess.sessionId,
            createdAt: Date.now(),
            cwd,
            firstPrompt: promptText,
            // Persist the branch the runtime-context probe already computed so
            // SDKSessionInfo.gitBranch reads back (store.load parses it).
            ...(sessionGitBranch !== undefined ? { gitBranch: sessionGitBranch } : {}),
          });
          needMeta = false;
        }
        const userParam: APIMessageParam = { role: 'user', content: message.content };
        history.push(userParam);
        requestView.messages.push(userParam);
        persistParam(sess.sessionId, userParam);
        yield echoed;

        // 4. Enforce session-wide limits BEFORE the turn, and arm the engine
        //    with the REMAINING budget/turns so it also stops mid-turn once the
        //    session cap is hit (finding #33).
        if (options.maxBudgetUsd !== undefined) {
          if (acct.cost >= options.maxBudgetUsd) {
            yield terminalResult(
              'error_max_budget_usd',
              sess.sessionId,
              `Estimated cost $${acct.cost.toFixed(6)} exceeded maxBudgetUsd ($${options.maxBudgetUsd})`,
            );
            return;
          }
          engineConfig.maxBudgetUsd = options.maxBudgetUsd - acct.cost;
        }
        if (options.maxTurns !== undefined) {
          if (acct.turns >= options.maxTurns) {
            yield terminalResult(
              'error_max_turns',
              sess.sessionId,
              `Reached maxTurns limit (${options.maxTurns})`,
            );
            return;
          }
          engineConfig.maxTurns = options.maxTurns - acct.turns;
        }

        // Delegate this turn to the shared engine driver (SM-乙b §5.2 wires
        // the write-ahead checkpoint inside it). A 'stop' outcome (string-mode
        // interrupt) ends the run; anything else falls through to the next
        // input (streaming-mode interrupt or normal completion).
        const outcome = yield* driveTurn(userUuid);
        if (outcome === 'stop') return;
      }

      // Memory spec R7: session-end progress-card round. Runs ONLY on the
      // normal end of input (this point is unreachable on abort/error — both
      // throw past it), only when at least one turn actually ran, and only
      // when the knob is on. Its assistant/user messages stream normally,
      // but its RESULT is absorbed (accounting already folded inside
      // driveTurn's iteration) so the task's own final result remains the
      // last result the consumer sees. Failures are logged, never fatal —
      // the user's answer has already been delivered.
      if (
        memory !== null &&
        memory.sessionEndUpdate &&
        acct.turns > 0 &&
        !outer.signal.aborted
      ) {
        try {
          const endParam: APIMessageParam = {
            role: 'user',
            content: [{ type: 'text', text: MEMORY_SESSION_END_PROMPT }],
          };
          history.push(endParam);
          requestView.messages.push(endParam);
          persistParam(sess.sessionId, endParam);
          // Bound the round: a progress card is a couple of tool turns, not
          // a task. (driveTurn re-arms real budgets from session state.)
          engineConfig.maxTurns = 4;
          debug('memory: running session-end progress-card round');
          const gen = driveTurn(randomUUID());
          for (;;) {
            const it = await gen.next();
            if (it.done === true) break;
            const msg = it.value;
            if (msg.type !== 'result') yield msg;
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
          debug(
            `memory: session-end update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        endReason = closed ? 'close' : 'abort';
        throw err instanceof AbortError ? err : new AbortError();
      }
      endReason = 'error';
      throw err;
    } finally {
      turnController = null;
      // Remove the outer-abort listener so reusing one AbortController across
      // many queries does not accumulate a listener per query (finding #16).
      outer.signal.removeEventListener('abort', onOuterAbort);
      // Abort any still-running background subagents on NORMAL completion too,
      // not only in close() (finding #14). A run_in_background Agent spawned on
      // the final turn would otherwise stay detached — chained off outerSignal,
      // which a normal completion never aborts — and keep calling the API after
      // the query ended (its childMcp calls then failing once closeAll() below
      // tears down the shared registry). abortAll() aborts each child's own
      // controller, so this cancels them without touching the caller's
      // AbortController. Idempotent with close()'s own abortAll().
      subagentRuntime.abortAll();
      // Give the aborted children a bounded window to run their finalizers
      // (worktree cleanup, SubagentStop hooks, sidechain_end appends) BEFORE
      // the store flush below — otherwise a mirrored store's buffer receives
      // those trailing appends after flushAll and the process may exit with
      // only an unref'd debounce timer left to deliver them (audit 2026-07-10
      // M4). Bounded + never throws, so teardown cannot hang on a stuck child.
      await subagentRuntime.settleAll();
      // Kill background shells + drop the persistent cwd/env snapshot: shell
      // sessions live and die with the query.
      shells.dispose();
      // Drop the per-query sandbox tmp dir (lives and dies with the query).
      if (sandboxTmpDir !== '') {
        try {
          rmSync(sandboxTmpDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
      if (!initDeferred.settled) {
        initDeferred.reject(
          new AbortError('query ended before initialization completed'),
        );
      }
      await fireSessionEnd(endReason);
      // Flush any buffered external-store mirror writes (best-effort).
      if (store instanceof MirroringSessionStore) {
        try {
          await store.flushAll();
        } catch (err) {
          debug(
            `sessionStore flush failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Lifecycle contract (SessionManager 甲, proposal §4.2): whoever
      // constructed the MCP registry closes it. A standalone query owns its
      // registry and tears it down here exactly as before; a managed query
      // only BORROWS the shared registry — sibling conversations are still
      // multiplexing those connections, so closing them here is the design's
      // #1 regression red line. mgr.close() is the single teardown point.
      if (ownsMcp) {
        try {
          await mcpEff.closeAll();
        } catch (err) {
          debug(
            `mcp closeAll failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  // --- Query wrapper -------------------------------------------------------------
  const inner = run();

  // Prime the generator eagerly so initialization (SessionStart hooks,
  // mcp.connectAll, the init system message and initDeferred.resolve) runs at
  // query() construction time, independent of whether the consumer ever starts
  // iterating. Without this, initializationResult() would deadlock for a
  // consumer that awaits it before its first next(), and close() before the
  // first next() could never run the generator's finally (findings #14/#28).
  // The buffered first result is handed back on the first next() call.
  let primedFirst: Promise<IteratorResult<SDKMessage, void>> | null = inner.next();
  // Attach a no-op catch so a rejection nobody has awaited yet never surfaces
  // as an unhandledRejection; the real next() caller still observes it.
  void primedFirst.catch(() => undefined);

  const q: Query = {
    next(...nextArgs: [] | [unknown]): Promise<IteratorResult<SDKMessage, void>> {
      if (primedFirst !== null) {
        const first = primedFirst;
        primedFirst = null;
        return first;
      }
      return inner.next(...nextArgs);
    },
    return(value: void | PromiseLike<void>): Promise<IteratorResult<SDKMessage, void>> {
      return inner.return(value);
    },
    throw(err?: unknown): Promise<IteratorResult<SDKMessage, void>> {
      return inner.throw(err);
    },
    [Symbol.asyncIterator](): Query {
      return q;
    },

    async interrupt(): Promise<SDKControlInterruptResponse> {
      // Abort the active turn if one is running; otherwise queue the cancel so
      // the NEXT turn to start is aborted immediately, instead of being a
      // silent no-op when interrupt() lands between turns or right after init
      // (finding #36).
      if (turnController !== null) {
        turnController.abort(new AbortError('The turn was interrupted'));
      } else {
        interruptRequested = true;
      }
      // Official interrupt receipt (0.3.205). This engine keeps no uuid-stamped
      // async message queue that survives an abort, so nothing is still queued.
      return { still_queued: [] };
    },
    async setPermissionMode(mode: PermissionMode): Promise<void> {
      assertBypassUnlocked(mode);
      gate.setMode(mode);
    },
    async setModel(model?: string): Promise<void> {
      engineConfig.model = model ?? initialModel;
    },
    async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
      const n = maxThinkingTokens ?? undefined;
      engineConfig.maxThinkingTokens = n;
      // On the claude_code preset path (no explicit thinking config) the budget
      // ALSO drives the on/off switch, mirroring the E1 initial-injection
      // semantics: without this a live re-enable on a session that opted out
      // (maxThinkingTokens: 0 -> config.thinking undefined) would be a silent
      // no-op, since computeThinking only consults the budget when thinking is
      // already enabled. Explicit thinking configs and non-preset paths keep
      // their existing behavior (maxThinkingTokens is a budget fallback only).
      if (isClaudeCodePreset && options.thinking === undefined) {
        if (n === undefined) {
          // Reset -> the preset default (adaptive, E7-01 official wire shape).
          engineConfig.thinking = { type: 'adaptive' };
        } else if (n > 0) {
          engineConfig.thinking = { type: 'enabled' };
        } else {
          engineConfig.thinking = undefined; // 0 -> off
        }
      }
    },
    initializationResult(): Promise<SDKControlInitializeResponse> {
      return initDeferred.promise;
    },
    async supportedCommands(): Promise<SlashCommand[]> {
      return slashCommandInfos(customSlashCommands);
    },
    async supportedModels(): Promise<ModelInfo[]> {
      return SUPPORTED_MODELS.map((m) => ({ ...m }));
    },
    async supportedAgents(): Promise<AgentInfo[]> {
      // Explicitly-configured agents only; the built-in general-purpose type
      // stays spawnable via the Agent tool (whose description enumerates it).
      return Object.keys(agentDefs).map((name) => ({ name }));
    },
    async mcpServerStatus() {
      // The registry assembles the official McpServerToolInfo object form
      // directly (T2-7 close-out) — no normalization layer needed. P2 parity:
      // attach `scope` provenance ('project'/'local' from config source, else
      // 'dynamic' for servers added after construction via setMcpServers).
      return mcpEff.statuses().map((s) => ({
        ...s,
        scope: mcpScopeByName.get(s.name) ?? 'dynamic',
      }));
    },
    async accountInfo() {
      return { apiKeySource: transport.apiKeySource() };
    },
    async reconnectMcpServer(serverName: string): Promise<void> {
      await mcpEff.reconnect(serverName);
    },
    async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
      mcpEff.setEnabled(serverName, enabled);
      if (enabled) {
        const st = mcpEff.statuses().find((s) => s.name === serverName);
        if (st !== undefined && st.status !== 'connected') {
          await mcpEff.reconnect(serverName);
        }
      }
    },
    async setMcpServers(
      servers: Record<string, McpServerConfig>,
    ): Promise<McpSetServersResult> {
      // Official result shape (T2-2): added/removed report the REAL diff of
      // the registered server set; errors maps each failed server to its
      // connect error. The registry's pre-alignment {servers} payload rides
      // along as the deprecated dual-track field.
      const before = new Set(mcpEff.statuses().map((s) => s.name));
      await mcpEff.setServers(servers);
      const after = mcpEff.statuses();
      const afterNames = new Set(after.map((s) => s.name));
      const added = after.filter((s) => !before.has(s.name)).map((s) => s.name);
      const removed = [...before].filter((n) => !afterNames.has(n));
      const errors: Record<string, string> = {};
      for (const s of after) {
        if (s.status === 'failed') errors[s.name] = s.error ?? 'connection failed';
      }
      return { added, removed, errors, servers: after };
    },
    async rewindFiles(
      userMessageId: string,
      opts?: { dryRun?: boolean },
    ): Promise<RewindFilesResult> {
      if (options.enableFileCheckpointing !== true) {
        throw new ConfigurationError(
          'File rewinding is not enabled (set options.enableFileCheckpointing)',
        );
      }
      await initDeferred.promise.catch(() => undefined);
      if (checkpointStore === null) {
        throw new ConfigurationError('File rewinding is not enabled');
      }
      return checkpointStore.rewind(userMessageId, { dryRun: opts?.dryRun === true });
    },
    async stopTask(taskId: string): Promise<void> {
      subagentRuntime.stopTask(taskId);
    },
    async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
      if (!streamingMode) {
        throw new ConfigurationError(
          'streamInput() is only available in streaming-input mode (AsyncIterable prompt)',
        );
      }
      if (queue.isClosed()) {
        throw new ConfigurationError(
          'streamInput() called after the input stream already ended',
        );
      }
      await pump(stream);
    },
    close(): void {
      if (closed) return;
      closed = true;
      const reason = new AbortError('The query was closed');
      turnController?.abort(reason);
      // Settle a still-pending initializationResult() synchronously so an
      // awaiter never hangs even if close() lands before the generator's
      // finally runs (findings #14/#28).
      if (!initDeferred.settled) {
        initDeferred.reject(
          new AbortError('The query was closed before initialization completed'),
        );
      }
      // Remove the outer-abort listener up front (idempotent with the finally).
      outer.signal.removeEventListener('abort', onOuterAbort);
      // Fire SessionEnd first (flag set synchronously) so the generator's
      // finally block does not race a different reason in.
      void fireSessionEnd('close');
      queue.fail(reason);
      if (!outer.signal.aborted) outer.abort(reason);
      subagentRuntime.abortAll();
      void inner.return(undefined).catch(() => undefined);
      // Ownership contract: only close a registry this query constructed. A
      // borrowed (SessionManager-shared) registry outlives any single query.
      if (ownsMcp) {
        void mcpEff.closeAll().catch((err) => {
          debug(
            `mcp closeAll failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    },
  };

  return q;
}
