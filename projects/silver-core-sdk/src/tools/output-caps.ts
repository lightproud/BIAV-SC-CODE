/**
 * Read-only registry of the built-in tools' output caps (BPT-EXTENSION,
 * black-pool request 2026-07-28 "从包入口导出 estimateTextTokens 与
 * MAX_READ_OUTPUT_CHARS"): a host UI ("上下文构成" panel and kin) can label
 * "tool output is capped at N" truthfully per installed SDK version instead
 * of guessing by release notes.
 *
 * Anti-drift rule: every value here is IMPORTED from the constant the tool
 * actually enforces — never re-literalled. If a tool's cap moves, this object
 * follows in the same commit by construction.
 *
 * Semantics vary by key and are part of the contract:
 * - `read`     — max TOTAL characters one Read returns (head-kept, cut on a
 *                line boundary; fsutil.ts MAX_READ_OUTPUT_CHARS).
 * - `bash`     — max TOTAL characters one Bash call returns (TAIL-kept: the
 *                earliest chars are dropped first; bash.ts STREAM_CAP_CHARS).
 * - `webFetch` — max TOTAL characters one WebFetch returns (head-kept;
 *                webfetch.ts aliases the Read cap by reference).
 * - `grepHeadLimit` — default max returned lines/ENTRIES (not characters)
 *                when the caller passes no head_limit (grep.ts).
 */

import { MAX_READ_OUTPUT_CHARS } from './fsutil.js';
import { STREAM_CAP_CHARS } from './bash.js';
import { MAX_OUTPUT_CHARS as WEBFETCH_MAX_OUTPUT_CHARS } from './webfetch.js';
import { DEFAULT_HEAD_LIMIT } from './grep.js';

/** Frozen map of built-in tool output caps. See module doc for per-key units. */
export const TOOL_OUTPUT_CAPS = Object.freeze({
  read: MAX_READ_OUTPUT_CHARS,
  bash: STREAM_CAP_CHARS,
  webFetch: WEBFETCH_MAX_OUTPUT_CHARS,
  grepHeadLimit: DEFAULT_HEAD_LIMIT,
} as const);
