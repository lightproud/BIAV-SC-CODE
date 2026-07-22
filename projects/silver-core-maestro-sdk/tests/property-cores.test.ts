/**
 * T56 audit round 3 — PROPERTY TESTING over the pure cores (fast-check):
 * machine-generated inputs verify algebraic invariants human readers cannot
 * exhaust. A falsified property is a defect; a green sweep at high run counts
 * is dryness evidence for the campaign's honest close-out.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SESSION_STATES,
  TERMINAL_STATES,
  InvalidTransitionError,
  transition,
  backoffDelayMs,
  type SessionEvent,
  type RetryPolicy,
} from '../src/ledger/state.js';
import type { SessionState } from '../src/ledger/types.js';
import {
  validateSpec,
  nextFireAt,
  firesBetween,
  ScheduleSpecError,
  type ScheduleSpec,
} from '../src/schedule/spec.js';
import { validateGraph, readyNodes, graphStatus, GraphError } from '../src/workflow/graph.js';
import { nextGoalAction, type GoalVerdict } from '../src/goal/decision.js';
import { parseWorkflowGraphSource } from '../src/workflow/load.js';

const RUNS = { numRuns: 2_000 };
const HEAVY = { numRuns: 500 };

const arbState = fc.constantFrom<SessionState>(...SESSION_STATES);
const arbEvent = fc.constantFrom<SessionEvent>(
  'claim',
  'attempt:ok',
  'attempt:error',
  'attempt:timeout',
  'cancel',
);

describe('state.ts properties', () => {
  it('transition is TOTAL: a member of the closed set or InvalidTransitionError, nothing else', () => {
    fc.assert(
      fc.property(arbState, arbEvent, fc.nat(20), fc.integer({ min: 1, max: 20 }), (s, e, attempts, maxAttempts) => {
        try {
          const next = transition(s, e, { attempts, maxAttempts });
          expect(SESSION_STATES).toContain(next);
        } catch (err) {
          expect(err).toBeInstanceOf(InvalidTransitionError);
        }
      }),
      RUNS,
    );
  });
  it('terminal states absorb: no event ever leaves done/failed/cancelled', () => {
    fc.assert(
      fc.property(fc.constantFrom<SessionState>(...TERMINAL_STATES), arbEvent, fc.nat(20), (s, e, a) => {
        expect(() => transition(s, e, { attempts: a, maxAttempts: 3 })).toThrowError(InvalidTransitionError);
      }),
      RUNS,
    );
  });
  it('exhaustion is exactly attempts >= maxAttempts on failing outcomes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.constantFrom<SessionEvent>('attempt:error', 'attempt:timeout'),
        (attempts, maxAttempts, e) => {
          const next = transition('running', e, { attempts, maxAttempts });
          expect(next).toBe(attempts >= maxAttempts ? 'failed' : 'retrying');
        },
      ),
      RUNS,
    );
  });
  it('backoffDelayMs: finite, in [0, maxDelayMs], monotone non-decreasing for factor >= 1', () => {
    const arbPolicy: fc.Arbitrary<RetryPolicy> = fc.record({
      maxAttempts: fc.integer({ min: 1, max: 10 }),
      baseDelayMs: fc.integer({ min: 0, max: 1_000_000 }),
      factor: fc.double({ min: 1, max: 100, noNaN: true }),
      maxDelayMs: fc.integer({ min: 0, max: 10_000_000 }),
    });
    fc.assert(
      fc.property(arbPolicy, fc.integer({ min: 1, max: 60 }), (policy, attempt) => {
        const d1 = backoffDelayMs(attempt, policy);
        const d2 = backoffDelayMs(attempt + 1, policy);
        expect(Number.isFinite(d1)).toBe(true);
        expect(d1).toBeGreaterThanOrEqual(0);
        expect(d1).toBeLessThanOrEqual(policy.maxDelayMs);
        expect(d2).toBeGreaterThanOrEqual(d1 - 1e-9);
      }),
      RUNS,
    );
  });
});

// Sane epoch-ms ranges: year ~1970-2200, everyday cadences.
const arbAfter = fc.integer({ min: 0, max: 7_000_000_000_000 });
const arbEvery = fc.oneof(
  fc.integer({ min: 1, max: 90_000_000 }), // 1ms .. 25h
  fc.double({ min: 0.01, max: 10_000, noNaN: true }),
);
const arbEverySpec: fc.Arbitrary<ScheduleSpec> = fc
  .record({
    every: arbEvery,
    anchorAt: fc.option(fc.integer({ min: 0, max: 7_000_000_000_000 }), { nil: undefined }),
  })
  .map(({ every, anchorAt }) => ({
    id: 'p',
    intent: 'x',
    every,
    ...(anchorAt !== undefined ? { anchorAt } : {}),
  }));

describe('spec.ts properties', () => {
  it('nextFireAt is STRICTLY greater and never skips a lattice point', () => {
    fc.assert(
      fc.property(arbEverySpec, arbAfter, (spec, after) => {
        const next = nextFireAt(spec, after);
        expect(next).toBeGreaterThan(after);
        // No-skip: one step back is not still beyond `after` (allow float dust
        // scaled to the magnitude of the numbers involved). Only meaningful
        // once `after` has reached the anchor — before that the anchor itself
        // is the first lattice point and there is nothing earlier to skip.
        const anchor = spec.anchorAt ?? 0;
        if (after >= anchor) {
          const eps = Math.max(Math.abs(next), Math.abs(after), 1) * 1e-12;
          expect(next - (spec.every as number)).toBeLessThanOrEqual(after + eps);
        }
      }),
      HEAVY,
    );
  });
  it('nextFireAt chains strictly increase', () => {
    fc.assert(
      fc.property(arbEverySpec, arbAfter, (spec, after) => {
        const t1 = nextFireAt(spec, after);
        const t2 = nextFireAt(spec, t1);
        expect(t2).toBeGreaterThan(t1);
      }),
      HEAVY,
    );
  });
  it('firesBetween: within window, ascending, capped', () => {
    fc.assert(
      fc.property(
        arbEverySpec,
        arbAfter,
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 1, max: 50 }),
        (spec, after, span, cap) => {
          const until = after + span;
          const fires = firesBetween(spec, after, until, cap);
          expect(fires.length).toBeLessThanOrEqual(cap);
          for (let i = 0; i < fires.length; i += 1) {
            expect(fires[i]!).toBeGreaterThan(after);
            expect(fires[i]!).toBeLessThanOrEqual(until);
            if (i > 0) expect(fires[i]!).toBeGreaterThan(fires[i - 1]!);
          }
        },
      ),
      HEAVY,
    );
  });
  it('dailyAt fires land exactly on hh:mm UTC', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 7_000_000_000_000 }),
        (hour, minute, after) => {
          const spec: ScheduleSpec = { id: 'd', intent: 'x', dailyAt: { hour, minute } };
          const next = nextFireAt(spec, after);
          const d = new Date(next);
          expect(d.getUTCHours()).toBe(hour);
          expect(d.getUTCMinutes()).toBe(minute);
          expect(next).toBeGreaterThan(after);
          expect(next - after).toBeLessThanOrEqual(24 * 60 * 60 * 1_000);
        },
      ),
      HEAVY,
    );
  });
  it('validateSpec fuzz: junk either passes or throws ScheduleSpecError — nothing else', () => {
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        try {
          validateSpec(junk as ScheduleSpec);
        } catch (err) {
          if (!(err instanceof ScheduleSpecError) && !(err instanceof TypeError)) {
            throw new Error(`unexpected error class: ${String(err)}`);
          }
          // TypeError only acceptable for null/undefined property access on
          // non-objects — a structured object must map to ScheduleSpecError.
          if (typeof junk === 'object' && junk !== null && err instanceof TypeError) {
            throw new Error(`object input escaped as TypeError: ${String(err)}`);
          }
        }
      }),
      RUNS,
    );
  });
});

describe('graph.ts properties', () => {
  // Random DAG: nodes n0..nK, deps only point backwards -> always acyclic.
  const arbDag = fc
    .integer({ min: 1, max: 12 })
    .chain((n) =>
      fc.tuple(
        fc.constant(n),
        fc.array(fc.array(fc.integer({ min: 0, max: n - 1 }), { maxLength: 4 }), {
          minLength: n,
          maxLength: n,
        }),
      ),
    )
    .map(([n, depLists]) => ({
      id: 'g',
      nodes: Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        intent: 'x',
        deps: [...new Set(depLists[i]!.filter((d) => d < i).map((d) => `n${d}`))],
      })),
    }));

  it('validateGraph accepts every backward-edge DAG', () => {
    fc.assert(
      fc.property(arbDag, (graph) => {
        validateGraph(graph); // must not throw
      }),
      RUNS,
    );
  });
  it('closing a forward edge over a dependency CHAIN is always caught as a cycle', () => {
    // Base graph is a CHAIN (n_k depends on n_{k-1}), so any forward/self
    // edge n_from -> n_to with to >= from closes a real cycle through the
    // chain path to -> to-1 -> ... -> from. (A forward edge over an
    // arbitrary DAG is NOT necessarily a cycle — the first draft of this
    // property asserted exactly that and was refuted by fast-check, an
    // honest property-statement bug, not a code defect.)
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.nat(), fc.nat(), (n, a, b) => {
        const from = a % n;
        const to = from + (b % (n - from)); // to >= from
        const nodes = Array.from({ length: n }, (_, i) => ({
          id: `n${i}`,
          intent: 'x',
          deps: i > 0 ? [`n${i - 1}`] : [],
        }));
        nodes[from] = { ...nodes[from]!, deps: [...nodes[from]!.deps, `n${to}`] };
        expect(() => validateGraph({ id: 'g', nodes })).toThrowError(GraphError);
      }),
      RUNS,
    );
  });
  it('readyNodes: only undispatched nodes with all deps done, in declaration order', () => {
    const arbStates = (n: number) =>
      fc.array(fc.option(fc.constantFrom<SessionState>(...SESSION_STATES), { nil: undefined }), {
        minLength: n,
        maxLength: n,
      });
    fc.assert(
      fc.property(
        arbDag.chain((g) => fc.tuple(fc.constant(g), arbStates(g.nodes.length))),
        ([graph, stateArr]) => {
          const states: Record<string, SessionState | undefined> = {};
          graph.nodes.forEach((node, i) => {
            if (stateArr[i] !== undefined) states[node.id] = stateArr[i];
          });
          const ready = readyNodes(graph, states);
          const order = graph.nodes.map((node) => node.id);
          // Membership law
          for (const id of ready) {
            expect(states[id]).toBeUndefined();
            const node = graph.nodes.find((x) => x.id === id)!;
            for (const dep of node.deps ?? []) expect(states[dep]).toBe('done');
          }
          // Completeness law (no eligible node is omitted)
          for (const node of graph.nodes) {
            const eligible =
              states[node.id] === undefined && (node.deps ?? []).every((d) => states[d] === 'done');
            expect(ready.includes(node.id)).toBe(eligible);
          }
          // Declaration order
          const idx = ready.map((id) => order.indexOf(id));
          expect([...idx].sort((x, y) => x - y)).toEqual(idx);
        },
      ),
      RUNS,
    );
  });
  it('graphStatus laws: failed dominates; done iff all done; else running', () => {
    fc.assert(
      fc.property(
        arbDag.chain((g) =>
          fc.tuple(
            fc.constant(g),
            fc.array(fc.option(fc.constantFrom<SessionState>(...SESSION_STATES), { nil: undefined }), {
              minLength: g.nodes.length,
              maxLength: g.nodes.length,
            }),
          ),
        ),
        ([graph, stateArr]) => {
          const states: Record<string, SessionState | undefined> = {};
          graph.nodes.forEach((node, i) => {
            if (stateArr[i] !== undefined) states[node.id] = stateArr[i];
          });
          const status = graphStatus(graph, states);
          const vals = graph.nodes.map((node) => states[node.id]);
          if (vals.some((v) => v === 'failed')) expect(status).toBe('failed');
          else if (vals.every((v) => v === 'done')) expect(status).toBe('done');
          else expect(status).toBe('running');
        },
      ),
      RUNS,
    );
  });
});

describe('decision.ts properties', () => {
  const arbVerdict: fc.Arbitrary<GoalVerdict> = fc.oneof(
    fc.constant<GoalVerdict>({ achieved: true }),
    fc.record({
      achieved: fc.constant(false as const),
      feedback: fc.string(),
      impossible: fc.option(fc.boolean(), { nil: undefined }),
    }) as fc.Arbitrary<GoalVerdict>,
  );
  it('total + precedence: achieved > impossible > exhausted > continue', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 100 }), arbVerdict, (round, maxRounds, verdict) => {
        const action = nextGoalAction({ round, maxRounds, verdict });
        if (verdict.achieved) expect(action).toBe('done');
        else if (verdict.impossible === true) expect(action).toBe('impossible');
        else if (round >= maxRounds) expect(action).toBe('exhausted');
        else expect(action).toBe('continue');
      }),
      RUNS,
    );
  });
});

describe('load.ts properties', () => {
  it('parseWorkflowGraphSource NEVER throws on arbitrary strings, and ok implies valid', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), fc.option(fc.constantFrom('json', 'md') as fc.Arbitrary<'json' | 'md'>, { nil: undefined }), (source, format) => {
        const r = parseWorkflowGraphSource(source, format);
        if (r.ok) {
          validateGraph(r.graph); // must not throw: ok is always runnable
        } else {
          expect(typeof r.error).toBe('string');
        }
      }),
      RUNS,
    );
  });
});
