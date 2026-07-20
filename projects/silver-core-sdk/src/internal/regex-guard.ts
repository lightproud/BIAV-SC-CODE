/**
 * Shared ReDoS guard for model/user-supplied regular expressions
 * (audit 2026-07-14 M-2).
 *
 * The hooks matcher (src/hooks/matcher.ts) has carried this defense since
 * finding #24: a nested-quantifier pattern such as `(a+)+$` run against an
 * adversarial subject triggers catastrophic backtracking that freezes the
 * event loop SYNCHRONOUSLY — no timeout or AbortSignal can interrupt it. The
 * same attack surface exists wherever a model-supplied pattern is compiled and
 * executed over bulk text (Grep over up-to-10MB files, BashOutput's per-line
 * `filter`), so the heuristic lives here once and every consumer imports it:
 *  - src/hooks/matcher.ts (fails closed: guarded pattern matches nothing)
 *  - src/tools/grep.ts (rejected pattern -> descriptive tool error result)
 *  - src/tools/shells.ts BashOutput filter (same)
 */

/**
 * Ceiling on the length of a PATTERN fed to the RegExp engine (audit r4 U8-2:
 * raised from 1024, which hard-rejected legitimate long-but-linear patterns —
 * a long chain of `|` alternatives or literals). The nested-quantifier
 * heuristic below, NOT this length cap, is the actual ReDoS defense; a long
 * linear pattern is safe to compile. Catastrophic-backtracking cost is driven
 * by the SUBJECT length, capped separately by MAX_REGEX_VALUE_LENGTH.
 */
export const MAX_REGEX_PATTERN_LENGTH = 8192;

/**
 * Ceiling on the length of a VALUE (subject string) tested against a
 * model/user-supplied pattern — the hooks matcher's subject is a tool name
 * (audit r4 U8-2). Decoupled from and far tighter than the PATTERN cap: the
 * subject length is the real driver of catastrophic backtracking, so it stays
 * ~1KB while long linear patterns are let through.
 */
export const MAX_REGEX_VALUE_LENGTH = 1024;

/**
 * Detects a repetition quantifier applied to a group whose body already
 * contains a repetition (star height >= 2), the classic catastrophic-
 * backtracking signature: `(a+)+`, `(a*)+`, `(a+)*`, `(.*x)+`, `(a+){2,}`, ...
 * Intentionally conservative: safe linear patterns like `(foo|bar)+`, `Edit.*`
 * or `^mcp__` do not match and keep working.
 *
 * A single flat regex CANNOT do this correctly: the old detector
 * `/\([^()]*[*+][^()]*\)\s*[*+{]/` used `[^()]*` around the inner quantifier,
 * so it only saw a nested quantifier when the quantified group held NO further
 * parens — `((a+))+` and `(a(b+))+` slipped through and still froze the event
 * loop. We instead walk the pattern with a paren stack, tracking (at every
 * nesting depth) whether the group body contains a repetition, and flag the
 * moment a repetition-bearing group is itself quantified.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const isRepeatQuant = (c: string | undefined): boolean =>
    c === '*' || c === '+' || c === '{';

  // Per open group we track (a) whether its body contains a repetition at ANY
  // depth (star height) and (b) the FULL atom sequence of each alternation
  // branch, so a quantified group whose branches make it exponentially
  // ambiguous — `(a|a)+`, `(a|ab)+`, `(\d|\d\d)+`, `(\w|a)+` — is flagged too.
  // Atom descriptors: 'L<ch>' literal · 'C<class>' \d/\w/[...]-style class ·
  // 'A' bare dot · null unknown (subgroup / anchor — never treated as
  // overlapping).
  //
  // Two branches make the group dangerous when one is a PREFIX of the other
  // under atom overlap (every position up to the shorter branch overlaps).
  // Comparing the WHOLE branch, not just its first atom (audit r4 Z2-1), keeps
  // divergent alternations that merely share a leading atom — `(foo|fox)+`,
  // `(ab|ac)+` — working, while still catching genuine prefix ambiguity.
  //
  // Atom overlap honours class membership (audit r4 U8b-1): `\w` and `a`
  // overlap because 'a' is a word char (so `(\w|a)+` is the real ReDoS it is),
  // whereas `\d` and a literal `.` do not (so `(\d|\.)+` keeps working).

  // Does a literal char `ch` fall inside the class described by `cls`
  // (a shorthand like `\w` or a bracket body like `[a-z]`)? A single class has
  // no quantifier, so testing one char over the engine cannot backtrack.
  const classMatchesChar = (cls: string, ch: string): boolean => {
    switch (cls) {
      case '\\d':
        return /[0-9]/.test(ch);
      case '\\D':
        return !/[0-9]/.test(ch);
      case '\\w':
        return /[A-Za-z0-9_]/.test(ch);
      case '\\W':
        return !/[A-Za-z0-9_]/.test(ch);
      case '\\s':
        return /\s/.test(ch);
      case '\\S':
        return !/\s/.test(ch);
      default:
        try {
          return new RegExp(`^(?:${cls})$`).test(ch);
        } catch {
          return true; // unparseable class body: assume overlap (bias to flag)
        }
    }
  };
  // Do two classes share any member? Identical descriptors certainly do; for
  // the rest a small probe set decides shorthand/bracket intersection exactly
  // enough (misses only on exotic ranges, matching the old exact-equality gap).
  const CLASS_PROBES = ['0', 'a', 'A', '_', '-', ' ', '\n', '.', '!', '\\'];
  const classesOverlap = (a: string, b: string): boolean =>
    a === b || CLASS_PROBES.some((p) => classMatchesChar(a, p) && classMatchesChar(b, p));
  const atomOverlap = (a: string | null, b: string | null): boolean => {
    if (a === null || b === null) return false;
    if (a === 'A' || b === 'A') return true; // bare '.' matches anything
    const aIsClass = a[0] === 'C';
    const bIsClass = b[0] === 'C';
    if (!aIsClass && !bIsClass) return a === b; // literal vs literal
    if (aIsClass && bIsClass) return classesOverlap(a.slice(1), b.slice(1));
    // one literal, one class: is the literal char a member of the class?
    const lit = (aIsClass ? b : a).slice(1);
    const cls = (aIsClass ? a : b).slice(1);
    return classMatchesChar(cls, lit);
  };
  // One branch is a prefix of the other under atom overlap: every position up
  // to the shorter branch overlaps (a divergence anywhere = disjoint = safe).
  const branchesPrefixOverlap = (a: (string | null)[], b: (string | null)[]): boolean => {
    const len = Math.min(a.length, b.length);
    if (len === 0) return false; // an empty branch has no leading atom to share
    for (let i = 0; i < len; i += 1) {
      if (!atomOverlap(a[i] ?? null, b[i] ?? null)) return false;
    }
    return true;
  };
  const hasBranchAmbiguity = (branches: (string | null)[][]): boolean => {
    for (let x = 0; x < branches.length; x += 1) {
      for (let y = x + 1; y < branches.length; y += 1) {
        if (branchesPrefixOverlap(branches[x] ?? [], branches[y] ?? [])) return true;
      }
    }
    return false;
  };

  type GroupState = {
    bodyHasRepeat: boolean;
    branches: (string | null)[][]; // atom sequence per alternation branch
    hasAmbiguousAlt: boolean;
  };
  const groups: GroupState[] = [];
  const markAllOpenRepeat = (): void => {
    for (const g of groups) g.bodyHasRepeat = true;
  };
  const recordAtom = (desc: string | null): void => {
    const top = groups[groups.length - 1];
    if (top !== undefined) top.branches[top.branches.length - 1]?.push(desc);
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      // Class-shorthand escapes keep their class identity; any other escape is
      // a literal atom of that character (`\.` is a literal dot, never 'A').
      recordAtom(
        next === undefined
          ? null
          : /[wdsWDS]/.test(next)
            ? `C\\${next}`
            : `L${next}`,
      );
      i += 1; // escaped metachar is a literal atom; skip it
      continue;
    }
    if (ch === '[') {
      // character class: consume to the closing ']' so parens/quantifier chars
      // inside it are treated as literals, not structure.
      const start = i;
      i += 1;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      recordAtom(`C${pattern.slice(start, i + 1)}`);
      continue;
    }
    if (ch === '(') {
      recordAtom(null); // a subgroup is an opaque atom for the parent branch
      groups.push({
        bodyHasRepeat: false,
        branches: [[]],
        hasAmbiguousAlt: false,
      });
      // Skip non-capturing / named / lookaround prefixes ('?:', '?<name>',
      // '?=', '?!', '?<=', '?<!') so they are not read as branch atoms.
      if (pattern[i + 1] === '?') {
        i += 1;
        if (pattern[i + 1] === '<' && pattern[i + 2] !== '=' && pattern[i + 2] !== '!') {
          while (i < pattern.length && pattern[i] !== '>') i += 1;
        } else if (pattern[i + 1] === ':' || pattern[i + 1] === '=' || pattern[i + 1] === '!') {
          i += 1;
        } else if (pattern[i + 1] === '<') {
          i += 2; // '<=' or '<!'
        }
      }
      continue;
    }
    if (ch === ')') {
      const closed = groups.pop();
      const closedBodyRepeat = closed?.bodyHasRepeat ?? false;
      const closedAmbiguous =
        (closed !== undefined && hasBranchAmbiguity(closed.branches)) ||
        (closed?.hasAmbiguousAlt ?? false);
      // Look past optional whitespace for a quantifier applied to THIS group.
      let j = i + 1;
      while (j < pattern.length && /\s/.test(pattern[j] ?? '')) j += 1;
      const outerQuantified = isRepeatQuant(pattern[j]);
      // A repetition-bearing group that is itself repeated = star height >= 2.
      if (outerQuantified && closedBodyRepeat) return true;
      // A quantified group whose branches overlap = exponential ambiguity.
      if (outerQuantified && closedAmbiguous) return true;
      // Ambiguity survives nesting: `((a|a))+` is as bad as `(a|a)+`.
      const parent = groups[groups.length - 1];
      if (parent !== undefined && closedAmbiguous) parent.hasAmbiguousAlt = true;
      // A quantified group counts as a repetition within its parent's body.
      if (outerQuantified) markAllOpenRepeat();
      continue;
    }
    if (ch === '|') {
      const top = groups[groups.length - 1];
      if (top !== undefined) top.branches.push([]); // start the next branch
      continue;
    }
    if (isRepeatQuant(ch)) {
      markAllOpenRepeat(); // in-body repetition at this depth
      continue;
    }
    if (ch === '?') {
      // Postfix optional quantifier: not an atom of the branch, and — like the
      // pre-existing isRepeatQuant set — deliberately NOT treated as a body
      // repetition, so `(a?)+` keeps its prior classification.
      continue;
    }
    // Anchors and other zero-width syntax are unknown atoms; a bare dot matches
    // anything ('A'); ordinary characters are literal atoms.
    recordAtom(ch === '^' || ch === '$' ? null : ch === '.' ? 'A' : `L${ch}`);
  }
  return false;
}

/**
 * Convenience gate for tool inputs: returns a human-readable rejection reason
 * for a pattern the guard refuses, or null when the pattern is safe to
 * compile. The reason is written for a model to act on (rephrase the pattern),
 * so callers can embed it verbatim in a tool error result. Never throws;
 * syntactic validity is NOT checked here (callers keep their own
 * new RegExp try/catch for that).
 */
export function guardRegexPattern(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return (
      `pattern length ${pattern.length} exceeds the ` +
      `${MAX_REGEX_PATTERN_LENGTH}-character cap`
    );
  }
  if (hasNestedQuantifier(pattern)) {
    return (
      'pattern applies a repetition quantifier to a group that already ' +
      'contains a repetition (nested quantifier, e.g. "(a+)+") or whose ' +
      'alternation branches overlap (e.g. "(a|ab)+"), which risks ' +
      'catastrophic backtracking; rewrite it without repeating a repeated ' +
      'or ambiguous group'
    );
  }
  return null;
}
