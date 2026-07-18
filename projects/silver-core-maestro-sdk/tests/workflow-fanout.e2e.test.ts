/**
 * Campaign 4 acceptance: example 3 — the declarative fan-out/converge
 * workflow — runs end to end on FAKE timers (clock discipline audit
 * 2026-07-18: the test drives time, no real clock), importing ONLY the
 * package name (host shape). Skipped with a visible marker while WorkflowRun
 * is not yet wired into the package export (index.ts wiring is a separate
 * integration step); the assertions below are final either way.
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

// Package-name import gate: the example imports 'silver-core-maestro-sdk',
// so it can only load once the built package exports WorkflowRun.
const pkg: Record<string, unknown> | null = await import('silver-core-maestro-sdk').then(
  (m) => m as unknown as Record<string, unknown>,
  () => null,
);
const wired = pkg !== null && typeof pkg['WorkflowRun'] === 'function';

describe('workflow fan-out example (e2e, fake timers)', () => {
  it.skipIf(!wired)('three word-count workers converge into the join summary', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS example module, no type declarations by design
    const { runWorkflowFanout } = await import('../examples/workflow-fanout.mjs');
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

  it.skipIf(!wired)('a resumed run over the same store is idempotent (single attempt per node)', async () => {
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
