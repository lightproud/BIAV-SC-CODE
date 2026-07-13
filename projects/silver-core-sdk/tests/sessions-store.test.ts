/**
 * Module G store-level tests: JsonlSessionStore path-traversal hardening
 * (findings #10/#40) and load()'s tool_use/tool_result pairing repair
 * (finding #37).
 */
// @ts-nocheck


import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  JsonlSessionStore,
  isSafeSessionId,
  listSessions,
  getSessionInfo,
} from '../src/sessions/store.js';
import { renameSession, tagSession } from '../src/sessions/session-functions.js';
import type { APIMessageParam } from '../src/types.js';

let dir: string;
let dirRoot: string;

beforeEach(async () => {
  // `dir` is a NESTED subdir of the mkdtemp root, so the path-traversal
  // test's `../evil.jsonl` escape target lands back INSIDE the isolated root
  // (removed by afterEach), not in the shared system tmpdir. Without the
  // nesting, a mutation run that disables the traversal guard writes
  // /tmp/evil.jsonl and poisons every later run and parallel worker — a real
  // pollution source that hit 2026-07-13. All `join(dir, …)` assertions are
  // unchanged: `dir` is still the store's sessionDir.
  dirRoot = await mkdtemp(join(tmpdir(), 'bpt-store-'));
  dir = join(dirRoot, 'nest');
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  // Remove the whole isolated root, so any guard-escape file the traversal
  // test provoked (dir/../evil.jsonl == dirRoot/evil.jsonl) goes with it.
  await rm(dirRoot, { recursive: true, force: true });
});

function makeStore(): { store: JsonlSessionStore; warnings: string[] } {
  const warnings: string[] = [];
  const store = new JsonlSessionStore({
    sessionDir: dir,
    debug: (m) => warnings.push(m),
  });
  return { store, warnings };
}

describe('isSafeSessionId', () => {
  it('accepts UUID / alnum-dash-dot-underscore ids', () => {
    expect(isSafeSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isSafeSessionId('nightly_report.2026-07-03')).toBe(true);
    expect(isSafeSessionId('abc123')).toBe(true);
  });

  it('rejects traversal and separator ids (fail closed)', () => {
    expect(isSafeSessionId('../evil')).toBe(false);
    expect(isSafeSessionId('../../../../tmp/evil')).toBe(false);
    expect(isSafeSessionId('..')).toBe(false);
    expect(isSafeSessionId('.')).toBe(false);
    expect(isSafeSessionId('a/b')).toBe(false);
    expect(isSafeSessionId('a\\b')).toBe(false);
    expect(isSafeSessionId('/abs/path')).toBe(false);
    expect(isSafeSessionId('foo..bar')).toBe(false);
    expect(isSafeSessionId('')).toBe(false);
  });
});

describe('JsonlSessionStore path traversal (findings #10/#40)', () => {
  it('refuses to WRITE outside the sessions dir for a traversal id', () => {
    const { store, warnings } = makeStore();
    // Would resolve to <parent-of-dir>/evil.jsonl without the guard.
    store.append('../evil', { type: 'user', message: { role: 'user', content: 'x' } });

    const escaped = join(dir, '..', 'evil.jsonl');
    expect(existsSync(escaped)).toBe(false);
    expect(warnings.some((w) => w.includes('refusing append'))).toBe(true);
  });

  it('refuses to READ outside the sessions dir for a traversal id', async () => {
    // Plant a real transcript one level above the sessions dir.
    const outside = join(dir, '..', 'secret.jsonl');
    appendFileSync(
      outside,
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'secret' } })}\n`,
      'utf8',
    );
    try {
      const { store, warnings } = makeStore();
      const loaded = await store.load('../secret');
      expect(loaded).toBeNull();
      expect(warnings.some((w) => w.includes('refusing load'))).toBe(true);
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('still round-trips a safe id normally', async () => {
    const { store } = makeStore();
    store.append('good-id', { type: 'meta', sessionId: 'good-id', createdAt: 1, cwd: '/w' });
    store.append('good-id', {
      type: 'user',
      message: { role: 'user', content: 'hello' },
    });
    const loaded = await store.load('good-id');
    expect(loaded).not.toBeNull();
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });
});

describe('JsonlSessionStore pairing repair (finding #37)', () => {
  function writeLines(sessionId: string, lines: unknown[]): void {
    const file = join(dir, `${sessionId}.jsonl`);
    for (const l of lines) {
      appendFileSync(file, `${JSON.stringify(l)}\n`, 'utf8');
    }
  }

  it('drops an orphan tool_result whose tool_use line was lost', async () => {
    // assistant(tool_use) line eaten; only the user(tool_result) survived.
    writeLines('s1', [
      { type: 'meta', sessionId: 's1', createdAt: 1 },
      { type: 'user', message: { role: 'user', content: 'do it' } },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_missing', content: 'ok' },
          ],
        },
      },
    ]);
    const { store, warnings } = makeStore();
    const loaded = await store.load('s1');
    expect(loaded).not.toBeNull();
    // Orphan tool_result emptied its user message and was dropped entirely.
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'do it' }]);
    expect(warnings.some((w) => w.includes('orphan tool_result'))).toBe(true);
  });

  it('keeps a tool_result that matches the preceding assistant tool_use', async () => {
    writeLines('s2', [
      { type: 'meta', sessionId: 's2', createdAt: 1 },
      { type: 'user', message: { role: 'user', content: 'do it' } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
        },
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      },
    ]);
    const { store } = makeStore();
    const loaded = await store.load('s2');
    const msgs = loaded?.messages as APIMessageParam[];
    expect(msgs).toHaveLength(4);
    // The matched tool_result survives intact.
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
    });
  });

  it('drops a trailing assistant tool_use with no following tool_result', async () => {
    writeLines('s3', [
      { type: 'meta', sessionId: 's3', createdAt: 1 },
      { type: 'user', message: { role: 'user', content: 'do it' } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_9', name: 'Bash', input: {} }],
        },
      },
    ]);
    const { store, warnings } = makeStore();
    const loaded = await store.load('s3');
    // Trailing orphan tool_use dropped -> history ends on the user turn.
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'do it' }]);
    expect(
      warnings.some((w) => w.includes('dropped assistant tool_use turn')),
    ).toBe(true);
  });

  it('drops a MID-transcript dangling assistant tool_use (E5 budget pre-stop + next input; adversarial review 2026-07-05)', async () => {
    // The E5 budget pre-stop persists assistant(tool_use) with no
    // tool_result; a subsequent user turn pushes it into the transcript
    // MIDDLE, where the old trailing-only repair could not reach it, leaving
    // a resumed session to 400 on every request. The two-pass repair drops
    // the unanswered assistant turn wherever it sits.
    writeLines('s3b', [
      { type: 'meta', sessionId: 's3b', createdAt: 1 },
      { type: 'user', message: { role: 'user', content: 'first' } },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_mid', name: 'Bash', input: {} }],
        },
      },
      { type: 'user', message: { role: 'user', content: 'second' } },
    ]);
    const { store, warnings } = makeStore();
    const loaded = await store.load('s3b');
    const msgs = loaded?.messages as APIMessageParam[];
    // The dangling tool_use is gone; NO surviving assistant tool_use lacks a
    // following tool_result (the resume request would be API-valid).
    const hasDangling = msgs.some(
      (m, i) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => (b as { type?: string }).type === 'tool_use') &&
        !(
          msgs[i + 1]?.role === 'user' &&
          Array.isArray(msgs[i + 1]?.content) &&
          (msgs[i + 1]!.content as unknown[]).some(
            (b) => (b as { type?: string }).type === 'tool_result',
          )
        ),
    );
    expect(hasDangling).toBe(false);
    expect(
      warnings.some((w) => w.includes('dropped assistant tool_use turn')),
    ).toBe(true);
    // C8/S4 (BPT audit 2026-07-07): dropping the middle assistant turn left
    // [user, user] — pass 3 must merge them so roles alternate (else resume
    // 400s "roles must alternate").
    const consecutiveSameRole = msgs.some((m, i) => i > 0 && msgs[i - 1]!.role === m.role);
    expect(consecutiveSameRole).toBe(false);
    expect(warnings.some((w) => w.includes('merged consecutive'))).toBe(true);
  });

  it('produces a paired, API-valid history that partial results survive on', async () => {
    // Mixed content user message: keep the text, drop only the orphan block.
    writeLines('s4', [
      { type: 'meta', sessionId: 's4', createdAt: 1 },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'still here' },
            { type: 'tool_result', tool_use_id: 'orphan', content: 'x' },
          ],
        },
      },
    ]);
    const { store } = makeStore();
    const loaded = await store.load('s4');
    expect(loaded?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'still here' }] },
    ]);
    // Sanity: no tool_result block remains without a preceding tool_use.
    const file = readFileSync(join(dir, 's4.jsonl'), 'utf8');
    expect(file).toContain('orphan'); // raw transcript untouched
  });
});

describe('listSessions option shape (task #17)', () => {
  function seed(sessionId: string, createdAt: number, prompt: string): void {
    const file = join(dir, `${sessionId}.jsonl`);
    appendFileSync(
      file,
      `${JSON.stringify({ type: 'meta', sessionId, createdAt })}\n` +
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`,
      'utf8',
    );
  }

  it('honors the `dir` alias for `sessionDir`', async () => {
    seed('a1', 1, 'hello');
    const viaDir = await listSessions({ dir });
    expect(viaDir.map((s) => s.sessionId)).toContain('a1');
    // getSessionInfo honors the alias too.
    const info = await getSessionInfo('a1', { dir });
    expect(info?.sessionId).toBe('a1');
  });

  it('sessionDir takes precedence over `dir` when both are given', async () => {
    seed('b1', 1, 'in real dir');
    const list = await listSessions({ sessionDir: dir, dir: '/nonexistent/path' });
    expect(list.map((s) => s.sessionId)).toContain('b1');
  });

  it('caps results with `limit` (newest first)', async () => {
    seed('old', 1, 'oldest');
    seed('mid', 2, 'middle');
    seed('new', 3, 'newest');
    const all = await listSessions({ dir });
    expect(all.length).toBe(3);
    const limited = await listSessions({ dir, limit: 2 });
    expect(limited).toHaveLength(2);
    // The two returned are a prefix of the full newest-first ordering.
    expect(limited.map((s) => s.sessionId)).toEqual(all.slice(0, 2).map((s) => s.sessionId));
  });
});

describe('rename/tag round trip via meta_update (T1-6)', () => {
  const SID = 'rt-1';

  function seed(): void {
    const file = join(dir, `${SID}.jsonl`);
    appendFileSync(
      file,
      `${JSON.stringify({ type: 'meta', sessionId: SID, createdAt: 1, cwd: '/w', firstPrompt: 'first prompt line' })}\n` +
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'first prompt line' } })}\n`,
      'utf8',
    );
  }

  it('renameSession writes meta_update and store.load reads customTitle back', async () => {
    seed();
    await renameSession(SID, 'My renamed session', { sessionDir: dir });

    const { store, warnings } = makeStore();
    const loaded = await store.load(SID);
    expect(loaded?.customTitle).toBe('My renamed session');
    // meta_update lines are consumed, not skipped as unrecognized.
    expect(warnings.filter((w) => w.includes('unrecognized'))).toEqual([]);
    // Transcript messages survive untouched.
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'first prompt line' }]);
  });

  it('tagSession writes meta_update and store.load reads the tag back', async () => {
    seed();
    await tagSession(SID, 'experiment', { sessionDir: dir });
    const { store } = makeStore();
    const loaded = await store.load(SID);
    expect(loaded?.tag).toBe('experiment');
  });

  it('last write wins for repeated rename/tag; tag null clears', async () => {
    seed();
    await renameSession(SID, 'title one', { sessionDir: dir });
    await renameSession(SID, 'title two', { sessionDir: dir });
    await tagSession(SID, 'tag-a', { sessionDir: dir });
    await tagSession(SID, 'tag-b', { sessionDir: dir });

    const { store } = makeStore();
    let loaded = await store.load(SID);
    expect(loaded?.customTitle).toBe('title two');
    expect(loaded?.tag).toBe('tag-b');

    await tagSession(SID, null, { sessionDir: dir });
    loaded = await store.load(SID);
    expect(loaded?.tag).toBeUndefined();
    expect(loaded?.customTitle).toBe('title two');
  });

  it('getSessionInfo surfaces customTitle/tag and prefers customTitle for summary', async () => {
    seed();
    await renameSession(SID, 'Curated title', { sessionDir: dir });
    await tagSession(SID, 'nightly', { sessionDir: dir });

    const info = await getSessionInfo(SID, { sessionDir: dir });
    expect(info?.customTitle).toBe('Curated title');
    expect(info?.tag).toBe('nightly');
    expect(info?.summary).toBe('Curated title');
    expect(info?.firstPrompt).toBe('first prompt line');
  });

  it('summary falls back to the first prompt line when no customTitle is set', async () => {
    seed();
    const info = await getSessionInfo(SID, { sessionDir: dir });
    expect(info?.customTitle).toBeUndefined();
    expect(info?.summary).toBe('first prompt line');
  });

  it('a meta_update gitBranch is honored by BOTH load() and getSessionInfo()', async () => {
    // Seed with an initial branch, then append a meta_update switching it.
    const file = join(dir, `${SID}.jsonl`);
    appendFileSync(
      file,
      `${JSON.stringify({ type: 'meta', sessionId: SID, createdAt: 1, cwd: '/w', firstPrompt: 'p', gitBranch: 'main' })}\n` +
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'p' } })}\n` +
        `${JSON.stringify({ type: 'meta_update', uuid: 'mu-1', gitBranch: 'release' })}\n`,
      'utf8',
    );
    const { store } = makeStore();
    const loaded = await store.load(SID);
    const info = await getSessionInfo(SID, { sessionDir: dir });
    // Both read paths must agree — loadInfo() previously ignored the update and
    // reported the stale 'main' while load() reported 'release'.
    expect(loaded?.gitBranch).toBe('release');
    expect(info?.gitBranch).toBe('release');
  });

  it('listSessions carries customTitle/tag through', async () => {
    seed();
    await renameSession(SID, 'Listed title', { sessionDir: dir });
    await tagSession(SID, 'listed', { sessionDir: dir });

    const list = await listSessions({ sessionDir: dir });
    const entry = list.find((s) => s.sessionId === SID);
    expect(entry?.customTitle).toBe('Listed title');
    expect(entry?.tag).toBe('listed');
    expect(entry?.summary).toBe('Listed title');
  });

  it('gitBranch is read back from meta and meta_update records', async () => {
    const file = join(dir, `${SID}.jsonl`);
    appendFileSync(
      file,
      `${JSON.stringify({ type: 'meta', sessionId: SID, createdAt: 1, gitBranch: 'main' })}\n`,
      'utf8',
    );
    const { store } = makeStore();
    let loaded = await store.load(SID);
    expect(loaded?.gitBranch).toBe('main');

    appendFileSync(
      file,
      `${JSON.stringify({ type: 'meta_update', uuid: 'u1', gitBranch: 'feature/x' })}\n`,
      'utf8',
    );
    loaded = await store.load(SID);
    expect(loaded?.gitBranch).toBe('feature/x');
    const info = await getSessionInfo(SID, { sessionDir: dir });
    expect(info?.gitBranch).toBe('feature/x');
  });
});
