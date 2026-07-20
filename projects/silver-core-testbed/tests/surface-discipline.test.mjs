/**
 * 红线自守 (施工封面 §0.1): the testbed may import ONLY the two family
 * packages' public bare specifiers. A deep/dist path or a relative reach
 * into projects/silver-core-{sdk,maestro-sdk} would silently void the
 * "second consumer over public surfaces" proof — so the testbed polices its
 * own sources the same way check-dep-direction polices the family.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTBED = resolve(fileURLToPath(import.meta.url), '..', '..');
const SCAN_DIRS = ['src', 'scripts', 'tests'];

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(mjs|js|ts)$/.test(name)) yield p;
  }
}

const specifiersOf = (text) =>
  [...text.matchAll(/\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => m[1] ?? m[2]);

describe('testbed surface discipline', () => {
  it('imports only bare public specifiers of the two family packages', () => {
    const violations = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(TESTBED, dir))) {
        for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
          const isFamilyBare = spec === 'silver-core-agent-sdk' || spec === 'silver-core-maestro-sdk';
          const isFamilyDeep =
            /^silver-core-(agent-sdk|maestro-sdk|sdk)\//.test(spec) ||
            spec === 'silver-core-sdk' ||
            /silver-core-(sdk|maestro-sdk)\/(src|dist)/.test(spec) ||
            (spec.startsWith('.') && /\.\..*silver-core-(sdk|maestro-sdk)/.test(spec));
          if (isFamilyDeep && !isFamilyBare) {
            violations.push(`${file}: '${spec}'`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('stays private and unversioned-from-the-lockstep-clock', () => {
    const pkg = JSON.parse(readFileSync(join(TESTBED, 'package.json'), 'utf8'));
    expect(pkg.private).toBe(true);
    expect(pkg.version).toBe('0.0.0');
  });
});
