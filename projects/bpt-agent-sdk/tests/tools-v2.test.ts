/**
 * Regression tests for the v0.2 built-in tools (WebFetch, WebSearch,
 * AskUserQuestion, TodoWrite) and the MCP elicitation helper.
 *
 * No network: WebFetch uses an injected ctx.fetchImpl and a mocked
 * node:dns/promises lookup; the other tools receive stub ctx callbacks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS so hostname-based SSRF resolution is deterministic + offline.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';

import { webFetchTool } from '../src/tools/webfetch.js';
import { webSearchTool } from '../src/tools/websearch.js';
import { askUserQuestionTool } from '../src/tools/askuserquestion.js';
import { todoWriteTool } from '../src/tools/todo.js';
import {
  resolveElicitation,
  parseElicitationParams,
} from '../src/mcp/elicitation.js';
import { HttpMcpConnection } from '../src/mcp/http.js';
import type { ToolContext } from '../src/internal/contracts.js';
import type {
  WebSearchResult,
  UserQuestionAnswer,
  ElicitationResult,
  ElicitationHandler,
} from '../src/types.js';
import { AbortError } from '../src/errors.js';

const mockLookup = vi.mocked(lookup);

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

/** Build a fetch-shaped stub returning the given Response (or per-call list). */
function fetchReturning(...responses: Response[]): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  mockLookup.mockReset();
  // Default: any hostname resolves to a public address.
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

// ---------------------------------------------------------------------------
// WebFetch
// ---------------------------------------------------------------------------

describe('webFetchTool', () => {
  it('rejects a missing/blank url', async () => {
    const r = await webFetchTool.execute({ url: '', prompt: 'x' }, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('rejects a non-string prompt', async () => {
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 5 }, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('rejects an unsupported scheme', async () => {
    const r = await webFetchTool.execute({ url: 'ftp://example.com', prompt: 'x' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('scheme');
  });

  it('upgrades http -> https before fetching', async () => {
    const impl = vi.fn(async () => new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } }));
    const ctx = makeCtx({ fetchImpl: impl as unknown as typeof fetch });
    await webFetchTool.execute({ url: 'http://example.com/page', prompt: 'x' }, ctx);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(impl.mock.calls[0][0]).toMatch(/^https:\/\//);
  });

  it.each([
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['192.168.0.5'],
    ['169.254.10.10'],
    ['100.64.1.1'],
    ['172.16.0.1'],
  ])('blocks private/loopback IP literal %s', async (host) => {
    const impl = vi.fn();
    const ctx = makeCtx({ fetchImpl: impl as unknown as typeof fetch });
    const r = await webFetchTool.execute({ url: `https://${host}/`, prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(impl).not.toHaveBeenCalled();
  });

  it('blocks localhost', async () => {
    const r = await webFetchTool.execute({ url: 'https://localhost/', prompt: 'x' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('localhost');
  });

  it('blocks IPv6 loopback ::1 and ULA fc00', async () => {
    const r1 = await webFetchTool.execute({ url: 'https://[::1]/', prompt: 'x' }, makeCtx());
    expect(r1.isError).toBe(true);
    const r2 = await webFetchTool.execute({ url: 'https://[fc00::1]/', prompt: 'x' }, makeCtx());
    expect(r2.isError).toBe(true);
  });

  it('blocks a hostname whose DNS lookup resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }] as never);
    const impl = vi.fn();
    const ctx = makeCtx({ fetchImpl: impl as unknown as typeof fetch });
    const r = await webFetchTool.execute({ url: 'https://internal.example/', prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(impl).not.toHaveBeenCalled();
  });

  it('allowPrivateWebFetch bypasses the SSRF guard', async () => {
    const impl = vi.fn(async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    const ctx = makeCtx({ fetchImpl: impl as unknown as typeof fetch, allowPrivateWebFetch: true });
    const r = await webFetchTool.execute({ url: 'https://127.0.0.1/', prompt: 'x' }, ctx);
    expect(r.isError).toBeUndefined();
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('converts HTML to text, stripping script/style and decoding entities', async () => {
    const html =
      '<html><head><style>.a{color:red}</style></head><body>' +
      '<script>evil()</script><h1>Title</h1><p>a &amp; b &lt;ok&gt;</p></body></html>';
    const ctx = makeCtx({
      fetchImpl: fetchReturning(new Response(html, { headers: { 'content-type': 'text/html' } })),
    });
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx);
    const text = String(r.content);
    expect(text).toContain('Title');
    expect(text).toContain('a & b <ok>');
    expect(text).not.toContain('evil()');
    expect(text).not.toContain('color:red');
  });

  it('passes JSON through without HTML stripping', async () => {
    const ctx = makeCtx({
      fetchImpl: fetchReturning(
        new Response('{"k": "<v>"}', { headers: { 'content-type': 'application/json' } }),
      ),
    });
    const r = await webFetchTool.execute({ url: 'https://api.example.com', prompt: 'x' }, ctx);
    expect(String(r.content)).toContain('"<v>"');
  });

  it('returns isError on a non-2xx status', async () => {
    const ctx = makeCtx({ fetchImpl: fetchReturning(new Response('nope', { status: 404 })) });
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('404');
  });

  it('returns isError on an unsupported content type', async () => {
    const ctx = makeCtx({
      fetchImpl: fetchReturning(new Response('binary', { headers: { 'content-type': 'image/png' } })),
    });
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('content type');
  });

  it('appends a [truncated] note past the char cap', async () => {
    const big = 'x'.repeat(200_000);
    const ctx = makeCtx({
      fetchImpl: fetchReturning(new Response(big, { headers: { 'content-type': 'text/plain' } })),
    });
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx);
    expect(String(r.content)).toContain('[truncated]');
    expect(String(r.content).length).toBeLessThan(200_000);
  });

  it('follows a same-host redirect', async () => {
    const ctx = makeCtx({
      fetchImpl: fetchReturning(
        new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }),
        new Response('landed', { headers: { 'content-type': 'text/plain' } }),
      ),
    });
    const r = await webFetchTool.execute({ url: 'https://example.com/start', prompt: 'x' }, ctx);
    expect(r.isError).toBeUndefined();
    expect(String(r.content)).toContain('landed');
  });

  it('returns a hint (not an error) on a cross-host redirect', async () => {
    const ctx = makeCtx({
      fetchImpl: fetchReturning(
        new Response(null, { status: 301, headers: { location: 'https://other.example/x' } }),
      ),
    });
    const r = await webFetchTool.execute({ url: 'https://example.com/start', prompt: 'x' }, ctx);
    expect(r.isError).toBeUndefined();
    expect(String(r.content)).toContain('other.example');
    expect(String(r.content)).toContain('WebFetch again');
  });

  it('throws AbortError when ctx.signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, makeCtx({ signal: ac.signal })),
    ).rejects.toBeInstanceOf(AbortError);
  });

  it('throws AbortError when a hanging fetch is aborted by a short signal', async () => {
    const hanging: typeof fetch = ((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    const ctx = makeCtx({ fetchImpl: hanging, signal: AbortSignal.timeout(20) });
    await expect(
      webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx),
    ).rejects.toBeInstanceOf(AbortError);
  });

  // -- finding 7: body-size cap (Content-Length pre-check + streaming cap) ----

  it('rejects early on a Content-Length over the 5MB cap without reading the body', async () => {
    let bodyRead = false;
    // A hand-rolled body: reading only happens via getReader()/arrayBuffer(),
    // so the flag flips only if WebFetch actually consumes the body.
    const fakeBody = {
      getReader() {
        bodyRead = true;
        return {
          read: async () => ({ done: true, value: undefined }),
          cancel: async () => undefined,
        };
      },
    };
    const fake = {
      status: 200,
      statusText: 'OK',
      headers: new Headers({
        'content-type': 'text/plain',
        'content-length': String(6 * 1024 * 1024),
      }),
      body: fakeBody,
      async arrayBuffer() {
        bodyRead = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Response;
    const ctx = makeCtx({ fetchImpl: fetchReturning(fake) });
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('too large');
    expect(bodyRead).toBe(false);
  });

  it('stops reading a lying/oversized stream at the 5MB cap (memory bound)', async () => {
    let pulled = 0;
    const chunk = 256 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 20 * 1024 * 1024) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunk).fill(120)); // 'x'
        pulled += chunk;
      },
    });
    // No Content-Length header: the pre-check cannot help; the streaming cap must.
    const resp = new Response(stream, { headers: { 'content-type': 'text/plain' } });
    const ctx = makeCtx({ fetchImpl: fetchReturning(resp) });
    const r = await webFetchTool.execute({ url: 'https://example.com', prompt: 'x' }, ctx);
    expect(r.isError).toBeUndefined();
    expect(String(r.content)).toContain('[truncated]');
    // The reader is cancelled at the cap; before the fix arrayBuffer() drained
    // all 20MB into memory.
    expect(pulled).toBeLessThanOrEqual(5 * 1024 * 1024 + chunk);
  });

  // -- finding 8: IPv6-literal hostnames (URL keeps the brackets) -------------

  it('fetches a public IPv6 literal without a DNS lookup (bracket-stripped)', async () => {
    const impl = vi.fn(
      async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    );
    const ctx = makeCtx({ fetchImpl: impl as unknown as typeof fetch });
    const r = await webFetchTool.execute(
      { url: 'https://[2606:4700:4700::1111]/', prompt: 'x' },
      ctx,
    );
    expect(r.isError).toBeUndefined();
    expect(impl).toHaveBeenCalledTimes(1);
    // A literal must never be resolved via DNS; before the fix isIP() rejected
    // the bracketed form and the guard fell through to a lookup().
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('blocks a private IPv6 literal via the classifier without resolving DNS', async () => {
    const impl = vi.fn();
    const ctx = makeCtx({ fetchImpl: impl as unknown as typeof fetch });
    const r = await webFetchTool.execute({ url: 'https://[fc00::1]/', prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(impl).not.toHaveBeenCalled();
    // Before the fix the bracketed literal fell through to lookup() (which the
    // mock resolved to a PUBLIC address), so the private literal was NOT blocked.
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// finding 15: elicitation reply fallback must not leak an unhandled rejection
// ---------------------------------------------------------------------------

describe('HttpMcpConnection elicitation reply teardown (finding 15)', () => {
  it('does not emit an unhandled rejection when both reply posts fail on a closing connection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    let conn: HttpMcpConnection | undefined;
    // Closing the connection while resolving the elicitation makes BOTH the
    // result POST and the fallback decline POST reject with AbortError.
    const handler: ElicitationHandler = async () => {
      conn?.close();
      return { action: 'accept', content: {} };
    };

    const fakeFetch = vi.fn(async (_url: string, init: { body?: string }) => {
      const msg = JSON.parse(String(init.body)) as { id: unknown; method?: string };
      if (msg.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              serverInfo: { name: 'x', version: '1' },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (msg.method === 'tools/call') {
        const sse =
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: 'elic-1',
            method: 'elicitation/create',
            params: { message: 'm', requestedSchema: { type: 'object' } },
          })}\n\n` +
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: 'pong' }] },
          })}\n\n`;
        return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
      }
      // notifications/initialized and any reply posts (which never reach here
      // because close() short-circuits post()) get a bare 202.
      return new Response(null, { status: 202 });
    });

    vi.stubGlobal('fetch', fakeFetch);
    try {
      conn = new HttpMcpConnection(
        { type: 'http', url: 'https://mcp.example/' },
        { elicitation: handler },
      );
      await conn.connect();
      try {
        await conn.callTool('t', {});
      } catch {
        // callTool may reject once the connection is torn down; not the point.
      }
      // Give the detached decline-post time to reject and surface (if unhandled).
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(unhandled).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

// ---------------------------------------------------------------------------
// WebSearch
// ---------------------------------------------------------------------------

describe('webSearchTool', () => {
  it('returns isError when no backend is configured', async () => {
    const r = await webSearchTool.execute({ query: 'hello' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('not configured');
  });

  it('rejects a blank query', async () => {
    const r = await webSearchTool.execute({ query: '  ' }, makeCtx({ webSearch: async () => [] }));
    expect(r.isError).toBe(true);
  });

  it('passes a string backend result through verbatim', async () => {
    const ctx = makeCtx({ webSearch: async () => 'raw rendered results' });
    const r = await webSearchTool.execute({ query: 'x' }, ctx);
    expect(r.content).toBe('raw rendered results');
    expect(r.isError).toBeUndefined();
  });

  it('renders a WebSearchResult[] to a numbered list', async () => {
    const results: WebSearchResult[] = [
      { title: 'First', url: 'https://a.com/1', snippet: 'snip one' },
      { title: 'Second', url: 'https://b.com/2' },
    ];
    const ctx = makeCtx({ webSearch: async () => results });
    const r = await webSearchTool.execute({ query: 'x' }, ctx);
    const text = String(r.content);
    expect(text).toContain('1. First');
    expect(text).toContain('https://a.com/1');
    expect(text).toContain('snip one');
    expect(text).toContain('2. Second');
  });

  it('applies allowed_domains suffix filtering (subdomain + exact, drops others)', async () => {
    const results: WebSearchResult[] = [
      { title: 'exact', url: 'https://good.com/' },
      { title: 'sub', url: 'https://docs.good.com/' },
      { title: 'other', url: 'https://bad.com/' },
    ];
    const ctx = makeCtx({ webSearch: async () => results });
    const r = await webSearchTool.execute({ query: 'x', allowed_domains: ['good.com'] }, ctx);
    const text = String(r.content);
    expect(text).toContain('exact');
    expect(text).toContain('sub');
    expect(text).not.toContain('other');
  });

  it('applies blocked_domains filtering', async () => {
    const results: WebSearchResult[] = [
      { title: 'keep', url: 'https://ok.com/' },
      { title: 'drop', url: 'https://spam.com/' },
    ];
    const ctx = makeCtx({ webSearch: async () => results });
    const r = await webSearchTool.execute({ query: 'x', blocked_domains: ['spam.com'] }, ctx);
    const text = String(r.content);
    expect(text).toContain('keep');
    expect(text).not.toContain('drop');
  });

  it('reports "No results." when everything is filtered out', async () => {
    const ctx = makeCtx({ webSearch: async () => [{ title: 't', url: 'https://x.com/' }] });
    const r = await webSearchTool.execute({ query: 'x', allowed_domains: ['other.com'] }, ctx);
    expect(String(r.content)).toBe('No results.');
  });

  it('returns isError when the backend throws', async () => {
    const ctx = makeCtx({
      webSearch: async () => {
        throw new Error('backend down');
      },
    });
    const r = await webSearchTool.execute({ query: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('backend down');
  });

  it('propagates AbortError from the backend', async () => {
    const ctx = makeCtx({
      webSearch: async () => {
        throw new AbortError();
      },
    });
    await expect(webSearchTool.execute({ query: 'x' }, ctx)).rejects.toBeInstanceOf(AbortError);
  });
});

// ---------------------------------------------------------------------------
// AskUserQuestion
// ---------------------------------------------------------------------------

describe('askUserQuestionTool', () => {
  const oneQuestion = {
    questions: [
      { question: 'Pick a color?', header: 'Color', options: ['Red', 'Blue'] },
    ],
  };

  it('normalizes string and object options', async () => {
    let received: unknown;
    const ctx = makeCtx({
      askUser: async (qs) => {
        received = qs;
        return [{ header: 'Color', answers: ['Red'] }];
      },
    });
    await askUserQuestionTool.execute(
      {
        questions: [
          {
            question: 'Which?',
            header: 'Color',
            options: ['Red', { label: 'Blue', description: 'the sky' }],
          },
        ],
      },
      ctx,
    );
    expect(received).toEqual([
      {
        question: 'Which?',
        header: 'Color',
        options: [{ label: 'Red' }, { label: 'Blue', description: 'the sky' }],
        multiSelect: false,
      },
    ]);
  });

  it('rejects more than 4 questions', async () => {
    const many = { questions: Array.from({ length: 5 }, (_v, i) => ({
      question: `q${i}`,
      header: `h${i}`,
      options: ['a'],
    })) };
    const r = await askUserQuestionTool.execute(many, makeCtx({ askUser: async () => [] }));
    expect(r.isError).toBe(true);
  });

  it('rejects a question with a missing header', async () => {
    const r = await askUserQuestionTool.execute(
      { questions: [{ question: 'q', options: ['a'] }] },
      makeCtx({ askUser: async () => [] }),
    );
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('header');
  });

  it('returns isError when no handler is configured', async () => {
    const r = await askUserQuestionTool.execute(oneQuestion, makeCtx());
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('onUserQuestion');
  });

  it('treats a null answer as declined', async () => {
    const ctx = makeCtx({ askUser: async () => null });
    const r = await askUserQuestionTool.execute(oneQuestion, ctx);
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('declined');
  });

  it('treats a throwing handler as declined', async () => {
    const ctx = makeCtx({
      askUser: async () => {
        throw new Error('ui closed');
      },
    });
    const r = await askUserQuestionTool.execute(oneQuestion, ctx);
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('declined');
  });

  it('renders answers per header', async () => {
    const answers: UserQuestionAnswer[] = [
      { header: 'Color', answers: ['Red', 'Blue'] },
      { header: 'Size', answers: ['Large'] },
    ];
    const ctx = makeCtx({ askUser: async () => answers });
    const r = await askUserQuestionTool.execute(oneQuestion, ctx);
    expect(String(r.content)).toContain('Color: Red, Blue');
    expect(String(r.content)).toContain('Size: Large');
  });

  it('propagates AbortError from the handler', async () => {
    const ctx = makeCtx({
      askUser: async () => {
        throw new AbortError();
      },
    });
    await expect(askUserQuestionTool.execute(oneQuestion, ctx)).rejects.toBeInstanceOf(AbortError);
  });
});

// ---------------------------------------------------------------------------
// TodoWrite
// ---------------------------------------------------------------------------

describe('todoWriteTool', () => {
  it('renders a checklist with per-status glyphs and a count summary', async () => {
    const r = await todoWriteTool.execute(
      {
        todos: [
          { content: 'Write code', status: 'completed', activeForm: 'Writing code' },
          { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
          { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
        ],
      },
      makeCtx(),
    );
    const text = String(r.content);
    expect(text).toContain('Todos: 1 pending, 1 in progress, 1 completed.');
    expect(text).toContain('- [x] Write code');
    expect(text).toContain('- [~] Running tests'); // in_progress uses activeForm
    expect(text).toContain('- [ ] Ship it');
    expect(r.isError).toBeUndefined();
  });

  it('rejects a non-array todos', async () => {
    const r = await todoWriteTool.execute({ todos: 'nope' }, makeCtx());
    expect(r.isError).toBe(true);
  });

  it('rejects an invalid status', async () => {
    const r = await todoWriteTool.execute(
      { todos: [{ content: 'x', status: 'done', activeForm: 'x' }] },
      makeCtx(),
    );
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('status');
  });

  it('rejects an empty content', async () => {
    const r = await todoWriteTool.execute(
      { todos: [{ content: '', status: 'pending', activeForm: 'x' }] },
      makeCtx(),
    );
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain('content');
  });

  it('handles an empty list', async () => {
    const r = await todoWriteTool.execute({ todos: [] }, makeCtx());
    expect(String(r.content)).toContain('0 pending, 0 in progress, 0 completed');
    expect(r.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Elicitation
// ---------------------------------------------------------------------------

describe('resolveElicitation', () => {
  const signal = new AbortController().signal;

  it('parseElicitationParams applies defaults', () => {
    expect(parseElicitationParams(undefined)).toEqual({
      message: '',
      requestedSchema: { type: 'object' },
    });
    expect(parseElicitationParams({ message: 'hi', requestedSchema: { type: 'object', properties: {} } })).toEqual({
      message: 'hi',
      requestedSchema: { type: 'object', properties: {} },
    });
  });

  it('declines when no handler is provided', async () => {
    const r = await resolveElicitation({ message: 'm' }, undefined, signal);
    expect(r).toEqual({ action: 'decline' });
  });

  it('passes an accept result through with content', async () => {
    const handler = async (): Promise<ElicitationResult> => ({
      action: 'accept',
      content: { name: 'Ada' },
    });
    const r = await resolveElicitation({ message: 'm' }, handler, signal);
    expect(r).toEqual({ action: 'accept', content: { name: 'Ada' } });
  });

  it('passes decline and cancel through', async () => {
    const decline = await resolveElicitation(
      { message: 'm' },
      async () => ({ action: 'decline' }),
      signal,
    );
    expect(decline).toEqual({ action: 'decline' });
    const cancel = await resolveElicitation(
      { message: 'm' },
      async () => ({ action: 'cancel' }),
      signal,
    );
    expect(cancel).toEqual({ action: 'cancel' });
  });

  it('coerces accept-without-content to decline', async () => {
    const handler = async (): Promise<ElicitationResult> =>
      ({ action: 'accept' } as unknown as ElicitationResult);
    const r = await resolveElicitation({ message: 'm' }, handler, signal);
    expect(r).toEqual({ action: 'decline' });
  });

  it('declines when the handler throws', async () => {
    const handler = async (): Promise<ElicitationResult> => {
      throw new Error('boom');
    };
    const r = await resolveElicitation({ message: 'm' }, handler, signal);
    expect(r).toEqual({ action: 'decline' });
  });

  it('passes the parsed request and signal to the handler', async () => {
    let seen: unknown;
    let seenSignal: unknown;
    await resolveElicitation(
      { message: 'need input', requestedSchema: { type: 'object', properties: { a: {} } } },
      async (req, opts) => {
        seen = req;
        seenSignal = opts.signal;
        return { action: 'decline' };
      },
      signal,
    );
    expect(seen).toEqual({
      message: 'need input',
      requestedSchema: { type: 'object', properties: { a: {} } },
    });
    expect(seenSignal).toBe(signal);
  });
});
