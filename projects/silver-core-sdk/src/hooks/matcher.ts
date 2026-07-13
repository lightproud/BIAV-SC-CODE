/**
 * Hook matcher-pattern evaluation.
 *
 * A matcher string is compared against the event's filter value (the tool
 * name for tool hooks):
 *
 *   - omitted / '' / '*'          -> matches everything
 *   - exact-string set            -> when the pattern contains only
 *     [A-Za-z0-9_\-, |] it is split on '|' and ',' into trimmed
 *     alternatives, each compared for string equality
 *   - anything else               -> an UNANCHORED regular expression
 *
 * An invalid regular expression matches nothing; this function never throws.
 *
 * ReDoS guard (finding #24): the regex path runs a USER-supplied pattern
 * against a value that can be attacker-influenced (e.g. an MCP tool name from
 * a third-party server). A nested-quantifier pattern such as `(a+)+$` against a
 * long adversarial value triggers catastrophic backtracking that freezes the
 * event loop synchronously — before Promise.allSettled, so no per-hook timeout
 * can bound it and AbortSignal cannot interrupt it. We defend cheaply and fail
 * closed (treat as no-match) by (a) capping the pattern and value lengths fed
 * to the engine and (b) refusing patterns with a nested quantifier. This never
 * throws; on a guard trip it returns false and emits an optional debug warning.
 */

/** Charset that selects exact-set semantics instead of regex semantics. */
const EXACT_SET_RE = /^[A-Za-z0-9_\-, |]*$/;

/** Regex-path input ceilings. Tool names are short; these are generous. */
const MAX_MATCHER_LENGTH = 1024;
const MAX_VALUE_LENGTH = 1024;

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
function hasNestedQuantifier(pattern: string): boolean {
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

export function matcherMatches(
  matcher: string | undefined,
  value: string | undefined,
  debug?: (msg: string) => void,
): boolean {
  // Omitted or wildcard matchers accept every value.
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  // No filter value on the event side: every registered matcher runs.
  if (value === undefined) return true;

  if (EXACT_SET_RE.test(matcher)) {
    return matcher
      .split(/[|,]/)
      .map((part) => part.trim())
      .some((part) => part === value);
  }

  // --- regex path: apply the ReDoS guard before constructing/testing ---
  if (matcher.length > MAX_MATCHER_LENGTH || value.length > MAX_VALUE_LENGTH) {
    debug?.(
      `hooks matcher: pattern/value exceeds length ceiling ` +
        `(matcher=${matcher.length}, value=${value.length}); treated as no-match`,
    );
    return false;
  }
  if (hasNestedQuantifier(matcher)) {
    debug?.(
      `hooks matcher: pattern "${matcher}" has a nested quantifier ` +
        `(catastrophic-backtracking risk); treated as no-match`,
    );
    return false;
  }

  try {
    return new RegExp(matcher).test(value);
  } catch {
    return false; // invalid regex: match nothing, never throw
  }
}
