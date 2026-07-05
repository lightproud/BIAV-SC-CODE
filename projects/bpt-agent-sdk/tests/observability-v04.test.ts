/**
 * v0.4 — lifecycle emission + contract-alignment increments.
 *
 *  1. Subagent task lifecycle: system/task_started / task_progress /
 *     task_updated (foreground + background) and task_notification
 *     (background only) are EMITTED — official `system`+subtype encoding
 *     since v0.7 (B2a/E8) — both at the runtime seam and end-to-end.
 *  2. Hook lifecycle: system/hook_started + system/hook_response pairs behind
 *     options.includeHookEvents (off by default).
 *  3. Error results carry the official-parallel `errors: string[]`.
 *  4. matchToolName supports the `*` and `mcp__*` globs (deny-position use).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { query } from '../src/index.js';
import type {
  AgentDefinition,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from '../src/index.js';
import type {
  BuiltinTool,
  EngineConfig,
  RawMessageStreamEvent,
  SpawnSubagentParams,
} from '../src/internal/contracts.js';
import type { RawMessageStreamEvent as RawEvent } from '../src/types.js';
import { createSubagentRuntime } from '../src/subagents/runtime.js';
import type { SubagentRuntimeOptions } from '../src/subagents/runtime.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { matchToolName } from '../src/permissions/rules.js';
import { MockTransport, textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';
import type { CallToolResult, McpResource, McpResourceContent, McpServerStatus } from '../src/types.js';
import type { McpRegistry, McpSetServersResult, McpToolEntry } from '../src/internal/contracts.js';
import type { McpServerConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): McpToolEntry[] {
    return [];
  }
  has(): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    throw new Error('no tools');
  }
  async listResources(): Promise<McpResource[]> {
    return [];
  }
  async readResource(): Promise<McpResourceContent[]> {
    return [];
  }
  async reconnect(): Promise<void> {}
  setEnabled(): void {}
  async setServers(_servers: Record<string, McpServerConfig>): Promise<McpSetServersResult> {
    return { added: [], removed: [], updated: [], statuses: [] };
  }
  async closeAll(): Promise<void> {}
}

function makeRuntime(cfg: {
  scripts: Array<RawEvent[] | (() => RawEvent[])>;
  agents?: Record<string, AgentDefinition>;
  engineConfig?: Partial<EngineConfig>;
}) {
  const transport = new MockTransport(cfg.scripts as RawEvent[][]);
  const emitted: SDKMessage[] = [];
  const engineConfig: EngineConfig = {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'parent',
    includePartialMessages: false,
    sessionId: 'parent-sess',
    cwd: '/tmp/obs-v04-test',
    ...cfg.engineConfig,
  };
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins: new Map<string, BuiltinTool>(),
    mcp: new FakeMcp(),
    transport,
    hooks: new DefaultHookRunner({ hooks: {}, debug: () => {} }),
    parentGate: new DefaultPermissionGate({ debug: () => {} }),
    engineConfig,
    cwd: '/tmp/obs-v04-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
    emitObservability: (m) => emitted.push(m),
  };
  return { runtime: createSubagentRuntime(opts), emitted, transport };
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

function ofType<T extends SDKMessage['type']>(
  msgs: SDKMessage[],
  type: T,
): Array<Extract<SDKMessage, { type: T }>> {
  return msgs.filter((m): m is Extract<SDKMessage, { type: T }> => m.type === type);
}

/** v0.7: lifecycle events are official `system`+subtype encoded. */
function ofSubtype<S extends Extract<SDKMessage, { type: 'system' }>['subtype']>(
  msgs: SDKMessage[],
  subtype: S,
): Array<Extract<SDKMessage, { type: 'system'; subtype: S }>> {
  return msgs.filter(
    (m): m is Extract<SDKMessage, { type: 'system'; subtype: S }> =>
      m.type === 'system' && (m as { subtype?: string }).subtype === subtype,
  );
}

/** Ordered stream names with system subtypes unwrapped (for ordering checks). */
function namesOf(msgs: SDKMessage[]): string[] {
  return msgs.map((m) =>
    m.type === 'system' ? (m as { subtype: string }).subtype : m.type,
  );
}

// ---------------------------------------------------------------------------
// 1. Task lifecycle — runtime seam
// ---------------------------------------------------------------------------

describe('v0.4 task lifecycle (runtime)', () => {
  it('foreground: task_started -> task_progress -> task_updated(completed)', async () => {
    const h = makeRuntime({ scripts: [textReplyEvents('child answer')] });
    const res = await h.runtime.makeSpawnFn(0)(
      baseParams({ description: 'my delegated task' }),
    );
    expect(res.isError).toBe(false);

    const started = ofSubtype(h.emitted, 'task_started');
    expect(started).toHaveLength(1);
    expect(started[0]!.description).toBe('my delegated task');
    expect(started[0]!.task_type).toBe('local_agent');
    expect(started[0]!.task_id).toBe(res.agentId);
    expect(started[0]!.session_id).toBe('parent-sess');

    const progress = ofSubtype(h.emitted, 'task_progress');
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress[0]!.task_id).toBe(res.agentId);
    expect(progress[0]!.description).toBe('my delegated task');
    expect(progress[0]!.subagent_type).toBe('general-purpose');
    // Official required usage: real cumulative figures.
    expect(progress[0]!.usage.duration_ms).toBeGreaterThanOrEqual(0);
    expect(progress[0]!.usage.tool_uses).toBe(0);
    expect(progress[0]!.usage.total_tokens).toBeGreaterThanOrEqual(0);
    // BPT superset extensions (E8b): budget-share progress + turn status.
    expect(progress[0]!.progress).toBeGreaterThanOrEqual(0);
    expect(progress[0]!.progress).toBeLessThanOrEqual(99);
    expect(progress[0]!.status).toMatch(/^turn 1\/\d+$/);

    const updated = ofSubtype(h.emitted, 'task_updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.patch.status).toBe('completed');
    expect(updated[0]!.patch.end_time).toBeGreaterThan(0);
    expect(updated[0]!.result).toBe('child answer');

    // Foreground children never notify (their result returns inline).
    expect(ofSubtype(h.emitted, 'task_notification')).toHaveLength(0);

    // Ordering: started before progress before updated.
    const order = namesOf(h.emitted);
    expect(order.indexOf('task_started')).toBeLessThan(order.indexOf('task_progress'));
    expect(order.indexOf('task_progress')).toBeLessThan(order.indexOf('task_updated'));
  });

  it('description falls back to the resolved agent type without a description', async () => {
    const h = makeRuntime({ scripts: [textReplyEvents('ok')] });
    await h.runtime.makeSpawnFn(0)(baseParams());
    expect(ofSubtype(h.emitted, 'task_started')[0]!.description).toBe('general-purpose');
  });

  it('background: terminal task_updated + task_notification(completed)', async () => {
    const h = makeRuntime({
      scripts: [textReplyEvents('bg result')],
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'worker' }));
    expect(res.background).toBe(true);

    // Started is synchronous with the spawn; the terminal events land when the
    // detached child finishes.
    expect(ofSubtype(h.emitted, 'task_started')).toHaveLength(1);
    for (let i = 0; i < 200 && ofSubtype(h.emitted, 'task_notification').length === 0; i++) {
      await tick(1);
    }
    const updated = ofSubtype(h.emitted, 'task_updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.patch.status).toBe('completed');
    expect(updated[0]!.result).toBe('bg result');
    const notes = ofSubtype(h.emitted, 'task_notification');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.status).toBe('completed');
    expect(notes[0]!.output_file).toBe(''); // official required field; no task output files here
    expect(notes[0]!.summary).toContain('completed');
    expect(notes[0]!.task_id).toBe(res.agentId);
  });

  it('stopTask: task_updated(patch.status killed) + task_notification(stopped), no failed double-report', async () => {
    // The child's (only) stream call hangs on the outer signal via a script
    // function that defers until abort: simulate with a script whose events are
    // produced lazily AFTER stopTask by never being consumed — instead, use a
    // long child (many turns) and stop it between turns.
    const h = makeRuntime({
      scripts: [
        toolUseReplyEvents('NoSuchTool', {}),
        textReplyEvents('late'),
      ],
      agents: { worker: { description: 'w', prompt: 'work', background: true } },
    });
    const res = await h.runtime.makeSpawnFn(0)(baseParams({ subagentType: 'worker' }));
    h.runtime.stopTask(res.agentId);
    await tick(20);

    const updated = ofSubtype(h.emitted, 'task_updated');
    // Official patch.status vocabulary: an externally stopped task is 'killed'.
    const killed = updated.filter((u) => u.patch.status === 'killed');
    expect(killed).toHaveLength(1);
    expect(killed[0]!.task_id).toBe(res.agentId);
    const notes = ofSubtype(h.emitted, 'task_notification');
    expect(notes.some((n) => n.status === 'stopped')).toBe(true);
    // The aborted child must NOT also surface as failed.
    expect(updated.filter((u) => u.patch.status === 'failed')).toHaveLength(0);
  });

  it('task_updated.result is bounded to a preview', async () => {
    const long = 'x'.repeat(2000);
    const h = makeRuntime({ scripts: [textReplyEvents(long)] });
    await h.runtime.makeSpawnFn(0)(baseParams());
    const updated = ofSubtype(h.emitted, 'task_updated')[0]!;
    expect(updated.result!.length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(updated.result!.startsWith('xxx')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2-4. Query-level: stream ordering, hook lifecycle, errors[], globs
// ---------------------------------------------------------------------------

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-obs-v04-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function opts(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir: path.join(sandbox, '.sessions'),
    cwd: sandbox,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  } as Options;
}

describe('v0.4 task lifecycle (end-to-end stream)', () => {
  it('a foreground Agent call surfaces task_* in the stream, before the result', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Agent', {
          description: 'sub work',
          prompt: 'do the sub work',
          subagent_type: 'general-purpose',
        }),
        textReplyEvents('child says hi'),
        textReplyEvents('parent done'),
      ]),
    );
    const messages = await collect(
      query({ prompt: 'go', options: opts({ allowedTools: ['Agent'] }) }),
    );

    const started = ofSubtype(messages, 'task_started');
    expect(started).toHaveLength(1);
    expect(started[0]!.description).toBe('sub work');
    // tool_use_id (official optional) is currently never populated: the loop
    // does not expose the spawning tool_use block id to the Agent tool
    // (agent-tool.ts passes toolUseId: ''), and the runtime omits the field
    // rather than emit a dishonest fallback id.
    expect(started[0]!.tool_use_id).toBeUndefined();
    const updated = ofSubtype(messages, 'task_updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.patch.status).toBe('completed');
    expect(updated[0]!.result).toBe('child says hi');
    expect(ofSubtype(messages, 'task_progress').length).toBeGreaterThanOrEqual(1);

    const types = namesOf(messages);
    expect(types.indexOf('task_started')).toBeLessThan(types.indexOf('task_updated'));
    expect(types.indexOf('task_updated')).toBeLessThan(types.indexOf('result'));

    const result = ofType(messages, 'result')[0] as SDKResultMessage;
    expect(result.subtype).toBe('success');
  });
});

describe('v0.4 hook lifecycle (includeHookEvents)', () => {
  const hookSet = () => ({
    PreToolUse: [
      {
        hooks: [
          async () => ({ systemMessage: 'seen' }),
        ],
      },
    ],
  });

  it('emits hook_started/hook_response pairs when includeHookEvents is true', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Glob', { pattern: '*.md' }),
        textReplyEvents('done'),
      ]),
    );
    const messages = await collect(
      query({
        prompt: 'go',
        options: opts({ includeHookEvents: true, hooks: hookSet() }),
      }),
    );
    const started = ofSubtype(messages, 'hook_started');
    const responded = ofSubtype(messages, 'hook_response');
    expect(started).toHaveLength(1);
    expect(responded).toHaveLength(1);
    expect(started[0]!.hook_event).toBe('PreToolUse');
    expect(started[0]!.hook_name).toBeTruthy(); // official field: callback name or 'callback'
    expect(responded[0]!.hook_event).toBe('PreToolUse');
    // Correlated by hook_id; response carries the output JSON on `output`.
    expect(responded[0]!.hook_id).toBe(started[0]!.hook_id);
    expect(responded[0]!.output).toContain('seen');
    expect(responded[0]!.outcome).toBe('success');
    expect(responded[0]!.stdout).toBe(''); // in-process callbacks: no stdio
    // Ordering: the pair surfaces before the terminal result.
    const types = namesOf(messages);
    expect(types.indexOf('hook_response')).toBeLessThan(types.indexOf('result'));
  });

  it('emits nothing without includeHookEvents (default off)', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Glob', { pattern: '*.md' }),
        textReplyEvents('done'),
      ]),
    );
    const messages = await collect(
      query({ prompt: 'go', options: opts({ hooks: hookSet() }) }),
    );
    expect(ofSubtype(messages, 'hook_started')).toHaveLength(0);
    expect(ofSubtype(messages, 'hook_response')).toHaveLength(0);
  });

  it('a failing hook callback reports its error on hook_response', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Glob', { pattern: '*.md' }),
        textReplyEvents('done'),
      ]),
    );
    const messages = await collect(
      query({
        prompt: 'go',
        options: opts({
          includeHookEvents: true,
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async () => {
                    throw new Error('boom');
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    const responded = ofSubtype(messages, 'hook_response');
    expect(responded).toHaveLength(1);
    // Official shape: the failure lands on stderr with outcome 'error'.
    expect(responded[0]!.stderr).toContain('boom');
    expect(responded[0]!.outcome).toBe('error');
    expect(responded[0]!.output).toBe('');
  });
});

describe('v0.4 result.errors[] (official-surface parallel)', () => {
  it('error results carry errors === [errorMessage]', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([toolUseReplyEvents('Glob', { pattern: '*.md' })]),
    );
    const messages = await collect(
      query({ prompt: 'go', options: opts({ maxTurns: 1 }) }),
    );
    const result = ofType(messages, 'result')[0] as SDKResultMessage;
    expect(result.subtype).toBe('error_max_turns');
    if (result.subtype !== 'success') {
      expect(result.errors).toEqual([result.errorMessage]);
    }
  });
});

describe('v0.4 tool-name globs (* and mcp__*)', () => {
  it('matchToolName supports the global and all-MCP globs', () => {
    expect(matchToolName('*', 'Bash')).toBe(true);
    expect(matchToolName('*', 'mcp__srv__tool')).toBe(true);
    expect(matchToolName('mcp__*', 'mcp__srv__tool')).toBe(true);
    expect(matchToolName('mcp__*', 'mcp__a__b__tool')).toBe(true);
    expect(matchToolName('mcp__*', 'Bash')).toBe(false);
    // Not mcp__X__Y-shaped -> not an MCP tool name.
    expect(matchToolName('mcp__*', 'mcp__loneserver')).toBe(false);
    // Existing server-scoped forms are unchanged.
    expect(matchToolName('mcp__srv__*', 'mcp__srv__tool')).toBe(true);
    expect(matchToolName('mcp__srv__*', 'mcp__other__tool')).toBe(false);
  });

  it("disallowedTools: ['*'] removes every built-in from the request", async () => {
    vi.stubGlobal('fetch', makeSSEFetch([textReplyEvents('hi')]));
    const messages = await collect(
      query({ prompt: 'go', options: opts({ disallowedTools: ['*'] }) }),
    );
    const init = messages.find(
      (m) => m.type === 'system' && (m as { subtype?: string }).subtype === 'init',
    ) as { tools: string[] } | undefined;
    expect(init).toBeDefined();
    expect(init!.tools).toHaveLength(0);
  });
});
