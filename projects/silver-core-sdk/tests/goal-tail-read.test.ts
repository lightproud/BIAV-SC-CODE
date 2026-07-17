/**
 * Audit 2026-07-17 batch A: L32 — the goal evaluator's transcript-tail read
 * must honor readSync's ACTUAL byte count.
 *
 * readFileTail allocates a zero-filled buffer of `min(size, maxBytes)` and
 * seeks to `size - want`. When the read comes back short (the file shrank
 * between fstat and read, or the OS returned fewer bytes), decoding the whole
 * buffer surfaces the zero-fill: the evaluator's context ends in a run of
 * NUL characters. The fix decodes only the bytes actually read.
 *
 * node:fs is mocked so the short read is deterministic — no real file can be
 * made to shrink reliably between two syscalls in a unit test.
 */

import { describe, expect, it, vi } from 'vitest';

const REPORTED_SIZE = 100;
const ACTUAL_TAIL = 'tail-data';

vi.mock('node:fs', () => ({
  openSync: vi.fn(() => 7),
  closeSync: vi.fn(),
  // fstat reports a size larger than what the read will deliver.
  fstatSync: vi.fn(() => ({ size: REPORTED_SIZE })),
  // Short read: fills only the first bytes, returns the true count.
  readSync: vi.fn(
    (_fd: number, buf: Buffer, offset: number): number =>
      buf.write(ACTUAL_TAIL, offset, 'utf8'),
  ),
}));

import { createGoalStopHooks } from '../src/hooks/goal.js';
import type { GoalEvaluationContext, StopHookInput } from '../src/types.js';

function stopInput(): StopHookInput {
  return {
    session_id: 'sess-goal-tail',
    transcript_path: '/tmp/fake-transcript.jsonl',
    cwd: '/tmp',
    hook_event_name: 'Stop',
    stop_hook_active: false,
  };
}

describe('goal transcript tail read honors the actual byte count (L32)', () => {
  it('a short read yields the read bytes only — no trailing NUL padding', async () => {
    let seen: GoalEvaluationContext | undefined;
    const matchers = createGoalStopHooks({
      goal: 'finish the work',
      evaluator: async (input) => {
        seen = input;
        return { status: 'achieved' };
      },
    });
    const onStop = matchers.Stop![0]!.hooks[0]!;
    await onStop(stopInput(), undefined, { signal: new AbortController().signal });

    expect(seen).toBeDefined();
    const context = seen!.context;
    // The genuine tail content came through...
    expect(context).toContain(ACTUAL_TAIL);
    // ...and the buffer's zero-fill did NOT (before the fix the context
    // carried `REPORTED_SIZE - ACTUAL_TAIL.length` trailing NULs).
    expect(context).not.toContain('\u0000');
    expect(context.endsWith(ACTUAL_TAIL)).toBe(true);
  });
});
