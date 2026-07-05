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

/** Number of leading bytes sniffed when deciding whether a file is binary. */
const BINARY_SNIFF_BYTES = 8192;

/** Maximum characters kept per line in cat -n style output. */
const MAX_LINE_CHARS = 2000;

/** Width of the right-aligned line-number column. */
const LINE_NUMBER_WIDTH = 6;

/**
 * Resolve `p` (absolute or cwd-relative) to an absolute path. No containment
 * fence (keeper ruling 2026-07-05, BPT #2): the permission gate is the access
 * control, aligning with official Claude Code. `additional` is accepted for a
 * stable signature but does not gate access here.
 */
export function resolveAbs(cwd: string, p: string): string {
  return path.resolve(cwd, p);
}

/** Heuristic binary sniff: any NUL byte within the first 8KB. */
export function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Format lines in `cat -n` style: right-aligned 6-char line number, a tab,
 * then the line text truncated at 2000 characters.
 */
export function formatCatN(lines: string[], startLine: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const text = raw.length > MAX_LINE_CHARS ? raw.slice(0, MAX_LINE_CHARS) : raw;
    out.push(`${String(startLine + i).padStart(LINE_NUMBER_WIDTH)}\t${text}`);
  }
  return out.join('\n');
}
