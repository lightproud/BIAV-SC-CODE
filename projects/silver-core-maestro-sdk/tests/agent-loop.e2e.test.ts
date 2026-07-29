/**
 * Agent loop example (example 5, design round 3) — e2e on FAKE timers.
 * Proves the "combination IS the loop" wiring on the two packages' public
 * surfaces: RoutineManager triggerNow (manual: id segment) -> LedgerDriver
 * -> createAgentExecutor over an injected stub query -> ledger closeout
 * with the attempt's cost on the query row -> RoutineManager status read
 * the way an inbox duty panel would.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error plain-JS example module (host-shape proof, no d.ts)
import { runAgentLoop, stubAgentQuery } from '../examples/agent-loop.mjs';

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

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

describe('agent loop example (e2e, fake timers)', () => {
  it('triggerNow -> injected agent executor -> costed ledger closeout -> duty status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-loop-e2e-'));
    tempDirs.push(root);

    const { session, queries, status, messages } = await drive(
      runAgentLoop({
        archiveDir: root,
        queryFn: stubAgentQuery({ text: 'patrol digest ready', costUsd: 0.0077 }),
        prompt: 'Summarize the day.',
        pollIntervalMs: 25,
        deadlineMs: 60_000,
      }),
    );

    // Manual fire id segment: manual:, never sched: (footprint separation).
    expect(session.id).toMatch(/^manual:agent-loop:/);
    expect(session.state).toBe('done');

    // The attempt's cost rode ExecutorResult -> OutcomeInput -> query row (D2).
    expect(queries).toHaveLength(1);
    expect(queries[0].outcome).toBe('ok');
    expect(queries[0].costUsd).toBe(0.0077);
    expect(queries[0].summary).toContain('patrol digest ready');
    expect(queries[0].summary).toContain('[cost $0.0077]');

    // Every streamed message crossed the onMessage seam, in order.
    expect(messages.map((m: { type: string }) => m.type)).toEqual([
      'system',
      'task_progress',
      'result',
    ]);

    // The duty-panel read: named routine, manual fire counted as lastFireAt,
    // next SCHEDULED point untouched by the manual fire, last session visible.
    expect(status.spec.name).toBe('Agent duty loop');
    expect(status.enabled).toBe(true);
    expect(status.lastFireAt).toBe(session.createdAt);
    expect(status.lastSession.id).toBe(session.id);
    expect(status.nextFireAt).toBeGreaterThan(status.lastFireAt);
  });
});
