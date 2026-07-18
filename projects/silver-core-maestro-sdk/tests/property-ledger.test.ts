/**
 * T56 round 3 — MODEL-BASED property testing of the STATEFUL ledger layer:
 * random operation sequences (dispatch / claimDue / claimSession /
 * recordOutcome / clock advance) against invariants that must hold after
 * EVERY step. Round 2 found its bugs in exactly this layer (claim stealing,
 * retry duplication, manual-claim decay), so the sweep hammers the same
 * ground with machine-generated interleavings.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TaskLedger, DuplicateSessionError } from '../src/ledger/ledger.js';
import { InvalidTransitionError } from '../src/ledger/state.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

function memoryStore(): LedgerStore & { dump: () => SessionRecord[]; rows: () => QueryRecord[] } {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    dump: () => [...sessions.values()].map((s) => ({ ...s })),
    rows: () => queries.map((q) => ({ ...q })),
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

type Op =
  | { op: 'dispatch'; key: number; manual: boolean; maxAttempts: number; delay: number }
  | { op: 'claimDue' }
  | { op: 'claimSession'; key: number; wild: boolean }
  | { op: 'recordOutcome'; key: number; wild: boolean; outcome: 'ok' | 'error' | 'timeout' }
  | { op: 'advance'; ms: number };

/**
 * State-aware targeting: a purely random key almost never hits a session in
 * the state the op needs (an instrumented probe measured recordOutcome
 * succeeding 3 times across 300 runs — the system deadlocked in 'running'
 * and the retry-chain invariants went untested). Non-wild ops therefore pick
 * their target from the sessions currently in an actionable state (key acts
 * as a deterministic index); wild ops keep the raw key to exercise the
 * legal-rejection paths.
 */
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
    outcome: fc.constantFrom('ok' as const, 'error' as const, 'timeout' as const),
  }),
  fc.record({ op: fc.constant('advance' as const), ms: fc.integer({ min: 1, max: 10_000 }) }),
);

describe('ledger model-based properties', () => {
  it('invariants hold after every step of any operation interleaving', async () => {
    await fc.assert(
      // size: 'max' biases toward long op sequences — fast-check's default
      // small-array bias left deep retry chains nearly unvisited (probe data);
      // shrinking still minimizes any counterexample back down.
      fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 60, size: 'max' }), async (ops) => {
        const store = memoryStore();
        let now = 1_000_000;
        const ledger = new TaskLedger({
          store,
          clock: { now: () => now },
          retry: { maxAttempts: 3, baseDelayMs: 500, factor: 2, maxDelayMs: 8_000 },
        });
        const id = (k: number) => `s${k}`;
        // Deterministic state-aware target: index into the sessions currently
        // in one of `states` (sorted by id for stability), or fall back to the
        // raw key when none exist / the op is wild.
        const target = (key: number, wild: boolean, states: string[]): string => {
          if (wild) return id(key);
          const candidates = store
            .dump()
            .filter((s) => states.includes(s.state))
            .map((s) => s.id)
            .sort();
          return candidates.length === 0 ? id(key) : (candidates[key % candidates.length] as string);
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
            } else if (op.op === 'claimDue') {
              const claimed = await ledger.claimDue(now);
              // claimDue must NEVER hand out a manual-claim session.
              for (const s of claimed) expect(s.manualClaim).not.toBe(true);
            } else if (op.op === 'claimSession') {
              await ledger.claimSession(target(op.key, op.wild, ['pending', 'retrying']), now);
            } else if (op.op === 'recordOutcome') {
              await ledger.recordOutcome(target(op.key, op.wild, ['running']), {
                outcome: op.outcome,
                startedAt: now,
                endedAt: now,
              });
            } else {
              now += op.ms;
            }
          } catch (err) {
            // Legal rejections only — anything else is a defect.
            const legal =
              err instanceof DuplicateSessionError ||
              err instanceof InvalidTransitionError ||
              (err instanceof Error && /unknown session/.test(err.message));
            if (!legal) throw err;
          }

          // --- Invariants after EVERY step -------------------------------
          const sessions = store.dump();
          const rows = store.rows();
          for (const s of sessions) {
            // 1. One query row per completed attempt, never more (r2:
            //    recordOutcome idempotency / no duplication).
            const mine = rows.filter((q) => q.sessionId === s.id);
            expect(mine.length).toBeLessThanOrEqual(s.attempts);
            const attemptNos = mine.map((q) => q.attempt);
            expect(new Set(attemptNos).size).toBe(attemptNos.length); // unique per attempt
            for (const a of attemptNos) {
              expect(a).toBeGreaterThanOrEqual(1);
              expect(a).toBeLessThanOrEqual(s.attempts);
            }
            // 2. attempts never exceed maxAttempts + (claims are counted at
            //    claim time, so a claimed-but-unrecorded attempt may be in
            //    flight — cap is maxAttempts, claims beyond terminal throw).
            expect(s.attempts).toBeLessThanOrEqual(s.maxAttempts + 1);
            // 3. nextRunAt semantics: null while running/terminal; a
            //    manual-claim session keeps null in EVERY state (r2).
            if (s.state === 'running' || s.state === 'done' || s.state === 'failed') {
              expect(s.nextRunAt).toBeNull();
            }
            if (s.manualClaim === true) expect(s.nextRunAt).toBeNull();
            // 4. retrying non-manual sessions are schedulable in the future
            //    relative to SOME observed clock (finite, not NaN).
            if (s.state === 'retrying' && s.manualClaim !== true) {
              expect(Number.isFinite(s.nextRunAt)).toBe(true);
            }
            // 5. terminal exhaustion honesty: a failed session used up its
            //    attempts (or was failed by its final outcome).
            if (s.state === 'failed') expect(s.attempts).toBeGreaterThanOrEqual(s.maxAttempts);
          }
        }
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});
