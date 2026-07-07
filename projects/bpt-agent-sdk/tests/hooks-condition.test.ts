/**
 * Hook-condition evaluator + condition-gated matchers — fail-closed parser,
 * runner gating (skip on unmet/errored, zero calls without a condition), and
 * corpus-sync guards holding both reproduced prompts to their archive.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// Corpus-sync guard
// ---------------------------------------------------------------------------

describe('hook-condition prompt provenance (corpus-sync guard, Track B parity)', () => {
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

  it('the provenance table has 2 entries, now translated (faithful:false)', () => {
    expect(Object.keys(HOOK_CONDITION_PROVENANCE_TABLE)).toHaveLength(2);
    // i18n-zh Phase 2 batch B: both prompts translated to Chinese (JSON contract
    // — ok/reason/impossible keys + booleans — kept English), so faithful:false.
    for (const p of Object.values(HOOK_CONDITION_PROVENANCE_TABLE)) {
      expect(p.faithful).toBe(false);
    }
  });

  const faces = [
    { text: HOOK_CONDITION_SYSTEM, prov: HOOK_CONDITION_PROVENANCE },
    { text: HOOK_STOP_CONDITION_SYSTEM, prov: HOOK_STOP_CONDITION_PROVENANCE },
  ];
  for (const { text, prov } of faces) {
    // Translated (faithful:false): Chinese prose can't anchor-match the English archive.
    it.runIf(existsSync(archive) && prov.faithful)(`${prov.slug} is faithful to its archived source`, () => {
      const body = norm(stripHeader(readFileSync(join(archive, `${prov.slug}.md`), 'utf8')));
      const drifted = norm(text)
        .split(/(?<=[.:])\s+/)
        .map(norm)
        .filter((s) => s.length >= 40)
        .filter((s) => !body.includes(s.slice(0, 60)));
      expect(drifted, `not found in archive:\n${drifted.join('\n')}`).toEqual([]);
    });
  }
});
