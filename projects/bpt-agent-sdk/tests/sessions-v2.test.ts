/**
 * v0.2 sessions subsystem: external SessionStore adapter, file checkpointing,
 * deferred tool search, and standalone session helpers.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  InMemorySessionStore,
  MirroringSessionStore,
  encodeProjectKey,
} from '../src/sessions/store-adapter.js';
import { FileCheckpointStore, makeCheckpointRecorder } from '../src/sessions/checkpoints.js';
import {
  deleteSession,
  forkSession,
  getSessionMessages,
  renameSession,
  tagSession,
} from '../src/sessions/session-functions.js';
import {
  DEFERRED_THRESHOLD,
  DeferredMcpRegistry,
  makeToolSearchTool,
  shouldActivate,
} from '../src/tools/toolsearch.js';
import { JsonlSessionStore } from '../src/sessions/store.js';
import { ConfigurationError } from '../src/errors.js';
import type {
  SessionKey,
  SessionStore as ExternalSessionStore,
  SessionStoreEntry,
} from '../src/types.js';
import type { McpRegistry, McpToolEntry, ToolContext } from '../src/internal/contracts.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bpt-sessv2-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PK = encodeProjectKey('/home/user/project');

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// encodeProjectKey
// ---------------------------------------------------------------------------

describe('encodeProjectKey', () => {
  it('keeps a readable dash-mapped prefix (previously the whole key)', () => {
    // The old encoding was JUST the dash-mapped string; it is now the prefix,
    // followed by a `-` and a short hash of the raw cwd.
    expect(encodeProjectKey('/home/user/my.proj')).toMatch(/^-home-user-my-proj-[0-9a-f]{12}$/);
    expect(encodeProjectKey('C:\\a b')).toMatch(/^C--a-b-[0-9a-f]{12}$/);
  });

  it('is deterministic for a given cwd', () => {
    expect(encodeProjectKey('/srv/app-1')).toBe(encodeProjectKey('/srv/app-1'));
  });

  it('does NOT collide across cwds that dash-map to the same string (finding 10)', () => {
    // All three collapse to "-srv-app-1" under the naive mapping; the hash
    // suffix must keep them distinct so sessions cannot cross-contaminate.
    const a = encodeProjectKey('/srv/app-1');
    const b = encodeProjectKey('/srv/app_1');
    const c = encodeProjectKey('/srv/app/1');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------

describe('InMemorySessionStore', () => {
  it('append/load preserves order and returns null for unknown', async () => {
    const s = new InMemorySessionStore();
    const key: SessionKey = { projectKey: PK, sessionId: 'a' };
    await s.append(key, [{ type: 'user', uuid: '1' }, { type: 'assistant', uuid: '2' }]);
    const loaded = await s.load(key);
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '2']);
    expect(await s.load({ projectKey: PK, sessionId: 'missing' })).toBeNull();
  });

  it('dedups by entry.uuid across appends', async () => {
    const s = new InMemorySessionStore();
    const key: SessionKey = { projectKey: PK, sessionId: 'a' };
    await s.append(key, [{ type: 'user', uuid: '1' }]);
    await s.append(key, [{ type: 'user', uuid: '1' }, { type: 'user', uuid: '2' }]);
    const loaded = await s.load(key);
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '2']);
  });

  it('listSessions returns main-transcript ids newest first', async () => {
    const s = new InMemorySessionStore();
    await s.append({ projectKey: PK, sessionId: 'older' }, [{ type: 'user', uuid: 'a' }]);
    await new Promise((r) => setTimeout(r, 2));
    await s.append({ projectKey: PK, sessionId: 'newer' }, [{ type: 'user', uuid: 'b' }]);
    // A subkey must NOT appear as a session.
    await s.append({ projectKey: PK, sessionId: 'older', subpath: 'subagents/x' }, [
      { type: 'user', uuid: 'c' },
    ]);
    const list = await s.listSessions(PK);
    expect(list.map((e) => e.sessionId)).toEqual(['newer', 'older']);
  });

  it('delete of the main key cascades to subkeys', async () => {
    const s = new InMemorySessionStore();
    const main: SessionKey = { projectKey: PK, sessionId: 'a' };
    const sub: SessionKey = { projectKey: PK, sessionId: 'a', subpath: 'subagents/x' };
    await s.append(main, [{ type: 'user', uuid: '1' }]);
    await s.append(sub, [{ type: 'user', uuid: '2' }]);
    expect(await s.listSubkeys({ projectKey: PK, sessionId: 'a' })).toEqual(['subagents/x']);
    await s.delete(main);
    expect(await s.load(main)).toBeNull();
    expect(await s.load(sub)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MirroringSessionStore
// ---------------------------------------------------------------------------

/** Spy external store with configurable append behavior. */
class SpyStore implements ExternalSessionStore {
  appendCalls = 0;
  readonly received: SessionStoreEntry[] = [];
  mode: 'ok' | 'reject' | 'hang' | { failTimes: number } = 'ok';
  private failed = 0;
  private readonly mem = new InMemorySessionStore();

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    this.appendCalls += 1;
    if (this.mode === 'hang') return new Promise<void>(() => {});
    if (this.mode === 'reject') throw new Error('boom');
    if (typeof this.mode === 'object') {
      if (this.failed < this.mode.failTimes) {
        this.failed += 1;
        throw new Error('transient');
      }
    }
    this.received.push(...entries);
    await this.mem.append(key, entries);
  }

  load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    return this.mem.load(key);
  }

  seed(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    return this.mem.append(key, entries);
  }
}

function makeLocal(): JsonlSessionStore {
  return new JsonlSessionStore({ sessionDir: dir });
}

const userEntry = (uuid: string) => ({
  type: 'user',
  uuid,
  message: { role: 'user', content: 'hi' },
});

describe('MirroringSessionStore', () => {
  it('writes locally even when the external append rejects, then emits mirror_error', async () => {
    const spy = new SpyStore();
    spy.mode = 'reject';
    const local = makeLocal();
    const mirror = new MirroringSessionStore(local, spy, {
      projectKey: PK,
      flush: 'eager',
      backoffBaseMs: 1,
    });
    mirror.append('sess-a', userEntry('u1'));
    // Local durable immediately.
    const loaded = await local.load('sess-a');
    expect(loaded?.messages.length).toBe(1);
    // Let the eager flush + retries run.
    await mirror.flushAll();
    const events = mirror.takePendingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.subtype).toBe('mirror_error');
    expect(events[0]?.session_id).toBe('sess-a');
  });

  it('retries up to 3 attempts then succeeds without an error event', async () => {
    const spy = new SpyStore();
    spy.mode = { failTimes: 2 };
    const mirror = new MirroringSessionStore(makeLocal(), spy, {
      projectKey: PK,
      flush: 'eager',
      backoffBaseMs: 1,
    });
    mirror.append('sess-b', userEntry('u1'));
    await mirror.flushAll();
    expect(spy.appendCalls).toBe(3);
    expect(mirror.takePendingEvents()).toHaveLength(0);
    expect(spy.received.map((e) => e.uuid)).toEqual(['u1']);
  });

  it('does not retry a timed-out attempt', async () => {
    const spy = new SpyStore();
    spy.mode = 'hang';
    const mirror = new MirroringSessionStore(makeLocal(), spy, {
      projectKey: PK,
      flush: 'eager',
      loadTimeoutMs: 15,
      backoffBaseMs: 1,
    });
    mirror.append('sess-c', userEntry('u1'));
    await new Promise((r) => setTimeout(r, 50));
    await mirror.flushAll();
    expect(spy.appendCalls).toBe(1); // timed out -> not retried
    expect(mirror.takePendingEvents()).toHaveLength(1);
  });

  it('eager flushes on a microtask; batched waits for flushAll', async () => {
    const eagerSpy = new SpyStore();
    const eager = new MirroringSessionStore(makeLocal(), eagerSpy, {
      projectKey: PK,
      flush: 'eager',
    });
    eager.append('sess-e', userEntry('u1'));
    await tick();
    expect(eagerSpy.received).toHaveLength(1);

    const batchSpy = new SpyStore();
    const batched = new MirroringSessionStore(makeLocal(), batchSpy, {
      projectKey: PK,
      flush: 'batched',
      debounceMs: 10_000,
    });
    batched.append('sess-f', userEntry('u1'));
    await tick();
    expect(batchSpy.received).toHaveLength(0);
    await batched.flushAll();
    expect(batchSpy.received).toHaveLength(1);
  });

  it('load falls back to the external store and materializes locally', async () => {
    const spy = new SpyStore();
    const key: SessionKey = { projectKey: PK, sessionId: 'sess-remote' };
    await spy.seed(key, [
      { type: 'meta', uuid: 'm', sessionId: 'sess-remote', createdAt: 1 },
      { ...userEntry('u1') },
    ]);
    const local = makeLocal();
    const mirror = new MirroringSessionStore(local, spy, { projectKey: PK });
    // Local is empty -> pulls from external + materializes.
    const loaded = await mirror.load('sess-remote');
    expect(loaded?.messages.length).toBe(1);
    // Materialized: the plain local store now has it on disk.
    expect((await local.load('sess-remote'))?.messages.length).toBe(1);
  });

  it('filePath delegates to the wrapped JsonlSessionStore and matches its path (v0.18.2)', async () => {
    const local = makeLocal();
    const mirror = new MirroringSessionStore(local, new SpyStore(), {
      projectKey: PK,
      flush: 'eager',
      backoffBaseMs: 1,
    });
    // Same path the raw local store reports — this is what runtime.ts reads to
    // populate the SubagentStop hook's agent_transcript_path.
    expect(mirror.filePath('agent-x')).toBe(local.filePath('agent-x'));
    // And the transcript is really materialized on disk after a write.
    mirror.append('agent-x', userEntry('u1'));
    await mirror.flushAll();
    expect(existsSync(local.filePath('agent-x'))).toBe(true);
  });

  it('filePath returns undefined when the wrapped local store lacks it (v0.18.2)', () => {
    // A bare InternalTranscriptStore stub with no filePath concretion
    // (mirrors InMemorySessionStore-style locals): the duck-type must not throw.
    const mirror = new MirroringSessionStore(
      {
        append() {},
        async load() {
          return null;
        },
        async list() {
          return [];
        },
        async latestSessionId() {
          return null;
        },
      },
      new SpyStore(),
      { projectKey: PK },
    );
    expect(mirror.filePath('agent-x')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FileCheckpointStore
// ---------------------------------------------------------------------------

function makeCheckpoints(): FileCheckpointStore {
  return new FileCheckpointStore({ sessionDir: dir });
}

describe('FileCheckpointStore', () => {
  it('records blobs + index lines and restores a modified file', async () => {
    const target = join(dir, 'f.txt');
    await writeFile(target, 'OLD', 'utf8');
    const cp = makeCheckpoints();
    cp.bind('sess-1');
    cp.beginTurn('m1');
    const record = makeCheckpointRecorder(cp);
    record(target, 'OLD');
    await writeFile(target, 'NEW', 'utf8');

    const res = await cp.rewind('m1', {});
    // B2b/T2-2: official fields lead; insertions/deletions honestly absent.
    expect(res.canRewind).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.filesChanged).toEqual([target]);
    expect(res.insertions).toBeUndefined();
    expect(res.deletions).toBeUndefined();
    // Deprecated dual-track fields still populated.
    expect(res.restoredFiles).toEqual([target]);
    expect(res.deletedFiles).toEqual([]);
    expect(await readFile(target, 'utf8')).toBe('OLD');
  });

  it('deletes a file that was created after the checkpoint', async () => {
    const target = join(dir, 'created.txt');
    const cp = makeCheckpoints();
    cp.bind('sess-2');
    cp.beginTurn('m1');
    cp.record(target, null); // created -> no pre-image
    await writeFile(target, 'DATA', 'utf8');

    const res = await cp.rewind('m1', {});
    expect(res.deletedFiles).toEqual([target]);
    expect(existsSync(target)).toBe(false);
  });

  it('keeps the first pre-image per turn (dedup)', async () => {
    const target = join(dir, 'g.txt');
    await writeFile(target, 'V0', 'utf8');
    const cp = makeCheckpoints();
    cp.bind('sess-3');
    cp.beginTurn('m1');
    cp.record(target, 'V0');
    cp.record(target, 'V1'); // ignored - same path, same turn
    await writeFile(target, 'V2', 'utf8');
    await cp.rewind('m1', {});
    expect(await readFile(target, 'utf8')).toBe('V0');
  });

  it('first-wins across turns when rewinding to the earliest', async () => {
    const target = join(dir, 'h.txt');
    await writeFile(target, 'A', 'utf8');
    const cp = makeCheckpoints();
    cp.bind('sess-4');
    cp.beginTurn('m1');
    cp.record(target, 'A');
    await writeFile(target, 'B', 'utf8');
    cp.beginTurn('m2');
    cp.record(target, 'B');
    await writeFile(target, 'C', 'utf8');
    const res = await cp.rewind('m1', {});
    expect(res.restoredFiles).toEqual([target]);
    expect(await readFile(target, 'utf8')).toBe('A');
  });

  it('dryRun computes the plan without touching disk', async () => {
    const target = join(dir, 'dry.txt');
    await writeFile(target, 'OLD', 'utf8');
    const cp = makeCheckpoints();
    cp.bind('sess-5');
    cp.beginTurn('m1');
    cp.record(target, 'OLD');
    await writeFile(target, 'NEW', 'utf8');
    const res = await cp.rewind('m1', { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.restoredFiles).toEqual([target]);
    expect(await readFile(target, 'utf8')).toBe('NEW'); // untouched
  });

  it('soft-fails for an unknown checkpoint id (official canRewind/error shape)', async () => {
    const cp = makeCheckpoints();
    cp.bind('sess-6');
    cp.beginTurn('m1');
    cp.record(join(dir, 'x.txt'), null);
    // B2b/T2-2: an unknown id resolves with the official soft-fail shape
    // instead of throwing (configuration misuse still throws elsewhere).
    const res = await cp.rewind('nope', {});
    expect(res.canRewind).toBe(false);
    expect(res.error).toContain('No file checkpoint found for message nope');
    expect(res.filesChanged).toBeUndefined();
    expect(res.restoredFiles).toEqual([]);
    expect(res.deletedFiles).toEqual([]);
  });

  it('survives a fresh bind (resume) via the on-disk index', async () => {
    const target = join(dir, 'resume.txt');
    await writeFile(target, 'OLD', 'utf8');
    const first = makeCheckpoints();
    first.bind('sess-7');
    first.beginTurn('m1');
    first.record(target, 'OLD');
    await writeFile(target, 'NEW', 'utf8');

    // A second process/query rebinds and rewinds.
    const second = makeCheckpoints();
    second.bind('sess-7');
    const res = await second.rewind('m1', {});
    expect(res.restoredFiles).toEqual([target]);
    expect(await readFile(target, 'utf8')).toBe('OLD');
  });
});

// ---------------------------------------------------------------------------
// DeferredMcpRegistry + ToolSearch
// ---------------------------------------------------------------------------

function toolEntry(server: string, name: string): McpToolEntry {
  return {
    qualifiedName: `mcp__${server}__${name}`,
    serverName: server,
    toolName: name,
    description: `${name} does ${name}`,
    inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
  };
}

/** Minimal fake registry exposing a fixed tool list. */
function makeFakeRegistry(tools: McpToolEntry[]): McpRegistry {
  const set = new Set(tools.map((t) => t.qualifiedName));
  return {
    async connectAll() {},
    statuses: () => [],
    allTools: () => tools,
    has: (q) => set.has(q),
    async call() {
      return { content: [{ type: 'text', text: 'ok' }] };
    },
    async reconnect() {},
    setEnabled() {},
    async setServers() {
      return { servers: [] };
    },
    async closeAll() {},
  };
}

const fakeCtx = {} as ToolContext;

describe('DeferredMcpRegistry', () => {
  it('is a pass-through while inactive', () => {
    const tools = [toolEntry('s', 'a'), toolEntry('s', 'b')];
    const reg = new DeferredMcpRegistry(makeFakeRegistry(tools));
    expect(reg.isActive()).toBe(false);
    expect(reg.allTools()).toHaveLength(2);
    expect(reg.has('mcp__s__a')).toBe(true);
  });

  it('while active exposes only loaded tools but has() stays true for all', () => {
    const tools = [toolEntry('s', 'a'), toolEntry('s', 'b')];
    const reg = new DeferredMcpRegistry(makeFakeRegistry(tools));
    reg.activateIfNeeded(true);
    expect(reg.isActive()).toBe(true);
    expect(reg.allTools()).toHaveLength(0);
    // unloaded tool is still callable (context-saving, not access control)
    expect(reg.has('mcp__s__b')).toBe(true);
    reg.markLoaded(['mcp__s__a']);
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__s__a']);
  });

  it('activation threshold: auto turns on only above DEFERRED_THRESHOLD', () => {
    expect(shouldActivate(undefined, DEFERRED_THRESHOLD)).toBe(false);
    expect(shouldActivate(undefined, DEFERRED_THRESHOLD + 1)).toBe(true);
    expect(shouldActivate(false, 1000)).toBe(false);
    expect(shouldActivate(true, 0)).toBe(true);

    const many = Array.from({ length: DEFERRED_THRESHOLD + 1 }, (_, i) => toolEntry('s', `t${i}`));
    const reg = new DeferredMcpRegistry(makeFakeRegistry(many));
    reg.activateIfNeeded(undefined);
    expect(reg.isActive()).toBe(true);
  });
});

describe('ToolSearch builtin', () => {
  it('is read-only and named ToolSearch', () => {
    const reg = new DeferredMcpRegistry(makeFakeRegistry([toolEntry('s', 'a')]));
    const tool = makeToolSearchTool(reg);
    expect(tool.name).toBe('ToolSearch');
    expect(tool.readOnly).toBe(true);
  });

  it('query match marks tools loaded and returns their schemas', async () => {
    const tools = [toolEntry('gh', 'create_issue'), toolEntry('gh', 'list_repos')];
    const reg = new DeferredMcpRegistry(makeFakeRegistry(tools));
    reg.activateIfNeeded(true);
    const tool = makeToolSearchTool(reg);
    const res = await tool.execute({ query: 'issue' }, fakeCtx);
    expect(typeof res.content).toBe('string');
    expect(res.content as string).toContain('mcp__gh__create_issue');
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__gh__create_issue']);
  });

  it('exact names match loads those tools', async () => {
    const tools = [toolEntry('gh', 'a'), toolEntry('gh', 'b')];
    const reg = new DeferredMcpRegistry(makeFakeRegistry(tools));
    reg.activateIfNeeded(true);
    const tool = makeToolSearchTool(reg);
    await tool.execute({ names: ['mcp__gh__b'] }, fakeCtx);
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__gh__b']);
  });

  it('no match returns guidance and loads nothing', async () => {
    const reg = new DeferredMcpRegistry(makeFakeRegistry([toolEntry('gh', 'a')]));
    reg.activateIfNeeded(true);
    const tool = makeToolSearchTool(reg);
    const res = await tool.execute({ query: 'zzz-nope' }, fakeCtx);
    expect(res.content as string).toContain('No tools matched');
    expect(reg.allTools()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Standalone session helpers
// ---------------------------------------------------------------------------

function seedLocalSession(sessionId: string, entries: Record<string, unknown>[]): void {
  const store = new JsonlSessionStore({ sessionDir: dir });
  for (const e of entries) store.append(sessionId, e);
}

describe('session helpers (local)', () => {
  it('getSessionMessages maps uuids and falls back for legacy lines', async () => {
    seedLocalSession('s1', [
      { type: 'meta', sessionId: 's1', createdAt: 1 },
      {
        type: 'user',
        uuid: 'uu-1',
        session_id: 's1',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hi' },
      },
      // legacy line: no uuid
      { type: 'assistant', message: { role: 'assistant', content: 'yo' } },
    ]);
    const msgs = await getSessionMessages('s1', { sessionDir: dir });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.uuid).toBe('uu-1');
    expect(msgs[0]?.type).toBe('user');
    expect(typeof msgs[1]?.uuid).toBe('string');
    expect((msgs[1]?.uuid ?? '').length).toBeGreaterThan(0);
  });

  it('renameSession and tagSession append meta_update entries', async () => {
    seedLocalSession('s2', [{ type: 'meta', sessionId: 's2' }]);
    await renameSession('s2', 'My Title', { sessionDir: dir });
    await tagSession('s2', 'important', { sessionDir: dir });
    await tagSession('s2', null, { sessionDir: dir });
    const raw = await readFile(join(dir, 's2.jsonl'), 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    const metas = lines.filter((l) => l.type === 'meta_update');
    expect(metas).toHaveLength(3);
    expect(metas[0].customTitle).toBe('My Title');
    expect(metas[1].tag).toBe('important');
    expect(metas[2].tag).toBeNull();
  });

  it('deleteSession removes the transcript and its checkpoint dir', async () => {
    seedLocalSession('s3', [{ type: 'meta', sessionId: 's3' }]);
    mkdirSync(join(dir, 'checkpoints', 's3'), { recursive: true });
    writeFileSync(join(dir, 'checkpoints', 's3', 'index.jsonl'), '{}\n');
    expect(existsSync(join(dir, 's3.jsonl'))).toBe(true);
    await deleteSession('s3', { sessionDir: dir });
    expect(existsSync(join(dir, 's3.jsonl'))).toBe(false);
    expect(existsSync(join(dir, 'checkpoints', 's3'))).toBe(false);
  });

  it('forkSession mints a new id with rewritten session_id and distinct uuids', async () => {
    seedLocalSession('s4', [
      { type: 'meta', sessionId: 's4', createdAt: 1 },
      {
        type: 'user',
        uuid: 'orig-1',
        session_id: 's4',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hi' },
      },
    ]);
    const newId = await forkSession('s4', { sessionDir: dir });
    expect(newId).not.toBe('s4');
    const raw = await readFile(join(dir, `${newId}.jsonl`), 'utf8');
    const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].sessionId).toBe(newId);
    expect(lines[1].session_id).toBe(newId);
    expect(lines[1].uuid).not.toBe('orig-1');
    expect(typeof lines[1].uuid).toBe('string');
  });
});

describe('session helpers (external store)', () => {
  const opts = () => ({ sessionStore: store, cwd: '/home/user/project' });
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('getSessionMessages reads via the external store', async () => {
    await store.append({ projectKey: PK, sessionId: 'e1' }, [
      {
        type: 'user',
        uuid: 'x1',
        session_id: 'e1',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hi' },
      },
    ]);
    const msgs = await getSessionMessages('e1', opts());
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.uuid).toBe('x1');
  });

  it('renameSession appends a meta_update through the store', async () => {
    await renameSession('e2', 'T', opts());
    const entries = await store.load({ projectKey: PK, sessionId: 'e2' });
    expect(entries?.[0]?.type).toBe('meta_update');
    expect(entries?.[0]?.customTitle).toBe('T');
  });

  it('deleteSession cascades via store.delete', async () => {
    await store.append({ projectKey: PK, sessionId: 'e3' }, [{ type: 'user', uuid: 'u' }]);
    await deleteSession('e3', opts());
    expect(await store.load({ projectKey: PK, sessionId: 'e3' })).toBeNull();
  });

  it('forkSession rewrites session_id under the new key', async () => {
    await store.append({ projectKey: PK, sessionId: 'e4' }, [
      { type: 'user', uuid: 'o1', session_id: 'e4', message: { role: 'user', content: 'hi' } },
    ]);
    const newId = await forkSession('e4', opts());
    const forked = await store.load({ projectKey: PK, sessionId: newId });
    expect(forked?.[0]?.session_id).toBe(newId);
    expect(forked?.[0]?.uuid).not.toBe('o1');
  });
});
