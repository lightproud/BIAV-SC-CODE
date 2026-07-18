/**
 * Cross-restart durability over a FILE store (integration; public surface
 * only). The host battery below is the same inline file store shape as
 * examples/store-patrol.mjs: one JSON file, write-through with atomic rename.
 * Each scenario runs a real component stack (Scheduler / WorkflowRun /
 * GoalChaser + LedgerDriver + TaskLedger), "crashes" it by stopping and
 * discarding every in-memory object, then rebuilds a fresh stack over the
 * SAME file and asserts the resume contracts:
 *
 *   1. scheduler fires are exactly-once across restart; missed fire points
 *      are compensated per catchUp policy ('latest' collapses, 'all' replays);
 *   2. a half-done workflow resumes without re-running completed nodes;
 *   3. an interrupted goal chase resumes at the next round, prior round
 *      sessions untouched;
 *   4. after any run the ledger file is a consistent, parseable snapshot
 *      (atomic-rename write shape; no torn .tmp leftovers).
 *
 * Time discipline: logical time (fire points, due-ness, backoff) runs on a
 * manual clock injected through the public Clock seam — advanced explicitly,
 * so WHICH fire points exist is fully deterministic. Only poll cadence uses
 * real short timers (clamped to <= 25 ms) because components genuinely poll.
 * queryTimeoutMs is deliberately never set: the clamp would turn a logical
 * timeout into a real 25 ms one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  TaskLedger,
  LedgerDriver,
  Scheduler,
  WorkflowRun,
  GoalChaser,
  SESSION_STATES,
  type Clock,
  type LedgerStore,
  type SessionFilter,
  type SessionRecord,
  type QueryRecord,
  type ScheduleSpec,
  type WorkflowGraph,
  type GoalVerdict,
} from 'silver-core-maestro-sdk';

// --- Host battery: the store-patrol example's file store, typed. -----------

interface FileState {
  sessions: Record<string, SessionRecord>;
  queries: QueryRecord[];
}

function fileLedgerStore(filePath: string): LedgerStore {
  const state: FileState = fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, 'utf8')) as FileState)
    : { sessions: {}, queries: [] };
  const save = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, filePath);
  };
  return {
    async putSession(record) {
      state.sessions[record.id] = { ...record };
      save();
    },
    async getSession(id) {
      const r = state.sessions[id];
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter?: SessionFilter) {
      let all = Object.values(state.sessions);
      if (filter?.states !== undefined) all = all.filter((s) => filter.states!.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      state.queries.push({ ...record });
      save();
    },
    async listQueries(sessionId) {
      return state.queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

function readLedgerFile(filePath: string): FileState {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as FileState;
}

// --- Manual logical clock over real short poll timers. ---------------------

function makeClock(startAt: number) {
  let nowMs = startAt;
  const clock: Clock = {
    now: () => nowMs,
    // Poll cadence only: requested delays are clamped so component poll
    // chains make real progress while logical time stays under test control.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 25)),
    clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
  };
  return {
    clock,
    advanceTo: (t: number) => {
      if (t < nowMs) throw new Error(`advanceTo would rewind (${t} < ${nowMs})`);
      nowMs = t;
    },
    advanceBy: (ms: number) => {
      nowMs += ms;
    },
    now: () => nowMs,
  };
}

async function until(cond: () => Promise<boolean> | boolean, what: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Sandbox lifecycle. ----------------------------------------------------

const sandboxes: string[] = [];
function newLedgerPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-restart-'));
  sandboxes.push(dir);
  return path.join(dir, 'state', 'ledger.json');
}
afterEach(() => {
  while (sandboxes.length > 0) {
    fs.rmSync(sandboxes.pop()!, { recursive: true, force: true });
  }
});

// ===========================================================================
// Scenario 1 — Scheduler: exactly-once fires + missed-point compensation
// across a restart gap.
// ===========================================================================

const MIN = 60_000;
const T0 = 1_000_000; // between fire points (multiples of 60_000, anchor 0)
const FIRE_1 = 1_020_000;
const FIRE_2 = 1_080_000;
const MISSED_1 = 1_140_000;
const MISSED_2 = 1_200_000;
const T_RESTART = 1_250_000; // after two missed points, before the third

interface ScheduleRunResult {
  executedRunB: string[];
  ledgerPath: string;
  preRestart: FileState;
}

/**
 * Shared runner: run A fires FIRE_1 and FIRE_2, crash, gap over MISSED_1 and
 * MISSED_2, run B recovers from the file per `catchUp`. Returns what run B
 * executed plus the pre-restart file snapshot for exactly-once comparison.
 */
async function runScheduleRestart(catchUp: 'latest' | 'all'): Promise<ScheduleRunResult> {
  const ledgerPath = newLedgerPath();
  const spec: ScheduleSpec = {
    id: 'patrol',
    intent: 'patrol the storefront',
    every: MIN,
    anchorAt: 0,
    catchUp,
  };

  // --- Run A: two fires, then crash. ---
  {
    const time = makeClock(T0);
    const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: time.clock });
    const driver = new LedgerDriver({
      ledger,
      executor: async () => ({ outcome: 'ok', summary: 'patrolled' }),
      pollIntervalMs: 10,
      clock: time.clock,
    });
    const scheduler = new Scheduler({
      ledger,
      specs: [spec],
      clock: time.clock,
      pollIntervalMs: 10,
    });
    driver.start();
    scheduler.start();
    // Let first-tick recovery observe T0 (no ledger footprint -> lastFired=T0)
    // before logical time moves; otherwise FIRE_1 would be recovery's "now".
    await sleep(100);

    time.advanceTo(FIRE_1);
    await until(
      async () => (await ledger.getSession(`sched:patrol:${FIRE_1}`))?.state === 'done',
      'fire 1 done in run A',
    );
    time.advanceTo(FIRE_2);
    await until(
      async () => (await ledger.getSession(`sched:patrol:${FIRE_2}`))?.state === 'done',
      'fire 2 done in run A',
    );
    await scheduler.stop();
    await driver.stop();
    // Crash: every in-memory object from run A is discarded here.
  }

  const preRestart = readLedgerFile(ledgerPath);

  // --- Run B: fresh stack over the same file, after the gap. ---
  const time = makeClock(T_RESTART);
  const executedRunB: string[] = [];
  const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: time.clock });
  const driver = new LedgerDriver({
    ledger,
    executor: async (session) => {
      executedRunB.push(session.id);
      return { outcome: 'ok', summary: 'patrolled' };
    },
    pollIntervalMs: 10,
    clock: time.clock,
  });
  const scheduler = new Scheduler({ ledger, specs: [spec], clock: time.clock, pollIntervalMs: 10 });
  driver.start();
  scheduler.start();

  const expected = catchUp === 'all' ? [MISSED_1, MISSED_2] : [MISSED_2];
  for (const fireAt of expected) {
    await until(
      async () => (await ledger.getSession(`sched:patrol:${fireAt}`))?.state === 'done',
      `compensated fire ${fireAt} done in run B`,
    );
  }
  // Settle window: any wrongly re-fired old point or extra compensation
  // would surface as extra sessions/executions during these polls.
  await sleep(150);
  await scheduler.stop();
  await driver.stop();
  return { executedRunB, ledgerPath, preRestart };
}

describe('scenario 1: scheduler exactly-once + catch-up across restart', () => {
  it("catchUp 'latest': backlog collapses to the newest missed point; fired points never re-fire", async () => {
    const { executedRunB, ledgerPath, preRestart } = await runScheduleRestart('latest');
    const after = readLedgerFile(ledgerPath);

    // Compensation: only the NEWEST missed point was dispatched.
    expect(after.sessions[`sched:patrol:${MISSED_2}`]?.state).toBe('done');
    expect(after.sessions[`sched:patrol:${MISSED_1}`]).toBeUndefined();
    expect(executedRunB).toEqual([`sched:patrol:${MISSED_2}`]);

    // Exactly-once: run A's fire records are byte-identical after run B —
    // not re-claimed (attempts), not re-executed (query rows), not touched.
    for (const fireAt of [FIRE_1, FIRE_2]) {
      const id = `sched:patrol:${fireAt}`;
      expect(after.sessions[id]).toEqual(preRestart.sessions[id]);
      expect(after.sessions[id]?.attempts).toBe(1);
      expect(after.queries.filter((q) => q.sessionId === id)).toHaveLength(1);
    }
    // Total footprint: 2 run-A fires + 1 compensation, nothing else.
    expect(Object.keys(after.sessions)).toHaveLength(3);
    expect(after.queries).toHaveLength(3);
  });

  it("catchUp 'all': every missed point replayed once, ascending; fired points never re-fire", async () => {
    const { executedRunB, ledgerPath, preRestart } = await runScheduleRestart('all');
    const after = readLedgerFile(ledgerPath);

    for (const fireAt of [MISSED_1, MISSED_2]) {
      const id = `sched:patrol:${fireAt}`;
      expect(after.sessions[id]?.state).toBe('done');
      expect(after.sessions[id]?.attempts).toBe(1);
      expect(after.queries.filter((q) => q.sessionId === id)).toHaveLength(1);
    }
    // Each compensated point executed exactly once; dispatch order ascending.
    expect([...executedRunB].sort()).toEqual([
      `sched:patrol:${MISSED_1}`,
      `sched:patrol:${MISSED_2}`,
    ]);
    expect(executedRunB).toHaveLength(2);

    for (const fireAt of [FIRE_1, FIRE_2]) {
      const id = `sched:patrol:${fireAt}`;
      expect(after.sessions[id]).toEqual(preRestart.sessions[id]);
    }
    expect(Object.keys(after.sessions)).toHaveLength(4);
    expect(after.queries).toHaveLength(4);
  });
});

// ===========================================================================
// Scenario 2 — WorkflowRun: abandoned half-done (a done, b retrying), fresh
// run + driver completes without re-running 'a'.
// ===========================================================================

describe('scenario 2: workflow resume without re-running completed nodes', () => {
  it('a done + b retrying at crash; fresh WorkflowRun finishes b only', async () => {
    const ledgerPath = newLedgerPath();
    const graph: WorkflowGraph = {
      id: 'pipeline',
      nodes: [
        { id: 'a', intent: 'build the artifact' },
        { id: 'b', intent: 'publish the artifact', deps: ['a'], maxAttempts: 3 },
      ],
    };
    const aId = 'wf:pipeline:run-1:a';
    const bId = 'wf:pipeline:run-1:b';

    // --- Phase 1: run until a=done, b=retrying (scripted failure), crash. ---
    const t1 = makeClock(T0);
    {
      const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: t1.clock });
      const driver = new LedgerDriver({
        ledger,
        executor: async (session) => {
          if (session.id === aId) return { outcome: 'ok', summary: 'built artifact' };
          throw new Error('scripted failure: publish endpoint down');
        },
        pollIntervalMs: 10,
        clock: t1.clock,
      });
      const wf = new WorkflowRun({ ledger, graph, runId: 'run-1', clock: t1.clock });
      driver.start();

      expect(await wf.tick()).toBe('running'); // dispatches a
      await until(async () => (await ledger.getSession(aId))?.state === 'done', 'node a done');
      expect(await wf.tick()).toBe('running'); // a done -> dispatches b
      await until(async () => {
        const b = await ledger.getSession(bId);
        return b?.state === 'retrying' && b.attempts === 1;
      }, 'node b retrying after scripted failure');
      await driver.stop();
      // Crash: the WorkflowRun object and driver are abandoned here.
    }

    const mid = readLedgerFile(ledgerPath);
    expect(mid.sessions[aId]?.state).toBe('done');
    expect(mid.sessions[bId]?.state).toBe('retrying');
    expect(mid.sessions[bId]?.lastError).toContain('publish endpoint down');

    // --- Phase 2: fresh stack over the same file, well past b's backoff. ---
    const t2 = makeClock(t1.now() + 10 * MIN);
    const executedPhase2: string[] = [];
    const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: t2.clock });
    const driver = new LedgerDriver({
      ledger,
      executor: async (session) => {
        executedPhase2.push(session.id);
        if (session.id === aId) throw new Error('node a must not re-run on resume');
        return { outcome: 'ok', summary: 'published' };
      },
      pollIntervalMs: 10,
      clock: t2.clock,
    });
    const wf = new WorkflowRun({ ledger, graph, runId: 'run-1', clock: t2.clock });
    driver.start();
    const result = await wf.run();
    await driver.stop();

    expect(result.status).toBe('done');
    expect(result.states['a']).toBe('done');
    expect(result.states['b']).toBe('done');

    // Resume contract: only b executed; a's record survives byte-identical.
    expect(executedPhase2).toEqual([bId]);
    const after = readLedgerFile(ledgerPath);
    expect(after.sessions[aId]).toEqual(mid.sessions[aId]);
    expect(after.sessions[aId]?.attempts).toBe(1);
    expect(after.queries.filter((q) => q.sessionId === aId)).toHaveLength(1);

    // b: the SAME session finished through the retry path (no forked id).
    expect(after.sessions[bId]?.attempts).toBe(2);
    expect(after.queries.filter((q) => q.sessionId === bId).map((q) => q.outcome)).toEqual([
      'error',
      'ok',
    ]);
    // Convergence payload dispatched in phase 1 survived the restart intact.
    const bPayload = after.sessions[bId]?.payload as {
      workflow: { deps: Record<string, string | null> };
    };
    expect(bPayload.workflow.deps).toEqual({ a: 'built artifact' });
  });
});

// ===========================================================================
// Scenario 3 — GoalChaser: interrupted after round 1 resumes at round 2
// under the SAME goal id; round-1 session untouched.
// ===========================================================================

describe('scenario 3: goal chase resumes at round 2, round 1 untouched', () => {
  it('crash while judging round 1; fresh chaser re-judges and settles done in round 2', async () => {
    const ledgerPath = newLedgerPath();
    const round1Id = 'goal:weekly-report:round-1';
    const round2Id = 'goal:weekly-report:round-2';
    const config = {
      id: 'weekly-report',
      description: 'produce the weekly community report',
      maxRounds: 3,
    };

    // --- Phase 1: round 1 executes to done, host crashes mid-judgment. ---
    const t1 = makeClock(T0);
    {
      const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: t1.clock });
      const driver = new LedgerDriver({
        ledger,
        executor: async () => ({ outcome: 'ok', summary: 'draft v1' }),
        pollIntervalMs: 10,
        clock: t1.clock,
      });
      const chaser = new GoalChaser({
        ledger,
        evaluator: async () => {
          throw new Error('host crashed mid-judge');
        },
        pollIntervalMs: 10,
        clock: t1.clock,
      });
      driver.start();
      await expect(chaser.chase(config)).rejects.toThrow('host crashed mid-judge');
      await driver.stop();
      // Crash: chaser and driver abandoned; only the file remains.
    }

    const mid = readLedgerFile(ledgerPath);
    expect(mid.sessions[round1Id]?.state).toBe('done');
    expect(mid.sessions[round1Id]?.attempts).toBe(1);
    expect(mid.sessions[round2Id]).toBeUndefined(); // round 2 never dispatched

    // --- Phase 2: fresh stack, same goal id, evaluator judges by round. ---
    const t2 = makeClock(t1.now() + 10 * MIN);
    const executedPhase2: string[] = [];
    const judged: Array<{ round: number; summary: string | null }> = [];
    const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: t2.clock });
    const driver = new LedgerDriver({
      ledger,
      executor: async (session) => {
        executedPhase2.push(session.id);
        return { outcome: 'ok', summary: 'draft v2' };
      },
      pollIntervalMs: 10,
      clock: t2.clock,
    });
    const chaser = new GoalChaser({
      ledger,
      evaluator: async ({ round, summary }) => {
        judged.push({ round, summary });
        const verdict: GoalVerdict =
          round === 1
            ? { achieved: false, feedback: 'expand section 2' }
            : { achieved: true };
        return verdict;
      },
      pollIntervalMs: 10,
      clock: t2.clock,
    });
    driver.start();
    const result = await chaser.chase(config);
    await driver.stop();

    // Settled done at round 2; result carries both rounds in order.
    expect(result.action).toBe('done');
    expect(result.rounds.map((r) => r.id)).toEqual([round1Id, round2Id]);
    expect(result.rounds.every((r) => r.state === 'done')).toBe(true);

    // Round 1 was re-judged from its persisted output, NOT re-executed.
    expect(judged).toEqual([
      { round: 1, summary: 'draft v1' },
      { round: 2, summary: 'draft v2' },
    ]);
    expect(executedPhase2).toEqual([round2Id]);

    const after = readLedgerFile(ledgerPath);
    // Round-1 session byte-identical to its pre-resume record.
    expect(after.sessions[round1Id]).toEqual(mid.sessions[round1Id]);
    expect(after.queries.filter((q) => q.sessionId === round1Id)).toHaveLength(1);

    // Round 2 was dispatched with the re-derived feedback under the SAME goal.
    const round2Payload = after.sessions[round2Id]?.payload as {
      goal: { id: string };
      feedback: string | null;
      round: number;
    };
    expect(round2Payload.goal.id).toBe('weekly-report');
    expect(round2Payload.feedback).toBe('expand section 2');
    expect(round2Payload.round).toBe(2);
  });
});

// ===========================================================================
// Scenario 4 — Ledger file consistency: after a run with retries and
// terminal states, the file is one valid, internally consistent snapshot.
// ===========================================================================

describe('scenario 4: ledger file is a valid consistent snapshot after a run', () => {
  it('retry-heavy run leaves valid JSON, no .tmp leftover, closed states, matched bookkeeping', async () => {
    const ledgerPath = newLedgerPath();
    const time = makeClock(T0);
    const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath), clock: time.clock });
    let flakyFailures = 2;
    const driver = new LedgerDriver({
      ledger,
      executor: async (session) => {
        if (session.id === 'job-flaky' && flakyFailures > 0) {
          flakyFailures -= 1;
          throw new Error('transient outage');
        }
        return { outcome: 'ok', summary: 'completed' };
      },
      pollIntervalMs: 10,
      clock: time.clock,
    });
    await ledger.dispatch({ id: 'job-steady', intent: 'steady job' });
    await ledger.dispatch({ id: 'job-flaky', intent: 'flaky job', maxAttempts: 3 });
    driver.start();
    await until(async () => {
      // Retries are backoff-scheduled on logical time: keep advancing so
      // 'retrying' sessions come due while the real poll chain spins.
      time.advanceBy(5 * MIN);
      const [steady, flaky] = await Promise.all([
        ledger.getSession('job-steady'),
        ledger.getSession('job-flaky'),
      ]);
      return steady?.state === 'done' && flaky?.state === 'done';
    }, 'both jobs terminal');
    await driver.stop();

    // Atomic-rename write shape: the visible file is always one complete
    // snapshot — parses as JSON, carries the full shape, and no torn
    // temp file survives the run.
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(raw) as FileState; // throws on a torn write
    expect(fs.existsSync(ledgerPath + '.tmp')).toBe(false);
    expect(Object.keys(parsed.sessions).sort()).toEqual(['job-flaky', 'job-steady']);
    expect(Array.isArray(parsed.queries)).toBe(true);

    // Every persisted state is from the closed public state set.
    for (const session of Object.values(parsed.sessions)) {
      expect(SESSION_STATES).toContain(session.state);
    }
    // Referential + bookkeeping consistency: every query row points at an
    // existing session, and at terminal state attempts === recorded rows.
    for (const query of parsed.queries) {
      expect(parsed.sessions[query.sessionId]).toBeDefined();
    }
    for (const session of Object.values(parsed.sessions)) {
      const rows = parsed.queries.filter((q) => q.sessionId === session.id);
      expect(rows).toHaveLength(session.attempts);
    }
    // The retry trail itself persisted in order: error, error, ok.
    expect(
      parsed.queries.filter((q) => q.sessionId === 'job-flaky').map((q) => q.outcome),
    ).toEqual(['error', 'error', 'ok']);
    expect(parsed.sessions['job-flaky']?.attempts).toBe(3);
    expect(parsed.sessions['job-steady']?.attempts).toBe(1);
  });
});
