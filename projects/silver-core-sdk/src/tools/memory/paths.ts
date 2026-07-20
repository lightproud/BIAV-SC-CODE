/**
 * Memory-path validation (spec R4, release-gating security hard constraint).
 *
 * Every path in every memory command passes through validateMemoryPath()
 * BEFORE any MemoryStore method is called — the SDK layer never trusts a
 * store implementation to defend itself (a store SHOULD still validate as
 * defense in depth, but SDK-side rejection is the contract). The official
 * memory-tool docs list the attack shapes this must reject: prefixes outside
 * `/memories`, `../` / `..\` traversal, and URL-encoded variants such as
 * `%2e%2e%2f`.
 *
 * Memory paths are VIRTUAL: always forward-slash, always rooted at
 * `/memories`. Backslashes are rejected outright (they are never legal in a
 * virtual path, and accepting them invites Windows-separator smuggling).
 */

export const MEMORY_ROOT = '/memories';

/** Thrown on any invalid memory path; `message` is the tool_result content. */
export class MemoryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryPathError';
  }
}

/** Repeatedly URL-decode until stable so nested encodings (%252e -> %2e -> .)
 *  cannot smuggle a traversal past a single-pass decode. Bounded to keep a
 *  hostile mega-nested input from spinning. */
function fullyDecoded(p: string): string {
  let current = p;
  for (let i = 0; i < 8; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed escapes cannot decode further; validate what we have.
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Validate + canonicalize one virtual memory path.
 *
 * Returns the canonical form (`/memories` or `/memories/<segments>` with no
 * `.` / `..` / empty segments). Throws MemoryPathError on anything else.
 */
export function validateMemoryPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new MemoryPathError('Error: Path must be a non-empty string');
  }
  if (raw.includes('\0')) {
    throw new MemoryPathError(`Error: Path contains an invalid NUL byte: ${raw}`);
  }
  if (raw.includes('\\')) {
    throw new MemoryPathError(
      `Error: Path must use forward slashes only, got: ${raw}`,
    );
  }
  // Decode BEFORE structural checks so %2e%2e%2f-style traversal is seen as
  // the `../` it decodes to (docs-listed attack shape). A decoded backslash
  // (%5c) is likewise rejected.
  //
  // Unicode-normalize (NFC) so a path supplied in a different normalization
  // form than a mount declaration (NFD vs NFC — the SAME file on APFS/HFS+)
  // canonicalizes identically; otherwise the byte-wise mount containment
  // checks (mounts.ts) miss and a read-only mount could be bypassed by
  // re-encoding a segment (audit r4 U4-2). NFC (canonical, not compatibility
  // NFKC) never turns non-ASCII into ASCII separators/dots, so it is safe
  // before the structural checks below.
  const decoded = fullyDecoded(raw).normalize('NFC');
  if (decoded.includes('\0')) {
    throw new MemoryPathError(`Error: Path contains an invalid NUL byte: ${raw}`);
  }
  if (decoded.includes('\\')) {
    throw new MemoryPathError(
      `Error: Path must use forward slashes only, got: ${raw}`,
    );
  }
  if (decoded !== MEMORY_ROOT && !decoded.startsWith(MEMORY_ROOT + '/')) {
    throw new MemoryPathError(`Error: Path must start with ${MEMORY_ROOT}, got: ${raw}`);
  }
  // Canonical resolve of the virtual path: any `.` or `..` segment is refused
  // outright (not resolved-and-allowed-if-inside) — a memory path has no
  // legitimate use for either, so the strictest posture costs nothing.
  const segments = decoded.slice(MEMORY_ROOT.length).split('/');
  const kept: string[] = [];
  for (const seg of segments) {
    if (seg === '') continue; // leading + duplicate slashes collapse
    if (seg === '.' || seg === '..') {
      throw new MemoryPathError(
        `Error: Path ${raw} would escape the ${MEMORY_ROOT} directory`,
      );
    }
    // Control characters (TAB / LF / CR / other C0, DEL) would pollute the
    // tab/newline-delimited directory-listing grammar — a filename carrying
    // them forges extra listing rows/columns (audit 2026-07-17 L28).
    if (/[\u0000-\u001f\u007f]/.test(seg)) {
      throw new MemoryPathError(
        `Error: Path segments must not contain control characters, got: ${raw}`,
      );
    }
    kept.push(seg);
  }
  return kept.length === 0 ? MEMORY_ROOT : `${MEMORY_ROOT}/${kept.join('/')}`;
}
