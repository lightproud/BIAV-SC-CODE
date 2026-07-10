/**
 * settingSources default resolver (single source of truth).
 *
 * Bump-pin ruling 2026-07-05 (keeper "确定升钉了"): an OMITTED `settingSources`
 * now defaults to loading all three on-disk sources — user + project + local —
 * matching official Claude Code and the live @anthropic-ai/claude-agent-sdk
 * docs. This reverses the earlier pinned-0.3.199 semantics (omitted = load
 * NOTHING), which was the last behavior-level NEW-IN-DOCS hold, deliberately
 * gated behind the up-pin decision because flipping a default diverges from the
 * pinned conformance arm.
 *
 * An EXPLICIT array is honored verbatim — including the empty array: `[]` is
 * the caller's explicit opt-OUT (load nothing). Only `undefined` (the field is
 * absent) takes the load-all default. This preserves a real off switch while
 * making "just use the preset" load the codebase context a user expects.
 */

import type { SettingSource } from '../types.js';

/** The load-all default applied when `settingSources` is omitted. */
export const DEFAULT_SETTING_SOURCES: readonly SettingSource[] = ['user', 'project', 'local'];

/**
 * Resolve `settingSources` to the effective source list. `undefined` (omitted)
 * → the load-all default; any explicit array (including `[]`) → returned as-is.
 */
export function resolveSettingSources(
  sources: SettingSource[] | undefined,
): SettingSource[] {
  return sources === undefined ? [...DEFAULT_SETTING_SOURCES] : sources;
}
