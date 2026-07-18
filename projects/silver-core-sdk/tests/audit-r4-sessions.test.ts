/**
 * Audit r4 (2026-07-17) — sessions cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y8-3: q.throw() on a SessionManager-managed query settles its ledger (the
 *    third generator exit, alongside next()-done and return()), so a query
 *    terminated by throw() no longer leaks its ledger / stays counted live.
 *  - V3-1: query({resume, forkSession:true}) copies the S3 tool_call telemetry
 *    AND the title/tag, matching standalone forkSession() (which copies every
 *    raw entry) — getSessionToolCalls(fork) is non-empty and the title survives.
 *  - V3-2: JsonlSessionStore.load() recognizes tool_call records (no "unrecognized
 *    line" warning per record) and surfaces them on toolCallRecords.
 *  - V3-3: file-checkpoint rewind windows from the turn_start MARKER seq, so a
 *    concurrent sibling instance's in-window records are included in the undo.
 *  - Sfs-3: a rewind that could not apply its whole plan reports canRewind:false
 *    + error instead of a false success.
 *  - Rst-3: JsonlSessionStore.list() breaks lastModified ties on session id
 *    (deterministic limit boundary).
 *  - Rst-4: FileSessionStore.listSessions() breaks mtime ties on session id.
 *  - R7s-4: listSessions summary/title truncation never splits a surrogate pair.
 */

import { appendFileSync, rmSync, utimesSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBptSession, InMemorySessionStore } from '../src/index.js';
import {
  JsonlSessionStore,
  getSessionInfo,
  listSessions,
} from '../src/sessions/store.js';
import { createSessionPersistence } from '../src/sessions/persistence.js';
import { FileCheckpointStore } from '../src/sessions/checkpoints.js';
import { FileSessionStore } from '../src/sessions/file-store.js';
import { getSessionToolCalls } from '../src/sessions/session-functions.js';
import type { Query, SDKMessage } from '../src/types.js';

const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Module-private typed sentinel — never `new Error(...)` (audit §6). */
class ConsumerAbortError extends Error {
  override name = 'ConsumerAbortError';
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'audit-r4-sessions-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function noopDebug(): void {
  /* silent */
}

// ---------------------------------------------------------------------------
// Y8-3: throw() on a managed query settles the ledger
// ---------------------------------------------------------------------------

describe('Y8-3: q.throw() terminates a managed query and keeps accounting sane', () => {
  function managerOptions(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      provider: { apiKey: 'test-key', promptCaching: false },
      sessionDir: dir,
      cwd: dir, // hermetic: no project .mcp.json under a fresh temp dir
      env: { PATH: process.env.PATH },
      model: 'claude-sonnet-4-5',
      ...extra,
    };
  }

  it('non-supervised path (instrumentUsage): throw rejects and the query is counted once', async () => {
    const mgr = createBptSession(managerOptions() as never);
    // Throw at suspended-start (before any pull): the underlying run() generator
    // has not begun, so throw() cleanly rejects with the sentinel while the
    // wrapper settles the ledger — deterministic, no engine drive needed.
    const q = mgr.query({ prompt: 'hello' }) as Query;
    const sentinel = new ConsumerAbortError('consumer-driven abort');
    await expect(q.throw(sentinel)).rejects.toBe(sentinel);
    // Accounted exactly once (settle is idempotent; no double, no loss).
    expect(mgr.usage().queries).toBe(1);
    await mgr.close();
  });

  it('supervised path (runManaged): throw rejects and the query is counted once', async () => {
    const mgr = createBptSession(
      managerOptions({ sessionStore: new InMemorySessionStore() }) as never,
    );
    const q = mgr.query({ prompt: 'hello' }) as Query;
    const sentinel = new ConsumerAbortError('consumer-driven abort');
    await expect(q.throw(sentinel)).rejects.toBe(sentinel);
    expect(mgr.usage().queries).toBe(1);
    await mgr.close();
  });
});

// ---------------------------------------------------------------------------
// V3-1 / V3-2: tool_call + title survive a query-resume fork; no false warnings
// ---------------------------------------------------------------------------

function seedSource(store: JsonlSessionStore, sid: string): void {
  store.append(sid, {
    type: 'meta',
    sessionId: sid,
    createdAt: Date.now(),
    cwd: dir,
    firstPrompt: 'hello',
  });
  store.append(sid, {
    type: 'user',
    uuid: 'u-1',
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: 'hello' },
  });
  store.append(sid, {
    type: 'tool_call',
    uuid: 'tc-1',
    session_id: sid,
    seq: 1,
    timestamp: new Date().toISOString(),
    tool_use_id: 'toolu_1',
    tool_name: 'Read',
    tool_input: '{"file":"x.txt"}',
    status: 'ok',
    duration_ms: 5,
    result_summary: 'ok',
  });
  store.append(sid, { type: 'meta_update', uuid: 'mu-1', customTitle: 'My Title' });
}

describe('V3-2: load() recognizes tool_call records', () => {
  it('surfaces toolCallRecords and emits no "unrecognized" warning', async () => {
    const warnings: string[] = [];
    const store = new JsonlSessionStore({
      sessionDir: dir,
      debug: (m) => warnings.push(m),
    });
    seedSource(store, 's-recognize');
    const loaded = await store.load('s-recognize');
    expect(loaded).not.toBeNull();
    // tool_call is not a conversation message.
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'hello' }]);
    // It rides along on toolCallRecords instead.
    expect(loaded?.toolCallRecords).toHaveLength(1);
    expect(loaded?.toolCallRecords?.[0]?.tool_name).toBe('Read');
    // And no false "unrecognized line" warning was emitted for it.
    expect(warnings.filter((w) => w.includes('unrecognized'))).toEqual([]);
  });
});

describe('V3-1: query-resume fork copies tool_call telemetry and the title', () => {
  it('getSessionToolCalls(fork) is non-empty and the title survives', async () => {
    const sid = 's-fork-src';
    const store = new JsonlSessionStore({ sessionDir: dir, debug: noopDebug });
    seedSource(store, sid);

    const persistence = createSessionPersistence({
      store,
      persist: true,
      options: { resume: sid, forkSession: true },
      cwd: dir,
      sessionGitBranch: undefined,
      debug: noopDebug,
    });
    const resolved = await persistence.resolveSession();
    const forkId = resolved.sessionId;
    expect(forkId).not.toBe(sid);
    expect(resolved.resumed).toBe(true);

    // tool_call telemetry copied (fresh uuid, fork's session id).
    const forkCalls = await getSessionToolCalls(forkId, { sessionDir: dir });
    expect(forkCalls).toHaveLength(1);
    expect(forkCalls[0]?.tool_name).toBe('Read');
    expect(forkCalls[0]?.tool_use_id).toBe('toolu_1');
    expect((forkCalls[0] as unknown as { session_id?: string }).session_id).toBe(forkId);
    expect((forkCalls[0] as unknown as { uuid?: string }).uuid).not.toBe('tc-1');

    // Title (a meta_update field) re-emitted on the fork.
    const info = await getSessionInfo(forkId, { sessionDir: dir });
    expect(info?.customTitle).toBe('My Title');
    expect(info?.summary).toBe('My Title');
  });
});

// ---------------------------------------------------------------------------
// V3-3 / Sfs-3: file-checkpoint rewind
// ---------------------------------------------------------------------------

describe('V3-3: rewind windows from the turn_start marker seq', () => {
  it('includes a concurrent sibling instance\'s in-window record in the undo plan', async () => {
    const sid = 'cp-concurrent';
    // inst1 opens turn m1 (writes a turn_start marker at its seq).
    const inst1 = new FileCheckpointStore({ sessionDir: dir });
    inst1.bind(sid);
    inst1.beginTurn('m1');
    // A concurrent sibling instance records a change AFTER m1 started but
    // BEFORE m1's own first file-change — its seq lands between the marker and
    // m1's first change.
    const inst2 = new FileCheckpointStore({ sessionDir: dir });
    inst2.bind(sid);
    inst2.record(join(dir, 'sibling.txt'), 'SIBLING_PRE');
    // m1's first file-change now takes a seq ABOVE the marker.
    inst1.record(join(dir, 'target.txt'), 'TARGET_PRE');

    const rewinder = new FileCheckpointStore({ sessionDir: dir });
    rewinder.bind(sid);
    const res = await rewinder.rewind('m1', { dryRun: true });
    expect(res.canRewind).toBe(true);
    // The undo window starts at the marker, so BOTH the sibling's in-window
    // record and m1's own change are planned (before the fix only target.txt was).
    expect(res.restoredFiles).toContain(join(dir, 'target.txt'));
    expect(res.restoredFiles).toContain(join(dir, 'sibling.txt'));
  });
});

describe('Sfs-3: a partial rewind reports failure, not false success', () => {
  it('canRewind:false + error when a pre-image blob cannot be read', async () => {
    const sid = 'cp-partial';
    const cp = new FileCheckpointStore({ sessionDir: dir });
    cp.bind(sid);
    cp.beginTurn('m1');
    cp.record(join(dir, 'restore-me.txt'), 'PRE_IMAGE');
    // Wipe the blobs dir so the restore readFile fails.
    rmSync(join(dir, 'checkpoints', sid, 'blobs'), { recursive: true, force: true });

    const res = await cp.rewind('m1', {});
    expect(res.canRewind).toBe(false);
    expect(res.error).toContain('incomplete');
    // The unrestorable file is NOT reported as restored.
    expect(res.restoredFiles).toEqual([]);
    expect(res.deletedFiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rst-3 / Rst-4: deterministic sort tiebreak
// ---------------------------------------------------------------------------

function seedJsonlSession(id: string, prompt: string, mtime: Date): void {
  const file = join(dir, `${id}.jsonl`);
  appendFileSync(
    file,
    `${JSON.stringify({ type: 'meta', sessionId: id, createdAt: mtime.getTime(), firstPrompt: prompt })}\n`,
    'utf8',
  );
  utimesSync(file, mtime, mtime);
}

describe('Rst-3: JsonlSessionStore.list() breaks lastModified ties on session id', () => {
  it('same-mtime sessions come back in a deterministic (id-ascending) order', async () => {
    const same = new Date(1_600_000_000_000);
    // Seed in NON-alphabetical order; equal mtimes force the tiebreak.
    seedJsonlSession('sess-mike', 'm', same);
    seedJsonlSession('sess-alice', 'a', same);
    seedJsonlSession('sess-zoe', 'z', same);
    const infos = await listSessions({ dir });
    expect(infos.map((s) => s.sessionId)).toEqual([
      'sess-alice',
      'sess-mike',
      'sess-zoe',
    ]);
  });
});

describe('Rst-4: FileSessionStore.listSessions() breaks mtime ties on session id', () => {
  it('same-mtime sessions come back id-ascending', async () => {
    const store = new FileSessionStore(dir);
    const pk = 'proj';
    const ids = ['fs-charlie', 'fs-alpha', 'fs-bravo'];
    for (const id of ids) {
      await store.append({ projectKey: pk, sessionId: id }, [
        { type: 'user', uuid: `${id}-u`, message: { role: 'user', content: 'x' } } as never,
      ]);
    }
    // Force identical mtimes on every main.jsonl (ids/pk are all charset-safe,
    // so their encoded names equal the raw strings).
    const same = new Date(1_600_000_000_000);
    for (const id of ids) {
      utimesSync(join(dir, pk, id, 'main.jsonl'), same, same);
    }
    const listed = await store.listSessions(pk);
    expect(listed.map((s) => s.sessionId)).toEqual(['fs-alpha', 'fs-bravo', 'fs-charlie']);
  });
});

// ---------------------------------------------------------------------------
// R7s-4: surrogate-safe summary truncation
// ---------------------------------------------------------------------------

describe('R7s-4: listSessions summary truncation never splits a surrogate pair', () => {
  it('drops a straddling emoji rather than leaving a lone surrogate', async () => {
    // The emoji sits at UTF-16 indices 99/100, so a bare slice(0,100) would keep
    // its lone high surrogate.
    const prompt = `${'x'.repeat(99)}\u{1F600}${'y'.repeat(20)}`;
    seedJsonlSession('surr-1', prompt, new Date(1_600_000_000_000));
    const infos = await listSessions({ dir });
    const info = infos.find((s) => s.sessionId === 'surr-1');
    expect(info).toBeDefined();
    expect(LONE_SURROGATE.test(info!.summary)).toBe(false);
    expect(info!.summary).toBe(`${'x'.repeat(99)}...`);
  });
});
