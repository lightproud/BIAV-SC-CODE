/**
 * Import-discipline guard (audit 2026-07-10 F1).
 *
 * docs/ARCHITECTURE.md declares which cross-module imports are legal (the
 * "Import edges" table). This test parses that table and walks every relative
 * import in src/, so the doc stays the executable authority — the same
 * mechanism as the error-class whitelist in error-discipline.test.ts. Before
 * this guard, the import rule existed only as prose and had decayed into 13
 * unguarded violations including an engine<->subagents package cycle.
 *
 * Everywhere-allowed: src/types.ts, src/errors.ts, src/version.ts,
 * src/error-normalize.ts, anything under src/internal/, and files inside the
 * importer's own top-level module. Composition roots (query.ts,
 * session-manager.ts, index.ts) import freely.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const archDoc = readFileSync(
  fileURLToPath(new URL('../docs/ARCHITECTURE.md', import.meta.url)),
  'utf8',
);

const COMPOSITION_ROOTS = new Set(['query.ts', 'session-manager.ts', 'index.ts']);
const ALWAYS_ALLOWED_FILES = new Set([
  'types.ts',
  'errors.ts',
  'version.ts',
  'error-normalize.ts',
]);

/** Parse the "Import edges" table: `src/x/` -> set of allowed `src/y/`. */
function parseEdges(doc: string): Map<string, Set<string>> {
  const section = doc.split('## Import edges')[1]?.split('\n## ')[0];
  expect(section, 'ARCHITECTURE.md "## Import edges" section missing').toBeTruthy();
  const edges = new Map<string, Set<string>>();
  for (const line of (section as string).split('\n')) {
    const m = line.match(/^\|\s*`src\/([a-z-]+)\/`(?:,\s*`src\/([a-z-]+)\/`)?\s*\|(.*)\|\s*$/);
    if (m === null) continue;
    const froms = [m[1], m[2]].filter((x): x is string => x !== undefined);
    const targets = new Set(
      [...(m[3] as string).matchAll(/`src\/([a-z-]+)\/`/g)].map((t) => t[1] as string),
    );
    for (const from of froms) {
      const existing = edges.get(from) ?? new Set<string>();
      for (const t of targets) existing.add(t);
      edges.set(from, existing);
    }
  }
  expect(edges.size, 'Import edges table parsed empty').toBeGreaterThan(5);
  return edges;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Top-level module of a src-relative path: 'engine' for engine/loop.ts,
 *  '' for root files (types.ts, query.ts, ...). */
function moduleOf(srcRelative: string): string {
  const parts = srcRelative.split(sep);
  return parts.length > 1 ? (parts[0] as string) : '';
}

describe('import discipline (ARCHITECTURE.md "Import edges" is the authority)', () => {
  const edges = parseEdges(archDoc);
  const files = walk(srcDir);

  it('sanity: walked a non-trivial tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every relative import follows a declared edge', () => {
    const violations: string[] = [];
    for (const file of files) {
      const srcRel = relative(srcDir, file);
      const fileName = srcRel.split(sep).pop() as string;
      if (moduleOf(srcRel) === '' && COMPOSITION_ROOTS.has(fileName)) continue;
      const fromModule = moduleOf(srcRel);
      const source = readFileSync(file, 'utf8');
      // W3-5 (audit r3): match BOTH static `from '...'` AND dynamic
      // `import('...')` relative specifiers — a dynamic import into a
      // disallowed module would otherwise escape the layering discipline.
      const specifiers = [
        ...[...source.matchAll(/from '(\.[^']+)'/g)].map((m) => m[1] as string),
        ...[...source.matchAll(/\bimport\(\s*'(\.[^']+)'\s*\)/g)].map((m) => m[1] as string),
      ];
      for (const spec of specifiers) {
        const targetAbs = resolve(dirname(file), spec);
        const targetRel = relative(srcDir, targetAbs).replace(/\.js$/, '.ts');
        if (targetRel.startsWith('..')) continue; // outside src (should not happen)
        const targetModule = moduleOf(targetRel);
        const targetFile = targetRel.split(sep).pop() as string;
        // Everywhere-allowed set.
        if (targetModule === '' && ALWAYS_ALLOWED_FILES.has(targetFile)) continue;
        if (targetModule === 'internal') continue;
        if (targetModule === fromModule) continue;
        // Root non-composition files (e.g. tool-types.ts) count as shared types.
        if (targetModule === '' && targetFile === 'tool-types.ts') continue;
        // Declared directed edge?
        const allowed = edges.get(fromModule);
        if (allowed !== undefined && allowed.has(targetModule)) continue;
        violations.push(`${srcRel} -> ${targetRel} (module '${fromModule}' -> '${targetModule}')`);
      }
    }
    expect(violations, `undeclared cross-module imports:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the engine -> subagents cycle stays broken', () => {
    for (const file of files) {
      const srcRel = relative(srcDir, file);
      if (moduleOf(srcRel) !== 'engine') continue;
      const source = readFileSync(file, 'utf8');
      expect(
        /from '\.\.\/subagents\//.test(source),
        `${srcRel} imports from subagents/ — this re-closes the package cycle`,
      ).toBe(false);
    }
  });
});
