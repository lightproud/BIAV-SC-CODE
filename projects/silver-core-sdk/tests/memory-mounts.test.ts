/**
 * Memory scope routing tests (governance spec S1).
 *
 * The acceptance list from the requirements doc, executed literally:
 *  - write commands against a read-only mount are rejected with a structured,
 *    model-readable error;
 *  - reads/writes inside the caller's own read-write mount pass through;
 *  - `../` / absolute-path escapes are rejected (R4 validation still runs
 *    FIRST — mounts stack on top of, never replace, traversal protection);
 *  - enforcement is SDK-layer (tool execution), no prompt involved;
 *  - a session mounted on user A's directory cannot read or write user B's
 *    (outside-mount paths are rejected; ancestor listings are filtered).
 * Plus: mount validation errors, rename double-gating, resident-index gating,
 * and per-call instantiation (two tools over the SAME store with different
 * mounts — the S5 user-session vs synthesis-task shape).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createLocalFilesystemMemoryStore,
  createMemoryTool,
  describeMounts,
  filterAncestorListing,
  mountAllowsWrite,
  mountReadAccess,
  outsideMountsError,
  readOnlyMountError,
  resolveMemoryMounts,
} from '../src/tools/memory/index.js';
import { resolveMemoryRuntime } from '../src/tools/memory/index.js';
import { ConfigurationError } from '../src/errors.js';
import type { ToolContext } from '../src/internal/contracts.js';
import type { MemoryStore } from '../src/types.js';

let baseDir: string;
let store: MemoryStore;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'bpt-mounts-'));
  store = createLocalFilesystemMemoryStore(baseDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function toolCtx(): ToolContext {
  return {
    cwd: '/',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}

const TEAM_RO_USER_RW = resolveMemoryMounts([
  { path: '/memories/team', mode: 'read-only' },
  { path: '/memories/users/alice', mode: 'read-write' },
]);

function makeTool(mounts = TEAM_RO_USER_RW) {
  return createMemoryTool(store, { mounts });
}

async function exec(
  tool: ReturnType<typeof createMemoryTool>,
  input: Record<string, unknown>,
) {
  return await tool.execute(input, toolCtx());
}

describe('resolveMemoryMounts (configuration validation)', () => {
  it('canonicalizes paths and tolerates trailing slashes', () => {
    const mounts = resolveMemoryMounts([{ path: '/memories/team/', mode: 'read-only' }]);
    expect(mounts).toEqual([{ path: '/memories/team', mode: 'read-only' }]);
  });

  it('rejects an empty mount list, a bad mode, and a non-/memories path', () => {
    expect(() => resolveMemoryMounts([])).toThrow(ConfigurationError);
    expect(() =>
      resolveMemoryMounts([{ path: '/memories/x', mode: 'rw' as 'read-write' }]),
    ).toThrow(ConfigurationError);
    expect(() =>
      resolveMemoryMounts([{ path: '/etc/passwd', mode: 'read-write' }]),
    ).toThrow(ConfigurationError);
    expect(() =>
      resolveMemoryMounts([{ path: '/memories/../etc', mode: 'read-write' }]),
    ).toThrow(ConfigurationError);
  });

  it('undefined mounts resolve to null (unrestricted, pre-S1 behavior)', () => {
    expect(resolveMemoryMounts(undefined)).toBeNull();
    expect(mountReadAccess(null, '/memories/anything')).toBe('full');
    expect(mountAllowsWrite(null, '/memories/anything')).toBe(true);
  });

  it('the structured error builders name the mounts so the model can reroute', () => {
    const mounts = TEAM_RO_USER_RW!;
    expect(describeMounts(mounts)).toBe(
      '/memories/team (read-only), /memories/users/alice (read-write)',
    );
    const outside = outsideMountsError(mounts, '/memories/users/bob/x.md');
    expect(outside).toContain('outside the memory areas mounted');
    expect(outside).toContain('/memories/team (read-only)');
    const readOnly = readOnlyMountError(mounts, '/memories/team/x.md');
    expect(readOnly).toContain('read-only in this session');
    expect(readOnly).toContain('Writable mounts: /memories/users/alice');
    // No writable mount at all -> the error says so instead of listing nothing.
    const noneWritable = readOnlyMountError(
      resolveMemoryMounts([{ path: '/memories/team', mode: 'read-only' }])!,
      '/memories/team/x.md',
    );
    expect(noneWritable).toContain('(none)');
  });
});

describe('S1 acceptance: write routing', () => {
  it('create / str_replace / delete against the read-only team mount are rejected', async () => {
    const tool = makeTool();
    const create = await exec(tool, {
      command: 'create',
      path: '/memories/team/notes.md',
      file_text: 'x',
    });
    expect(create.isError).toBe(true);
    expect(create.content).toContain('read-only in this session');
    expect(create.content).toContain('/memories/users/alice');

    const sr = await exec(tool, {
      command: 'str_replace',
      path: '/memories/team/notes.md',
      old_str: 'a',
      new_str: 'b',
    });
    expect(sr.isError).toBe(true);
    expect(sr.content).toContain('read-only in this session');

    const del = await exec(tool, { command: 'delete', path: '/memories/team/notes.md' });
    expect(del.isError).toBe(true);
    expect(del.content).toContain('read-only in this session');
  });

  it('the model reads and writes its own read-write mount normally', async () => {
    const tool = makeTool();
    const create = await exec(tool, {
      command: 'create',
      path: '/memories/users/alice/log.md',
      file_text: 'hello\n',
    });
    expect(create.isError).not.toBe(true);
    const view = await exec(tool, {
      command: 'view',
      path: '/memories/users/alice/log.md',
    });
    expect(view.isError).not.toBe(true);
    expect(view.content).toContain('hello');
  });

  it('`../` and out-of-root paths are still rejected (R4 stacks under S1)', async () => {
    const tool = makeTool();
    const traversal = await exec(tool, {
      command: 'create',
      path: '/memories/users/alice/../bob/x.md',
      file_text: 'x',
    });
    expect(traversal.isError).toBe(true);
    expect(traversal.content).toContain('would escape');

    const absolute = await exec(tool, {
      command: 'create',
      path: '/etc/hosts',
      file_text: 'x',
    });
    expect(absolute.isError).toBe(true);
    expect(absolute.content).toContain('must start with /memories');
  });

  it("user A's session cannot write user B's directory (outside every mount)", async () => {
    const tool = makeTool();
    const write = await exec(tool, {
      command: 'create',
      path: '/memories/users/bob/x.md',
      file_text: 'x',
    });
    expect(write.isError).toBe(true);
    expect(write.content).toContain('outside the memory areas mounted');
  });

  it('rename is gated at BOTH ends', async () => {
    const tool = makeTool();
    await exec(tool, {
      command: 'create',
      path: '/memories/users/alice/a.md',
      file_text: 'x',
    });
    // rw -> ro: rejected.
    const out = await exec(tool, {
      command: 'rename',
      old_path: '/memories/users/alice/a.md',
      new_path: '/memories/team/a.md',
    });
    expect(out.isError).toBe(true);
    // ro -> rw: rejected (removal from the read-only side is a write there).
    const seeded = createMemoryTool(store, { mounts: null });
    await seeded.execute(
      { command: 'create', path: '/memories/team/t.md', file_text: 'x' },
      toolCtx(),
    );
    const steal = await exec(tool, {
      command: 'rename',
      old_path: '/memories/team/t.md',
      new_path: '/memories/users/alice/t.md',
    });
    expect(steal.isError).toBe(true);
    // rw -> rw: allowed.
    const ok = await exec(tool, {
      command: 'rename',
      old_path: '/memories/users/alice/a.md',
      new_path: '/memories/users/alice/b.md',
    });
    expect(ok.isError).not.toBe(true);
  });
});

describe('S1 acceptance: read routing', () => {
  it("user A cannot view user B's files, and ancestor listings hide B entirely", async () => {
    const unrestricted = createMemoryTool(store, { mounts: null });
    await unrestricted.execute(
      { command: 'create', path: '/memories/users/bob/secret.md', file_text: 'hidden' },
      toolCtx(),
    );
    await unrestricted.execute(
      { command: 'create', path: '/memories/users/alice/mine.md', file_text: 'mine' },
      toolCtx(),
    );
    await unrestricted.execute(
      { command: 'create', path: '/memories/team/shared.md', file_text: 'team' },
      toolCtx(),
    );

    const tool = makeTool();
    const direct = await exec(tool, {
      command: 'view',
      path: '/memories/users/bob/secret.md',
    });
    expect(direct.isError).toBe(true);
    expect(direct.content).toContain('outside the memory areas mounted');

    // Root view survives for navigation, but bob's subtree is filtered out.
    const root = await exec(tool, { command: 'view', path: '/memories' });
    expect(root.isError).not.toBe(true);
    const listing = String(root.content);
    expect(listing).toContain('/memories/team');
    expect(listing).toContain('/memories/users/alice');
    expect(listing).not.toContain('bob');

    // The read-only team mount is fully readable.
    const team = await exec(tool, { command: 'view', path: '/memories/team/shared.md' });
    expect(team.isError).not.toBe(true);
    expect(team.content).toContain('team');
  });

  it('filterAncestorListing keeps the header, the viewed dir and mount-path lines only', () => {
    const mounts = resolveMemoryMounts([
      { path: '/memories/users/alice', mode: 'read-write' },
    ])!;
    const listing = [
      "Here're the files and directories up to 2 levels deep in /memories, excluding hidden items and node_modules:",
      '4K\t/memories',
      '1K\t/memories/scratch.md',
      '2K\t/memories/users/',
      '1K\t/memories/users/alice/',
      '1K\t/memories/users/bob/',
    ].join('\n');
    const filtered = filterAncestorListing(mounts, '/memories', listing);
    expect(filtered).toContain('/memories/users/');
    expect(filtered).toContain('/memories/users/alice/');
    expect(filtered).not.toContain('scratch.md');
    expect(filtered).not.toContain('bob');
  });
});

describe('S1/S5: per-call mount instantiation over one store', () => {
  it('a user session (team ro) and a synthesis task (team rw) coexist on the same store', async () => {
    const userTool = createMemoryTool(store, {
      mounts: resolveMemoryMounts([{ path: '/memories/team', mode: 'read-only' }]),
    });
    const synthesisTool = createMemoryTool(store, {
      mounts: resolveMemoryMounts([{ path: '/memories/team', mode: 'read-write' }]),
    });
    const denied = await userTool.execute(
      { command: 'create', path: '/memories/team/decision.md', file_text: 'no' },
      toolCtx(),
    );
    expect(denied.isError).toBe(true);
    const allowed = await synthesisTool.execute(
      { command: 'create', path: '/memories/team/decision.md', file_text: 'yes' },
      toolCtx(),
    );
    expect(allowed.isError).not.toBe(true);
    // And the user session READS what synthesis wrote.
    const read = await userTool.execute(
      { command: 'view', path: '/memories/team/decision.md' },
      toolCtx(),
    );
    expect(read.content).toContain('yes');
  });
});

describe('S1: resident index injection respects mounts', () => {
  it('skips injection when /memories/MEMORY.md is not readable under the mounts', async () => {
    const unrestricted = createMemoryTool(store, { mounts: null });
    await unrestricted.execute(
      { command: 'create', path: '/memories/MEMORY.md', file_text: '# index\nteam facts' },
      toolCtx(),
    );
    const runtime = resolveMemoryRuntime({
      memory: {
        store,
        mounts: [{ path: '/memories/users/alice', mode: 'read-write' }],
      },
      cwd: '/',
      protocol: 'anthropic',
      debug: () => {},
    });
    expect(await runtime.buildIndexInjection()).toBeNull();

    const covered = resolveMemoryRuntime({
      memory: { store, mounts: [{ path: '/memories', mode: 'read-write' }] },
      cwd: '/',
      protocol: 'anthropic',
      debug: () => {},
    });
    const injection = await covered.buildIndexInjection();
    expect(injection).not.toBeNull();
    expect(injection!.text).toContain('team facts');
  });
});
