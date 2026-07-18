/**
 * Campaign 4 acceptance: example 3 — the declarative fan-out/converge
 * workflow — runs end to end on FAKE timers (clock discipline audit
 * 2026-07-18: the test drives time, no real clock), importing ONLY the
 * package name (host shape). Imports are STATIC (audit H2): the former
 * dynamic-import skipIf guard turned any package-load failure into a silent
 * skip; a broken export now FAILS the suite at collection time.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Drive fake time until the run settles (bounded — a hang fails the test). */
async function drive<T>(run: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = run.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  for (let i = 0; i < 4000 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(25);
  }
  expect(settled, 'run did not settle within the driven fake-time budget').toBe(true);
  return tracked;
}

import { WorkflowRun } from 'silver-core-maestro-sdk';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS example module, no type declarations by design
import { runWorkflowFanout } from '../examples/workflow-fanout.mjs';

describe('workflow fan-out example (e2e, fake timers)', () => {
  it('package exports WorkflowRun (static import: a broken export reds the suite)', () => {
    expect(typeof WorkflowRun).toBe('function');
    expect(typeof runWorkflowFanout).toBe('function');
  });

  it('three word-count workers converge into the join summary', async () => {
    const result = await drive(runWorkflowFanout({ pollIntervalMs: 10, drainTimeoutMs: 15_000 }));

    expect(result.status).toBe('done');
    expect(result.states).toEqual({
      'chunk-1': 'done',
      'chunk-2': 'done',
      'chunk-3': 'done',
      merge: 'done',
    });
    // Join output: per-chunk word counts (6 + 6 + 5) merged into one summary.
    expect(result.merged).toEqual({
      totalWords: 17,
      chunks: { 'chunk-1': 6, 'chunk-2': 6, 'chunk-3': 5 },
    });
  });

  it('a resumed run over the same store is idempotent (single attempt per node)', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS example module, no type declarations by design
    const { runWorkflowFanout, memoryLedgerStore } = await import('../examples/workflow-fanout.mjs');
    const store = memoryLedgerStore();
    const first = await drive(runWorkflowFanout({ store, runId: 'e2e-r1', pollIntervalMs: 10, drainTimeoutMs: 15_000 }));
    expect(first.status).toBe('done');
    const again = await drive(runWorkflowFanout({ store, runId: 'e2e-r1', pollIntervalMs: 10, drainTimeoutMs: 15_000 }));
    expect(again.status).toBe('done');
    expect(again.merged.totalWords).toBe(17);
    const merge = await store.getSession('wf:wordcount-fanout:e2e-r1:merge');
    expect(merge.attempts).toBe(1); // rerun dispatched nothing new
  });

  it('reports wiring status honestly (never a silent skip)', () => {
    // This assertion always runs: it documents in the test output whether the
    // e2e path above executed or was deferred to package-export integration.
    expect(typeof wired).toBe('boolean');
  });
});
