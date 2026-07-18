/**
 * Audit r4 — cluster "sandbox-async" regressions.
 *
 * Only ONE of the cluster's four ids is a live, owned-file defect in the
 * 0.67.1 tree; the other three point at code the 0.65.3->0.67.1 refactor moved
 * out of the owned files (documented in the run's `skipped` list), so they have
 * no test here per the audit's honesty rule (no test for a non-fix):
 *
 *   Sq-3 [FIXED]  internal/async.ts — AsyncQueue.next() drained buffered items
 *                 BEFORE checking failure, so a between-turns abort (fail())
 *                 with a message still buffered resurrected it as an orphaned
 *                 user turn. next() now throws the failure first; a graceful
 *                 close() (failure===null) still drains its buffer.
 *   U8-1 [skip]   sandbox/bwrap.ts   — symlink writable-root needs realpath
 *                 (I/O); wrap() is a pure argv assembler -> upstream fix.
 *   U8-3 [skip]   internal/process-kill.ts — now a pure planner; the executors
 *                 signal the process GROUP, reaching grace-window grandchildren.
 *   U8-4 [skip]   internal/async.ts — CompletionQueue was removed; AsyncQueue's
 *                 push() returns false (observable), not a silent drop.
 */

import { describe, expect, it } from 'vitest';

import { AsyncQueue } from '../src/internal/async.js';

// A distinct error type so the assertions prove the ORIGINAL failure reason is
// what surfaces (never a swallowed/relabelled one) — no `new Error(...)`.
class AbortLike extends Error {
  constructor() {
    super('The query was aborted');
    this.name = 'AbortError';
  }
}

describe('audit r4 Sq-3 — AsyncQueue.next() surfaces fail() before buffered items', () => {
  it('a fail() after a message is buffered throws instead of serving the orphaned turn', async () => {
    const q = new AsyncQueue<string>();
    // A turn arrives, then the query is aborted between turns before it is read.
    expect(q.push('buffered-turn')).toBe(true);
    const reason = new AbortLike();
    q.fail(reason);
    // Pre-fix this handed back { done:false, value:'buffered-turn' } — an
    // orphaned user turn processed AFTER the abort. It must now throw the abort.
    await expect(q.next()).rejects.toBe(reason);
  });

  it('every subsequent next() keeps throwing the failure (buffer is never revived)', async () => {
    const q = new AsyncQueue<string>();
    q.push('one');
    q.push('two');
    const reason = new AbortLike();
    q.fail(reason);
    await expect(q.next()).rejects.toBe(reason);
    await expect(q.next()).rejects.toBe(reason);
  });

  it('a graceful close() still drains buffered items, then reports done (no regression)', async () => {
    const q = new AsyncQueue<string>();
    q.push('a');
    q.push('b');
    // close() leaves failure===null, so the buffer must still drain in order.
    q.close();
    expect(await q.next()).toEqual({ done: false, value: 'a' });
    expect(await q.next()).toEqual({ done: false, value: 'b' });
    expect(await q.next()).toEqual({ done: true, value: undefined });
  });

  it('a buffered undefined is still delivered on a non-failed queue (P3 stays fixed)', async () => {
    const q = new AsyncQueue<string | undefined>();
    q.push(undefined);
    q.close();
    expect(await q.next()).toEqual({ done: false, value: undefined });
    expect(await q.next()).toEqual({ done: true, value: undefined });
  });

  it('a pending waiter is rejected with the failure when fail() lands while it awaits', async () => {
    const q = new AsyncQueue<string>();
    const pending = q.next(); // no items yet -> parks as a waiter
    const reason = new AbortLike();
    q.fail(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
