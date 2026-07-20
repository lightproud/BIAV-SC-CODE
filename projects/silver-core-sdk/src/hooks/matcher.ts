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
 *
 * The heuristic itself lives in src/internal/regex-guard.ts since the audit
 * 2026-07-14 M-2 batch (Grep and BashOutput compile model-supplied patterns
 * over far larger inputs and now share the exact same defense); this module's
 * observable behavior is unchanged.
 */

import {
  hasNestedQuantifier,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_VALUE_LENGTH,
} from '../internal/regex-guard.js';

/** Charset that selects exact-set semantics instead of regex semantics. */
const EXACT_SET_RE = /^[A-Za-z0-9_\-, |]*$/;

// Regex-path input ceilings (audit r4 U8-2): the PATTERN cap and the VALUE cap
// are DECOUPLED. A long-but-linear matcher (a long chain of `|` alternatives)
// is safe to compile, so it rides the generous pattern cap; the SUBJECT length
// is what actually drives catastrophic backtracking, so tool-name values keep
// the tight ~1KB cap.
const MAX_MATCHER_LENGTH = MAX_REGEX_PATTERN_LENGTH;
const MAX_VALUE_LENGTH = MAX_REGEX_VALUE_LENGTH;

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
