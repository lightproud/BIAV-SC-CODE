/**
 * Full-stack integration: cross-component assembly on ONE shared store,
 * imported ONLY through the package public surface ('silver-core-maestro-sdk')
 * — this suite doubles as a public-API assembly proof. Fake timers throughout
 * (systemClock delegates to globals at call time, so vitest fake timers drive
 * every component without clock injection).
 *
 * Scenarios:
 *  1. Scheduler fires an interval spec -> LedgerDriver executes the fired
 *     sessions -> done, WHILE a WorkflowRun diamond a->(b,c)->d progresses on
 *     the SAME store and driver (executor keyed by intent), and a
 *     DeliveryChannel deliver() lands its audit session inline WITHOUT being
 *     stolen by (or stealing from) the co-resident driver.
 *  2. GoalChaser chase (2 rounds to done via evaluator feedback) with the
 *     driver co-resident; the pre-existing workflow/schedule sessions are
 *     byte-identical before and after the chase.
 *  3. driver.stop() mid-everything: every non-terminal session is resumable
 *     ('pending'/'retrying', never stuck 'running') after stop resolves; a
 *     NEW driver + scheduler + WorkflowRun over the same store then completes
 *     ALL remaining work to terminal states.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskLedger,
  LedgerDriver,
  Scheduler,
  WorkflowRun,
  GoalChaser,
  createDeliveryChannel,
  type DeliveryMessage,
  type Executor,
  type GoalChaserEvent,
  type GoalRoundPayload,
  type LedgerStore,
  type QueryRecord,
  type ScheduleSpec,
  type SessionFilter,
  type SessionRecord,
  type WorkflowGraph,
  type WorkflowNodePayload,
} from 'silver-core-maestro-sdk';

/** Host storage battery written against the public LedgerStore seam only. */
function hostStore(): LedgerStore {
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
      if (filter?.states !== undefined) all = all.filter((s) => filter.states!.includes(s.state));
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
  };
}

/** The a->(b,c)->d diamond used by scenarios 1-3. */
function diamondGraph(): WorkflowGraph {
  return {
    id: 'diamond',
    nodes: [
      { id: 'a', intent: 'fetch-a' },
      { id: 'b', intent: 'branch-b', deps: ['a'] },
      { id: 'c', intent: 'branch-c', deps: ['a'] },
      { id: 'd', intent: 'join-d', deps: ['b', 'c'] },
    ],
  };
}

const heartbeatSpec = (): ScheduleSpec => ({
  id: 'heartbeat',
  intent: 'heartbeat',
  every: 500,
  anchorAt: 0,
  catchUp: 'latest',
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('scenario 1: scheduler + workflow diamond + delivery on one store and one driver', () => {
  it('all three session families reach their contracted end states without cross-theft', async () => {
    vi.setSystemTime(1_000_000);
    const store = hostStore();
    const ledger = new TaskLedger({ store });

    // Executor keyed by business intent — one driver serves every family.
    const executed: Array<{ intent: string; id: string }> = [];
    let joinDeps: Record<string, string | null> | null = null;
    const executor: Executor = async (session) => {
      executed.push({ intent: session.intent, id: session.id });
      switch (session.intent) {
        case 'heartbeat':
          return { outcome: 'ok', summary: 'beat' };
        case 'chore':
          return { outcome: 'ok', summary: 'chore-done' };
        case 'fetch-a':
          return { outcome: 'ok', summary: 'A-result' };
        case 'branch-b':
          return { outcome: 'ok', summary: 'B-result' };
        case 'branch-c':
          return { outcome: 'ok', summary: 'C-result' };
        case 'join-d': {
          const payload = session.payload as WorkflowNodePayload;
          joinDeps = { ...payload.workflow.deps };
          return { outcome: 'ok', summary: 'D-result' };
        }
        default:
          // The delivery audit session must NEVER land here.
          return { outcome: 'error', error: `unexpected intent '${session.intent}'` };
      }
    };
    const driver = new LedgerDriver({ ledger, executor, pollIntervalMs: 50 });
    const scheduler = new Scheduler({ ledger, specs: [heartbeatSpec()], pollIntervalMs: 50 });

    // A due-but-unclaimed session sits in the store while deliver() runs: a
    // deliver() regressed back to claimDue would claim it and bump attempts.
    const chore = await ledger.dispatch({ intent: 'chore' });

    const sinkCalls: DeliveryMessage[] = [];
    const channel = createDeliveryChannel({
      ledger,
      sink: async (message) => {
        sinkCalls.push(message);
      },
      idFactory: () => 'audit-1',
    });
    const receipt = await channel.deliver({ body: 'store patrol digest', title: 'digest' });

    // Delivery is inline: settled to done before any driver poll ever ran.
    expect(receipt).toEqual({ sessionId: 'delivery:audit-1', delivered: true });
    expect(sinkCalls).toEqual([{ body: 'store patrol digest', title: 'digest' }]);
    const audit = await ledger.getSession('delivery:audit-1');
    expect(audit?.state).toBe('done');
    expect(audit?.attempts).toBe(1);
    expect(audit?.intent).toBe('agent-delivery');
    const auditRows = await ledger.listQueries('delivery:audit-1');
    expect(auditRows.map((q) => q.outcome)).toEqual(['ok']);
    // ... and it stole nothing: the co-resident due session is untouched.
    const choreAfterDeliver = await ledger.getSession(chore.id);
    expect(choreAfterDeliver?.state).toBe('pending');
    expect(choreAfterDeliver?.attempts).toBe(0);

    driver.start();
    scheduler.start();
    const wf = new WorkflowRun({ ledger, graph: diamondGraph(), runId: 'run-1', pollIntervalMs: 50 });
    const runPromise = wf.run({ drainTimeoutMs: 10_000 });

    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(300); // drain the last claimed fire
    const result = await runPromise;
    await driver.stop();

    // Workflow family: diamond settled done, convergence context delivered.
    expect(result.status).toBe('done');
    expect({ ...result.states }).toEqual({ a: 'done', b: 'done', c: 'done', d: 'done' });
    expect(joinDeps).toEqual({ b: 'B-result', c: 'C-result' });
    const orderOf = (intent: string) => executed.findIndex((e) => e.intent === intent);
    expect(orderOf('fetch-a')).toBeGreaterThanOrEqual(0);
    expect(orderOf('branch-b')).toBeGreaterThan(orderOf('fetch-a'));
    expect(orderOf('branch-c')).toBeGreaterThan(orderOf('fetch-a'));
    expect(orderOf('join-d')).toBeGreaterThan(orderOf('branch-b'));
    expect(orderOf('join-d')).toBeGreaterThan(orderOf('branch-c'));

    // Schedule family: anchored 500ms grid over the 2000ms window, each fire
    // point dispatched exactly once and driven to done in one attempt.
    const all = await ledger.listSessions();
    const sched = all.filter((s) => s.id.startsWith('sched:heartbeat:')).sort((x, y) => x.id.localeCompare(y.id));
    expect(sched.map((s) => s.id)).toEqual([
      'sched:heartbeat:1000500',
      'sched:heartbeat:1001000',
      'sched:heartbeat:1001500',
      'sched:heartbeat:1002000',
    ]);
    for (const s of sched) {
      expect(s.state).toBe('done');
      expect(s.attempts).toBe(1);
    }

    // Chore was executed by the driver (not by deliver()) exactly once.
    const choreFinal = await ledger.getSession(chore.id);
    expect(choreFinal?.state).toBe('done');
    expect(choreFinal?.attempts).toBe(1);

    // The driver never touched the delivery audit session (still one attempt),
    // and the executor never saw its intent.
    expect((await ledger.getSession('delivery:audit-1'))?.attempts).toBe(1);
    expect(executed.some((e) => e.intent === 'agent-delivery')).toBe(false);

    // No stray sessions: 4 schedule + 4 workflow + 1 delivery + 1 chore.
    expect(all).toHaveLength(10);
  });
});

describe('scenario 2: goal chase co-resident with driver leaves other families untouched', () => {
  it('chases to done in 2 rounds via evaluator feedback; workflow/schedule records are byte-identical', async () => {
    vi.setSystemTime(2_000_000);
    const store = hostStore();
    const ledger = new TaskLedger({ store });

    const goalPayloads: GoalRoundPayload[] = [];
    const executor: Executor = async (session) => {
      switch (session.intent) {
        case 'heartbeat':
          return { outcome: 'ok', summary: 'beat' };
        case 'fetch-a':
        case 'branch-b':
        case 'branch-c':
        case 'join-d':
          return { outcome: 'ok', summary: `${session.intent}-ok` };
        case 'goal:report': {
          const payload = session.payload as GoalRoundPayload;
          goalPayloads.push(payload);
          return {
            outcome: 'ok',
            summary: `round=${payload.round} feedback=${payload.feedback ?? 'none'}`,
          };
        }
        default:
          return { outcome: 'error', error: `unexpected intent '${session.intent}'` };
      }
    };
    const driver = new LedgerDriver({ ledger, executor, pollIntervalMs: 50 });
    const scheduler = new Scheduler({ ledger, specs: [heartbeatSpec()], pollIntervalMs: 50 });

    // Phase A: build the schedule + workflow footprint on the store.
    driver.start();
    scheduler.start();
    const wf = new WorkflowRun({ ledger, graph: diamondGraph(), runId: 'run-1', pollIntervalMs: 50 });
    const wfPromise = wf.run({ drainTimeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1_200);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(300);
    const wfResult = await wfPromise;
    expect(wfResult.status).toBe('done');

    const before = (await ledger.listSessions()).sort((x, y) => x.id.localeCompare(y.id));
    expect(before.length).toBeGreaterThanOrEqual(5); // 4 workflow + >=1 schedule fire
    expect(before.every((s) => s.state === 'done')).toBe(true);

    // Phase B: the chase, driver still co-resident on the same store.
    const evaluatorSummaries: Array<string | null> = [];
    const events: GoalChaserEvent[] = [];
    const chaser = new GoalChaser({
      ledger,
      pollIntervalMs: 25,
      drainTimeoutMs: 10_000,
      onEvent: (ev) => events.push(ev),
      evaluator: async ({ round, summary }) => {
        evaluatorSummaries.push(summary);
        return round === 1
          ? { achieved: false, feedback: 'add more detail' }
          : { achieved: true };
      },
    });
    const chasePromise = chaser.chase({
      id: 'report',
      description: 'produce the weekly report',
      maxRounds: 5,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const chase = await chasePromise;
    await driver.stop();

    // Chase settled done in exactly 2 rounds, both driven through the ledger.
    expect(chase.action).toBe('done');
    expect(chase.rounds.map((r) => r.id)).toEqual(['goal:report:round-1', 'goal:report:round-2']);
    expect(chase.rounds.every((r) => r.state === 'done' && r.attempts === 1)).toBe(true);
    // Feedback threading: round 2's dispatched payload carries round 1's
    // verdict feedback, and the evaluator saw it back through the query row.
    expect(goalPayloads.map((p) => [p.round, p.feedback])).toEqual([
      [1, null],
      [2, 'add more detail'],
    ]);
    expect(evaluatorSummaries).toEqual([
      'round=1 feedback=none',
      'round=2 feedback=add more detail',
    ]);
    const settled = events.find((e) => e.type === 'goal:settled');
    expect(settled).toEqual({ type: 'goal:settled', goalId: 'report', action: 'done', rounds: 2 });

    // The chase added EXACTLY its two round sessions and mutated nothing else:
    // every pre-existing workflow/schedule record is byte-identical.
    const after = (await ledger.listSessions()).sort((x, y) => x.id.localeCompare(y.id));
    expect(after).toHaveLength(before.length + 2);
    const afterById = new Map(after.map((s) => [s.id, s]));
    for (const prior of before) {
      expect(afterById.get(prior.id)).toEqual(prior);
    }
  });
});

describe('scenario 3: stop mid-everything is resumable; a fresh driver+scheduler completes it all', () => {
  it('after stop() no session is stuck running; new components drain the store to terminal', async () => {
    vi.setSystemTime(3_000_000);
    const store = hostStore();
    // Short backoff so phase 2 re-claims quickly on the fake clock.
    const ledger = new TaskLedger({ store, retry: { baseDelayMs: 200, factor: 2, maxAttempts: 3 } });

    let phase: 'hang' | 'ok' = 'hang';
    const executor: Executor = (session, ctx) => {
      if (phase === 'hang') {
        // Hold every attempt open until the driver's stop() aborts it.
        return new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('interrupted')), {
            once: true,
          });
        });
      }
      switch (session.intent) {
        case 'heartbeat':
        case 'chore':
        case 'fetch-a':
        case 'branch-b':
        case 'branch-c':
        case 'join-d':
          return Promise.resolve({ outcome: 'ok' as const, summary: `${session.intent}-ok` });
        default:
          return Promise.resolve({ outcome: 'error' as const, error: `unexpected intent '${session.intent}'` });
      }
    };

    // Phase 1: everything in flight, then stop mid-everything.
    const driver1 = new LedgerDriver({ ledger, executor, pollIntervalMs: 50 });
    const scheduler1 = new Scheduler({ ledger, specs: [heartbeatSpec()], pollIntervalMs: 50 });
    const wf1 = new WorkflowRun({ ledger, graph: diamondGraph(), runId: 'run-1', pollIntervalMs: 50 });
    await ledger.dispatch({ intent: 'chore', id: 'chore-1' });
    driver1.start();
    scheduler1.start();
    await wf1.tick(); // dispatches node 'a'

    await vi.advanceTimersByTimeAsync(600);
    // Mid-everything sanity: three families each have a claimed attempt open.
    const midFlight = await ledger.listSessions({ states: ['running'] });
    expect(midFlight.map((s) => s.id).sort()).toEqual([
      'chore-1',
      'sched:heartbeat:3000500',
      'wf:diamond:run-1:a',
    ]);

    await scheduler1.stop();
    await driver1.stop();

    // After stop resolves: nothing terminal yet, nothing stuck 'running' —
    // every session parked resumable, with the abort recorded as its error.
    const parked = await ledger.listSessions();
    expect(parked).toHaveLength(3);
    for (const s of parked) {
      expect(['pending', 'retrying']).toContain(s.state);
      expect(s.state).not.toBe('running');
    }
    const retrying = parked.filter((s) => s.state === 'retrying');
    expect(retrying).toHaveLength(3);
    for (const s of retrying) {
      expect(s.attempts).toBe(1);
      expect(s.lastError).toBe('interrupted');
      expect(s.nextRunAt).not.toBeNull(); // scheduled for resume, not orphaned
    }

    // Quiescence: with everything stopped, time passing changes nothing.
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await ledger.listSessions({ states: ['running', 'done', 'failed'] }))).toHaveLength(0);

    // Phase 2: fresh driver + scheduler + workflow run over the SAME store.
    phase = 'ok';
    const driver2 = new LedgerDriver({ ledger, executor, pollIntervalMs: 50 });
    const scheduler2 = new Scheduler({ ledger, specs: [heartbeatSpec()], pollIntervalMs: 50 });
    const wf2 = new WorkflowRun({ ledger, graph: diamondGraph(), runId: 'run-1', pollIntervalMs: 50 });
    driver2.start();
    scheduler2.start();
    const runPromise = wf2.run({ drainTimeoutMs: 30_000 });

    await vi.advanceTimersByTimeAsync(3_000);
    await scheduler2.stop();
    await vi.advanceTimersByTimeAsync(400); // drain the last claimed fire
    const result = await runPromise;
    await driver2.stop();

    // The diamond resumed from the interrupted 'a' and completed.
    expect(result.status).toBe('done');
    expect({ ...result.states }).toEqual({ a: 'done', b: 'done', c: 'done', d: 'done' });

    // EVERYTHING in the store is terminal-done: no stranded work remains.
    const final = await ledger.listSessions();
    expect(final.length).toBeGreaterThanOrEqual(8); // 3 resumed + 3 new wf nodes + >=2 new fires
    expect(final.every((s) => s.state === 'done')).toBe(true);

    // The three interrupted sessions went through the RETRY path (attempts 2:
    // one aborted + one successful), not a fresh dispatch.
    for (const id of ['chore-1', 'sched:heartbeat:3000500', 'wf:diamond:run-1:a']) {
      const s = final.find((r) => r.id === id);
      expect(s?.attempts).toBe(2);
      const rows = await ledger.listQueries(id);
      expect(rows.map((q) => q.outcome)).toEqual(['error', 'ok']);
    }

    // The restarted scheduler recovered lastFired from the ledger: the
    // interrupted fire point was NOT re-dispatched (attempts 2 proves reuse)
    // and new fire points continued strictly after it, each done in one shot.
    const newFires = final.filter(
      (s) => s.id.startsWith('sched:heartbeat:') && s.id !== 'sched:heartbeat:3000500',
    );
    expect(newFires.length).toBeGreaterThanOrEqual(1);
    for (const s of newFires) {
      expect(Number(s.id.slice('sched:heartbeat:'.length))).toBeGreaterThan(3_000_500);
      expect(s.attempts).toBe(1);
    }
  });
});
