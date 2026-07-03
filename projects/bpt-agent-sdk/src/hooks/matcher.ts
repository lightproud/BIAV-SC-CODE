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
 */
const NESTED_QUANTIFIER_RE = /\([^()]*[*+][^()]*\)\s*[*+{]/;

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
  if (NESTED_QUANTIFIER_RE.test(matcher)) {
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
