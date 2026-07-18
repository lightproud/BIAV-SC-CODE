/**
 * Audit r4 (2026-07-17) — regex-guard cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Z2-1: the alternation-overlap detector compared only the FIRST atom of
 *    each branch, so divergent alternations that merely share a leading atom
 *    (`(foo|fox)+`, `(ab|ac)+`) were falsely rejected. The guard now compares
 *    whole branch atom sequences (prefix overlap), so those keep working while
 *    genuine prefix ambiguity (`(a|a)+`, `(a|ab)+`, `(\d|\d\d)+`) still flags.
 *  - U8b-1: `overlaps()` compared branch atoms by exact string equality, so a
 *    class and one of its members — `\w` (`C\w`) vs `a` (`La`) — were judged
 *    disjoint and `(\w|a)+$` slipped past the guard as a real ReDoS (measured
 *    freeze of ~64s). Atom overlap now honours class membership, so the guard
 *    flags it, while class-vs-non-member stays safe (`\w` vs `-`, `\d` vs `.`).
 */

import { describe, expect, it } from 'vitest';

import { guardRegexPattern, hasNestedQuantifier } from '../src/internal/regex-guard.js';

// ---------------------------------------------------------------------------
// Z2-1 — divergent alternation branches are no longer falsely rejected
// ---------------------------------------------------------------------------

describe('audit r4 Z2-1: whole-branch comparison stops false rejection of divergent alternations', () => {
  it('accepts quantified alternations whose branches share a leading atom but diverge', () => {
    // Both branches begin with the same atom, but neither is a prefix of the
    // other, so a single input position can only be consumed one way -> linear.
    for (const pattern of ['(foo|fox)+', '(ab|ac)+', '(cat|car)+', '(abc|abd)+', '(foo|foX)+']) {
      expect(hasNestedQuantifier(pattern)).toBe(false);
      expect(guardRegexPattern(pattern)).toBeNull();
    }
  });

  it('still accepts fully-disjoint alternations (unchanged behaviour)', () => {
    for (const pattern of ['(foo|bar)+', '(ab|cd)*', '(a|b)+']) {
      expect(hasNestedQuantifier(pattern)).toBe(false);
      expect(guardRegexPattern(pattern)).toBeNull();
    }
  });

  it('does NOT loosen the genuine prefix-ambiguity flags', () => {
    // One branch IS a prefix of the other (or they are equal): still dangerous.
    for (const pattern of ['(a|a)+', '(a|ab)+', '(\\d|\\d\\d)+', '(foo|foobar)+', '((a|a))+']) {
      expect(hasNestedQuantifier(pattern)).toBe(true);
      expect(guardRegexPattern(pattern)).toContain('alternation');
    }
  });
});

// ---------------------------------------------------------------------------
// U8b-1 — class-vs-member overlap is now detected (real ReDoS no longer slips)
// ---------------------------------------------------------------------------

describe('audit r4 U8b-1: class-membership-aware overlap catches (\\w|a)+ style ReDoS', () => {
  it('flags a quantified group whose branch overlaps a class member', () => {
    // The exact reported pattern, plus siblings where one branch is a member or
    // subset of the other branch's class.
    for (const pattern of ['(\\w|a)+$', '(\\w|_)+', '(\\d|\\w)+', '(\\w|5)+', '(\\w|\\d)+']) {
      expect(hasNestedQuantifier(pattern)).toBe(true);
      expect(guardRegexPattern(pattern)).toContain('alternation');
    }
  });

  it('keeps class-vs-non-member alternations working (no false rejection)', () => {
    // A hyphen is not a word char; a letter is not a digit; whitespace is not a
    // word char -> disjoint branches -> linear -> must stay accepted.
    for (const pattern of ['(\\w|-)+', '(\\d|x)+', '(\\w|\\s)+', '(\\d|\\.)+', '(\\d|-)+']) {
      expect(hasNestedQuantifier(pattern)).toBe(false);
      expect(guardRegexPattern(pattern)).toBeNull();
    }
  });

  it('rejects (\\w|a)+$ instantly instead of freezing on an adversarial subject', () => {
    // The fix lives in the guard: a rejected pattern is never compiled/run, so
    // the ~64s catastrophic-backtracking freeze can no longer be reached. We
    // assert the guard verdict (and that deciding it is trivially fast); we do
    // NOT execute the unsafe pattern.
    const started = Date.now();
    const reason = guardRegexPattern('(\\w|a)+$');
    expect(Date.now() - started).toBeLessThan(50);
    expect(reason).not.toBeNull();
    expect(reason).toContain('catastrophic backtracking');
  });
});
