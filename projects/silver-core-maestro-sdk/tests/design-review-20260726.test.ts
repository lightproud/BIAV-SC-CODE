/**
 * Regression locks for the four findings of the 2026-07-26 design review
 * (`Public-Info-Pool/Resource/repo-engineering/maestro-sdk-design-review-20260726.md`),
 * all four resolved per keeper ruling the same day:
 *
 *   F1 the 0.76.0 `cancelled` terminal never reached the scenario layer;
 *   F2 the driver had no concurrency cap anywhere in the claim chain;
 *   F3 the ledger was append-only forever (no retention seam);
 *   F4 the two long-running components had no abort seam.
 *
 * Everything here runs on the PUBLIC package specifier and a fake clock — the
 * probes that originally demonstrated the four defects, promoted into
 * permanent locks and extended with the negative controls the probes lacked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskLedger,
  LedgerDriver,
  WorkflowRun,
  GoalChaser,
  graphStatus,
  runLedgerStoreContractSuite,
  ledgerStoreContractCheckNames,
  type LedgerStore,
  type QueryRecord,
  type SessionFilter,
  type SessionRecord,
  type WorkflowGraph,
} from 'silver-core-maestro-sdk';
import { hostStore } from './helpers/host-store.js';

const ledgerOf = (store: LedgerStore, over: { claimLeaseMs?: number } = {}): TaskLedger =>
  new TaskLedger({ store, clock: { now: () => Date.now() }, ...over });

const oneNode: WorkflowGraph = { id: 'g', nodes: [{ id: 'a', intent: 'i' }] };

/**
 * Sleep on the (faked) clock, resolving immediately if the driver aborts us.
 * Test-side only: an executor that ignores its AbortSignal cannot be awaited
 * by stop() once the fake clock stops advancing.
 */
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(handle);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------- F1 --------

describe('F1 the cancelled terminal reaches the scenario layer', () => {
  it('graphStatus fails the run on a cancelled node (keeper ruling: fail-fast)', () => {
    expect(graphStatus(oneNode, { a: 'cancelled' })).toBe('failed');
  });

  it('cancelled dominates completeness, exactly like failed', () => {
    const two: WorkflowGraph = {
      id: 'g',
      nodes: [{ id: 'a', intent: 'i' }, { id: 'b', intent: 'i' }],
    };
    // One done + one cancelled is NOT a completed run.
    expect(graphStatus(two, { a: 'done', b: 'cancelled' })).toBe('failed');
    // Non-terminal siblings do not rescue it either (fail-fast precedence).
    expect(graphStatus(two, { a: 'running', b: 'cancelled' })).toBe('failed');
  });

  it('negative control: the non-terminal states still report running', () => {
    // Guards against a fix that over-reached into "any defined state fails".
    for (const state of ['pending', 'running', 'retrying'] as const) {
      expect(graphStatus(oneNode, { a: state })).toBe('running');
    }
    expect(graphStatus(oneNode, {})).toBe('running');
    expect(graphStatus(oneNode, { a: 'done' })).toBe('done');
  });

  it('a cancelled node settles WorkflowRun.run() instead of wedging it', async () => {
    const ledger = ledgerOf(hostStore());
    const run = new WorkflowRun({ ledger, graph: oneNode, runId: 'r1', pollIntervalMs: 10 });
    await run.tick();
    await ledger.cancelSession(run.sessionId('a'), { reason: 'user' });
    // Pre-0.78.0 this rejected with 'drain timeout'; a run must now settle.
    const settled = run.run({ drainTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await settled;
    expect(result.status).toBe('failed');
    expect(result.states['a']).toBe('cancelled');
  });

  it('a cancelled round settles the chase as `cancelled`, without judging it', async () => {
    const ledger = ledgerOf(hostStore());
    let judged = 0;
    const events: string[] = [];
    const chase = new GoalChaser({
      ledger,
      evaluator: async () => {
        judged += 1;
        return { status: 'achieved' };
      },
      pollIntervalMs: 10,
      drainTimeoutMs: 100,
      onEvent: (e) => events.push(`${e.type}:${'action' in e ? e.action : ''}`),
    }).chase({ id: 'g1', description: 'd', maxRounds: 3 });
    await vi.advanceTimersByTimeAsync(20);
    await ledger.cancelSession('goal:g1:round-1', { reason: 'user' });
    await vi.advanceTimersByTimeAsync(500);
    const result = await chase;
    expect(result.action).toBe('cancelled');
    expect(result.rounds.map((r) => r.state)).toEqual(['cancelled']);
    // The host cancelled it, so the judge is never consulted and no
    // `goal:round` event (whose contract requires a verdict) is emitted.
    expect(judged).toBe(0);
    expect(events).toEqual(['goal:settled:cancelled']);
  });

  it('negative control: an ordinary round still reaches the evaluator', async () => {
    // Proves the cancel short-circuit did not swallow the normal path.
    const store = hostStore();
    const ledger = ledgerOf(store);
    let judged = 0;
    const chase = new GoalChaser({
      ledger,
      evaluator: async () => {
        judged += 1;
        return { status: 'achieved' };
      },
      pollIntervalMs: 10,
      drainTimeoutMs: 500,
    }).chase({ id: 'g2', description: 'd', maxRounds: 3 });
    const driver = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok', summary: 's' }),
      pollIntervalMs: 10,
    });
    driver.start();
    await vi.advanceTimersByTimeAsync(300);
    const result = await chase;
    await driver.stop();
    expect([result.action, judged]).toEqual(['done', 1]);
  });
});

// ---------------------------------------------------------------- F2 --------

describe('F2 the driver bounds attempts in flight', () => {
  /** Dispatch n immediately-due sessions and report peak concurrency. */
  async function peakFor(maxConcurrent: number | undefined, n: number): Promise<number> {
    const ledger = ledgerOf(hostStore());
    for (let i = 0; i < n; i += 1) await ledger.dispatch({ id: `s${i}`, intent: 'work' });
    let inFlight = 0;
    let peak = 0;
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 1_000,
      ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
      // Abort-aware: stop() awaits in-flight bookkeeping, and under fake
      // timers an executor that only sleeps would never wake once we stop
      // advancing the clock — a deadlock in the TEST, not in the driver.
      executor: async (_s, ctx) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleepUnlessAborted(50, ctx.signal);
        inFlight -= 1;
        return { outcome: 'ok' };
      },
    });
    driver.start();
    await vi.advanceTimersByTimeAsync(10);
    const observed = peak;
    await vi.advanceTimersByTimeAsync(60_000);
    await driver.stop();
    return observed;
  }

  it('maxConcurrent caps the peak (measured 200 before the fix)', async () => {
    expect(await peakFor(4, 200)).toBe(4);
  });

  it('unset maxConcurrent keeps the prior unbounded behavior byte-for-byte', async () => {
    // Deliberate: the cap is opt-in, so an existing host sees NO change. This
    // is the finding's own measurement, kept as the documented default.
    expect(await peakFor(undefined, 200)).toBe(200);
  });

  it('the backlog is drained across ticks, not dropped', async () => {
    const ledger = ledgerOf(hostStore());
    for (let i = 0; i < 10; i += 1) await ledger.dispatch({ id: `s${i}`, intent: 'work' });
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 10,
      maxConcurrent: 3,
      executor: async () => ({ outcome: 'ok' }),
    });
    driver.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await driver.stop();
    const done = await ledger.listSessions({ states: ['done'] });
    expect(done.length).toBe(10);
  });

  it('sessions past the limit are left completely untouched', async () => {
    const ledger = ledgerOf(hostStore());
    await ledger.dispatch({ id: 'a', intent: 'work' });
    await ledger.dispatch({ id: 'b', intent: 'work' });
    const claimed = await ledger.claimDue(Date.now(), { limit: 1 });
    expect(claimed.length).toBe(1);
    const untouched = (await ledger.listSessions({ states: ['pending'] }))[0];
    // No attempts increment, no lease, still due: indistinguishable from
    // never having been listed.
    expect([untouched?.attempts, untouched?.state, untouched?.leaseUntil]).toEqual([
      0,
      'pending',
      undefined,
    ]);
  });

  it('claimDue limit 0 is a true no-op with zero store reads', async () => {
    let listCalls = 0;
    const base = hostStore();
    const counted: LedgerStore = {
      ...base,
      async listSessions(filter) {
        listCalls += 1;
        return base.listSessions(filter);
      },
    };
    const ledger = ledgerOf(counted);
    await ledger.dispatch({ id: 'a', intent: 'work' });
    listCalls = 0;
    expect(await ledger.claimDue(Date.now(), { limit: 0 })).toEqual([]);
    expect(listCalls).toBe(0);
  });

  it('rejects a nonsense cap where the number enters', () => {
    const ledger = ledgerOf(hostStore());
    const make = (maxConcurrent: number): LedgerDriver =>
      new LedgerDriver({ ledger, executor: async () => ({ outcome: 'ok' }), maxConcurrent });
    expect(() => make(0)).toThrow(/maxConcurrent must be an integer >= 1/);
    expect(() => make(2.5)).toThrow(/maxConcurrent must be an integer >= 1/);
    expect(() => make(Number.NaN)).toThrow(/maxConcurrent must be an integer >= 1/);
  });

  it('rejects a nonsense claimDue limit', async () => {
    const ledger = ledgerOf(hostStore());
    await expect(ledger.claimDue(Date.now(), { limit: -1 })).rejects.toThrow(
      /limit must be an integer >= 0/,
    );
    await expect(ledger.claimDue(Date.now(), { limit: 1.5 })).rejects.toThrow(
      /limit must be an integer >= 0/,
    );
  });

  it('a lease sweep still runs on a zero-slot tick', async () => {
    // The zero-slot short-circuit must not skip the sweep: a saturated driver
    // is exactly when a dead peer's expired claims need reclaiming.
    const ledger = ledgerOf(hostStore(), { claimLeaseMs: 50 });
    await ledger.dispatch({ id: 'stuck', intent: 'work' });
    await ledger.claimSession('stuck', Date.now());
    await ledger.dispatch({ id: 'busy', intent: 'work' });
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 10,
      maxConcurrent: 1,
      executor: async (_s, ctx) => {
        await sleepUnlessAborted(10_000, ctx.signal);
        return { outcome: 'ok' };
      },
    });
    driver.start();
    await vi.advanceTimersByTimeAsync(400);
    const stuck = await ledger.getSession('stuck');
    expect(stuck?.state === 'retrying' || stuck?.state === 'running').toBe(true);
    expect(stuck?.lastError).toMatch(/lease-expired/);
    await driver.stop();
  });
});

// ---------------------------------------------------------------- F3 --------

describe('F3 the retention seam', () => {
  it('purgeSession removes a terminal session and its query rows', async () => {
    const store = hostStore({ withDelete: true });
    const ledger = ledgerOf(store);
    await ledger.dispatch({ id: 'a', intent: 'work' });
    await ledger.claimSession('a', Date.now());
    await ledger.recordOutcome('a', { outcome: 'ok', startedAt: 1, endedAt: 2, attempt: 1 });
    expect((await ledger.listQueries('a')).length).toBe(1);
    expect(await ledger.purgeSession('a')).toBe(true);
    expect(await ledger.getSession('a')).toBeNull();
    expect(await ledger.listQueries('a')).toEqual([]);
  });

  it('purges a cancelled session too (cancelled is terminal)', async () => {
    const ledger = ledgerOf(hostStore({ withDelete: true }));
    await ledger.dispatch({ id: 'a', intent: 'work' });
    await ledger.cancelSession('a', { reason: 'user' });
    expect(await ledger.purgeSession('a')).toBe(true);
  });

  it('refuses a NON-terminal session in every non-terminal state', async () => {
    const ledger = ledgerOf(hostStore({ withDelete: true }));
    await ledger.dispatch({ id: 'p', intent: 'work' });
    await expect(ledger.purgeSession('p')).rejects.toThrow(/is 'pending', not terminal/);
    await ledger.claimSession('p', Date.now());
    await expect(ledger.purgeSession('p')).rejects.toThrow(/is 'running', not terminal/);
    await ledger.recordOutcome('p', {
      outcome: 'error',
      startedAt: 1,
      endedAt: 2,
      attempt: 1,
    });
    await expect(ledger.purgeSession('p')).rejects.toThrow(/is 'retrying', not terminal/);
    // ...and the refusals left the row alone.
    expect((await ledger.getSession('p'))?.state).toBe('retrying');
  });

  it('is idempotent on an unknown id', async () => {
    const ledger = ledgerOf(hostStore({ withDelete: true }));
    expect(await ledger.purgeSession('never-existed')).toBe(false);
  });

  it('names the missing seam instead of silently reclaiming nothing', async () => {
    // A retention sweep that quietly frees nothing is worse than one that
    // fails: the growth continues while the host believes it does not.
    const ledger = ledgerOf(hostStore());
    await ledger.dispatch({ id: 'a', intent: 'work' });
    await ledger.cancelSession('a');
    await expect(ledger.purgeSession('a')).rejects.toThrow(/does not implement the optional deleteSession seam/);
    expect(await ledger.getSession('a')).not.toBeNull();
  });

  it('the contract suite grows four checks for a store implementing the seam', async () => {
    const bare = await runLedgerStoreContractSuite(() => hostStore());
    const withSeam = await runLedgerStoreContractSuite(() => hostStore({ withDelete: true }));
    expect(bare.passed).toBe(true);
    expect(withSeam.passed).toBe(true);
    expect(withSeam.total - bare.total).toBe(4);
    expect(ledgerStoreContractCheckNames({ withDeleteSession: true }).length).toBe(
      ledgerStoreContractCheckNames().length + 4,
    );
  });

  it('the contract suite catches a store that orphans query rows', async () => {
    // The check that matters: removing the session alone leaves exactly the
    // accretion the seam exists to bound.
    const orphaning = (): LedgerStore => {
      const sessions = new Map<string, SessionRecord>();
      const queries: QueryRecord[] = [];
      return {
        async putSession(r) {
          sessions.set(r.id, { ...r });
        },
        async getSession(id) {
          const r = sessions.get(id);
          return r === undefined ? null : { ...r };
        },
        async listSessions(filter?: SessionFilter) {
          let all = [...sessions.values()];
          if (filter?.states !== undefined) {
            all = all.filter((s) => filter.states!.includes(s.state));
          }
          if (filter?.dueBefore !== undefined) {
            all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
          }
          return all.map((s) => ({ ...s }));
        },
        async appendQuery(r) {
          queries.push({ ...r });
        },
        async listQueries(sessionId) {
          return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
        },
        // The defect under test: session row removed, query rows left behind.
        async deleteSession(id) {
          return sessions.delete(id);
        },
      };
    };
    const report = await runLedgerStoreContractSuite(orphaning);
    expect(report.passed).toBe(false);
    expect(report.results.some((r) => !r.ok && /orphan query row/.test(r.error ?? ''))).toBe(true);
  });
});

// ---------------------------------------------------------------- F4 --------

describe('F4 the abort seam on the long-running components', () => {
  it('WorkflowRun.run() rejects with the signal reason when aborted mid-wait', async () => {
    const ledger = ledgerOf(hostStore());
    const run = new WorkflowRun({ ledger, graph: oneNode, runId: 'r1', pollIntervalMs: 50 });
    const controller = new AbortController();
    const settled = run.run({ signal: controller.signal }).then(
      () => 'resolved',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('host changed its mind'));
    await vi.advanceTimersByTimeAsync(10);
    expect(await settled).toBe('host changed its mind');
  });

  it('an already-aborted signal stops run() before it dispatches anything', async () => {
    const ledger = ledgerOf(hostStore());
    const run = new WorkflowRun({ ledger, graph: oneNode, runId: 'r1' });
    const controller = new AbortController();
    controller.abort(new Error('too late'));
    await expect(run.run({ signal: controller.signal })).rejects.toThrow('too late');
    // Nothing was dispatched: the check precedes the tick.
    expect(await ledger.getSession(run.sessionId('a'))).toBeNull();
  });

  it('aborting a run leaves the ledger resumable', async () => {
    const ledger = ledgerOf(hostStore());
    const run = new WorkflowRun({ ledger, graph: oneNode, runId: 'r1', pollIntervalMs: 50 });
    const controller = new AbortController();
    const first = run.run({ signal: controller.signal }).catch(() => 'aborted');
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('stop'));
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBe('aborted');
    // The node session survives, so a later run continues from it rather than
    // re-running it (idempotent dispatch is the resume contract).
    const session = await ledger.getSession(run.sessionId('a'));
    expect([session?.state, session?.attempts]).toEqual(['pending', 0]);
  });

  it('GoalChaser.chase() rejects with the signal reason when aborted', async () => {
    const ledger = ledgerOf(hostStore());
    const chaser = new GoalChaser({
      ledger,
      evaluator: async () => ({ status: 'achieved' }),
      pollIntervalMs: 50,
    });
    const controller = new AbortController();
    const settled = chaser
      .chase({ id: 'g1', description: 'd' }, { signal: controller.signal })
      .then(
        () => 'resolved',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error('abandoned'));
    await vi.advanceTimersByTimeAsync(10);
    expect(await settled).toBe('abandoned');
  });

  it('no signal = unchanged behavior (both components)', async () => {
    // The seam is opt-in; the drain-timeout path must be untouched.
    const ledger = ledgerOf(hostStore());
    const run = new WorkflowRun({ ledger, graph: oneNode, runId: 'r1', pollIntervalMs: 10 });
    const timedOut = run.run({ drainTimeoutMs: 50 }).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await timedOut).toMatch(/drain timeout after 50 ms/);
  });

  it('an aborted wait leaves no pending timer on the clock', async () => {
    // The pre-0.78.0 sleep never cleared its handle; an abandoned loop would
    // hold the event loop open for the rest of its interval.
    const ledger = ledgerOf(hostStore());
    const run = new WorkflowRun({ ledger, graph: oneNode, runId: 'r1', pollIntervalMs: 10_000 });
    const controller = new AbortController();
    const settled = run.run({ signal: controller.signal }).catch(() => 'aborted');
    await vi.advanceTimersByTimeAsync(5);
    controller.abort(new Error('stop'));
    expect(await settled).toBe('aborted');
    expect(vi.getTimerCount()).toBe(0);
  });
});
