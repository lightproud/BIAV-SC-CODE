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
  // Per open group: does its body (at ANY depth) contain a repetition quantifier?
  const bodyHasRepeat: boolean[] = [];
  const markAllOpenGroups = (): void => {
    for (let k = 0; k < bodyHasRepeat.length; k += 1) bodyHasRepeat[k] = true;
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1; // escaped metachar is a literal atom; skip it
      continue;
    }
    if (ch === '[') {
      // character class: consume to the closing ']' so parens/quantifier chars
      // inside it are treated as literals, not structure.
      i += 1;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '(') {
      bodyHasRepeat.push(false);
      continue;
    }
    if (ch === ')') {
      const closedBodyRepeat = bodyHasRepeat.pop() ?? false;
      // Look past optional whitespace for a quantifier applied to THIS group.
      let j = i + 1;
      while (j < pattern.length && /\s/.test(pattern[j] ?? '')) j += 1;
      const outerQuantified = isRepeatQuant(pattern[j]);
      // A repetition-bearing group that is itself repeated = star height >= 2.
      if (outerQuantified && closedBodyRepeat) return true;
      // A quantified group counts as a repetition within its parent's body.
      if (outerQuantified) markAllOpenGroups();
      continue;
    }
    if (isRepeatQuant(ch)) markAllOpenGroups(); // in-body repetition at this depth
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
      'contains a repetition (nested quantifier, e.g. "(a+)+"), which risks ' +
      'catastrophic backtracking; rewrite it without repeating a repeated group'
    );
  }
  return null;
}
