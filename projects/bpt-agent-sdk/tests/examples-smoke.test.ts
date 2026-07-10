/**
 * Example smoke + drift guard (audit 2026-07-10 P0-4).
 *
 * examples/electron-host.mjs is the pilot-swap sample MIGRATION.md §3 points
 * BPT Desktop at — and it silently rotted when v0.7 re-encoded the task
 * lifecycle (`task_started` became `system`+subtype and `task_name` became
 * `description`): a host copying the sample stopped receiving subagent
 * events with no error anywhere. This guard (1) syntax-checks every example
 * and (2) asserts each message type / system subtype the samples switch on
 * actually exists in src/types.ts, so the next re-encoding turns a test red
 * instead of a sample stale.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const examplesDir = fileURLToPath(new URL('../examples/', import.meta.url));
const typesSource = readFileSync(
  fileURLToPath(new URL('../src/types.ts', import.meta.url)),
  'utf8',
);

const exampleFiles = readdirSync(examplesDir).filter((f) => f.endsWith('.mjs'));

/** All literal `type: 'x'` values declared in types.ts (SDKMessage arms etc.). */
const declaredTypes = new Set(
  [...typesSource.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1] as string),
);
/** All literal `subtype: 'x'` values declared in types.ts. */
const declaredSubtypes = new Set(
  [...typesSource.matchAll(/subtype: '([a-z_]+)'/g)].map((m) => m[1] as string),
);

describe('examples smoke + message-shape drift guard', () => {
  it('found at least the electron host example', () => {
    expect(exampleFiles).toContain('electron-host.mjs');
  });

  for (const file of exampleFiles) {
    const source = readFileSync(examplesDir + file, 'utf8');

    it(`${file} parses (node --check)`, () => {
      const res = spawnSync(process.execPath, ['--check', examplesDir + file], {
        encoding: 'utf8',
      });
      expect(res.status, res.stderr).toBe(0);
    });

    it(`${file} only switches on message types/subtypes that exist in types.ts`, () => {
      // `case 'x':` inside a switch over msg.type.
      const caseTypes = [...source.matchAll(/case '([a-z_]+)':/g)].map(
        (m) => m[1] as string,
      );
      for (const t of caseTypes) {
        expect(declaredTypes.has(t), `case '${t}' not a declared message type`).toBe(true);
      }
      // `msg.subtype === 'x'` comparisons.
      const subtypeRefs = [...source.matchAll(/\.subtype === '([a-z_]+)'/g)].map(
        (m) => m[1] as string,
      );
      for (const s of subtypeRefs) {
        expect(declaredSubtypes.has(s), `subtype '${s}' not declared`).toBe(true);
      }
    });
  }

  it('electron-host.mjs uses the v0.7 task lifecycle encoding (no retired fields)', () => {
    const source = readFileSync(`${examplesDir}electron-host.mjs`, 'utf8');
    expect(source).not.toContain('task_name'); // renamed to `description` in v0.7
    expect(source).not.toMatch(/case 'task_started'/); // rides system+subtype now
    expect(source).toContain("subtype === 'task_started'");
  });
});
