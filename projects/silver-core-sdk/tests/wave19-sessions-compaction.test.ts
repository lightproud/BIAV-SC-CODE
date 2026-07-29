/**
 * Wave-19 audit regressions: context compaction + session persistence.
 *
 * ① store.ts loadInfo/isSidechainFile probes assumed `type` is the FIRST
 *    serialized key. It is for OUR writers, but NOT for a transcript
 *    materialized from an embedder's external SessionStore that normalizes key
 *    order (Postgres `jsonb` sorts keys by length then bytewise), nor for a
 *    hand-edited file — both of which the L54 comment already names as in
 *    scope. Result: list()/listSessions()/getSessionInfo() disagreed with
 *    load() about a session's meta, and a subagent SIDECHAIN transcript was no
 *    longer hidden from `continue: true`.
 * ② compaction.ts: a NaN `contextWindowTokens` slipped past the
 *    degenerate-window guard (`NaN <= maxOutputTokens` is false) and turned
 *    every later threshold comparison false — auto-compaction silently off,
 *    with no warning.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  JsonlSessionStore,
  getSessionInfo,
  listSessions,
} from '../src/sessions/store.js';
import { buildCompactionConfig, maybeAutoCompact } from '../src/engine/compaction.js';
import { MockTransport } from './helpers/mock-transport.js';
import type {
  CompactionConfig,
  EngineConfig,
  EngineDeps,
  HookRunner,
} from '../src/internal/contracts.js';
import type { APIMessageParam, SDKMessage } from '../src/types.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'scs-wave19-'));
}

/** Serialize a record with its keys in jsonb order (length, then bytewise) —
 *  i.e. exactly what a Postgres-backed external SessionStore hands back. */
function jsonbOrder(rec: Record<string, unknown>): string {
  const keys = Object.keys(rec).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = rec[k];
  return JSON.stringify(out);
}

describe('wave19 ①: session meta survives a key-reordered transcript', () => {
  it('loadInfo / listSessions / getSessionInfo agree with load() when `type` is not the first key', async () => {
    const dir = freshDir();
    const store = new JsonlSessionStore({ sessionDir: dir });
    const metaLine = jsonbOrder({
      type: 'meta',
      sessionId: 's1',
      createdAt: 111,
      cwd: '/w',
      firstPrompt: 'hello world',
    });
    // Guard the guard: this fixture is only meaningful while `type` is NOT first.
    expect(metaLine.startsWith('{"type"')).toBe(false);
    writeFileSync(
      join(dir, 's1.jsonl'),
      [
        metaLine,
        JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } }),
        jsonbOrder({ type: 'meta_update', uuid: 'u2', customTitle: 'My Title' }),
      ].join('\n') + '\n',
    );

    const loaded = await store.load('s1');
    const info = await store.loadInfo('s1');
    expect(loaded).not.toBeNull();
    expect(info).not.toBeNull();
    // The two read paths must report the SAME meta.
    expect(info!.createdAt).toBe(loaded!.createdAt);
    expect(info!.firstPrompt).toBe(loaded!.firstPrompt);
    expect(info!.cwd).toBe(loaded!.cwd);
    expect(info!.customTitle).toBe(loaded!.customTitle);
    // ...and the values are the real ones, not mtime/undefined fallbacks.
    expect(info!.createdAt).toBe(111);
    expect(info!.firstPrompt).toBe('hello world');
    expect(info!.customTitle).toBe('My Title');

    const row = (await listSessions({ sessionDir: dir }))[0];
    expect(row!.summary).toBe('My Title');
    expect(row!.createdAt).toBe(111);
    expect(row!.cwd).toBe('/w');
    expect((await getSessionInfo('s1', { sessionDir: dir }))!.firstPrompt).toBe('hello world');
  });

  it('a key-reordered sidechain transcript is still hidden from list() and latestSessionId()', async () => {
    const dir = freshDir();
    const store = new JsonlSessionStore({ sessionDir: dir });
    // The real record subagents/runtime.ts writes, re-serialized in jsonb order
    // (`fork` is 4 chars like `type` and sorts before it).
    const startLine = jsonbOrder({
      type: 'sidechain_start',
      timestamp: '2026-07-29T00:00:00.000Z',
      agent_type: 'explorer',
      fork: false,
      parent_session_id: 'main-1',
      parent_tool_use_id: 'tu_1',
      seeded_messages: 2,
    });
    expect(startLine.startsWith('{"type"')).toBe(false);
    writeFileSync(
      join(dir, 'agent-9.jsonl'),
      [
        startLine,
        JSON.stringify({
          type: 'assistant',
          uuid: 'a1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
        }),
      ].join('\n') + '\n',
    );

    expect((await store.list()).map((s) => s.sessionId)).toEqual([]);
    // `continue: true` must never resume a child transcript.
    expect(await store.latestSessionId()).toBeNull();
    expect(await store.loadInfo('agent-9')).toBeNull();
  });

  it('the compact `{"type":"sidechain_start"…}` prefix still wins even on a TORN first line', async () => {
    const dir = freshDir();
    const store = new JsonlSessionStore({ sessionDir: dir });
    // A crash mid-append leaves unparseable JSON; the anchored fast path must
    // still hide the transcript (a parse-only check would stop hiding it).
    writeFileSync(join(dir, 'agent-torn.jsonl'), '{"type":"sidechain_start","agent_ty');
    expect(await store.latestSessionId()).toBeNull();
    expect((await store.list()).map((s) => s.sessionId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ② NaN contextWindowTokens
// ---------------------------------------------------------------------------

function makeDeps(debug: (m: string) => void): EngineDeps {
  const hooks: HookRunner = {
    hasHooks: () => false,
    run: async () => ({ continue: true, systemMessages: [], additionalContext: [] }),
  };
  return {
    transport: new MockTransport([]),
    builtinTools: new Map(),
    mcp: {} as unknown as EngineDeps['mcp'],
    permissions: {} as unknown as EngineDeps['permissions'],
    hooks,
    toolContext: {} as unknown as EngineDeps['toolContext'],
    debug,
  };
}

function makeConfig(compaction: CompactionConfig): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 500,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-w19',
    cwd: '/work',
    compaction,
  };
}

function bigHistory(pairs: number): APIMessageParam[] {
  const out: APIMessageParam[] = [];
  for (let i = 0; i < pairs; i += 1) {
    out.push({ role: 'user', content: `u${i} ` + 'x'.repeat(4000) });
    out.push({ role: 'assistant', content: [{ type: 'text', text: `a${i} ` + 'y'.repeat(4000) }] });
  }
  return out;
}

async function foldOnce(
  contextWindowTokens: number | undefined,
): Promise<{ folded: boolean; boundaries: number; debug: string[] }> {
  const debug: string[] = [];
  const view = { messages: bigHistory(200) };
  const gen = maybeAutoCompact(
    view,
    makeDeps((m) => debug.push(m)),
    makeConfig(buildCompactionConfig({ contextWindowTokens })),
    0,
    new AbortController().signal,
  );
  const emitted: SDKMessage[] = [];
  let r = await gen.next();
  while (r.done !== true) {
    emitted.push(r.value);
    r = await gen.next();
  }
  return {
    folded: r.value === true,
    boundaries: emitted.filter(
      (m) => m.type === 'system' && (m as { subtype?: string }).subtype === 'compact_boundary',
    ).length,
    debug,
  };
}

describe('wave19 ②: a NaN contextWindowTokens must not silently disable compaction', () => {
  it('NaN behaves like unset (folds), instead of killing auto-compaction with no warning', async () => {
    const unset = await foldOnce(undefined);
    expect(unset.folded).toBe(true);
    expect(unset.boundaries).toBe(1);

    // Number(<unset env var>) is NaN — the exact shape the sibling knobs guard.
    const nan = await foldOnce(Number(process.env.SCS_WAVE19_DEFINITELY_UNSET));
    expect(Number.isNaN(Number(process.env.SCS_WAVE19_DEFINITELY_UNSET))).toBe(true);
    expect(nan.folded).toBe(true);
    expect(nan.boundaries).toBe(1);
  });

  it('a genuinely degenerate window still declines AND reports (unchanged)', async () => {
    const zero = await foldOnce(0);
    expect(zero.folded).toBe(false);
    expect(zero.debug.join('\n')).toContain('compaction impossible, skipping');
  });
});
