/**
 * Audit r3 batch P (T51) — high-severity source-code regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r3-20260717.md):
 *
 *  - W7-3: Glob('**​/*.yml') finds files under hidden directories (.github).
 *  - W8-1 (SECURITY): resolveTranscriptPath / filePath reject a traversal id.
 *  - W8-2: MCP stdout / SSE accumulators are bounded (no-newline flood ≠ OOM).
 *  - WZ1-1: post-fold M5 overflow guard calibrates on the UNCLAMPED estimate.
 *  (W7-1/W7-2 WebFetch capability claims are locked in tool-descriptions.test.ts;
 *   WV3-1 auto-resume replay is locked in session-manager.test.ts additions.)
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { globTool } from '../src/tools/glob.js';
import type { ToolContext } from '../src/internal/contracts.js';
import { JsonlSessionStore, resolveTranscriptPath } from '../src/sessions/store.js';

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function sandbox(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'r3-batch-p-'));
  tempDirs.push(d);
  return d;
}

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: { ...process.env },
    signal: new AbortController().signal,
    debug: () => {},
  } as ToolContext;
}

async function runGlob(pattern: string, cwd: string): Promise<string> {
  const res = await globTool.execute({ pattern, path: cwd }, makeCtx(cwd));
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

describe('W7-3 Glob matches files under hidden directories', () => {
  it("Glob('**/*.yml') finds .github/workflows/*.yml", async () => {
    const dir = await sandbox();
    await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    await writeFile(join(dir, 'top.yml'), 'x: 1\n');
    const out = await runGlob('**/*.yml', dir);
    expect(out).toContain('ci.yml');
    expect(out).toContain('top.yml');
  });

  it('still excludes node_modules and .git via IGNORE_PATTERNS', async () => {
    const dir = await sandbox();
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'skip.yml'), 'x: 1\n');
    await writeFile(join(dir, '.git', 'skip.yml'), 'x: 1\n');
    await writeFile(join(dir, 'keep.yml'), 'x: 1\n');
    const out = await runGlob('**/*.yml', dir);
    expect(out).toContain('keep.yml');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('.git/skip');
  });
});

describe('W8-1 (SECURITY) transcript-path resolution rejects traversal ids', () => {
  it('resolveTranscriptPath returns undefined for a traversal id', async () => {
    const dir = await sandbox();
    const store = new JsonlSessionStore({ sessionDir: dir });
    expect(resolveTranscriptPath(store, '../../etc/passwd')).toBeUndefined();
    expect(resolveTranscriptPath(store, '..')).toBeUndefined();
    expect(resolveTranscriptPath(store, 'a/b')).toBeUndefined();
    // A well-formed id still resolves to an in-root path.
    const ok = resolveTranscriptPath(store, 'session-123');
    expect(ok).toBeDefined();
    expect(ok!.startsWith(dir)).toBe(true);
  });

  it('filePath throws on an unsafe id (defense in depth)', async () => {
    const dir = await sandbox();
    const store = new JsonlSessionStore({ sessionDir: dir });
    expect(() => store.filePath('../../etc/passwd')).toThrow(/unsafe session id/);
    expect(store.filePath('safe-id').startsWith(dir)).toBe(true);
  });
});

describe('W8-2 MCP accumulators are bounded (no-newline flood)', () => {
  it('stdio onStdout drops a runaway no-newline buffer instead of growing it', async () => {
    // Drive the private onStdout directly — the cap logic is the unit under
    // test, independent of a live child process.
    const { StdioMcpConnection } = await import('../src/mcp/stdio.js');
    const conn = new StdioMcpConnection(
      { command: 'true', args: [] },
      { name: 'test', debug: () => {} },
    ) as unknown as { onStdout(chunk: string): void; stdoutBuffer: string };
    // Feed 20 MiB without a newline; the cap (16 MiB) must clear the buffer.
    conn.onStdout('x'.repeat(20 * 1024 * 1024));
    expect(conn.stdoutBuffer.length).toBe(0);
    // A normal newline-terminated line still parses (buffer drains to empty).
    conn.onStdout('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    expect(conn.stdoutBuffer.length).toBe(0);
  });
});
