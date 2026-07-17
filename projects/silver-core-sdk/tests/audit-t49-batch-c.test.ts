/**
 * T49 batch C regression locks — the 18 P1 medium-severity fixes from the
 * 2026-07-17 audit (M1-M16 + M19/M20; M17 belongs to batch B, M18 to batch A).
 * One describe block per defect, named by its audit id. Two special cases:
 *   - M7 was already fixed in source (0.62.5 twin alignment) but had ZERO test
 *     coverage — the tests here lock it so it cannot silently regress.
 *   - M8 was refuted at source level (join('\n') is spec-equivalent to the
 *     WHATWG append+strip form); the tests pin that equivalence.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractProviderErrorObject,
  looksLikeErrorObject,
  normalizeProviderError,
} from '../src/error-normalize.js';
import {
  buildCompactionConfig,
  maybeAutoCompact,
  partitionForCompaction,
} from '../src/engine/compaction.js';
import { runAgentLoop } from '../src/engine/loop.js';
import { assembleMainLoop } from '../src/engine/prompt-assembler.js';
import { APIStatusError } from '../src/errors.js';
import { parseHookCondition } from '../src/hooks/condition.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import type {
  AggregatedHookResult,
  EngineConfig,
  EngineDeps,
  HookRunner,
  ToolContext,
} from '../src/internal/contracts.js';
import {
  guardRegexPattern,
  hasNestedQuantifier,
} from '../src/internal/regex-guard.js';
import { HttpMcpConnection } from '../src/mcp/http.js';
import { DefaultMcpRegistry } from '../src/mcp/registry.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { firePreconnect } from '../src/transport/node-http.js';
import { parseRetryAfterMs } from '../src/transport/openai.js';
import { parseSSE } from '../src/transport/sse.js';
import { createShellManager } from '../src/tools/shells.js';
import { webFetchTool } from '../src/tools/webfetch.js';
import type {
  APIMessageParam,
  HookInput,
  McpServerConfig,
  SDKMessage,
  SDKResultMessage,
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

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

const noHooks: HookRunner = {
  hasHooks: () => false,
  run: async (): Promise<AggregatedHookResult> => ({
    continue: true,
    systemMessages: [],
    additionalContext: [],
  }),
};

function makeEngineDeps(transport: EngineDeps['transport']): EngineDeps {
  return {
    transport,
    builtinTools: new Map(),
    mcp: {
      async connectAll() {},
      statuses: () => [],
      allTools: () => [],
      has: () => false,
      async call() {
        return { content: [{ type: 'text' as const, text: 'x' }], isError: true };
      },
      async listResources() {
        return [];
      },
      async readResource() {
        return [];
      },
      async reconnect() {},
      setEnabled() {},
      async setServers() {
        return {};
      },
      async closeAll() {},
    } as unknown as EngineDeps['mcp'],
    permissions: new DefaultPermissionGate({ debug: () => {}, mode: 'bypassPermissions' }),
    hooks: noHooks,
    toolContext: makeCtx(),
    debug: () => {},
  };
}

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

const pad = (s: string, len: number): string =>
  (s + ' ').repeat(Math.ceil(len / (s.length + 1))).slice(0, len);

/** Pure tool-loop history: one genuine prompt driving tool_use/tool_result. */
function pureToolLoop(pairs: number, resultLen: number): APIMessageParam[] {
  const msgs: APIMessageParam[] = [{ role: 'user', content: 'do the task' }];
  for (let i = 0; i < pairs; i += 1) {
    msgs.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { i } }],
    });
    msgs.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: `t${i}`, content: pad(`result ${i}`, resultLen) },
      ],
    });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// M1 — preconnect drains (never cancels) the probe response
// ---------------------------------------------------------------------------

describe('M1 — firePreconnect drains instead of cancelling', () => {
  it('consumes the body via arrayBuffer and never calls cancel (socket returns to pool)', async () => {
    const cancel = vi.fn(async () => undefined);
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const lines: string[] = [];
    const fetchFn = vi.fn(async () => ({ status: 405, body: { cancel }, arrayBuffer }));
    firePreconnect(
      fetchFn as unknown as Parameters<typeof firePreconnect>[0],
      'https://example.invalid/v1',
      (m) => lines.push(m),
    );
    await vi.waitFor(() => {
      expect(lines.join('\n')).toContain('preconnect completed (HTTP 405)');
    });
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M2 — regex guard flags alternation-overlap ReDoS
// ---------------------------------------------------------------------------

describe('M2 — hasNestedQuantifier catches overlapping-alternation quantified groups', () => {
  it('flags the exponential-ambiguity shapes', () => {
    expect(hasNestedQuantifier('(a|a)+')).toBe(true);
    expect(hasNestedQuantifier('(a|ab)+')).toBe(true);
    expect(hasNestedQuantifier('(\\d|\\d\\d)+')).toBe(true);
    expect(hasNestedQuantifier('((a|a))+')).toBe(true); // ambiguity survives nesting
    expect(hasNestedQuantifier('(.|x)*')).toBe(true); // bare dot overlaps anything
  });

  it('keeps safe linear alternations working', () => {
    expect(hasNestedQuantifier('(foo|bar)+')).toBe(false);
    expect(hasNestedQuantifier('(a|b)*')).toBe(false);
    expect(hasNestedQuantifier('foo|bar')).toBe(false); // no quantified group at all
    expect(hasNestedQuantifier('(a|a)')).toBe(false); // unquantified group
    expect(hasNestedQuantifier('(\\d|\\.)+')).toBe(false); // class vs escaped literal
    expect(hasNestedQuantifier('^mcp__(foo|bar)')).toBe(false);
  });

  it('still flags the classic nested quantifier and reports both shapes in the guard reason', () => {
    expect(hasNestedQuantifier('(a+)+')).toBe(true);
    expect(guardRegexPattern('(a|ab)+')).toContain('alternation');
    expect(guardRegexPattern('(foo|bar)+')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M3 — string `error` field with sibling status is detected and extracted
// ---------------------------------------------------------------------------

describe('M3 — gateway { error: "...", status } shape', () => {
  it('extractProviderErrorObject reads the string error as the message', () => {
    const out = extractProviderErrorObject({ error: 'rate limited', status: 503 });
    expect(out).toMatchObject({ message: 'rate limited', status: 503 });
  });

  it('looksLikeErrorObject recognizes it (with a status; never a typed stream event)', () => {
    expect(looksLikeErrorObject({ error: 'rate limited', status: 503 })).toBe(true);
    expect(looksLikeErrorObject({ error: 'x' })).toBe(false); // no status: stay conservative
    expect(
      looksLikeErrorObject({ type: 'message_delta', error: 'x', status: 503 }),
    ).toBe(false); // a typed stream event is never swallowed
  });

  it('normalizeProviderError keeps the 503 retryable instead of dropping to the generic branch', () => {
    const n = normalizeProviderError({ error: 'rate limited', status: 503 });
    expect(n.status).toBe(503);
    expect(n.retryable).toBe(true);
    expect(n.message).toBe('rate limited');
  });
});

// ---------------------------------------------------------------------------
// M4 — pure-tool-loop fold keeps customInstructions
// ---------------------------------------------------------------------------

describe('M4 — H1 collapsed fold carries compaction instructions', () => {
  it('the collapsed single user turn includes customInstructions', async () => {
    const cfg = buildCompactionConfig({
      customInstructions: 'KEEP TICKET-42',
      contextWindowTokens: 3_000,
      useApiSummary: false,
    });
    const config: EngineConfig = {
      model: 'claude-test-1',
      maxOutputTokens: 500,
      systemPrompt: '',
      includePartialMessages: false,
      sessionId: 's-m4',
      cwd: '/work',
      compaction: cfg,
    };
    const view = { messages: pureToolLoop(14, 800) };
    const out: SDKMessage[] = [];
    const gen = maybeAutoCompact(
      view,
      makeEngineDeps(new MockTransport([])),
      config,
      0,
      new AbortController().signal,
    );
    for (;;) {
      const r = await gen.next();
      if (r.done) {
        expect(r.value).toBe(true); // a fold actually happened
        break;
      }
      out.push(r.value);
    }
    expect(out.some((m) => m.type === 'system' && m.subtype === 'compact_boundary')).toBe(true);
    const first = view.messages[0]!;
    expect(first.role).toBe('user');
    expect(String(first.content)).toContain('KEEP TICKET-42');
  });
});

// ---------------------------------------------------------------------------
// M5 — ground-truth calibration unblocks the fold the estimator declines
// ---------------------------------------------------------------------------

describe('M5 — knownPromptFloor calibrates the partition guards', () => {
  it('a history the estimator under-counts folds once the floor proves it is big', () => {
    const cfg = buildCompactionConfig({ contextWindowTokens: 10_500 });
    // Tiny by ESTIMATE: prefix falls under minFoldTokens (15% of the budget).
    const msgs = pureToolLoop(4, 40);
    const budget = 10_000;
    expect(partitionForCompaction(msgs, budget, cfg)).toBeNull();
    // Ground truth says the same history REALLY occupies ~50k tokens.
    const part = partitionForCompaction(msgs, budget, cfg, 50_000);
    expect(part).not.toBeNull();
    expect(part!.prefix.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// M6 — web tool fragments are gated per tool
// ---------------------------------------------------------------------------

describe('M6 — WebFetch/WebSearch prompt fragments describe only registered tools', () => {
  it('WebFetch alone: no WebSearch description', () => {
    const p = assembleMainLoop({ toolNames: ['Read', 'WebFetch'] });
    expect(p).toContain('WebFetch fetches a URL');
    expect(p).not.toContain('WebSearch searches the web');
    expect(p).toContain('Never generate or guess URLs');
  });
  it('WebSearch alone: no WebFetch description', () => {
    const p = assembleMainLoop({ toolNames: ['Read', 'WebSearch'] });
    expect(p).toContain('WebSearch searches the web');
    expect(p).not.toContain('WebFetch fetches a URL');
    expect(p).toContain('Never generate or guess URLs');
  });
  it('neither tool: no web fragments at all', () => {
    const p = assembleMainLoop({ toolNames: ['Read', 'Bash'] });
    expect(p).not.toContain('WebFetch fetches a URL');
    expect(p).not.toContain('WebSearch searches the web');
    expect(p).not.toContain('Never generate or guess URLs');
  });
});

// ---------------------------------------------------------------------------
// M7 — Retry-After HTTP-date form (coverage lock; fix landed in 0.62.5)
// ---------------------------------------------------------------------------

describe('M7 — parseRetryAfterMs handles the RFC 7231 HTTP-date form', () => {
  it('a future HTTP-date maps to the delta from now (bounded)', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(20_000);
    expect(ms).toBeLessThanOrEqual(31_000);
  });
  it('a past HTTP-date means retry now (0), never NaN', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });
  it('a far-future HTTP-date is capped, and garbage stays undefined', () => {
    const far = new Date(Date.now() + 3_600_000).toUTCString();
    expect(parseRetryAfterMs(far)).toBe(120_000);
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
    expect(parseRetryAfterMs('   ')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// M8 — SSE multi-line data join is WHATWG-equivalent (refuted finding, pinned)
// ---------------------------------------------------------------------------

describe('M8 — parseSSE data-line semantics match the spec append+strip form', () => {
  it('a trailing empty data line preserves the trailing newline', async () => {
    const frames = [];
    for await (const f of parseSSE(streamFrom(['data: {"a":1}\ndata:\n\n']))) frames.push(f);
    expect(frames).toEqual([{ data: '{"a":1}\n' }]);
  });
  it('multi-line data joins with a single newline, middle empties preserved', async () => {
    const frames = [];
    for await (const f of parseSSE(streamFrom(['data: a\ndata:\ndata: b\n\n']))) frames.push(f);
    expect(frames).toEqual([{ data: 'a\n\nb' }]);
  });
});

// ---------------------------------------------------------------------------
// M9 — terminal stream failure still folds the attempt's billed usage
// ---------------------------------------------------------------------------

describe('M9 — terminal (no-replay, no-fallback) failure folds firstSink usage', () => {
  it('the error_during_execution result reports the doomed attempt input tokens', async () => {
    const failing = {
      // Yields a message_start that BILLS 1234 input tokens, then dies with a
      // non-retryable 400 (APIStatusError: not replay-safe, no fallback set).
      async *stream(): AsyncGenerator<unknown, void> {
        yield {
          type: 'message_start',
          message: {
            id: 'm1',
            type: 'message',
            role: 'assistant',
            model: 'claude-test-1',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1234, output_tokens: 0 },
          },
        };
        throw new APIStatusError(400, 'invalid_request_error', 'boom');
      },
    };
    const messages: SDKMessage[] = [];
    for await (const m of runAgentLoop(
      [{ role: 'user', content: 'hi' }],
      makeEngineDeps(failing as unknown as EngineDeps['transport']),
      {
        model: 'claude-test-1',
        maxOutputTokens: 100,
        systemPrompt: '',
        includePartialMessages: false,
        sessionId: 's-m9',
        cwd: '/work',
      },
    )) {
      messages.push(m);
    }
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('error_during_execution');
    expect(result.usage.input_tokens).toBe(1234);
    expect(result.modelUsage['claude-test-1']?.inputTokens).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// M10 — MCP SSE response whose final frame has no trailing newline
// ---------------------------------------------------------------------------

describe('M10 — HttpMcpConnection delivers a final data: frame without trailing newline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('callTool resolves instead of mcp_invalid_response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const req = JSON.parse(init?.body ?? '{}') as { id?: number };
        const sse =
          'event: message\n' +
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: { content: [{ type: 'text', text: 'pong' }] },
          })}`; // deliberately NO trailing newline
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
    const conn = new HttpMcpConnection(
      { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      { name: 'm10', debug: () => {} },
    );
    const result = await conn.callTool('ping', {});
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
  });
});

// ---------------------------------------------------------------------------
// M11 — background spawn surfaces async ENOENT as a returned error
// ---------------------------------------------------------------------------

describe('M11 — spawnBackground reports a missing shell instead of a silent post-ack failure', () => {
  it('a nonexistent shell resolves to { error } (candidate chains can fall through)', async () => {
    const manager = createShellManager(() => {});
    try {
      const launched = await manager.spawnBackground(
        'definitely-missing-shell-xyz',
        'echo hi',
        makeCtx(),
      );
      expect('error' in launched).toBe(true);
      expect((launched as { error: string }).error).toContain('ENOENT');
    } finally {
      manager.dispose();
    }
  });

  it('a real shell still spawns and completes', async () => {
    const manager = createShellManager(() => {});
    try {
      const launched = await manager.spawnBackground('bash', 'echo still-works', makeCtx());
      expect('id' in launched).toBe(true);
      const id = (launched as { id: string }).id;
      await vi.waitFor(() => {
        expect(manager.get(id)?.status).toBe('completed');
      });
      expect(manager.get(id)?.stdout).toContain('still-works');
    } finally {
      manager.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// M12 / M13 — Stop-condition transcript context + failure-mode routing
// ---------------------------------------------------------------------------

describe('M12 — Stop-condition evaluator sees the transcript tail', () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('the evaluation request carries transcript CONTENT, not just the path', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'bpt-m12-'));
    const transcriptPath = join(tmp, 'transcript.jsonl');
    writeFileSync(transcriptPath, '{"type":"assistant","text":"MAGIC-EVIDENCE-777"}\n');
    const t = new MockTransport([textReplyEvents('{"ok":true,"reason":"found it"}')]);
    const fired: string[] = [];
    const runner = new DefaultHookRunner({
      hooks: {
        Stop: [
          {
            condition: 'the transcript mentions the magic evidence',
            hooks: [
              async () => {
                fired.push('stop-cb');
                return {};
              },
            ],
          },
        ],
      },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    const input = {
      session_id: 's1',
      cwd: '/tmp',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      transcript_path: transcriptPath,
    } as HookInput;
    await runner.run('Stop', input, undefined, undefined, new AbortController().signal);
    expect(fired).toEqual(['stop-cb']);
    const sent = JSON.stringify(t.requests[0]?.messages ?? []);
    expect(sent).toContain('MAGIC-EVIDENCE-777');
  });
});

describe('M13 — condition-evaluation failure routes by failureMode', () => {
  it('parseHookCondition marks an unparseable reply as evaluationFailed (not a verdict)', () => {
    const r = parseHookCondition('utter garbage, no json here');
    expect(r.ok).toBe(false);
    expect(r.evaluationFailed).toBe(true);
    // A clean negative verdict is NOT an evaluation failure.
    expect(parseHookCondition('{"ok":false,"reason":"no"}').evaluationFailed).toBeUndefined();
  });

  it("failureMode 'closed': a garbled evaluation ADMITS the matcher (deny still denies)", async () => {
    const t = new MockTransport([textReplyEvents('garbled non-json reply')]);
    const fired: string[] = [];
    const runner = new DefaultHookRunner({
      hooks: {
        PreToolUse: [
          {
            condition: 'the command is dangerous',
            failureMode: 'closed',
            hooks: [
              async () => {
                fired.push('deny-cb');
                return { decision: 'block' as const, reason: 'blocked' };
              },
            ],
          },
        ],
      },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    const agg = await runner.run(
      'PreToolUse',
      {
        session_id: 's1',
        cwd: '/tmp',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
      } as HookInput,
      undefined,
      'Bash',
      new AbortController().signal,
    );
    expect(fired).toEqual(['deny-cb']);
    expect(agg.decision).toBe('deny');
  });

  it("failureMode 'open' (default) keeps the old skip-on-failure behavior", async () => {
    const t = new MockTransport([textReplyEvents('garbled non-json reply')]);
    const fired: string[] = [];
    const runner = new DefaultHookRunner({
      hooks: {
        PreToolUse: [
          {
            condition: 'the command is dangerous',
            hooks: [
              async () => {
                fired.push('cb');
                return {};
              },
            ],
          },
        ],
      },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    await runner.run(
      'PreToolUse',
      {
        session_id: 's1',
        cwd: '/tmp',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      } as HookInput,
      undefined,
      'Bash',
      new AbortController().signal,
    );
    expect(fired).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M19 — concurrent reconnects serialize; no orphan connection survives
// ---------------------------------------------------------------------------

describe('M19 — DefaultMcpRegistry.reconnect serializes per server', () => {
  type FakeConn = {
    connect: () => Promise<void>;
    serverInfo: () => { name: string; version: string };
    listTools: () => Promise<Array<{ name: string; inputSchema: object }>>;
    callTool: () => Promise<{ content: never[] }>;
    listResources: () => Promise<never[]>;
    readResource: () => Promise<never[]>;
    readResourceDir: () => Promise<never[]>;
    close: () => Promise<void>;
    closed: boolean;
  };

  it('two concurrent reconnects leave exactly ONE live connection (all others closed)', async () => {
    const created: FakeConn[] = [];
    // The FIRST created connection's close() is slow (gated on a timer) — the
    // exact window the old interleaving needed to orphan a fresh connection.
    const makeConn = (slowClose: boolean): FakeConn => {
      const conn: FakeConn = {
        closed: false,
        connect: async () => {},
        serverInfo: () => ({ name: 'srv', version: '1' }),
        listTools: async () => [{ name: 'tick', inputSchema: { type: 'object' } }],
        callTool: async () => ({ content: [] }),
        listResources: async () => [],
        readResource: async () => [],
        readResourceDir: async () => [],
        close: async () => {
          if (slowClose) await new Promise((r) => setTimeout(r, 20));
          conn.closed = true;
        },
      };
      created.push(conn);
      return conn;
    };
    const reg = new DefaultMcpRegistry({
      servers: { srv: { command: 'noop' } as McpServerConfig },
      debug: () => {},
    });
    (reg as unknown as { buildConnection: () => FakeConn }).buildConnection = () =>
      makeConn(created.length === 0);
    await reg.connectAll();
    expect(created).toHaveLength(1);

    await Promise.all([reg.reconnect('srv'), reg.reconnect('srv')]);

    // Serialized reconnects: every superseded connection is closed; exactly
    // one (the last) is live. The old interleaving left a live orphan.
    const open = created.filter((c) => !c.closed);
    expect(open).toHaveLength(1);
    expect(open[0]).toBe(created[created.length - 1]);
    await reg.closeAll();
  });
});

// ---------------------------------------------------------------------------
// M20 — WebFetch reports a bodyless 204/205 success honestly
// ---------------------------------------------------------------------------

describe('M20 — WebFetch on 204/205', () => {
  it('204 is an honest empty success, not an unsupported-content-type error', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const r = await webFetchTool.execute(
      { url: 'https://example.com/api/trigger', prompt: 'what happened?' },
      makeCtx({ fetchImpl } as unknown as Partial<ToolContext>),
    );
    expect(r.isError ?? false).toBe(false);
    expect(String(r.content)).toContain('204');
    expect(String(r.content)).toContain('no content');
  });

  it('a non-2xx still errors and an unsupported type on a REAL body still errors', async () => {
    const fetch500 = vi.fn(async () => new Response('nope', { status: 500 }));
    const bad = await webFetchTool.execute(
      { url: 'https://example.com/x', prompt: 'p' },
      makeCtx({ fetchImpl: fetch500 } as unknown as Partial<ToolContext>),
    );
    expect(bad.isError).toBe(true);
    const fetchBin = vi.fn(
      async () =>
        new Response('binary', {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    const bin = await webFetchTool.execute(
      { url: 'https://example.com/y', prompt: 'p' },
      makeCtx({ fetchImpl: fetchBin } as unknown as Partial<ToolContext>),
    );
    expect(bin.isError).toBe(true);
    expect(String(bin.content)).toContain('unsupported content type');
  });
});
