/**
 * Audit wave 20 — hooks: the legacy `decision` field had no unrecognized-value
 * guard, while its modern counterpart does.
 *
 * `hookSpecificOutput.permissionDecision` is deliberately widened to `string`
 * in the aggregator so a bad runtime value fails CLOSED as a deny. The legacy
 * `decision` field is typed `'approve' | 'block'` and got no such guard: any
 * other value fell through as NEUTRAL. The dangerous case is the most natural
 * spelling there is — every other decision vocabulary in this SDK says 'deny',
 * so a host reaching for the legacy field writes `{decision: 'deny'}` and its
 * security hook is silently discarded while the tool runs.
 */

import { describe, expect, it } from 'vitest';

import { DefaultHookRunner } from '../src/hooks/runner.js';
import type { HookInput, HookJSONOutput } from '../src/types.js';

const INPUT = {
  session_id: 's',
  transcript_path: '',
  cwd: '',
  hook_event_name: 'PreToolUse',
} as unknown as HookInput;

/** Aggregate one PreToolUse hook output. `out` is deliberately untyped: the
 *  point is a runtime value the declared union does not admit. */
async function aggregateOne(out: unknown, debug: (m: string) => void = () => {}) {
  const runner = new DefaultHookRunner({
    hooks: { PreToolUse: [{ hooks: [async () => out as HookJSONOutput] }] },
    debug,
  });
  return runner.run('PreToolUse', INPUT, 'toolu_1', 'Bash', new AbortController().signal);
}

describe('wave20: legacy hook decision field fails closed', () => {
  it("{decision:'deny'} denies instead of being silently neutral", async () => {
    const lines: string[] = [];
    const agg = await aggregateOne({ decision: 'deny', reason: 'policy' }, (m) => lines.push(m));
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toBe('policy');
    expect(lines.some((l) => l.includes('unrecognized legacy decision'))).toBe(true);
  });

  it('an unrecognized value with no reason still denies, and names itself', async () => {
    const agg = await aggregateOne({ decision: 'Block' }); // wrong case
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toContain('Block');
  });

  it('an unrecognized legacy value outranks an explicit allow on the same output', async () => {
    // Same posture as the existing legacy-'block' branch: the contradictory
    // output must not resolve to the permissive reading.
    const agg = await aggregateOne({
      decision: 'yes-please',
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
    expect(agg.decision).toBe('deny');
  });

  // --- negative controls: the two documented legacy values are unchanged -----

  it("'block' still denies with its reason", async () => {
    const agg = await aggregateOne({ decision: 'block', reason: 'nope' });
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toBe('nope');
  });

  it("'approve' still allows", async () => {
    const agg = await aggregateOne({ decision: 'approve', reason: 'fine' });
    expect(agg.decision).toBe('allow');
    expect(agg.decisionReason).toBe('fine');
  });

  it("'approve' still yields to an explicit permissionDecision on the same output", async () => {
    const agg = await aggregateOne({
      decision: 'approve',
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    });
    expect(agg.decision).toBe('ask');
  });

  it('an output with no decision at all stays neutral', async () => {
    const agg = await aggregateOne({ systemMessage: 'fyi' });
    expect(agg.decision).toBeUndefined();
    expect(agg.systemMessages).toEqual(['fyi']);
  });

  it('an empty-string decision stays neutral (absent, not garbage)', async () => {
    const agg = await aggregateOne({ decision: '' });
    expect(agg.decision).toBeUndefined();
  });
});
