/**
 * Audit wave 19 — subagent spawning/lifecycle regressions.
 *
 * Two defects found by driving the real runtime (MockTransport + the real
 * DefaultPermissionGate / DefaultHookRunner), both on paths the happy-path
 * suites never reach:
 *
 *  1. settleAll()'s TIMEOUT arm stamped each started child's terminal
 *     sidechain_end even for children still streaming — filing the marker
 *     BEFORE the work it closes, with a stale is_error.
 *  2. A SendMessage continuation ran on the SPAWN-TIME permission snapshot, so
 *     a session denial the host issued after the spawn evaporated.
 */

import { describe, expect, it } from 'vitest';

import {
  createSubagentRuntime,
  pendingSessionRules,
  type SubagentRuntimeOptions,
} from '../src/subagents/runtime.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  BuiltinTool,
  EngineConfig,
  SessionStore,
  SpawnSubagentParams,
  Transport,
} from '../src/internal/contracts.js';
import type { AgentDefinition, RawMessageStreamEvent } from '../src/types.js';
import { MockTransport, textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';
import { FakeMcp, FakeStore } from './helpers/engine-fakes.js';

function makeRuntime(cfg: {
  scripts: RawMessageStreamEvent[][];
  agents?: Record<string, AgentDefinition>;
  baseBuiltins?: Map<string, BuiltinTool>;
  store?: SessionStore;
  persist?: boolean;
  transport?: Transport;
  parentGate?: DefaultPermissionGate;
}) {
  const engineConfig: EngineConfig = {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'parent',
    includePartialMessages: false,
    sessionId: 'parent-sess',
    cwd: '/tmp/sub-test',
  };
  const parentGate = cfg.parentGate ?? new DefaultPermissionGate({ debug: () => {} });
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins: cfg.baseBuiltins ?? new Map<string, BuiltinTool>(),
    mcp: new FakeMcp(),
    transport: cfg.transport ?? new MockTransport(cfg.scripts),
    hooks: new DefaultHookRunner({ hooks: {}, debug: () => {} }),
    parentGate,
    engineConfig,
    store: cfg.store,
    persist: cfg.persist,
    cwd: '/tmp/sub-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
  };
  return { runtime: createSubagentRuntime(opts), parentGate };
}

const baseParams = (over: Partial<SpawnSubagentParams> = {}): SpawnSubagentParams => ({
  subagentType: 'general-purpose',
  prompt: 'do the task',
  toolUseId: '',
  signal: new AbortController().signal,
  ...over,
});

async function tick(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1));
}

/** Transport whose stream only starts producing after `delayMs`. */
class SlowTransport implements Transport {
  constructor(
    private readonly delayMs: number,
    private readonly fail = false,
  ) {}
  apiKeySource(): 'user' {
    return 'user';
  }
  async *stream(): AsyncGenerator<RawMessageStreamEvent, void> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw new Error('late boom');
    for (const ev of textReplyEvents('late answer', { model: 'claude-sonnet-4-5' })) yield ev;
  }
}

// ---------------------------------------------------------------------------
// 1. settleAll() timeout arm must not stamp sidechain_end ahead of the work
// ---------------------------------------------------------------------------

describe('settleAll() timeout: the terminal sidechain marker stays last', () => {
  it('a background child that answers past the deadline files its turn BEFORE sidechain_end', async () => {
    const store = new FakeStore();
    const { runtime } = makeRuntime({
      scripts: [],
      transport: new SlowTransport(120),
      store,
      persist: true,
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const res = await runtime.makeSpawnFn(0)(baseParams({ subagentType: 'worker' }));

    // Race lost: the child is still streaming when the settle deadline expires.
    await runtime.settleAll(20);
    const atDeadline = (store.entries.get(res.agentId) ?? []).map((e) => e.type);
    // Pre-fix this was [sidechain_start, user, sidechain_end]: the bracket was
    // closed on a child that had not produced a single turn yet.
    expect(atDeadline).not.toContain('sidechain_end');

    await tick(300);
    const final = (store.entries.get(res.agentId) ?? []).map((e) => e.type);
    // The child's answer is INSIDE the bracket, and the marker is last.
    expect(final).toEqual(['sidechain_start', 'user', 'assistant', 'sidechain_end']);
  });

  it('the deferred marker carries the real is_error of a child that failed after the deadline', async () => {
    const store = new FakeStore();
    const { runtime } = makeRuntime({
      scripts: [],
      transport: new SlowTransport(120, true),
      store,
      persist: true,
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const res = await runtime.makeSpawnFn(0)(baseParams({ subagentType: 'worker' }));
    await runtime.settleAll(20);
    await tick(300);

    const entries = store.entries.get(res.agentId) ?? [];
    const end = entries.find((e) => e.type === 'sidechain_end');
    expect(end).toBeDefined();
    // Pre-fix the marker was written at the deadline, before the run's finally
    // recorded the outcome, so it claimed is_error:false for a failed child.
    expect(end?.is_error).toBe(true);
  });

  it('a child that DID settle inside the window still gets its marker immediately', async () => {
    const store = new FakeStore();
    const { runtime } = makeRuntime({
      scripts: [textReplyEvents('quick answer', { model: 'claude-sonnet-4-5' })],
      store,
      persist: true,
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const res = await runtime.makeSpawnFn(0)(baseParams({ subagentType: 'worker' }));
    await runtime.settleAll(2_000);
    expect((store.entries.get(res.agentId) ?? []).map((e) => e.type)).toEqual([
      'sidechain_start',
      'user',
      'assistant',
      'sidechain_end',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. A SendMessage continuation must honor mid-session permission updates
// ---------------------------------------------------------------------------

function dangerTool(ran: string[]): BuiltinTool {
  return {
    name: 'Danger',
    description: 'read-only probe that records each execution',
    inputSchema: { type: 'object', properties: {} },
    // read-only so the DEFAULT mode auto-allows it: the ONLY thing that can
    // block it is a session deny rule.
    readOnly: true,
    async execute() {
      ran.push('ran');
      return { content: 'boom' };
    },
  };
}

const DENY_DANGER = {
  type: 'addRules' as const,
  behavior: 'deny' as const,
  destination: 'session' as const,
  rules: [{ toolName: 'Danger' }],
};

describe('SendMessage continuation inherits mid-session permission updates', () => {
  it('a deny added AFTER the spawn blocks the tool in a continuation episode', async () => {
    const ran: string[] = [];
    const { runtime, parentGate } = makeRuntime({
      scripts: [
        textReplyEvents('first run done', { model: 'claude-sonnet-4-5' }),
        toolUseReplyEvents('Danger', {}, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('second run done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: new Map([['Danger', dangerTool(ran)]]),
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    expect(ran).toHaveLength(0);

    // Host revokes the tool mid-session (canUseTool -> addRules/deny/session).
    parentGate.applyUpdates([DENY_DANGER]);

    const cont = await runtime.sendMessage({
      to: res.agentId,
      message: 'now use Danger',
      signal: new AbortController().signal,
    });
    expect(cont.isError).toBe(false);
    // Pre-fix: 1 — the revived child ran exactly what the host had forbidden.
    expect(ran).toHaveLength(0);
  });

  it('control: the identical deny added BEFORE the spawn already blocked it', async () => {
    const ran: string[] = [];
    const { runtime, parentGate } = makeRuntime({
      scripts: [
        toolUseReplyEvents('Danger', {}, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('run done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: new Map([['Danger', dangerTool(ran)]]),
    });
    parentGate.applyUpdates([DENY_DANGER]);
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    expect(ran).toHaveLength(0);
  });

  it('the replay is idempotent: repeated continuations do not duplicate rules', async () => {
    const ran: string[] = [];
    const { runtime, parentGate } = makeRuntime({
      scripts: [
        textReplyEvents('run 1', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('run 2', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('run 3', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: new Map([['Danger', dangerTool(ran)]]),
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    parentGate.applyUpdates([DENY_DANGER]);
    const sig = new AbortController().signal;
    await runtime.sendMessage({ to: res.agentId, message: 'again', signal: sig });
    await runtime.sendMessage({ to: res.agentId, message: 'and again', signal: sig });
    // The parent still holds exactly one deny rule; a child that had grown a
    // copy per episode would need the diff below to be non-empty.
    expect(
      pendingSessionRules(parentGate.exportSessionRules(), parentGate.exportSessionRules()),
    ).toEqual([]);
  });

  it('pendingSessionRules diffs by (behavior, toolName, ruleContent)', () => {
    const parent = [
      {
        type: 'addRules' as const,
        behavior: 'deny' as const,
        destination: 'session' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }, { toolName: 'Write' }],
      },
    ];
    const child = [
      {
        type: 'addRules' as const,
        behavior: 'deny' as const,
        destination: 'session' as const,
        rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }],
      },
    ];
    expect(pendingSessionRules(parent, child)).toEqual([
      { ...parent[0]!, rules: [{ toolName: 'Write' }] },
    ]);
    // Same toolName under a DIFFERENT behavior is not "already carried".
    expect(
      pendingSessionRules(parent, [{ ...child[0]!, behavior: 'allow' as const }]),
    ).toEqual(parent);
    expect(pendingSessionRules(parent, parent)).toEqual([]);
  });
});
