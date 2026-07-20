/**
 * Stop-hook block semantics (v0.39, the /goal goal-gating primitive):
 * a Stop hook 'block' decision prevents the natural-end stop — the reason is
 * fed back as a user turn and the loop runs another assistant turn, with
 * stop_hook_active reported true on subsequent Stop inputs. continue:false
 * forces the stop and wins over block. ROOT LOOP ONLY: child loops
 * (parentToolUseId set) are governed by SubagentStop at the runtime level.
 */

import { describe, expect, it } from 'vitest';

import { runAgentLoop } from '../src/engine/loop.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { createGoalStopHooks } from '../src/hooks/goal.js';
import type {
  AggregatedHookResult,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
} from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  CallToolResult,
  HookEvent,
  HookInput,
  McpServerStatus,
  SDKMessage,
  SDKResultMessage,
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

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

/** Scripted Stop-hook runner: one AggregatedHookResult per Stop invocation. */
class ScriptedStopHooks implements HookRunner {
  readonly stopInputs: HookInput[] = [];
  private calls = 0;

  constructor(private readonly scripts: Array<Partial<AggregatedHookResult>>) {}

  hasHooks(event: HookEvent): boolean {
    return event === 'Stop';
  }

  async run(
    event: HookEvent,
    input: HookInput,
    _toolUseID: string | undefined,
    _matchValue: string | undefined,
    _signal: AbortSignal,
  ): Promise<AggregatedHookResult> {
    if (event !== 'Stop') {
      return { continue: true, systemMessages: [], additionalContext: [] };
    }
    this.stopInputs.push(input);
    const s = this.scripts[this.calls++] ?? {};
    return {
      continue: s.continue ?? true,
      stopReason: s.stopReason,
      systemMessages: s.systemMessages ?? [],
      decision: s.decision,
      decisionReason: s.decisionReason,
      additionalContext: [],
    };
  }
}

function makeDeps(transport: MockTransport, hooks: HookRunner): EngineDeps {
  return {
    transport,
    builtinTools: new Map(),
    mcp: new FakeMcp(),
    permissions: new DefaultPermissionGate({}),
    hooks,
    toolContext: {
      cwd: '/tmp/stop-hook-test',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-test-1',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-stop-hook',
    cwd: '/tmp/stop-hook-test',
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

const stopActiveOf = (input: HookInput): boolean =>
  (input as { stop_hook_active?: boolean }).stop_hook_active === true;

describe('Stop-hook block semantics', () => {
  it('block prevents the stop, feeds the reason back, then a clean pass ends the run', async () => {
    // Snapshot the request view AT REQUEST TIME via a function script — the
    // MockTransport records live array references, which later turns mutate.
    const history: APIMessageParam[] = [{ role: 'user', content: 'do the task' }];
    let secondRequestMessages: APIMessageParam[] = [];
    const transport = new MockTransport([
      textReplyEvents('draft answer'),
      () => {
        secondRequestMessages = history.map((m) => ({ ...m }));
        return textReplyEvents('final answer');
      },
    ]);
    const hooks = new ScriptedStopHooks([
      { decision: 'deny', decisionReason: 'goal not reached: tests still red' },
      {},
    ]);
    const messages = await collect(
      runAgentLoop(history, makeDeps(transport, hooks), makeConfig()),
    );

    // Two API requests ran; the second carried the injected reason turn last.
    expect(transport.requests).toHaveLength(2);
    const injected = secondRequestMessages[secondRequestMessages.length - 1];
    expect(injected?.role).toBe('user');
    expect(JSON.stringify(injected?.content)).toContain('goal not reached');

    // stop_hook_active: false on the first Stop input, true on the second.
    expect(hooks.stopInputs).toHaveLength(2);
    expect(stopActiveOf(hooks.stopInputs[0]!)).toBe(false);
    expect(stopActiveOf(hooks.stopInputs[1]!)).toBe(true);

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect((result as { result?: string }).result).toBe('final answer');

    // The injected reason turn is part of persisted history (resume replays it).
    expect(
      history.some(
        (m) => m.role === 'user' && JSON.stringify(m.content).includes('goal not reached'),
      ),
    ).toBe(true);
  });

  it('continue:false forces the stop and wins over a block decision', async () => {
    const transport = new MockTransport([textReplyEvents('only answer')]);
    const hooks = new ScriptedStopHooks([
      {
        continue: false,
        stopReason: 'operator abort',
        decision: 'deny',
        decisionReason: 'would block, but continue:false wins',
      },
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'task' }],
        makeDeps(transport, hooks),
        makeConfig(),
      ),
    );
    expect(transport.requests).toHaveLength(1);
    expect(lastResult(messages).subtype).toBe('success');
  });

  it('child loops (parentToolUseId set) never INVOKE the Stop hook', async () => {
    // Regression (audit 2026-07-15): a child's natural end must not fire the
    // Stop hook AT ALL — not merely have its 'block' decision ignored. A Stop
    // hook such as /goal's onStop mutates session-goal state as a side effect,
    // so invoking it on a child's transcript would let the child clear or
    // pollute the ROOT goal (conversation loses stop state). The gate now
    // wraps the invocation, so the hook is never consulted for a child.
    const transport = new MockTransport([textReplyEvents('child answer')]);
    const hooks = new ScriptedStopHooks([
      { decision: 'deny', decisionReason: 'goal gate must not capture children' },
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'child task' }],
        makeDeps(transport, hooks),
        makeConfig({ parentToolUseId: 'toolu_parent_1' }),
      ),
    );
    expect(transport.requests).toHaveLength(1);
    expect(lastResult(messages).subtype).toBe('success');
    // The heart of the fix: the child never reached the Stop hook, so no
    // onStop side effect (goal clear / block-counter bump / evaluator call)
    // could have run against the child's transcript.
    expect(hooks.stopInputs).toHaveLength(0);
  });

  it('a child goal-gate that would "clear on met" leaves the armed root goal intact', async () => {
    // End-to-end shape of the bug: wire the REAL structured goal gate as a
    // session-scoped Stop hook, then run a CHILD loop to natural end. The
    // host evaluator is stubbed to return an ACHIEVED verdict, so if the
    // child's natural end reached the gate AT ALL it would disarm the goal
    // (pre-fix behavior). Post-fix the child never invokes Stop, so the
    // evaluator is never consulted. Discriminating and network-free.
    let evaluatorCalls = 0;
    const events: string[] = [];
    const goalHooks = createGoalStopHooks({
      goal: 'the ROOT task is fully complete',
      evaluator: () => {
        evaluatorCalls += 1;
        return { status: 'achieved', reason: 'child subtask done' };
      },
      onEvent: (e) => events.push(e.kind),
    });

    const transport = new MockTransport([textReplyEvents('child answer')]);
    const hooks = new DefaultHookRunner({ hooks: goalHooks, debug: () => {} });
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'child subtask' }],
        makeDeps(transport, hooks),
        makeConfig({ parentToolUseId: 'toolu_parent_2' }),
      ),
    );
    expect(lastResult(messages).subtype).toBe('success');
    // The root goal is untouched by the child's natural end: the host
    // evaluator was never consulted and no lifecycle event fired.
    expect(evaluatorCalls).toBe(0);
    expect(events).toEqual([]);
  });

  it('a stubborn block still honors maxTurns', async () => {
    const transport = new MockTransport([textReplyEvents('turn 1')]);
    const hooks = new ScriptedStopHooks([
      { decision: 'deny', decisionReason: 'never satisfied' },
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'task' }],
        makeDeps(transport, hooks),
        makeConfig({ maxTurns: 1 }),
      ),
    );
    expect(transport.requests).toHaveLength(1);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_max_turns');
  });

  it('without Stop hooks the natural end is unchanged', async () => {
    const transport = new MockTransport([textReplyEvents('plain answer')]);
    const hooks = new ScriptedStopHooks([]);
    // hasHooks true but empty script -> default pass-through aggregate.
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'task' }],
        makeDeps(transport, hooks),
        makeConfig(),
      ),
    );
    expect(transport.requests).toHaveLength(1);
    expect(lastResult(messages).subtype).toBe('success');
  });
});
