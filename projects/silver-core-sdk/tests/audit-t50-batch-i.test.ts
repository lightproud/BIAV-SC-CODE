/**
 * T50 batch I regression locks — subagent lifecycle (second-pass audit
 * silver-core-sdk-bug-audit-r2-20260717.md): K1–K9 + M2-1.
 *
 *  K1  TaskStop on a blocking foreground SendMessage continuation resolved to
 *      a "stopped" result instead of killing the parent query.
 *  K2  A continuation repairs a dangling assistant tool_use tail before
 *      appending the message (no more guaranteed 400s after a budget pre-stop).
 *  K3  A BACKGROUND continuation no longer chains the acking turn's signal.
 *  K4  A killed/aborted child's already-billed spend reaches the usage ledger.
 *  K5  A kill invalidates continuations already queued behind the killed run.
 *  K6  Kill-then-continue keeps the single sidechain bracket intact.
 *  K7  AgentDefinition.tools allowlist matches builtins with the same pattern
 *      semantics as MCP (`tools: ['*']` keeps builtins).
 *  K8  SubagentStart reports the RESOLVED agent_type, matching SubagentStop.
 *  K9  Prototype-inherited names ("constructor") fall back to general-purpose.
 *  M2-1 A worktree-isolated child's sandbox writablePaths include the worktree.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveAgentDefinition } from '../src/subagents/agents.js';
import {
  createSubagentRuntime,
  type SubagentRuntimeOptions,
} from '../src/subagents/runtime.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { AbortError } from '../src/errors.js';
import type {
  BuiltinTool,
  EngineConfig,
  McpRegistry,
  SessionStore,
  SpawnSubagentParams,
  StoredSession,
  StreamRequest,
  Transport,
} from '../src/internal/contracts.js';
import type {
  AgentDefinition,
  ApiKeySource,
  APIMessageParam,
  CallToolResult,
  HookInput,
  McpServerStatus,
  RawMessageStreamEvent,
  SandboxBackend,
  SandboxContext,
  SDKMessage,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Fakes / builders (trimmed twins of tests/subagents.test.ts)
// ---------------------------------------------------------------------------

class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'x' }], isError: true };
  }
  async reconnect(): Promise<void> {}
  setEnabled(): void {}
  async setServers() {
    return { servers: [] };
  }
  async closeAll(): Promise<void> {}
}

class FakeStore implements SessionStore {
  readonly entries = new Map<string, Array<Record<string, unknown>>>();
  append(sessionId: string, entry: Record<string, unknown>): void {
    const arr = this.entries.get(sessionId) ?? [];
    arr.push(entry);
    this.entries.set(sessionId, arr);
  }
  async load(): Promise<StoredSession | null> {
    return null;
  }
  async list(): Promise<StoredSession[]> {
    return [];
  }
  async latestSessionId(): Promise<string | null> {
    return null;
  }
}

/**
 * Scripted transport where any script slot may be the sentinel 'hang': that
 * stream() call blocks until its request signal aborts (then rejects with
 * AbortError) — the shape of a child mid-turn when a kill lands.
 */
type FlexScript = RawMessageStreamEvent[] | 'hang';
class FlexTransport implements Transport {
  readonly requests: StreamRequest[] = [];
  private calls = 0;
  constructor(private readonly scripts: FlexScript[]) {}
  apiKeySource(): ApiKeySource {
    return 'user';
  }
  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    this.requests.push(req);
    const script = this.scripts[this.calls++];
    if (script === undefined) {
      throw new Error(`FlexTransport: unexpected stream() call #${this.calls}`);
    }
    if (script === 'hang') {
      await new Promise<void>((_, reject) => {
        const sig = req.signal;
        if (sig?.aborted) {
          reject(new AbortError());
          return;
        }
        sig?.addEventListener('abort', () => reject(new AbortError()), { once: true });
      });
      return;
    }
    for (const ev of script) {
      if (req.signal?.aborted) throw new AbortError();
      yield ev;
    }
  }
}

function recordingTool(
  name: string,
  executed: Array<Record<string, unknown>>,
): BuiltinTool {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    async execute(input) {
      executed.push(input);
      return { content: `${name} ran` };
    },
  };
}

type Harness = {
  runtime: ReturnType<typeof createSubagentRuntime>;
  transport: MockTransport | FlexTransport;
  startInputs: HookInput[];
  stopInputs: HookInput[];
  emitted: SDKMessage[];
};

function makeRuntime(cfg: {
  scripts?: RawMessageStreamEvent[][];
  transport?: MockTransport | FlexTransport;
  agents?: Record<string, AgentDefinition>;
  baseBuiltins?: Map<string, BuiltinTool>;
  engineConfig?: Partial<EngineConfig>;
  withStartStopHooks?: boolean;
  store?: SessionStore;
  persist?: boolean;
  cwd?: string;
  sandbox?: SandboxContext;
}): Harness {
  const transport = cfg.transport ?? new MockTransport(cfg.scripts ?? []);
  const startInputs: HookInput[] = [];
  const stopInputs: HookInput[] = [];
  const emitted: SDKMessage[] = [];
  const hooks = new DefaultHookRunner({
    hooks: cfg.withStartStopHooks
      ? {
          SubagentStart: [
            {
              hooks: [
                async (input) => {
                  startInputs.push(input);
                },
              ],
            },
          ],
          SubagentStop: [
            {
              hooks: [
                async (input) => {
                  stopInputs.push(input);
                },
              ],
            },
          ],
        }
      : {},
    debug: () => {},
  });
  const engineConfig: EngineConfig = {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'parent',
    includePartialMessages: false,
    sessionId: 'parent-sess',
    cwd: cfg.cwd ?? '/tmp/sub-test',
    ...cfg.engineConfig,
  };
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins: cfg.baseBuiltins ?? new Map<string, BuiltinTool>(),
    mcp: new FakeMcp(),
    transport: transport as Transport,
    hooks,
    parentGate: new DefaultPermissionGate({ debug: () => {} }),
    engineConfig,
    store: cfg.store,
    persist: cfg.persist,
    cwd: cfg.cwd ?? '/tmp/sub-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
    emitObservability: (m) => emitted.push(m),
    sandbox: cfg.sandbox,
  };
  return {
    runtime: createSubagentRuntime(opts),
    transport,
    startInputs,
    stopInputs,
    emitted,
  };
}

const baseParams = (
  over: Partial<SpawnSubagentParams> = {},
): SpawnSubagentParams => ({
  subagentType: 'general-purpose',
  prompt: 'do the task',
  toolUseId: '',
  signal: new AbortController().signal,
  ...over,
});

async function tick(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1));
}

/** Polls until cond() is true. cond may have side effects (e.g. draining a
 *  buffer), so it is NEVER re-invoked after it first returns true. */
async function waitFor(cond: () => boolean, ticks = 500): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    if (cond()) return;
    await tick(1);
  }
  throw new Error('waitFor: condition not met within the tick budget');
}

/** True when any assistant tool_use turn lacks a following tool_result turn. */
function hasDanglingToolUse(messages: APIMessageParam[]): boolean {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    const usesTool = m.content.some(
      (b) => (b as { type?: string }).type === 'tool_use',
    );
    if (!usesTool) continue;
    const next = messages[i + 1];
    const paired =
      next !== undefined &&
      next.role === 'user' &&
      typeof next.content !== 'string' &&
      next.content.some((b) => (b as { type?: string }).type === 'tool_result');
    if (!paired) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// K9 — prototype-inherited agent names
// ---------------------------------------------------------------------------

describe('K9: resolveAgentDefinition own-property guard', () => {
  it('prototype-inherited names fall back to general-purpose instead of erroring', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = resolveAgentDefinition(name, {}, () => {});
      expect('error' in r, `${name} must not hard-error`).toBe(false);
      if (!('error' in r)) {
        expect(r.type).toBe('general-purpose');
        expect(r.synthetic).toBe(true);
      }
    }
  });

  it('a genuinely registered agent still resolves as before', () => {
    const r = resolveAgentDefinition(
      'worker',
      { worker: { description: 'w', prompt: 'you work' } },
      () => {},
    );
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.definition.prompt).toBe('you work');
  });
});

// ---------------------------------------------------------------------------
// K7 — tools allowlist wildcard symmetry
// ---------------------------------------------------------------------------

describe('K7: AgentDefinition.tools matches builtins with pattern semantics', () => {
  it("tools: ['*'] keeps the builtin tool set (it used to strip every builtin)", async () => {
    const executed: Array<Record<string, unknown>> = [];
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents('Read', { file_path: '/a' }, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: new Map([['Read', recordingTool('Read', executed)]]),
      agents: { star: { description: 's', prompt: 'p', tools: ['*'] } },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'star' }));
    expect(res.isError).toBe(false);
    // The builtin survived the allowlist AND actually ran.
    expect(executed).toHaveLength(1);
    const toolNames = (h.transport.requests[0]?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('Read');
  });

  it('an exact-name allowlist still intersects as before', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const h = makeRuntime({
      scripts: [textReplyEvents('done', { model: 'claude-sonnet-4-5' })],
      baseBuiltins: new Map([
        ['Read', recordingTool('Read', executed)],
        ['Write', recordingTool('Write', executed)],
      ]),
      agents: { narrow: { description: 'n', prompt: 'p', tools: ['Read'] } },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'narrow' }));
    expect(res.isError).toBe(false);
    const toolNames = (h.transport.requests[0]?.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain('Read');
    expect(toolNames).not.toContain('Write');
  });
});

// ---------------------------------------------------------------------------
// K8 — Start/Stop agent_type parity on fallback
// ---------------------------------------------------------------------------

describe('K8: SubagentStart reports the resolved agent_type', () => {
  it('an unknown requested type reports general-purpose on BOTH Start and Stop', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('done', { model: 'claude-sonnet-4-5' })],
      withStartStopHooks: true,
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'mystery-unregistered-type' }),
    );
    expect(res.isError).toBe(false);
    expect(h.startInputs).toHaveLength(1);
    expect(h.stopInputs).toHaveLength(1);
    expect(h.startInputs[0]!.agent_type).toBe('general-purpose');
    expect(h.stopInputs[0]!.agent_type).toBe('general-purpose');
  });
});

// ---------------------------------------------------------------------------
// K2 — continuation tail repair
// ---------------------------------------------------------------------------

describe('K2: SendMessage continuation repairs a dangling tool_use tail', () => {
  it('a budget pre-stopped worker can be continued with an API-valid request', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents('Read', { file_path: '/a' }, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('continued fine', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: new Map([['Read', recordingTool('Read', executed)]]),
      // The first turn's cost already exceeds the budget: the run pre-stops
      // with the assistant tool_use turn UNPAIRED at the history tail.
      engineConfig: { maxBudgetUsd: 1e-9 },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(true); // budget pre-stop
    expect(executed).toHaveLength(0); // the tool never ran -> dangling tail

    await h.runtime.sendMessage({
      to: res.agentId,
      message: 'please summarize what you have so far',
      signal: new AbortController().signal,
    });
    const contReq = h.transport.requests[1];
    expect(contReq).toBeDefined();
    // NOTE: contReq.messages is the LIVE child history (the loop appends the
    // continuation's own reply to it after the request), so assert the
    // API-validity invariant and the user-turn content, not the final index.
    // The dangling assistant tool_use turn is GONE from the request: every
    // remaining tool_use is paired, and the run opened on a user turn.
    expect(hasDanglingToolUse(contReq!.messages)).toBe(false);
    expect(contReq!.messages[0]!.role).toBe('user');
    const userText = contReq!.messages
      .filter((m) => m.role === 'user')
      .map((m) =>
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      )
      .join('\n');
    expect(userText).toContain('please summarize');
  });
});

// ---------------------------------------------------------------------------
// K3 — background continuation is detached from the acking turn's signal
// ---------------------------------------------------------------------------

describe('K3: background continuation survives the acking turn ending', () => {
  it('aborting the SendMessage call signal after the ack does not kill the reply', async () => {
    const h = makeRuntime({
      scripts: [
        textReplyEvents('first', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('the reply', { model: 'claude-sonnet-4-5' }),
      ],
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ runInBackground: true }));
    expect(res.background).toBe(true);
    await waitFor(() => h.runtime.drainCompletedResults().length > 0);

    const ac = new AbortController();
    const ack = await h.runtime.sendMessage({
      to: res.agentId,
      message: 'one more thing',
      signal: ac.signal,
    });
    expect(ack.isError).toBe(false);
    // The acking turn ends (its signal aborts) right after delivery — the
    // DETACHED continuation must keep running and deliver its reply.
    ac.abort();
    let notes: string[] = [];
    await waitFor(() => {
      notes = notes.concat(
        h.runtime.drainCompletedResults().map((b) => b.text),
      );
      return notes.length > 0;
    });
    expect(notes.join('\n')).toContain('replied');
    expect(notes.join('\n')).toContain('the reply');
  });
});

// ---------------------------------------------------------------------------
// K4 — aborted child spend reaches the ledger
// ---------------------------------------------------------------------------

describe('K4: a killed child run keeps its billed spend in the usage ledger', () => {
  it('stopTask mid-run folds the aborted run accounting into the ledger', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const transport = new FlexTransport([
      // Turn 1: a PRICED assistant turn (billed), then turn 2 hangs mid-call.
      toolUseReplyEvents('Read', { file_path: '/a' }, { model: 'claude-sonnet-4-5' }),
      'hang',
    ]);
    const h = makeRuntime({
      transport,
      baseBuiltins: new Map([['Read', recordingTool('Read', executed)]]),
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ runInBackground: true }));
    await waitFor(() => transport.requests.length === 2);
    h.runtime.stopTask(res.agentId);
    await tick(20);
    const ledger = h.runtime.drainUsageLedger();
    // Turn 1 was billed before the kill: the ledger must carry its tokens and
    // cost (they used to vanish — no result message is emitted on abort).
    expect(ledger.usage.input_tokens).toBeGreaterThan(0);
    expect(ledger.usage.output_tokens).toBeGreaterThan(0);
    expect(ledger.cost).toBeGreaterThan(0);
    expect(Object.keys(ledger.modelUsage)).toContain('claude-sonnet-4-5');
  });
});

// ---------------------------------------------------------------------------
// K5 — a kill wins over continuations queued behind the killed run
// ---------------------------------------------------------------------------

describe('K5: TaskStop is not silently revoked by a queued SendMessage', () => {
  it('a continuation enqueued before the kill never runs; one sent after does', async () => {
    const transport = new FlexTransport([
      'hang', // the initial background run (killed mid-call)
      textReplyEvents('revived reply', { model: 'claude-sonnet-4-5' }),
    ]);
    const h = makeRuntime({ transport });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ runInBackground: true }));
    await waitFor(() => transport.requests.length === 1);
    // Queue a message BEHIND the running (hanging) turn, then kill the agent.
    const ack = await h.runtime.sendMessage({
      to: res.agentId,
      message: 'queued while running',
      signal: new AbortController().signal,
    });
    expect(ack.isError).toBe(false);
    h.runtime.stopTask(res.agentId);
    await tick(30);
    // The queued continuation was DROPPED: no second API call, the agent
    // stayed killed, and the coordinator was told the message was not run.
    expect(transport.requests).toHaveLength(1);
    expect(h.runtime.stopAgent(res.agentId)).toBe(
      `Subagent ${res.agentId} already killed.`,
    );
    const dropNotes = h.runtime.drainCompletedResults().map((b) => b.text).join('\n');
    expect(dropNotes).toContain('stopped before this message was delivered');

    // Official semantics preserved: a SendMessage issued AFTER the kill
    // legitimately revives the worker.
    const ack2 = await h.runtime.sendMessage({
      to: res.agentId,
      message: 'wake back up',
      signal: new AbortController().signal,
    });
    expect(ack2.isError).toBe(false);
    let notes = '';
    await waitFor(() => {
      notes += h.runtime.drainCompletedResults().map((b) => b.text).join('\n');
      return notes.includes('revived reply');
    });
    expect(transport.requests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// K6 — kill-then-continue keeps the single sidechain bracket
// ---------------------------------------------------------------------------

describe('K6: kill-then-continue transcript stays inside one bracket', () => {
  it('the single sidechain_end is written at teardown, after every revived turn', async () => {
    const store = new FakeStore();
    const transport = new FlexTransport([
      'hang', // initial foreground run, killed mid-call
      textReplyEvents('revived', { model: 'claude-sonnet-4-5' }),
    ]);
    const h = makeRuntime({ transport, store, persist: true });
    const pending = h.runtime.makeSpawnFn(0)(baseParams());
    // Discover the agentId from task_started, then kill mid-run.
    let agentId: string | undefined;
    await waitFor(() => {
      const started = h.emitted.find(
        (m) => 'subtype' in m && m.subtype === 'task_started',
      );
      if (started !== undefined) agentId = (started as { task_id: string }).task_id;
      return agentId !== undefined;
    });
    let stopped: string | undefined;
    await waitFor(() => {
      stopped = h.runtime.stopAgent(agentId!);
      return stopped !== undefined;
    });
    const res = await pending;
    expect(res.isError).toBe(true);

    // Revive with a successful continuation, then tear down.
    const cont = await h.runtime.sendMessage({
      to: agentId!,
      message: 'continue after the kill',
      signal: new AbortController().signal,
    });
    expect(cont.isError).toBe(false);
    await h.runtime.settleAll();

    const entries = store.entries.get(agentId!) ?? [];
    const starts = entries.filter((e) => e.type === 'sidechain_start');
    const ends = entries.filter((e) => e.type === 'sidechain_end');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    // The single end is the LAST entry — the revived episode's turns sit
    // INSIDE the bracket (they used to trail after a prematurely written end).
    expect(entries[entries.length - 1]!.type).toBe('sidechain_end');
    // The revival succeeded, so the terminal error state is the LAST
    // episode's (false), not the kill's.
    expect(ends[0]!.is_error).toBe(false);
    // The revived assistant turn really was persisted inside the bracket.
    expect(entries.some((e) => e.type === 'assistant')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// K1 — TaskStop on a blocking foreground continuation
// ---------------------------------------------------------------------------

describe('K1: stopping a blocked foreground continuation spares the parent', () => {
  it('resolves the SendMessage call to a stopped result instead of rethrowing', async () => {
    const transport = new FlexTransport([
      textReplyEvents('first answer', { model: 'claude-sonnet-4-5' }),
      'hang', // the continuation the kill lands on
      'hang', // a second continuation for the genuine-abort arm
    ]);
    const h = makeRuntime({ transport });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);

    const pending = h.runtime.sendMessage({
      to: res.agentId,
      message: 'dig deeper',
      signal: new AbortController().signal,
    });
    await waitFor(() => transport.requests.length === 2);
    expect(h.runtime.stopAgent(res.agentId)).toBe(
      `Stopped foreground subagent ${res.agentId}.`,
    );
    // The blocking SendMessage RESOLVES — the AbortError must not propagate
    // and kill the whole parent query (M-11c parity for continuations).
    const stoppedResult = await pending;
    expect(stoppedResult.isError).toBe(true);
    expect(stoppedResult.content).toContain('stopped');
    expect(stoppedResult.content).toContain(res.agentId);

    // A genuine parent-side abort (the call's own signal) still rethrows.
    const ac = new AbortController();
    const pending2 = h.runtime.sendMessage({
      to: res.agentId,
      message: 'again',
      signal: ac.signal,
    });
    await waitFor(() => transport.requests.length === 3);
    ac.abort();
    await expect(pending2).rejects.toBeInstanceOf(AbortError);
  });
});

// ---------------------------------------------------------------------------
// M2-1 — worktree sandbox writability
// ---------------------------------------------------------------------------

describe('M2-1: worktree-isolated children get a sandbox-writable worktree', () => {
  let tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
    tempDirs = [];
  });

  function makeGitRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'bpt-t50i-repo-'));
    tempDirs.push(repo);
    const git = (...args: string[]): void => {
      const r = spawnSync(
        'git',
        ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
        { cwd: repo, encoding: 'utf8' },
      );
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    };
    git('init', '-q');
    writeFileSync(join(repo, 'seed.txt'), 'seed\n');
    git('add', 'seed.txt');
    git('commit', '-q', '-m', 'seed');
    return repo;
  }

  it('spawn AND continuation re-provision put the worktree into writablePaths', async () => {
    const repo = makeGitRepo();
    const backend = {
      name: 'fake-backend',
      wrap: (r: unknown) => r,
    } as unknown as SandboxBackend;
    const rootSandbox: SandboxContext = {
      backend,
      tmpDir: '',
      writablePaths: [repo],
      allowNetwork: false,
      allowEscape: true,
    };
    const probes: Array<{ cwd: string; writable: string[] }> = [];
    const probe: BuiltinTool = {
      name: 'Probe',
      description: 'records ctx.cwd + sandbox writablePaths',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      async execute(_input, ctx) {
        probes.push({
          cwd: ctx.cwd,
          writable: [...(ctx.sandbox?.writablePaths ?? [])],
        });
        return { content: 'probed' };
      },
    };
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents('Probe', {}, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
        toolUseReplyEvents('Probe', {}, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('done again', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: new Map([['Probe', probe]]),
      cwd: repo,
      sandbox: rootSandbox,
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ isolation: 'worktree' }));
    expect(res.isError).toBe(false);
    expect(probes).toHaveLength(1);
    // The child ran in the worktree, and that worktree is sandbox-writable
    // (the root sandbox only listed the repo root — bwrap would have ro-bound
    // the worktree and EROFS'd every write).
    expect(probes[0]!.cwd).not.toBe(repo);
    expect(probes[0]!.writable).toContain(probes[0]!.cwd);
    expect(probes[0]!.writable).toContain(repo); // root paths preserved

    // Clean tree -> the worktree was auto-removed; the continuation
    // re-provisions a FRESH one, which must be writable too.
    expect(existsSync(probes[0]!.cwd)).toBe(false);
    const cont = await h.runtime.sendMessage({
      to: res.agentId,
      message: 'once more',
      signal: new AbortController().signal,
    });
    expect(cont.isError).toBe(false);
    expect(probes).toHaveLength(2);
    expect(probes[1]!.cwd).not.toBe(probes[0]!.cwd);
    expect(probes[1]!.writable).toContain(probes[1]!.cwd);
    if (existsSync(probes[1]!.cwd)) tempDirs.push(probes[1]!.cwd);
    // The root sandbox object itself was never mutated.
    expect(rootSandbox.writablePaths).toEqual([repo]);
  });
});
