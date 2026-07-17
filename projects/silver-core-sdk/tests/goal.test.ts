/**
 * Structured session goal (SCS-REQ-REPOS-01 §4.3) — options.goal is the
 * goal's ONLY entrance.
 *
 * Mechanism under test: not_achieved BLOCKS the stop and re-drives the loop
 * with the evaluator's reason; achieved / impossible allow the stop and
 * disarm; evaluator failure allows the stop (a broken judge must never trap
 * the loop); maxBlocks is the host's escape policy. The evaluator is
 * host-injected — the engine makes no judge-model call of its own.
 */

import { describe, expect, it } from 'vitest';

import { runAgentLoop } from '../src/engine/loop.js';
import { createGoalStopHooks } from '../src/hooks/goal.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { ConfigurationError } from '../src/errors.js';
import { query } from '../src/query.js';
import type {
  CallToolResult,
  EngineConfig,
  EngineDeps,
  McpRegistry,
} from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  GoalEvent,
  GoalVerdict,
  McpServerStatus,
  SDKMessage,
  SDKResultMessage,
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(_qualifiedName: string): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'unexpected mcp call' }], isError: true };
  }
  async reconnect(_serverName: string): Promise<void> {}
  setEnabled(_serverName: string, _enabled: boolean): void {}
  async closeAll(): Promise<void> {}
}

function makeDeps(transport: MockTransport, hooks: DefaultHookRunner): EngineDeps {
  return {
    transport,
    builtinTools: new Map(),
    mcp: new FakeMcp(),
    permissions: new DefaultPermissionGate({}),
    hooks,
    toolContext: {
      cwd: '/tmp/goal-test',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
  } as unknown as EngineDeps;
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-goal',
    cwd: '/tmp/goal-test',
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

function lastResult(messages: SDKMessage[]): SDKResultMessage {
  const last = messages[messages.length - 1];
  expect(last?.type).toBe('result');
  return last as SDKResultMessage;
}

/** Drive one engine run with a scripted evaluator; returns transcript info. */
async function drive(
  verdicts: Array<GoalVerdict | Error>,
  replies: string[],
  extra?: { maxBlocks?: number },
) {
  const events: GoalEvent[] = [];
  const contexts: Array<{ goal: string; blocks: number }> = [];
  let call = 0;
  const goalHooks = createGoalStopHooks({
    goal: 'all fleet metrics collected',
    evaluator: (ctx) => {
      contexts.push({ goal: ctx.goal, blocks: ctx.blocks });
      const v = verdicts[Math.min(call++, verdicts.length - 1)]!;
      if (v instanceof Error) throw v;
      return v;
    },
    onEvent: (e) => events.push(e),
    ...(extra?.maxBlocks !== undefined ? { maxBlocks: extra.maxBlocks } : {}),
  });
  const history: APIMessageParam[] = [{ role: 'user', content: 'work the loop' }];
  const transport = new MockTransport(replies.map((r) => textReplyEvents(r)));
  const hooks = new DefaultHookRunner({ hooks: goalHooks, debug: () => {} });
  const messages = await collect(
    runAgentLoop(history, makeDeps(transport, hooks), makeConfig()),
  );
  return { messages, events, contexts, history, transport };
}

describe('structured goal gate over the engine loop', () => {
  it('not_achieved blocks the stop, feeds the reason back, achieved ends it', async () => {
    const { messages, events, contexts, history, transport } = await drive(
      [
        { status: 'not_achieved', reason: 'two hosts still unscanned' },
        { status: 'achieved', reason: 'all hosts scanned' },
      ],
      ['partial sweep done', 'full sweep done'],
    );
    expect(transport.requests).toHaveLength(2); // the block re-drove one more turn
    expect(lastResult(messages).subtype).toBe('success');
    expect(events.map((e) => e.kind)).toEqual(['blocked', 'achieved']);
    // The evaluator's reason was fed back into the loop as a user turn.
    const feedback = history.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content !== 'string' &&
        JSON.stringify(m.content).includes('two hosts still unscanned'),
    );
    expect(feedback ?? history.find((m) => JSON.stringify(m).includes('two hosts'))).toBeDefined();
    // The evaluator saw the goal text and the running block count.
    expect(contexts[0]).toEqual({ goal: 'all fleet metrics collected', blocks: 0 });
    expect(contexts[1]).toEqual({ goal: 'all fleet metrics collected', blocks: 1 });
  });

  it('impossible is the judged escape hatch: stop allowed, goal disarmed', async () => {
    const { messages, events, transport } = await drive(
      [{ status: 'impossible', reason: 'the fleet endpoint was decommissioned' }],
      ['tried everything'],
    );
    expect(transport.requests).toHaveLength(1);
    expect(lastResult(messages).subtype).toBe('success');
    expect(events.map((e) => e.kind)).toEqual(['impossible']);
  });

  it('an evaluator throw ALLOWS the stop (a broken judge never traps the loop)', async () => {
    const { messages, events, transport } = await drive(
      [new Error('judge backend down')],
      ['did the work'],
    );
    expect(transport.requests).toHaveLength(1);
    expect(lastResult(messages).subtype).toBe('success');
    expect(events).toEqual([
      { kind: 'evaluator_error', goal: 'all fleet metrics collected', reason: 'judge backend down' },
    ]);
  });

  it('a malformed verdict ALLOWS the stop with evaluator_error', async () => {
    const { messages, events } = await drive(
      [{ status: 'sort of done' } as unknown as GoalVerdict],
      ['did the work'],
    );
    expect(lastResult(messages).subtype).toBe('success');
    expect(events.map((e) => e.kind)).toEqual(['evaluator_error']);
  });

  it('maxBlocks is the block-cap escape: allows the stop after the cap', async () => {
    const { messages, events, transport } = await drive(
      [{ status: 'not_achieved', reason: 'never enough' }],
      ['try 1', 'try 2'],
      { maxBlocks: 1 },
    );
    // One block (re-drive), then the cap allows the second stop.
    expect(transport.requests).toHaveLength(2);
    expect(lastResult(messages).subtype).toBe('success');
    expect(events.map((e) => e.kind)).toEqual(['blocked', 'block_limit']);
  });

  it('rejects malformed configs up front', () => {
    const evaluator = () => ({ status: 'achieved' }) as GoalVerdict;
    expect(() => createGoalStopHooks({ goal: ' ', evaluator })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      createGoalStopHooks({ goal: 'g', evaluator: 42 as never }),
    ).toThrow(ConfigurationError);
    expect(() =>
      createGoalStopHooks({ goal: 'g', evaluator, maxBlocks: 0 }),
    ).toThrow(ConfigurationError);
    expect(() =>
      createGoalStopHooks({ goal: 'g', evaluator, transcriptTailBytes: 0 }),
    ).toThrow(ConfigurationError);
  });
});

describe('options.goal wiring (query assembly)', () => {
  it('arms the gate and PRESERVES caller Stop hooks alongside it', async () => {
    const events: string[] = [];
    let callerStopRuns = 0;
    const q = query({
      prompt: 'work',
      options: {
        provider: {
          apiKey: 'test-key',
          fetch: makeSSEFetch([textReplyEvents('round 1'), textReplyEvents('round 2')]),
          promptCaching: false,
        },
        persistSession: false,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        goal: {
          goal: 'both rounds done',
          evaluator: ({ blocks }) =>
            blocks === 0
              ? { status: 'not_achieved', reason: 'round 2 missing' }
              : { status: 'achieved' },
          onEvent: (e) => events.push(e.kind),
        },
        hooks: {
          Stop: [
            {
              hooks: [
                async () => {
                  callerStopRuns += 1;
                  return {};
                },
              ],
            },
          ],
        },
      },
    });
    const messages = await collect(q);
    expect(lastResult(messages).subtype).toBe('success');
    expect(events).toEqual(['blocked', 'achieved']);
    // The caller's own Stop hook ran at each stop consultation too.
    expect(callerStopRuns).toBeGreaterThanOrEqual(2);
  });
});
