/**
 * Subagent subsystem tests: pure helpers (agents.ts), the Agent built-in tool
 * (agent-tool.ts) and the recursive runtime (runtime.ts). Transport is the
 * scripted MockTransport; the hook runner is the real DefaultHookRunner and the
 * permission gate is the real DefaultPermissionGate, so wiring is exercised
 * end-to-end without a network.
 */

import { describe, expect, it } from 'vitest';

import {
  GENERAL_PURPOSE_PROMPT,
  MAX_SUBAGENT_DEPTH,
  resolveAgentDefinition,
  resolveModelAlias,
} from '../src/subagents/agents.js';
import { createAgentTool } from '../src/subagents/agent-tool.js';
import {
  createSubagentRuntime,
  type SubagentRuntimeOptions,
} from '../src/subagents/runtime.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  BuiltinTool,
  EngineConfig,
  McpRegistry,
  SpawnSubagentParams,
  ToolContext,
} from '../src/internal/contracts.js';
import type {
  AgentDefinition,
  APIMessageParam,
  CallToolResult,
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
};

function makeRuntime(cfg: {
  scripts: RawMessageStreamEvent[][];
  agents?: Record<string, AgentDefinition>;
  baseBuiltins?: Map<string, BuiltinTool>;
  engineConfig?: Partial<EngineConfig>;
  options?: Partial<Options>;
  withStartStopHooks?: boolean;
}): RuntimeHarness {
  const transport = new MockTransport(cfg.scripts);
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
    cwd: '/tmp/sub-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
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
    expect(resolveModelAlias('fable', 'parent')).toBe('claude-sonnet-5');
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

  it('has the documented input schema', () => {
    expect(tool.name).toBe('Agent');
    expect(tool.readOnly).toBe(false);
    expect(tool.isFileEdit).toBe(false);
    expect(tool.inputSchema.required).toEqual([
      'description',
      'prompt',
      'subagent_type',
    ]);
    const props = tool.inputSchema.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'description',
      'prompt',
      'run_in_background',
      'subagent_type',
    ]);
    // Enumerates the agent names in the subagent_type description.
    expect(
      (props['subagent_type'] as { description: string }).description,
    ).toContain('researcher');
  });

  it('errors when no runtime is wired', async () => {
    const r = await tool.execute(
      { description: 'x', prompt: 'p', subagent_type: 'general-purpose' },
      ctxWith(undefined),
    );
    expect(r.isError).toBe(true);
    expect(r.content).toContain('runtime not available');
  });

  it('errors on a missing prompt / subagent_type', async () => {
    const ctx = ctxWith(async () => ({
      content: 'unused',
      isError: false,
      agentId: 'a',
      background: false,
    }));
    const noPrompt = await tool.execute(
      { description: 'x', subagent_type: 'general-purpose' },
      ctx,
    );
    expect(noPrompt.isError).toBe(true);
    const noType = await tool.execute({ description: 'x', prompt: 'p' }, ctx);
    expect(noType.isError).toBe(true);
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
