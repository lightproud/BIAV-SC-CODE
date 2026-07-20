/**
 * Audit r5 — MODEL-BASED PROPERTY SWEEP OVER STORE VARIANTS.
 *
 * Extends the round-3 stateful op-model (tests/property-ledger.test.ts) to the
 * store matrix round 4 introduced: the SAME random op sequences run against
 *   (a) plain in-memory store            (putSession fallback path)
 *   (b) putSessionIf CAS store           (#putGuarded CAS path + revision)
 *   (c) chaos store  (~10% of calls throw BEFORE any effect)
 *   (d) liar store   (~10% of mutations APPLY and then throw)
 * with ledger invariants checked after EVERY step and a liveness drain
 * (faults disabled) at sequence end. Coverage is instrumented and asserted
 * (round-3 vacuity lesson): the property must PROVE it exercised the paths.
 *
 * Only public exports are used (import from '../src/index.js').
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  TaskLedger,
  DuplicateSessionError,
  ClaimConflictError,
  InvalidTransitionError,
  TERMINAL_STATES,
} from '../src/index.js';
import type { LedgerStore, SessionFilter, QueryRecord, SessionRecord } from '../src/index.js';

// ---------------------------------------------------------------------------
// Errors that are NEVER legal: a store-side detection of a broken ledger
// invariant (revision regression / non-+1 stamp / illegal fallback).
class RevisionInvariantViolation extends Error {
  constructor(detail: string) {
    super(`revision invariant violated: ${detail}`);
    this.name = 'RevisionInvariantViolation';
  }
}
/** Typed injected store fault (legal on chaos/liar stores only). */
class InjectedFault extends Error {
  constructor(op: string, phase: 'before' | 'after') {
    super(`injected fault (${phase}-effect) in ${op}`);
    this.name = 'InjectedFault';
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Instrumented extends LedgerStore {
  dump(): SessionRecord[];
  rows(): QueryRecord[];
  /** count of accepted putSessionIf writes (CAS stores only) */
  casAccepts(): number;
}

function baseStore(cas: boolean): Instrumented {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  let accepts = 0;
  const store: Instrumented = {
    dump: () => [...sessions.values()].map((s) => ({ ...s })),
    rows: () => queries.map((q) => ({ ...q })),
    casAccepts: () => accepts,
    async putSession(r) {
      if (cas) {
        // Tripwire: with putSessionIf present the ledger must never fall back.
        throw new RevisionInvariantViolation('plain putSession called on a CAS store');
      }
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
  if (cas) {
    store.putSessionIf = async (r, expected) => {
      const current = sessions.get(r.id);
      if (expected === null) {
        if (current !== undefined) return false;
      } else if (current === undefined || (current.revision ?? 0) !== expected) {
        return false;
      }
      // INVARIANT (r4): revision strictly increases by exactly 1 per accepted
      // stored write; a create stamps 1.
      const prev = current?.revision ?? 0;
      if (r.revision !== prev + 1) {
        throw new RevisionInvariantViolation(
          `session '${r.id}': stored rev ${prev} -> stamped ${r.revision} (expected ${prev + 1})`,
        );
      }
      sessions.set(r.id, { ...r });
      accepts += 1;
      return true;
    };
  }
  return store;
}

type FaultMode = 'none' | 'chaos' | 'liar';

/**
 * Fault wrapper. chaos: any store call may throw BEFORE having any effect.
 * liar: a MUTATING call (putSession/appendQuery/putSessionIf) may apply its
 * effect and then throw (putSessionIf lies only when it actually applied).
 * Faults are drawn from a per-run seeded PRNG so shrinking is deterministic,
 * and can be switched off (invariant scans, liveness drain).
 */
function wrapFaulty(
  base: Instrumented,
  mode: FaultMode,
  rng: () => number,
  sw: { on: boolean },
  stats: Stats,
): Instrumented {
  if (mode === 'none') return base;
  const boom = (op: string, phase: 'before' | 'after'): never => {
    stats.faultsInjected += 1;
    throw new InjectedFault(op, phase);
  };
  const pre = (op: string): void => {
    if (mode === 'chaos' && sw.on && rng() < 0.1) boom(op, 'before');
  };
  const post = (op: string): void => {
    if (mode === 'liar' && sw.on && rng() < 0.1) boom(op, 'after');
  };
  const wrapped: Instrumented = {
    dump: () => base.dump(),
    rows: () => base.rows(),
    casAccepts: () => base.casAccepts(),
    async putSession(r) {
      pre('putSession');
      await base.putSession(r);
      post('putSession');
    },
    async getSession(id) {
      pre('getSession');
      return base.getSession(id);
    },
    async listSessions(f?: SessionFilter) {
      pre('listSessions');
      return base.listSessions(f);
    },
    async appendQuery(r) {
      pre('appendQuery');
      await base.appendQuery(r);
      post('appendQuery');
    },
    async listQueries(sessionId) {
      pre('listQueries');
      return base.listQueries(sessionId);
    },
  };
  if (base.putSessionIf !== undefined) {
    wrapped.putSessionIf = async (r, expected) => {
      pre('putSessionIf');
      const applied = await base.putSessionIf!(r, expected);
      if (applied) post('putSessionIf');
      return applied;
    };
  }
  return wrapped;
}

// ---------------------------------------------------------------------------
// Op model
type Op =
  | { op: 'dispatch'; key: number; manual: boolean; maxAttempts: number; delay: number }
  | { op: 'claimDue' }
  | { op: 'claimSession'; key: number; wild: boolean }
  | {
      op: 'recordOutcome';
      key: number;
      wild: boolean;
      fenced: boolean;
      outcome: 'ok' | 'error' | 'timeout';
    }
  | { op: 'backfill'; key: number } // fenced consistent retry against a terminal session
  | { op: 'sweep' }
  | { op: 'advance'; ms: number }
  // Concurrent pairs. On CAS configs the second call goes through a RIVAL
  // TaskLedger instance sharing the store (cross-host race, r4's marquee
  // scenario); on plain configs both go through the SAME instance (the
  // documented safe mode — the per-session mutex serializes them), because
  // dual-host racing on a plain store is the host's problem by contract.
  | { op: 'raceClaim'; key: number }
  | { op: 'raceSettle'; key: number; outcome: 'ok' | 'error' | 'timeout' };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    op: fc.constant('dispatch' as const),
    key: fc.integer({ min: 0, max: 5 }),
    manual: fc.boolean(),
    maxAttempts: fc.integer({ min: 1, max: 3 }),
    delay: fc.integer({ min: 0, max: 5_000 }),
  }),
  fc.record({ op: fc.constant('claimDue' as const) }),
  fc.record({
    op: fc.constant('claimSession' as const),
    key: fc.integer({ min: 0, max: 5 }),
    wild: fc.boolean(),
  }),
  fc.record({
    op: fc.constant('recordOutcome' as const),
    key: fc.integer({ min: 0, max: 5 }),
    wild: fc.boolean(),
    fenced: fc.boolean(),
    outcome: fc.constantFrom('ok' as const, 'error' as const, 'timeout' as const),
  }),
  fc.record({ op: fc.constant('backfill' as const), key: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ op: fc.constant('sweep' as const) }),
  fc.record({ op: fc.constant('advance' as const), ms: fc.integer({ min: 1, max: 40_000 }) }),
  fc.record({ op: fc.constant('raceClaim' as const), key: fc.integer({ min: 0, max: 5 }) }),
  fc.record({
    op: fc.constant('raceSettle' as const),
    key: fc.integer({ min: 0, max: 5 }),
    outcome: fc.constantFrom('ok' as const, 'error' as const, 'timeout' as const),
  }),
);

interface Stats {
  dispatched: number;
  claims: number;
  claimSessionOk: number;
  outcomesOk: number;
  outcomesFail: number; // error/timeout outcomes successfully recorded
  fencedRecords: number; // successful records that passed an explicit fence
  backfills: number; // terminal-branch row backfills that returned normally
  swept: number;
  conflicts: number; // ClaimConflictError observed
  invalidTransitions: number;
  duplicates: number;
  faultsInjected: number;
  doneSeen: number;
  failedSeen: number;
  retryingSeen: number;
  drainIterations: number;
  casAcceptTotal: number;
  raceClaimWins: number;
  raceSettleWins: number;
  runs: number;
}

function newStats(): Stats {
  return {
    dispatched: 0,
    claims: 0,
    claimSessionOk: 0,
    outcomesOk: 0,
    outcomesFail: 0,
    fencedRecords: 0,
    backfills: 0,
    swept: 0,
    conflicts: 0,
    invalidTransitions: 0,
    duplicates: 0,
    faultsInjected: 0,
    doneSeen: 0,
    failedSeen: 0,
    retryingSeen: 0,
    drainIterations: 0,
    casAcceptTotal: 0,
    raceClaimWins: 0,
    raceSettleWins: 0,
    runs: 0,
  };
}

const CLAIM_LEASE_MS = 30_000;

interface Config {
  name: string;
  cas: boolean;
  mode: FaultMode;
}

const CONFIGS: Config[] = [
  { name: 'plain', cas: false, mode: 'none' },
  { name: 'cas', cas: true, mode: 'none' },
  { name: 'chaos-plain', cas: false, mode: 'chaos' },
  { name: 'chaos-cas', cas: true, mode: 'chaos' },
  { name: 'liar-plain', cas: false, mode: 'liar' },
  { name: 'liar-cas', cas: true, mode: 'liar' },
];

async function runSequence(cfg: Config, ops: Op[], faultSeed: number, stats: Stats): Promise<void> {
  stats.runs += 1;
  const base = baseStore(cfg.cas);
  const sw = { on: true };
  const store = wrapFaulty(base, cfg.mode, mulberry32(faultSeed), sw, stats);
  let now = 1_000_000;
  const ledger = new TaskLedger({
    store,
    clock: { now: () => now },
    retry: { maxAttempts: 3, baseDelayMs: 500, factor: 2, maxDelayMs: 8_000 },
    claimLeaseMs: CLAIM_LEASE_MS,
  });
  // Rival host sharing the same store (used by race ops on CAS configs).
  const rival = new TaskLedger({
    store,
    clock: { now: () => now },
    retry: { maxAttempts: 3, baseDelayMs: 500, factor: 2, maxDelayMs: 8_000 },
    claimLeaseMs: CLAIM_LEASE_MS,
  });
  const id = (k: number) => `s${k}`;
  const target = (key: number, wild: boolean, states: string[]): string => {
    if (wild) return id(key);
    const candidates = base
      .dump()
      .filter((s) => states.includes(s.state))
      .map((s) => s.id)
      .sort();
    return candidates.length === 0 ? id(key) : (candidates[key % candidates.length] as string);
  };
  const legal = (err: unknown): boolean => {
    if (err instanceof DuplicateSessionError) {
      stats.duplicates += 1;
      return true;
    }
    if (err instanceof InvalidTransitionError) {
      stats.invalidTransitions += 1;
      return true;
    }
    if (err instanceof ClaimConflictError) {
      stats.conflicts += 1;
      return true;
    }
    if (err instanceof InjectedFault) return cfg.mode !== 'none';
    if (err instanceof Error && /unknown session/.test(err.message)) return true;
    return false;
  };

  const checkInvariants = async (): Promise<void> => {
    // Faults OFF for the scan: invariant reads go through the LEDGER's public
    // read surface against the true store contents.
    sw.on = false;
    try {
      const sessions = base.dump();
      const rawRows = base.rows();
      for (const s of sessions) {
        if (s.state === 'done') stats.doneSeen += 1;
        if (s.state === 'failed') stats.failedSeen += 1;
        if (s.state === 'retrying') stats.retryingSeen += 1;
        // attempts sane: integer, never NaN, bounded.
        expect(Number.isInteger(s.attempts)).toBe(true);
        expect(s.attempts).toBeGreaterThanOrEqual(0);
        expect(s.attempts).toBeLessThanOrEqual(s.maxAttempts + 1);
        // At most one query row per (session, attempt) via LEDGER reads...
        const canon = await ledger.listQueries(s.id);
        const attemptNos = canon.map((q) => q.attempt);
        expect(new Set(attemptNos).size).toBe(attemptNos.length);
        // ...and (single in-process ledger + per-session mutex) the RAW store
        // must not hold duplicates either.
        const rawMine = rawRows.filter((q) => q.sessionId === s.id).map((q) => q.attempt);
        expect(new Set(rawMine).size).toBe(rawMine.length);
        for (const a of attemptNos) {
          expect(a).toBeGreaterThanOrEqual(1);
          expect(a).toBeLessThanOrEqual(s.attempts);
        }
        expect(canon.length).toBeLessThanOrEqual(s.attempts);
        // nextRunAt semantics.
        if (s.state === 'running' || s.state === 'done' || s.state === 'failed') {
          expect(s.nextRunAt).toBeNull();
        }
        if (s.manualClaim === true) expect(s.nextRunAt).toBeNull();
        if (s.state === 'retrying' && s.manualClaim !== true) {
          expect(Number.isFinite(s.nextRunAt)).toBe(true);
        }
        // Terminal state vs its own committed row for the FINAL attempt.
        const finalRow = canon.find((q) => q.attempt === s.attempts);
        if (s.state === 'done' && finalRow !== undefined) {
          expect(finalRow.outcome).toBe('ok');
        }
        if (s.state === 'failed') {
          expect(s.attempts).toBeGreaterThanOrEqual(s.maxAttempts);
          if (finalRow !== undefined) expect(finalRow.outcome).not.toBe('ok');
        }
      }
    } finally {
      sw.on = true;
    }
  };

  for (const op of ops) {
    try {
      if (op.op === 'dispatch') {
        await ledger.dispatch({
          id: id(op.key),
          intent: 'w',
          maxAttempts: op.maxAttempts,
          runAt: op.manual ? null : now + op.delay,
        });
        stats.dispatched += 1;
      } else if (op.op === 'claimDue') {
        const claimed = await ledger.claimDue(now);
        stats.claims += claimed.length;
        for (const s of claimed) {
          // claimDue must never hand out manual-claim sessions, and every
          // claimed record is a running one with its schedule cleared.
          expect(s.manualClaim).not.toBe(true);
          expect(s.state).toBe('running');
          expect(s.nextRunAt).toBeNull();
        }
      } else if (op.op === 'claimSession') {
        await ledger.claimSession(target(op.key, op.wild, ['pending', 'retrying']), now);
        stats.claimSessionOk += 1;
      } else if (op.op === 'recordOutcome') {
        const sid = target(op.key, op.wild, ['running']);
        let attempt: number | undefined;
        if (op.fenced) {
          if (op.wild) {
            attempt = (op.key % 3) + 1; // arbitrary claim: exercises the fence
          } else {
            // Clamp: a never-claimed session has attempts 0, and attempt < 1
            // is rejected eagerly (validated input, not a fence outcome).
            attempt = Math.max(1, base.dump().find((s) => s.id === sid)?.attempts ?? 1);
          }
        }
        await ledger.recordOutcome(sid, {
          outcome: op.outcome,
          startedAt: now,
          endedAt: now,
          ...(attempt !== undefined ? { attempt } : {}),
        });
        if (op.outcome === 'ok') stats.outcomesOk += 1;
        else stats.outcomesFail += 1;
        if (attempt !== undefined) stats.fencedRecords += 1;
      } else if (op.op === 'backfill') {
        // Consistent fenced late retry against a terminal session: either
        // backfills a missing row (crash window) or throws InvalidTransition.
        const candidates = base
          .dump()
          .filter((s) => TERMINAL_STATES.includes(s.state))
          .map((s) => s.id)
          .sort();
        if (candidates.length > 0) {
          const sid = candidates[op.key % candidates.length] as string;
          const s = base.dump().find((x) => x.id === sid)!;
          await ledger.recordOutcome(sid, {
            outcome: s.state === 'done' ? 'ok' : 'error',
            startedAt: now,
            endedAt: now,
            attempt: s.attempts,
          });
          stats.backfills += 1;
        }
      } else if (op.op === 'raceClaim') {
        const sid = target(op.key, false, ['pending', 'retrying']);
        const pre = base.dump().find((s) => s.id === sid)?.attempts ?? 0;
        const second = cfg.cas ? rival : ledger;
        const results = await Promise.allSettled([
          ledger.claimSession(sid, now),
          second.claimSession(sid, now),
        ]);
        let claimWins = 0;
        for (const r of results) {
          if (r.status === 'rejected' && !legal(r.reason)) throw r.reason;
          if (r.status === 'fulfilled') claimWins += 1;
        }
        // At most ONE of a concurrent claim pair may be granted.
        expect(claimWins).toBeLessThanOrEqual(1);
        stats.raceClaimWins += claimWins;
        // Dual-host claim exclusivity (r4): on a CAS store a concurrent pair
        // of claims must advance the attempt counter by AT MOST one; a liar
        // CAS may have applied a claim whose caller saw a fault, but never
        // two. (Same bound holds in the serialized same-instance mode.)
        const post = base.dump().find((s) => s.id === sid)?.attempts ?? 0;
        expect(post).toBeLessThanOrEqual(pre + 1);
      } else if (op.op === 'raceSettle') {
        const sid = target(op.key, false, ['running']);
        const cur = base.dump().find((s) => s.id === sid)?.attempts;
        if (cur !== undefined && cur >= 1) {
          const second = cfg.cas ? rival : ledger;
          // Late holder vs a divergent second settler, both fenced on the
          // CURRENT attempt — settle-then-append must pick ONE winner; the
          // loser fails the CAS (ClaimConflictError) or the transition, and
          // never appends a contradictory second row for the attempt.
          const results = await Promise.allSettled([
            ledger.recordOutcome(sid, { outcome: op.outcome, startedAt: now, endedAt: now, attempt: cur }),
            second.recordOutcome(sid, { outcome: 'error', startedAt: now, endedAt: now, attempt: cur }),
          ]);
          let settleWins = 0;
          for (const r of results) {
            if (r.status === 'rejected' && !legal(r.reason)) throw r.reason;
            if (r.status === 'fulfilled') settleWins += 1;
          }
          // At most ONE of a concurrent settle pair may return success.
          expect(settleWins).toBeLessThanOrEqual(1);
          stats.raceSettleWins += settleWins;
        }
      } else if (op.op === 'sweep') {
        const swept = await ledger.sweepExpiredLeases(now);
        stats.swept += swept.length;
        for (const s of swept) {
          // A swept session is settled: retrying or failed, lease spent.
          expect(['retrying', 'failed']).toContain(s.state);
          expect(s.leaseUntil).toBeNull();
        }
      } else {
        now += op.ms;
      }
    } catch (err) {
      if (!legal(err)) throw err;
    }
    await checkInvariants();
  }

  // --- Liveness drain: faults OFF, every non-terminal session must finish. --
  sw.on = false;
  const nonTerminal = () => base.dump().filter((s) => !TERMINAL_STATES.includes(s.state));
  for (let iter = 0; iter < 50 && nonTerminal().length > 0; iter += 1) {
    stats.drainIterations += 1;
    now += CLAIM_LEASE_MS + 10_001; // past every lease, backoff and dispatch delay
    await ledger.sweepExpiredLeases(now);
    const claimed = await ledger.claimDue(now);
    for (const c of claimed) {
      try {
        await ledger.recordOutcome(c.id, {
          outcome: 'ok',
          startedAt: now,
          endedAt: now,
          attempt: c.attempts,
        });
      } catch (err) {
        if (!legal(err)) throw err;
      }
    }
    for (const s of base
      .dump()
      .filter((x) => x.manualClaim === true && (x.state === 'pending' || x.state === 'retrying'))) {
      try {
        const c = await ledger.claimSession(s.id, now);
        await ledger.recordOutcome(c.id, {
          outcome: 'ok',
          startedAt: now,
          endedAt: now,
          attempt: c.attempts,
        });
      } catch (err) {
        if (!legal(err)) throw err;
      }
    }
  }
  const wedged = nonTerminal();
  expect(
    wedged.map((s) => ({ id: s.id, state: s.state, nextRunAt: s.nextRunAt, lease: s.leaseUntil })),
  ).toEqual([]);
  await checkInvariants();
  stats.casAcceptTotal += base.casAccepts();
}

// ---------------------------------------------------------------------------
describe('r5 model-based property sweep over store variants', () => {
  for (const cfg of CONFIGS) {
    it(`invariants + liveness hold on the ${cfg.name} store`, async () => {
      const stats = newStats();
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbOp, { minLength: 1, maxLength: 40, size: 'max' }),
          fc.integer({ min: 1, max: 2 ** 30 }),
          async (ops, faultSeed) => {
            await runSequence(cfg, ops, faultSeed, stats);
          },
        ),
        // Fixed seed: coverage floors below are calibrated against THIS seed's
        // observed counts, so the non-vacuity gate cannot flake.
        { numRuns: 200, seed: 20260718 },
      );
      // eslint-disable-next-line no-console
      console.log(`[coverage:${cfg.name}]`, JSON.stringify(stats));
      // Non-vacuity floors (round-3 lesson): the sweep must PROVE it drove
      // the machine through its states, not just reject everything.
      expect(stats.dispatched).toBeGreaterThan(200);
      expect(stats.claims + stats.claimSessionOk).toBeGreaterThan(60);
      expect(stats.outcomesOk + stats.outcomesFail).toBeGreaterThan(30);
      expect(stats.fencedRecords).toBeGreaterThan(15);
      expect(stats.doneSeen).toBeGreaterThan(50);
      expect(stats.failedSeen + stats.retryingSeen).toBeGreaterThan(50);
      expect(stats.swept).toBeGreaterThan(5);
      expect(stats.invalidTransitions).toBeGreaterThan(30);
      expect(stats.duplicates).toBeGreaterThan(10);
      expect(stats.raceClaimWins).toBeGreaterThan(50);
      expect(stats.raceSettleWins).toBeGreaterThan(30);
      if (cfg.cas) {
        expect(stats.casAcceptTotal).toBeGreaterThan(500);
        // Cross-host races actually lost CAS writes (r4's ClaimConflictError
        // path was genuinely exercised, not skipped).
        expect(stats.conflicts).toBeGreaterThan(50);
      }
      if (cfg.mode !== 'none') {
        expect(stats.faultsInjected).toBeGreaterThan(50);
        // The crash window (terminal state with a missing audit row) was
        // actually reached and repaired via the terminal-branch backfill.
        expect(stats.backfills).toBeGreaterThanOrEqual(1);
      }
    }, 240_000);
  }
});
