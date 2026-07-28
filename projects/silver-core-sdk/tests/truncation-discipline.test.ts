/**
 * Truncation discipline (keeper ruling 2026-07-27): any cap that drops content
 * must answer three questions in its notice — HOW MUCH was dropped, WHY (which
 * cap), and HOW to get the content back — and the default retention favors the
 * TAIL for stream-shaped output (the verdict lives at the end of a log).
 *
 * Origin: the memory-index diagnosis generalized. A field scan (2026-07-27)
 * found the discipline held tool-by-tool only where each author had thought of
 * it: Grep and Read said everything, the background-shell cap went permanently
 * deaf with a five-word past-tense marker, WebFetch said "[truncated]". This
 * suite pins the repaired sites AND carries the registry test that forces any
 * NEW truncation site to show up here.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createShellManager } from '../src/tools/shells.js';
import { globTool } from '../src/tools/glob.js';
import type { ToolContext } from '../src/internal/contracts.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bpt-trunc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  } as ToolContext;
}

describe('background shell stream cap (tail retention)', () => {
  it('keeps the TAIL, counts the drop, and the reader gets a three-question gap marker', async () => {
    const mgr = createShellManager(() => {});
    try {
      // seq 1 120000 emits ~700KB — well past the 500K retention window.
      const spawned = await mgr.spawnBackground(
        '/bin/bash',
        'seq 1 120000',
        ctx(),
      );
      if ('error' in spawned) throw new Error(spawned.error);
      const rec = mgr.get(spawned.id)!;
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (rec.status !== 'running') {
            clearInterval(poll);
            resolve();
          }
        }, 25);
      });

      // Tail retained, head dropped, drop counted.
      expect(rec.stdout.endsWith('120000\n')).toBe(true);
      expect(rec.stdout.startsWith('1\n2\n')).toBe(false);
      expect(rec.droppedOut).toBeGreaterThan(0);
      expect(rec.stdout.length).toBeLessThanOrEqual(500_000);

      // A reader whose cursor predates the window start is told all three
      // things: how much (exact count), why (the cap), how to recover.
      const { taskOutputTool } = await import('../src/tools/shells.js');
      const res = await taskOutputTool.execute(
        { task_id: spawned.id },
        ctx({ shells: mgr }),
      );
      const content = res.content as string;
      expect(content).toContain(`[${rec.droppedOut} chars of stdout were dropped`);
      expect(content).toContain('500000-char retention window');
      expect(content).toContain('redirect the command\'s output to a file');
      // And the tail actually reached the reader.
      expect(content).toContain('120000');
    } finally {
      mgr.dispose();
    }
  }, 30_000);

  it('under the cap: no gap marker, no drop counters', async () => {
    const mgr = createShellManager(() => {});
    try {
      const spawned = await mgr.spawnBackground('/bin/bash', 'echo small', ctx());
      if ('error' in spawned) throw new Error(spawned.error);
      const rec = mgr.get(spawned.id)!;
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (rec.status !== 'running') {
            clearInterval(poll);
            resolve();
          }
        }, 25);
      });
      expect(rec.droppedOut).toBe(0);
      const { taskOutputTool } = await import('../src/tools/shells.js');
      const res = await taskOutputTool.execute({ task_id: spawned.id }, ctx({ shells: mgr }));
      expect(res.content as string).not.toContain('retention window');
      expect(res.content as string).toContain('small');
    } finally {
      mgr.dispose();
    }
  }, 30_000);
});

describe('glob result cap', () => {
  it('states the subset rule, the total, and how to reach the rest', async () => {
    await Promise.all(
      Array.from({ length: 120 }, (_, i) =>
        writeFile(join(dir, `f${String(i).padStart(3, '0')}.txt`), 'x'),
      ),
    );
    const res = await globTool.execute({ pattern: '*.txt' }, ctx());
    const content = res.content as string;
    expect(content).toContain('showing the 100 most recently modified of 120 matches');
    expect(content).toContain('Narrow the pattern');
  });
});

describe('recap body cap (engine/compaction, head+tail retention)', () => {
  it('over-cap recap keeps the header AND the newest lines, with a three-question gap marker', async () => {
    // BPT P1 2026-07-28: the old head-only cut kept the OLDEST recap lines,
    // so after every fold the model saw its original intent but never its
    // progress (session 4e2d03e0: 840 Reads / 777 compacts / 0 edits, 3h15m).
    const { foldDeterministic } = await import('../src/engine/compaction.js');
    const prefix = Array.from({ length: 80 }, (_, i) => ({
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: `t${i}`,
          name: 'Read',
          input: { file_path: '/w/big.py', offset: 1 + i * 40, limit: 40 },
        },
      ],
    }));
    const fold = foldDeterministic(prefix, null);
    const recap = (fold[1]!.content as Array<{ text: string }>)[0]!.text;
    // Structure declaration survives; the newest call survives.
    expect(recap.startsWith('[Conversation summary')).toBe(true);
    expect(recap).toContain(`"offset":${1 + 79 * 40}`);
    // Three questions: how much / why (which cap) / how to recover.
    expect(recap).toMatch(/\d+ older recap line\(s\) \(\d+ chars\) elided/);
    expect(recap).toContain('4000-char cap');
    expect(recap).toContain('files or persistent memory');
  });
});

describe('registry: truncation sites must be inventoried', () => {
  it('every src file that mentions truncation is a known site', async () => {
    // Adding a NEW cap with a notice? Add the file here AND cover its message
    // in this suite (three questions: how much / why / how to recover).
    // Removing one? Remove it here. A file appearing only on one side reds.
    //
    // Scope (BPT P1 2026-07-28): ALL of src/, recursively. The 0.87.0
    // "whole-family alignment" guard only watched src/tools, so engine-layer
    // caps — buildRecap's head-only recap cut among them — sat structurally
    // outside its sight and were never aligned. Exemptions now go through
    // this whitelist, not through a directory boundary.
    const KNOWN_SITES = new Set([
      // --- tools: real caps with covered notices ---
      'tools/glob.ts',
      'tools/grep.ts',
      'tools/read.ts',
      'tools/shells.ts', // gap marker via "discarded oldest-first" wording
      'tools/bash.ts', // foreground tail-keep cap, three-question marker
      'tools/webfetch.ts',
      'tools/workflow.ts',
      'tools/workflow-engine.ts',
      'tools/fsutil.ts', // shared Read/WebFetch footer builder
      'tools/monitor.ts',
      'tools/task.ts',
      'tools/toolsearch.ts',
      'tools/sendmessage.ts',
      'tools/resources.ts',
      'tools/descriptions.ts', // documents other tools' caps, emits none itself
      'tools/edit.ts', // comment-only mention (never truncates)
      // --- tools/memory: view caps + scan bounds ---
      'tools/memory/store.ts', // viewTruncationNotice: cap + view_range recovery
      'tools/memory/memory-tool.ts', // R8 view truncation + create size cap
      'tools/memory/index.ts', // UTF-8 byte-boundary head load, "only the head" honesty
      'tools/memory/index-capacity.ts', // read/write-side capacity warnings (no silent cut)
      'tools/memory/health.ts', // truncatedScan flag: scan bound, numbers = lower bound
      'tools/memory/consolidation.ts', // consumes truncatedScan, comment-level
      'tools/memory/contract-suite.ts', // comment-only (corruption diagnosis)
      'tools/memory/local-store.ts', // comment-only (atomic-write rationale)
      // --- engine (the layer the old guard never saw) ---
      'engine/compaction.ts', // recap body cap: head+tail, three-question gap marker (BPT P1); shed tool_result head+tail pointer-ization; per-line recap caps (head, single-line summaries)
      'engine/runtime-context.ts', // instruction-files byte cap: tail-keep with explicit marker
      'engine/tool-dispatch.ts', // record summary cap (head, surrogate-safe; diagnostic record, not model-facing context)
      'engine/loop.ts', // budget:exhausted lastAssistantText 500-char head cut (summary nature, acceptable) + E3 truncated-stream SIGNALING (not a cap)
      'engine/accumulator.ts', // H4 truncated tool_use input: 200-char diagnostic snippet (head, diagnostic) + truncation stamping
      'engine/config-builder.ts', // comment-only (continuation rationale)
      // --- everything else that matches the scan regex ---
      'error-normalize.ts', // surrogate-safe error-message cut (diagnostic)
      'errors.ts', // comment-only (truncated-turn docs)
      'generators/index.ts', // comment-only
      'generators/runtime.ts', // comment-only (truncated-reply handling docs)
      'index.ts', // re-export name mention (truncateViewBody)
      'internal/contracts.ts', // type docs
      'internal/text.ts', // the shared slice primitives themselves
      'loop-support/retention.ts', // explicitly NEVER truncates — raises instead
      'mcp/http.ts', // 300-char error-detail cut (diagnostic)
      'mcp/protocol.ts', // tools/list pagination cap, logged via debug
      'query.ts', // tool-record input cap (diagnostic record; full input lives in the assistant message)
      'reporting/run-log.ts', // surrogate-safe 300-char log cut (diagnostic)
      'sessions/health.ts', // truncatedScan bound flag (lower-bound honesty)
      'transport/anthropic.ts', // error-body cut (diagnostic) + mid-stream truncated-turn signaling
      'transport/openai.ts', // truncated-turn signaling (not a cap)
      'transport/http-retry.ts', // midStreamTruncation flagging (signal, not a cap)
      'types/messages.ts', // type docs (E3 salvaged-turn field)
      'types/options.ts', // type docs
      'types/query.ts', // type docs
      'types/subsystems.ts', // type docs
      'types/tool-outputs.ts', // type docs
      'types/tools.ts', // type docs
      'verifier/index.ts', // comment-only (fails closed on truncation)
    ]);
    const srcDir = join(process.cwd(), 'src');
    const files = (await readdir(srcDir, { recursive: true }))
      .map((f) => String(f).replaceAll('\\', '/'))
      .filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const body = await readFile(join(srcDir, f), 'utf8');
      const emits = /truncat|discarded oldest-first/i.test(body);
      if (emits && !KNOWN_SITES.has(f)) offenders.push(f);
    }
    expect(
      offenders,
      'new truncation site(s) not in the discipline registry — cover their ' +
        'notices in this suite (how much / why / how to recover) and register them',
    ).toEqual([]);
  });
});
