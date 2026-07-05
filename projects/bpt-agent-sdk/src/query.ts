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
  SDKInitializationResult,
  SDKMessage,
  SDKMirrorErrorMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  TextBlockParam,
} from './types.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  McpRegistry,
  McpToolEntry,
  ToolContext,
} from './internal/contracts.js';
import { AnthropicTransport } from './transport/anthropic.js';
import { DefaultPermissionGate } from './permissions/gate.js';
import { DefaultHookRunner } from './hooks/runner.js';
import { DefaultMcpRegistry } from './mcp/registry.js';
import { matchToolName, parseRule } from './permissions/rules.js';
import { runAgentLoop } from './engine/loop.js';
import { buildSystemPromptParts } from './engine/prompts.js';
import { gatherEnvironment, loadProjectInstructions } from './engine/runtime-context.js';
import { buildCompactionConfig } from './engine/compaction.js';
import {
  buildStructuredOutputInstruction,
  normalizeOutputFormat,
} from './engine/structured-output.js';
import { JsonlSessionStore } from './sessions/store.js';
import { MirroringSessionStore, encodeProjectKey } from './sessions/store-adapter.js';
import { FileCheckpointStore } from './sessions/checkpoints.js';
import { DeferredMcpRegistry, makeToolSearchTool } from './tools/toolsearch.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBuiltinTools } from './tools/index.js';
import { createShellManager } from './tools/shells.js';
import { resolveSandboxBackend } from './sandbox/backend.js';
import type { SandboxContext } from './types.js';
import { createSubagentRuntime } from './subagents/runtime.js';
import { createAgentTool } from './subagents/agent-tool.js';
import { loadProjectMcpServers } from './mcp/project-config.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const CLAUDE_CODE_VERSION = '0.1.0';

/** Static model list surfaced by supportedModels()/initializationResult(). */
const SUPPORTED_MODELS: readonly ModelInfo[] = [
  { value: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
  { value: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
];

/**
 * Options accepted for @anthropic-ai/claude-agent-sdk type/runtime compat
 * but with no behavior in v0.1 (see docs/COMPAT.md). Each present key emits
 * exactly one debug warning. Untyped keys cover migration call sites that
 * pass reference-SDK-only fields through a widened object.
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
  // settingSources drives project .mcp.json loading in v0.2, but only takes
  // effect when a .mcp.json is present; keep the compat diagnostic.
  'settingSources',
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
  'debugFile',
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
function addUsageLocal(a: NonNullableUsage, b: NonNullableUsage): NonNullableUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

/**
 * McpRegistry decorator that hides tools matched by bare-name disallowedTools
 * entries so the model never sees their definitions (audit v0.1.1 P0). A tool
 * whose qualified name matches a bare disallowed pattern is dropped from
 * allTools() (which feeds the request's tool list and the init message) and
 * reported as absent by has() (so a hallucinated call yields "No such tool"
 * rather than executing). Scoped `Tool(spec)` deny rules are NOT applied here;
 * they remain call-time gate decisions.
 */
class ToolFilterMcpRegistry implements McpRegistry {
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
  setServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult> {
    return this.inner.setServers(servers);
  }
  closeAll(): Promise<void> {
    return this.inner.closeAll();
  }
}

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  settled: boolean;
};

function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  // Pre-attach a handler so a rejection nobody awaits never becomes an
  // unhandledRejection; callers of initializationResult() still see it.
  void promise.catch(() => undefined);
  const d: Deferred<T> = {
    promise,
    settled: false,
    resolve: (v) => {
      if (d.settled) return;
      d.settled = true;
      resolveFn(v);
    },
    reject: (e) => {
      if (d.settled) return;
      d.settled = true;
      rejectFn(e);
    },
  };
  return d;
}

/** Minimal push-based async queue feeding user turns into the run loop. */
class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<{
    resolve: (r: IteratorResult<T, undefined>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private closed = false;
  private failure: { err: unknown } | null = null;

  /** Returns false when the queue is already closed/failed. */
  push(item: T): boolean {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter.resolve({ done: false, value: item });
    else this.items.push(item);
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) {
      w.resolve({ done: true, value: undefined });
    }
  }

  fail(err: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = { err };
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  isClosed(): boolean {
    return this.closed;
  }

  async next(): Promise<IteratorResult<T, undefined>> {
    const item = this.items.shift();
    if (item !== undefined) return { done: false, value: item };
    if (this.failure !== null) throw this.failure.err;
    if (this.closed) return { done: true, value: undefined };
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

type ResolvedSession = {
  sessionId: string;
  history: APIMessageParam[];
  resumed: boolean;
  /** True when the meta line still needs to be written on first persist. */
  needMeta: boolean;
};

// ---------------------------------------------------------------------------
// query()
// ---------------------------------------------------------------------------

export function query(args: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query {
  const { prompt } = args;
  const options: Options = args.options ?? {};

  // --- Base option resolution ----------------------------------------------
  const cwd = options.cwd ?? process.cwd();
  const env: Record<string, string | undefined> = options.env ?? process.env;

  const debugEnabled = options.debug === true;
  const stderrCb = options.stderr;
  const debug = (msg: string): void => {
    if (!debugEnabled) return;
    const line = `[bpt-agent-sdk] ${msg}\n`;
    if (stderrCb !== undefined) stderrCb(line);
    else process.stderr.write(line);
  };

  for (const key of ACCEPTED_OPTION_KEYS) {
    if ((options as Record<string, unknown>)[key] !== undefined) {
      debug(
        `option '${key}' is accepted for compatibility but has no effect in this SDK (see docs/COMPAT.md)`,
      );
    }
  }

  const initialModel = options.model ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // --- Collaborators ---------------------------------------------------------
  const outer = options.abortController ?? new AbortController();
  const persist = options.persistSession !== false;
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
  const transport = new AnthropicTransport({
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

  const gate = new DefaultPermissionGate({
    mode: options.permissionMode,
    allowedTools: options.allowedTools,
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

  const hooks = new DefaultHookRunner({
    hooks: options.hooks,
    debug,
    onLifecycleEvent: options.includeHookEvents === true ? emitObs : undefined,
    // v0.6 condition-gated matchers: thread the session credentials so a
    // matcher's `condition` can be evaluated (bounded single-shot call). A
    // matcher without a condition never triggers a call.
    conditionOptions: { provider: options.provider, betas: options.betas, env, debug },
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
  const projectServers = loadProjectMcpServers(cwd, options.settingSources, debug);
  const mergedServers: Record<string, McpServerConfig> = {
    ...projectServers,
    ...(options.mcpServers ?? {}),
  };
  const realMcp = new DefaultMcpRegistry({
    servers: mergedServers,
    env,
    debug,
    elicitation: options.onElicitation,
  });
  const mcp: McpRegistry =
    bareDisallowed.length > 0
      ? new ToolFilterMcpRegistry(realMcp, isBareDisallowed)
      : realMcp;
  // Tool-search: defer MCP tool schemas behind a ToolSearch builtin when
  // servers are configured (auto-activates past the threshold, or forced by
  // options.toolSearch). When null, mcpEff === mcp (exact v0.1 behavior).
  const deferred =
    options.toolSearch !== false && Object.keys(mergedServers).length > 0
      ? new DeferredMcpRegistry(mcp, { debug })
      : null;
  const mcpEff: McpRegistry = deferred ?? mcp;

  // Built-in tools, optionally filtered by the array form of options.tools
  // (the claude_code preset and undefined both mean "all built-ins").
  const allBuiltins = createBuiltinTools({ sandbox: sandboxCtx });
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
  if (!Array.isArray(options.tools) && Object.keys(mergedServers).length === 0) {
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

  // Structured-output: normalize the schema option and append the instruction
  // to the STABLE system segment so the requirement survives tool turns and
  // stays inside the cached prefix (it is static, not per-run).
  const outputFormat = normalizeOutputFormat(options.outputFormat, debug);

  // System prompt has two shapes:
  //  - segments form (host-layered): the CALLER composed ordered blocks and
  //    marked which to cache. We forward them verbatim (respecting their
  //    breakpoints, adding none) — the generic seam for host prompt layering.
  //  - string/preset/undefined: this SDK builds the [stable, cwd] split.
  let systemBlocks: TextBlockParam[] | undefined;
  let systemPromptStable = '';
  let systemPromptVolatile = '';
  // Char offset splitting the stable prefix into [base harness | appended tail]
  // for the 2nd system cache breakpoint. Only set on the string/preset path.
  let systemPromptBaseLen: number | undefined;
  const sp = options.systemPrompt;
  if (sp !== null && typeof sp === 'object' && 'type' in sp && sp.type === 'segments') {
    // 4 API breakpoints total; reserve 1 for the tool schemas -> up to 3 here.
    let budget = 3;
    systemBlocks = (Array.isArray(sp.segments) ? sp.segments : [])
      .filter((s) => s !== null && typeof s.text === 'string' && s.text.length > 0)
      .map((s) => {
        const block: TextBlockParam = { type: 'text', text: s.text };
        if (s.cache === true) {
          if (budget > 0) {
            block.cache_control = { type: 'ephemeral' };
            budget -= 1;
          } else {
            debug(
              'systemPrompt segments: cache-breakpoint budget (3) exhausted; ' +
                'this segment is sent uncached (order segments most-shared first)',
            );
          }
        }
        return block;
      });
    // Structured-output requirement rides as a trailing (uncached) block.
    if (outputFormat !== undefined && systemBlocks.length > 0) {
      systemBlocks.push({
        type: 'text',
        text: buildStructuredOutputInstruction(outputFormat.schema),
      });
    }
  } else {
    // Runtime-assembly context (open reproduction of the official runtime
    // prompt): the <env> block (default-on for the preset) and CLAUDE.md /
    // AGENTS.md codebase instructions (opt-in via settingSources). Gathered
    // here because it needs I/O the pure prompt module avoids; both degrade to
    // empty on any failure and never block query construction.
    const includeEnv = options.includeEnvironmentContext !== false;
    const environment = includeEnv
      ? gatherEnvironment(cwd, initialModel, new Date().toISOString().slice(0, 10))
      : undefined;
    const projectInstructions = loadProjectInstructions(cwd, options.settingSources);
    // Pass the variant through as-is: when harnessPromptVariant is unset,
    // buildSystemPromptParts applies its default (v5, the faithful official
    // reproduction) on the claude_code preset path. Resolving undefined to a
    // concrete 'v1' here would override that default and pin the real API to
    // the terse prompt regardless of the promoted default.
    const promptParts = buildSystemPromptParts(sp, {
      cwd,
      toolNames: [...builtinTools.keys()],
      variant: options.harnessPromptVariant,
      environment,
      projectInstructions,
    });
    systemPromptStable = promptParts.stable;
    // Boundary between the shared base harness and the appended stable tail
    // (project instructions / append). The structured-output instruction is
    // appended AFTER `base`, so it lands in the slice(baseLen) tail and the
    // offset stays valid.
    systemPromptBaseLen = promptParts.base.length;
    if (outputFormat !== undefined) {
      systemPromptStable += `\n\n${buildStructuredOutputInstruction(outputFormat.schema)}`;
    }
    systemPromptVolatile = promptParts.volatile;
  }

  // Default-on extended thinking, claude_code preset path ONLY (E1 + E7-01).
  // The official CLI enables thinking by default and (per the r3 wire
  // differential) sends `thinking: {type:"adaptive"}` with NO budget_tokens —
  // the model sizes its own thinking per request. E7-01 aligns our preset
  // default to that exact wire shape (replacing the earlier OUR-chosen fixed
  // 4096 budget). Injection rules:
  //  - an explicit options.thinking always wins (passed through verbatim);
  //  - maxThinkingTokens: 0 is the explicit opt-out (no thinking param);
  //  - maxThinkingTokens > 0 enables FIXED thinking with that budget;
  //  - both unset -> adaptive thinking (official wire default).
  // Non-preset paths (bare string / segments / no systemPrompt) are unchanged:
  // the drop-in default remains "no thinking param".
  const isClaudeCodePreset =
    sp !== null &&
    typeof sp === 'object' &&
    'type' in sp &&
    sp.type === 'preset' &&
    sp.preset === 'claude_code';
  let thinkingConfig = options.thinking;
  let maxThinkingTokensConfig = options.maxThinkingTokens;
  if (isClaudeCodePreset && thinkingConfig === undefined) {
    if (maxThinkingTokensConfig === undefined) {
      thinkingConfig = { type: 'adaptive' };
    } else if (maxThinkingTokensConfig > 0) {
      thinkingConfig = { type: 'enabled' };
    }
    // maxThinkingTokens <= 0: explicit opt-out, inject nothing.
  }

  // Mutable engine config shared across turns; setModel/setMaxThinkingTokens
  // mutate it live (takes effect from the next assistant turn).
  const engineConfig: EngineConfig = {
    model: initialModel,
    fallbackModel: options.fallbackModel,
    maxOutputTokens: options.provider?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    systemPrompt: systemPromptStable,
    // Volatile (cwd) tail rides after the cache breakpoint; absent -> the
    // stable prompt is sent as a single string (e.g. a user-string prompt).
    ...(systemPromptVolatile.length > 0
      ? { systemPromptSuffix: systemPromptVolatile }
      : {}),
    // Base/tail split offset for the 2nd system cache breakpoint (string/preset
    // path only; the loop guards 0 < baseLen < systemPrompt.length so it
    // degrades to a single breakpoint when there is no appended tail).
    ...(systemPromptBaseLen !== undefined ? { systemPromptBaseLen } : {}),
    // Caller-composed segments (host layering) take precedence over the
    // string/preset path when present.
    ...(systemBlocks !== undefined ? { systemBlocks } : {}),
    maxTurns: options.maxTurns,
    maxBudgetUsd: options.maxBudgetUsd,
    thinking: thinkingConfig,
    maxThinkingTokens: maxThinkingTokensConfig,
    compaction: buildCompactionConfig(options.compaction),
    outputFormat,
    // Prompt caching is ON by default (matches the official SDK and saves the
    // static system+tools prefix on every turn of a multi-turn session). Set
    // provider.promptCaching = false to disable (e.g. for very short sessions
    // where the cache-write premium is not amortized).
    promptCaching: options.provider?.promptCaching !== false,
    includePartialMessages: options.includePartialMessages === true,
    sessionId: '', // resolved when the run starts
    cwd,
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
  });

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
  const initDeferred = createDeferred<SDKInitializationResult>();

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

  function persistParam(sessionId: string, m: APIMessageParam): void {
    if (!persist) return;
    store.append(sessionId, {
      type: m.role,
      timestamp: new Date().toISOString(),
      message: { role: m.role, content: m.content },
    });
  }

  /**
   * Persist an assistant turn AT YIELD TIME (finding #34). The engine pushes
   * the assistant to its in-memory history only after yielding it, so a
   * consumer that breaks right after the assistant message would otherwise lose
   * the answer from disk. Empty text blocks are dropped and an all-empty
   * message is skipped, so the persisted transcript never carries a
   * {role:'assistant',content:[]} turn the API would 400 on resume.
   */
  function persistAssistant(sessionId: string, content: ContentBlock[]): void {
    if (!persist) return;
    const filtered = content.filter((b) =>
      b.type === 'text' ? b.text.length > 0 : true,
    );
    if (filtered.length === 0) return;
    store.append(sessionId, {
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: filtered },
    });
  }

  /**
   * Session resolution:
   *   - resume / continue-latest -> load and replay the prior transcript (the
   *     explicit resume path). forkSession copies it under a fresh id.
   *   - sessionId (without resume/continue) -> select/create THAT id but start
   *     with EMPTY history: it labels a logically fresh session, it does not
   *     auto-resume prior content (finding #38). resume stays the only resume.
   *   - nothing -> a fresh randomUUID.
   */
  async function resolveSession(): Promise<ResolvedSession> {
    // Explicit resume source: options.resume, or continue:true -> latest.
    let resumeSource: string | undefined = options.resume;
    if (resumeSource === undefined && options.continue === true) {
      resumeSource = (await store.latestSessionId()) ?? undefined;
    }

    if (resumeSource !== undefined) {
      const stored = await store.load(resumeSource);
      if (stored !== null) {
        if (options.forkSession === true) {
          // Copy the transcript under a new id; the original stays untouched.
          // The fork's future turns run under the CURRENT query's cwd, so the
          // fork meta records `cwd`, not the source session's cwd (finding #39).
          const newId = randomUUID();
          if (persist) {
            store.append(newId, {
              type: 'meta',
              sessionId: newId,
              createdAt: Date.now(),
              cwd,
              firstPrompt: stored.firstPrompt,
            });
            for (const m of stored.messages) {
              store.append(newId, { type: m.role, message: m });
            }
          }
          return {
            sessionId: newId,
            history: [...stored.messages],
            resumed: true,
            needMeta: false,
          };
        }
        return {
          sessionId: resumeSource,
          history: [...stored.messages],
          resumed: true,
          needMeta: false,
        };
      }
      // Resume target has no stored transcript.
      if (options.forkSession === true) {
        // Fork ALWAYS mints a fresh id; never write into the (missing) source
        // id, which a later real session under that id would collide with
        // (finding #39).
        return { sessionId: randomUUID(), history: [], resumed: false, needMeta: true };
      }
      debug(
        `resume: no stored transcript for session ${resumeSource}; starting fresh under that id`,
      );
      return { sessionId: resumeSource, history: [], resumed: false, needMeta: true };
    }

    // A specific sessionId (no resume/continue) selects that id WITHOUT
    // resuming prior content: fresh history, but reuse the existing meta line
    // if a transcript already lives under that id (finding #38).
    if (options.sessionId !== undefined) {
      const existing = persist ? await store.load(options.sessionId) : null;
      return {
        sessionId: options.sessionId,
        history: [],
        resumed: false,
        needMeta: existing === null,
      };
    }

    return { sessionId: randomUUID(), history: [], resumed: false, needMeta: true };
  }

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
    let sessionTurns = 0;
    let sessionCost = 0;
    let sessionApiMs = 0;
    let sessionUsage = zeroUsage();
    const sessionModelUsage: Record<string, ModelUsage> = {};

    // Common fields for QUERY-LAYER synthetic results (hook-block, pre-turn
    // session-cap stop, interrupt): no engine turn ran for THIS result, so the
    // per-result fields are zero (E2) and the cumulative fields report the
    // session totals. The official shape for these paths is unobserved.
    const resultCommon = () => ({
      duration_ms: Date.now() - startedAt,
      duration_api_ms: sessionApiMs,
      num_turns: 0,
      total_cost_usd: sessionCost,
      usage: zeroUsage(),
      modelUsage: Object.fromEntries(
        Object.entries(sessionModelUsage).map(([k, v]) => [k, { ...v }]),
      ),
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
      // Official-surface parallel of errorMessage (reference SDK: string[]).
      errors: [errorMessage],
      ...resultCommon(),
    });

    const blockedResult = (
      sessionId: string,
      errorMessage: string,
    ): SDKResultMessage =>
      terminalResult('error_during_execution', sessionId, errorMessage);

    /** Fold one engine-turn result's totals into the session accumulators. */
    const accumulateResult = (r: SDKResultMessage): void => {
      sessionTurns += r.num_turns;
      sessionCost += r.total_cost_usd;
      sessionApiMs += r.duration_api_ms;
      sessionUsage = addUsageLocal(sessionUsage, r.usage);
      for (const [modelId, mu] of Object.entries(r.modelUsage)) {
        const prev = sessionModelUsage[modelId];
        sessionModelUsage[modelId] =
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

    /** Fold drained subagent usage/cost/modelUsage into the session totals. */
    const foldSubagentUsage = (ledger: {
      usage: NonNullableUsage;
      cost: number;
      modelUsage: Record<string, ModelUsage>;
    }): void => {
      sessionCost += ledger.cost;
      sessionUsage = addUsageLocal(sessionUsage, ledger.usage);
      for (const [modelId, mu] of Object.entries(ledger.modelUsage)) {
        const prev = sessionModelUsage[modelId];
        sessionModelUsage[modelId] =
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
      total_cost_usd: sessionCost,
      duration_api_ms: sessionApiMs,
      modelUsage: Object.fromEntries(
        Object.entries(sessionModelUsage).map(([k, v]) => [k, { ...v }]),
      ),
    });

    try {
      const sess = await resolveSession();
      resolvedSessionId = sess.sessionId;
      engineConfig.sessionId = sess.sessionId;
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
          ...builtinTools.keys(),
          ...mcpEff.allTools().map((t) => t.qualifiedName),
        ],
        mcp_servers: mcpEff
          .statuses()
          .map((s) => ({ name: s.name, status: s.status })),
        model: engineConfig.model,
        permissionMode: gate.getMode(),
        slash_commands: [],
        output_style: 'default',
        agents: wantAgent ? Object.keys(agentDefs) : [],
        claude_code_version: CLAUDE_CODE_VERSION,
        betas: options.betas ?? [],
        skills: [],
        plugins: [],
      };
      initDeferred.resolve({
        commands: [],
        agents: Object.keys(agentDefs).map((name) => ({ name })),
        output_style: 'default',
        available_output_styles: ['default'],
        models: SUPPORTED_MODELS.map((m) => ({ ...m })),
        account: { apiKeySource: transport.apiKeySource() },
      });
      yield initMessage;
      yield* drainMirror();
      // SessionStart hook lifecycle events (includeHookEvents) surface right
      // after init — they fired before the stream had anywhere to go.
      yield* drainObs();

      if (sessionStartBlocked !== undefined) {
        yield blockedResult(sess.sessionId, sessionStartBlocked);
        return;
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
          if (sessionCost >= options.maxBudgetUsd) {
            yield terminalResult(
              'error_max_budget_usd',
              sess.sessionId,
              `Estimated cost $${sessionCost.toFixed(6)} exceeded maxBudgetUsd ($${options.maxBudgetUsd})`,
            );
            return;
          }
          engineConfig.maxBudgetUsd = options.maxBudgetUsd - sessionCost;
        }
        if (options.maxTurns !== undefined) {
          if (sessionTurns >= options.maxTurns) {
            yield terminalResult(
              'error_max_turns',
              sess.sessionId,
              `Reached maxTurns limit (${options.maxTurns})`,
            );
            return;
          }
          engineConfig.maxTurns = options.maxTurns - sessionTurns;
        }

        // Delegate to the engine loop for this turn.
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
          cwd,
          additionalDirectories: options.additionalDirectories ?? [],
          env,
          signal: turnSignal,
          debug,
          spawnSubagent: subagentRuntime.makeSpawnFn(0),
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
        };
        const deps: EngineDeps = {
          transport,
          builtinTools,
          mcp: mcpEff,
          permissions: gate,
          hooks,
          toolContext,
          debug,
          requestView,
          drainSubagentResults: () => subagentRuntime.drainCompletedResults(),
          drainObservability,
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

        try {
          for await (const msg of runAgentLoop(history, deps, engineConfig)) {
            yield* flushToolResultUsers();
            yield* drainMirror();
            yield* drainObs();
            if (msg.type === 'assistant') {
              persistAssistant(sess.sessionId, msg.message.content);
              yield msg;
            } else if (msg.type === 'result') {
              // Fold any completed subagent usage into the session totals before
              // the result is rewritten so subagent tokens/cost are reported.
              foldSubagentUsage(subagentRuntime.drainUsageLedger());
              accumulateResult(msg);
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
        } catch (err) {
          // Persist (but do not re-yield on error) any trailing tool_result
          // user turn so the transcript stays durable across the failure.
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
              return;
            }
            continue;
          }
          throw err;
        } finally {
          turnController = null;
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
      try {
        await mcpEff.closeAll();
      } catch (err) {
        debug(
          `mcp closeAll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
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

    async interrupt(): Promise<void> {
      // Abort the active turn if one is running; otherwise queue the cancel so
      // the NEXT turn to start is aborted immediately, instead of being a
      // silent no-op when interrupt() lands between turns or right after init
      // (finding #36).
      if (turnController !== null) {
        turnController.abort(new AbortError('The turn was interrupted'));
      } else {
        interruptRequested = true;
      }
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
    initializationResult(): Promise<SDKInitializationResult> {
      return initDeferred.promise;
    },
    async supportedCommands(): Promise<never[]> {
      return [];
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
      return mcpEff.statuses();
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
      return mcpEff.setServers(servers);
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
      void mcpEff.closeAll().catch((err) => {
        debug(
          `mcp closeAll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
  };

  return q;
}
