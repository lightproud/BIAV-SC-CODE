/**
 * Shared filesystem helpers for the built-in FS tools (Read / Write / Edit).
 *
 * Containment model (v0.1): a path is accessible iff, after `path.resolve`,
 * it is lexically inside the session cwd or one of the configured additional
 * directories. The check is a prefix comparison on `path.sep` boundaries.
 * Symlink escapes are NOT resolved/blocked in v0.1 (documented limitation).
 */

import * as path from 'node:path';

/** Number of leading bytes sniffed when deciding whether a file is binary. */
const BINARY_SNIFF_BYTES = 8192;

/** Maximum characters kept per line in cat -n style output. */
const MAX_LINE_CHARS = 2000;

/** Width of the right-aligned line-number column. */
const LINE_NUMBER_WIDTH = 6;

/**
 * Resolve `p` (absolute or cwd-relative) and verify it falls inside the cwd
 * or one of the additional directories. Additional directory entries may
 * themselves be relative to cwd.
 */
export function resolveWithin(
  cwd: string,
  additional: string[],
  p: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const abs = path.resolve(cwd, p);
  const roots = [cwd, ...additional].map((r) => path.resolve(cwd, r));
  for (const root of roots) {
    if (abs === root) {
      return { ok: true, abs };
    }
    // Boundary-safe prefix check: '/a/bc' must not match root '/a/b'.
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs.startsWith(prefix)) {
      return { ok: true, abs };
    }
  }
  const allowed = roots.map((r) => `"${r}"`).join(', ');
  return {
    ok: false,
    reason: `Path "${abs}" is outside the allowed directories (${allowed}).`,
  };
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
