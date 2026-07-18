/**
 * GoalChaser over a real TaskLedger + LedgerDriver (fake timers, inline
 * memory store, scripted executor): feedback threading across rounds,
 * impossible short-circuit, maxRounds exhaustion, failed-round judging,
 * and resume without re-dispatching finished rounds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import { LedgerDriver } from '../src/driver.js';
import type { ExecutorResult } from '../src/driver.js';
import type { LedgerStore } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord, SessionState } from '../src/ledger/types.js';
import { GoalChaser, goalRoundSessionId } from '../src/goal/chaser.js';
import type { GoalChaserEvent, GoalEvaluator, GoalRoundPayload } from '../src/goal/chaser.js';
import type { GoalVerdict } from '../src/goal/decision.js';

function memoryStore(): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    async putSession(record) {
      sessions.set(record.id, { ...record });
    },
    async getSession(id) {
      const record = sessions.get(id);
      return record === undefined ? null : { ...record };
    },
    async listSessions(filter) {
      let all = [...sessions.values()];
      const states = filter?.states;
      if (states !== undefined) all = all.filter((s) => states.includes(s.state));
      const dueBefore = filter?.dueBefore;
      if (dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= dueBefore);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      queries.push({ ...record });
    },
    async listQueries(sessionId) {
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

interface EvalCall {
  round: number;
  state: SessionState;
  summary: string | null;
}

function harness(opts: {
  executor: (payload: GoalRoundPayload) => ExecutorResult;
  verdicts: (round: number) => GoalVerdict;
}) {
  const store = memoryStore();
  const ledger = new TaskLedger({ store });
  const dispatched: GoalRoundPayload[] = [];
  const driver = new LedgerDriver({
    ledger,
    executor: async (session) => {
      const payload = session.payload as GoalRoundPayload;
      dispatched.push(payload);
      return opts.executor(payload);
    },
    pollIntervalMs: 10,
  });
  const evalCalls: EvalCall[] = [];
  const evaluator: GoalEvaluator = async ({ round, session, summary }) => {
    evalCalls.push({ round, state: session.state, summary });
    return opts.verdicts(round);
  };
  const events: GoalChaserEvent[] = [];
  const chaser = new GoalChaser({
    ledger,
    evaluator,
    pollIntervalMs: 10,
    onEvent: (event) => events.push(event),
  });
  return { store, ledger, driver, chaser, dispatched, evalCalls, events };
}

/** Run chase under fake timers with the driver executing rounds. */
async function drive<T>(driver: LedgerDriver, work: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(10_000);
  const result = await work;
  await driver.stop();
  return result;
}

function seedSession(n: number, state: SessionState, goalId = 'g'): SessionRecord {
  return {
    id: goalRoundSessionId(goalId, n),
    intent: `goal:${goalId}`,
    payload: { goal: { id: goalId, description: 'seeded' }, data: undefined, feedback: null, round: n },
    state,
    attempts: 1,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
    nextRunAt: state === 'pending' ? 0 : null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('validation', () => {
  it('rejects a non-finite / non-positive pollIntervalMs', () => {
    const { ledger } = harness({ executor: () => ({ outcome: 'ok' }), verdicts: () => ({ achieved: true }) });
    expect(
      () => new GoalChaser({ ledger, evaluator: async () => ({ achieved: true }), pollIntervalMs: Number.NaN }),
    ).toThrow(RangeError);
  });

  it('rejects empty id, empty description, and bad maxRounds', async () => {
    const { chaser } = harness({ executor: () => ({ outcome: 'ok' }), verdicts: () => ({ achieved: true }) });
    await expect(chaser.chase({ id: '', description: 'd' })).rejects.toThrow(TypeError);
    await expect(chaser.chase({ id: 'g', description: '' })).rejects.toThrow(TypeError);
    await expect(chaser.chase({ id: 'g', description: 'd', maxRounds: 0 })).rejects.toThrow(RangeError);
    await expect(chaser.chase({ id: 'g', description: 'd', maxRounds: 2.5 })).rejects.toThrow(RangeError);
  });
});

describe('a goal achieved on round 2', () => {
  it('runs two sessions, threads round-1 feedback into round 2, returns done', async () => {
    const { ledger, driver, chaser, dispatched, evalCalls, events } = harness({
      executor: (payload) => ({ outcome: 'ok', summary: `run:${payload.round}` }),
      verdicts: (round) =>
        round === 1 ? { achieved: false, feedback: 'add sources' } : { achieved: true },
    });
    driver.start();
    const result = await drive(
      driver,
      chaser.chase({ id: 'g1', description: 'write the weekly brief', payload: { topic: 'news' } }),
    );

    expect(result.action).toBe('done');
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds.map((s) => s.id)).toEqual(['goal:g1:round-1', 'goal:g1:round-2']);
    expect(result.rounds.every((s) => s.state === 'done')).toBe(true);

    // Payload envelope: goal semantics live in the payload, ledger untouched.
    expect(dispatched[0]).toEqual({
      goal: { id: 'g1', description: 'write the weekly brief' },
      data: { topic: 'news' },
      feedback: null,
      round: 1,
    });
    // Round-1 verdict feedback appears in round 2's dispatched payload.
    expect(dispatched[1]?.feedback).toBe('add sources');
    expect(dispatched[1]?.round).toBe(2);

    // Evaluator saw each round's last ok query summary.
    expect(evalCalls).toEqual([
      { round: 1, state: 'done', summary: 'run:1' },
      { round: 2, state: 'done', summary: 'run:2' },
    ]);

    // Intent and maxAttempts defaulting on the round sessions.
    const round1 = await ledger.getSession('goal:g1:round-1');
    expect(round1?.intent).toBe('goal:g1');

    // Event mirror: one goal:round per round, then goal:settled.
    expect(events.map((e) => e.type)).toEqual(['goal:round', 'goal:round', 'goal:settled']);
    expect(events[0]).toMatchObject({ type: 'goal:round', goalId: 'g1', round: 1, action: 'continue' });
    expect(events[1]).toMatchObject({ type: 'goal:round', goalId: 'g1', round: 2, action: 'done' });
    expect(events[2]).toEqual({ type: 'goal:settled', goalId: 'g1', action: 'done', rounds: 2 });
  });
});

describe('impossible short-circuit', () => {
  it('stops after the first impossible verdict with one session', async () => {
    const { driver, chaser, dispatched } = harness({
      executor: () => ({ outcome: 'ok', summary: 's' }),
      verdicts: () => ({ achieved: false, feedback: 'no such data', impossible: true }),
    });
    driver.start();
    const result = await drive(driver, chaser.chase({ id: 'g2', description: 'find the lost tape' }));

    expect(result.action).toBe('impossible');
    expect(result.rounds).toHaveLength(1);
    expect(dispatched).toHaveLength(1);
  });
});

describe('maxRounds exhaustion', () => {
  it('returns exhausted with N sessions and feedback threaded each round', async () => {
    const { driver, chaser, dispatched } = harness({
      executor: (payload) => ({ outcome: 'ok', summary: `run:${payload.round}` }),
      verdicts: (round) => ({ achieved: false, feedback: `redo-${round}` }),
    });
    driver.start();
    const result = await drive(
      driver,
      chaser.chase({ id: 'g3', description: 'converge', maxRounds: 3 }),
    );

    expect(result.action).toBe('exhausted');
    expect(result.rounds).toHaveLength(3);
    expect(dispatched.map((p) => p.feedback)).toEqual([null, 'redo-1', 'redo-2']);
  });
});

describe('failed rounds still go to the evaluator', () => {
  it('judges a failed round; its feedback drives the next round', async () => {
    const { driver, chaser, evalCalls } = harness({
      executor: (payload) =>
        payload.round === 1 ? { outcome: 'error', error: 'crash' } : { outcome: 'ok', summary: 'fine' },
      verdicts: (round) =>
        round === 1 ? { achieved: false, feedback: 'try harder' } : { achieved: true },
    });
    driver.start();
    const result = await drive(
      driver,
      chaser.chase({ id: 'g4', description: 'survive', maxAttemptsPerRound: 1 }),
    );

    expect(result.action).toBe('done');
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]?.state).toBe('failed');
    expect(result.rounds[0]?.maxAttempts).toBe(1); // maxAttemptsPerRound forwarded
    expect(evalCalls[0]).toEqual({ round: 1, state: 'failed', summary: null });
  });
});

describe('resume', () => {
  it('continues at round 3 after pre-seeded terminal rounds 1-2, without re-dispatch', async () => {
    const { store, ledger, driver, chaser, dispatched, evalCalls } = harness({
      executor: (payload) => ({ outcome: 'ok', summary: `run:${payload.round}` }),
      verdicts: (round) =>
        round === 2 ? { achieved: false, feedback: 'from-r2' } : { achieved: true },
    });
    await store.putSession(seedSession(1, 'done'));
    await store.putSession(seedSession(2, 'done'));
    await store.appendQuery({
      id: 'q2',
      sessionId: goalRoundSessionId('g', 2),
      attempt: 1,
      startedAt: 0,
      endedAt: 0,
      outcome: 'ok',
      summary: 'seeded-2',
    });

    driver.start();
    const result = await drive(driver, chaser.chase({ id: 'g', description: 'resume me' }));

    expect(result.action).toBe('done');
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.map((s) => s.id)).toEqual([
      'goal:g:round-1',
      'goal:g:round-2',
      'goal:g:round-3',
    ]);
    // Only round 3 was dispatched/executed; 1-2 kept their single attempt.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.round).toBe(3);
    expect((await ledger.getSession(goalRoundSessionId('g', 1)))?.attempts).toBe(1);
    expect((await ledger.getSession(goalRoundSessionId('g', 2)))?.attempts).toBe(1);
    // The latest finished round (2) was re-judged to recover feedback; its
    // verdict's feedback rode into round 3's payload. Round 1 was not judged.
    expect(evalCalls.map((c) => c.round)).toEqual([2, 3]);
    expect(evalCalls[0]?.summary).toBe('seeded-2');
    expect(dispatched[0]?.feedback).toBe('from-r2');
  });

  it('awaits an existing unfinished round instead of re-dispatching it', async () => {
    const { store, driver, chaser, dispatched } = harness({
      executor: (payload) => ({ outcome: 'ok', summary: `run:${payload.round}` }),
      verdicts: () => ({ achieved: true }),
    });
    // A pending round left behind by an interrupted chase; the driver picks
    // it up — chase() must wait on it, not dispatch a duplicate (which throws).
    await store.putSession(seedSession(1, 'pending', 'g5'));

    driver.start();
    const result = await drive(driver, chaser.chase({ id: 'g5', description: 'pick me up' }));

    expect(result.action).toBe('done');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.state).toBe('done');
    expect(dispatched).toHaveLength(1); // the driver's execution of the seed, no new dispatch
    expect(dispatched[0]?.round).toBe(1);
  });
});

describe('drain timeout + id hygiene (review hardening 2026-07-18)', () => {
  it('drainTimeoutMs: chase() throws instead of hanging when no driver runs the round', async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      const ledger = new TaskLedger({ store });
      const chaser = new GoalChaser({
        ledger,
        evaluator: async () => ({ achieved: true }),
        pollIntervalMs: 50,
        drainTimeoutMs: 1_000,
      });
      // No LedgerDriver anywhere: the dispatched round can never reach terminal.
      const p = chaser.chase({ id: 'stranded', description: 'no driver' });
      const guarded = p.catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(1_200);
      const err = await guarded;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('drain timeout');
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects goal ids containing ':' (session-key separator)", async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const chaser = new GoalChaser({ ledger, evaluator: async () => ({ achieved: true }) });
    await expect(chaser.chase({ id: 'a:b', description: 'x' })).rejects.toThrow(/must not contain ':'/);
  });
});
