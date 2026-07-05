/**
 * E6d standing guard: the per-layer error-class whitelist declared in
 * docs/ARCHITECTURE.md ("Error-class whitelist" table) is enforced
 * mechanically. Scans every src/ file for error-class CONSTRUCTIONS
 * (`new XError(...)` - thrown or handed to a promise reject; both surface to
 * consumers) and fails when a layer constructs a class the table does not
 * allow it. This is how the 12 bare `throw new Error` sites the E6 audit
 * found in src/mcp/ stay fixed: a new one turns the build red.
 *
 * Design choices, mirroring the red-line / api-surface guards:
 *  - regex scan, not AST: the codebase bans computed error construction, so
 *    `new\s+Identifier(` is exact enough, and the guard stays dependency-free;
 *  - the whitelist is PARSED FROM ARCHITECTURE.md rather than duplicated
 *    here, so the document stays the single authority (the E6d brief: the
 *    doc discipline becomes executable). If the table is deleted or
 *    renamed, the guard fails loudly instead of passing on nothing.
 *
 * Universal allowances (declared in the same ARCHITECTURE.md section):
 *  - AbortError anywhere (ground rule 6);
 *  - the foreign-error wrap idiom `new Error(String(err))` anywhere.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const ARCHITECTURE = join(ROOT, 'docs', 'ARCHITECTURE.md');

// ---------------------------------------------------------------------------
// Whitelist: parsed from the ARCHITECTURE.md "Error-class whitelist" table.
// ---------------------------------------------------------------------------

/** Error classes legal in every src/ file. */
const UNIVERSAL = ['AbortError'];

function parseWhitelist(): Array<{ prefix: string; allowed: string[] }> {
  const doc = readFileSync(ARCHITECTURE, 'utf8');
  const anchor = doc.indexOf('### Error-class whitelist');
  expect(anchor, 'ARCHITECTURE.md "Error-class whitelist" section missing').toBeGreaterThan(-1);
  const section = doc.slice(anchor);
  const rows = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|([^|\n]*)\|\s*$/gm)];
  const out: Array<{ prefix: string; allowed: string[] }> = [];
  for (const row of rows) {
    const prefix = row[1];
    const allowed = [...row[2].matchAll(/`([A-Za-z0-9_]+)`/g)].map((m) => m[1]);
    out.push({ prefix, allowed });
  }
  return out;
}

const WHITELIST = parseWhitelist();

function allowedFor(relPath: string): string[] {
  const extra = WHITELIST.filter((w) => relPath.startsWith(w.prefix)).flatMap((w) => w.allowed);
  return [...UNIVERSAL, ...extra];
}

// ---------------------------------------------------------------------------
// Scanner: every `new <ErrorClass>(` construction in src/.
// ---------------------------------------------------------------------------

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...collectSourceFiles(p));
    } else if (name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

type Construction = { file: string; line: number; className: string; snippet: string };

/** The sanctioned foreign-error normalization, e.g. `new Error(String(err))`. */
const WRAP_IDIOM = /^new\s+Error\s*\(\s*String\s*\(/;

function scanFile(abs: string): Construction[] {
  const rel = relative(ROOT, abs).split('\\').join('/');
  const text = readFileSync(abs, 'utf8');
  const out: Construction[] = [];
  // Module-private sentinel classes (declared in the same file, e.g.
  // MirrorTimeoutError in sessions/store-adapter.ts) are the module's own
  // business - allowed, per the ARCHITECTURE.md whitelist prose.
  const localClasses = new Set(
    [...text.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_]*Error)\b/g)].map((m) => m[1]),
  );
  // Matches Error and every *Error identifier; computed construction
  // (new (pick())(...)) does not occur in this codebase by convention.
  const re = /new\s+([A-Z][A-Za-z0-9_]*Error|Error)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (WRAP_IDIOM.test(text.slice(m.index, m.index + 80))) continue;
    if (localClasses.has(m[1])) continue;
    const line = text.slice(0, m.index).split('\n').length;
    out.push({
      file: rel,
      line,
      className: m[1],
      snippet: text.slice(m.index, m.index + 60).split('\n')[0],
    });
  }
  return out;
}

const constructions = collectSourceFiles(SRC).flatMap(scanFile);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe('E6d: layer error-class whitelist (ARCHITECTURE.md is the authority)', () => {
  it('the whitelist table parsed from ARCHITECTURE.md is non-trivial', () => {
    // Wiring check: an edited/renamed table must fail here, not silently
    // whitelist nothing (which would red every layer) or everything.
    expect(WHITELIST.length).toBeGreaterThanOrEqual(5);
    const prefixes = WHITELIST.map((w) => w.prefix);
    expect(prefixes).toContain('src/mcp/');
    expect(prefixes).toContain('src/transport/');
  });

  it('the scanner sees the codebase (guard is not scanning an empty set)', () => {
    expect(constructions.length).toBeGreaterThanOrEqual(30);
    // The known fixed landscape: MCP constructs McpError now.
    expect(
      constructions.some((c) => c.file.startsWith('src/mcp/') && c.className === 'McpError'),
    ).toBe(true);
  });

  it('every error construction in src/ is whitelisted for its layer', () => {
    const offenders = constructions.filter((c) => !allowedFor(c.file).includes(c.className));
    const report = offenders
      .map((c) => `${c.file}:${c.line} new ${c.className} (${c.snippet})`)
      .join('\n');
    expect(offenders, `error-class whitelist violations:\n${report}`).toEqual([]);
  });

  it('bare `new Error` never reappears outside the documented exceptions', () => {
    // Sharper message for the most likely regression (the E6 audit's actual
    // finding): a plain Error gives consumers nothing to route on.
    const bare = constructions.filter(
      (c) => c.className === 'Error' && !allowedFor(c.file).includes('Error'),
    );
    const report = bare.map((c) => `${c.file}:${c.line}`).join(', ');
    expect(bare, `bare new Error() at: ${report} - use a typed class from src/errors.ts`).toEqual(
      [],
    );
  });
});
