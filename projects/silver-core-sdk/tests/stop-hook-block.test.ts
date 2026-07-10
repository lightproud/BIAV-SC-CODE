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

  it('child loops (parentToolUseId set) ignore Stop-hook blocks', async () => {
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
