/**
 * R2 budget event stream (SCS-REQ-REPOS-01 §3 R2).
 *
 * Two one-shot, root-loop-only hook events ride the existing hook mechanism
 * on top of the maxBudgetUsd gate: `budget:threshold` when cumulative cost
 * crosses maxBudgetUsd * budgetThresholdRatio (default 0.8), and
 * `budget:exhausted` at the first budget stop, carrying the structured
 * closeout report (cumulative cost / turn count / bounded last-state
 * summary). The events are informational: they never change engine behavior
 * (stopping is decided by the budget gate exactly as before).
 */

import { describe, expect, it } from 'vitest';

import { runAgentLoop } from '../src/engine/loop.js';
import { query } from '../src/query.js';
import { ConfigurationError } from '../src/errors.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  AggregatedHookResult,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
} from '../src/internal/contracts.js';
import type {
  BudgetExhaustedHookInput,
  BudgetThresholdHookInput,
  CallToolResult,
  HookEvent,
  HookInput,
  McpServerStatus,
  SDKMessage,
  SDKResultMessage,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';

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

/** Records every budget-event invocation; neutral aggregate for the rest. */
class BudgetEventRecorder implements HookRunner {
  readonly events: Array<{ event: HookEvent; input: HookInput }> = [];

  hasHooks(event: HookEvent): boolean {
    return event === 'budget:threshold' || event === 'budget:exhausted';
  }

  async run(
    event: HookEvent,
    input: HookInput,
    _toolUseID: string | undefined,
    _matchValue: string | undefined,
    _signal: AbortSignal,
  ): Promise<AggregatedHookResult> {
    if (this.hasHooks(event)) this.events.push({ event, input });
    return { continue: true, systemMessages: [], additionalContext: [] };
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
      cwd: '/tmp/budget-events-test',
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
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-budget-events',
    cwd: '/tmp/budget-events-test',
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

// 1000 input tokens on sonnet-4-5 ≈ $0.003105 with the default reply's
// output tokens — the same figure engine.test.ts pins.
const TURN_USAGE = { model: 'claude-sonnet-4-5', usage: { input_tokens: 1000 } };

describe('budget:threshold', () => {
  it('fires ONCE when cumulative cost crosses maxBudgetUsd * ratio, with figures', async () => {
    const hooks = new BudgetEventRecorder();
    // Turn 1 (~$0.0031) crosses 0.3 * $0.01 = $0.003; turn 2 must not re-fire.
    const transport = new MockTransport([
      toolUseReplyEvents('NoSuchTool', { x: 1 }, TURN_USAGE),
      textReplyEvents('done', TURN_USAGE),
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'go' }],
        makeDeps(transport, hooks),
        makeConfig({ maxBudgetUsd: 0.01, budgetThresholdRatio: 0.3 }),
      ),
    );
    expect(lastResult(messages).subtype).toBe('success');
    const thresholds = hooks.events.filter((e) => e.event === 'budget:threshold');
    expect(thresholds).toHaveLength(1);
    const input = thresholds[0]?.input as BudgetThresholdHookInput;
    expect(input.hook_event_name).toBe('budget:threshold');
    expect(input.max_budget_usd).toBe(0.01);
    expect(input.threshold_ratio).toBe(0.3);
    expect(input.cumulative_cost_usd).toBeGreaterThanOrEqual(0.003);
    // Under the cap: exhausted never fired.
    expect(hooks.events.some((e) => e.event === 'budget:exhausted')).toBe(false);
  });

  it('stays silent below the (default 0.8) threshold', async () => {
    const hooks = new BudgetEventRecorder();
    const transport = new MockTransport([textReplyEvents('hi', TURN_USAGE)]);
    await collect(
      runAgentLoop(
        [{ role: 'user', content: 'go' }],
        makeDeps(transport, hooks),
        makeConfig({ maxBudgetUsd: 1.0 }),
      ),
    );
    expect(hooks.events).toHaveLength(0);
  });
});

describe('budget:exhausted', () => {
  it('fires ONCE at the budget stop with the structured closeout report', async () => {
    const hooks = new BudgetEventRecorder();
    // A tool_use turn whose own cost exceeds the cap: E5 pre-tool stop.
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }, TURN_USAGE),
      textReplyEvents('never reached'),
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'go' }],
        makeDeps(transport, hooks),
        makeConfig({ maxBudgetUsd: 0.000001 }),
      ),
    );
    expect(lastResult(messages).subtype).toBe('error_max_budget_usd');
    const exhausted = hooks.events.filter((e) => e.event === 'budget:exhausted');
    expect(exhausted).toHaveLength(1);
    const input = exhausted[0]?.input as BudgetExhaustedHookInput;
    expect(input.hook_event_name).toBe('budget:exhausted');
    expect(input.reason).toContain('maxBudgetUsd');
    expect(input.report.max_budget_usd).toBe(0.000001);
    expect(input.report.cumulative_cost_usd).toBeGreaterThan(0.000001);
    expect(input.report.num_turns).toBe(1);
    expect(typeof input.report.last_assistant_summary).toBe('string');
    // The threshold latch was implicitly crossed too, in the same recording.
    // W1-3 (audit r3): the assertion expects EXACTLY one threshold event; a
    // `<= 1` upper bound also passed on 0 (threshold never fired = a
    // regression). Pin it to 1.
    expect(
      hooks.events.filter((e) => e.event === 'budget:threshold').length,
    ).toBe(1);
  });

  it('is ROOT LOOP ONLY: a child loop (parentToolUseId) fires no budget events', async () => {
    const hooks = new BudgetEventRecorder();
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }, TURN_USAGE),
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'go' }],
        makeDeps(transport, hooks),
        makeConfig({ maxBudgetUsd: 0.000001, parentToolUseId: 'tu_parent' }),
      ),
    );
    expect(lastResult(messages).subtype).toBe('error_max_budget_usd');
    expect(hooks.events).toHaveLength(0);
  });
});

describe('budgetThresholdRatio validation', () => {
  it('rejects out-of-range ratios at query construction', () => {
    for (const bad of [0, -0.5, 1.5]) {
      expect(() =>
        query({
          prompt: 'hi',
          options: {
            provider: { apiKey: 'k' },
            persistSession: false,
            budgetThresholdRatio: bad,
          },
        }),
      ).toThrow(ConfigurationError);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit 2026-07-17 batch A: M18 — session-anchored judgment + one-shot latch
// ---------------------------------------------------------------------------

describe('budget events judge against the SESSION cap (M18)', () => {
  it('budgetCostBaselineUsd anchors the threshold to the original cap, not the re-armed remainder', async () => {
    const hooks = new BudgetEventRecorder();
    // Session picture: cap $0.01, $0.003 already spent by earlier turns, so
    // this run is re-armed with the $0.007 REMAINDER. The turn spends ~$0.0031:
    // session cumulative ~$0.0061 crosses 0.5 * $0.01 = $0.005. The pre-fix
    // per-run judgment (0.0031 < 0.007 * 0.5) stayed silent.
    const transport = new MockTransport([textReplyEvents('done', TURN_USAGE)]);
    await collect(
      runAgentLoop(
        [{ role: 'user', content: 'go' }],
        makeDeps(transport, hooks),
        makeConfig({
          maxBudgetUsd: 0.007,
          budgetCostBaselineUsd: 0.003,
          budgetThresholdRatio: 0.5,
        }),
      ),
    );
    const thresholds = hooks.events.filter((e) => e.event === 'budget:threshold');
    expect(thresholds).toHaveLength(1);
    const input = thresholds[0]?.input as BudgetThresholdHookInput;
    // The payload reports SESSION figures: original cap and true cumulative.
    expect(input.max_budget_usd).toBeCloseTo(0.01, 12);
    expect(input.cumulative_cost_usd).toBeGreaterThanOrEqual(0.005);
    expect(input.cumulative_cost_usd).toBeGreaterThan(0.003); // baseline included
  });

  it('a shared budgetEventState keeps the threshold one-shot ACROSS engine runs', async () => {
    const hooks = new BudgetEventRecorder();
    const budgetEventState = { thresholdFired: false, exhaustedFired: false };
    // Two runs of the same session (multi-turn streaming re-enters the loop
    // per turn); both cross the threshold on their own. Pre-fix the per-run
    // latch reset each turn and the "one-shot" event fired once per TURN.
    for (let turn = 0; turn < 2; turn += 1) {
      const transport = new MockTransport([textReplyEvents('done', TURN_USAGE)]);
      await collect(
        runAgentLoop(
          [{ role: 'user', content: 'go' }],
          makeDeps(transport, hooks),
          makeConfig({
            maxBudgetUsd: 1.0,
            budgetThresholdRatio: 0.001,
            budgetEventState,
          }),
        ),
      );
    }
    expect(
      hooks.events.filter((e) => e.event === 'budget:threshold'),
    ).toHaveLength(1);
    expect(budgetEventState.thresholdFired).toBe(true);
  });

  it('budget:exhausted reports session figures too (baseline + original cap)', async () => {
    const hooks = new BudgetEventRecorder();
    // Re-armed remainder is tiny; the baseline carries the earlier spend.
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }, TURN_USAGE),
      textReplyEvents('never reached'),
    ]);
    await collect(
      runAgentLoop(
        [{ role: 'user', content: 'go' }],
        makeDeps(transport, hooks),
        makeConfig({ maxBudgetUsd: 0.000001, budgetCostBaselineUsd: 0.5 }),
      ),
    );
    const exhausted = hooks.events.filter((e) => e.event === 'budget:exhausted');
    expect(exhausted).toHaveLength(1);
    const input = exhausted[0]?.input as BudgetExhaustedHookInput;
    expect(input.report.max_budget_usd).toBeCloseTo(0.500001, 12);
    expect(input.report.cumulative_cost_usd).toBeGreaterThan(0.5);
  });
});
