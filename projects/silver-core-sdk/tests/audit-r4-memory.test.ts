/**
 * Audit r4 (2026-07-17) — memory cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - U4-1: the R8 byte cap now guards str_replace / insert at the tool layer
 *    (not just create), so a directly-injected store cannot take an
 *    over-cap chunk.
 *  - U4-2: memory paths are Unicode-normalized (NFC), so an NFD-spelled path
 *    cannot slip past a read-only mount declared in NFC.
 *  - U4-3: rename into a full directory is blocked by the per-directory file
 *    cap (create-elsewhere-then-rename-in no longer smuggles past it).
 *  - U4-4: the local store writes atomically (temp + rename), leaving no torn
 *    file and no leftover temp entries.
 *  - U4-5: insert into an EMPTY file yields exactly the inserted text (no
 *    phantom blank line).
 *  - U4-6: renaming a directory into its own subtree returns a structured
 *    error, not a raw EINVAL.
 *  - U4-7: an over-long path segment returns a structured error, not a raw
 *    ENAMETOOLONG.
 *  - U4-8: a resident-index first line that alone exceeds the byte cap is
 *    injected truncated, not silently dropped.
 *  - U4-9: card field bodies containing escaped heading/field-marker lines
 *    round-trip as literal content.
 *  - Sfs-2: the local rename primitive refuses to clobber an existing
 *    destination (closes the engine-check TOCTOU window).
 *  - R7s-5: the memory view truncation never splits a surrogate pair.
 */

import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createLocalFilesystemMemoryStore,
  createLocalMemoryFileOps,
  createMemoryTool,
  mountAllowsWrite,
  parseMemoryCards,
  resolveMemoryMounts,
  resolveMemoryRuntime,
  truncateViewBody,
  validateMemoryPath,
} from '../src/tools/memory/index.js';
import type { MemoryStore } from '../src/types.js';
import type { ToolContext } from '../src/internal/contracts.js';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'bpt-audit-r4-mem-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    cwd: baseDir,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}

/** A directly-implemented store whose mutators record their calls — the
 *  tool-layer guards must fire BEFORE these run (U4-1). */
function recordingStore(calls: string[]): MemoryStore {
  return {
    view: async () => '',
    create: async (p) => {
      calls.push(`create:${p}`);
      return `File created successfully at: ${p}`;
    },
    strReplace: async () => {
      calls.push('strReplace');
      return 'replaced';
    },
    insert: async () => {
      calls.push('insert');
      return 'inserted';
    },
    delete: async () => '',
    rename: async () => '',
  };
}

// ---------------------------------------------------------------------------
// U4-1: str_replace / insert honor the byte cap at the tool layer
// ---------------------------------------------------------------------------

describe('U4-1: tool-layer byte cap covers str_replace and insert', () => {
  it('rejects an over-cap str_replace / insert chunk before the store runs', async () => {
    const calls: string[] = [];
    const tool = createMemoryTool(recordingStore(calls), { limits: { maxFileBytes: 10 } });

    const replaced = await tool.execute(
      { command: 'str_replace', path: '/memories/f.txt', old_str: 'a', new_str: 'x'.repeat(11) },
      ctx(),
    );
    expect(replaced.isError).toBe(true);
    expect(String(replaced.content)).toContain('maximum memory file size (10 bytes)');

    const inserted = await tool.execute(
      { command: 'insert', path: '/memories/f.txt', insert_line: 0, insert_text: 'y'.repeat(11) },
      ctx(),
    );
    expect(inserted.isError).toBe(true);
    expect(String(inserted.content)).toContain('maximum memory file size (10 bytes)');

    // Neither mutator was reached.
    expect(calls).toEqual([]);
  });

  it('a chunk within the cap still passes through to the store', async () => {
    const calls: string[] = [];
    const tool = createMemoryTool(recordingStore(calls), { limits: { maxFileBytes: 10 } });
    const ok = await tool.execute(
      { command: 'str_replace', path: '/memories/f.txt', old_str: 'a', new_str: 'ok' },
      ctx(),
    );
    expect(ok.isError).not.toBe(true);
    expect(calls).toEqual(['strReplace']);
  });
});

// ---------------------------------------------------------------------------
// U4-2: Unicode normalization closes an NFD-vs-NFC mount bypass
// ---------------------------------------------------------------------------

describe('U4-2: memory paths are NFC-normalized', () => {
  // The same name spelled two ways at the byte level; equal only
  // after NFC normalization (the SAME file on APFS/HFS+).
  const cafeNFC = 'caf' + String.fromCharCode(0x00e9); // e-acute precomposed (NFC)
  const cafeNFD = 'cafe' + String.fromCharCode(0x0301); // e + combining acute (NFD)
  const NFC = `/memories/${cafeNFC}/secret.md`;
  const NFD = `/memories/${cafeNFD}/secret.md`;

  it('NFC and NFD spellings canonicalize to the same path', () => {
    expect(NFC).not.toBe(NFD); // distinct source bytes
    expect(validateMemoryPath(NFD)).toBe(validateMemoryPath(NFC));
  });

  it('an NFD write cannot escape a read-only mount declared in NFC', () => {
    const mounts = resolveMemoryMounts([
      { path: '/memories', mode: 'read-write' },
      { path: `/memories/${cafeNFC}`, mode: 'read-only' },
    ]);
    // Without normalization the NFD path would fail to match the NFC read-only
    // mount, fall through to the read-write parent, and be allowed to write.
    expect(mountAllowsWrite(mounts, validateMemoryPath(NFD))).toBe(false);
    // Control: a genuinely-different sibling in the read-write parent is writable.
    expect(mountAllowsWrite(mounts, validateMemoryPath('/memories/other.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// U4-3: rename respects the per-directory file cap
// ---------------------------------------------------------------------------

describe('U4-3: rename into a full directory is capped', () => {
  it('blocks a rename that would exceed maxFilesPerDirectory, allows same-dir rename', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, {
      limits: { maxFilesPerDirectory: 2 },
    });
    await store.create('/memories/d/a.txt', '1');
    await store.create('/memories/d/b.txt', '2');
    await store.create('/memories/loose.txt', '3');

    await expect(store.rename('/memories/loose.txt', '/memories/d/c.txt')).rejects.toThrow(
      /already contains the maximum number of memory files \(2\)/,
    );
    // A rename WITHIN the full directory grows nothing and is still allowed.
    await expect(store.rename('/memories/d/a.txt', '/memories/d/a2.txt')).resolves.toContain(
      'renamed',
    );
  });
});

// ---------------------------------------------------------------------------
// U4-4: atomic local write
// ---------------------------------------------------------------------------

describe('U4-4: local write is atomic (temp + rename)', () => {
  it('overwrites correctly and leaves no temp files behind', async () => {
    const ops = createLocalMemoryFileOps(join(baseDir, 'memories'));
    await ops.write('/memories/x.txt', 'v1');
    await ops.write('/memories/x.txt', 'v2');
    expect(await ops.read('/memories/x.txt')).toBe('v2');
    const names = await readdir(join(baseDir, 'memories'));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(names).toContain('x.txt');
  });
});

// ---------------------------------------------------------------------------
// U4-5: insert into an empty file has no phantom blank line
// ---------------------------------------------------------------------------

describe('U4-5: insert into an empty file', () => {
  it('produces exactly the inserted text', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir);
    await store.create('/memories/empty.txt', '');
    await store.insert('/memories/empty.txt', 0, 'first line');
    expect(await store.view('/memories/empty.txt')).toBe(
      "Here's the content of /memories/empty.txt with line numbers:\n     1\tfirst line",
    );
  });
});

// ---------------------------------------------------------------------------
// U4-6: rename into own subtree is a structured error
// ---------------------------------------------------------------------------

describe('U4-6: rename a directory into its own subtree', () => {
  it('returns a structured error instead of a raw EINVAL', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir);
    await store.create('/memories/dir/a.txt', 'x');
    await expect(store.rename('/memories/dir', '/memories/dir/sub')).rejects.toThrow(
      /Cannot rename \/memories\/dir into its own subdirectory/,
    );
  });
});

// ---------------------------------------------------------------------------
// U4-7: over-long path segment is a structured error
// ---------------------------------------------------------------------------

describe('U4-7: over-long virtual path', () => {
  it('returns a structured error, not a raw ENAMETOOLONG', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir);
    const longSeg = 'a'.repeat(300); // > NAME_MAX (255 bytes)
    await expect(store.create(`/memories/${longSeg}.txt`, 'x')).rejects.toThrow(
      /segment longer than 255 bytes/,
    );
  });
});

// ---------------------------------------------------------------------------
// U4-8: a huge first index line is truncated, not dropped
// ---------------------------------------------------------------------------

describe('U4-8: resident index first line beyond the byte cap', () => {
  it('injects a truncated head instead of silently returning null', async () => {
    const memDir = join(baseDir, 'memories');
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, 'MEMORY.md'), `${'X'.repeat(200)}\nsecond line\n`, 'utf8');

    const runtime = resolveMemoryRuntime({
      memory: { baseDir, indexInjection: { maxBytes: 50 } },
      cwd: baseDir,
      protocol: 'anthropic',
      debug: () => {},
    });
    const injection = await runtime.buildIndexInjection();
    expect(injection).not.toBeNull();
    expect(injection!.text).toContain('truncated');
    expect(injection!.text).toContain('X'.repeat(50));
  });
});

// ---------------------------------------------------------------------------
// U4-9: cards escape convention round-trips marker-like body lines
// ---------------------------------------------------------------------------

describe('U4-9: cards marker-line escaping', () => {
  it('an escaped heading line is literal field content', () => {
    const parsed = parseMemoryCards(
      '## Title\n结论: c\n依据: see below\n' +
        '\\## Subsection heading\n过期条件: never\n',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.cards).toHaveLength(1);
      expect(parsed.cards[0]!.evidence).toContain('## Subsection heading');
      expect(parsed.cards[0]!.evidence).not.toContain('\\##');
    }
  });

  it('an escaped field-marker line is content, not a duplicate field', () => {
    const parsed = parseMemoryCards(
      '## T\n结论: first\n\\结论: still evidence prose\n' +
        '依据: e\n过期条件: x\n',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.cards[0]!.conclusion).toContain('结论: still evidence prose');
    }
  });
});

// ---------------------------------------------------------------------------
// Sfs-2: local rename refuses to clobber an existing destination
// ---------------------------------------------------------------------------

describe('Sfs-2: no-clobber local rename primitive', () => {
  it('refuses to overwrite an existing destination and preserves both files', async () => {
    const ops = createLocalMemoryFileOps(join(baseDir, 'memories'));
    await ops.write('/memories/src.txt', 'source');
    await ops.write('/memories/dst.txt', 'precious');
    // The engine checks the destination first; this drives the PRIMITIVE
    // directly to exercise the atomic no-clobber (the TOCTOU-window fix).
    await expect(ops.rename('/memories/src.txt', '/memories/dst.txt')).rejects.toThrow(
      /destination \/memories\/dst\.txt already exists/,
    );
    expect(await ops.read('/memories/dst.txt')).toBe('precious');
    expect(await ops.read('/memories/src.txt')).toBe('source');
    // A rename to a free destination still works.
    await ops.rename('/memories/src.txt', '/memories/moved.txt');
    expect(await ops.read('/memories/moved.txt')).toBe('source');
  });
});

// ---------------------------------------------------------------------------
// R7s-5: view truncation is surrogate-safe
// ---------------------------------------------------------------------------

describe('R7s-5: truncateViewBody surrogate safety', () => {
  it('the no-newline fallback never leaves a lone surrogate', () => {
    // A cut at 11 lands between the high and low surrogate of the first emoji.
    const body = 'a'.repeat(10) + '\u{1F600}'.repeat(10); // no newline
    const out = truncateViewBody(body, 11);
    // No high surrogate that is not immediately followed by a low surrogate.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    // The ASCII prefix is preserved and the pagination notice appended.
    expect(out).toContain('a'.repeat(10));
    expect(out).toContain('[Output truncated at 11 characters.');
  });

  it('is a no-op under the cap', () => {
    const body = 'short body';
    expect(truncateViewBody(body, 1000)).toBe(body);
  });
});
