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
  APIMessageParam,
  APIUserMessage,
  ModelInfo,
  NonNullableUsage,
  Options,
  PermissionMode,
  Query,
  SDKInitializationResult,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  TextBlockParam,
} from './types.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  ToolContext,
} from './internal/contracts.js';
import { AnthropicTransport } from './transport/anthropic.js';
import { DefaultPermissionGate } from './permissions/gate.js';
import { DefaultHookRunner } from './hooks/runner.js';
import { DefaultMcpRegistry } from './mcp/registry.js';
import { runAgentLoop } from './engine/loop.js';
import { buildSystemPrompt } from './engine/prompts.js';
import { JsonlSessionStore } from './sessions/store.js';
import { createBuiltinTools } from './tools/index.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Static model list surfaced by supportedModels()/initializationResult(). */
const SUPPORTED_MODELS: readonly ModelInfo[] = [
  { id: 'claude-opus-4-8' },
  { id: 'claude-sonnet-5' },
  { id: 'claude-haiku-4-5' },
  { id: 'claude-sonnet-4-5' },
];

/**
 * Options accepted for @anthropic-ai/claude-agent-sdk type/runtime compat
 * but with no behavior in v0.1 (see docs/COMPAT.md). Each present key emits
 * exactly one debug warning. Untyped keys cover migration call sites that
 * pass reference-SDK-only fields through a widened object.
 */
const ACCEPTED_OPTION_KEYS: readonly string[] = [
  'agents',
  'settingSources',
  'effort',
  'outputFormat',
  'sandbox',
  'plugins',
  'skills',
  'toolAliases',
  'toolConfig',
  'sessionStore',
  'managedSettings',
  'enableFileCheckpointing',
  'taskBudget',
  'onElicitation',
  'planModeInstructions',
  'promptSuggestions',
  'agentProgressSummaries',
  'forwardSubagentText',
  'includeHookEvents',
  'loadTimeoutMs',
  'allowDangerouslySkipPermissions',
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
        `option '${key}' is accepted for compatibility but has no effect in v0.1 (see docs/COMPAT.md)`,
      );
    }
  }

  const initialModel = options.model ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // --- Collaborators ---------------------------------------------------------
  const outer = options.abortController ?? new AbortController();
  const persist = options.persistSession !== false;
  const store = new JsonlSessionStore({
    sessionDir: options.sessionDir,
    env,
    debug,
  });
  const transport = new AnthropicTransport({
    provider: options.provider,
    env,
    debug,
    betas: options.betas,
  });
  const gate = new DefaultPermissionGate({
    mode: options.permissionMode,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    canUseTool: options.canUseTool,
    debug,
  });
  const hooks = new DefaultHookRunner({ hooks: options.hooks, debug });
  const mcp = new DefaultMcpRegistry({
    servers: options.mcpServers ?? {},
    env,
    debug,
  });

  // Built-in tools, optionally filtered by the array form of options.tools
  // (the claude_code preset and undefined both mean "all built-ins").
  const allBuiltins = createBuiltinTools();
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

  // Mutable engine config shared across turns; setModel/setMaxThinkingTokens
  // mutate it live (takes effect from the next assistant turn).
  const engineConfig: EngineConfig = {
    model: initialModel,
    fallbackModel: options.fallbackModel,
    maxOutputTokens: options.provider?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    systemPrompt: buildSystemPrompt(options.systemPrompt, {
      cwd,
      toolNames: [...builtinTools.keys()],
    }),
    maxTurns: options.maxTurns,
    maxBudgetUsd: options.maxBudgetUsd,
    thinking: options.thinking,
    maxThinkingTokens: options.maxThinkingTokens,
    includePartialMessages: options.includePartialMessages === true,
    sessionId: '', // resolved when the run starts
    cwd,
  };

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

  // Wake any pending input read when the outer controller aborts. A
  // pre-aborted controller never fires the event, so check up front.
  if (outer.signal.aborted) {
    queue.fail(new AbortError('The query was aborted'));
  } else {
    outer.signal.addEventListener(
      'abort',
      () => queue.fail(new AbortError('The query was aborted')),
      { once: true },
    );
  }

  // --- Shared run state -------------------------------------------------------
  let turnController: AbortController | null = null;
  let closed = false;
  let sessionEndFired = false;
  let resolvedSessionId = '';
  const initDeferred = createDeferred<SDKInitializationResult>();

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

  /** resume > sessionId > continue-latest > fresh randomUUID. */
  async function resolveSession(): Promise<ResolvedSession> {
    let source: string | undefined = options.resume ?? options.sessionId;
    if (source === undefined && options.continue === true) {
      source = (await store.latestSessionId()) ?? undefined;
    }
    if (source !== undefined) {
      const stored = await store.load(source);
      if (stored !== null) {
        if (options.forkSession === true) {
          // Copy the transcript under a new id; the original stays untouched.
          const newId = randomUUID();
          if (persist) {
            store.append(newId, {
              type: 'meta',
              sessionId: newId,
              createdAt: Date.now(),
              cwd: stored.cwd ?? cwd,
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
          sessionId: source,
          history: [...stored.messages],
          resumed: true,
          needMeta: false,
        };
      }
      if (options.resume !== undefined) {
        debug(
          `resume: no stored transcript for session ${source}; starting fresh under that id`,
        );
      }
      return { sessionId: source, history: [], resumed: false, needMeta: true };
    }
    return { sessionId: randomUUID(), history: [], resumed: false, needMeta: true };
  }

  // --- The run generator -------------------------------------------------------
  async function* run(): AsyncGenerator<SDKMessage, void> {
    const startedAt = Date.now();
    let endReason = 'exit';

    const blockedResult = (
      sessionId: string,
      errorMessage: string,
    ): SDKResultMessage => ({
      type: 'result',
      subtype: 'error_during_execution',
      uuid: randomUUID(),
      session_id: sessionId,
      duration_ms: Date.now() - startedAt,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: zeroUsage(),
      modelUsage: {},
      permission_denials: gate.denials(),
      errorMessage,
    });

    try {
      const sess = await resolveSession();
      resolvedSessionId = sess.sessionId;
      engineConfig.sessionId = sess.sessionId;
      const history = sess.history;
      let needMeta = sess.needMeta;

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
        await mcp.connectAll();
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
          ...mcp.allTools().map((t) => t.qualifiedName),
        ],
        mcp_servers: mcp
          .statuses()
          .map((s) => ({ name: s.name, status: s.status })),
        model: engineConfig.model,
        permissionMode: gate.getMode(),
        slash_commands: [],
        output_style: 'default',
      };
      initDeferred.resolve({
        commands: [],
        agents: [],
        output_style: 'default',
        available_output_styles: ['default'],
        models: SUPPORTED_MODELS.map((m) => ({ ...m })),
        account: { apiKeySource: transport.apiKeySource() },
      });
      yield initMessage;

      if (sessionStartBlocked !== undefined) {
        yield blockedResult(sess.sessionId, sessionStartBlocked);
        return;
      }

      // 3. Consume user turns until the input queue closes.
      for (;;) {
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

        // UserPromptSubmit hooks: block ends the run; additionalContext is
        // appended to the prompt (SessionStart context rides the first turn).
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
            yield blockedResult(
              sess.sessionId,
              agg.stopReason ??
                agg.decisionReason ??
                'UserPromptSubmit hook blocked the prompt',
            );
            return;
          }
          extraLines.push(...agg.additionalContext);
        }
        message = appendContextLines(message, extraLines);

        // Echo the user message, then append to history + store.
        const echoed: SDKUserMessage = {
          type: 'user',
          uuid: incoming.uuid ?? randomUUID(),
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
        persistParam(sess.sessionId, userParam);
        yield echoed;

        // 4. Delegate to the engine loop for this turn.
        turnController = new AbortController();
        const turnSignal = AbortSignal.any([outer.signal, turnController.signal]);
        const toolContext: ToolContext = {
          cwd,
          additionalDirectories: options.additionalDirectories ?? [],
          env,
          signal: turnSignal,
          debug,
        };
        const deps: EngineDeps = {
          transport,
          builtinTools,
          mcp,
          permissions: gate,
          hooks,
          toolContext,
          debug,
        };

        // The loop appends assistant/tool-result messages to `history`
        // in place (it does not yield tool-result user messages), so
        // persistence tracks the history tail rather than the yields.
        let persistedCount = history.length;
        const syncPersist = (): void => {
          while (persistedCount < history.length) {
            const entry = history[persistedCount];
            persistedCount += 1;
            if (entry !== undefined) persistParam(sess.sessionId, entry);
          }
        };

        try {
          for await (const msg of runAgentLoop(history, deps, engineConfig)) {
            syncPersist();
            yield msg;
          }
          syncPersist();
        } catch (err) {
          syncPersist();
          if (isAbortError(err)) {
            if (outer.signal.aborted) {
              throw err instanceof AbortError ? err : new AbortError();
            }
            // Turn-level interrupt(): streaming mode keeps accepting input;
            // string mode ends the run.
            debug('query: turn interrupted');
            if (!streamingMode) {
              endReason = 'interrupt';
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
      if (!initDeferred.settled) {
        initDeferred.reject(
          new AbortError('query ended before initialization completed'),
        );
      }
      await fireSessionEnd(endReason);
      try {
        await mcp.closeAll();
      } catch (err) {
        debug(
          `mcp closeAll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // --- Query wrapper -------------------------------------------------------------
  const inner = run();

  const q: Query = {
    next(...nextArgs: [] | [unknown]): Promise<IteratorResult<SDKMessage, void>> {
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
      turnController?.abort(new AbortError('The turn was interrupted'));
    },
    async setPermissionMode(mode: PermissionMode): Promise<void> {
      gate.setMode(mode);
    },
    async setModel(model?: string): Promise<void> {
      engineConfig.model = model ?? initialModel;
    },
    async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
      engineConfig.maxThinkingTokens = maxThinkingTokens ?? undefined;
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
    async supportedAgents(): Promise<never[]> {
      return [];
    },
    async mcpServerStatus() {
      return mcp.statuses();
    },
    async accountInfo() {
      return { apiKeySource: transport.apiKeySource() };
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
      // Fire SessionEnd first (flag set synchronously) so the generator's
      // finally block does not race a different reason in.
      void fireSessionEnd('close');
      queue.fail(reason);
      if (!outer.signal.aborted) outer.abort(reason);
      void inner.return(undefined).catch(() => undefined);
      void mcp.closeAll().catch((err) => {
        debug(
          `mcp closeAll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
  };

  return q;
}
