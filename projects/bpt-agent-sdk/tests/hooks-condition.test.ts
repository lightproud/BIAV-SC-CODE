/**
 * Hook-condition evaluator + condition-gated matchers — fail-closed parser,
 * runner gating (skip on unmet/errored, zero calls without a condition), and
 * corpus-sync guards holding both reproduced prompts to their archive.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  HOOK_CONDITION_PROVENANCE,
  HOOK_CONDITION_PROVENANCE_TABLE,
  HOOK_CONDITION_SYSTEM,
  HOOK_STOP_CONDITION_PROVENANCE,
  HOOK_STOP_CONDITION_SYSTEM,
  evaluateHookCondition,
  parseHookCondition,
} from '../src/hooks/condition.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import type { HookInput } from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

const INPUT: HookInput = {
  session_id: 's1',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
} as HookInput;

// ---------------------------------------------------------------------------
// parseHookCondition — fails CLOSED
// ---------------------------------------------------------------------------

describe('parseHookCondition (fails CLOSED)', () => {
  it('parses ok:true with reason', () => {
    expect(parseHookCondition('{"ok":true,"reason":"tests are green"}')).toEqual({
      ok: true,
      reason: 'tests are green',
    });
  });
  it('parses ok:false with reason', () => {
    const r = parseHookCondition('{"ok":false,"reason":"no evidence"}');
    expect(r.ok).toBe(false);
    expect(r.impossible).toBeUndefined();
  });
  it('parses the stop-variant impossible escape hatch', () => {
    const r = parseHookCondition('{"ok":false,"impossible":true,"reason":"self-contradictory"}');
    expect(r.ok).toBe(false);
    expect(r.impossible).toBe(true);
  });
  it('ignores impossible on an ok:true verdict', () => {
    const r = parseHookCondition('{"ok":true,"impossible":true,"reason":"met"}');
    expect(r.ok).toBe(true);
    expect(r.impossible).toBeUndefined();
  });
  it('coerces a non-boolean ok (string/number) to NOT met', () => {
    expect(parseHookCondition('{"ok":"true","reason":"x"}').ok).toBe(false);
    expect(parseHookCondition('{"ok":1,"reason":"x"}').ok).toBe(false);
  });
  it('garbled/empty reply -> NOT met', () => {
    expect(parseHookCondition('').ok).toBe(false);
    expect(parseHookCondition('sure, sounds met to me').ok).toBe(false);
  });
  it('missing ok field -> NOT met', () => {
    expect(parseHookCondition('{"reason":"probably fine"}').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateHookCondition — variant selection + fail-closed on errors
// ---------------------------------------------------------------------------

describe('evaluateHookCondition', () => {
  it('uses the base prompt by default and the stop prompt for stop:true', async () => {
    const t1 = new MockTransport([textReplyEvents('{"ok":true,"reason":"met"}')]);
    await evaluateHookCondition({ condition: 'c', context: 'ctx' }, { transport: t1 });
    expect(t1.requests[0]?.system).toBe(HOOK_CONDITION_SYSTEM);

    const t2 = new MockTransport([textReplyEvents('{"ok":false,"reason":"x"}')]);
    await evaluateHookCondition({ condition: 'c', context: 'ctx', stop: true }, { transport: t2 });
    expect(t2.requests[0]?.system).toBe(HOOK_STOP_CONDITION_SYSTEM);
  });
  it('sends condition + context in the user turn at temperature 0', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":true,"reason":"met"}')]);
    await evaluateHookCondition({ condition: 'CI is green', context: 'run #7 passed' }, { transport: t });
    const user = t.requests[0]?.messages[0]?.content;
    expect(typeof user === 'string' && user.includes('CI is green')).toBe(true);
    expect(typeof user === 'string' && user.includes('run #7 passed')).toBe(true);
    expect(t.requests[0]?.temperature).toBe(0);
  });
  it('fails CLOSED (ok:false) when the call itself throws', async () => {
    const throwing = {
      apiKeySource: () => 'none' as const,
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<never, void> {
        throw new Error('no credential');
      },
    };
    const r = await evaluateHookCondition({ condition: 'c', context: 'x' }, { transport: throwing });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no credential');
  });
});

// ---------------------------------------------------------------------------
// Runner gating
// ---------------------------------------------------------------------------

describe('DefaultHookRunner condition gate', () => {
  const signal = () => new AbortController().signal;

  it('runs matchers with no condition with ZERO model calls (deterministic fast path)', async () => {
    const t = new MockTransport([]); // any stream() call would throw "unexpected"
    const cb = vi.fn().mockResolvedValue({});
    const runner = new DefaultHookRunner({
      hooks: { PreToolUse: [{ hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    await runner.run('PreToolUse', INPUT, undefined, 'Bash', signal());
    expect(cb).toHaveBeenCalledTimes(1);
    expect(t.requests).toHaveLength(0);
  });

  it('fires callbacks when the condition is met', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":true,"reason":"met"}')]);
    const cb = vi.fn().mockResolvedValue({});
    const runner = new DefaultHookRunner({
      hooks: { PreToolUse: [{ condition: 'the command is read-only', hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    await runner.run('PreToolUse', INPUT, undefined, 'Bash', signal());
    expect(cb).toHaveBeenCalledTimes(1);
    expect(t.requests).toHaveLength(1);
    // the hook input rides in the evaluator context
    const user = t.requests[0]?.messages[0]?.content;
    expect(typeof user === 'string' && user.includes('"tool_name":"Bash"')).toBe(true);
  });

  it('SKIPS callbacks when the condition is not met (fail-closed direction)', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":false,"reason":"not read-only"}')]);
    const cb = vi.fn();
    const runner = new DefaultHookRunner({
      hooks: { PreToolUse: [{ condition: 'the command is read-only', hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    const agg = await runner.run('PreToolUse', INPUT, undefined, 'Bash', signal());
    expect(cb).not.toHaveBeenCalled();
    expect(agg.decision).toBeUndefined();
  });

  it('SKIPS callbacks when the evaluation errors (no credential etc.)', async () => {
    const throwing = {
      apiKeySource: () => 'none' as const,
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<never, void> {
        throw new Error('boom');
      },
    };
    const cb = vi.fn();
    const runner = new DefaultHookRunner({
      hooks: { PreToolUse: [{ condition: 'x', hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: throwing },
    });
    await runner.run('PreToolUse', INPUT, undefined, 'Bash', signal());
    expect(cb).not.toHaveBeenCalled();
  });

  it('gates matchers independently (unconditioned sibling still fires)', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":false,"reason":"no"}')]);
    const gated = vi.fn();
    const plain = vi.fn().mockResolvedValue({});
    const runner = new DefaultHookRunner({
      hooks: {
        PreToolUse: [
          { condition: 'never true', hooks: [gated] },
          { hooks: [plain] },
        ],
      },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    await runner.run('PreToolUse', INPUT, undefined, 'Bash', signal());
    expect(gated).not.toHaveBeenCalled();
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it('uses the stop variant for Stop events', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":false,"reason":"insufficient evidence in transcript"}')]);
    const cb = vi.fn();
    const stopInput = { session_id: 's1', cwd: '/tmp', hook_event_name: 'Stop' } as HookInput;
    const runner = new DefaultHookRunner({
      hooks: { Stop: [{ condition: 'the tests passed', hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    await runner.run('Stop', stopInput, undefined, undefined, signal());
    expect(t.requests[0]?.system).toBe(HOOK_STOP_CONDITION_SYSTEM);
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Provenance — attribution + translation state
// ---------------------------------------------------------------------------
// The English-archive drift check is RETIRED (2026-07-08): both prompts are
// translated to Chinese (i18n-zh batch B), faithful:false, so it could only
// skip. The CJK structural guard in tests/aux-prompts-i18n-zh.test.ts covers
// reversion; the slug provenance (attribution) is retained on the table entries.

describe('hook-condition prompt provenance (attribution + translation state)', () => {
  it('the provenance table has 2 entries, translated in-place with source slugs retained', () => {
    expect(Object.keys(HOOK_CONDITION_PROVENANCE_TABLE)).toHaveLength(2);
    for (const p of Object.values(HOOK_CONDITION_PROVENANCE_TABLE)) {
      expect(p.faithful).toBe(false); // translated (JSON ok/reason/impossible kept English)
      expect(p.slug.length).toBeGreaterThan(0); // English source (attribution)
    }
  });
});
