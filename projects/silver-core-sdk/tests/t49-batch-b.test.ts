/**
 * T49 batch B regression locks — the 6 P0 existing-code high/security findings
 * of the 2026-07-17 100-defect audit
 * (Public-Info-Pool/Resource/repo-engineering/silver-core-sdk-bug-audit-20260717.md):
 *
 *   H1  Edit/MultiEdit corrupt the un-edited bytes of non-UTF-8 text files.
 *   H2  thinking wire form computed from config.model, not the live (fallback)
 *       model — cross-generation fallback 400s forever.
 *   H3  OpenAI arm keeps reading after finish_reason; a gateway dangling the
 *       [DONE] tail lets the idle watchdog void a fully received turn.
 *   H4  Tool-arg JSON truncated across delta chunks (routine max_tokens cut)
 *       threw at content_block_stop and killed the whole turn. Also carries
 *       the probe REFUTING the audited byte-split mechanism (parseSSE's
 *       streaming TextDecoder already handles multibyte splits).
 *   H5  Structured-output extraction validated only the FIRST parseable JSON
 *       span — a leading "legal but wrong" JSON hid the real answer.
 *   M17 Cross-protocol subagent transports memoized by protocol alone —
 *       a resolver shared across tenants handed tenant B tenant A's key.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { editTool } from '../src/tools/edit.js';
import { multiEditTool } from '../src/tools/multiedit.js';
import { runAgentLoop } from '../src/engine/loop.js';
import { MessageAccumulator, toolInputTruncationOf } from '../src/engine/accumulator.js';
import { evaluateStructuredOutput } from '../src/engine/structured-output.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { parseSSE } from '../src/transport/sse.js';
import { createSubagentTransportResolver } from '../src/subagents/transport-resolver.js';
import { APIStatusError } from '../src/errors.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
  PermissionGate,
  StreamRequest,
  ToolContext,
  Transport,
} from '../src/internal/contracts.js';
import type {
  ApiKeySource,
  APIMessageParam,
  CallToolResult,
  McpServerStatus,
  RawMessageStreamEvent,
  SDKMessage,
  SDKResultMessage,
  SubagentTransportHandle,
  SubagentTransportRequest,
} from '../src/types.js';
import { MockTransport } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Shared minimal engine fakes (mirrors engine.test.ts)
// ---------------------------------------------------------------------------

class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'unexpected mcp call' }], isError: true };
  }
  async reconnect(): Promise<void> {}
  setEnabled(): void {}
  async closeAll(): Promise<void> {}
}

const allowAllGate: PermissionGate = {
  async check(_t, input) {
    return { decision: 'allow', updatedInput: input };
  },
  setMode() {},
  getMode() {
    return 'default';
  },
  applyUpdates() {},
  denials() {
    return [];
  },
};

const noHooks: HookRunner = {
  hasHooks() {
    return false;
  },
  async run() {
    return { continue: true, systemMessages: [], additionalContext: [] };
  },
};

function makeDeps(transport: Transport, builtinTools = new Map<string, BuiltinTool>()): EngineDeps {
  return {
    transport,
    builtinTools,
    mcp: new FakeMcp(),
    permissions: allowAllGate,
    hooks: noHooks,
    toolContext: {
      cwd: '/tmp/t49-batch-b',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-test-1',
    maxOutputTokens: 8192,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-t49b',
    cwd: '/tmp/t49-batch-b',
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

function lastResult(messages: SDKMessage[]): SDKResultMessage {
  const last = messages[messages.length - 1];
  expect(last?.type).toBe('result');
  return last as SDKResultMessage;
}

// ---------------------------------------------------------------------------
// H1 — Edit/MultiEdit refuse non-UTF-8 text files instead of corrupting them
// ---------------------------------------------------------------------------

describe('H1: Edit/MultiEdit non-UTF-8 corruption guard', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 't49-h1-'));
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  function ctx(): ToolContext {
    return {
      cwd: sandbox,
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
    };
  }

  /** ISO-8859-1 "café" + CRLF line: 0xE9 is NOT valid UTF-8 and has no NUL,
   *  so it passes the binary sniff but decodes lossily. */
  const LATIN1 = Buffer.from([
    0x63, 0x61, 0x66, 0xe9, 0x20, 0x6d, 0x65, 0x6e, 0x75, 0x0a, // "caf\xE9 menu\n"
    0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0a, // "hello\n"
  ]);

  it('Edit refuses a Latin-1 file and leaves its bytes untouched', async () => {
    const file = path.join(sandbox, 'latin1.txt');
    await writeFile(file, LATIN1);
    const res = await editTool.execute(
      { file_path: file, old_string: 'hello', new_string: 'goodbye' },
      ctx(),
    );
    expect(res.isError).toBe(true);
    expect(String(res.content)).toContain('not valid UTF-8');
    expect((await readFile(file)).equals(LATIN1)).toBe(true);
  });

  it('MultiEdit refuses a Latin-1 file and leaves its bytes untouched', async () => {
    const file = path.join(sandbox, 'latin1.txt');
    await writeFile(file, LATIN1);
    const res = await multiEditTool.execute(
      { file_path: file, edits: [{ old_string: 'hello', new_string: 'goodbye' }] },
      ctx(),
    );
    expect(res.isError).toBe(true);
    expect(String(res.content)).toContain('not valid UTF-8');
    expect((await readFile(file)).equals(LATIN1)).toBe(true);
  });

  it('control: a valid UTF-8 file with multibyte text still edits fine', async () => {
    const file = path.join(sandbox, 'utf8.txt');
    await writeFile(file, '角色:艾瑞卡\nhello\n', 'utf8');
    const res = await editTool.execute(
      { file_path: file, old_string: 'hello', new_string: 'goodbye' },
      ctx(),
    );
    expect(res.isError).toBeUndefined();
    expect(await readFile(file, 'utf8')).toBe('角色:艾瑞卡\ngoodbye\n');
  });
});

// ---------------------------------------------------------------------------
// H2 — thinking wire form follows the LIVE model across a fallback switch
// ---------------------------------------------------------------------------

describe('H2: thinking form recomputed for the fallback model', () => {
  function baseMessage(model: string): RawMessageStreamEvent {
    return {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    };
  }

  function textReply(model: string): RawMessageStreamEvent[] {
    return [
      baseMessage(model),
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 },
      },
      { type: 'message_stop' },
    ];
  }

  class FallbackTransport implements Transport {
    readonly requests: StreamRequest[] = [];
    private call = 0;
    apiKeySource(): ApiKeySource {
      return 'user';
    }
    async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
      this.requests.push(req);
      if (this.call++ === 0) {
        throw new APIStatusError(529, 'overloaded_error', 'overloaded');
      }
      yield* (async function* (events: RawMessageStreamEvent[]) {
        for (const ev of events) yield ev;
      })(textReply(req.model));
    }
  }

  it('adaptive-gen main + pre-adaptive fallback: the fallback request carries budget_tokens, not adaptive', async () => {
    const transport = new FallbackTransport();
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(
      runAgentLoop(
        history,
        makeDeps(transport),
        makeConfig({
          model: 'claude-fable-5',
          fallbackModel: 'claude-haiku-4-5',
          thinking: { type: 'adaptive' },
        }),
      ),
    );
    expect(lastResult(messages).subtype).toBe('success');
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]!.thinking).toEqual({ type: 'adaptive' });
    const fallbackThinking = transport.requests[1]!.thinking as {
      type: string;
      budget_tokens?: number;
    };
    expect(fallbackThinking.type).toBe('enabled');
    expect(fallbackThinking.budget_tokens).toBeGreaterThanOrEqual(1024);
  });

  it('pre-adaptive main + adaptive-gen fallback: the fallback request carries adaptive, not budget_tokens', async () => {
    const transport = new FallbackTransport();
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(
      runAgentLoop(
        history,
        makeDeps(transport),
        makeConfig({
          model: 'claude-haiku-4-5',
          fallbackModel: 'claude-fable-5',
          thinking: { type: 'enabled', budgetTokens: 2048 },
        }),
      ),
    );
    expect(lastResult(messages).subtype).toBe('success');
    expect(transport.requests).toHaveLength(2);
    expect((transport.requests[0]!.thinking as { type: string }).type).toBe('enabled');
    expect(transport.requests[1]!.thinking).toEqual({ type: 'adaptive' });
  });
});

// ---------------------------------------------------------------------------
// H3 — OpenAI arm: a post-finish_reason connection failure completes the turn
// ---------------------------------------------------------------------------

describe('H3: OpenAI post-finish_reason dangle completes instead of voiding the turn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const enc = new TextEncoder();

  function sse(payloads: Array<Record<string, unknown>>): string {
    return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('');
  }

  /** A body that delivers `head` then hangs forever (gateway dangling the
   *  [DONE]/usage tail while holding the socket open). */
  function hangingBody(head: string): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(head));
        // never close, never enqueue again
      },
    });
  }

  /** A body that delivers `head` then errors (reset while awaiting the tail). */
  function droppingBody(head: string): ReadableStream<Uint8Array> {
    let delivered = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!delivered) {
          delivered = true;
          controller.enqueue(enc.encode(head));
        } else {
          controller.error(new Error('ECONNRESET'));
        }
      },
    });
  }

  const FINISHED_HEAD = sse([
    {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [{ delta: { role: 'assistant', content: 'done answer' } }],
    },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]);

  function transportWith(body: ReadableStream<Uint8Array>, idleMs: number): OpenAIChatTransport {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
    return new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'k', streamIdleTimeoutMs: idleMs },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => {},
    });
  }

  async function collectRaw(
    gen: AsyncGenerator<RawMessageStreamEvent, void>,
  ): Promise<RawMessageStreamEvent[]> {
    const out: RawMessageStreamEvent[] = [];
    for await (const ev of gen) out.push(ev);
    return out;
  }

  const REQ: StreamRequest = {
    model: 'gpt-4o',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('idle watchdog firing on the dangling tail completes the received turn', async () => {
    const transport = transportWith(hangingBody(FINISHED_HEAD), 40);
    const events = await collectRaw(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
    const acc = new MessageAccumulator();
    for (const ev of events) acc.feed(ev);
    const msg = acc.finalize();
    expect(msg.content).toEqual([{ type: 'text', text: 'done answer' }]);
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('a connection reset while awaiting the tail completes the received turn', async () => {
    const transport = transportWith(droppingBody(FINISHED_HEAD), 0);
    const events = await collectRaw(transport.stream(REQ));
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('control: an idle stall BEFORE finish_reason still fails the stream', async () => {
    const noFinishHead = sse([
      {
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [{ delta: { role: 'assistant', content: 'partial' } }],
      },
    ]);
    const transport = transportWith(hangingBody(noFinishHead), 40);
    await expect(collectRaw(transport.stream(REQ))).rejects.toThrow(/idle/);
  });
});

// ---------------------------------------------------------------------------
// H4 — truncated tool-arg JSON degrades gracefully instead of voiding the turn
// ---------------------------------------------------------------------------

describe('H4: tool args truncated across delta chunks', () => {
  function truncatedToolTurn(stopReason: 'max_tokens' | 'tool_use'): RawMessageStreamEvent[] {
    return [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-test-1',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Writing…' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_cut', name: 'Read', input: {} },
      },
      // The args JSON is cut across delta chunks — the second half never arrives.
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"file_path": "/etc/' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 30 },
      },
      { type: 'message_stop' },
    ];
  }

  function fakeReadTool(executed: Array<Record<string, unknown>>): BuiltinTool {
    return {
      name: 'Read',
      description: 'fake read',
      inputSchema: { type: 'object' },
      readOnly: true,
      async execute(input) {
        executed.push(input);
        return { content: 'data' };
      },
    };
  }

  it('a max_tokens cut mid-args completes the turn as success and never executes the tool', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const transport = new MockTransport([truncatedToolTurn('max_tokens')]);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(
      runAgentLoop(
        history,
        makeDeps(transport, new Map([['Read', fakeReadTool(executed)]])),
        makeConfig(),
      ),
    );
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.stop_reason).toBe('max_tokens');
    expect(executed).toHaveLength(0);
    // C6 orphan filter: the truncated tool_use never persists unpaired.
    const assistantTurns = history.filter((m) => m.role === 'assistant');
    for (const turn of assistantTurns) {
      const blocks = Array.isArray(turn.content) ? turn.content : [];
      expect(blocks.some((b) => (b as { type?: string }).type === 'tool_use')).toBe(false);
    }
  });

  it('a stop_reason tool_use turn with truncated args fails diagnosably without executing', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const transport = new MockTransport([truncatedToolTurn('tool_use')]);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(
      runAgentLoop(
        history,
        makeDeps(transport, new Map([['Read', fakeReadTool(executed)]])),
        makeConfig(),
      ),
    );
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    expect((result as { error_code?: string }).error_code).toBe('tool_input_truncated');
    expect(result.errorMessage).toContain('toolu_cut');
    expect(executed).toHaveLength(0);
  });

  it('salvage never emits a truncated-input tool_use as executable', () => {
    const acc = new MessageAccumulator();
    const events = truncatedToolTurn('max_tokens');
    // Feed everything up to and including the tool block's stop, then salvage
    // (as the engine does for a mid-stream truncation).
    for (const ev of events.slice(0, 7)) acc.feed(ev);
    const salvaged = acc.salvageTruncated();
    expect(salvaged).toBeDefined();
    const kinds = salvaged!.content.map((b) => b.type);
    expect(kinds).toContain('text');
    expect(kinds).not.toContain('tool_use');
  });

  it('refutation probe: parseSSE reassembles a multibyte char split across raw chunks', async () => {
    // The audit's stated H4 mechanism ("multibyte char cut at the delta
    // boundary -> invalid JSON") does not occur at the SSE layer: the
    // streaming TextDecoder carries partial sequences across reads.
    const payload = 'data: {"t":"好的"}\n\n';
    const bytes = new TextEncoder().encode(payload);
    // Split INSIDE the 3-byte encoding of 好 (offset of 好 is 11: `data: {"t":"`).
    const cut = 13;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const frames: Array<{ data: string }> = [];
    for await (const frame of parseSSE(body)) frames.push(frame);
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!.data)).toEqual({ t: '好的' });
  });
});

// ---------------------------------------------------------------------------
// H5 — structured-output extraction is schema-aware
// ---------------------------------------------------------------------------

describe('H5: schema-aware structured-output extraction', () => {
  const SCHEMA = {
    type: 'object',
    required: ['answer'],
    properties: { answer: { type: 'integer' } },
    additionalProperties: false,
  };

  it('a leading legal-but-wrong JSON no longer hides the valid answer', () => {
    const text = 'Note {"note":"x"} first, then the result: {"answer":42}';
    const outcome = evaluateStructuredOutput(text, SCHEMA);
    expect(outcome.status).toBe('valid');
    expect((outcome as { value: unknown }).value).toEqual({ answer: 42 });
  });

  it('a fenced wrong candidate is skipped in favor of a later valid span', () => {
    const text = 'meta:\n```json\n{"note":"x"}\n```\nfinal: {"answer":7}';
    const outcome = evaluateStructuredOutput(text, SCHEMA);
    expect(outcome.status).toBe('valid');
    expect((outcome as { value: unknown }).value).toEqual({ answer: 7 });
  });

  it('when nothing validates, violations of the first candidate are reported', () => {
    const outcome = evaluateStructuredOutput('{"note":"x"}', SCHEMA);
    expect(outcome.status).toBe('invalid');
    expect((outcome as { summary: string }).summary).toContain('schema violation');
    expect((outcome as { summary: string }).summary).toContain('answer');
  });

  it('non-JSON text still reports the not-JSON reason', () => {
    const outcome = evaluateStructuredOutput('no json here at all', SCHEMA);
    expect(outcome.status).toBe('invalid');
    expect((outcome as { summary: string }).summary).toContain('not valid JSON');
  });

  it('a whole-text valid answer keeps working (direct parse path)', () => {
    const outcome = evaluateStructuredOutput('  {"answer": 5} ', SCHEMA);
    expect(outcome.status).toBe('valid');
    expect((outcome as { value: unknown }).value).toEqual({ answer: 5 });
  });
});

// ---------------------------------------------------------------------------
// M17 — cross-protocol transport memoization keyed by tenant identity
// ---------------------------------------------------------------------------

describe('M17: subagent transport memo carries tenant identity', () => {
  const asHandle = (t: Transport): SubagentTransportHandle =>
    t as unknown as SubagentTransportHandle;

  const request = (
    over: Partial<SubagentTransportRequest> = {},
  ): SubagentTransportRequest => ({
    model: 'bailian/deepseek-v4',
    purpose: 'subagent',
    parentModel: 'azure/gpt-parent',
    parentProtocol: 'openai-chat',
    parentTransport: asHandle(new MockTransport([])),
    parentProvider: { protocol: 'openai-chat' },
    env: { ANTHROPIC_API_KEY: 'tenant-a-key' },
    fork: false,
    debug: () => {},
    ...over,
  });
  const routing = (m: string): 'anthropic' | 'openai-chat' =>
    m.startsWith('azure/') ? 'openai-chat' : 'anthropic';

  it('different credential env chains get DIFFERENT transports (no cross-tenant reuse)', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const a = await resolve(request({ env: { ANTHROPIC_API_KEY: 'tenant-a-key' } }));
    const b = await resolve(request({ env: { ANTHROPIC_API_KEY: 'tenant-b-key' } }));
    expect(a?.transport).toBeDefined();
    expect(b?.transport).toBeDefined();
    expect(b?.transport).not.toBe(a?.transport);
  });

  it('different explicit per-protocol baseUrls do not collide either', async () => {
    const resolveA = createSubagentTransportResolver({
      protocolForModel: routing,
      providers: { anthropic: { baseUrl: 'https://gw-a.example' } },
    });
    const a1 = await resolveA(request());
    const a2 = await resolveA(request());
    // Same identity still memoizes...
    expect(a2?.transport).toBe(a1?.transport);
    // ...while a differently-configured resolver builds its own instance.
    const resolveB = createSubagentTransportResolver({
      protocolForModel: routing,
      providers: { anthropic: { baseUrl: 'https://gw-b.example' } },
    });
    const b = await resolveB(request());
    expect(b?.transport).not.toBe(a1?.transport);
  });

  it('identical tenant identity keeps the warm-pool memoization', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const first = await resolve(request());
    const second = await resolve(request({ model: 'bailian/qwen-x' }));
    expect(second?.transport).toBe(first?.transport);
  });

  it('function-valued knobs (fetch) distinguish tenants by identity', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const fetchA = async (): Promise<Response> => new Response();
    const fetchB = async (): Promise<Response> => new Response();
    const a = await resolve(
      request({ parentProvider: { protocol: 'openai-chat', fetch: fetchA } }),
    );
    const b = await resolve(
      request({ parentProvider: { protocol: 'openai-chat', fetch: fetchB } }),
    );
    const a2 = await resolve(
      request({ parentProvider: { protocol: 'openai-chat', fetch: fetchA } }),
    );
    expect(b?.transport).not.toBe(a?.transport);
    expect(a2?.transport).toBe(a?.transport);
  });
});
