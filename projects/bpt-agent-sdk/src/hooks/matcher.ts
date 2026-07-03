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
 */

/** Charset that selects exact-set semantics instead of regex semantics. */
const EXACT_SET_RE = /^[A-Za-z0-9_\-, |]*$/;

export function matcherMatches(
  matcher: string | undefined,
  value: string | undefined,
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

  try {
    return new RegExp(matcher).test(value);
  } catch {
    return false; // invalid regex: match nothing, never throw
  }
}
