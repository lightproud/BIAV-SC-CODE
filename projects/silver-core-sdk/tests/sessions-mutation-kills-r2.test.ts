/**
 * Mutation-kill tests: sessions module, batch 2 (keeper "1 继续推进 sessions").
 * Attacks the two remaining weak files from the batch-1 report:
 *  - checkpoints.ts (60.84%): FileCheckpointStore record/rewind/seq —
 *    first-touch-per-turn wins, seq monotonicity + reconstruction across
 *    rebind, rewind first-wins plan (modified->restore, created->delete),
 *    dryRun purity, unknown-checkpoint soft-fail vs unbound throw, unsafe-id
 *    refusal.
 *  - file-store.ts (67.73%): encodeKeyComponent/decodeKeyComponent byte
 *    round-trip incl. the UPPERCASE-hex + empty-marker + dot escapes, tilde
 *    expansion, and the torn-tail (endsWithoutNewline) heal on first append.
 *
 * Overfitting guard (not killed): debug strings, ENOENT-detail plumbing,
 * mkdir recursive flags whose effect JSON-round-trips identically.
 */
// @ts-nocheck


import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCheckpointStore, makeCheckpointRecorder } from '../src/sessions/checkpoints.js';
import {
  FileSessionStore,
  encodeKeyComponent,
  decodeKeyComponent,
} from '../src/sessions/file-store.js';
import { ConfigurationError } from '../src/errors.js';
import type { SessionKey, SessionStoreEntry } from '../src/types.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-kills2-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// checkpoints.ts
// ---------------------------------------------------------------------------

function makeCp(): FileCheckpointStore {
  return new FileCheckpointStore({ sessionDir: dir });
}

describe('FileCheckpointStore: record semantics', () => {
  it('first touch of a path per turn wins; repeats are ignored (earliest pre-image restored)', async () => {
    const cp = makeCp();
    cp.bind('sess-1');
    cp.beginTurn('turn-A');
    const target = join(dir, 'work', 'f.txt');
    await mkdir(join(dir, 'work'), { recursive: true });
    await writeFile(target, 'ORIGINAL', 'utf8');

    cp.record(target, 'ORIGINAL'); // first pre-image
    cp.record(target, 'LATER'); // ignored (same turn, same path)
    await writeFile(target, 'MUTATED', 'utf8');

    const res = await cp.rewind('turn-A');
    expect(res.canRewind).toBe(true);
    expect(res.restoredFiles).toEqual([target]);
    expect(await readFile(target, 'utf8')).toBe('ORIGINAL'); // not LATER
  });

  it('a created file (null pre-image) is DELETED on rewind; a modified file is RESTORED', async () => {
    const cp = makeCp();
    cp.bind('sess-2');
    cp.beginTurn('turn-B');
    const modified = join(dir, 'mod.txt');
    const created = join(dir, 'new.txt');
    await writeFile(modified, 'OLD', 'utf8');
    cp.record(modified, 'OLD');
    cp.record(created, null); // created this turn
    await writeFile(modified, 'NEW', 'utf8');
    await writeFile(created, 'CREATED', 'utf8');

    const res = await cp.rewind('turn-B');
    expect(res.restoredFiles).toEqual([modified]);
    expect(res.deletedFiles).toEqual([created]);
    expect(await readFile(modified, 'utf8')).toBe('OLD');
    expect(existsSync(created)).toBe(false);
  });

  it('dryRun computes the plan WITHOUT touching disk', async () => {
    const cp = makeCp();
    cp.bind('sess-3');
    cp.beginTurn('turn-C');
    const f = join(dir, 'd.txt');
    await writeFile(f, 'A', 'utf8');
    cp.record(f, 'A');
    await writeFile(f, 'B', 'utf8');

    const res = await cp.rewind('turn-C', { dryRun: true });
    expect(res.canRewind).toBe(true);
    expect(res.restoredFiles).toEqual([f]);
    expect(res.dryRun).toBe(true);
    expect(await readFile(f, 'utf8')).toBe('B'); // untouched
  });

  it('an unknown checkpoint soft-fails (canRewind:false); an UNBOUND store throws', async () => {
    const cp = makeCp();
    cp.bind('sess-4');
    cp.beginTurn('turn-D');
    const res = await cp.rewind('no-such-turn');
    expect(res.canRewind).toBe(false);
    expect(res.error).toContain('No file checkpoint found');
    expect(res.restoredFiles).toEqual([]);

    const unbound = makeCp(); // never bound
    await expect(unbound.rewind('x')).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('an unsafe session id refuses to bind (record becomes a no-op, rewind throws)', async () => {
    const cp = makeCp();
    cp.bind('../evil');
    // Not bound -> record is a silent no-op, no dir created.
    cp.beginTurn('t');
    cp.record(join(dir, 'x.txt'), 'p');
    expect(existsSync(join(dir, 'checkpoints', '..', 'evil'))).toBe(false);
    await expect(cp.rewind('t')).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('seq is monotonic within a bind and RECONSTRUCTS across a fresh bind (max+1)', async () => {
    const cp = makeCp();
    cp.bind('sess-seq');
    cp.beginTurn('t1');
    cp.record(join(dir, 'a'), 'a');
    cp.record(join(dir, 'b'), 'b'); // distinct paths -> two records
    const idxPath = join(dir, 'checkpoints', 'sess-seq', 'index.jsonl');
    // Finding L4 — beginTurn writes a turn_start MARKER line (no absPath) for
    // positioning; it does not consume a seq. Filter to real file-change
    // records (those with an absPath) to assert the record seq space.
    const recordSeqs = (): number[] =>
      readFileSync(idxPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { seq: number; absPath?: string })
        .filter((o) => typeof o.absPath === 'string')
        .map((o) => o.seq);
    expect(recordSeqs()).toEqual([0, 1]);

    // Fresh store instance rebinding the SAME session must continue at max+1.
    const cp2 = makeCp();
    cp2.bind('sess-seq');
    cp2.beginTurn('t2');
    cp2.record(join(dir, 'c'), 'c');
    expect(recordSeqs()).toEqual([0, 1, 2]); // reconstructed to 2, not reset to 0
  });

  it('makeCheckpointRecorder forwards to store.record', async () => {
    const cp = makeCp();
    cp.bind('sess-rec');
    cp.beginTurn('t');
    const rec = makeCheckpointRecorder(cp);
    const f = join(dir, 'r.txt');
    await writeFile(f, 'ORIG', 'utf8');
    rec(f, 'ORIG');
    await writeFile(f, 'CHG', 'utf8');
    const res = await cp.rewind('t');
    expect(res.restoredFiles).toEqual([f]);
  });
});

// ---------------------------------------------------------------------------
// file-store.ts
// ---------------------------------------------------------------------------

describe('encodeKeyComponent: byte-precise escaping', () => {
  it('safe bytes pass through; non-safe bytes become UPPERCASE %XX', () => {
    expect(encodeKeyComponent('Aa0._-')).toBe('Aa0._-'); // all safe
    // space (0x20) -> %20; '/' (0x2F) -> %2F; UPPERCASE hex is load-bearing
    expect(encodeKeyComponent('a b')).toBe('a%20b');
    expect(encodeKeyComponent('a/b')).toBe('a%2Fb');
    // a byte whose hex has a letter: 0xC3 0xA9 = é -> uppercase, zero-padded
    expect(encodeKeyComponent('é')).toBe('%C3%A9');
  });

  it('the empty string maps to the bare "%" marker, distinct from a literal "%"', () => {
    expect(encodeKeyComponent('')).toBe('%');
    expect(encodeKeyComponent('%')).toBe('%25'); // literal % never collides with the empty marker
    expect(decodeKeyComponent('%')).toBe('');
    expect(decodeKeyComponent('%25')).toBe('%');
  });

  it('"." and ".." escape to reserved forms (never a real dot filename)', () => {
    expect(encodeKeyComponent('.')).toBe('%2E');
    expect(encodeKeyComponent('..')).toBe('%2E%2E');
    expect(decodeKeyComponent('%2E')).toBe('.');
    expect(decodeKeyComponent('%2E%2E')).toBe('..');
  });

  it('round-trips arbitrary content and never yields a separator or traversal name', () => {
    for (const raw of ['../../etc', 'a b%c\\d', '中文/键', 'plain_1.2', '', '.', '..']) {
      const enc = encodeKeyComponent(raw);
      expect(decodeKeyComponent(enc)).toBe(raw);
      expect(enc).not.toMatch(/[/\\]/);
      expect(enc).not.toBe('.');
      expect(enc).not.toBe('..');
    }
  });

  it('decode leaves a lone "%" without two hex digits as a literal char (no crash)', () => {
    // trailing '%' with no hex, and '%zz' non-hex both pass through literally
    expect(decodeKeyComponent('ab%')).toBe('ab%');
    expect(decodeKeyComponent('a%zzb')).toBe('a%zzb');
  });
});

describe('FileSessionStore: torn-tail heal + layout', () => {
  const PK = 'projX';
  const key = (sessionId: string, subpath = ''): SessionKey => ({ projectKey: PK, sessionId, subpath });
  const entry = (uuid: string): SessionStoreEntry =>
    ({ type: 'user', uuid, message: { role: 'user', content: 'hi' } }) as SessionStoreEntry;

  it('the FIRST append heals a crash-torn tail (no trailing newline) by prefixing one', async () => {
    const store = new FileSessionStore(dir);
    // Plant a torn main.jsonl (a record with NO trailing newline).
    const base = join(dir, encodeKeyComponent(PK), encodeKeyComponent('s-torn'));
    await mkdir(base, { recursive: true });
    const main = join(base, 'main.jsonl');
    await writeFile(main, JSON.stringify({ type: 'user', uuid: 'pre', message: { role: 'user', content: 'x' } }), 'utf8');

    await store.append(key('s-torn'), [entry('post')]);
    const text = await readFile(main, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    // Two well-formed lines: the healed pre-existing one + the new one.
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    const loaded = await store.load(key('s-torn'));
    expect(loaded).toHaveLength(2);
  });

  it('a clean newline-terminated tail is NOT double-prefixed on append', async () => {
    const store = new FileSessionStore(dir);
    await store.append(key('s-clean'), [entry('a')]);
    await store.append(key('s-clean'), [entry('b')]);
    const base = join(dir, encodeKeyComponent(PK), encodeKeyComponent('s-clean'));
    const text = await readFile(join(base, 'main.jsonl'), 'utf8');
    expect(text).not.toContain('\n\n'); // no blank line injected
    expect((await store.load(key('s-clean')))).toHaveLength(2);
  });

  it('subpath entries land under sub/ with an encoded filename; main stays at main.jsonl', async () => {
    const store = new FileSessionStore(dir);
    await store.append(key('s'), [entry('m')]);
    await store.append(key('s', 'agent/child'), [entry('c')]);
    const base = join(dir, encodeKeyComponent(PK), encodeKeyComponent('s'));
    expect(existsSync(join(base, 'main.jsonl'))).toBe(true);
    expect(existsSync(join(base, 'sub', `${encodeKeyComponent('agent/child')}.jsonl`))).toBe(true);
    expect(await store.load(key('s', 'agent/child'))).toHaveLength(1);
  });

  it('load of a never-written key returns null (ENOENT swallowed, not thrown)', async () => {
    const store = new FileSessionStore(dir);
    expect(await store.load(key('ghost'))).toBeNull();
  });
});

// NOTE: a tilde-expansion test was deliberately REMOVED (2026-07-13). Driving
// expandTilde('~/…') through a real FileSessionStore.append writes to disk, so
// a mutation run that disables the tilde branch creates a LITERAL `~/` dir in
// the repo (and the passing path writes under the real homedir) — the same
// side-effecting pollution class as the /tmp/evil.jsonl traversal case. The
// expandTilde branch's low kill value does not justify a filesystem-side-effect
// test; it is left as an accepted survivor per the overfitting/side-effect
// guard (100%-question analysis).
