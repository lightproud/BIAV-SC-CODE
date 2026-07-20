/**
 * Shared filesystem helpers for the built-in FS tools (Read / Write / Edit).
 *
 * Path model (2026-07-05, keeper ruling on BPT report #2): NO hard containment
 * fence. A path is resolved cwd-relative and used as-is - the same posture as
 * official Claude Code, where Read/Write/Edit reach any path the process can
 * and the PERMISSION GATE (permissionMode) is the sole access control, not a
 * second filesystem fence. The old cwd+additionalDirectories fence (v0.1) was
 * BPT-specific, inconsistent (Grep/Glob/Bash never had it) and - with Bash in
 * the tool set - never a real security boundary anyway, only a false sense of
 * one. additionalDirectories retains its real role: sandbox writablePaths.
 * (History: resolveWithin removed here; see CHANGELOG 0.6.4.)
 */

import * as path from 'node:path';
import { isUtf8 } from 'node:buffer';
import { sliceSurrogateSafe } from '../internal/text.js';

/** Default maximum characters kept per line in cat -n style output. */
export const MAX_LINE_CHARS = 2000;

/** Bytes sniffed by looksBinaryForDisplay before declaring a file binary. */
const DISPLAY_BINARY_SNIFF_BYTES = 8192;

/**
 * Default cap on the TOTAL characters one Read returns (BPT request 2026-07-06).
 * The line limit (2000) and per-line cap (2000) bound rows and row-width but
 * not the AGGREGATE — a 2000-line file of medium-length lines can still flood
 * the context. This cap is applied on a LINE BOUNDARY (never mid-line) during
 * formatting; because every line is already <= MAX_LINE_CHARS, 50000 > 2000
 * guarantees at least ~25 lines are emitted, so the output is never empty and
 * an offset continuation never dead-loops. ~50K aligns with the WebFetch cap.
 */
export const MAX_READ_OUTPUT_CHARS = 50000;

/** Width of the right-aligned line-number column. */
const LINE_NUMBER_WIDTH = 6;

/** Structured result of formatCatN: the text plus what bounded it, so the Read
 *  tool can build a footer that reflects the cap that actually took effect. */
export type FormatCatNResult = {
  /** The assembled cat -n output. */
  text: string;
  /** How many of the input lines were emitted (< lines.length when the total-
   *  character cap stopped assembly early on a line boundary). */
  linesEmitted: number;
  /** True when the total-character cap stopped assembly before all input lines
   *  fit (distinct from the caller's line-count limit). */
  charCapped: boolean;
  /** Count of emitted lines that exceeded the per-line cap and were truncated
   *  (each carries a `…[line truncated: N chars total]` marker). */
  truncatedLines: number;
};

/**
 * Resolve `p` (absolute or cwd-relative) to an absolute path. No containment
 * fence (keeper ruling 2026-07-05, BPT #2): the permission gate is the access
 * control, aligning with official Claude Code. `additional` is accepted for a
 * stable signature but does not gate access here.
 */
export function resolveAbs(cwd: string, p: string): string {
  return path.resolve(cwd, p);
}

/**
 * True when `buf` is NOT valid UTF-8 (H1, audit T49). The read-modify-write
 * tools (Edit) decode with Buffer.toString('utf8'), which replaces
 * every invalid sequence with U+FFFD — writing that back re-encodes the
 * replacement characters and permanently corrupts EVERY non-UTF-8 byte in the
 * file, including bytes nowhere near the edit site (GBK / Shift-JIS / Latin-1
 * text passes the NUL sniff below but is not UTF-8). Such files must be
 * refused, not silently mangled.
 */
export function isLossyUtf8(buf: Buffer): boolean {
  return !isUtf8(buf);
}

/**
 * CRLF adaptation for exact-string edits (F2, audit 2026-07-17). Read strips
 * the `\r` from every displayed line, so a multi-line old_string the model
 * copied from a Read of a CRLF file carries bare `\n` separators and can NEVER
 * match the raw `\r\n` content — every retry fails identically. When the
 * direct match misses on a CRLF file, retry with the needle's newlines
 * converted to `\r\n` (and the replacement normalized to `\r\n` so the file's
 * line-ending style is preserved). A needle that already contains `\r\n` was
 * authored against the raw bytes and is left alone.
 */
export function adaptEditToLineEndings(
  text: string,
  oldString: string,
  newString: string,
): { oldString: string; newString: string } {
  if (
    !text.includes(oldString) &&
    text.includes('\r\n') &&
    oldString.includes('\n') &&
    !oldString.includes('\r\n')
  ) {
    const crlfOld = oldString.replace(/\n/g, '\r\n');
    if (text.includes(crlfOld)) {
      return {
        oldString: crlfOld,
        newString: newString.replace(/\r?\n/g, '\r\n'),
      };
    }
  }
  return { oldString, newString };
}

/** Heuristic binary sniff: any NUL byte anywhere in the buffer. The old
 *  first-8KB sniff passed files whose NUL bytes sit past the head (text
 *  header + binary tail) and Edit then corrupted the tail (audit 2026-07-17
 *  L20). Full scan is native memchr — ~ms even at the 50MB read cap. */
export function looksBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

/** Binary sniff for the NON-destructive Read path (Z3-2, audit r4). The full-
 *  buffer looksBinary above is correct for Edit/Write, where a single NUL means
 *  the write-back would corrupt real bytes — but applying it to Read rejects a
 *  perfectly readable 20MB log just because one stray NUL sits past its header.
 *  Read only DISPLAYS bytes, so it sniffs a leading window instead: a genuinely
 *  binary file reveals a NUL right away, while a lone NUL deep in an otherwise
 *  text file stays readable. */
export function looksBinaryForDisplay(buf: Buffer): boolean {
  const n = Math.min(buf.length, DISPLAY_BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Format lines in `cat -n` style: right-aligned 6-char line number, a tab, then
 * the line text. Two caps apply: each line is truncated at `maxLineChars` (a
 * `…[line truncated: N chars total]` marker replaces the silent slice so the
 * model knows the row is incomplete), and the TOTAL output is capped at
 * `maxOutputChars` on a line boundary (never mid-line). The first line is
 * always emitted, so the result is never empty even if that line alone exceeds
 * the total cap. Returns what bounded the output so the caller can footer it.
 */
export function formatCatN(
  lines: string[],
  startLine: number,
  opts?: { maxLineChars?: number; maxOutputChars?: number },
): FormatCatNResult {
  const maxLineChars = opts?.maxLineChars ?? MAX_LINE_CHARS;
  const maxOutputChars = opts?.maxOutputChars ?? MAX_READ_OUTPUT_CHARS;
  const out: string[] = [];
  let running = 0;
  let truncatedLines = 0;
  let charCapped = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    let text: string;
    if (raw.length > maxLineChars) {
      // WV5-4 (audit r3): surrogate-safe slice so the per-line cap never leaves
      // a lone surrogate (the total-cap branch below already uses this helper).
      text = `${sliceSurrogateSafe(raw, maxLineChars)}…[line truncated: ${raw.length} chars total]`;
      truncatedLines += 1;
    } else {
      text = raw;
    }
    const prefix = `${String(startLine + i).padStart(LINE_NUMBER_WIDTH)}\t`;
    const formatted = `${prefix}${text}`;
    // Cost of appending this line = the '\n' join separator (none before the
    // first line) + the formatted text.
    const addition = (out.length === 0 ? 0 : 1) + formatted.length;
    if (running + addition > maxOutputChars) {
      if (out.length === 0) {
        // V6-5 (audit r4): the first line is emitted unconditionally so the
        // output is never empty, but a per-line cap WIDER than the total cap
        // (maxLineChars > maxOutputChars) let that first line blow straight
        // past maxOutputChars, unbounded and with no footer. Bound it to the
        // total cap (surrogate-safe) and flag charCapped so the truncation
        // footer fires.
        const room = Math.max(0, maxOutputChars - prefix.length);
        out.push(`${prefix}${sliceSurrogateSafe(text, room)}`);
      }
      charCapped = true;
      break;
    }
    out.push(formatted);
    running += addition;
  }
  return { text: out.join('\n'), linesEmitted: out.length, charCapped, truncatedLines };
}
