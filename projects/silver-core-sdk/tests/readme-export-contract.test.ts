/**
 * README ↔ code export contract (audit r3 batch N / T51): every symbol the
 * README teaches a consumer to `import … from 'silver-core-agent-sdk'` must
 * actually be exported by the package entry point. W5-1/2 slipped in because
 * the slash retirement (0.63.0) deleted parseLoopCommand / createPromptLoop /
 * LOOP_SLASH_COMMAND / createSessionGoal / GOAL_SLASH_COMMAND but the README
 * kept documenting them as importable — a copy-paste TypeError. This lock
 * fails if the README ever again names a non-existent export in an import.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as pkg from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const README = readFileSync(join(HERE, '..', 'README.md'), 'utf8');

/** Extract the named bindings of every
 *  `import { a, b as c } from 'silver-core-agent-sdk'` in the README. */
function readmeImportedNames(text: string): string[] {
  const names = new Set<string>();
  const importRe =
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]silver-core-(?:agent-)?sdk['"]/g;
  for (const m of text.matchAll(importRe)) {
    for (const raw of (m[1] ?? '').split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

describe('README import contract (batch N / W5-1,W5-2)', () => {
  it('every symbol the README imports from the package is a real export', () => {
    const imported = readmeImportedNames(README);
    // Sanity: the README must actually contain at least one package import,
    // else this lock would be vacuously green.
    expect(imported.length).toBeGreaterThan(0);
    const missing = imported.filter((n) => !(n in pkg));
    expect(missing, `README imports non-existent exports: ${missing.join(', ')}`).toEqual([]);
  });

  it('the retired slash-bridge symbols are gone from the package (stay deleted)', () => {
    for (const gone of [
      'parseLoopCommand',
      'createPromptLoop',
      'LOOP_SLASH_COMMAND',
      'createSessionGoal',
      'GOAL_SLASH_COMMAND',
    ]) {
      expect(gone in pkg, `${gone} must stay removed (slash retirement 0.63.0)`).toBe(false);
    }
  });
});
