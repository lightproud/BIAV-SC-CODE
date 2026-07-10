/**
 * SM-B.a: built-in file-backed external SessionStore (fileSessionStore).
 *
 * Covers the public SessionStore contract against real tmp directories:
 * append/load round-trip, crash-torn-tail tolerance (load AND the append
 * self-heal), path-traversal containment for attacker-controlled key
 * components, listSubkeys/listSessions/delete semantics mirrored from
 * InMemorySessionStore, auto-mkdir, and an end-to-end emulator smoke run
 * (options.sessionStore wired to a fileSessionStore; transcript lands on
 * disk and a fresh-host resume replays it).
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FileSessionStore,
  decodeKeyComponent,
  encodeKeyComponent,
  fileSessionStore,
} from '../src/sessions/file-store.js';
import { encodeProjectKey } from '../src/sessions/store-adapter.js';
import { query, type Options, type Query, type SDKMessage } from '../src/index.js';
import type { SessionKey, SessionStoreEntry } from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'bpt-filestore-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmp, { recursive: true, force: true });
});

const PK = 'proj-abc123def456';

const entry = (uuid: string, type = 'user'): SessionStoreEntry => ({
  type,
  uuid,
  message: { role: type, content: `msg-${uuid}` },
});

/** Recursively list every file under a directory (absolute paths). */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key-component encoding
// ---------------------------------------------------------------------------

describe('encodeKeyComponent / decodeKeyComponent', () => {
  it('round-trips arbitrary strings including separators and unicode', () => {
    for (const raw of [
      'plain-id_1.2',
      'subagents/x',
      '../../etc/cron.d',
      'a b%c\\d',
      '.',
      '..',
      '',
      '中文/键',
    ]) {
      expect(decodeKeyComponent(encodeKeyComponent(raw))).toBe(raw);
    }
  });

  it('never emits a path separator or a traversal name', () => {
    for (const raw of ['../x', '..\\x', '/abs/path', '..', '.', 'a/../b']) {
      const enc = encodeKeyComponent(raw);
      expect(enc).not.toMatch(/[/\\]/);
      expect(enc).not.toBe('.');
      expect(enc).not.toBe('..');
      expect(enc.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// (1) append -> load round-trip
// ---------------------------------------------------------------------------

describe('FileSessionStore append/load', () => {
  it('round-trips multiple records preserving order across appends', async () => {
    const s = fileSessionStore(tmp);
    const key: SessionKey = { projectKey: PK, sessionId: 'sess-1' };
    await s.append(key, [entry('1'), entry('2', 'assistant')]);
    await s.append(key, [entry('3')]);
    const loaded = await s.load(key);
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '2', '3']);
    expect(loaded?.[1]?.type).toBe('assistant');
    // Payload fields survive verbatim.
    expect(loaded?.[0]?.message).toEqual({ role: 'user', content: 'msg-1' });
  });

  it('returns null for a never-appended key', async () => {
    const s = fileSessionStore(tmp);
    expect(await s.load({ projectKey: PK, sessionId: 'missing' })).toBeNull();
  });

  it('keeps main transcript and subpath keys in separate files', async () => {
    const s = fileSessionStore(tmp);
    const main: SessionKey = { projectKey: PK, sessionId: 'a' };
    const sub: SessionKey = { projectKey: PK, sessionId: 'a', subpath: 'subagents/x' };
    await s.append(main, [entry('m1')]);
    await s.append(sub, [entry('s1')]);
    expect((await s.load(main))?.map((e) => e.uuid)).toEqual(['m1']);
    expect((await s.load(sub))?.map((e) => e.uuid)).toEqual(['s1']);
  });

  it('dedups by entry.uuid across appends (first occurrence wins)', async () => {
    const s = fileSessionStore(tmp);
    const key: SessionKey = { projectKey: PK, sessionId: 'dup' };
    await s.append(key, [entry('1')]);
    await s.append(key, [entry('1'), entry('2')]);
    const loaded = await s.load(key);
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '2']);
  });

  it('a second store instance over the same dir sees prior data (durability)', async () => {
    const key: SessionKey = { projectKey: PK, sessionId: 'persist' };
    await fileSessionStore(tmp).append(key, [entry('1')]);
    const reopened = fileSessionStore(tmp);
    expect((await reopened.load(key))?.map((e) => e.uuid)).toEqual(['1']);
  });
});

// ---------------------------------------------------------------------------
// (2) crash-torn tail tolerance
// ---------------------------------------------------------------------------

describe('FileSessionStore crash-tail tolerance', () => {
  const key: SessionKey = { projectKey: PK, sessionId: 'crashy' };
  const file = () =>
    join(tmp, encodeKeyComponent(PK), encodeKeyComponent('crashy'), 'main.jsonl');

  it('load survives a truncated final line and keeps every intact line', async () => {
    const s = fileSessionStore(tmp);
    await s.append(key, [entry('1'), entry('2')]);
    // Simulate a crash mid-append: a torn, unterminated JSON fragment.
    await appendFile(file(), '{"type":"user","uuid":"torn-3","mess');
    const loaded = await s.load(key);
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '2']);
  });

  it('load silently drops a corrupt middle line too', async () => {
    const s = fileSessionStore(tmp);
    await s.append(key, [entry('1')]);
    await appendFile(file(), 'not json at all\n');
    await s.append(key, [entry('2')]);
    const loaded = await s.load(key);
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '2']);
  });

  it('append after a crash heals the torn tail instead of gluing onto it', async () => {
    await fileSessionStore(tmp).append(key, [entry('1')]);
    await appendFile(file(), '{"type":"user","uuid":"torn-2"'); // no newline
    // Fresh instance = fresh process after the crash.
    const reopened = fileSessionStore(tmp);
    await reopened.append(key, [entry('3')]);
    const loaded = await reopened.load(key);
    // The torn line is lost (expected); the NEW entry must not be.
    expect(loaded?.map((e) => e.uuid)).toEqual(['1', '3']);
  });

  it('an empty (zero-byte) file loads as an empty list, not an error', async () => {
    const s = fileSessionStore(tmp);
    await s.append(key, [entry('1')]);
    await rm(file());
    await appendFile(file(), '');
    expect(await s.load(key)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (3) path safety: attacker-controlled key components stay inside the root
// ---------------------------------------------------------------------------

describe('FileSessionStore path containment', () => {
  it('a traversal sessionId/projectKey/subpath cannot escape the store root', async () => {
    const root = join(tmp, 'store-root');
    const s = fileSessionStore(root);
    const evil: SessionKey = {
      projectKey: '../pk-escape',
      sessionId: '../../session-escape',
      subpath: '../../../sub-escape',
    };
    await s.append(evil, [entry('1')]);
    // Round-trips through the same key.
    expect((await s.load(evil))?.map((e) => e.uuid)).toEqual(['1']);
    // Every file created lives under the store root; nothing leaked into tmp.
    const files = await walk(tmp);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.startsWith(root + '/')).toBe(true);
    }
    expect(existsSync(join(tmp, 'session-escape'))).toBe(false);
    expect(existsSync(join(tmp, 'sub-escape'))).toBe(false);
  });

  it('absolute-path and dot sessionIds are neutralized', async () => {
    const root = join(tmp, 'store-root');
    const s = fileSessionStore(root);
    for (const sessionId of ['/etc/passwd', '.', '..']) {
      const key: SessionKey = { projectKey: PK, sessionId };
      await s.append(key, [entry(`id-${sessionId}`)]);
      expect((await s.load(key))?.[0]?.uuid).toBe(`id-${sessionId}`);
    }
    const files = await walk(tmp);
    for (const f of files) expect(f.startsWith(root + '/')).toBe(true);
    expect(existsSync('/etc/passwd.jsonl')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (4) listSubkeys / listSessions / delete semantics
// ---------------------------------------------------------------------------

describe('FileSessionStore listSubkeys/listSessions/delete', () => {
  it('listSubkeys returns the ORIGINAL subpath strings, excluding main', async () => {
    const s = fileSessionStore(tmp);
    await s.append({ projectKey: PK, sessionId: 'a' }, [entry('m')]);
    await s.append({ projectKey: PK, sessionId: 'a', subpath: 'subagents/x' }, [entry('s1')]);
    await s.append({ projectKey: PK, sessionId: 'a', subpath: 'checkpoints' }, [entry('s2')]);
    const subs = await s.listSubkeys({ projectKey: PK, sessionId: 'a' });
    expect(subs.sort()).toEqual(['checkpoints', 'subagents/x']);
  });

  it('listSubkeys of an unknown session is empty', async () => {
    const s = fileSessionStore(tmp);
    expect(await s.listSubkeys({ projectKey: PK, sessionId: 'nope' })).toEqual([]);
  });

  it('listSessions returns main-transcript sessions newest first', async () => {
    const s = fileSessionStore(tmp);
    await s.append({ projectKey: PK, sessionId: 'older' }, [entry('a')]);
    await new Promise((r) => setTimeout(r, 10));
    await s.append({ projectKey: PK, sessionId: 'newer' }, [entry('b')]);
    // A subkey-only session must NOT be listed.
    await s.append({ projectKey: PK, sessionId: 'subonly', subpath: 'sub/x' }, [entry('c')]);
    const list = await s.listSessions(PK);
    expect(list.map((e) => e.sessionId)).toEqual(['newer', 'older']);
    expect(list[0]?.mtime).toBeGreaterThanOrEqual(list[1]?.mtime ?? Infinity);
  });

  it('listSessions of an unknown project is empty', async () => {
    const s = fileSessionStore(tmp);
    expect(await s.listSessions('never-seen')).toEqual([]);
  });

  it('delete of the main key cascades to subkeys; subkey delete is scoped', async () => {
    const s = fileSessionStore(tmp);
    const main: SessionKey = { projectKey: PK, sessionId: 'a' };
    const sub: SessionKey = { projectKey: PK, sessionId: 'a', subpath: 'sub/x' };
    await s.append(main, [entry('1')]);
    await s.append(sub, [entry('2')]);
    await s.delete(sub);
    expect(await s.load(sub)).toBeNull();
    expect(await s.load(main)).not.toBeNull();
    await s.append(sub, [entry('3')]);
    await s.delete(main);
    expect(await s.load(main)).toBeNull();
    expect(await s.load(sub)).toBeNull();
    expect(await s.listSubkeys({ projectKey: PK, sessionId: 'a' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (5) directory auto-creation
// ---------------------------------------------------------------------------

describe('FileSessionStore directory bootstrap', () => {
  it('creates a deeply nested, not-yet-existing store dir on first append', async () => {
    const deep = join(tmp, 'not', 'yet', 'created');
    expect(existsSync(deep)).toBe(false);
    const s = fileSessionStore(deep);
    await s.append({ projectKey: PK, sessionId: 's' }, [entry('1')]);
    expect(existsSync(deep)).toBe(true);
    expect((await s.load({ projectKey: PK, sessionId: 's' }))?.map((e) => e.uuid)).toEqual(['1']);
  });

  it('exports both the factory and the class, and they are the same store', () => {
    const viaFactory = fileSessionStore(tmp);
    expect(viaFactory).toBeInstanceOf(FileSessionStore);
  });
});

// ---------------------------------------------------------------------------
// (6) integration smoke: options.sessionStore + emulator query + resume
// ---------------------------------------------------------------------------

describe('fileSessionStore end-to-end (options.sessionStore)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(tmp, 'project');
  });

  function baseOptions(extra: Partial<Options> = {}): Options {
    return {
      provider: { apiKey: 'test-key', promptCaching: false },
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      model: 'claude-sonnet-4-5',
      ...extra,
    };
  }

  function stub(scripts: ReadonlyArray<readonly object[]>): SSEFetchStub {
    const s = makeSSEFetch(scripts);
    vi.stubGlobal('fetch', s);
    return s;
  }

  async function drain(q: Query): Promise<SDKMessage[]> {
    const out: SDKMessage[] = [];
    for await (const m of q) out.push(m);
    return out;
  }

  it('persists the transcript to disk and resumes it on a fresh host', async () => {
    const storeDir = join(tmp, 'external-store');
    const projectKey = encodeProjectKey(cwd);

    // -- Turn 1: run a query mirroring into the file store. ------------------
    stub([textReplyEvents('reply-one')]);
    const msgs = await drain(
      query({
        prompt: 'remember-marker-alpha',
        options: baseOptions({
          sessionDir: join(tmp, 'host-a-sessions'),
          sessionStore: fileSessionStore(storeDir),
          sessionStoreFlush: 'eager',
        }),
      }),
    );
    const result = msgs.find((m) => m.type === 'result');
    expect(result).toBeDefined();
    const sessionId = (result as { session_id: string }).session_id;

    // Transcript landed on disk and reads back through a fresh store handle.
    const persisted = await fileSessionStore(storeDir).load({ projectKey, sessionId });
    expect(persisted).not.toBeNull();
    const types = (persisted ?? []).map((e) => e.type);
    expect(types).toContain('user');
    expect(types).toContain('assistant');
    expect(JSON.stringify(persisted)).toContain('remember-marker-alpha');

    // -- Turn 2: resume on a DIFFERENT host (fresh local sessionDir). --------
    const f2 = stub([textReplyEvents('reply-two')]);
    await drain(
      query({
        prompt: 'second-turn',
        options: baseOptions({
          sessionDir: join(tmp, 'host-b-sessions'),
          sessionStore: fileSessionStore(storeDir),
          resume: sessionId,
        }),
      }),
    );
    // The resumed request must replay the first conversation from the file
    // store (host B has no local transcript).
    const body = f2.requests[0]?.body;
    expect(body).toBeDefined();
    const wire = JSON.stringify(body?.messages ?? []);
    expect(wire).toContain('remember-marker-alpha');
    expect(wire).toContain('reply-one');
    expect(wire).toContain('second-turn');
  });
});
