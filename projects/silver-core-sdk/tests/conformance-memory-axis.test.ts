/**
 * Conformance — memory axis (spec R2 acceptance, M2 skeleton).
 *
 * What is LOCKED today (mock wire, deterministic):
 *  - the native-mode `tools[]` tail is the official typed entry, byte-exact
 *    and schema-free, after every other advertised tool;
 *  - the typed entry carries the cache breakpoint when prompt caching is on
 *    (it is the last tools[] element, where the tools breakpoint lands);
 *  - no SDK-side protocol prompt accompanies native mode.
 *
 * What still needs a LIVE official-arm capture (keeper-dispatched
 * workflow run; see docs/MEMORY.md status note): a request-body wire
 * differential against the official SDK arm with the memory tool enabled —
 * entry position and surrounding fields compared field-by-field. The skipped
 * test below is the slot for that capture.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { query } from '../src/query.js';
import type { Options, SDKMessage } from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-conf-mem-cwd-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-conf-mem-sess-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(sessionDir, { recursive: true, force: true });
});

async function drain(options: Options): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of query({ prompt: 'hi', options })) out.push(m);
  return out;
}

function opts(stub: SSEFetchStub, extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', fetch: stub, ...extra.provider },
    cwd,
    sessionDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    settingSources: [],
    memory: { sessionEndUpdate: false },
    ...extra,
  };
}

describe('conformance memory axis: native-mode wire locks', () => {
  it('the typed entry is the LAST tools[] element, byte-exact, schema-free (caching off)', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await drain(opts(stub, { provider: { apiKey: 'test-key', fetch: stub, promptCaching: false } }));
    const tools = stub.requests[0]!.body['tools'] as Array<Record<string, unknown>>;
    expect(tools.at(-1)).toEqual({ type: 'memory_20250818', name: 'memory' });
    expect(tools.filter((t) => t['name'] === 'memory')).toHaveLength(1);
  });

  it('with prompt caching on, the tools breakpoint lands ON the typed entry (last element)', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await drain(opts(stub));
    const tools = stub.requests[0]!.body['tools'] as Array<Record<string, unknown>>;
    const last = tools.at(-1)!;
    expect(last['type']).toBe('memory_20250818');
    expect(last['name']).toBe('memory');
    expect(last['cache_control']).toEqual({ type: 'ephemeral' });
    // And ONLY the last tool carries it (the tools breakpoint contract).
    expect(tools.filter((t) => t['cache_control'] !== undefined)).toHaveLength(1);
  });

  it('native mode adds no SDK-side protocol prompt to the system field', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await drain(opts(stub));
    expect(JSON.stringify(stub.requests[0]!.body['system'] ?? '')).not.toContain(
      'MEMORY PROTOCOL',
    );
  });

  // R2 acceptance tail (deferred to a keeper-dispatched live run): compare the
  // FULL request body against an official-arm capture with the memory tool
  // enabled. Unskip once a capture exists under tests/conformance/.
  it.skip('official-arm wire differential (needs a live official-arm capture)', () => {
    // Placeholder: load the capture, diff tools[] ordering + entry fields
    // against a silver-core request built from the same inputs.
  });
});
