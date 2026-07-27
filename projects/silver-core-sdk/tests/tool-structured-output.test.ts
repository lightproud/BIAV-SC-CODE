/**
 * Structured tool results (`toolUseResult`), added 2026-07-27 after the
 * divergence sweep found this SDK shipping no output surface at all.
 *
 * What these tests are FOR: every fact asserted below was previously
 * obtainable only by parsing the human-facing string — "did Glob truncate",
 * "what offset did Grep actually apply", "what was the exit code". Official's
 * own type comment states the principle (`truncatedByTokenCap` "survives
 * output reconstruction, unlike the render-time banner"), and a test that
 * merely re-read the banner would be testing the very thing this surface
 * exists to stop depending on. So each case asserts the structured field
 * DIRECTLY, and the truncation cases additionally pin that the structured
 * flag agrees with the rendered text — the two disagreeing is the failure
 * mode that would make the surface worse than useless.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readTool } from '../src/tools/read.js';
import { globTool } from '../src/tools/glob.js';
import { grepTool } from '../src/tools/grep.js';
import { bashTool } from '../src/tools/bash.js';
import type { ToolContext } from '../src/internal/contracts.js';
import type {
  BashStructuredOutput,
  GlobOutput,
  GrepOutput,
  ReadOutput,
} from '../src/types/tool-outputs.js';

let sandboxes: string[] = [];
async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scs-structured-'));
  sandboxes.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}
const text = (res: { content: unknown }): string =>
  typeof res.content === 'string' ? res.content : JSON.stringify(res.content);

describe('Read structured result', () => {
  it('reports the window and total without the caller parsing the footer', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'a.txt');
    await writeFile(file, Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n'), 'utf8');
    const res = await readTool.execute({ file_path: file, offset: 5, limit: 10 }, makeCtx(dir));
    const s = res.structuredOutput as ReadOutput;
    expect(s.type).toBe('text');
    if (s.type !== 'text') return;
    expect(s.file.startLine).toBe(5);
    expect(s.file.numLines).toBe(10);
    expect(s.file.totalLines).toBe(40);
    expect(s.file.truncatedByCharCap).toBeUndefined();
  });

  it('flags a char-capped read, and the flag agrees with the rendered footer', async () => {
    const dir = await makeSandbox();
    const file = path.join(dir, 'wide.txt');
    // ~200KB: over the 50K char cap, under the 256KB whole-file refusal.
    await writeFile(file, Array.from({ length: 400 }, () => 'w'.repeat(500)).join('\n'), 'utf8');
    const res = await readTool.execute({ file_path: file }, makeCtx(dir));
    const s = res.structuredOutput as ReadOutput;
    expect(s.type === 'text' && s.file.truncatedByCharCap).toBe(true);
    expect(text(res)).toContain('output truncated at');
  });
});

describe('Glob structured result', () => {
  it('reports truncated=false and the file list for a small match set', async () => {
    const dir = await makeSandbox();
    await writeFile(path.join(dir, 'x.ts'), '', 'utf8');
    await writeFile(path.join(dir, 'y.ts'), '', 'utf8');
    const res = await globTool.execute({ pattern: '**/*.ts', path: dir }, makeCtx(dir));
    const s = res.structuredOutput as GlobOutput;
    expect(s.numFiles).toBe(2);
    expect(s.truncated).toBe(false);
    expect(s.filenames).toHaveLength(2);
    expect(typeof s.durationMs).toBe('number');
  });

  it('a no-match run still carries a structured result, not undefined', async () => {
    const dir = await makeSandbox();
    const res = await globTool.execute({ pattern: '**/*.nope', path: dir }, makeCtx(dir));
    const s = res.structuredOutput as GlobOutput;
    expect(s.numFiles).toBe(0);
    expect(s.filenames).toEqual([]);
    expect(s.truncated).toBe(false);
  });
});

describe('Grep structured result', () => {
  it('reports the offset and limit ACTUALLY applied, defaults included', async () => {
    const dir = await makeSandbox();
    await writeFile(path.join(dir, 'a.txt'), 'NEEDLE\n', 'utf8');
    const res = await grepTool.execute({ pattern: 'NEEDLE', path: dir }, makeCtx(dir));
    const s = res.structuredOutput as GrepOutput;
    // The caller passed neither; 250/0 are what the call ran with, and there
    // was previously no way to learn that except by reading the schema docs.
    expect(s.appliedLimit).toBe(250);
    expect(s.appliedOffset).toBe(0);
    expect(s.truncated).toBe(false);
    expect(s.mode).toBe('files_with_matches');
    expect(s.filenames).toHaveLength(1);
  });

  it('flags truncation, and the flag agrees with the rendered note', async () => {
    const dir = await makeSandbox();
    for (let i = 0; i < 30; i++) {
      await writeFile(path.join(dir, `f${i}.txt`), 'NEEDLE\n', 'utf8');
    }
    const res = await grepTool.execute(
      { pattern: 'NEEDLE', path: dir, output_mode: 'files_with_matches', head_limit: 5 },
      makeCtx(dir),
    );
    const s = res.structuredOutput as GrepOutput;
    expect(s.appliedLimit).toBe(5);
    expect(s.truncated).toBe(true);
    expect(s.filenames).toHaveLength(5);
    expect(text(res)).toMatch(/truncated|not scanned/);
  });

  it('a no-match run reports the applied limits rather than nothing', async () => {
    const dir = await makeSandbox();
    await writeFile(path.join(dir, 'a.txt'), 'nothing here\n', 'utf8');
    const s = (await grepTool.execute({ pattern: 'ZZZ_ABSENT', path: dir }, makeCtx(dir)))
      .structuredOutput as GrepOutput;
    expect(s.numFiles).toBe(0);
    expect(s.appliedLimit).toBe(250);
  });
});

describe('Bash structured result', () => {
  it('reports exit code 0 and the streams for a success', async () => {
    const dir = await makeSandbox();
    const res = await bashTool.execute({ command: 'printf hello' }, makeCtx(dir));
    const s = res.structuredOutput as BashStructuredOutput;
    expect(s.exitCode).toBe(0);
    expect(s.stdout).toBe('hello');
    expect(s.interrupted).toBe(false);
    expect(s.truncated).toBe(false);
  });

  it('reports the real exit code on failure, not just an error string', async () => {
    const dir = await makeSandbox();
    const res = await bashTool.execute({ command: 'exit 42' }, makeCtx(dir));
    expect(res.isError).toBe(true);
    expect((res.structuredOutput as BashStructuredOutput).exitCode).toBe(42);
  });

  it('marks interrupted + timedOutAfterMs on a timeout', async () => {
    const dir = await makeSandbox();
    const res = await bashTool.execute({ command: 'sleep 5', timeout: 300 }, makeCtx(dir));
    const s = res.structuredOutput as BashStructuredOutput;
    expect(s.interrupted).toBe(true);
    expect(s.timedOutAfterMs).toBe(300);
  });

  it('flags a capped stream, and the flag agrees with the rendered marker', async () => {
    const dir = await makeSandbox();
    const res = await bashTool.execute(
      { command: 'head -c 40000 /dev/zero | tr "\\0" a' },
      makeCtx(dir),
    );
    const s = res.structuredOutput as BashStructuredOutput;
    expect(s.truncated).toBe(true);
    // 0.87.0 three-question marker: the flag derives from the marker SHAPE
    // (leading dropped count), so flag and rendered text cannot disagree.
    expect(text(res)).toMatch(/\[\d+ earlier chars dropped:/);
  });
});

// ---------------------------------------------------------------------------
// The seam: the loop must ATTACH the batch's structured results to the user
// turn it appends, or nothing above ever sees them. A green tool-level test
// says nothing about whether the value travels — so this exercises the real
// loop with a real tool and reads the turn the loop appended.
// ---------------------------------------------------------------------------

describe('WebSearch / MCP-resource structured results (output-type sweep, 续)', () => {
  it('WebSearch reports the query and the POST-FILTER hits', async () => {
    const { webSearchTool } = await import('../src/tools/websearch.js');
    const ctx = {
      ...makeCtx('/tmp'),
      webSearch: async () => [
        { title: 'kept', url: 'https://ok.example/a' },
        { title: 'dropped', url: 'https://no.example/b' },
      ],
    } as unknown as ToolContext;
    const res = await webSearchTool.execute(
      { query: 'q', allowed_domains: ['ok.example'] },
      ctx,
    );
    const s = res.structuredOutput as {
      query: string;
      results: Array<{ content: Array<{ url: string }> }>;
      durationSeconds: number;
      searchCount?: number;
    };
    expect(s.query).toBe('q');
    // Post-filter, so the structured hit count and the rendered text agree —
    // a consumer and the model must not be reading different numbers.
    expect(s.results[0]!.content.map((c) => c.url)).toEqual(['https://ok.example/a']);
    expect(typeof s.durationSeconds).toBe('number');
    // Official's optional searchCount is deliberately absent: one backend call
    // per invocation makes it a constant 1.
    expect(s.searchCount).toBeUndefined();
  });

  it('ReadMcpResourceTool reports a structured error, not just an error string', async () => {
    const { readMcpResourceTool } = await import('../src/tools/resources.js');
    const res = await readMcpResourceTool.execute({ server: 's', uri: 'u' }, makeCtx('/tmp'));
    expect(res.isError).toBe(true);
    const s = res.structuredOutput as { contents: unknown[]; error?: string };
    // Without this, a caller cannot tell a FAILED read from an EMPTY one.
    expect(s.contents).toEqual([]);
    expect(s.error).toContain('no MCP servers are configured');
  });
});

describe('structured results reach the turn the loop appends', () => {
  it('the side-channel returns what was attached, and nothing for other turns', async () => {
    const { attachToolUseResults, readToolUseResults } = await import(
      '../src/engine/tool-use-results.js'
    );
    const turn = { role: 'user' as const, content: 'x' };
    const other = { role: 'user' as const, content: 'y' };
    expect(readToolUseResults(turn)).toBeUndefined();
    attachToolUseResults(turn, { toolu_1: { ok: true } });
    expect(readToolUseResults(turn)).toEqual({ toolu_1: { ok: true } });
    // Keyed by object identity: a structurally identical turn is NOT the same
    // turn. That is what keeps one turn's results off another's.
    expect(readToolUseResults(other)).toBeUndefined();
  });

  it('a real Glob call through the loop lands on the appended user turn', async () => {
    const dir = await makeSandbox();
    await writeFile(path.join(dir, 'only.ts'), '', 'utf8');

    const { runAgentLoop } = await import('../src/engine/loop.js');
    const { readToolUseResults } = await import('../src/engine/tool-use-results.js');
    const { MockTransport, toolUseReplyEvents, textReplyEvents } = await import(
      './helpers/mock-transport.js'
    );
    const { FakeMcp } = await import('./helpers/engine-fakes.js');

    const transport = new MockTransport([
      toolUseReplyEvents('Glob', { pattern: '**/*.ts', path: dir }),
      textReplyEvents('done'),
    ]);
    const deps = {
      transport,
      builtinTools: new Map([['Glob', globTool]]),
      mcp: new FakeMcp(),
      // Minimum gate/hook surface the loop actually calls. Kept inline rather
      // than importing engine.test.ts's fakes (not exported) — this test is
      // about the attachment seam, not about gate semantics.
      permissions: {
        check: async (_name: string, input: Record<string, unknown>) => ({
          behavior: 'allow' as const,
          updatedInput: input,
        }),
        denials: () => [],
        mode: () => 'default' as const,
        setMode: () => {},
      },
      hooks: {
        hasHooks: () => false,
        run: async () => ({ systemMessages: [], blocked: false }),
      },
      toolContext: makeCtx(dir),
      debug: () => {},
    } as unknown as Parameters<typeof runAgentLoop>[1];

    const history: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      { role: 'user', content: 'glob it' },
    ];
    // Drain the loop; the tool_result user turn is appended to `history`.
    for await (const _m of runAgentLoop(
      history as never,
      deps,
      { model: 'test-model', maxTurns: 3 } as never,
    )) {
      void _m;
    }

    const toolTurn = history.find(
      (h) => h.role === 'user' && Array.isArray(h.content),
    );
    expect(toolTurn, 'the loop should have appended a tool_result user turn').toBeDefined();
    // Diagnose rather than guess if this ever regresses: a denial or a hook
    // block would also produce a tool_result turn, with different content.
    if (process.env['SCS_DEBUG_STRUCTURED'] === '1') {
      console.log('turn content:', JSON.stringify(toolTurn?.content).slice(0, 400));
    }
    const attached = readToolUseResults(toolTurn as never);
    expect(attached, 'Glob produced a structured result; it must be attached').toBeDefined();
    const only = Object.values(attached!)[0] as GlobOutput;
    expect(only.numFiles).toBe(1);
    expect(only.truncated).toBe(false);
  });
});
