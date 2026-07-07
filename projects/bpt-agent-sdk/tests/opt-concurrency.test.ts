/**
 * OPT-2 (runConcurrent), OPT-3 (MCP shared-pool concurrent-call hardening),
 * OPT-4 (transport maxConcurrentRequests semaphore). 2026-07-07.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConcurrent } from '../src/session-manager.js';
import { RequestSemaphore, AnthropicTransport } from '../src/transport/anthropic.js';
import { StdioMcpConnection } from '../src/mcp/stdio.js';
import { encodeSSEFrame } from './helpers/sse-fetch.js';
import type {
  Query,
  SDKMessage,
  SessionManager,
} from '../src/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ECHO_FIXTURE = path.join(HERE, 'fixtures', 'mcp-echo-server.mjs');

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// OPT-4: RequestSemaphore (the concurrency mechanism)
// ---------------------------------------------------------------------------

describe('OPT-4: RequestSemaphore', () => {
  it('never lets more than `permits` holders run at once', async () => {
    const sem = new RequestSemaphore(3);
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        (async () => {
          const release = await sem.acquire();
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(5);
          active -= 1;
          release();
        })(),
      ),
    );
    expect(maxActive).toBe(3);
  });

  it('hands permits to waiters in FIFO order', async () => {
    const sem = new RequestSemaphore(1);
    const order: number[] = [];
    const first = await sem.acquire(); // hold the only permit
    const waiters = [1, 2, 3].map((n) =>
      sem.acquire().then((rel) => {
        order.push(n);
        rel();
      }),
    );
    await delay(5);
    first(); // release -> waiter 1, which releases -> 2, -> 3
    await Promise.all(waiters);
    expect(order).toEqual([1, 2, 3]);
  });

  it('release is idempotent (double-release does not leak a permit)', async () => {
    const sem = new RequestSemaphore(1);
    const rel = await sem.acquire();
    rel();
    rel(); // must be a no-op, not a second permit
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        (async () => {
          const r = await sem.acquire();
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(3);
          active -= 1;
          r();
        })(),
      ),
    );
    expect(maxActive).toBe(1); // still a 1-permit semaphore
  });
});

describe('OPT-4: transport honors maxConcurrentRequests', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(): { calls: () => number; maxActive: () => number } {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(25);
      active -= 1;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encodeSSEFrame({ type: 'message_start' }));
          c.enqueue(encodeSSEFrame({ type: 'message_stop' }));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'request-id': 'r' } });
    });
    return { calls: () => calls, maxActive: () => maxActive };
  }

  const req = { model: 'm', max_tokens: 1, messages: [] };
  async function drain(t: AnthropicTransport): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of t.stream(req)) {
      // consume
    }
  }

  it('caps concurrent in-flight streams at the configured limit', async () => {
    const probe = stubFetch();
    const t = new AnthropicTransport({
      provider: { apiKey: 'sk-test', maxConcurrentRequests: 2 },
      env: {},
      debug: () => {},
      betas: undefined,
    });
    await Promise.all(Array.from({ length: 6 }, () => drain(t)));
    expect(probe.maxActive()).toBeLessThanOrEqual(2);
    expect(probe.calls()).toBe(6); // all still run, just not all at once
  });

  it('is unbounded by default (no cap -> all overlap)', async () => {
    const probe = stubFetch();
    const t = new AnthropicTransport({
      provider: { apiKey: 'sk-test' },
      env: {},
      debug: () => {},
      betas: undefined,
    });
    await Promise.all(Array.from({ length: 6 }, () => drain(t)));
    expect(probe.maxActive()).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// OPT-2: runConcurrent
// ---------------------------------------------------------------------------

/** A fake SessionManager whose query() yields an echo message then a result,
 *  tracking concurrent in-flight drives. A prompt of 'boom' throws mid-drive. */
function fakeManager(track: { active: number; maxActive: number }): SessionManager {
  return {
    query({ prompt }): Query {
      const label = String(prompt);
      async function* gen(): AsyncGenerator<SDKMessage, void> {
        track.active += 1;
        track.maxActive = Math.max(track.maxActive, track.active);
        try {
          await delay(10);
          yield { type: 'system', subtype: 'echo', label } as unknown as SDKMessage;
          if (label === 'boom') throw new Error('boom failed');
          yield {
            type: 'result',
            subtype: 'success',
            label,
          } as unknown as SDKMessage;
        } finally {
          track.active -= 1;
        }
      }
      return gen() as unknown as Query;
    },
    usage: () => ({ totalCostUsd: 0, usage: {} as never, modelUsage: {}, queries: 0 }),
    close: async () => {},
  } as unknown as SessionManager;
}

describe('OPT-2: runConcurrent', () => {
  it('runs all tasks and returns outcomes index-aligned with input', async () => {
    const track = { active: 0, maxActive: 0 };
    const mgr = fakeManager(track);
    const tasks = [0, 1, 2, 3].map((i) => ({ prompt: `t${i}` }));
    const out = await runConcurrent(mgr, tasks, { concurrency: 2 });
    expect(out).toHaveLength(4);
    out.forEach((o, i) => {
      expect(o.index).toBe(i);
      expect((o.result as unknown as { label: string })?.label).toBe(`t${i}`);
      expect(o.error).toBeUndefined();
    });
  });

  it('bounds concurrency to the configured limit', async () => {
    const track = { active: 0, maxActive: 0 };
    const mgr = fakeManager(track);
    const tasks = Array.from({ length: 8 }, (_, i) => ({ prompt: `t${i}` }));
    await runConcurrent(mgr, tasks, { concurrency: 3 });
    expect(track.maxActive).toBe(3);
  });

  it('isolates a failing task — its outcome carries error, siblings still succeed', async () => {
    const track = { active: 0, maxActive: 0 };
    const mgr = fakeManager(track);
    const tasks = [{ prompt: 'ok0' }, { prompt: 'boom' }, { prompt: 'ok2' }];
    const out = await runConcurrent(mgr, tasks, { concurrency: 3 });
    expect(out[0]!.error).toBeUndefined();
    expect(out[1]!.error).toBeInstanceOf(Error);
    expect(out[1]!.result).toBeNull();
    expect(out[2]!.error).toBeUndefined();
    expect((out[2]!.result as unknown as { label: string })?.label).toBe('ok2');
  });

  it('onMessage sees every message tagged by task index; collectMessages captures them', async () => {
    const track = { active: 0, maxActive: 0 };
    const mgr = fakeManager(track);
    const seen: Array<[number, string]> = [];
    const out = await runConcurrent(mgr, [{ prompt: 'a' }, { prompt: 'b' }], {
      concurrency: 2,
      collectMessages: true,
      onMessage: (i, m) => seen.push([i, (m as unknown as { type: string }).type]),
    });
    expect(seen.length).toBe(4); // 2 messages x 2 tasks
    expect(out[0]!.messages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// OPT-3: MCP shared-pool concurrent-call hardening (stdio id multiplexing)
// ---------------------------------------------------------------------------

describe('OPT-3: concurrent callTool over one stdio connection never cross-talks', () => {
  it('routes 50 concurrent echo calls each to its OWN response by request id', async () => {
    const conn = new StdioMcpConnection(
      { type: 'stdio', command: process.execPath, args: [ECHO_FIXTURE] },
      { name: 'echo' },
    );
    await conn.connect();
    try {
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          conn.callTool('echo', { payload: `payload-${i}` }),
        ),
      );
      results.forEach((res, i) => {
        const text = (res.content?.[0] as { text?: string } | undefined)?.text ?? '';
        // echo returns the args JSON; each must carry ITS OWN payload, proving
        // the response was routed to the right pending request (no cross-talk).
        expect(text).toContain(`payload-${i}`);
      });
    } finally {
      await conn.close();
    }
  });

  it('an interleaved failing call rejects on its OWN id without disturbing sibling responses', async () => {
    // At the raw connection layer a JSON-RPC error rejects (isError conversion
    // is the registry's job); the point here is that one rejected id does not
    // corrupt the pending map — sibling echoes still resolve to their own text.
    const conn = new StdioMcpConnection(
      { type: 'stdio', command: process.execPath, args: [ECHO_FIXTURE] },
      { name: 'echo' },
    );
    await conn.connect();
    try {
      const settled = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          i % 4 === 0 ? conn.callTool('boom', {}) : conn.callTool('echo', { payload: `ok-${i}` }),
        ),
      );
      settled.forEach((s, i) => {
        if (i % 4 === 0) {
          expect(s.status).toBe('rejected');
        } else {
          expect(s.status).toBe('fulfilled');
          const text =
            s.status === 'fulfilled'
              ? ((s.value.content?.[0] as { text?: string } | undefined)?.text ?? '')
              : '';
          expect(text).toContain(`ok-${i}`);
        }
      });
    } finally {
      await conn.close();
    }
  });
});
