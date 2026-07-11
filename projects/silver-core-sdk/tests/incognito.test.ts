/**
 * Incognito session tests (governance spec S2) — the LEAK-TEST checklist from
 * the requirements doc, run through the REAL query() path with a scripted
 * fetch:
 *  - luring the model into a memory write ("记下来") -> the write command is
 *    rejected, /memories has no new or modified file;
 *  - a unique marker token used in the session survives NOWHERE on disk after
 *    the run (session dir, memory dir, cwd — recursive grep);
 *  - the downstream export surfaces (listSessions / getSessionMessages /
 *    getSessionToolCalls) return nothing for the session: excluded at the
 *    data-source level, not "not found because unscanned";
 *  - memory view STAYS available (read-only, "knows you, doesn't record you");
 *  - both R7 write rounds are disabled;
 *  - sessionStore + incognito is a configuration error.
 */

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/query.js';
import {
  INCOGNITO_MEMORY_ERROR,
  createLocalFilesystemMemoryStore,
  getSessionMessages,
  getSessionToolCalls,
  listSessions,
} from '../src/index.js';
import { ConfigurationError } from '../src/errors.js';
import { resolveMemoryRuntime } from '../src/tools/memory/index.js';
import { InMemorySessionStore } from '../src/sessions/store-adapter.js';
import type { Options, SDKMessage, SDKResultMessage } from '../src/types.js';
import type { ToolContext } from '../src/internal/contracts.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

const MARKER = 'purple-whale-protocol-9f3a7';

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-incog-cwd-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-incog-sess-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
  await rm(sessionDir, { recursive: true, force: true });
});

function baseOptions(stub: SSEFetchStub, extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false, fetch: stub },
    cwd,
    sessionDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    settingSources: [],
    ...extra,
  };
}

async function collect(prompt: string, options: Options): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of query({ prompt, options })) out.push(m);
  return out;
}

/** Recursive scan: every file under `dir` whose content contains `needle`. */
async function grepTree(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return hits;
  }
  for (const name of names) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) {
      hits.push(...(await grepTree(full, needle)));
    } else if ((await readFile(full, 'utf8').catch(() => '')).includes(needle)) {
      hits.push(full);
    }
  }
  return hits;
}

describe('S2 incognito leak test', () => {
  it('a lured memory write is rejected and the marker survives nowhere on disk', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', {
        command: 'create',
        path: '/memories/notes.md',
        file_text: `remember: ${MARKER}`,
      }),
      textReplyEvents(`understood, but nothing about ${MARKER} was recorded`),
    ]);
    const messages = await collect(
      `please write this down: ${MARKER}`,
      baseOptions(stub, { incognito: true, memory: {} }),
    );
    const result = messages.at(-1) as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('success');

    // The write command came back as a structured read-only error.
    const secondBody = stub.requests[1]!.body;
    const lastUser = (secondBody['messages'] as Array<Record<string, unknown>>).at(-1)!;
    const resultJson = JSON.stringify(lastUser['content']);
    expect(resultJson).toContain('incognito session');
    expect(resultJson).toContain('read-only');
    // The exact exported constant is what the model received.
    expect(resultJson).toContain(JSON.stringify(INCOGNITO_MEMORY_ERROR).slice(1, -1));

    // No memory artifact was created (the store may pre-create its empty base
    // directory; zero FILES is the promise that matters).
    const memDir = join(cwd, '.claude', 'memory');
    expect(await grepTree(memDir, '')).toEqual([]);

    // Marker-grep across every SDK-writable root: zero residue.
    expect(await grepTree(sessionDir, MARKER)).toEqual([]);
    expect(await grepTree(cwd, MARKER)).toEqual([]);

    // Data-source-level exclusion: the export surfaces have no such session.
    expect(await listSessions({ sessionDir })).toEqual([]);
    const sessionId = result.session_id;
    expect(await getSessionMessages(sessionId, { sessionDir })).toEqual([]);
    expect(await getSessionToolCalls(sessionId, { sessionDir })).toEqual([]);
  });

  it('memory view stays available (read-only incognito, pending-decision default)', async () => {
    // Seed a memory file OUTSIDE the session (pre-existing knowledge).
    const store = createLocalFilesystemMemoryStore(join(cwd, '.claude', 'memory'));
    await store.create('/memories/profile.md', 'the keeper prefers Beijing time');

    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', { command: 'view', path: '/memories/profile.md' }),
      textReplyEvents('done'),
    ]);
    const messages = await collect(
      'what do you know about me?',
      baseOptions(stub, { incognito: true, memory: {} }),
    );
    expect((messages.at(-1) as SDKResultMessage).subtype).toBe('success');
    const secondBody = stub.requests[1]!.body;
    const lastUser = (secondBody['messages'] as Array<Record<string, unknown>>).at(-1)!;
    expect(JSON.stringify(lastUser['content'])).toContain('Beijing time');
  });

  it('disables both R7 write rounds', () => {
    const runtime = resolveMemoryRuntime({
      memory: { flushOnCompaction: true, sessionEndUpdate: true },
      cwd,
      protocol: 'anthropic',
      incognito: true,
      debug: () => {},
    });
    expect(runtime.flushOnCompaction).toBe(false);
    expect(runtime.sessionEndUpdate).toBe(false);
  });

  it('rejects sessionStore + incognito as a configuration error', () => {
    const stub = makeSSEFetch([textReplyEvents('hi')]);
    expect(() =>
      query({
        prompt: 'hello',
        options: baseOptions(stub, {
          incognito: true,
          sessionStore: new InMemorySessionStore(),
        }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('a normal (non-incognito) run of the same script DOES persist — the leak test discriminates', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', {
        command: 'create',
        path: '/memories/notes.md',
        file_text: `remember: ${MARKER}`,
      }),
      textReplyEvents('saved'),
    ]);
    const messages = await collect(
      `please write this down: ${MARKER}`,
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    expect((messages.at(-1) as SDKResultMessage).subtype).toBe('success');
    expect((await grepTree(sessionDir, MARKER)).length).toBeGreaterThan(0);
    expect((await grepTree(cwd, MARKER)).length).toBeGreaterThan(0);
  });
});
