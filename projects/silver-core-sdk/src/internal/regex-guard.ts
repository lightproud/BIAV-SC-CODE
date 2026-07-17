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
 * Ceiling on the length of a pattern (and, for the hooks matcher, the value)
 * fed to the RegExp engine. Backtracking cost grows with input size; tool
 * patterns and tool names are far shorter than this in practice.
 */
export const MAX_REGEX_PATTERN_LENGTH = 1024;

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
  // Per open group: does its body (at ANY depth) contain a repetition
  // quantifier? Alongside (M2, audit 2026-07-17): the first atom of each
  // top-level branch inside the group, so a quantified group whose alternation
  // branches OVERLAP — `(a|a)+`, `(a|ab)+`, `(\d|\d\d)+` — is flagged too.
  // Star height 1 is enough for catastrophic backtracking when the branches
  // are ambiguous: every input position doubles the match paths. Branch-first
  // comparison keeps the guard conservative: `(foo|bar)+` (disjoint first
  // atoms) and unquantified alternations keep working. First-atom descriptors:
  //   'L<ch>' literal · 'C<class>' \d/\w/[...]-style class · 'A' bare dot ·
  //   null unknown (subgroup / anchor — never treated as overlapping).
  type GroupState = {
    bodyHasRepeat: boolean;
    branchFirsts: (string | null)[];
    expectingFirst: boolean;
    hasAmbiguousAlt: boolean;
  };
  const groups: GroupState[] = [];
  const markAllOpenRepeat = (): void => {
    for (const g of groups) g.bodyHasRepeat = true;
  };
  const recordFirst = (desc: string | null): void => {
    const top = groups[groups.length - 1];
    if (top !== undefined && top.expectingFirst) {
      top.branchFirsts.push(desc);
      top.expectingFirst = false;
    }
  };
  const overlaps = (a: string | null, b: string | null): boolean => {
    if (a === null || b === null) return false;
    if (a === 'A' || b === 'A') return true; // bare '.' matches anything
    return a === b;
  };
  const anyBranchOverlap = (firsts: (string | null)[]): boolean => {
    for (let x = 0; x < firsts.length; x += 1) {
      for (let y = x + 1; y < firsts.length; y += 1) {
        if (overlaps(firsts[x] ?? null, firsts[y] ?? null)) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      // Class-shorthand escapes keep their class identity; any other escape is
      // a literal atom of that character (`\.` is a literal dot, never 'A').
      recordFirst(
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
      recordFirst(`C${pattern.slice(start, i + 1)}`);
      continue;
    }
    if (ch === '(') {
      recordFirst(null); // a subgroup is an opaque first atom for the parent
      groups.push({
        bodyHasRepeat: false,
        branchFirsts: [],
        expectingFirst: true,
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
        (closed !== undefined && anyBranchOverlap(closed.branchFirsts)) ||
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
      if (top !== undefined) top.expectingFirst = true;
      continue;
    }
    if (isRepeatQuant(ch)) {
      markAllOpenRepeat(); // in-body repetition at this depth
      continue;
    }
    // Anchors and other zero-width syntax are unknown first atoms; a bare dot
    // matches anything ('A'); ordinary characters are literal first atoms.
    recordFirst(ch === '^' || ch === '$' ? null : ch === '.' ? 'A' : `L${ch}`);
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
