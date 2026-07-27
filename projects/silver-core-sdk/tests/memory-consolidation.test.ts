/**
 * Memory consolidation + resident-index capacity (keeper ruling 2026-07-27,
 * BPT field report: "记录非常多，每次开工检索记忆要好几回工具调用").
 *
 * Three surfaces, one root cause between them — the SDK shipped the index
 * MECHANISM (R6) and the health SCAN, but never the discipline that keeps the
 * index navigable nor the protocol for acting on the scan:
 *  1. index-capacity: one shared measurement for read-side truncation and the
 *     write-side warning (a warning on a different threshold than the
 *     truncation would be worse than none);
 *  2. the write-side back-pressure through the real `memory` tool;
 *  3. buildConsolidationPrompt: a health assessment rendered into the round's
 *     task list, honest about what the scan could not see.
 */

import { describe, expect, it } from 'vitest';

import {
  MEMORY_CONSOLIDATION_PROTOCOL,
  MEMORY_INDEX_PATH,
  assessIndexCapacity,
  buildConsolidationPrompt,
  createMemoryStore,
  createMemoryTool,
  indexCapacityWarning,
  recoverIndexLines,
  type MemoryFileOps,
  type MemoryStoreAssessment,
} from '../src/tools/memory/index.js';
import type { ToolResultPayload } from '../src/internal/contracts.js';

/** Minimal in-memory FileOps (the store engine supplies all semantics). */
function memoryOps(initial: Record<string, string> = {}): MemoryFileOps {
  const files = new Map(Object.entries(initial));
  const isDir = (p: string): boolean =>
    p === '/memories' || [...files.keys()].some((f) => f.startsWith(p + '/'));
  return {
    async stat(p) {
      const f = files.get(p);
      if (f !== undefined) return { kind: 'file', sizeBytes: Buffer.byteLength(f, 'utf8') };
      return isDir(p) ? { kind: 'directory', sizeBytes: 0 } : null;
    },
    async list(p) {
      const seen = new Map<string, { name: string; kind: 'file' | 'directory'; sizeBytes: number }>();
      for (const [f, v] of files) {
        if (!f.startsWith(p + '/')) continue;
        const rest = f.slice(p.length + 1);
        const slash = rest.indexOf('/');
        if (slash === -1) {
          seen.set(rest, { name: rest, kind: 'file', sizeBytes: Buffer.byteLength(v, 'utf8') });
        } else {
          const dir = rest.slice(0, slash);
          seen.set(dir, { name: dir, kind: 'directory', sizeBytes: 0 });
        }
      }
      return [...seen.values()];
    },
    async read(p) {
      const f = files.get(p);
      if (f === undefined) throw new Error(`missing ${p}`);
      return f;
    },
    async write(p, content) {
      files.set(p, content);
    },
    async delete(p) {
      files.delete(p);
    },
    async rename(from, to) {
      const f = files.get(from);
      if (f === undefined) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(to, f);
    },
  };
}

const CAPS = { maxLines: 5, maxBytes: 200 };

const ctx = { signal: new AbortController().signal } as never;

async function run(
  tool: ReturnType<typeof createMemoryTool>,
  input: unknown,
): Promise<ToolResultPayload> {
  return (await tool.execute(input as never, ctx)) as ToolResultPayload;
}

describe('index capacity measurement', () => {
  it('recovers raw lines from the view chrome (header + gutter + pagination notice)', () => {
    const viewed =
      "Here's the content of /memories/MEMORY.md with line numbers:\n" +
      '     1\t- a (a.md) — hook\n' +
      '     2\t- b (b.md) — hook\n' +
      '[Output truncated at 16000 characters. Use view_range to read more.]';
    const { lines, sawNotice } = recoverIndexLines(viewed);
    expect(lines).toEqual(['- a (a.md) — hook', '- b (b.md) — hook']);
    expect(sawNotice).toBe(true);
  });

  it('reports no notice when the store did not truncate', () => {
    const viewed = "Here's the content of x with line numbers:\n     1\tonly";
    expect(recoverIndexLines(viewed)).toEqual({ lines: ['only'], sawNotice: false });
  });

  it('is under capacity at exactly the line cap, over at one past it', () => {
    const at = assessIndexCapacity(['a', 'b', 'c', 'd', 'e'], CAPS);
    expect(at.over).toBe(false);
    expect(at.breached).toBeNull();
    const past = assessIndexCapacity(['a', 'b', 'c', 'd', 'e', 'f'], CAPS);
    expect(past.over).toBe(true);
    expect(past.breached).toBe('lines');
    expect(past.lineCount).toBe(6);
  });

  it('breaches on bytes when the line count is fine (UTF-8, newlines counted)', () => {
    const cap = assessIndexCapacity(['三' .repeat(40)], { maxLines: 5, maxBytes: 100 });
    // 40 CJK chars = 120 UTF-8 bytes on one line: under the line cap, over bytes.
    expect(cap.byteCount).toBe(120);
    expect(cap.over).toBe(true);
    expect(cap.breached).toBe('bytes');
  });

  it('states the tail is ALREADY invisible and prescribes pointers, not prose', () => {
    const warning = indexCapacityWarning(
      MEMORY_INDEX_PATH,
      assessIndexCapacity(['a', 'b', 'c', 'd', 'e', 'f'], CAPS),
      CAPS,
    );
    expect(warning).toContain('ALREADY invisible');
    expect(warning).toContain('an index, not a memory');
    expect(warning).toContain('one line per entry');
  });
});

describe('write-side index back-pressure (memory tool)', () => {
  const toolWithCaps = (ops: MemoryFileOps) =>
    createMemoryTool(createMemoryStore(ops), { indexCaps: CAPS });

  it('appends the warning to a successful create that overruns the index', async () => {
    const res = await run(toolWithCaps(memoryOps()), {
      command: 'create',
      path: MEMORY_INDEX_PATH,
      file_text: 'l1\nl2\nl3\nl4\nl5\nl6\n',
    });
    expect(res.isError).toBeUndefined();
    // The reference success string is preserved — the warning rides after it.
    expect(res.content).toContain(`File created successfully at: ${MEMORY_INDEX_PATH}`);
    expect(res.content).toContain('WARNING');
  });

  it('stays silent when the index is within its caps', async () => {
    const res = await run(toolWithCaps(memoryOps()), {
      command: 'create',
      path: MEMORY_INDEX_PATH,
      file_text: 'l1\nl2\n',
    });
    expect(res.content).not.toContain('WARNING');
  });

  it('never warns about a non-index file, however long', async () => {
    const res = await run(toolWithCaps(memoryOps()), {
      command: 'create',
      path: '/memories/topic.md',
      file_text: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n',
    });
    expect(res.content).not.toContain('WARNING');
  });

  it('fires on insert and str_replace that push the index over', async () => {
    const ops = memoryOps({ [MEMORY_INDEX_PATH]: 'l1\nl2\nl3\nl4\nl5\n' });
    const tool = toolWithCaps(ops);
    const inserted = await run(tool, {
      command: 'insert',
      path: MEMORY_INDEX_PATH,
      insert_line: 5,
      insert_text: 'l6',
    });
    expect(inserted.content).toContain('WARNING');
    const replaced = await run(tool, {
      command: 'str_replace',
      path: MEMORY_INDEX_PATH,
      old_str: 'l6',
      new_str: 'l6\nl7',
    });
    expect(replaced.content).toContain('WARNING');
  });

  it('fires when a file is RENAMED onto the index (that makes it the index)', async () => {
    const ops = memoryOps({ '/memories/big.md': 'l1\nl2\nl3\nl4\nl5\nl6\n' });
    const res = await run(toolWithCaps(ops), {
      command: 'rename',
      old_path: '/memories/big.md',
      new_path: MEMORY_INDEX_PATH,
    });
    expect(res.content).toContain('WARNING');
  });

  it('is inert without caps (indexInjection disabled: nothing is truncated)', async () => {
    const tool = createMemoryTool(createMemoryStore(memoryOps()));
    const res = await run(tool, {
      command: 'create',
      path: MEMORY_INDEX_PATH,
      file_text: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n',
    });
    expect(res.content).not.toContain('WARNING');
  });

  it('never turns a successful write into a failure when the read-back throws', async () => {
    const ops = memoryOps();
    const store = createMemoryStore(ops);
    const failingView: typeof store = {
      ...store,
      view: async () => {
        throw new Error('backend unavailable');
      },
    };
    const res = await run(createMemoryTool(failingView, { indexCaps: CAPS }), {
      command: 'create',
      path: MEMORY_INDEX_PATH,
      file_text: 'l1\nl2\nl3\nl4\nl5\nl6\n',
    });
    expect(res.isError).toBeUndefined();
    expect(res.content).toContain('File created successfully');
    expect(res.content).not.toContain('WARNING');
  });

  it('does not book the harness read-back into the R8 read counters', async () => {
    const health = {
      operations: 0,
      reads: 0,
      writes: 0,
      errors: 0,
      bytesRead: 0,
      bytesWritten: 0,
      indexInjectionTokens: 0,
      sessionEndUpdate: 'pending' as const,
    };
    const tool = createMemoryTool(createMemoryStore(memoryOps()), { indexCaps: CAPS, health });
    await run(tool, {
      command: 'create',
      path: MEMORY_INDEX_PATH,
      file_text: 'l1\nl2\nl3\nl4\nl5\nl6\n',
    });
    expect(health.writes).toBe(1);
    expect(health.reads).toBe(0);
  });
});

describe('consolidation protocol', () => {
  it('carries all four phases, ending on the index prune', () => {
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('Phase 1 — Orient');
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('Phase 2 — Gather');
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('Phase 3 — Merge');
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('Phase 4 — Prune the index');
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('an INDEX');
  });

  it('scopes the round to the memory tool (it must not reach outside the store)', () => {
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('`memory` tool');
    expect(MEMORY_CONSOLIDATION_PROTOCOL).toContain('change nothing outside it');
  });
});

/** A clean assessment; each test perturbs the one dimension it is about. */
function assessment(over: Partial<MemoryStoreAssessment> = {}): MemoryStoreAssessment {
  return {
    files: 3,
    directories: 1,
    totalBytes: 900,
    limits: { maxFileBytes: 65_536, maxFilesPerDirectory: 64, maxViewChars: 16_000 },
    waterlines: [{ path: '/memories', files: 3, limit: 64, remaining: 61, warn: false }],
    warnDirectories: [],
    capacity: {
      largestFile: { path: '/memories/a.md', sizeBytes: 400 },
      largestFileHeadroomBytes: 65_136,
      filesOverHalfByteLimit: 0,
      fullestDirectory: { path: '/memories', files: 3, remaining: 61 },
    },
    staleness: { available: true, staleAfterDays: 30, staleFiles: 0, staleList: [], oldestFile: null },
    supersede: { references: 0, broken: [], intact: true },
    readWriteRatio: null,
    truncatedScan: false,
    ...over,
  };
}

describe('buildConsolidationPrompt', () => {
  it('turns a clean scan into a phase-1+4 pass instead of inventing work', () => {
    const prompt = buildConsolidationPrompt(assessment());
    expect(prompt).toContain('No threshold was breached');
    expect(prompt).toContain('phase 1 and phase 4 only');
  });

  it('lists waterline directories with their headroom', () => {
    const prompt = buildConsolidationPrompt(
      assessment({
        warnDirectories: ['/memories/pitfalls'],
        waterlines: [
          { path: '/memories/pitfalls', files: 50, limit: 64, remaining: 14, warn: true },
        ],
      }),
    );
    expect(prompt).toContain('/memories/pitfalls (50 files, 14 below the 64 cap)');
  });

  it('lists stale files oldest-first with the threshold that judged them', () => {
    const prompt = buildConsolidationPrompt(
      assessment({
        staleness: {
          available: true,
          staleAfterDays: 30,
          staleFiles: 2,
          staleList: ['/memories/old.md', '/memories/older.md'],
          oldestFile: { path: '/memories/older.md', ageDays: 90 },
        },
      }),
    );
    expect(prompt).toContain('2 file(s) unchanged for over 30 days');
    expect(prompt).toContain('/memories/old.md, /memories/older.md');
  });

  it('states unavailable staleness as a blind spot instead of omitting it', () => {
    const prompt = buildConsolidationPrompt(
      assessment({ staleness: { available: false, note: 'backend provides no mtime' } }),
    );
    expect(prompt).toContain('could not be assessed');
    expect(prompt).toContain('do not assume anything is fresh');
  });

  it('flags oversized files and broken supersede chains', () => {
    const prompt = buildConsolidationPrompt(
      assessment({
        capacity: {
          largestFile: { path: '/memories/huge.md', sizeBytes: 60_000 },
          largestFileHeadroomBytes: 5_536,
          filesOverHalfByteLimit: 2,
          fullestDirectory: null,
        },
        supersede: {
          references: 1,
          broken: [{ file: '/memories/new.md', target: '/memories/gone.md' }],
          intact: false,
        },
      }),
    );
    expect(prompt).toContain('2 file(s) are over half the 65536-byte per-file limit');
    expect(prompt).toContain('/memories/huge.md (60000 bytes)');
    expect(prompt).toContain('/memories/new.md -> /memories/gone.md');
  });

  it('calls a write-heavy store hoarding, and only below a 1.0 ratio', () => {
    expect(buildConsolidationPrompt(assessment({ readWriteRatio: 0.25 }))).toContain(
      'hoarding, not remembering',
    );
    expect(buildConsolidationPrompt(assessment({ readWriteRatio: 4 }))).not.toContain(
      'hoarding',
    );
  });

  it('declares a truncated scan a LOWER bound rather than reporting it as complete', () => {
    expect(buildConsolidationPrompt(assessment({ truncatedScan: true }))).toContain(
      'LOWER bound',
    );
  });

  it('caps path lists and says how many it dropped', () => {
    const staleList = Array.from({ length: 12 }, (_, i) => `/memories/s${i}.md`);
    const prompt = buildConsolidationPrompt(
      assessment({
        staleness: {
          available: true,
          staleAfterDays: 30,
          staleFiles: 12,
          staleList,
          oldestFile: null,
        },
      }),
      { maxPathsPerFinding: 3 },
    );
    expect(prompt).toContain('/memories/s0.md, /memories/s1.md, /memories/s2.md, and 9 more');
    expect(prompt).not.toContain('/memories/s5.md');
  });

  it('appends consumer instructions after the task list', () => {
    const prompt = buildConsolidationPrompt(assessment(), {
      instructions: 'Never touch /memories/team.',
    });
    expect(prompt.endsWith('Never touch /memories/team.')).toBe(true);
  });

  it('always carries the protocol ahead of the task list', () => {
    const prompt = buildConsolidationPrompt(assessment());
    expect(prompt.indexOf(MEMORY_CONSOLIDATION_PROTOCOL)).toBe(0);
    expect(prompt).toContain('TASK LIST');
  });
});
