/**
 * SessionManager (SM-甲) shared-coordination suite — proposal §7 "共享协调" row
 * (Public-Info-Pool/Resource/proposal/bpt-sdk-session-manager-20260706.md):
 *
 *  ① two concurrent mgr.query() runs multiplex ONE shared MCP registry with
 *    no cross-talk (request-id correlation);
 *  ② #1 red line: a finished query leaves the shared MCP connection alive —
 *    the next query reuses the SAME server process (stdio pid proof);
 *  ③ mgr.close() is the single teardown point (registry closeAll observed);
 *  ④ mgr.query() after close() throws ConfigurationError;
 *  ⑤ standalone query() regression: still owns + closes its own registry
 *    (full-suite vitest is the broader regression guard);
 *  ⑥ mgr.usage() aggregates cost/tokens across conversations;
 *  ⑦ D1: per-query mcpServers (and provider) are refused loudly.
 *
 * Fixtures follow tests/mcp.test.ts patterns: the in-process sdk server
 * (createSdkMcpServer) and the stdio echo emulator
 * (tests/fixtures/mcp-echo-server.mjs), driven end-to-end through query()
 * against a scripted SSE fetch stub (no network).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ConfigurationError,
  createBptSession,
  createSdkMcpServer,
  query,
  tool,
} from '../src/index.js';
import { DefaultMcpRegistry } from '../src/mcp/registry.js';
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  SessionManagerOptions,
} from '../src/types.js';
import {
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { encodeSSEFrame, makeSSEFetch } from './helpers/sse-fetch.js';
import type { SSEFetchStub } from './helpers/sse-fetch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ECHO_FIXTURE = path.join(HERE, 'fixtures', 'mcp-echo-server.mjs');

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-mgr-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'bpt-mgr-cwd-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function baseManagerOptions(extra: Partial<SessionManagerOptions> = {}): SessionManagerOptions {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    cwd,
    // Hermetic env: no ANTHROPIC_* leakage; PATH kept so stdio servers spawn.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

function stubFetch(stub: SSEFetchStub): SSEFetchStub {
  vi.stubGlobal('fetch', stub);
  return stub;
}

/**
 * Body-aware SSE fetch stub for CONCURRENT queries, where call ordering is
 * nondeterministic and the index-scripted makeSSEFetch cannot be used: the
 * route callback inspects each request body and returns the raw stream-event
 * payloads for that reply.
 */
function routedSSEFetch(
  route: (body: Record<string, any>) => object[],
): (input: unknown, init?: RequestInit) => Promise<Response> {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    const events = route(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeSSEFrame(event));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}

async function collect(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function lastResult(messages: SDKMessage[]): SDKResultMessage {
  const last = messages[messages.length - 1];
  expect(last?.type).toBe('result');
  return last as SDKResultMessage;
}

/** All tool_result text payloads surfaced in a query's message stream. */
function toolResultTexts(messages: SDKMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.type !== 'user') continue;
    const content = (m as SDKUserMessage).message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if ((block as { type?: string }).type !== 'tool_result') continue;
      const c = (block as { content?: unknown }).content;
      if (typeof c === 'string') out.push(c);
      else if (Array.isArray(c)) {
        for (const part of c) {
          if (
            part !== null &&
            typeof part === 'object' &&
            (part as { type?: string }).type === 'text'
          ) {
            out.push((part as { text: string }).text);
          }
        }
      }
    }
  }
  return out;
}

/** True while the pid exists (signal 0 probe). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until the pid no longer exists (process reaped), or time out. */
async function waitForPidExit(pid: number, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (!pidAlive(pid)) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// ② #1 red line + ③ close tears down + ④ closed manager refuses (stdio pid proof)
// ---------------------------------------------------------------------------

describe('SessionManager shared MCP lifecycle (stdio emulator)', () => {
  it('red line: query #1 finishing leaves the shared stdio server alive; query #2 reuses the SAME process; mgr.close() kills it; query after close throws', async () => {
    const mgr = createBptSession(
      baseManagerOptions({
        mcpServers: { echo: { command: 'node', args: [ECHO_FIXTURE] } },
        allowedTools: ['mcp__echo__pid'],
      }),
    );
    stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('mcp__echo__pid', {}, { id: 'toolu_pid_1' }),
        textReplyEvents('first conversation done'),
        toolUseReplyEvents('mcp__echo__pid', {}, { id: 'toolu_pid_2' }),
        textReplyEvents('second conversation done'),
      ]),
    );

    // Conversation 1 runs to completion (its generator's finally has run).
    const msgsA = await collect(mgr.query({ prompt: 'conversation one' }));
    expect(lastResult(msgsA).subtype).toBe('success');
    const pid1 = Number.parseInt(toolResultTexts(msgsA)[0] ?? '', 10);
    expect(Number.isInteger(pid1)).toBe(true);
    expect(pid1).toBeGreaterThan(0);

    // #1 red line: the shared connection survived conversation 1's end.
    expect(pidAlive(pid1)).toBe(true);

    // Conversation 2 multiplexes the SAME server process (no respawn).
    const msgsB = await collect(mgr.query({ prompt: 'conversation two' }));
    expect(lastResult(msgsB).subtype).toBe('success');
    const pid2 = Number.parseInt(toolResultTexts(msgsB)[0] ?? '', 10);
    expect(pid2).toBe(pid1);

    // ③ Unified teardown: mgr.close() is what kills the shared server.
    await mgr.close();
    expect(await waitForPidExit(pid1)).toBe(true);

    // ④ close() -> further query() refused loudly.
    expect(() => mgr.query({ prompt: 'too late' })).toThrow(ConfigurationError);
    expect(() => mgr.query({ prompt: 'too late' })).toThrow(/closed/);
  }, 20000);
});

// ---------------------------------------------------------------------------
// ① concurrent conversations multiplex one registry without cross-talk
// ---------------------------------------------------------------------------

describe('SessionManager concurrent conversations (sdk in-process server)', () => {
  it('two overlapping mgr.query() runs call the same shared registry and each gets ITS OWN tool result back', async () => {
    const seen: string[] = [];
    const echo = tool(
      'echo',
      'Echo the tag back after an optional delay',
      { tag: z.string(), delayMs: z.number().optional() },
      async (args) => {
        seen.push(args.tag);
        if (args.delayMs !== undefined) await delay(args.delayMs);
        return { content: [{ type: 'text', text: args.tag }] };
      },
    );
    const calc = createSdkMcpServer({ name: 'calc', version: '1.0.0', tools: [echo] });
    const mgr = createBptSession(
      baseManagerOptions({
        mcpServers: { calc },
        allowedTools: ['mcp__calc__echo'],
      }),
    );

    // Concurrency makes fetch-call order nondeterministic: route replies by
    // request body instead of by call index. First round for a conversation
    // (no tool_result yet) -> tool_use; second round -> final text.
    vi.stubGlobal(
      'fetch',
      routedSSEFetch((body) => {
        const raw = JSON.stringify(body.messages);
        const isAlpha = raw.includes('alpha-conversation');
        const hasToolResult = raw.includes('"tool_result"');
        if (!hasToolResult) {
          return toolUseReplyEvents(
            'mcp__calc__echo',
            isAlpha
              ? { tag: 'tag-alpha', delayMs: 60 }
              : { tag: 'tag-beta', delayMs: 5 },
            { id: isAlpha ? 'toolu_alpha' : 'toolu_beta' },
          );
        }
        return textReplyEvents(isAlpha ? 'alpha done' : 'beta done');
      }),
    );

    const [msgsA, msgsB] = await Promise.all([
      collect(mgr.query({ prompt: 'alpha-conversation' })),
      collect(mgr.query({ prompt: 'beta-conversation' })),
    ]);

    // Both conversations ran the shared server (both tags observed) and each
    // stream carries exactly its own tool result — no cross-talk.
    expect(seen.sort()).toEqual(['tag-alpha', 'tag-beta']);
    expect(toolResultTexts(msgsA)).toEqual(['tag-alpha']);
    expect(toolResultTexts(msgsB)).toEqual(['tag-beta']);
    expect(lastResult(msgsA).subtype).toBe('success');
    expect(lastResult(msgsB).subtype).toBe('success');

    await mgr.close();
  }, 20000);
});

// ---------------------------------------------------------------------------
// mgr.close() with an IN-FLIGHT query (audit 2026-07-10 P2-7): lock the
// semantics — close() resolves promptly WITHOUT cancelling the in-flight
// turn (the shared transport is a stateless requester; in-process MCP calls
// already dispatched keep running), the turn then completes, and any NEW
// mgr.query() after close is refused loudly.
// ---------------------------------------------------------------------------

describe('SessionManager close() during an in-flight query', () => {
  it('close resolves promptly, the in-flight turn completes, new query() refused', async () => {
    let releaseTool!: () => void;
    const toolEntered = new Promise<void>((enterResolve) => {
      void enterResolve; // reassigned below via closure trick
    });
    let markEntered!: () => void;
    const entered = new Promise<void>((r) => {
      markEntered = r;
    });
    const gate = new Promise<void>((r) => {
      releaseTool = r;
    });
    const slow = tool(
      'slow',
      'Blocks until the test releases it',
      { tag: z.string() },
      async (args) => {
        markEntered();
        await gate;
        return { content: [{ type: 'text', text: `done-${args.tag}` }] };
      },
    );
    const srv = createSdkMcpServer({ name: 'slowsrv', version: '1.0.0', tools: [slow] });
    const mgr = createBptSession(
      baseManagerOptions({
        mcpServers: { slowsrv: srv },
        allowedTools: ['mcp__slowsrv__slow'],
      }),
    );
    vi.stubGlobal(
      'fetch',
      routedSSEFetch((body) => {
        const hasToolResult = JSON.stringify(body.messages).includes('"tool_result"');
        return hasToolResult
          ? textReplyEvents('inflight finished')
          : toolUseReplyEvents('mcp__slowsrv__slow', { tag: 'x' }, { id: 'toolu_slow' });
      }),
    );

    const inflight = collect(mgr.query({ prompt: 'inflight-conversation' }));
    await entered; // the turn is now blocked inside the shared MCP tool
    const closeStart = Date.now();
    const closing = mgr.close();
    // close() must not deadlock behind the in-flight tool call.
    await closing;
    expect(Date.now() - closeStart).toBeLessThan(2000);
    // New conversations are refused after close...
    await expect(async () => {
      const q = mgr.query({ prompt: 'after-close' });
      await collect(q);
    }).rejects.toMatchObject({ name: 'ConfigurationError' });
    // ...while the already-dispatched turn completes once the tool returns.
    releaseTool();
    const messages = await inflight;
    expect(toolResultTexts(messages)).toEqual(['done-x']);
    expect(lastResult(messages).subtype).toBe('success');
    void toolEntered;
  }, 20000);
});

// ---------------------------------------------------------------------------
// ③ ownership: no query-side closeAll; manager close is observed + idempotent
// ---------------------------------------------------------------------------

describe('SessionManager ownership of the shared registry', () => {
  it('a finished managed query never calls the shared registry closeAll; mgr.close() calls it exactly once (idempotent)', async () => {
    const closeSpy = vi.spyOn(DefaultMcpRegistry.prototype, 'closeAll');
    const ping = tool('ping', 'ping', {}, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    const srv = createSdkMcpServer({ name: 'probe', tools: [ping] });
    const mgr = createBptSession(
      baseManagerOptions({
        mcpServers: { probe: srv },
        allowedTools: ['mcp__probe__ping'],
      }),
    );
    stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('mcp__probe__ping', {}),
        textReplyEvents('ok'),
      ]),
    );

    const msgs = await collect(mgr.query({ prompt: 'use the probe' }));
    expect(toolResultTexts(msgs)).toEqual(['pong']);
    // Borrowed, not owned: the query's teardown left the shared pool intact.
    expect(closeSpy).not.toHaveBeenCalled();

    await mgr.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    await mgr.close(); // idempotent
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('Query.setMcpServers on a managed query is refused (it would dismantle the shared pool)', async () => {
    const srv = createSdkMcpServer({ name: 'probe', tools: [] });
    const mgr = createBptSession(baseManagerOptions({ mcpServers: { probe: srv } }));
    stubFetch(makeSSEFetch([textReplyEvents('ok')]));

    const q = mgr.query({ prompt: 'hello' });
    await expect(q.setMcpServers({})).rejects.toThrow(ConfigurationError);
    await collect(q);
    await mgr.close();
  });
});

// ---------------------------------------------------------------------------
// ⑤ standalone query() regression: still owns and closes its own registry
// ---------------------------------------------------------------------------

describe('standalone query() ownership regression', () => {
  it('an unmanaged query constructs its own registry and closes it on completion (behavior unchanged)', async () => {
    const closeSpy = vi.spyOn(DefaultMcpRegistry.prototype, 'closeAll');
    const ping = tool('ping', 'ping', {}, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    const srv = createSdkMcpServer({ name: 'solo', tools: [ping] });
    stubFetch(makeSSEFetch([textReplyEvents('done')]));

    const msgs = await collect(
      query({
        prompt: 'no tools needed',
        options: {
          ...(baseManagerOptions() as Options),
          mcpServers: { solo: srv },
        },
      }),
    );
    expect(lastResult(msgs).subtype).toBe('success');
    // Owner teardown ran: the standalone query closed the registry it built.
    expect(closeSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ⑥ usage aggregation across conversations
// ---------------------------------------------------------------------------

describe('SessionManager.usage()', () => {
  it('aggregates tokens and cost across two conversations (read-only view, D2)', async () => {
    const mgr = createBptSession(
      baseManagerOptions({
        // R2 seam smoke: recovery is ACCEPTED (typed) and inert in SM-甲.
        recovery: { autoResume: true, maxResumes: 2 },
      }),
    );
    stubFetch(
      makeSSEFetch([
        textReplyEvents('one', { usage: { input_tokens: 25 } }),
        textReplyEvents('two', { usage: { input_tokens: 25 } }),
      ]),
    );

    expect(mgr.usage()).toEqual({
      totalCostUsd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      queries: 0,
    });

    const rA = lastResult(await collect(mgr.query({ prompt: 'conversation a' })));
    const rB = lastResult(await collect(mgr.query({ prompt: 'conversation b' })));

    const agg = mgr.usage();
    expect(agg.queries).toBe(2);
    expect(agg.usage.input_tokens).toBe(rA.usage.input_tokens + rB.usage.input_tokens);
    expect(agg.usage.output_tokens).toBe(rA.usage.output_tokens + rB.usage.output_tokens);
    expect(agg.totalCostUsd).toBeCloseTo(rA.total_cost_usd + rB.total_cost_usd, 10);
    // Per-model rollup merges both conversations' figures for the same model.
    const perModel = Object.values(agg.modelUsage);
    expect(perModel.length).toBeGreaterThan(0);
    const totalInput = perModel.reduce((s, m) => s + m.inputTokens, 0);
    expect(totalInput).toBe(agg.usage.input_tokens);

    await mgr.close();
  });
});

// ---------------------------------------------------------------------------
// ⑦ D1: shared-layer options cannot be overridden per query
// ---------------------------------------------------------------------------

describe('SessionManager D1 refusals', () => {
  it('per-query mcpServers throws ConfigurationError loudly (D1: v1 has no private MCP overlay)', async () => {
    const mgr = createBptSession(baseManagerOptions());
    const srv = createSdkMcpServer({ name: 'private', tools: [] });
    expect(() =>
      mgr.query({ prompt: 'x', options: { mcpServers: { private: srv } } }),
    ).toThrow(ConfigurationError);
    expect(() =>
      mgr.query({ prompt: 'x', options: { mcpServers: { private: srv } } }),
    ).toThrow(/D1/);
    await mgr.close();
  });

  it('per-query provider throws ConfigurationError (the transport is shared)', async () => {
    const mgr = createBptSession(baseManagerOptions());
    expect(() =>
      mgr.query({ prompt: 'x', options: { provider: { apiKey: 'other' } } }),
    ).toThrow(ConfigurationError);
    await mgr.close();
  });

  it('per-query overrides of NON-shared knobs still work (model override reaches the wire)', async () => {
    const mgr = createBptSession(baseManagerOptions());
    const stub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const msgs = await collect(
      mgr.query({ prompt: 'hello', options: { model: 'claude-haiku-4-5' } }),
    );
    expect(lastResult(msgs).subtype).toBe('success');
    expect(stub.requests[0]?.body.model).toBe('claude-haiku-4-5');
    await mgr.close();
  });
});
