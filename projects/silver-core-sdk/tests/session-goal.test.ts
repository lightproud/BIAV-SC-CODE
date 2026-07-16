/**
 * /goal session-goal primitive (BPT-EXTENSION, src/hooks/session-goal.ts) —
 * parser grammar, goal manager lifecycle, and the Stop matcher's verdict
 * handling with its deliberately INVERTED failure direction (an unverified
 * evaluation allows the stop; only an affirmative "not met" blocks).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createSessionGoal,
  parseGoalCommand,
  ConfigurationError,
  GOAL_SLASH_COMMAND,
  type SessionGoalEvent,
  type StopHookInput,
} from '../src/index.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

const tmp = mkdtempSync(join(tmpdir(), 'session-goal-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function transcriptFile(content: string): string {
  const p = join(tmp, `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(p, content);
  return p;
}

function stopInput(transcriptPath?: string): StopHookInput {
  return {
    session_id: 's1',
    cwd: '/tmp',
    hook_event_name: 'Stop',
    stop_hook_active: false,
    ...(transcriptPath !== undefined ? { transcript_path: transcriptPath } : {}),
  } as StopHookInput;
}

async function fireStop(
  goal: ReturnType<typeof createSessionGoal>,
  input: StopHookInput,
  signal: AbortSignal = new AbortController().signal,
) {
  const matchers = goal.hooks().Stop;
  expect(matchers).toHaveLength(1);
  const callback = matchers![0]!.hooks[0]!;
  return await callback(input, undefined, { signal });
}

describe('parseGoalCommand', () => {
  it('returns null for anything that is not a /goal invocation', () => {
    expect(parseGoalCommand('hello')).toBeNull();
    expect(parseGoalCommand('/goals are great')).toBeNull();
    expect(parseGoalCommand('/Goal x')).toBeNull();
    expect(parseGoalCommand('say /goal x')).toBeNull();
  });

  it('parses set and clear actions', () => {
    expect(parseGoalCommand('/goal 也给实现了吧')).toEqual({
      ok: true,
      action: { kind: 'set', condition: '也给实现了吧' },
    });
    expect(parseGoalCommand('/goal clear')).toEqual({ ok: true, action: { kind: 'clear' } });
    expect(parseGoalCommand('/goal clear the build cache')).toEqual({
      ok: true,
      action: { kind: 'set', condition: 'clear the build cache' },
    });
  });

  it('preserves multiline conditions', () => {
    const parsed = parseGoalCommand('/goal all tests green\nand docs updated');
    expect(parsed).toEqual({
      ok: true,
      action: { kind: 'set', condition: 'all tests green\nand docs updated' },
    });
  });

  it('rejects a bare /goal, loudly', () => {
    const parsed = parseGoalCommand('/goal');
    expect(parsed && !parsed.ok && parsed.error).toMatch(/requires a goal condition/);
  });

  it('exports honest menu metadata without registering an engine built-in', async () => {
    expect(GOAL_SLASH_COMMAND.name).toBe('goal');
    const { BUILTIN_SLASH_COMMANDS } = await import('../src/engine/slash-commands.js');
    expect(BUILTIN_SLASH_COMMANDS.some((c) => c.name === 'goal')).toBe(false);
  });
});

describe('createSessionGoal lifecycle', () => {
  it('validates options and set() input', () => {
    expect(() => createSessionGoal({ maxBlocks: 0 })).toThrow(ConfigurationError);
    expect(() => createSessionGoal({ transcriptTailBytes: 0 })).toThrow(ConfigurationError);
    expect(() => createSessionGoal().set('  ')).toThrow(ConfigurationError);
  });

  it('set / clear round-trip with events', () => {
    const events: SessionGoalEvent[] = [];
    const goal = createSessionGoal({ onEvent: (e) => events.push(e) });
    expect(goal.condition).toBeNull();
    goal.set('CI is green');
    expect(goal.condition).toBe('CI is green');
    goal.clear();
    expect(goal.condition).toBeNull();
    goal.clear(); // no-op, no duplicate event
    expect(events).toEqual([
      { kind: 'set', condition: 'CI is green' },
      { kind: 'cleared', condition: 'CI is green' },
    ]);
  });

  it('handleCommand is the one-call bridge', () => {
    const goal = createSessionGoal();
    expect(goal.handleCommand('ordinary prompt')).toEqual({ handled: false });

    const bad = goal.handleCommand('/goal');
    expect(bad.handled && !bad.ok && bad.error).toMatch(/requires a goal condition/);

    const set = goal.handleCommand('/goal ship it');
    expect(set.handled && set.ok && set.message).toBe('Goal set: ship it');
    expect(goal.condition).toBe('ship it');

    const cleared = goal.handleCommand('/goal clear');
    expect(cleared.handled && cleared.ok && cleared.message).toBe('Goal cleared');
    expect(goal.condition).toBeNull();

    const nothing = goal.handleCommand('/goal clear');
    expect(nothing.handled && nothing.ok && nothing.message).toBe('No active goal to clear');
  });
});

describe('Stop matcher verdicts', () => {
  it('is inert with no armed goal (zero model calls)', async () => {
    const transport = new MockTransport([]);
    const goal = createSessionGoal({ utility: { transport } });
    expect(await fireStop(goal, stopInput(transcriptFile('x')))).toEqual({});
    expect(transport.requests).toHaveLength(0);
  });

  it('blocks the stop on a "not met" verdict and counts blocks', async () => {
    const events: SessionGoalEvent[] = [];
    const transport = new MockTransport([
      textReplyEvents('{"ok":false,"reason":"tests still red"}'),
    ]);
    const goal = createSessionGoal({ utility: { transport }, onEvent: (e) => events.push(e) });
    goal.set('all tests green');
    const out = await fireStop(goal, stopInput(transcriptFile('ran tests: 3 failed')));
    expect(out).toMatchObject({ decision: 'block' });
    expect(out && 'reason' in out ? out.reason : '').toContain('all tests green');
    expect(out && 'reason' in out ? out.reason : '').toContain('tests still red');
    expect(goal.condition).toBe('all tests green'); // stays armed
    expect(goal.blocks).toBe(1);
    expect(events.at(-1)).toMatchObject({ kind: 'blocked', blocks: 1 });
    // The evaluator saw the stop-variant prompt with condition + transcript.
    expect(transport.requests[0]?.system).toContain('stop-condition hook');
    const user = transport.requests[0]?.messages[0]?.content;
    expect(typeof user === 'string' && user.includes('all tests green')).toBe(true);
    expect(typeof user === 'string' && user.includes('ran tests: 3 failed')).toBe(true);
  });

  it('auto-clears and allows the stop on a "met" verdict', async () => {
    const events: SessionGoalEvent[] = [];
    const transport = new MockTransport([
      textReplyEvents('{"ok":true,"reason":"all 24 tests passed"}'),
    ]);
    const goal = createSessionGoal({ utility: { transport }, onEvent: (e) => events.push(e) });
    goal.set('all tests green');
    const out = await fireStop(goal, stopInput(transcriptFile('24 passed')));
    expect(out).not.toMatchObject({ decision: 'block' });
    expect(out && 'systemMessage' in out ? out.systemMessage : '').toContain('goal cleared');
    expect(goal.condition).toBeNull();
    expect(events.at(-1)).toMatchObject({ kind: 'met' });
  });

  it('auto-clears and allows the stop on an "impossible" verdict', async () => {
    const transport = new MockTransport([
      textReplyEvents('{"ok":false,"impossible":true,"reason":"resource does not exist"}'),
    ]);
    const goal = createSessionGoal({ utility: { transport } });
    goal.set('unreachable thing');
    const out = await fireStop(goal, stopInput(transcriptFile('tried everything')));
    expect(out).not.toMatchObject({ decision: 'block' });
    expect(goal.condition).toBeNull();
  });

  it('INVERTED failure direction: evaluator error allows the stop, goal stays armed', async () => {
    const events: SessionGoalEvent[] = [];
    const throwing = {
      apiKeySource: () => 'none' as const,
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<never, void> {
        throw new Error('no credential');
      },
    };
    const goal = createSessionGoal({
      utility: { transport: throwing },
      onEvent: (e) => events.push(e),
    });
    goal.set('CI green');
    const out = await fireStop(goal, stopInput(transcriptFile('x')));
    expect(out).not.toMatchObject({ decision: 'block' });
    expect(out && 'systemMessage' in out ? out.systemMessage : '').toContain('goal stays armed');
    expect(goal.condition).toBe('CI green');
    expect(events.at(-1)).toMatchObject({ kind: 'evaluator_error' });
  });

  it('INVERTED failure direction: unparseable reply allows the stop, goal stays armed', async () => {
    const transport = new MockTransport([textReplyEvents('sure, sounds met to me')]);
    const goal = createSessionGoal({ utility: { transport } });
    goal.set('CI green');
    const out = await fireStop(goal, stopInput(transcriptFile('x')));
    expect(out).not.toMatchObject({ decision: 'block' });
    expect(goal.condition).toBe('CI green');
  });

  it('never judges blind: no transcript context -> allow with evaluator_error', async () => {
    const events: SessionGoalEvent[] = [];
    const transport = new MockTransport([]);
    const goal = createSessionGoal({ utility: { transport }, onEvent: (e) => events.push(e) });
    goal.set('CI green');
    const out = await fireStop(goal, stopInput()); // no transcript_path at all
    expect(out).not.toMatchObject({ decision: 'block' });
    expect(goal.condition).toBe('CI green');
    expect(transport.requests).toHaveLength(0); // evaluator never called
    expect(events.at(-1)).toMatchObject({ kind: 'evaluator_error' });
  });

  it('honors the maxBlocks host-policy cap, keeping the goal armed', async () => {
    const notMet = () => textReplyEvents('{"ok":false,"reason":"still failing"}');
    const transport = new MockTransport([notMet(), notMet(), notMet()]);
    const events: SessionGoalEvent[] = [];
    const goal = createSessionGoal({
      utility: { transport },
      maxBlocks: 2,
      onEvent: (e) => events.push(e),
    });
    goal.set('CI green');
    const input = stopInput(transcriptFile('red'));
    expect(await fireStop(goal, input)).toMatchObject({ decision: 'block' });
    expect(await fireStop(goal, input)).toMatchObject({ decision: 'block' });
    const third = await fireStop(goal, input);
    expect(third).not.toMatchObject({ decision: 'block' });
    expect(third && 'systemMessage' in third ? third.systemMessage : '').toContain('maxBlocks');
    expect(goal.condition).toBe('CI green');
    expect(events.at(-1)).toMatchObject({ kind: 'block_limit', blocks: 2 });
  });

  it('re-arming via set() resets the block counter', async () => {
    const notMet = () => textReplyEvents('{"ok":false,"reason":"nope"}');
    const transport = new MockTransport([notMet(), notMet()]);
    const goal = createSessionGoal({ utility: { transport } });
    goal.set('goal A');
    await fireStop(goal, stopInput(transcriptFile('x')));
    expect(goal.blocks).toBe(1);
    goal.set('goal B');
    expect(goal.blocks).toBe(0);
    await fireStop(goal, stopInput(transcriptFile('x')));
    expect(goal.blocks).toBe(1);
  });

  it('a custom context provider replaces the transcript tail', async () => {
    const transport = new MockTransport([textReplyEvents('{"ok":true,"reason":"done"}')]);
    const goal = createSessionGoal({
      utility: { transport },
      context: () => 'host-assembled summary: everything shipped',
    });
    goal.set('ship it');
    await fireStop(goal, stopInput()); // no transcript_path needed
    const user = transport.requests[0]?.messages[0]?.content;
    expect(typeof user === 'string' && user.includes('host-assembled summary')).toBe(true);
  });

  it('bounds the default transcript read to the tail', async () => {
    const transport = new MockTransport([textReplyEvents('{"ok":false,"reason":"x"}')]);
    const goal = createSessionGoal({ utility: { transport }, transcriptTailBytes: 16 });
    goal.set('g');
    const path = transcriptFile(`${'A'.repeat(100)}TAIL-MARKER`);
    await fireStop(goal, stopInput(path));
    const user = transport.requests[0]?.messages[0]?.content;
    expect(typeof user === 'string' && user.includes('TAIL-MARKER')).toBe(true);
    expect(typeof user === 'string' && user.includes('AAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('rethrows on abort (an abort is not a verdict)', async () => {
    const ctrl = new AbortController();
    const throwing = {
      apiKeySource: () => 'none' as const,
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<never, void> {
        ctrl.abort();
        throw new Error('aborted mid-call');
      },
    };
    const goal = createSessionGoal({ utility: { transport: throwing } });
    goal.set('g');
    await expect(fireStop(goal, stopInput(transcriptFile('x')), ctrl.signal)).rejects.toThrow();
    expect(goal.condition).toBe('g'); // still armed
  });
});
