/**
 * Audit r4 (2026-07-17) — subagents cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y1-1: the child permission gate inherits the parent's cwd (+ MCP server
 *    set + bypass interlock), so a path-scoped deny is not bypassed by a
 *    relative path inside a subagent (RP1/RP2 hardening spans the child).
 *  - Y3-1: a stop landing on an already-terminal child bumps the kill epoch, so
 *    a SendMessage continuation queued BEFORE the stop is dropped, not revived.
 *  - V2-1: a foreground child that aborts/fails still fires SubagentStop (the
 *    rethrow path used to leak the Start/Stop pair).
 *  - V2-2: a SendMessage continuation episode fires its own Start/Stop bracket.
 *  - V2-3: the task-result preview never leaves a lone surrogate at the cut.
 *  - V2-4: killAgent never writes sidechain_end — only settleAll does.
 *  - Sag-3/4/5: agentDef.tools/disallowedTools coerce a bare string / malformed
 *    value and trim entries (no fail-open, no crash, no ' Read' mismatch).
 *  - Sag-6: the Agent tool enforces its advertised model enum.
 *  - Stim-1: the background-promise tracking refactor preserves settle/drain.
 */

import { describe, expect, it } from 'vitest';

import {
  coerceToolPatternList,
  createSubagentRuntime,
  type SubagentRuntimeOptions,
} from '../src/subagents/runtime.js';
import { createAgentTool } from '../src/subagents/agent-tool.js';
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
  ToolContext,
  Transport,
} from '../src/internal/contracts.js';
import type {
  AgentDefinition,
  APIMessageParam,
  CallToolResult,
  McpServerStatus,
  Options,
  RawMessageStreamEvent,
  SDKMessage,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Fakes / builders (subagents.test.ts conventions, trimmed)
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

function recordingTool(
  name: string,
  executed: Array<Record<string, unknown>>,
  opts: { readOnly?: boolean; isFileEdit?: boolean } = {},
): BuiltinTool {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {} },
    readOnly: opts.readOnly ?? false,
    isFileEdit: opts.isFileEdit,
    async execute(input) {
      executed.push(input);
      return { content: `${name} ran` };
    },
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'parent',
    includePartialMessages: false,
    sessionId: 'parent-sess',
    cwd: '/tmp/sub-test',
    ...overrides,
  };
}

type RuntimeHarness = {
  runtime: ReturnType<typeof createSubagentRuntime>;
  transport: MockTransport;
  starts: string[];
  stops: string[];
};

function makeRuntime(cfg: {
  scripts: RawMessageStreamEvent[][];
  agents?: Record<string, AgentDefinition>;
  baseBuiltins?: Map<string, BuiltinTool>;
  engineConfig?: Partial<EngineConfig>;
  options?: Partial<Options>;
  withStartStopHooks?: boolean;
  store?: SessionStore;
  persist?: boolean;
  cwd?: string;
  allowDangerousBypass?: boolean;
  emitObservability?: (msg: SDKMessage) => void;
  transport?: MockTransport | Transport;
}): RuntimeHarness {
  const transport = (cfg.transport ?? new MockTransport(cfg.scripts)) as MockTransport;
  const starts: string[] = [];
  const stops: string[] = [];
  const hooks = new DefaultHookRunner({
    hooks: cfg.withStartStopHooks
      ? {
          SubagentStart: [
            {
              hooks: [
                async (input) => {
                  starts.push(input.agent_id ?? '?');
                },
              ],
            },
          ],
          SubagentStop: [
            {
              hooks: [
                async (input) => {
                  stops.push(input.agent_id ?? '?');
                },
              ],
            },
          ],
        }
      : {},
    debug: () => {},
  });
  const engineConfig = makeConfig(cfg.engineConfig);
  const parentGate = new DefaultPermissionGate({
    mode: cfg.options?.permissionMode,
    allowedTools: cfg.options?.allowedTools,
    disallowedTools: cfg.options?.disallowedTools,
    cwd: cfg.cwd ?? '/tmp/sub-test',
    debug: () => {},
  });
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins: cfg.baseBuiltins ?? new Map<string, BuiltinTool>(),
    mcp: new FakeMcp(),
    transport,
    hooks,
    parentGate,
    allowedTools: cfg.options?.allowedTools,
    disallowedTools: cfg.options?.disallowedTools,
    allowDangerousBypass: cfg.allowDangerousBypass,
    engineConfig,
    store: cfg.store,
    persist: cfg.persist,
    cwd: cfg.cwd ?? '/tmp/sub-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
    emitObservability: cfg.emitObservability,
  };
  return { runtime: createSubagentRuntime(opts), transport, starts, stops };
}

const baseParams = (over: Partial<SpawnSubagentParams> = {}): SpawnSubagentParams => ({
  subagentType: 'general-purpose',
  prompt: 'do the task',
  toolUseId: '',
  signal: new AbortController().signal,
  ...over,
});

function lastUserContent(messages: APIMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m !== undefined && m.role === 'user') {
      return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    }
  }
  return '';
}

async function tick(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1));
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const PREVIEW_CHARS = 500; // mirrors runtime TASK_RESULT_PREVIEW_CHARS (not exported)

// ---------------------------------------------------------------------------
// Y1-1: child gate inherits cwd (path-deny hardening spans the subagent)
// ---------------------------------------------------------------------------

describe('Y1-1: child permission gate inherits the parent cwd', () => {
  it('a relative path can no longer slip past a path-scoped deny inside a subagent', async () => {
    const writeInputs: Array<Record<string, unknown>> = [];
    const base = new Map<string, BuiltinTool>([
      ['Write', recordingTool('Write', writeInputs, { isFileEdit: true })],
    ]);
    // From cwd=/x/y, `../../etc/passwd` collapses to /etc/passwd — which the
    // rule denies ONLY if the gate knows the cwd to resolve against.
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents(
          'Write',
          { file_path: '../../etc/passwd', content: 'x' },
          { model: 'claude-sonnet-4-5' },
        ),
        textReplyEvents('stopped', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
      cwd: '/x/y',
      options: { disallowedTools: ['Write(/etc/**)'] },
    });
    await h.runtime.makeSpawnFn(0)(baseParams());
    expect(writeInputs).toHaveLength(0); // denied at the gate, never executed
    expect(lastUserContent(h.transport.requests[1]?.messages ?? [])).toContain(
      'Permission denied',
    );
  });
});

// ---------------------------------------------------------------------------
// Y3-1: a stop on an already-terminal child invalidates queued continuations
// ---------------------------------------------------------------------------

describe('Y3-1: stopping a terminal child drops a queued SendMessage', () => {
  it('does not revive the child the host just asked to stop', async () => {
    const h = makeRuntime({
      scripts: [
        textReplyEvents('first done', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('SHOULD NOT REVIVE', { model: 'claude-sonnet-4-5' }),
      ],
    });
    const spawned = await h.runtime.makeSpawnFn(0)(baseParams());
    expect(spawned.isError).toBe(false);
    // Queue a continuation, then SYNCHRONOUSLY stop before it dequeues: the
    // stop must bump the epoch so the queued turn is dropped, not run.
    const sendP = h.runtime.sendMessage({
      to: spawned.agentId,
      message: 'pick it up',
      signal: new AbortController().signal,
    });
    h.runtime.stopAgent(spawned.agentId); // not_running kill — bumps epoch (Y3-1)
    const res = await sendP;
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/stopped before/i);
    // The revival script was never consumed — the child stayed stopped.
    expect(h.transport.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// V2-1: a foreground child that aborts still fires SubagentStop
// ---------------------------------------------------------------------------

describe('V2-1: foreground abort/failure fires SubagentStop', () => {
  class AbortingTransport implements Transport {
    apiKeySource(): 'user' {
      return 'user';
    }
    async *stream(): AsyncGenerator<RawMessageStreamEvent, void> {
      yield textReplyEvents('x', { model: 'claude-sonnet-4-5' })[0]!; // message_start
      throw new AbortError();
    }
  }

  it('the rethrow path closes the Start/Stop pair instead of leaking it', async () => {
    const h = makeRuntime({
      scripts: [],
      transport: new AbortingTransport(),
      withStartStopHooks: true,
    });
    let rejected = false;
    await h.runtime
      .makeSpawnFn(0)(baseParams())
      .catch(() => {
        rejected = true;
      });
    // The abort propagated out (the rethrow path V2-1 fixes), and Stop fired.
    expect(rejected).toBe(true);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual(h.starts);
  });
});

// ---------------------------------------------------------------------------
// V2-2: a SendMessage continuation fires its own Start/Stop bracket
// ---------------------------------------------------------------------------

describe('V2-2: a continuation episode is bracketed by Start/Stop', () => {
  it('a background SendMessage continuation fires a second Start/Stop pair', async () => {
    const h = makeRuntime({
      scripts: [
        textReplyEvents('bg done', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('bg reply', { model: 'claude-sonnet-4-5' }),
      ],
      withStartStopHooks: true,
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const spawned = await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'worker', runInBackground: true }),
    );
    await h.runtime.settleAll();
    // First run: exactly one Start/Stop pair.
    expect(h.starts).toEqual([spawned.agentId]);
    expect(h.stops).toEqual([spawned.agentId]);
    h.runtime.drainCompletedResults();

    const ack = await h.runtime.sendMessage({
      to: spawned.agentId,
      message: 'more',
      signal: new AbortController().signal,
    });
    expect(ack.isError).toBe(false);
    await h.runtime.settleAll();
    // The continuation added its OWN Start/Stop bracket (audit r4 V2-2).
    expect(h.starts).toEqual([spawned.agentId, spawned.agentId]);
    expect(h.stops).toEqual([spawned.agentId, spawned.agentId]);
  });
});

// ---------------------------------------------------------------------------
// V2-3: the task-result preview is surrogate-safe at the 500-char cut
// ---------------------------------------------------------------------------

describe('V2-3: task-result preview never splits a surrogate pair', () => {
  it('drops a trailing lone surrogate at the truncation boundary', async () => {
    // 499 'a' + an astral emoji => the 500-char cut lands mid-surrogate.
    const bigText = 'a'.repeat(PREVIEW_CHARS - 1) + '😀';
    const emitted: SDKMessage[] = [];
    const h = makeRuntime({
      scripts: [textReplyEvents(bigText, { model: 'claude-sonnet-4-5' })],
      emitObservability: (m) => emitted.push(m),
    });
    await h.runtime.makeSpawnFn(0)(baseParams());
    const finished = emitted.find(
      (m) =>
        (m as { subtype?: string }).subtype === 'task_updated' &&
        (m as { patch?: { status?: string } }).patch?.status === 'completed',
    ) as { result?: string } | undefined;
    const preview = finished?.result;
    expect(preview).toBeDefined();
    expect(preview!.endsWith('...')).toBe(true);
    expect(LONE_SURROGATE.test(preview!)).toBe(false);
    expect(preview).toBe('a'.repeat(PREVIEW_CHARS - 1) + '...');
  });
});

// ---------------------------------------------------------------------------
// V2-4: killAgent never finalizes the sidechain — settleAll does
// ---------------------------------------------------------------------------

describe('V2-4: sidechain_end is written only by settleAll', () => {
  it('a stop leaves the end marker unwritten until teardown', async () => {
    const store = new FakeStore();
    const h = makeRuntime({
      scripts: [textReplyEvents('done', { model: 'claude-sonnet-4-5' })],
      store,
      persist: true,
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    const entriesOf = (t: string): unknown[] =>
      (store.entries.get(res.agentId) ?? []).filter((e) => e['type'] === t);
    // Run finished: the start marker exists; the end is deferred to teardown.
    expect(entriesOf('sidechain_start')).toHaveLength(1);
    expect(entriesOf('sidechain_end')).toHaveLength(0);
    // A stop on the now-completed child must NOT write the end (K6/V2-4).
    h.runtime.stopAgent(res.agentId);
    expect(entriesOf('sidechain_end')).toHaveLength(0);
    // settleAll is the only writer of the single end.
    await h.runtime.settleAll();
    expect(entriesOf('sidechain_end')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Sag-3/4/5: coerceToolPatternList normalizes tools/disallowedTools
// ---------------------------------------------------------------------------

describe('Sag-3/4/5: coerceToolPatternList', () => {
  it('Sag-3: a bare string is a single-entry list (not "no list" / fail-open)', () => {
    expect(coerceToolPatternList('Read')).toEqual(['Read']);
    expect(coerceToolPatternList(['Read', 'Grep'])).toEqual(['Read', 'Grep']);
  });

  it('Sag-4: a malformed non-array/non-string degrades to [] (no throw)', () => {
    expect(coerceToolPatternList(undefined)).toEqual([]);
    expect(coerceToolPatternList(null)).toEqual([]);
    expect(coerceToolPatternList(42)).toEqual([]);
    expect(coerceToolPatternList({})).toEqual([]);
  });

  it('Sag-5: entries are trimmed so " Read" matches like "Read"; non-strings drop', () => {
    expect(coerceToolPatternList([' Read', 'Grep '])).toEqual(['Read', 'Grep']);
    expect(coerceToolPatternList(['Read', 1, null])).toEqual(['Read']);
  });

  it('Sag-3: agentDef.tools as a bare string RESTRICTS the child (fail-closed)', async () => {
    const readInputs: Array<Record<string, unknown>> = [];
    const writeInputs: Array<Record<string, unknown>> = [];
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', readInputs, { readOnly: true })],
      ['Write', recordingTool('Write', writeInputs, { isFileEdit: true })],
    ]);
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents(
          'Write',
          { file_path: '/a', content: 'x' },
          { model: 'claude-sonnet-4-5' },
        ),
        textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
      agents: {
        reader: {
          description: 'r',
          prompt: 'read only',
          tools: 'Read' as unknown as string[], // untyped-config string
        },
      },
    });
    await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'reader' }));
    // Write was stripped from the child's tool set (allowlist = ['Read']).
    expect(writeInputs).toHaveLength(0);
    expect(lastUserContent(h.transport.requests[1]?.messages ?? [])).toContain(
      'No such tool: Write',
    );
  });

  it('Sag-4: agentDef.disallowedTools as a bare string does not crash the spawn', async () => {
    const base = new Map<string, BuiltinTool>([
      ['Bash', recordingTool('Bash', [])],
      ['Read', recordingTool('Read', [], { readOnly: true })],
    ]);
    const h = makeRuntime({
      scripts: [textReplyEvents('done', { model: 'claude-sonnet-4-5' })],
      baseBuiltins: base,
      agents: {
        r: {
          description: 'r',
          prompt: 'p',
          disallowedTools: 'Bash' as unknown as string[], // would throw on .filter
        },
      },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'r' }));
    expect(res.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sag-6: the Agent tool enforces its advertised model enum
// ---------------------------------------------------------------------------

describe('Sag-6: Agent tool model enum is enforced', () => {
  const tool = createAgentTool(['general-purpose']);
  function ctxWith(spawn: ToolContext['spawnSubagent']): ToolContext {
    return {
      cwd: '/tmp',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
      spawnSubagent: spawn,
    };
  }

  it('accepts an enum value but rejects an off-enum model string', async () => {
    const calls: SpawnSubagentParams[] = [];
    const ctx = ctxWith(async (p) => {
      calls.push(p);
      return { content: 'ok', isError: false, agentId: 'a', background: false };
    });
    const ok = await tool.execute({ description: 'x', prompt: 'p', model: 'opus' }, ctx);
    expect(ok.isError).toBeFalsy();
    const bad = await tool.execute(
      { description: 'x', prompt: 'p', model: 'gpt-4o' },
      ctx,
    );
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/must be one of/);
    // Only the valid override reached spawn.
    expect(calls).toHaveLength(1);
  });

  it('still advertises the enum in its schema (official parity preserved)', () => {
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props['model']?.enum).toEqual(['sonnet', 'opus', 'haiku', 'fable']);
  });
});

// ---------------------------------------------------------------------------
// Stim-1: the background-promise tracking refactor preserves settle/drain
// ---------------------------------------------------------------------------

describe('Stim-1: self-pruning background tracking still delivers everything', () => {
  it('many background children + a continuation all deliver their notes', async () => {
    const h = makeRuntime({
      scripts: [
        textReplyEvents('w1 done', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('w2 done', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('w3 done', { model: 'claude-sonnet-4-5' }),
        textReplyEvents('w1 reply', { model: 'claude-sonnet-4-5' }),
      ],
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const spawn = h.runtime.makeSpawnFn(0);
    const a = await spawn(
      baseParams({ subagentType: 'worker', runInBackground: true, prompt: 'A' }),
    );
    await spawn(baseParams({ subagentType: 'worker', runInBackground: true, prompt: 'B' }));
    await spawn(baseParams({ subagentType: 'worker', runInBackground: true, prompt: 'C' }));
    await h.runtime.settleAll();
    expect(h.runtime.drainCompletedResults()).toHaveLength(3);
    // A continuation tracks (and prunes) its own delivery promise too.
    const ack = await h.runtime.sendMessage({
      to: a.agentId,
      message: 'more',
      signal: new AbortController().signal,
    });
    expect(ack.isError).toBe(false);
    await h.runtime.settleAll();
    const notes = h.runtime.drainCompletedResults();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toContain('w1 reply');
    await tick(1);
  });
});
