/**
 * Audit wave 20 — .mcp.json loader: "Never throws" was not true.
 *
 * loadProjectMcpServers documents "never throwing" three times (module header,
 * doc comment, and the guarded read/parse paths that implement it), but the
 * `${VAR}` expansion walks each server entry RECURSIVELY. JSON.parse accepts
 * nesting far deeper than a recursive JS function survives — measured: 5,000
 * levels parse fine and blow the stack on the walk — so a `.mcp.json` carrying
 * a deeply nested value threw a RangeError straight out of the loader, killing
 * query construction with a stack-overflow message that names nothing about the
 * config file that caused it.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadProjectMcpServers } from '../src/mcp/project-config.js';

const dirs: string[] = [];

function projectWith(json: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bpt-w20-mcp-'));
  dirs.push(dir);
  writeFileSync(join(dir, '.mcp.json'), json);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true });
  }
});

function nested(depth: number): string {
  return `${'['.repeat(depth)}"x"${']'.repeat(depth)}`;
}

describe('wave20: the .mcp.json loader honors its never-throws contract', () => {
  it('a deeply nested entry is refused, not a RangeError out of the loader', () => {
    const dir = projectWith(`{"mcpServers":{"deep":{"args":${nested(6000)}}}}`);
    const lines: string[] = [];
    let out: Record<string, unknown> = {};
    expect(() => {
      out = loadProjectMcpServers(dir, ['project'], (m) => lines.push(m));
    }).not.toThrow();
    expect(Object.keys(out)).toEqual([]);
    expect(lines.some((l) => l.includes('deep') && l.includes('nested deeper than'))).toBe(true);
  });

  it('one over-deep entry does not take its well-formed siblings down', () => {
    const dir = projectWith(
      `{"mcpServers":{"deep":{"args":${nested(6000)}},"ok":{"command":"node","args":["s.js"]}}}`,
    );
    const out = loadProjectMcpServers(dir, ['project'], () => {});
    expect(Object.keys(out)).toEqual(['ok']);
  });

  // --- negative controls: ordinary configs are untouched --------------------

  it('a normal entry still loads and still expands ${VAR}', () => {
    const dir = projectWith(
      '{"mcpServers":{"s":{"command":"node","args":["${SCRIPT}"],' +
        '"env":{"K":"${MISSING:-fallback}"},"headers":{"Authorization":"Bearer ${TOK}"}}}}',
    );
    const out = loadProjectMcpServers(dir, ['project'], () => {}, {
      SCRIPT: 'server.js',
      TOK: 'abc',
    }) as Record<string, Record<string, unknown>>;
    expect(out.s?.args).toEqual(['server.js']);
    expect(out.s?.env).toEqual({ K: 'fallback' });
    expect(out.s?.headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('nesting within the sane range is expanded, not refused', () => {
    // 8 levels of arrays — well inside the ceiling, and every leaf expands.
    const dir = projectWith(
      `{"mcpServers":{"s":{"command":"node","args":${'['.repeat(8)}"\${V}"${']'.repeat(8)}}}}`,
    );
    const out = loadProjectMcpServers(dir, ['project'], () => {}, { V: 'deep-value' }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(JSON.stringify(out.s?.args)).toContain('deep-value');
  });
});
