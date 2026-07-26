/**
 * Governance guard: no literal terminal-state comparison anywhere in src.
 *
 * Why this test exists (design review 2026-07-26 F1). 0.76.0 added the
 * `cancelled` terminal to the state machine and updated the ledger and the
 * driver thoroughly. Three scenario-layer readers spelled their terminal test
 * as `state === 'done' || state === 'failed'`, kept compiling, kept passing
 * every one of the 362 tests, and silently treated a cancelled session as
 * still in flight — `graphStatus` reported 'running' forever and
 * `GoalChaser` polled until a drain timeout that is unset by default.
 *
 * Note what did NOT catch it: five audit rounds (67 real defects), three
 * fast-check property suites, six mutation-ratchet targets at floors 97–100.
 * Mutation testing cannot catch it because every branch of the old
 * `graphStatus` WAS behaviorally pinned — pinned to the wrong vocabulary, and
 * a missing case produces no surviving mutant. The failure mode is "a
 * convention's radius did not reach every reader", which produces no test
 * signal at all.
 *
 * So the enforcement has to be lexical: forbid the spelling. Adding a seventh
 * state must fail loudly at the one place the vocabulary is defined
 * (`TERMINAL_STATES` / `UNSUCCESSFUL_TERMINAL_STATES`) instead of leaving N
 * readers to be found by hand.
 *
 * Scope note: this guard covers `src/` only. Tests legitimately assert on
 * specific states by name — that is what makes them tests.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SESSION_STATES,
  TERMINAL_STATES,
  UNSUCCESSFUL_TERMINAL_STATES,
  isTerminal,
  isUnsuccessfulTerminal,
  type SessionState,
} from 'silver-core-maestro-sdk';

const SRC = join(fileURLToPath(new URL('..', import.meta.url)), 'src');

function srcFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...srcFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * A comparison against a terminal-state literal, e.g. `=== 'done'` or
 * `!== "failed"`. `state.ts` and `types.ts` are the vocabulary's DEFINITION
 * site and are exempt — the sets have to be spelled out somewhere.
 */
const PAIR_RE =
  /(?:===|!==)\s*['"](?:done|failed|cancelled)['"][^;{}]{0,120}?(?:===|!==)\s*['"](?:done|failed|cancelled)['"]/g;
/** The vocabulary's own definition site: the sets must be spelled out somewhere. */
const EXEMPT = new Set(['ledger/state.ts', 'ledger/types.ts']);
const OPT_OUT = 'terminal-literal-ok:';

/**
 * Was the match opted out by a marker in the comment above it? The window is
 * the preceding OPT_OUT_WINDOW lines plus the match's own line, because the
 * marker belongs inside the comment that explains the exemption — and such a
 * comment runs several lines. Wide enough to hold a real explanation, narrow
 * enough that one exemption cannot cover an unrelated pair further down.
 */
const OPT_OUT_WINDOW = 8;
function optedOut(text: string, lines: string[], index: number): boolean {
  const line = text.slice(0, index).split('\n').length;
  return lines
    .slice(Math.max(0, line - 1 - OPT_OUT_WINDOW), line)
    .join('\n')
    .includes(OPT_OUT);
}

describe('terminal-state vocabulary is centralized', () => {
  it('src spells no terminal test as a literal pair', () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      const name = file.slice(SRC.length + 1).split('\\').join('/');
      if (EXEMPT.has(name)) continue;
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      for (const m of text.matchAll(PAIR_RE)) {
        if (optedOut(text, lines, m.index)) continue;
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${name}:${line} ${m[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the guard is not vacuous: it flags the exact spelling that caused F1', () => {
    // Negative control. If the regex ever stops matching the pre-0.78.0
    // spelling, the test above becomes decoration that can never fail.
    const f1 = "if (session.state === 'done' || session.state === 'failed') return session;";
    expect([...f1.matchAll(PAIR_RE)].length).toBe(1);
  });

  it('the guard does NOT punish legitimate single-state checks', () => {
    // Banning every mention of a terminal name would flag correct code — a dep
    // must be 'done' SPECIFICALLY, not merely terminal — and the first person
    // to hit that would rightly delete the guard.
    const fine = [
      "if (state === 'cancelled') return { ...session };",
      "(node.deps ?? []).every((dep) => stateOf(states, dep) === 'done')",
      "const next: SessionState = 'failed';",
    ].join('\n');
    expect([...fine.matchAll(PAIR_RE)].length).toBe(0);
  });

  it('honest scope limit: a pair split across statements is NOT caught here', () => {
    // graphStatus's original form spread its two literals over two statements,
    // so this guard would not have caught F1's workflow half — the behavioral
    // locks in design-review-20260726.test.ts do. Asserted so no future reader
    // assumes more coverage than exists.
    const split = "if (state === 'failed') return 'failed';\nif (state !== 'done') allDone = false;";
    expect([...split.matchAll(PAIR_RE)].length).toBe(0);
  });

  it('the opt-out marker suppresses a pair from anywhere in its explaining comment', () => {
    const text = [
      '// terminal-literal-ok: attempt-settled, deliberately not the terminal set',
      '// cancelled is terminal too but has its own branch above, and widening',
      '// this would let a late attempt result backfill into a cancelled session.',
      "if (s === 'done' || s === 'failed') {}",
    ].join('\n');
    const lines = text.split('\n');
    const hits = [...text.matchAll(PAIR_RE)].filter((m) => !optedOut(text, lines, m.index));
    expect(hits.length).toBe(0);
  });

  it('the opt-out does NOT reach past its window', () => {
    // Otherwise one exemption would silently license every pair below it.
    const text = [
      '// terminal-literal-ok: the one below this is exempt',
      "if (s === 'done' || s === 'failed') {}",
      ...Array.from({ length: OPT_OUT_WINDOW + 1 }, () => '// filler'),
      "if (t === 'done' || t === 'failed') {}",
    ].join('\n');
    const lines = text.split('\n');
    const hits = [...text.matchAll(PAIR_RE)].filter((m) => !optedOut(text, lines, m.index));
    expect(hits.length).toBe(1);
  });
});

describe('terminal predicates cover the closed state set exhaustively', () => {
  // Exhaustive over SESSION_STATES rather than a hand-listed sample: adding a
  // seventh state makes these fail until it is classified, which is the whole
  // point of the exercise.
  it('isTerminal agrees with TERMINAL_STATES for every state', () => {
    for (const state of SESSION_STATES) {
      expect(isTerminal(state)).toBe(TERMINAL_STATES.includes(state));
    }
  });

  it('isUnsuccessfulTerminal agrees with UNSUCCESSFUL_TERMINAL_STATES for every state', () => {
    for (const state of SESSION_STATES) {
      expect(isUnsuccessfulTerminal(state)).toBe(UNSUCCESSFUL_TERMINAL_STATES.includes(state));
    }
  });

  it('classifies each of the six states by name (byte-level pin)', () => {
    const table: Array<[SessionState, boolean, boolean]> = [
      // state, isTerminal, isUnsuccessfulTerminal
      ['pending', false, false],
      ['running', false, false],
      ['retrying', false, false],
      ['failed', true, true],
      ['done', true, false],
      ['cancelled', true, true],
    ];
    expect(table.length).toBe(SESSION_STATES.length);
    for (const [state, terminal, unsuccessful] of table) {
      expect([state, isTerminal(state), isUnsuccessfulTerminal(state)]).toEqual([
        state,
        terminal,
        unsuccessful,
      ]);
    }
  });

  it('done is the ONLY successful terminal', () => {
    const successful = SESSION_STATES.filter((s) => isTerminal(s) && !isUnsuccessfulTerminal(s));
    expect(successful).toEqual(['done']);
  });

  it('every unsuccessful terminal is a terminal', () => {
    for (const state of UNSUCCESSFUL_TERMINAL_STATES) expect(isTerminal(state)).toBe(true);
  });
});
