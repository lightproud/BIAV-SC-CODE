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
import { readFileSync } from 'node:fs';
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

  // R2 acceptance tail: field-level differential against the LIVE official-arm
  // capture (run 29148114257, 2026-07-11; fixture provenance inside the file).
  describe('official-arm wire differential (fixture: tests/conformance/official-memory-wire.json)', () => {
    type Capture = {
      arm: string;
      url: string;
      headers: Record<string, string>;
      body: { tools: Array<Record<string, unknown>>; [k: string]: unknown };
    };
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'conformance', 'official-memory-wire.json'), 'utf8'),
    ) as { captures: Capture[]; provenance?: { note?: string } };
    const ga = fixture.captures.find((c) => c.arm === 'ga')!;
    const runner = fixture.captures.find((c) => c.arm === 'runner')!;

    // WX5-1 (audit r3): `expect(anthropic-beta).toBeUndefined()` is only a real
    // check if the fixture's capture whitelist COULD have recorded that header.
    // The current capture script whitelists anthropic-beta, but a fixture
    // captured under an OLDER whitelist (note lists only content-type /
    // anthropic-version / user-agent) can never carry it — so the assertion
    // passes vacuously. Derive capturability from the recorded provenance and
    // only make the absence claim when the header was in scope; otherwise assert
    // the honest state (fixture predates beta-header capture, needs a re-run of
    // capture-official-memory-wire.mjs) instead of a silent green.
    const provNote = fixture.provenance?.note ?? '';
    const betaWasCapturable = /anthropic-beta/i.test(provNote);

    it('fixture integrity: both arms present, GA on the plain endpoint', () => {
      expect(ga).toBeDefined();
      expect(runner).toBeDefined();
      expect(ga.url).toBe('https://api.anthropic.com/v1/messages');
      expect(runner.url).toContain('/v1/messages');
      if (betaWasCapturable) {
        // The beta tool-runner rides the beta query flag; memory itself is GA
        // (no anthropic-beta header on either arm — matches the docs). This is a
        // MEANINGFUL absence: the header was in the capture whitelist.
        expect(ga.headers['anthropic-beta']).toBeUndefined();
        expect(runner.headers['anthropic-beta']).toBeUndefined();
      } else {
        // Fixture predates anthropic-beta capture: the absence cannot be
        // verified from it. Fail loudly ONLY on drift we can prove, and record
        // that the fixture must be regenerated to restore the beta-absence check.
        expect(runner.url).toContain('beta=true'); // the runner arm DID hit ?beta=true
        expect(betaWasCapturable).toBe(false); // documents the known limitation
      }
    });

    it('the official typed entry is EXACTLY {type, name} — and ours matches it byte-for-byte', async () => {
      const officialEntry = ga.body.tools.find((t) => t['type'] === 'memory_20250818')!;
      expect(officialEntry).toEqual({ type: 'memory_20250818', name: 'memory' });
      expect(Object.keys(officialEntry).sort()).toEqual(['name', 'type']);
      // The runner arm serializes the identical entry.
      expect(runner.body.tools).toEqual([{ type: 'memory_20250818', name: 'memory' }]);

      // OUR native-mode entry (caching off = no cache_control marker) must be
      // deep-equal to the official one — no extra fields, no client-side
      // schema, same literal type/name.
      const stub = makeSSEFetch([textReplyEvents('ok')]);
      await drain(
        opts(stub, { provider: { apiKey: 'test-key', fetch: stub, promptCaching: false } }),
      );
      const ourTools = stub.requests[0]!.body['tools'] as Array<Record<string, unknown>>;
      const ourEntry = ourTools.find((t) => t['type'] === 'memory_20250818')!;
      expect(ourEntry).toEqual(officialEntry);
    });

    it('official tools[] preserves caller order — entry position is caller-defined', () => {
      // The GA arm passed [custom, memory] and the wire kept that order
      // verbatim: the official SDK does not reposition typed entries, so this
      // SDK's place-last policy is a legal caller choice, not a divergence.
      expect(ga.body.tools.map((t) => t['name'])).toEqual(['echo_probe', 'memory']);
      const custom = ga.body.tools[0]!;
      expect(custom['input_schema']).toBeDefined();
      expect(custom['type']).toBeUndefined();
    });

    it('anthropic-version parity with the official arm', async () => {
      expect(ga.headers['anthropic-version']).toBe('2023-06-01');
      const stub = makeSSEFetch([textReplyEvents('ok')]);
      await drain(opts(stub));
      expect(stub.requests[0]!.headers['anthropic-version']).toBe(
        ga.headers['anthropic-version'],
      );
    });
  });
});
