/**
 * Subagent subsystem tests: pure helpers (agents.ts), the Agent built-in tool
 * (agent-tool.ts) and the recursive runtime (runtime.ts). Transport is the
 * scripted MockTransport; the hook runner is the real DefaultHookRunner and the
 * permission gate is the real DefaultPermissionGate, so wiring is exercised
 * end-to-end without a network.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GENERAL_PURPOSE_PROMPT,
  GENERAL_PURPOSE_PROMPT_PROVENANCE,
  MAX_SUBAGENT_DEPTH,
  WORKER_FORK_AGENT,
  WORKER_FORK_FRAMING,
  WORKER_FORK_PROVENANCE,
  buildWorkerForkPrompt,
  resolveAgentDefinition,
  resolveModelAlias,
} from '../src/subagents/agents.js';
import { createAgentTool } from '../src/subagents/agent-tool.js';
import {
  buildForkSeed,
  createSubagentRuntime,
  type SubagentRuntimeOptions,
} from '../src/subagents/runtime.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  BuiltinTool,
  EngineConfig,
  McpRegistry,
  SessionStore,
  SpawnSubagentParams,
  StoredSession,
  ToolContext,
} from '../src/internal/contracts.js';
import type {
  AgentDefinition,
  APIMessageParam,
  CallToolResult,
  HookInput,
  McpServerStatus,
  Options,
  RawMessageStreamEvent,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Fakes / builders
// ---------------------------------------------------------------------------

/** Empty MCP registry. */
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

/** In-memory SessionStore that records every append under its session key. */
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

/** Records every input it executes; returns a fixed payload. */
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
  stopInputs: HookInput[];
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
  /** Runtime cwd (worktree-isolation tests point this at a real git repo). */
  cwd?: string;
}): RuntimeHarness {
  const transport = new MockTransport(cfg.scripts);
  const starts: string[] = [];
  const stops: string[] = [];
  const stopInputs: HookInput[] = [];
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
                  stopInputs.push(input);
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
    debug: () => {},
  });
  const baseBuiltins =
    cfg.baseBuiltins ?? new Map<string, BuiltinTool>();
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins,
    mcp: new FakeMcp(),
    transport,
    hooks,
    parentGate,
    allowedTools: cfg.options?.allowedTools,
    disallowedTools: cfg.options?.disallowedTools,
    engineConfig,
    store: cfg.store,
    persist: cfg.persist,
    cwd: cfg.cwd ?? '/tmp/sub-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
  };
  return { runtime: createSubagentRuntime(opts), transport, starts, stops, stopInputs };
}

const baseParams = (over: Partial<SpawnSubagentParams> = {}): SpawnSubagentParams => ({
  subagentType: 'general-purpose',
  prompt: 'do the task',
  toolUseId: '',
  signal: new AbortController().signal,
  ...over,
});

/** Last user turn's serialized content from a captured request. */
function lastUserContent(messages: APIMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m !== undefined && m.role === 'user') {
      return typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
    }
  }
  return '';
}

async function tick(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1));
}

// ---------------------------------------------------------------------------
// agents.ts
// ---------------------------------------------------------------------------

describe('resolveModelAlias', () => {
  it('maps short aliases and passes full ids / inherit through', () => {
    expect(resolveModelAlias('opus', 'parent')).toBe('claude-opus-4-8');
    expect(resolveModelAlias('sonnet', 'parent')).toBe('claude-sonnet-4-5');
    expect(resolveModelAlias('haiku', 'parent')).toBe('claude-haiku-4-5');
    expect(resolveModelAlias('fable', 'parent')).toBe('claude-fable-5');
    expect(resolveModelAlias('inherit', 'parent-model')).toBe('parent-model');
    expect(resolveModelAlias(undefined, 'parent-model')).toBe('parent-model');
    expect(resolveModelAlias('claude-custom-9', 'parent')).toBe('claude-custom-9');
  });
});

describe('resolveAgentDefinition', () => {
  it('returns a defined agent as-is', () => {
    const agents: Record<string, AgentDefinition> = {
      researcher: { description: 'r', prompt: 'you research' },
    };
    const r = resolveAgentDefinition('researcher', agents, () => {});
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.synthetic).toBe(false);
      expect(r.definition.prompt).toBe('you research');
    }
  });

  it('falls back to synthetic general-purpose for the reserved type', () => {
    const r = resolveAgentDefinition('general-purpose', {}, () => {});
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.synthetic).toBe(true);
      expect(r.definition.prompt).toBe(GENERAL_PURPOSE_PROMPT);
    }
  });

  it('warns and falls back for an unknown type', () => {
    const warnings: string[] = [];
    const r = resolveAgentDefinition('nope', {}, (m) => warnings.push(m));
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.synthetic).toBe(true);
    expect(warnings.some((w) => w.includes('nope'))).toBe(true);
  });

  it('errors on a defined agent with an empty prompt', () => {
    const agents: Record<string, AgentDefinition> = {
      broken: { description: 'b', prompt: '' },
    };
    const r = resolveAgentDefinition('broken', agents, () => {});
    expect('error' in r).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// agent-tool.ts
// ---------------------------------------------------------------------------

describe('createAgentTool', () => {
  const tool = createAgentTool(['researcher', 'general-purpose']);

  function ctxWith(
    spawn: ToolContext['spawnSubagent'],
  ): ToolContext {
    return {
      cwd: '/tmp',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
      spawnSubagent: spawn,
    };
  }

  it('has the documented input schema (E7-02: official params + required set)', () => {
    expect(tool.name).toBe('Agent');
    expect(tool.readOnly).toBe(false);
    expect(tool.isFileEdit).toBe(false);
    // Official required set: subagent_type is optional (defaults to
    // general-purpose in execute()).
    expect(tool.inputSchema.required).toEqual(['description', 'prompt']);
    const props = tool.inputSchema.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'description',
      'fork',
      'isolation',
      'model',
      'prompt',
      'run_in_background',
      'subagent_type',
    ]);
    // Enumerates the agent names in the subagent_type description.
    expect(
      (props['subagent_type'] as { description: string }).description,
    ).toContain('researcher');
    // isolation / model mirror the official enums.
    expect((props['isolation'] as { enum: string[] }).enum).toEqual(['worktree']);
    expect((props['model'] as { enum: string[] }).enum).toEqual([
      'sonnet',
      'opus',
      'haiku',
      'fable',
    ]);
  });

  it('errors when no runtime is wired', async () => {
    const r = await tool.execute(
      { description: 'x', prompt: 'p', subagent_type: 'general-purpose' },
      ctxWith(undefined),
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain('runtime not available');
  });

  it('errors on a missing prompt; a missing subagent_type defaults to general-purpose (E7-02)', async () => {
    let captured: SpawnSubagentParams | undefined;
    const ctx = ctxWith(async (params) => {
      captured = params;
      return { content: 'ok', isError: false, agentId: 'a', background: false };
    });
    const noPrompt = await tool.execute(
      { description: 'x', subagent_type: 'general-purpose' },
      ctx,
    );
    expect(noPrompt.isError).toBe(true);
    // subagent_type omitted -> spawn still happens, with the default type.
    const noType = await tool.execute({ description: 'x', prompt: 'p' }, ctx);
    expect(noType.isError).toBe(false);
    expect(captured?.subagentType).toBe('general-purpose');
    // ...but an explicitly EMPTY subagent_type is still an input error.
    const emptyType = await tool.execute(
      { description: 'x', prompt: 'p', subagent_type: '' },
      ctx,
    );
    expect(emptyType.isError).toBe(true);
  });

  it('validates and forwards model + isolation (E7-02)', async () => {
    let captured: SpawnSubagentParams | undefined;
    const ctx = ctxWith(async (params) => {
      captured = params;
      return { content: 'ok', isError: false, agentId: 'a', background: false };
    });
    // Invalid isolation value / empty model are input errors (spawn untouched).
    const badIso = await tool.execute(
      { description: 'x', prompt: 'p', isolation: 'container' },
      ctx,
    );
    expect(badIso.isError).toBe(true);
    expect(badIso.content).toContain('"isolation"');
    const badModel = await tool.execute(
      { description: 'x', prompt: 'p', model: '' },
      ctx,
    );
    expect(badModel.isError).toBe(true);
    expect(badModel.content).toContain('"model"');
    expect(captured).toBeUndefined();
    // Valid values pass through to spawn verbatim.
    const ok = await tool.execute(
      { description: 'x', prompt: 'p', model: 'opus', isolation: 'worktree' },
      ctx,
    );
    expect(ok.isError).toBe(false);
    expect(captured?.model).toBe('opus');
    expect(captured?.isolation).toBe('worktree');
  });

  it('maps a SpawnSubagentResult onto the tool payload', async () => {
    let captured: SpawnSubagentParams | undefined;
    const ctx = ctxWith(async (params) => {
      captured = params;
      return {
        content: 'final answer',
        isError: false,
        agentId: 'agent-1',
        background: false,
      };
    });
    const r = await tool.execute(
      {
        description: 'task label',
        prompt: 'go',
        subagent_type: 'researcher',
        run_in_background: true,
      },
      ctx,
    );
    expect(r.content).toBe('final answer');
    expect(r.isError).toBe(false);
    expect(captured?.subagentType).toBe('researcher');
    expect(captured?.prompt).toBe('go');
    expect(captured?.description).toBe('task label');
    expect(captured?.runInBackground).toBe(true);
  });

  it('forwards fork + an eager parentHistory snapshot to spawn', async () => {
    const parentCtx: APIMessageParam[] = [
      { role: 'user', content: 'parent q' },
      { role: 'assistant', content: 'parent a' },
    ];
    let captured: SpawnSubagentParams | undefined;
    const spawn: ToolContext['spawnSubagent'] = async (params) => {
      captured = params;
      return { content: 'ok', isError: false, agentId: 'a', background: false };
    };
    const ctx: ToolContext = {
      cwd: '/tmp',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
      spawnSubagent: spawn,
      getForkHistory: () => parentCtx.slice(),
    };

    await tool.execute(
      {
        description: 'x',
        prompt: 'go',
        subagent_type: 'general-purpose',
        fork: true,
      },
      ctx,
    );
    expect(captured?.fork).toBe(true);
    expect(captured?.parentHistory).toEqual(parentCtx);

    // Without fork the flag is falsy (isolated), though the snapshot is still
    // taken (the runtime, not the tool, decides whether to use it).
    captured = undefined;
    await tool.execute(
      { description: 'x', prompt: 'go', subagent_type: 'general-purpose' },
      ctx,
    );
    expect(captured?.fork).toBeFalsy();
  });
});

describe('buildForkSeed', () => {
  const noConsecutiveUsers = (seed: APIMessageParam[]) => {
    for (let i = 1; i < seed.length; i++) {
      expect(seed[i - 1]?.role === 'user' && seed[i]?.role === 'user', `consecutive users at ${i}`).toBe(false);
    }
  };

  it('INHERITS the parent context — keeps completed tool_use/tool_result pairs (regression: G4 blocker)', () => {
    // The realistic snapshot at Agent-tool spawn: a tool-call sequence ending on
    // a tool_result user turn, with NO pure-text assistant turn at the tail.
    // The old cascade collapsed this to [{user,prompt}]; it must NOT.
    const parent: APIMessageParam[] = [
      { role: 'user', content: 'do a big task' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Grep', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'r2' }] },
    ];
    const seed = buildForkSeed(parent, 'the task');
    // Every completed pair survives; the child truly inherits the parent context.
    expect(seed).toHaveLength(5);
    expect(seed[0]).toEqual({ role: 'user', content: 'do a big task' });
    expect(seed[1]).toEqual(parent[1]);
    expect(seed[3]).toEqual(parent[3]);
    // The task is MERGED into the trailing tool_result user turn (not a dropped
    // turn, not a second consecutive user turn).
    const tail = seed[4]!;
    expect(tail.role).toBe('user');
    expect(tail.content).toEqual([
      { type: 'tool_result', tool_use_id: 't2', content: 'r2' },
      { type: 'text', text: 'the task' },
    ]);
    noConsecutiveUsers(seed);
  });

  it('appends a new user turn when the seed ends on an assistant text turn', () => {
    const parent: APIMessageParam[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    const seed = buildForkSeed(parent, 'the task');
    expect(seed).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'the task' },
    ]);
    noConsecutiveUsers(seed);
  });

  it('drops ONLY a genuinely dangling trailing assistant tool_use', () => {
    const parent: APIMessageParam[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
    ];
    const seed = buildForkSeed(parent, 'the task');
    // the dangling call is dropped, the task merges into the now-trailing user q1
    expect(seed).toEqual([{ role: 'user', content: 'q1\n\nthe task' }]);
  });

  it('merges the task into a trailing string user turn (preserves it, no cascade)', () => {
    expect(buildForkSeed([{ role: 'user', content: 'ctx' }], 'only')).toEqual([
      { role: 'user', content: 'ctx\n\nonly' },
    ]);
  });

  it('degrades an empty parent history to just the prompt (isolated shape)', () => {
    expect(buildForkSeed([], 'only')).toEqual([{ role: 'user', content: 'only' }]);
  });
});

// ---------------------------------------------------------------------------
// runtime.ts
// ---------------------------------------------------------------------------

describe('subagent runtime — foreground', () => {
  it('runs a child loop, returns its final text + agentId, fires hooks, folds usage', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('child answer', { model: 'claude-sonnet-4-5' })],
      withStartStopHooks: true,
    });
    const spawn = h.runtime.makeSpawnFn(0);
    const res = await spawn(baseParams({ prompt: 'summarize X' }));

    expect(res.isError).toBe(false);
    expect(res.background).toBe(false);
    expect(res.content).toContain('child answer');
    expect(res.content).toContain(`agentId: ${res.agentId}`);
    // The child ran through runAgentLoop (its own system prompt was sent).
    expect(h.transport.requests[0]?.system).toBe(GENERAL_PURPOSE_PROMPT);
    expect(lastUserContent(h.transport.requests[0]?.messages ?? [])).toContain(
      'summarize X',
    );

    // Hooks fired exactly once each, keyed on the returned agentId.
    expect(h.starts).toEqual([res.agentId]);
    expect(h.stops).toEqual([res.agentId]);

    // Child usage folded into the ledger, then reset on drain.
    const ledger = h.runtime.drainUsageLedger();
    expect(ledger.usage.input_tokens).toBeGreaterThan(0);
    expect(ledger.cost).toBeGreaterThan(0);
    const second = h.runtime.drainUsageLedger();
    expect(second.usage.input_tokens).toBe(0);
    expect(second.cost).toBe(0);
  });

  it('restricts the child tool set via agentDef.tools (Bash absent)', async () => {
    const bashInputs: Array<Record<string, unknown>> = [];
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', [], { readOnly: true })],
      ['Bash', recordingTool('Bash', bashInputs)],
    ]);
    const h = makeRuntime({
      // Child: turn 1 tries Bash (structurally absent), turn 2 ends.
      scripts: [
        toolUseReplyEvents('Bash', { command: 'ls' }, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
      agents: {
        reader: { description: 'r', prompt: 'read only', tools: ['Read'] },
      },
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'reader' }),
    );
    expect(res.content).toContain('done');
    // Bash was never executed; the child got a "No such tool" tool_result.
    expect(bashInputs).toHaveLength(0);
    expect(lastUserContent(h.transport.requests[1]?.messages ?? [])).toContain(
      'No such tool: Bash',
    );
  });

  it('applies the model alias to the child request', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('ok', { model: 'claude-opus-4-8' })],
      agents: {
        big: { description: 'b', prompt: 'use opus', model: 'opus' },
      },
    });
    await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'big' }));
    expect(h.transport.requests[0]?.model).toBe('claude-opus-4-8');
  });

  it('per-call model override beats agentDef.model for an isolated child (E7-02)', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('ok', { model: 'claude-opus-4-8' })],
      agents: {
        small: { description: 's', prompt: 'haiku by default', model: 'haiku' },
      },
    });
    await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'small', model: 'opus' }),
    );
    expect(h.transport.requests[0]?.model).toBe('claude-opus-4-8');
  });

  it('fork ignores the per-call model override (parent model inherited, E7-02)', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('ok', { model: 'claude-sonnet-4-5' })],
    });
    await h.runtime.makeSpawnFn(0)(
      baseParams({
        fork: true,
        parentHistory: [
          { role: 'user', content: 'ctx q' },
          { role: 'assistant', content: 'ctx a' },
        ],
        model: 'opus',
      }),
    );
    // The parent engine model, NOT the override (cached-prefix byte-match).
    expect(h.transport.requests[0]?.model).toBe('claude-sonnet-4-5');
  });

  it('honors an agentDef.permissionMode override (plan denies a Write)', async () => {
    const writeInputs: Array<Record<string, unknown>> = [];
    const base = new Map<string, BuiltinTool>([
      ['Write', recordingTool('Write', writeInputs, { isFileEdit: true })],
    ]);
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents('Write', { file_path: '/a', content: 'x' }, {
          model: 'claude-sonnet-4-5',
        }),
        textReplyEvents('stopped', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
      agents: {
        planner: {
          description: 'p',
          prompt: 'plan only',
          permissionMode: 'plan',
        },
      },
    });
    await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'planner' }));
    // Write was denied (plan mode) and never executed.
    expect(writeInputs).toHaveLength(0);
    expect(lastUserContent(h.transport.requests[1]?.messages ?? [])).toContain(
      'Permission denied',
    );
  });
});

describe('subagent runtime — worktree isolation (E7-02)', () => {
  /** Temp dirs created by the current test; removed in afterEach. */
  let tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
    tempDirs = [];
  });

  /** A real throwaway git repo with one committed file. */
  function makeGitRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'bpt-wt-repo-'));
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

  /** Records ctx.cwd on every call; optionally dirties the worktree. */
  function cwdProbe(seen: string[], mutate = false): BuiltinTool {
    return {
      name: 'Probe',
      description: 'records ctx.cwd',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      async execute(_input, ctx) {
        seen.push(ctx.cwd);
        if (mutate) writeFileSync(join(ctx.cwd, 'child-output.txt'), 'dirty\n');
        return { content: 'probed' };
      },
    };
  }

  function isolationScripts() {
    return [
      toolUseReplyEvents('Probe', {}, { model: 'claude-sonnet-4-5' }),
      textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
    ];
  }

  it('runs the child in a temp worktree and removes it when left unchanged', async () => {
    const repo = makeGitRepo();
    const seen: string[] = [];
    const h = makeRuntime({
      scripts: isolationScripts(),
      baseBuiltins: new Map([['Probe', cwdProbe(seen)]]),
      cwd: repo,
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ isolation: 'worktree' }),
    );
    expect(res.isError).toBe(false);
    // The child ran with a DIFFERENT cwd that was a real checkout of the repo.
    expect(seen).toHaveLength(1);
    const childCwd = seen[0]!;
    expect(childCwd).not.toBe(repo);
    // Unchanged after the run -> the worktree was removed.
    expect(existsSync(childCwd)).toBe(false);
  });

  it('keeps the worktree when the child left uncommitted changes', async () => {
    const repo = makeGitRepo();
    const seen: string[] = [];
    const h = makeRuntime({
      scripts: isolationScripts(),
      baseBuiltins: new Map([['Probe', cwdProbe(seen, true)]]),
      cwd: repo,
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ isolation: 'worktree' }),
    );
    expect(res.isError).toBe(false);
    const childCwd = seen[0]!;
    tempDirs.push(childCwd);
    // Dirty (untracked child-output.txt) -> the worktree is preserved.
    expect(existsSync(childCwd)).toBe(true);
    expect(readFileSync(join(childCwd, 'child-output.txt'), 'utf8')).toBe('dirty\n');
    // The checkout really contained the committed repo file.
    expect(existsSync(join(childCwd, 'seed.txt'))).toBe(true);
  });

  it('fails honestly when the runtime cwd is not a git repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'bpt-wt-plain-'));
    tempDirs.push(plain);
    const h = makeRuntime({ scripts: [], cwd: plain });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ isolation: 'worktree' }),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('worktree');
    // No child loop ever started (no transport calls).
    expect(h.transport.requests).toHaveLength(0);
  });
});

describe('subagent runtime — inherited turn/budget caps (finding #3)', () => {
  it('propagates the parent maxBudgetUsd so a delegated child cannot overspend', async () => {
    const readInputs: Array<Record<string, unknown>> = [];
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', readInputs, { readOnly: true })],
    ]);
    const h = makeRuntime({
      // Child turn 1 calls Read (billable); if the budget cap were NOT inherited
      // it would continue to turn 2 and finish successfully with "done".
      scripts: [
        toolUseReplyEvents('Read', { file_path: '/a' }, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
      // A tiny parent budget: the first turn's cost already exceeds it.
      engineConfig: { maxBudgetUsd: 1e-9 },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    // Budget gate fired after turn 1 -> child terminated early, turn 2 never ran.
    expect(res.isError).toBe(true);
    expect(res.content).toContain('maxBudgetUsd');
    expect(h.transport.requests).toHaveLength(1);
  });

  it('caps an unspecified agent at the default maxTurns so a looping child cannot hang the parent', async () => {
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', [], { readOnly: true })],
    ]);
    // Child loops: every turn calls Read again. Provide exactly the default cap
    // (20) worth of tool_use turns. With the inherited default the loop stops at
    // turn 20 with error_max_turns; without it, the loop would demand a 21st
    // stream() call and MockTransport would throw.
    const scripts = Array.from({ length: 20 }, () =>
      toolUseReplyEvents('Read', { file_path: '/loop' }, { model: 'claude-sonnet-4-5' }),
    );
    const h = makeRuntime({
      scripts,
      baseBuiltins: base,
      // Neither agentDef.maxTurns nor parent maxTurns set -> default applies.
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('maxTurns');
    // Exactly the default number of stream() calls were made (no 21st).
    expect(h.transport.requests).toHaveLength(20);
  });

  it('lets an explicit agentDef.maxTurns override the inherited default', async () => {
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', [], { readOnly: true })],
    ]);
    const scripts = Array.from({ length: 2 }, () =>
      toolUseReplyEvents('Read', { file_path: '/loop' }, { model: 'claude-sonnet-4-5' }),
    );
    const h = makeRuntime({
      scripts,
      baseBuiltins: base,
      agents: {
        tight: { description: 't', prompt: 'loop', maxTurns: 2 },
      },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'tight' }));
    expect(res.isError).toBe(true);
    expect(res.content).toContain('maxTurns');
    expect(h.transport.requests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// FORK mode (G4)
// ---------------------------------------------------------------------------

/** A minimal two-turn parent context (clean assistant-text boundary). */
const parentCtx = (): APIMessageParam[] => [
  { role: 'user', content: 'ctx q' },
  { role: 'assistant', content: 'ctx a' },
];

describe('subagent runtime — FORK mode', () => {
  it('fork seeds the child with the parent history + inherits system/model', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('forked answer', { model: 'claude-sonnet-4-5' })],
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ fork: true, parentHistory: parentCtx(), prompt: 'do the task' }),
    );
    expect(res.isError).toBe(false);

    const req = h.transport.requests[0];
    // NOTE: req.messages is the live loop array (mutated post-request as the
    // child appends its own reply), so assert on the SEEDED prefix + content,
    // not the exact post-run length.
    const msgs = req?.messages ?? [];
    expect(msgs[0]?.role).toBe('user'); // inherited parent context at the head
    expect(msgs[1]?.role).toBe('assistant');
    expect(msgs[2]?.role).toBe('user'); // delegated task appended as a user turn
    const serialized = JSON.stringify(msgs);
    expect(serialized).toContain('ctx q');
    expect(serialized).toContain('ctx a');
    expect(serialized).toContain('do the task');
    // Prefix inheritance for cache sharing: parent system + parent model, NOT
    // the general-purpose subagent prompt.
    expect(req?.system).toBe('parent');
    expect(req?.model).toBe('claude-sonnet-4-5');
  });

  it('fork inherits a REALISTIC tool-call-sequence parent (keeps pairs; regression: G4 blocker)', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('forked answer', { model: 'claude-sonnet-4-5' })],
    });
    // The parent snapshot at a real Agent-tool spawn ends on a tool_result user
    // turn with no pure-text assistant turn at the tail — the case the old
    // buildForkSeed collapsed to the isolated shape.
    const realistic: APIMessageParam[] = [
      { role: 'user', content: 'do a big task' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Grep', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'r2' }] },
    ];
    await h.runtime.makeSpawnFn(0)(
      baseParams({ fork: true, parentHistory: realistic, prompt: 'the delegated task' }),
    );
    const req = h.transport.requests[0];
    const seeded = (req?.messages ?? []).slice(0, 5); // the 5 seeded turns before the child's own reply
    const serialized = JSON.stringify(seeded);
    // The whole inherited chain is present — NOT collapsed to [{user,task}].
    expect(seeded.length).toBeGreaterThanOrEqual(5);
    expect(serialized).toContain('do a big task');
    expect(serialized).toContain('r1');
    expect(serialized).toContain('r2');
    expect(serialized).toContain('the delegated task');
    expect(req?.system).toBe('parent');
  });

  it('isolated (default) does NOT seed and keeps its own system prompt', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('iso answer', { model: 'claude-sonnet-4-5' })],
    });
    // fork omitted -> isolated, even though a parentHistory snapshot is present.
    await h.runtime.makeSpawnFn(0)(baseParams({ parentHistory: parentCtx() }));
    const req = h.transport.requests[0];
    const msgs = req?.messages ?? [];
    // The first turn is the delegated prompt, not the inherited parent context.
    expect(msgs[0]?.role).toBe('user');
    const serialized = JSON.stringify(msgs);
    expect(serialized).not.toContain('ctx a');
    expect(serialized).not.toContain('ctx q');
    expect(req?.system).toBe(GENERAL_PURPOSE_PROMPT);
  });

  it('AgentDefinition.fork enables fork with no input flag', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('forked', { model: 'claude-sonnet-4-5' })],
      agents: {
        forker: { description: 'f', prompt: 'forker own system', fork: true },
      },
    });
    // No params.fork -> the agentDef.fork path must still seed the child.
    await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'forker', parentHistory: parentCtx(), prompt: 'go' }),
    );
    const req = h.transport.requests[0];
    // The inherited parent context is present in the seed (fork was active).
    expect(JSON.stringify(req?.messages)).toContain('ctx a');
    // Fork ignores agentDef.prompt-as-system in favour of the parent system.
    expect(req?.system).toBe('parent');
  });

  it('records a fork sidechain under the agentId only (parent transcript clean)', async () => {
    const store = new FakeStore();
    const h = makeRuntime({
      scripts: [textReplyEvents('forked answer', { model: 'claude-sonnet-4-5' })],
      store,
      persist: true,
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ fork: true, parentHistory: parentCtx(), prompt: 'do it' }),
    );
    const entries = store.entries.get(res.agentId) ?? [];
    const start = entries.find((e) => e['type'] === 'sidechain_start');
    expect(start).toBeDefined();
    expect(start?.['fork']).toBe(true);
    expect(start?.['parent_session_id']).toBe('parent-sess');
    // The seed's delegated-task user turn is recorded (self-contained sidechain).
    expect(
      entries.some((e) => e['type'] === 'user' && e['isSidechain'] === true),
    ).toBe(true);
    // At least one child assistant turn is tagged as a sidechain turn.
    expect(
      entries.some((e) => e['type'] === 'assistant' && e['isSidechain'] === true),
    ).toBe(true);
    const end = entries.find((e) => e['type'] === 'sidechain_end');
    expect(end).toBeDefined();
    expect(end?.['is_error']).toBe(false);
    // The parent session transcript received ZERO entries.
    expect(store.entries.get('parent-sess')).toBeUndefined();
  });

  it('records a sidechain for an isolated child too (fork:false marker)', async () => {
    const store = new FakeStore();
    const h = makeRuntime({
      scripts: [textReplyEvents('iso answer', { model: 'claude-sonnet-4-5' })],
      store,
      persist: true,
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    const entries = store.entries.get(res.agentId) ?? [];
    const start = entries.find((e) => e['type'] === 'sidechain_start');
    expect(start).toBeDefined();
    expect(start?.['fork']).toBe(false);
    expect(store.entries.get('parent-sess')).toBeUndefined();
  });

  it('P2: SubagentStop carries agent_transcript_path for a path-backed persisted store', async () => {
    class PathStore extends FakeStore {
      filePath(id: string): string {
        return `/fake/sessions/${id}.jsonl`;
      }
    }
    const store = new PathStore();
    const h = makeRuntime({
      scripts: [textReplyEvents('child answer', { model: 'claude-sonnet-4-5' })],
      store,
      persist: true,
      withStartStopHooks: true,
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    const stop = h.stopInputs.find(
      (i) => (i as { agent_id?: string }).agent_id === res.agentId,
    );
    expect(stop).toBeDefined();
    expect((stop as { agent_transcript_path?: string }).agent_transcript_path).toBe(
      `/fake/sessions/${res.agentId}.jsonl`,
    );
  });

  it('P2: SubagentStop omits agent_transcript_path when the store is not path-backed', async () => {
    const store = new FakeStore();
    const h = makeRuntime({
      scripts: [textReplyEvents('child answer', { model: 'claude-sonnet-4-5' })],
      store,
      persist: true,
      withStartStopHooks: true,
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams());
    const stop = h.stopInputs.find(
      (i) => (i as { agent_id?: string }).agent_id === res.agentId,
    );
    expect(stop).toBeDefined();
    expect(
      (stop as { agent_transcript_path?: string }).agent_transcript_path,
    ).toBeUndefined();
  });

  it('still enforces the turn cap under fork', async () => {
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', [], { readOnly: true })],
    ]);
    const scripts = Array.from({ length: 2 }, () =>
      toolUseReplyEvents('Read', { file_path: '/loop' }, { model: 'claude-sonnet-4-5' }),
    );
    const h = makeRuntime({
      scripts,
      baseBuiltins: base,
      agents: {
        loopfork: { description: 'lf', prompt: 'loop', fork: true, maxTurns: 2 },
      },
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'loopfork', parentHistory: parentCtx() }),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('maxTurns');
    expect(h.transport.requests).toHaveLength(2);
  });

  it('still enforces the budget cap under fork', async () => {
    const base = new Map<string, BuiltinTool>([
      ['Read', recordingTool('Read', [], { readOnly: true })],
    ]);
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents('Read', { file_path: '/a' }, { model: 'claude-sonnet-4-5' }),
        textReplyEvents('done', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
      engineConfig: { maxBudgetUsd: 1e-9 },
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ fork: true, parentHistory: parentCtx() }),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('maxBudgetUsd');
    expect(h.transport.requests).toHaveLength(1);
  });

  it('still enforces the depth cap under fork (no transport call)', async () => {
    const h = makeRuntime({ scripts: [] });
    const res = await h.runtime.makeSpawnFn(MAX_SUBAGENT_DEPTH)(
      baseParams({ fork: true, parentHistory: parentCtx() }),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('nesting limit');
    expect(h.transport.requests).toHaveLength(0);
  });
});

describe('subagent runtime — depth cap', () => {
  it('the makeSpawnFn guard rejects at MAX depth', async () => {
    const h = makeRuntime({ scripts: [] });
    const res = await h.runtime.makeSpawnFn(MAX_SUBAGENT_DEPTH)(baseParams());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('nesting limit');
    // No transport call was made.
    expect(h.transport.requests).toHaveLength(0);
  });

  it('removes the Agent tool from a child at the max depth', async () => {
    const base = new Map<string, BuiltinTool>([
      ['Agent', createAgentTool(['general-purpose'])],
    ]);
    const h = makeRuntime({
      // A depth-(MAX) child that tries to spawn: Agent is structurally absent.
      scripts: [
        toolUseReplyEvents(
          'Agent',
          { description: 'x', prompt: 'p', subagent_type: 'general-purpose' },
          { model: 'claude-sonnet-4-5' },
        ),
        textReplyEvents('cannot nest', { model: 'claude-sonnet-4-5' }),
      ],
      baseBuiltins: base,
    });
    // Spawn from depth MAX-1 -> child runs at depth MAX and lacks the Agent tool.
    await h.runtime.makeSpawnFn(MAX_SUBAGENT_DEPTH - 1)(baseParams());
    expect(lastUserContent(h.transport.requests[1]?.messages ?? [])).toContain(
      'No such tool: Agent',
    );
  });
});

describe('subagent runtime — background', () => {
  it('returns an ack immediately and drains the completion note later', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('child bg answer', { model: 'claude-sonnet-4-5' })],
      agents: {
        worker: { description: 'w', prompt: 'work', background: true },
      },
    });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ subagentType: 'worker' }),
    );
    expect(res.background).toBe(true);
    expect(res.isError).toBe(false);
    expect(res.content).toContain('Launched background');
    // Nothing buffered yet (child still running detached).
    // Poll until the detached child completes and buffers its note.
    let notes = h.runtime.drainCompletedResults();
    for (let i = 0; i < 50 && notes.length === 0; i++) {
      await tick(1);
      notes = h.runtime.drainCompletedResults();
    }
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain('child bg answer');
    expect(notes[0]?.text).toContain(res.agentId);
    // Drained: buffer is now empty.
    expect(h.runtime.drainCompletedResults()).toHaveLength(0);
  });

  it('runs background foreground when requested below depth 0', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('deep answer', { model: 'claude-sonnet-4-5' })],
      agents: {
        worker: { description: 'w', prompt: 'work', background: true },
      },
    });
    // depth 1 -> background downgraded to foreground; result returns inline.
    const res = await h.runtime.makeSpawnFn(1)(
      baseParams({ subagentType: 'worker' }),
    );
    expect(res.background).toBe(false);
    expect(res.content).toContain('deep answer');
  });
});

describe('subagent runtime — task control', () => {
  it('stopTask on an unknown id is a no-op, abortAll never throws', () => {
    const h = makeRuntime({ scripts: [] });
    expect(() => h.runtime.stopTask('nope')).not.toThrow();
    expect(() => h.runtime.abortAll()).not.toThrow();
  });

  it('agentNames lists options.agents plus general-purpose', () => {
    const h = makeRuntime({
      scripts: [],
      agents: {
        a: { description: 'a', prompt: 'a' },
        b: { description: 'b', prompt: 'b' },
      },
    });
    expect(h.runtime.agentNames()).toEqual(['a', 'b', 'general-purpose']);
  });
});

describe('general-purpose prompt provenance (corpus-sync guard, Track B)', () => {
  const archive = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'Public-Info-Pool',
    'Reference',
    'Claude-Code-System-Prompts',
    'system-prompts',
  );
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

  it('reproduces the official Strengths + Guidelines substance', () => {
    // adapted intro (parent-agent framing, not the Claude Code CLI self-ref)
    expect(GENERAL_PURPOSE_PROMPT).toContain('parent agent');
    expect(GENERAL_PURPOSE_PROMPT).not.toContain('official CLI');
    // faithful blocks
    expect(GENERAL_PURPOSE_PROMPT).toContain('Your strengths:');
    expect(GENERAL_PURPOSE_PROMPT).toContain('NEVER proactively create documentation files');
  });

  it.runIf(existsSync(archive))('its cited archive source is still represented', () => {
    const desc = norm(GENERAL_PURPOSE_PROMPT);
    for (const slug of GENERAL_PURPOSE_PROMPT_PROVENANCE.slugs) {
      const file = join(archive, `${slug}.md`);
      expect(existsSync(file), slug).toBe(true);
      const body = norm(stripHeader(readFileSync(file, 'utf8')));
      const anchors = body
        .split(/(?<=[.:])\s+/)
        .map(norm)
        .filter((s) => s.length >= 40 && !s.includes('${'))
        .map((s) => s.slice(0, 45));
      expect(anchors.some((a) => desc.includes(a)), `${slug} not represented`).toBe(true);
    }
  });
});

describe('worker-fork preset (O-B0)', () => {
  const archive = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'Public-Info-Pool',
    'Reference',
    'Claude-Code-System-Prompts',
    'system-prompts',
  );
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

  it('the preset rides fork mode with the official worker profile', () => {
    expect(WORKER_FORK_AGENT.fork).toBe(true);
    expect(WORKER_FORK_AGENT.maxTurns).toBe(200);
    expect(WORKER_FORK_AGENT.prompt.length).toBeGreaterThan(0); // resolver requires non-empty
  });
  it('buildWorkerForkPrompt assembles <system> framing + directive + context', () => {
    const p = buildWorkerForkPrompt('Audit src/tips for dead code.', '\n\nExtra: only report.');
    expect(p.startsWith('<system>\n')).toBe(true);
    expect(p).toContain('You are a worker fork.');
    expect(p).toContain('</system>\n\nAudit src/tips for dead code.');
    expect(p.endsWith('Extra: only report.')).toBe(true);
  });
  it.runIf(existsSync(archive))('the framing is faithful to its archived source', () => {
    const body = norm(
      stripHeader(readFileSync(join(archive, `${WORKER_FORK_PROVENANCE.slug}.md`), 'utf8')),
    )
      // normalize the archive's template variables to our adapted values
      .replace(/\$\{AGENT_TOOL_NAME\}/g, 'Agent')
      .replace(/\$\{""\}/g, '');
    const drifted = norm(WORKER_FORK_FRAMING)
      .split(/(?<=[.:])\s+/)
      .map(norm)
      .filter((s) => s.length >= 40)
      .filter((s) => !body.includes(s.slice(0, 60)));
    expect(drifted, `not found in archive:\n${drifted.join('\n')}`).toEqual([]);
  });
});
