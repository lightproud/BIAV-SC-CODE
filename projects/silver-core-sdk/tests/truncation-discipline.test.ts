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

describe('registry: truncation sites must be inventoried', () => {
  it('every src/tools file that emits a truncation notice is a known site', async () => {
    // Adding a NEW cap with a notice? Add the file here AND cover its message
    // in this suite (three questions: how much / why / how to recover).
    // Removing one? Remove it here. A file appearing only on one side reds.
    const KNOWN_SITES = new Set([
      'descriptions.ts', // documents other tools' caps, emits none itself
      'glob.ts',
      'grep.ts',
      'read.ts',
      'shells.ts', // gap marker via "discarded oldest-first" wording
      'bash.ts', // foreground tail-keep cap, three-question marker
      'edit.ts', // comment-only mention (never truncates)
      'webfetch.ts',
      'workflow.ts',
      'workflow-engine.ts',
      'fsutil.ts', // shared Read/WebFetch footer builder
      'monitor.ts',
      'task.ts',
      'toolsearch.ts',
      'sendmessage.ts',
      'resources.ts',
    ]);
    const toolsDir = join(process.cwd(), 'src', 'tools');
    const files = (await readdir(toolsDir)).filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const body = await readFile(join(toolsDir, f), 'utf8');
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
