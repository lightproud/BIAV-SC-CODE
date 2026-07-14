/**
 * audit 2026-07-14 M-3: WebFetch DNS pinning.
 *
 * Before: ssrfGuard resolved + validated a hostname's addresses, then the
 * fetch performed its OWN second resolution — a classic DNS-rebinding window
 * (answer public on the guard's query, private on the connection's query).
 * After: the default path connects via node:https with a `lookup` override
 * that answers ONLY from the guard-validated address set, while Host / TLS
 * SNI stay on the original hostname. Redirect hops re-run guard + pinning.
 *
 * No network: node:dns/promises is mocked (guard resolution) and the pinned
 * request path is exercised through a fake node:https request impl injected
 * into pinnedFetch, plus a module-level node:https mock for the end-to-end
 * default-path wiring through webFetchTool.execute.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// Mock DNS so hostname-based SSRF resolution is deterministic + offline.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';

// Mock node:https so the DEFAULT (non-injected) WebFetch path is observable
// offline: `request` is a vi.fn the tests re-program per scenario.
vi.mock('node:https', () => ({ request: vi.fn() }));
import { request as httpsRequest } from 'node:https';

import {
  makePinnedLookup,
  pinnedFetch,
  webFetchTool,
  type PinnedAddress,
} from '../src/tools/webfetch.js';
import type { ToolContext } from '../src/internal/contracts.js';

const mockLookup = vi.mocked(lookup);
const mockRequest = vi.mocked(httpsRequest);

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

/** Fake IncomingMessage: a Readable with the http response metadata bolted on. */
function fakeResponse(
  status: number,
  headers: Record<string, string>,
  body: string,
): Readable & { statusCode: number; statusMessage: string; headers: Record<string, string> } {
  const res = Readable.from(body.length > 0 ? [Buffer.from(body)] : []) as Readable & {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
  };
  res.statusCode = status;
  res.statusMessage = 'OK';
  res.headers = headers;
  return res;
}

type CapturedOptions = {
  hostname?: string;
  port?: number;
  path?: string;
  headers?: Record<string, string>;
  lookup?: (hostname: string, options: unknown, cb: unknown) => void;
};

/** Fake https.request: captures options, emits the scripted response on end(). */
function fakeRequestImpl(
  responses: Array<ReturnType<typeof fakeResponse>>,
  captured: CapturedOptions[],
) {
  let call = 0;
  return ((options: CapturedOptions) => {
    captured.push(options);
    const res = responses[Math.min(call, responses.length - 1)];
    call++;
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      queueMicrotask(() => req.emit('response', res));
    };
    return req;
  }) as never;
}

/** Drive a captured lookup override and collect what it answers. */
function resolveVia(
  lookupFn: NonNullable<CapturedOptions['lookup']>,
  options: unknown,
): Promise<{ err: Error | null; address?: unknown; family?: unknown }> {
  return new Promise((resolve) => {
    lookupFn('irrelevant.example', options, (err: Error | null, address?: unknown, family?: unknown) =>
      resolve({ err, address, family }),
    );
  });
}

beforeEach(() => {
  mockLookup.mockReset();
  mockRequest.mockReset();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

// ---------------------------------------------------------------------------
// makePinnedLookup: the connection can only ever dial validated addresses
// ---------------------------------------------------------------------------

describe('makePinnedLookup', () => {
  const pinned: PinnedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1::1', family: 6 },
  ];

  it('answers the single-address shape with the FIRST validated address', async () => {
    const r = await resolveVia(makePinnedLookup(pinned), { family: 0 });
    expect(r.err).toBeNull();
    expect(r.address).toBe('93.184.216.34');
    expect(r.family).toBe(4);
  });

  it('answers the all:true shape with EXACTLY the validated set', async () => {
    const r = await resolveVia(makePinnedLookup(pinned), { all: true });
    expect(r.err).toBeNull();
    expect(r.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });

  it('honors a family filter (4 / 6 / "IPv6")', async () => {
    const v4 = await resolveVia(makePinnedLookup(pinned), { family: 4 });
    expect(v4.address).toBe('93.184.216.34');
    const v6 = await resolveVia(makePinnedLookup(pinned), { family: 6 });
    expect(v6.address).toBe('2606:2800:220:1::1');
    const v6s = await resolveVia(makePinnedLookup(pinned), { family: 'IPv6' });
    expect(v6s.address).toBe('2606:2800:220:1::1');
  });

  it('supports the (hostname, cb) legacy call shape', async () => {
    const fn = makePinnedLookup(pinned);
    const r = await new Promise<{ address?: unknown }>((resolve) => {
      fn('irrelevant.example', (err: unknown, address?: unknown) => resolve({ address }));
    });
    expect(r.address).toBe('93.184.216.34');
  });

  it('errs (ENOTFOUND-shaped) instead of falling back to real DNS when the family filter empties the set', async () => {
    const v4only: PinnedAddress[] = [{ address: '93.184.216.34', family: 4 }];
    const r = await resolveVia(makePinnedLookup(v4only), { family: 6 });
    expect(r.err).toBeInstanceOf(Error);
    expect((r.err as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });
});

// ---------------------------------------------------------------------------
// pinnedFetch: request wiring (hostname/SNI preserved, lookup pinned)
// ---------------------------------------------------------------------------

describe('pinnedFetch', () => {
  it('dials with the ORIGINAL hostname (Host/SNI) while lookup answers only validated IPs', async () => {
    const captured: CapturedOptions[] = [];
    const impl = fakeRequestImpl(
      [fakeResponse(200, { 'content-type': 'text/plain' }, 'pinned-hello')],
      captured,
    );
    const res = await pinnedFetch(
      new URL('https://public.example/data?q=1'),
      { signal: new AbortController().signal, headers: { accept: 'text/plain' } },
      [{ address: '93.184.216.34', family: 4 }],
      impl,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pinned-hello');

    expect(captured).toHaveLength(1);
    const opts = captured[0]!;
    // The hostname stays the NAME: node derives the Host header and the TLS
    // servername (SNI + cert verification) from it, not from the pinned IP.
    expect(opts.hostname).toBe('public.example');
    expect(opts.port).toBe(443);
    expect(opts.path).toBe('/data?q=1');
    expect(typeof opts.lookup).toBe('function');
    const answered = await resolveVia(opts.lookup!, { family: 0 });
    expect(answered.address).toBe('93.184.216.34');
  });

  it('omits the lookup override when pinning is disabled (allowPrivateWebFetch path)', async () => {
    const captured: CapturedOptions[] = [];
    const impl = fakeRequestImpl(
      [fakeResponse(200, { 'content-type': 'text/plain' }, 'ok')],
      captured,
    );
    await pinnedFetch(
      new URL('https://public.example/'),
      { signal: new AbortController().signal, headers: {} },
      null,
      impl,
    );
    expect(captured[0]!.lookup).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end default path: webFetchTool without an injected fetchImpl
// ---------------------------------------------------------------------------

describe('webFetchTool default path uses guard-validated pinning per hop', () => {
  function scriptHttps(responses: Array<ReturnType<typeof fakeResponse>>): CapturedOptions[] {
    const captured: CapturedOptions[] = [];
    mockRequest.mockImplementation(fakeRequestImpl(responses, captured) as never);
    return captured;
  }

  it('fetches through node:https with the lookup pinned to the guard result', async () => {
    const captured = scriptHttps([
      fakeResponse(200, { 'content-type': 'text/plain' }, 'default-path body'),
    ]);
    const r = await webFetchTool.execute(
      { url: 'https://public.example/page', prompt: 'x' },
      makeCtx(), // no fetchImpl -> default pinned path
    );
    expect(r.isError).toBeUndefined();
    expect(String(r.content)).toContain('default-path body');

    expect(captured).toHaveLength(1);
    expect(captured[0]!.hostname).toBe('public.example');
    const answered = await resolveVia(captured[0]!.lookup!, { family: 0 });
    expect(answered.address).toBe('93.184.216.34'); // exactly what the guard validated
    expect(mockLookup).toHaveBeenCalledTimes(1); // the guard's resolution is the ONLY one
  });

  it('re-runs guard + pinning on a same-host redirect hop', async () => {
    const captured = scriptHttps([
      fakeResponse(302, { location: 'https://public.example/final' }, ''),
      fakeResponse(200, { 'content-type': 'text/plain' }, 'landed'),
    ]);
    // Hop 2's guard resolution returns a DIFFERENT validated address; the
    // second connection must pin to it (per-hop re-validation, not a cache).
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '203.0.113.7', family: 4 }] as never);

    const r = await webFetchTool.execute(
      { url: 'https://public.example/start', prompt: 'x' },
      makeCtx(),
    );
    expect(r.isError).toBeUndefined();
    expect(String(r.content)).toContain('landed');

    expect(captured).toHaveLength(2);
    expect(mockLookup).toHaveBeenCalledTimes(2); // one guard resolution per hop
    const hop1 = await resolveVia(captured[0]!.lookup!, { family: 0 });
    expect(hop1.address).toBe('93.184.216.34');
    const hop2 = await resolveVia(captured[1]!.lookup!, { family: 0 });
    expect(hop2.address).toBe('203.0.113.7');
  });

  it('a redirect hop resolving to a private address is blocked before any second connection', async () => {
    const captured = scriptHttps([
      fakeResponse(302, { location: 'https://public.example/final' }, ''),
      fakeResponse(200, { 'content-type': 'text/plain' }, 'must never land'),
    ]);
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '10.0.0.9', family: 4 }] as never); // rebound!

    const r = await webFetchTool.execute(
      { url: 'https://public.example/start', prompt: 'x' },
      makeCtx(),
    );
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('10.0.0.9');
    expect(captured).toHaveLength(1); // second connection never happened
  });

  it('an IP-literal URL pins to that literal (no DNS at all)', async () => {
    const captured = scriptHttps([
      fakeResponse(200, { 'content-type': 'text/plain' }, 'literal ok'),
    ]);
    const r = await webFetchTool.execute(
      { url: 'https://93.184.216.34/x', prompt: 'x' },
      makeCtx(),
    );
    expect(r.isError).toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
    const answered = await resolveVia(captured[0]!.lookup!, { family: 0 });
    expect(answered.address).toBe('93.184.216.34');
  });

  it('an injected ctx.fetchImpl still bypasses pinning (documented escape hatch): node:https untouched', async () => {
    const impl = vi.fn(
      async () => new Response('injected ok', { headers: { 'content-type': 'text/plain' } }),
    );
    const r = await webFetchTool.execute(
      { url: 'https://public.example/', prompt: 'x' },
      makeCtx({ fetchImpl: impl as unknown as typeof fetch }),
    );
    expect(r.isError).toBeUndefined();
    expect(String(r.content)).toContain('injected ok');
    expect(impl).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockLookup).toHaveBeenCalledTimes(1); // the guard still runs
  });
});
