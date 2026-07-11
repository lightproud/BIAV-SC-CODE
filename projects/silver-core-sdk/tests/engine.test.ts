/**
 * Module B (engine) test suite: MessageAccumulator, pricing helpers and
 * runAgentLoop. Transport is the scripted MockTransport; permission gate,
 * hook runner and MCP registry are minimal recordable fakes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageAccumulator } from '../src/engine/accumulator.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import {
  addUsage,
  estimateCostUsd,
  hasPriceFor,
  normalizeUsage,
} from '../src/engine/pricing.js';
import { runAgentLoop, TURN_REPLAY_LIMIT } from '../src/engine/loop.js';
import { AbortError, APIConnectionError, APIStatusError } from '../src/errors.js';
import type {
  AggregatedHookResult,
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
  PermissionCheckResult,
  PermissionGate,
  StreamRequest,
  ToolResultPayload,
  Transport,
} from '../src/internal/contracts.js';
import type {
  ApiKeySource,
  APIMessageParam,
  CallToolResult,
  ContentBlockParam,
  HookEvent,
  HookInput,
  McpServerStatus,
  NonNullableUsage,
  PermissionMode,
  PermissionUpdate,
  RawMessageStreamEvent,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDenial,
  SDKResultMessage,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';
import { stampSigningModel } from '../src/engine/thinking-provenance.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type GateCall = {
  toolName: string;
  input: Record<string, unknown>;
  opts: {
    toolUseID: string;
    readOnly: boolean;
    isFileEdit: boolean;
    hook?: { decision?: 'allow' | 'deny' | 'ask'; reason?: string; updatedInput?: Record<string, unknown> };
    decisionReason?: string;
  };
};

/** Allow-everything gate; can be told to deny specific tools; simulates the
 * real gate's step 1 (hook deny wins) so the loop's hook wiring is observable. */
class FakeGate implements PermissionGate {
  readonly calls: GateCall[] = [];
  private mode: PermissionMode = 'default';
  private readonly denyMessages = new Map<string, string>();
  private readonly recorded: SDKPermissionDenial[] = [];

  denyTool(name: string, message: string): void {
    this.denyMessages.set(name, message);
  }

  async check(
    toolName: string,
    input: Record<string, unknown>,
    opts: GateCall['opts'] & { signal: AbortSignal },
  ): Promise<PermissionCheckResult> {
    this.calls.push({
      toolName,
      input,
      opts: {
        toolUseID: opts.toolUseID,
        readOnly: opts.readOnly,
        isFileEdit: opts.isFileEdit,
        hook: opts.hook,
        decisionReason: opts.decisionReason,
      },
    });
    // Step 1 of the documented pipeline: hook deny -> deny.
    if (opts.hook?.decision === 'deny') {
      this.recorded.push({ tool_name: toolName, tool_use_id: opts.toolUseID, tool_input: input });
      return {
        decision: 'deny',
        message: `Hook denied ${toolName}: ${opts.hook.reason ?? 'no reason'}`,
      };
    }
    const denyMessage = this.denyMessages.get(toolName);
    if (denyMessage !== undefined) {
      this.recorded.push({ tool_name: toolName, tool_use_id: opts.toolUseID, tool_input: input });
      return { decision: 'deny', message: denyMessage };
    }
    return { decision: 'allow', updatedInput: opts.hook?.updatedInput ?? input };
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }
  getMode(): PermissionMode {
    return this.mode;
  }
  applyUpdates(_updates: PermissionUpdate[]): void {
    // no-op
  }
  denials(): SDKPermissionDenial[] {
    return [...this.recorded];
  }
}

type HookScript = Partial<AggregatedHookResult>;

/** No-hooks by default; hasHooks() is true only for scripted events. */
class FakeHookRunner implements HookRunner {
  readonly runs: Array<{
    event: HookEvent;
    input: HookInput;
    toolUseID: string | undefined;
    matchValue: string | undefined;
  }> = [];

  constructor(private readonly scripts: Partial<Record<HookEvent, HookScript>> = {}) {}

  hasHooks(event: HookEvent): boolean {
    return this.scripts[event] !== undefined;
  }

  async run(
    event: HookEvent,
    input: HookInput,
    toolUseID: string | undefined,
    matchValue: string | undefined,
    _signal: AbortSignal,
  ): Promise<AggregatedHookResult> {
    this.runs.push({ event, input, toolUseID, matchValue });
    const s = this.scripts[event] ?? {};
    return {
      continue: s.continue ?? true,
      stopReason: s.stopReason,
      systemMessages: s.systemMessages ?? [],
      decision: s.decision,
      decisionReason: s.decisionReason,
      updatedInput: s.updatedInput,
      additionalContext: s.additionalContext ?? [],
      updatedToolOutput: s.updatedToolOutput,
    };
  }
}

/** Empty MCP registry (no servers, no tools). */
class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(_qualifiedName: string): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'unexpected mcp call' }], isError: true };
  }
  async reconnect(_serverName: string): Promise<void> {}
  setEnabled(_serverName: string, _enabled: boolean): void {}
  async closeAll(): Promise<void> {}
}

function makeFakeReadTool(
  executedInputs: Array<Record<string, unknown>>,
  payload: ToolResultPayload = { content: 'file content here' },
): BuiltinTool {
  return {
    name: 'Read',
    description: 'fake read tool',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
    readOnly: true,
    async execute(input) {
      executedInputs.push(input);
      return payload;
    },
  };
}

function makeDeps(
  transport: Transport,
  overrides: {
    builtinTools?: Map<string, BuiltinTool>;
    permissions?: PermissionGate;
    hooks?: HookRunner;
    signal?: AbortSignal;
  } = {},
): EngineDeps {
  return {
    transport,
    builtinTools: overrides.builtinTools ?? new Map(),
    mcp: new FakeMcp(),
    permissions: overrides.permissions ?? new FakeGate(),
    hooks: overrides.hooks ?? new FakeHookRunner(),
    toolContext: {
      cwd: '/tmp/engine-test',
      additionalDirectories: [],
      env: { BPT_HTTP_CLIENT: 'fetch' },
      signal: overrides.signal ?? new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-test-1',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-test',
    cwd: '/tmp/engine-test',
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
// MessageAccumulator
// ---------------------------------------------------------------------------

describe('MessageAccumulator', () => {
  function startEvent(
    model = 'claude-test-1',
    usage: Partial<NonNullableUsage> = {},
  ): RawMessageStreamEvent {
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
        usage: {
          input_tokens: usage.input_tokens ?? 10,
          output_tokens: usage.output_tokens ?? 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        },
      },
    };
  }

  it('assembles text from multiple text_delta events', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello, ' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'wor' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ld' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    acc.feed({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    });
    acc.feed({ type: 'message_stop' });

    const msg = acc.finalize();
    expect(msg.content).toEqual([{ type: 'text', text: 'Hello, world' }]);
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.model).toBe('claude-test-1');
  });

  it('S2: collects citations_delta onto the text block instead of dropping it', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'cited' } });
    acc.feed({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'citations_delta', citation: { type: 'char_location', start: 0 } },
    } as unknown as RawMessageStreamEvent);
    acc.feed({ type: 'content_block_stop', index: 0 });
    acc.feed({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
    acc.feed({ type: 'message_stop' });
    const block = acc.finalize().content[0] as { type: string; text: string; citations?: unknown[] };
    expect(block.text).toBe('cited');
    expect(block.citations).toEqual([{ type: 'char_location', start: 0 }]);
  });

  it('S3: a missing partial_json fragment does not poison the tool input with "undefined"', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
    });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/a"}' } });
    // a non-conformant trailing frame with no partial_json
    acc.feed({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta' },
    } as unknown as RawMessageStreamEvent);
    acc.feed({ type: 'content_block_stop', index: 0 });
    acc.feed({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 2 } });
    acc.feed({ type: 'message_stop' });
    const block = acc.finalize().content[0] as { type: string; input: unknown };
    expect(block.input).toEqual({ file_path: '/a' }); // no "undefined" corruption -> parses cleanly
  });

  it('parses tool_use input_json_delta split across chunks', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
    });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'path":"/a' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '.txt","limit":5}' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    acc.feed({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 3 },
    });

    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.txt', limit: 5 } },
    ]);
    expect(msg.stop_reason).toBe('tool_use');
  });

  it('seeds {} input when no input_json_delta arrives', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_2', name: 'NoArgs', input: {} },
    });
    acc.feed({ type: 'content_block_stop', index: 0 });

    const msg = acc.finalize();
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'toolu_2', name: 'NoArgs', input: {} },
    ]);
  });

  it('message_delta replaces output_tokens and keeps max of input-side fields', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent('claude-test-1', { input_tokens: 40, output_tokens: 1 }));
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    // First delta: output replaces, lower input must NOT shrink the seed.
    acc.feed({
      type: 'message_delta',
      delta: { stop_reason: null, stop_sequence: null },
      usage: { output_tokens: 9, input_tokens: 12 },
    });
    // Second delta: output replaces again, larger input wins.
    acc.feed({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: 'STOP' },
      usage: { output_tokens: 21, input_tokens: 55 },
    });

    const msg = acc.finalize();
    expect(msg.usage.output_tokens).toBe(21);
    expect(msg.usage.input_tokens).toBe(55);
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.stop_sequence).toBe('STOP');
  });

  it('throws APIConnectionError on events before message_start', () => {
    const acc = new MessageAccumulator();
    expect(() =>
      acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ).toThrow(APIConnectionError);
  });

  it('throws APIConnectionError on a delta for an unopened block index', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    expect(() =>
      acc.feed({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'x' } }),
    ).toThrow(APIConnectionError);
  });

  it('throws APIConnectionError on a delta-type/block-type mismatch', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_3', name: 'Read', input: {} },
    });
    expect(() =>
      acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'nope' } }),
    ).toThrow(APIConnectionError);
  });

  it('throws APIConnectionError when accumulated tool input JSON is malformed', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_4', name: 'Read', input: {} },
    });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } });
    expect(() => acc.feed({ type: 'content_block_stop', index: 0 })).toThrow(APIConnectionError);
  });

  it('throws APIConnectionError on finalize without message_start', () => {
    const acc = new MessageAccumulator();
    expect(() => acc.finalize()).toThrow(APIConnectionError);
  });
});

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

describe('pricing', () => {
  const MTOK = 1_000_000;

  it('estimateCostUsd prices the opus family exactly', () => {
    const usage: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    };
    // 15 + 75 + 18.75 + 1.5 = 110.25 (all binary-exact rates)
    expect(estimateCostUsd('claude-opus-4-20250514', usage)).toBe(110.25);
  });

  it('estimateCostUsd prices the sonnet family per the documented rates', () => {
    const usage: NonNullableUsage = {
      input_tokens: 2_000_000,
      output_tokens: 500_000,
      cache_creation_input_tokens: 400_000,
      cache_read_input_tokens: 100_000,
    };
    const expected =
      (2_000_000 * 3 + 500_000 * 15 + 400_000 * 3.75 + 100_000 * 0.3) / MTOK;
    expect(estimateCostUsd('claude-sonnet-4-5', usage)).toBe(expected);
  });

  it('estimateCostUsd prices the haiku family per the documented rates', () => {
    const usage: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 2_000_000,
      cache_creation_input_tokens: 4_000_000,
      cache_read_input_tokens: 10_000_000,
    };
    const expected =
      (1_000_000 * 1 + 2_000_000 * 5 + 4_000_000 * 1.25 + 10_000_000 * 0.1) / MTOK;
    expect(estimateCostUsd('claude-haiku-3-5-20241022', usage)).toBe(expected);
  });

  it('provider.pricing overrides price unknown models and win over the table (audit P1-4)', () => {
    const usage: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    };
    const overrides = {
      'gpt-4o': { input: 2.5, output: 10 },
      'claude-haiku-': { input: 2, output: 10, cacheRead: 0.2 },
    };
    // Unknown-to-the-table model priced via override; cacheRead defaults to input x0.1.
    expect(estimateCostUsd('gpt-4o-2024-11-20', usage, '5m', overrides)).toBe(
      2.5 + 10 + 0.25,
    );
    // Override WINS over the static haiku entry (1/5/0.1 -> 2/10/0.2).
    expect(estimateCostUsd('claude-haiku-4-5', usage, '5m', overrides)).toBe(
      2 + 10 + 0.2,
    );
    expect(hasPriceFor('gpt-4o-mini', { 'gpt-4o': { input: 1, output: 2 } })).toBe(true);
    expect(hasPriceFor('gpt-4o-mini')).toBe(false);
    expect(hasPriceFor('claude-sonnet-4-5')).toBe(true);
  });

  it('estimateCostUsd returns 0 for unknown model ids', () => {
    const usage: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(estimateCostUsd('gpt-4o', usage)).toBe(0);
    // Old-style id does not match the documented 'claude-opus-' prefix.
    expect(estimateCostUsd('claude-3-opus-latest', usage)).toBe(0);
    expect(estimateCostUsd('', usage)).toBe(0);
  });

  // ----- BPT audit 2026-07-07: pricing fixes (C1 / S1 / S5) -----

  it('C1: a 1h cache write is billed at 2x base, not the 5m 1.25x rate', () => {
    const usage: NonNullableUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
    };
    // opus base input = 15; 5m = 15*1.25 = 18.75, 1h = 15*2 = 30
    expect(estimateCostUsd('claude-opus-4-8', usage, '5m')).toBe(18.75);
    expect(estimateCostUsd('claude-opus-4-8', usage, '1h')).toBe(30);
    // default (omitted) stays the 5m rate — byte-compatible with old callers
    expect(estimateCostUsd('claude-opus-4-8', usage)).toBe(18.75);
  });

  it('S1: cloud-provider model ids (Bedrock / Vertex) still price (not $0)', () => {
    const usage: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(estimateCostUsd('us.anthropic.claude-opus-4-8', usage)).toBe(15);
    expect(estimateCostUsd('anthropic.claude-sonnet-4-5', usage)).toBe(3);
    expect(estimateCostUsd('claude-haiku-4-5@vertex', usage)).toBe(1);
    // Cross-region inference-profile prefixes (NOT two letters) must price too,
    // or maxBudgetUsd is silently unenforceable on them.
    expect(estimateCostUsd('apac.anthropic.claude-opus-4-8', usage)).toBe(15);
    expect(estimateCostUsd('global.anthropic.claude-sonnet-4-5', usage)).toBe(3);
    expect(estimateCostUsd('us-gov.anthropic.claude-opus-4-8', usage)).toBe(15);
    expect(hasPriceFor('apac.anthropic.claude-opus-4-8')).toBe(true);
    expect(hasPriceFor('global.anthropic.claude-sonnet-4-5')).toBe(true);
  });

  it('S5: claude-fable-* prices instead of costing $0', () => {
    const usage: NonNullableUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    // fable input 10 + output 50 = 60
    expect(estimateCostUsd('claude-fable-5', usage)).toBe(60);
  });

  it('normalizeUsage maps null/undefined cache fields to 0', () => {
    expect(
      normalizeUsage({
        input_tokens: 5,
        output_tokens: 3,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: undefined,
      }),
    ).toEqual({
      input_tokens: 5,
      output_tokens: 3,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(normalizeUsage({ input_tokens: 1, output_tokens: 2 })).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it('addUsage sums field-wise', () => {
    const a: NonNullableUsage = {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 4,
    };
    const b: NonNullableUsage = {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 40,
    };
    expect(addUsage(a, b)).toEqual({
      input_tokens: 11,
      output_tokens: 22,
      cache_creation_input_tokens: 33,
      cache_read_input_tokens: 44,
    });
  });
});

// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------

describe('runAgentLoop empty-stream self-heal (transport-level retry)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Regression for the idealab concurrent-fan-out crash: an HTTP 200 with a
  // zero-event SSE body used to fall through to accumulator.finalize() and
  // throw a raw `Protocol error: finalize before message_start`, crashing the
  // turn (and, for subagents on the same transport, the whole child). The
  // transport now retries the replay-safe empty stream internally, so the loop
  // self-heals with no host involvement.
  it('an empty first stream self-heals: the loop retries and yields the assistant reply', async () => {
    // Pin backoff jitter so the single empty-stream retry waits ~500ms.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // 1st fetch: 200 + empty SSE body (zero events). 2nd: a normal text reply.
    const fetch = makeSSEFetch([[], textReplyEvents('Hello world')]);
    vi.stubGlobal('fetch', fetch);
    const transport = new AnthropicTransport({
      provider: { apiKey: 'k' },
      env: { BPT_HTTP_CLIENT: 'fetch' },
      debug: () => {},
    });
    const deps = makeDeps(transport);
    const history = [{ role: 'user' as const, content: 'hi' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    const assistant = messages.find((m) => m.type === 'assistant') as
      | SDKAssistantMessage
      | undefined;
    expect(assistant).toBeDefined();
    expect(assistant!.message.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('Hello world');
    // The empty stream + the healed retry = exactly two fetches, one turn.
    expect(fetch.requests).toHaveLength(2);
    expect(result.num_turns).toBe(1);
    // The empty-stream retry surfaced an api_retry observability message.
    expect(messages.some((m) => m.type === 'api_retry')).toBe(true);
  });
});

describe('runAgentLoop', () => {
  it('happy path: yields assistant message then a success result', async () => {
    const transport = new MockTransport([textReplyEvents('Hello world')]);
    const deps = makeDeps(transport);
    const history = [{ role: 'user' as const, content: 'hi' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(messages).toHaveLength(2);
    expect(messages[0]!.type).toBe('assistant');
    const assistant = messages[0] as SDKAssistantMessage;
    expect(assistant.session_id).toBe('sess-test');
    expect(assistant.parent_tool_use_id).toBeNull();
    expect(assistant.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(assistant.message.content).toEqual([{ type: 'text', text: 'Hello world' }]);

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype !== 'success') return;
    expect(result.is_error).toBe(false);
    expect(result.result).toBe('Hello world');
    expect(result.num_turns).toBe(1);
    // message_start seeds input 25; message_delta replaces output with 7.
    expect(result.usage).toEqual({
      input_tokens: 25,
      output_tokens: 7,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    // modelUsage keyed by the RESPONSE model id (claude-test-1 is unpriced).
    expect(Object.keys(result.modelUsage)).toEqual(['claude-test-1']);
    expect(result.modelUsage['claude-test-1']).toEqual({
      inputTokens: 25,
      outputTokens: 7,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUSD: 0,
      // B2b/T2-4: static window-table estimate (unknown model -> default
      // 200k) + the actual per-request max_tokens cap the engine sends.
      contextWindow: 200_000,
      maxOutputTokens: 1024,
    });
    expect(result.total_cost_usd).toBe(0);
    expect(result.permission_denials).toEqual([]);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.system).toBe('You are a test agent.');
  });

  it('tool loop: executes the builtin, feeds tool_result back, then succeeds', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
      textReplyEvents('done'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'read it' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // The builtin ran once with the accumulated (split-JSON) input.
    expect(executed).toEqual([{ file_path: '/a.txt' }]);

    // Two stream calls; the second sees assistant tool_use + user tool_result.
    expect(transport.requests).toHaveLength(2);
    const secondMessages = transport.requests[1]!.messages;
    expect(secondMessages.length).toBeGreaterThanOrEqual(3);
    const assistantTurn = secondMessages[1]!;
    expect(assistantTurn.role).toBe('assistant');
    const toolUseBlocks = (assistantTurn.content as ContentBlockParam[]).filter(
      (b): b is ToolUseBlockParam => b.type === 'tool_use',
    );
    expect(toolUseBlocks).toEqual([
      { type: 'tool_use', id: 'toolu_mock_1', name: 'Read', input: { file_path: '/a.txt' } },
    ]);
    const userTurn = secondMessages[2]!;
    expect(userTurn.role).toBe('user');
    expect(userTurn.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_mock_1', content: 'file content here' },
    ]);

    // First request advertises the builtin tool with input_schema.
    expect(transport.requests[0]!.tools).toEqual([
      {
        name: 'Read',
        description: 'fake read tool',
        input_schema: { type: 'object', properties: { file_path: { type: 'string' } } },
      },
    ]);

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype !== 'success') return;
    expect(result.result).toBe('done');
    expect(result.num_turns).toBe(2);
  });

  it('permission deny: error tool_result with gate message, loop continues, denial reported', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/secret' }),
      textReplyEvents('understood'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const gate = new FakeGate();
    gate.denyTool('Read', 'Permission gate denied Read: blocked by policy');
    const deps = makeDeps(transport, { builtinTools: tools, permissions: gate });
    const history = [{ role: 'user' as const, content: 'read secret' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // Tool never executed.
    expect(executed).toEqual([]);

    // The tool_result fed back is an error carrying the gate's message.
    expect(transport.requests).toHaveLength(2);
    const userTurn = transport.requests[1]!.messages[2]!;
    expect(userTurn.role).toBe('user');
    const toolResults = userTurn.content as ToolResultBlockParam[];
    expect(toolResults).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_mock_1',
        content: 'Permission gate denied Read: blocked by policy',
        is_error: true,
      },
    ]);

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.permission_denials).toEqual([
      { tool_name: 'Read', tool_use_id: 'toolu_mock_1', tool_input: { file_path: '/secret' } },
    ]);
  });

  it('PreToolUse hook deny is passed into gate.check as the hook decision', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/x' }),
      textReplyEvents('after hook deny'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const gate = new FakeGate();
    const hooks = new FakeHookRunner({
      PreToolUse: { decision: 'deny', decisionReason: 'hook policy: no reads' },
    });
    const deps = makeDeps(transport, { builtinTools: tools, permissions: gate, hooks });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // PreToolUse hook ran with tool name as match value and the tool_use id.
    const preRuns = hooks.runs.filter((r) => r.event === 'PreToolUse');
    expect(preRuns).toHaveLength(1);
    expect(preRuns[0]!.matchValue).toBe('Read');
    expect(preRuns[0]!.toolUseID).toBe('toolu_mock_1');
    expect(preRuns[0]!.input).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/x' },
      session_id: 'sess-test',
    });

    // The gate received the aggregated hook decision (step 1 of the pipeline).
    expect(gate.calls).toHaveLength(1);
    expect(gate.calls[0]!.opts.hook).toEqual({
      decision: 'deny',
      reason: 'hook policy: no reads',
      updatedInput: undefined,
    });

    // Deny surfaced as an error tool_result; tool never executed; loop went on.
    expect(executed).toEqual([]);
    const userTurn = transport.requests[1]!.messages[2]!;
    const toolResults = userTurn.content as ToolResultBlockParam[];
    expect(toolResults[0]!.is_error).toBe(true);
    expect(toolResults[0]!.content).toBe('Hook denied Read: hook policy: no reads');
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
  });

  it('PostToolUse updatedToolOutput replaces the tool_result content', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
      textReplyEvents('ok'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([
      ['Read', makeFakeReadTool(executed, { content: 'original output' })],
    ]);
    const hooks = new FakeHookRunner({
      PostToolUse: { updatedToolOutput: 'REPLACED OUTPUT' },
    });
    const deps = makeDeps(transport, { builtinTools: tools, hooks });
    const history = [{ role: 'user' as const, content: 'go' }];

    await collect(runAgentLoop(history, deps, makeConfig()));

    const postRuns = hooks.runs.filter((r) => r.event === 'PostToolUse');
    expect(postRuns).toHaveLength(1);
    expect(postRuns[0]!.input).toMatchObject({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_response: { content: 'original output' },
    });

    const userTurn = transport.requests[1]!.messages[2]!;
    const toolResults = userTurn.content as ToolResultBlockParam[];
    expect(toolResults).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_mock_1', content: 'REPLACED OUTPUT' },
    ]);
  });

  it('PostToolUse additionalContext is appended after the tool_result content', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
      textReplyEvents('ok'),
    ]);
    const tools = new Map<string, BuiltinTool>([
      ['Read', makeFakeReadTool([], { content: 'original output' })],
    ]);
    const hooks = new FakeHookRunner({
      PostToolUse: { additionalContext: ['ctx line 1', 'ctx line 2'] },
    });
    const deps = makeDeps(transport, { builtinTools: tools, hooks });
    const history = [{ role: 'user' as const, content: 'go' }];

    await collect(runAgentLoop(history, deps, makeConfig()));

    const userTurn = transport.requests[1]!.messages[2]!;
    const toolResults = userTurn.content as ToolResultBlockParam[];
    expect(toolResults[0]!.content).toBe('original output\nctx line 1\nctx line 2');
  });

  it('maxTurns=1 with a tool_use reply ends with error_max_turns', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(
      runAgentLoop(history, deps, makeConfig({ maxTurns: 1 })),
    );

    // The tool of the first turn still executes; no second stream call.
    expect(executed).toEqual([{ file_path: '/a.txt' }]);
    expect(transport.requests).toHaveLength(1);

    const result = lastResult(messages);
    expect(result.subtype).toBe('error_max_turns');
    expect(result.is_error).toBe(true);
    expect(result.num_turns).toBe(1);
  });

  it('a natural end that tips maxBudgetUsd still yields success (budget only gates continuation, finding #3)', async () => {
    // The turn ends naturally (end_turn). The money is already spent; the
    // completed answer must NOT be voided into an error result.
    const transport = new MockTransport([
      textReplyEvents('hi', { model: 'claude-sonnet-4-5', usage: { input_tokens: 1000 } }),
    ]);
    const deps = makeDeps(transport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(
      runAgentLoop(history, deps, makeConfig({ maxBudgetUsd: 0.000001 })),
    );

    expect(transport.requests).toHaveLength(1);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.is_error).toBe(false);
    expect(result.num_turns).toBe(1);
    if (result.subtype === 'success') expect(result.result).toBe('hi');
    // Cost is still reported even though it tipped the (unenforced-here) budget.
    // 1000 in * $3/MTok + 7 out * $15/MTok = 0.003105
    expect(result.total_cost_usd).toBeCloseTo(0.003105, 9);
    expect(result.modelUsage['claude-sonnet-4-5']!.costUSD).toBeCloseTo(0.003105, 9);
  });

  it('maxBudgetUsd stops BEFORE executing a requested tool batch, as error_max_budget_usd (E5, findings #3 + rename)', async () => {
    // Turn 1 is a tool_use turn whose own cost already exceeds the budget.
    // Official 2.1.201 trips the cap BEFORE the tool's side effects
    // (conformance run-l2 s12): zero tool executions, no tool_result user
    // turn on the stream, one POST, terminal error_max_budget_usd.
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }, { model: 'claude-sonnet-4-5' }),
      textReplyEvents('should never run'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(
      runAgentLoop(history, deps, makeConfig({ maxBudgetUsd: 0.000001 })),
    );

    // The requested tool did NOT run and the second stream call never happened.
    expect(executed).toEqual([]);
    expect(transport.requests).toHaveLength(1);
    // No tool_result user turn is emitted past the cap (official stream shape).
    expect(messages.some((m) => m.type === 'user')).toBe(false);

    const result = lastResult(messages);
    expect(result.subtype).toBe('error_max_budget_usd');
    expect(result.is_error).toBe(true);
    if (result.subtype === 'error_max_budget_usd') {
      expect(result.errorMessage).toContain('maxBudgetUsd');
    }
  });

  it('a tool batch under budget executes normally; the cap gates only the NEXT call (E5 boundary)', async () => {
    // Turn 1 (cheap) requests a tool -> executes; turn 2 (natural end) still
    // completes. The pre-stop must not fire when the budget is NOT exceeded.
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
      textReplyEvents('done'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(
      runAgentLoop(history, deps, makeConfig({ maxBudgetUsd: 5 })),
    );

    expect(executed).toEqual([{ file_path: '/a.txt' }]);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
  });

  it('C1 enforcement boundary: a 1h-cache turn trips maxBudgetUsd that the same turn at the 5m rate stays under', async () => {
    // The audit consequence of C1 (not just the price calc at 517): a 1h cache
    // write undercounted at the 5m 1.25x rate let a run silently overshoot
    // maxBudgetUsd. opus 1M cache_creation tokens = $18.75 at 5m, $30 at 1h;
    // a $25 cap must FIRE at 1h and NOT at 5m - proving enforcement, not math.
    const buildToolTurn = () => {
      const events = toolUseReplyEvents('Read', { file_path: '/a.txt' }, { model: 'claude-opus-4-8' });
      const ms = events.find((e) => e.type === 'message_start') as {
        message: { usage: { cache_creation_input_tokens: number } };
      };
      ms.message.usage.cache_creation_input_tokens = 1_000_000;
      return events;
    };

    // 1h: $30 > $25 cap -> gated BEFORE the tool, terminal error_max_budget_usd.
    {
      const executed: Array<Record<string, unknown>> = [];
      const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
      const transport = new MockTransport([buildToolTurn(), textReplyEvents('should never run')]);
      const deps = makeDeps(transport, { builtinTools: tools });
      const messages = await collect(
        runAgentLoop([{ role: 'user', content: 'go' }], deps, makeConfig({ maxBudgetUsd: 25, cacheTtl: '1h' })),
      );
      expect(executed).toEqual([]); // the (correct) 2x price gated the tool
      expect(lastResult(messages).subtype).toBe('error_max_budget_usd');
    }

    // 5m: $18.75 < $25 cap -> the tool executes (the old under-count behavior).
    {
      const executed: Array<Record<string, unknown>> = [];
      const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
      const transport = new MockTransport([buildToolTurn(), textReplyEvents('done')]);
      const deps = makeDeps(transport, { builtinTools: tools });
      const messages = await collect(
        runAgentLoop([{ role: 'user', content: 'go' }], deps, makeConfig({ maxBudgetUsd: 25, cacheTtl: '5m' })),
      );
      expect(executed).toEqual([{ file_path: '/a.txt' }]);
      expect(lastResult(messages).subtype).not.toBe('error_max_budget_usd');
    }
  });

  it('includePartialMessages: stream_event messages precede the assistant message', async () => {
    const events = textReplyEvents('partial run');
    const transport = new MockTransport([events]);
    const deps = makeDeps(transport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(
      runAgentLoop(history, deps, makeConfig({ includePartialMessages: true })),
    );

    const partials = messages.filter(
      (m): m is SDKPartialAssistantMessage => m.type === 'stream_event',
    );
    expect(partials).toHaveLength(events.length);
    expect(partials.map((p) => p.event)).toEqual(events);
    for (const p of partials) {
      expect(p.session_id).toBe('sess-test');
      expect(p.parent_tool_use_id).toBeNull();
    }

    const assistantIndex = messages.findIndex((m) => m.type === 'assistant');
    const lastPartialIndex = messages.reduce(
      (acc, m, i) => (m.type === 'stream_event' ? i : acc),
      -1,
    );
    expect(assistantIndex).toBeGreaterThan(lastPartialIndex);
    expect(lastResult(messages).subtype).toBe('success');
  });

  it('includePartialMessages off: no stream_event messages are yielded', async () => {
    const transport = new MockTransport([textReplyEvents('quiet run')]);
    const deps = makeDeps(transport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(messages.filter((m) => m.type === 'stream_event')).toEqual([]);
    expect(messages.map((m) => m.type)).toEqual(['assistant', 'result']);
  });

  it('pre-aborted signal: throws AbortError instead of yielding a result', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = new MockTransport([textReplyEvents('never')]);
    const deps = makeDeps(transport, { signal: controller.signal });
    const history = [{ role: 'user' as const, content: 'go' }];

    const seen: SDKMessage[] = [];
    let thrown: unknown;
    try {
      for await (const m of runAgentLoop(history, deps, makeConfig())) {
        seen.push(m);
      }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AbortError);
    expect(seen).toEqual([]);
    expect(transport.requests).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Regression tests for confirmed engine findings (#1/#30, #2, #4-#9).
  // -------------------------------------------------------------------------

  /** Build a bare message_start event with configurable model/usage. */
  function messageStart(
    opts: { model?: string; usage?: Partial<NonNullableUsage> } = {},
  ): RawMessageStreamEvent {
    return {
      type: 'message_start',
      message: {
        id: 'msg_regression',
        type: 'message',
        role: 'assistant',
        model: opts.model ?? 'claude-test-1',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: opts.usage?.input_tokens ?? 10,
          output_tokens: opts.usage?.output_tokens ?? 0,
          cache_creation_input_tokens: opts.usage?.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: opts.usage?.cache_read_input_tokens ?? 0,
        },
      },
    };
  }

  // ----- findings #1 / #30: thinking budget clamp -----

  it('clamps thinking budget below max_tokens so the request is API-valid (#1/#30)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        // Pre-adaptive model: enabled+budget is the valid wire form to clamp.
        makeConfig({ model: 'claude-haiku-4-5', maxOutputTokens: 8192, thinking: { type: 'enabled' } }),
      ),
    );

    // Default budget 10000 would exceed max_tokens 8192 and 400 the API.
    expect(transport.requests[0]!.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 8191,
    });
    const t = transport.requests[0]!.thinking;
    if (t?.type === 'enabled') expect(t.budget_tokens).toBeLessThan(8192);
  });

  it('preserves an explicit thinking budget that already fits under max_tokens (#1/#30)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({
          model: 'claude-haiku-4-5', // pre-adaptive: budget is honored verbatim
          maxOutputTokens: 8192,
          thinking: { type: 'enabled', budget_tokens: 2000 },
        }),
      ),
    );

    expect(transport.requests[0]!.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2000,
    });
  });

  it('a resolved thinking budget of 0 sends NO thinking param (E1 live-disable guard)', async () => {
    // thinking {type:'enabled'} with maxThinkingTokens 0 is what a live
    // setMaxThinkingTokens(0) produces under the preset default (which injects
    // its budget via maxThinkingTokens): 0 must mean OFF, not a 400ing
    // budget_tokens: 0 request.
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ thinking: { type: 'enabled' }, maxThinkingTokens: 0 }),
      ),
    );

    expect(transport.requests[0]!.thinking).toBeUndefined();
  });

  it("thinking {type:'adaptive'} is transmitted verbatim with no budget_tokens (E7-01)", async () => {
    // The official wire shape: {type:'adaptive'} and NOTHING else - no budget
    // resolution, no clamp, and any maxThinkingTokens fallback is ignored
    // (budgets are enabled-only).
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ thinking: { type: 'adaptive' }, maxThinkingTokens: 2048 }),
      ),
    );

    expect(transport.requests[0]!.thinking).toEqual({ type: 'adaptive' });
  });

  // ----- C10: tool_choice / disable_parallel_tool_use -----

  it('forwards tool_choice verbatim when tools are advertised (C10)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool([])]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ toolChoice: { type: 'tool', name: 'Read', disable_parallel_tool_use: true } }),
      ),
    );

    expect(transport.requests[0]!.tool_choice).toEqual({
      type: 'tool',
      name: 'Read',
      disable_parallel_tool_use: true,
    });
  });

  it('forwards tool_choice {type:auto, disable_parallel_tool_use} verbatim (C10)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool([])]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ toolChoice: { type: 'auto', disable_parallel_tool_use: true } }),
      ),
    );

    expect(transport.requests[0]!.tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });

  it('OMITS tool_choice when no tools are advertised (the API 400s on tool_choice with no tools) (C10)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    // No builtinTools -> toolDefs empty -> tools field omitted -> tool_choice omitted.
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ toolChoice: { type: 'any' } }),
      ),
    );

    expect(transport.requests[0]!.tools).toBeUndefined();
    expect(transport.requests[0]!.tool_choice).toBeUndefined();
  });

  it('sends NO tool_choice when unset, even with tools present (C10 default)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool([])]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(runAgentLoop(history, deps, makeConfig()));

    expect(transport.requests[0]!.tools).toBeDefined();
    expect(transport.requests[0]!.tool_choice).toBeUndefined();
  });

  // ----- C9: native structured outputs on the output_config wire -----

  it('forwards output_config when outputFormat.native is true (C9)', async () => {
    const transport = new MockTransport([textReplyEvents('{}')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const schema = { type: 'object' as const };

    const messages = await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ outputFormat: { type: 'json_schema', schema, native: true } }),
      ),
    );

    expect(transport.requests[0]!.output_config).toEqual({
      format: { type: 'json_schema', schema },
    });
    // Local validation still runs and yields the structured_output result.
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.structured_output).toEqual({});
  });

  it('OMITS output_config when outputFormat is set but native is not (C9 default)', async () => {
    const transport = new MockTransport([textReplyEvents('{}')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ outputFormat: { type: 'json_schema', schema: { type: 'object' } } }),
      ),
    );

    // Default local-only path never touches the wire.
    expect(transport.requests[0]!.output_config).toBeUndefined();
  });

  it('sends NO output_config when outputFormat is unset (C9)', async () => {
    const transport = new MockTransport([textReplyEvents('done')]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(runAgentLoop(history, deps, makeConfig()));

    expect(transport.requests[0]!.output_config).toBeUndefined();
  });

  // ----- base transcript_path on every engine-layer hook (BaseHookInput) -----

  it('engine hooks carry the official base transcript_path when config has one', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const hooks = new FakeHookRunner({ Stop: {} });
    const deps = makeDeps(transport, { hooks });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ transcriptPath: '/fake/sessions/main.jsonl' }),
      ),
    );

    const stop = hooks.runs.find((r) => r.event === 'Stop');
    expect(stop).toBeDefined();
    expect((stop!.input as { transcript_path?: string }).transcript_path).toBe(
      '/fake/sessions/main.jsonl',
    );
  });

  it('engine hooks omit transcript_path when config has none (non-path store / no persist)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const hooks = new FakeHookRunner({ Stop: {} });
    const deps = makeDeps(transport, { hooks });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(runAgentLoop(history, deps, makeConfig()));

    const stop = hooks.runs.find((r) => r.event === 'Stop');
    expect(stop).toBeDefined();
    expect('transcript_path' in (stop!.input as object)).toBe(false);
  });

  // ----- finding #2: stop_reason tool_use with zero tool_use blocks -----

  it('stop_reason tool_use with no tool_use blocks ends as success without an empty user turn (#2)', async () => {
    const malformed: RawMessageStreamEvent[] = [
      messageStart(),
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial answer' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const transport = new MockTransport([malformed]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // No second API call, treated as a natural end.
    expect(transport.requests).toHaveLength(1);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    // The poisoning empty {role:'user',content:[]} turn is never pushed.
    const emptyUser = history.some(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content.length === 0,
    );
    expect(emptyUser).toBe(false);
    // The (non-empty) assistant turn is still recorded.
    expect(history[history.length - 1]!.role).toBe('assistant');
  });

  // ----- finding #4: permission deny with interrupt:true terminates the run -----

  it('permission deny with interrupt:true terminates the run and skips remaining blocks (#4)', async () => {
    // Two tool_use blocks in one turn; the gate denies-with-interrupt.
    const twoTools: RawMessageStreamEvent[] = [
      messageStart(),
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_a', name: 'Read', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/a"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_b', name: 'Read', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/b"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const transport = new MockTransport([twoTools, textReplyEvents('should not run')]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);

    class InterruptGate implements PermissionGate {
      async check(): Promise<PermissionCheckResult> {
        return { decision: 'deny', message: 'stop and interrupt', interrupt: true };
      }
      setMode(): void {}
      getMode(): PermissionMode {
        return 'default';
      }
      applyUpdates(): void {}
      denials(): SDKPermissionDenial[] {
        return [];
      }
    }

    const deps = makeDeps(transport, { builtinTools: tools, permissions: new InterruptGate() });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // No continuation stream call, tool never executed.
    expect(transport.requests).toHaveLength(1);
    expect(executed).toEqual([]);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');

    // The batch was completed with a tool_result for BOTH blocks (so history
    // is API-valid), and the second block carries the skip marker.
    const userTurn = history.find((m) => m.role === 'user' && Array.isArray(m.content));
    const toolResults = userTurn!.content as ToolResultBlockParam[];
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]!.content).toBe('stop and interrupt');
    expect(toolResults[0]!.is_error).toBe(true);
    expect(toolResults[1]!.content).toContain('Not executed');
    expect(toolResults[1]!.is_error).toBe(true);
  });

  // ----- bucket-1: consecutive read-only tools run concurrently -----

  it('runs consecutive read-only builtin tools concurrently, results in order', async () => {
    const twoReads: RawMessageStreamEvent[] = [
      messageStart(),
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_a', name: 'Read', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/a"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_b', name: 'Read', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/b"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    const transport = new MockTransport([twoReads, textReplyEvents('done')]);

    // A read-only probe that records start/end around an await point. Under
    // concurrent execution both tools START before either ENDS; sequential
    // execution would interleave start/end/start/end.
    const order: string[] = [];
    const probe: BuiltinTool = {
      name: 'Read',
      description: 'concurrency probe',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
      readOnly: true,
      async execute(input) {
        const p = (input as { file_path: string }).file_path;
        order.push(`start:${p}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end:${p}`);
        return { content: `read ${p}` };
      },
    };
    const deps = makeDeps(transport, {
      builtinTools: new Map<string, BuiltinTool>([['Read', probe]]),
    });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    await collect(runAgentLoop(history, deps, makeConfig()));

    expect(order).toHaveLength(4);
    expect(order.slice(0, 2).every((s) => s.startsWith('start:'))).toBe(true);
    expect(order.slice(2).every((s) => s.startsWith('end:'))).toBe(true);

    // Both tool_results present and in tool_use order (API pairs by id).
    const userTurn = history.find((m) => m.role === 'user' && Array.isArray(m.content));
    const toolResults = userTurn!.content as ToolResultBlockParam[];
    expect(toolResults.map((r) => r.tool_use_id)).toEqual(['toolu_a', 'toolu_b']);
  });

  // ----- finding #5: fallback retry folds the failed attempt's usage -----

  it('folds the failed attempt usage into totals before a fallback retry (#5)', async () => {
    class FallbackTransport implements Transport {
      readonly requests: StreamRequest[] = [];
      private call = 0;
      apiKeySource(): ApiKeySource {
        return 'user';
      }
      async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
        this.requests.push(req);
        const n = this.call++;
        if (n === 0) {
          // First attempt: emit message_start (input_tokens 100), then fail.
          yield messageStart({ model: 'claude-primary', usage: { input_tokens: 100 } });
          throw new APIStatusError(529, 'overloaded_error', 'overloaded');
        }
        for (const ev of textReplyEvents('recovered', {
          model: 'claude-fallback',
          usage: { input_tokens: 50 },
        })) {
          yield ev;
        }
      }
    }

    const transport = new FallbackTransport();
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ model: 'claude-primary', fallbackModel: 'claude-fallback' }),
      ),
    );

    expect(transport.requests).toHaveLength(2);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    // Failed attempt's 100 input tokens are NOT dropped; fallback's 50 + 7 add on.
    expect(result.usage.input_tokens).toBe(150);
    expect(result.usage.output_tokens).toBe(7);
    // Both models appear in the per-model ledger.
    expect(result.modelUsage['claude-primary']!.inputTokens).toBe(100);
    expect(result.modelUsage['claude-fallback']!.inputTokens).toBe(50);
  });

  it('folds the FALLBACK attempt usage into totals when it fails too', async () => {
    class DoubleFailTransport implements Transport {
      readonly requests: StreamRequest[] = [];
      private call = 0;
      apiKeySource(): ApiKeySource {
        return 'user';
      }
      async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
        this.requests.push(req);
        const n = this.call++;
        if (n === 0) {
          // Primary attempt: bill 100 input tokens, then fail with a
          // fallback-eligible status.
          yield messageStart({ model: 'claude-primary', usage: { input_tokens: 100 } });
          throw new APIStatusError(529, 'overloaded_error', 'overloaded');
        }
        // Fallback attempt: bill 60 input tokens, then fail terminally.
        yield messageStart({ model: 'claude-fallback', usage: { input_tokens: 60 } });
        throw new APIStatusError(500, 'api_error', 'server exploded');
      }
    }

    const transport = new DoubleFailTransport();
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ model: 'claude-primary', fallbackModel: 'claude-fallback' }),
      ),
    );

    expect(transport.requests).toHaveLength(2);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    // BOTH doomed attempts' billed input tokens survive into the terminal
    // report: 100 (primary) + 60 (fallback).
    expect(result.usage.input_tokens).toBe(160);
    expect(result.modelUsage['claude-primary']!.inputTokens).toBe(100);
    expect(result.modelUsage['claude-fallback']!.inputTokens).toBe(60);
  });

  // ----- BPT 2026-07-07: cross-model thinking-signature hygiene -----

  it('strips a cross-model CLOSED thinking block from the outgoing replay', async () => {
    const transport = new MockTransport([textReplyEvents('ok', { model: 'model-b' })]);
    const deps = makeDeps(transport);
    const closed: APIMessageParam = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'draft', signature: 'sig-a' } as ContentBlockParam,
        { type: 'text', text: 'answer' } as ContentBlockParam,
      ],
    };
    stampSigningModel(closed, 'model-a');
    const history: APIMessageParam[] = [
      { role: 'user', content: 'go' },
      closed,
      { role: 'user', content: 'again' },
    ];
    await collect(runAgentLoop(history, deps, makeConfig({ model: 'model-b' })));
    const sent = transport.requests[0]!.messages[1]!;
    const kinds = (sent.content as ContentBlockParam[]).map((b) => b.type);
    expect(kinds).toEqual(['text']); // thinking stripped cross-model; text kept
  });

  it('KEEPS the in-flight tool-loop turn thinking even cross-model (protected)', async () => {
    const transport = new MockTransport([textReplyEvents('done', { model: 'model-b' })]);
    const deps = makeDeps(transport);
    const inflight: APIMessageParam = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'draft', signature: 'sig-a' } as ContentBlockParam,
        { type: 'tool_use', id: 't1', name: 'Read', input: {} } as ContentBlockParam,
      ],
    };
    stampSigningModel(inflight, 'model-a');
    const history: APIMessageParam[] = [
      { role: 'user', content: 'go' },
      inflight,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' } as ContentBlockParam],
      },
    ];
    await collect(runAgentLoop(history, deps, makeConfig({ model: 'model-b' })));
    const sent = transport.requests[0]!.messages[1]!;
    const kinds = (sent.content as ContentBlockParam[]).map((b) => b.type);
    expect(kinds).toEqual(['thinking', 'tool_use']); // protected -> thinking retained
  });

  it('WITHHOLDS a fallback switch mid-tool-loop to avoid an invalid-signature 400', async () => {
    const transport = new MockTransport([
      () => {
        throw new APIStatusError(529, 'overloaded_error', 'overloaded');
      },
    ]);
    const deps = makeDeps(transport);
    const inflight: APIMessageParam = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'draft', signature: 'sig-p' } as ContentBlockParam,
        { type: 'tool_use', id: 't1', name: 'Read', input: {} } as ContentBlockParam,
      ],
    };
    stampSigningModel(inflight, 'claude-primary');
    const history: APIMessageParam[] = [
      { role: 'user', content: 'go' },
      inflight,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' } as ContentBlockParam],
      },
    ];
    const messages = await collect(
      runAgentLoop(
        history,
        deps,
        makeConfig({ model: 'claude-primary', fallbackModel: 'claude-fallback' }),
      ),
    );
    // The guard fired: NO second attempt on the fallback model...
    expect(transport.requests).toHaveLength(1);
    // ...and the original overload surfaces as a clean error result (not a 400 loop).
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
  });

  // ----- BPT audit 2026-07-07: stop-reason semantics (C4/C5/C6) -----

  it('C4: pause_turn continues the turn instead of ending as a success', async () => {
    const transport = new MockTransport([
      textReplyEvents('partial…', { stopReason: 'pause_turn' }),
      textReplyEvents('final answer', { stopReason: 'end_turn' }),
    ]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(runAgentLoop(history, deps, makeConfig()));
    expect(transport.requests).toHaveLength(2); // re-streamed to continue the paused turn
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.subtype === 'success' && result.result).toBe('final answer');
  });

  it('C4: a runaway pause_turn is bounded by maxTurns', async () => {
    const transport = new MockTransport([
      textReplyEvents('p1', { stopReason: 'pause_turn' }),
      textReplyEvents('p2', { stopReason: 'pause_turn' }),
      textReplyEvents('p3', { stopReason: 'pause_turn' }),
    ]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(runAgentLoop(history, deps, makeConfig({ maxTurns: 2 })));
    expect(lastResult(messages).subtype).toBe('error_max_turns');
  });

  it('C5: refusal surfaces as an ERROR result (not success) with error_code refusal', async () => {
    const transport = new MockTransport([textReplyEvents('', { stopReason: 'refusal' })]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(runAgentLoop(history, deps, makeConfig()));
    expect(transport.requests).toHaveLength(1);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    expect(result.is_error).toBe(true);
    expect((result as { error_code?: string }).error_code).toBe('refusal');
  });

  it('C5: a refusal turn drops any orphan tool_use from the persisted turn', async () => {
    // A refusal (200, stop_reason:refusal) can still carry a completed tool_use.
    // Persisting it unpaired 400s every later same-session request, so it must
    // be filtered like the C6 natural-end path (text kept for context).
    const events = toolUseReplyEvents('Read', { file_path: '/a' }, { leadingText: 'no' });
    const md = events.find((e) => e.type === 'message_delta') as {
      delta: { stop_reason: string };
    };
    md.delta.stop_reason = 'refusal';
    const transport = new MockTransport([events]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(runAgentLoop(history, deps, makeConfig()));
    expect((lastResult(messages) as { error_code?: string }).error_code).toBe('refusal');
    const persisted = history.find((m) => m.role === 'assistant')!;
    const kinds = (persisted.content as ContentBlockParam[]).map((b) => b.type);
    expect(kinds).not.toContain('tool_use'); // orphan dropped
    expect(kinds).toContain('text'); // context kept
  });

  it('C6: a max_tokens orphan tool_use is dropped from the persisted turn', async () => {
    const events = toolUseReplyEvents('Read', { file_path: '/a' }, { leadingText: 'hmm' });
    const md = events.find((e) => e.type === 'message_delta') as {
      delta: { stop_reason: string };
    };
    md.delta.stop_reason = 'max_tokens'; // tool_use block present, but cut by max_tokens
    const transport = new MockTransport([events]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const messages = await collect(runAgentLoop(history, deps, makeConfig()));
    expect(lastResult(messages).subtype).toBe('success'); // natural end, no dispatch
    // the PERSISTED assistant turn must not carry the unpaired tool_use
    const persisted = history.find((m) => m.role === 'assistant')!;
    const kinds = (persisted.content as ContentBlockParam[]).map((b) => b.type);
    expect(kinds).not.toContain('tool_use');
    expect(kinds).toContain('text');
  });

  it('records api_error_status on an unrecovered APIStatusError result', async () => {
    const transport = new MockTransport([
      () => {
        throw new APIStatusError(529, 'overloaded_error', 'overloaded');
      },
    ]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    if (result.subtype === 'error_during_execution') {
      expect(result.api_error_status).toBe(529);
    }
  });

  // ----- finding #6: PostToolUse continue:false stops the run -----

  it('honors PostToolUse continue:false by stopping the run after the batch (#6)', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
      textReplyEvents('should not run'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const hooks = new FakeHookRunner({
      PostToolUse: { continue: false, stopReason: 'secret detected in tool output' },
    });
    const deps = makeDeps(transport, { builtinTools: tools, hooks });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // The tool ran (PostToolUse fires after), but no continuation call happened.
    expect(executed).toEqual([{ file_path: '/a.txt' }]);
    expect(transport.requests).toHaveLength(1);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    expect(result.errorMessage).toBe('secret detected in tool output');
  });

  // ----- finding #7: unknown tool name is "No such tool", not a denial -----

  it('unknown tool name returns No such tool without hooks or a permission denial (#7)', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Fetch', { url: 'http://x' }),
      textReplyEvents('ok'),
    ]);
    const gate = new FakeGate();
    // Hooks are registered to prove the unknown tool never reaches them.
    const hooks = new FakeHookRunner({ PreToolUse: {} });
    const deps = makeDeps(transport, { permissions: gate, hooks });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    const userTurn = transport.requests[1]!.messages[2]!;
    const toolResults = userTurn.content as ToolResultBlockParam[];
    expect(toolResults[0]!.is_error).toBe(true);
    expect(toolResults[0]!.content).toBe('No such tool: Fetch');
    // Neither the gate nor PreToolUse hooks were consulted.
    expect(gate.calls).toHaveLength(0);
    expect(hooks.runs.filter((r) => r.event === 'PreToolUse')).toHaveLength(0);
    // The denial ledger is not polluted.
    expect(lastResult(messages).permission_denials).toEqual([]);
  });

  // ----- finding #8: empty assistant content is not persisted to history -----

  it('yields an empty assistant message but never pushes it to history (#8)', async () => {
    const empty: RawMessageStreamEvent[] = [
      messageStart(),
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ];
    const transport = new MockTransport([empty]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // The assistant message is still surfaced to the consumer...
    expect(messages.some((m) => m.type === 'assistant')).toBe(true);
    // ...but an API-invalid empty assistant turn is NOT written to history.
    expect(history.filter((m) => m.role === 'assistant')).toEqual([]);
    expect(lastResult(messages).subtype).toBe('success');
  });

  it('drops an all-empty-text assistant turn from history (#8)', async () => {
    const emptyText: RawMessageStreamEvent[] = [
      messageStart(),
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ];
    const transport = new MockTransport([emptyText]);
    const deps = makeDeps(transport);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(history.filter((m) => m.role === 'assistant')).toEqual([]);
    expect(lastResult(messages).subtype).toBe('success');
  });

  // ----- finding #9: circular updatedToolOutput must not crash the run -----

  it('survives a circular PostToolUse updatedToolOutput, keeping original content (#9)', async () => {
    const circular: Record<string, unknown> = { name: 'state' };
    circular.self = circular;
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }),
      textReplyEvents('done'),
    ]);
    const tools = new Map<string, BuiltinTool>([
      ['Read', makeFakeReadTool([], { content: 'original output' })],
    ]);
    const hooks = new FakeHookRunner({ PostToolUse: { updatedToolOutput: circular } });
    const deps = makeDeps(transport, { builtinTools: tools, hooks });
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // The run continued (a second stream call happened) rather than crashing.
    expect(transport.requests).toHaveLength(2);
    const userTurn = transport.requests[1]!.messages[2]!;
    const toolResults = userTurn.content as ToolResultBlockParam[];
    expect(toolResults[0]!.content).toBe('original output');
    expect(lastResult(messages).subtype).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Dual system cache breakpoint (wire-level via runAgentLoop + MockTransport)
// ---------------------------------------------------------------------------

describe('dual system cache breakpoint', () => {
  const BASE = 'base harness prefix';
  const TAIL = '\n\n<system-reminder>project instructions</system-reminder>';
  const CWD = 'Working directory: /tmp/run-xyz';

  /** Count every cache_control breakpoint anywhere in the request. */
  function countBreakpoints(req: StreamRequest): number {
    let n = 0;
    if (Array.isArray(req.tools)) for (const t of req.tools) if (t.cache_control) n += 1;
    if (Array.isArray(req.system)) for (const b of req.system) if (b.cache_control) n += 1;
    for (const m of req.messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if ((b as { cache_control?: unknown }).cache_control) n += 1;
        }
      }
    }
    return n;
  }

  it('emits a 3-block [base, project, cwd] system with cache_control on 0 and 1 only', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    const config = makeConfig({
      promptCaching: true,
      systemPrompt: BASE + TAIL,
      systemPromptSuffix: CWD,
      systemPromptBaseLen: BASE.length,
    });
    await collect(runAgentLoop([{ role: 'user', content: 'hi' }], deps, config));

    const system = transport.requests[0]!.system as TextBlockParam[];
    expect(system).toHaveLength(3);
    expect(system[0]!.text).toBe(BASE);
    expect(system[1]!.text).toBe(TAIL);
    expect(system[2]!.text).toBe(CWD);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[2]!.cache_control).toBeUndefined();
    // slice(baseLen) round-trips to the tail bytes
    expect((BASE + TAIL).slice(BASE.length)).toBe(TAIL);
  });

  it('degrades to the old 2-block [stable, cwd] single breakpoint when baseLen is unset', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    const config = makeConfig({
      promptCaching: true,
      systemPrompt: BASE + TAIL,
      systemPromptSuffix: CWD,
      // systemPromptBaseLen omitted -> no project tail known
    });
    await collect(runAgentLoop([{ role: 'user', content: 'hi' }], deps, config));

    const system = transport.requests[0]!.system as TextBlockParam[];
    expect(system).toHaveLength(2);
    expect(system[0]!.text).toBe(BASE + TAIL);
    expect(system[1]!.text).toBe(CWD);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.cache_control).toBeUndefined();
  });

  it('guards degrade to single breakpoint: baseLen 0 and baseLen >= length', async () => {
    for (const baseLen of [0, (BASE + TAIL).length, (BASE + TAIL).length + 5]) {
      const transport = new MockTransport([textReplyEvents('ok')]);
      const deps = makeDeps(transport);
      const config = makeConfig({
        promptCaching: true,
        systemPrompt: BASE + TAIL,
        systemPromptSuffix: CWD,
        systemPromptBaseLen: baseLen,
      });
      await collect(runAgentLoop([{ role: 'user', content: 'hi' }], deps, config));

      const system = transport.requests[0]!.system as TextBlockParam[];
      expect(system).toHaveLength(2);
      expect(system[0]!.text).toBe(BASE + TAIL);
      expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
      expect(system[1]!.cache_control).toBeUndefined();
    }
  });

  it('total breakpoints stay <= 4 with dual split + tools + cacheable last message', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool([])]]);
    const deps = makeDeps(transport, { builtinTools: tools });
    const config = makeConfig({
      promptCaching: true,
      systemPrompt: BASE + TAIL,
      systemPromptSuffix: CWD,
      systemPromptBaseLen: BASE.length,
    });
    await collect(runAgentLoop([{ role: 'user', content: 'hi' }], deps, config));

    // tools(1) + system base+project(2) + last message(1) = 4, at the API cap.
    expect(countBreakpoints(transport.requests[0]!)).toBe(4);
    expect(countBreakpoints(transport.requests[0]!)).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// E3: truncated-turn graceful degradation (conformance run-l4 KD-L4-02/04).
// A mid-stream connection drop (transport flags midStreamTruncation) salvages
// the blocks the wire delivered whole instead of voiding the turn: partial
// text becomes the answer (result/success + a non-fatal `errors` note);
// complete tool_use blocks EXECUTE and the loop continues - even when the cut
// landed before stop_reason arrived. Unclosed tool_use never executes.
// ---------------------------------------------------------------------------

/** Yields the scripted events then fails like a dropped connection. */
class TruncatingTransport implements Transport {
  readonly requests: StreamRequest[] = [];
  private calls = 0;

  constructor(
    private readonly scripts: RawMessageStreamEvent[][],
    /** 1-based call number that truncates ('all' = every call); other calls
     *  complete normally. */
    private readonly truncateCall: number | 'all' = 1,
    private readonly flag = true,
    /** Also mark the failure turn-replay-safe (zero-consumption shape). */
    private readonly replaySafe = false,
  ) {}

  apiKeySource(): 'user' {
    return 'user';
  }

  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    this.requests.push(req);
    const call = ++this.calls;
    const events = this.scripts[call - 1];
    if (!events) throw new Error(`TruncatingTransport: unexpected call #${call}`);
    for (const ev of events) yield ev;
    if (this.truncateCall === 'all' || call === this.truncateCall) {
      const err = new APIConnectionError(
        `Messages API stream failed after ${events.length} event(s): socket hang up`,
      );
      err.midStreamTruncation = this.flag;
      if (this.replaySafe) err.turnReplaySafe = true;
      throw err;
    }
  }
}

describe('engine loop - truncated-turn graceful degradation (E3)', () => {
  it('text turn cut before message_stop: partial text becomes a success result with an errors note', async () => {
    // textReplyEvents minus message_stop: text block closed, message_delta
    // delivered (stop_reason end_turn), terminator missing.
    const events = textReplyEvents('PARTIAL TEXT').slice(0, -1);
    const transport = new TruncatingTransport([events]);
    const deps = makeDeps(transport as unknown as MockTransport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(transport.requests).toHaveLength(1); // no retry
    const assistantMsg = messages.find((m) => m.type === 'assistant');
    expect(assistantMsg).toBeDefined();
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.is_error).toBe(false);
    if (result.subtype === 'success') expect(result.result).toBe('PARTIAL TEXT');
    expect(result.errors?.some((e) => /stream failed/.test(e))).toBe(true);
  });

  it('tool turn cut after message_delta: the complete tool_use executes and the loop continues', async () => {
    const events = toolUseReplyEvents('Read', { file_path: '/a.txt' }).slice(0, -1);
    const transport = new TruncatingTransport([events, textReplyEvents('POST TRUNC')]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport as unknown as MockTransport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(executed).toEqual([{ file_path: '/a.txt' }]);
    expect(transport.requests).toHaveLength(2); // tool_result delivered on a 2nd POST
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('POST TRUNC');
    expect(result.errors?.some((e) => /stream failed/.test(e))).toBe(true);
  });

  it('tool turn cut BEFORE message_delta (no stop_reason): complete tool_use blocks still execute', async () => {
    const events = toolUseReplyEvents('Read', { file_path: '/a.txt' }).slice(0, -2);
    const transport = new TruncatingTransport([events, textReplyEvents('POST TRUNC')]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport as unknown as MockTransport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(executed).toEqual([{ file_path: '/a.txt' }]);
    expect(transport.requests).toHaveLength(2);
    expect(lastResult(messages).subtype).toBe('success');
  });

  it('an UNCLOSED tool_use block never executes: nothing whole -> replays, then the turn fails', async () => {
    // Cut mid input_json_delta: content_block_stop never arrives, so the
    // half-received input must not run. No other whole block -> no salvage;
    // the discarded partial IS replay-safe (P0-1), so the engine replays the
    // turn up to its bounded budget before surfacing the error.
    const events = toolUseReplyEvents('Read', { file_path: '/a.txt' }).slice(0, -3);
    const transport = new TruncatingTransport([events, events, events], 'all');
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport as unknown as MockTransport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(executed).toEqual([]);
    // Initial attempt + TURN_REPLAY_LIMIT replays, all truncated.
    expect(transport.requests).toHaveLength(1 + TURN_REPLAY_LIMIT);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    expect(result.metrics?.transportHealth?.turnReplays).toBe(TURN_REPLAY_LIMIT);
  });

  it('a connection error WITHOUT the truncation flag keeps the existing error path', async () => {
    const events = textReplyEvents('SHOULD BE VOIDED').slice(0, -1);
    const transport = new TruncatingTransport([events], 1, false);
    const deps = makeDeps(transport as unknown as MockTransport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
  });

  it('mixed truncated turn: closed text is kept while the unclosed tool_use is dropped', async () => {
    // leadingText closes a text block before the tool block opens; cutting
    // before the tool's content_block_stop leaves text whole + tool partial.
    const events = toolUseReplyEvents(
      'Read',
      { file_path: '/a.txt' },
      { leadingText: 'KEPT PREFIX' },
    ).slice(0, -3);
    const transport = new TruncatingTransport([events]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const deps = makeDeps(transport as unknown as MockTransport, { builtinTools: tools });
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    // The dropped tool never ran; the kept text degrades to a success answer.
    expect(executed).toEqual([]);
    expect(transport.requests).toHaveLength(1);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('KEPT PREFIX');
    expect(result.errors?.some((e) => /stream failed/.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resilience P0-1 (bounded turn replay) + P0-2 (transportHealth ledger).
// A stream failure that consumed nothing (or whose partial delivery was fully
// discarded by a failed salvage) is replay-safe: the engine re-issues the turn
// within TURN_REPLAY_LIMIT instead of surfacing a dead session, and every
// absorbed fault lands in metrics.transportHealth.
// ---------------------------------------------------------------------------

describe('engine loop - bounded turn replay (P0-1) + transport health ledger (P0-2)', () => {
  it('mid-stream drop with nothing salvageable: the turn replays and succeeds', async () => {
    // Call 1 delivers only message_start (no whole block -> salvage fails,
    // replay-safe); call 2 completes normally.
    const cut = textReplyEvents('LOST').slice(0, 1);
    const transport = new TruncatingTransport([cut, textReplyEvents('RECOVERED')], 1);
    const deps = makeDeps(transport as unknown as MockTransport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(transport.requests).toHaveLength(2);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('RECOVERED');
    // The replay is visible: an api_retry observability message rides the
    // stream, and the ledger counts both the drop and the replay.
    const retry = messages.find((m) => m.type === 'api_retry');
    expect(retry).toBeDefined();
    if (retry?.type === 'api_retry') {
      expect(retry.reason).toMatch(/^turn_replay:/);
      expect(retry.max_retries).toBe(TURN_REPLAY_LIMIT);
    }
    expect(result.metrics?.transportHealth).toMatchObject({
      midStreamDrops: 1,
      turnReplays: 1,
      turnsSalvaged: 0,
    });
  });

  it('a zero-event replay-safe stall replays and succeeds', async () => {
    const transport = new TruncatingTransport(
      [[], textReplyEvents('AFTER STALL')],
      1,
      false,
      true, // turnReplaySafe (zero-consumption shape)
    );
    const deps = makeDeps(transport as unknown as MockTransport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(transport.requests).toHaveLength(2);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('AFTER STALL');
    expect(result.metrics?.transportHealth?.turnReplays).toBe(1);
  });

  it('a clean run reports an all-zero transport health ledger', async () => {
    const transport = new TruncatingTransport([textReplyEvents('CLEAN')], 0);
    const deps = makeDeps(transport as unknown as MockTransport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.metrics?.transportHealth).toEqual({
      networkRetries: 0,
      httpRetries: 0,
      emptyStreamRetries: 0,
      midStreamDrops: 0,
      idleStalls: 0,
      maxDurationAborts: 0,
      turnsSalvaged: 0,
      turnReplays: 0,
    });
  });

  it('a salvaged truncation counts as an absorbed drop, not a replay', async () => {
    const events = textReplyEvents('PARTIAL').slice(0, -1); // salvageable
    const transport = new TruncatingTransport([events]);
    const deps = makeDeps(transport as unknown as MockTransport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(runAgentLoop(history, deps, makeConfig()));

    expect(transport.requests).toHaveLength(1); // salvage, no replay
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.metrics?.transportHealth).toMatchObject({
      midStreamDrops: 1,
      turnsSalvaged: 1,
      turnReplays: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// P2 partial-closure (engine level): ttft_ms on stream_event, thinking.display
// forwarding, PostToolBatch tool_calls[]. See docs/COMPAT.md.
// ---------------------------------------------------------------------------

describe('P2: stream_event ttft_ms', () => {
  it('attaches ttft_ms once the first token is latched (absent on earlier events)', async () => {
    const transport = new MockTransport([textReplyEvents('hi there')]);
    const deps = makeDeps(transport);
    const history = [{ role: 'user' as const, content: 'go' }];

    const messages = await collect(
      runAgentLoop(history, deps, makeConfig({ includePartialMessages: true })),
    );

    const partials = messages.filter(
      (m): m is SDKPartialAssistantMessage => m.type === 'stream_event',
    );
    expect(partials.length).toBeGreaterThan(0);
    // message_start precedes the first token → no ttft yet.
    const first = partials[0]!;
    expect(first.event.type).toBe('message_start');
    expect(first.ttft_ms).toBeUndefined();
    // From the content_block_start onward ttft is present and non-negative.
    const withTtft = partials.filter((p) => p.ttft_ms !== undefined);
    expect(withTtft.length).toBeGreaterThan(0);
    for (const p of withTtft) expect(p.ttft_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('P2: thinking.display forwarding', () => {
  it('forwards display onto the adaptive wire form (4.6+ model)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    await collect(
      runAgentLoop([{ role: 'user' as const, content: 'go' }], deps,
        makeConfig({ thinking: { type: 'adaptive', display: 'summarized' } }),
      ),
    );
    expect(transport.requests[0]!.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
  });

  it('forwards display onto the enabled wire form (pre-4.6 model)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    await collect(
      runAgentLoop([{ role: 'user' as const, content: 'go' }], deps,
        makeConfig({
          model: 'claude-haiku-4-5',
          maxOutputTokens: 8192,
          thinking: { type: 'enabled', budget_tokens: 2000, display: 'omitted' },
        }),
      ),
    );
    expect(transport.requests[0]!.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2000,
      display: 'omitted',
    });
  });

  it('omits display when the caller did not set it', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const deps = makeDeps(transport);
    await collect(
      runAgentLoop([{ role: 'user' as const, content: 'go' }], deps,
        makeConfig({ thinking: { type: 'adaptive' } }),
      ),
    );
    expect(transport.requests[0]!.thinking).toEqual({ type: 'adaptive' });
  });
});

describe('P2: PostToolBatch tool_calls[]', () => {
  it('the hook input carries official tool_calls[] alongside deprecated tool_names', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Read', { file_path: '/a.txt' }, { id: 'toolu_x' }),
      textReplyEvents('done'),
    ]);
    const executed: Array<Record<string, unknown>> = [];
    const tools = new Map<string, BuiltinTool>([['Read', makeFakeReadTool(executed)]]);
    const hooks = new FakeHookRunner({ PostToolBatch: {} });
    const deps = makeDeps(transport, { builtinTools: tools, hooks });

    await collect(
      runAgentLoop([{ role: 'user' as const, content: 'go' }], deps, makeConfig()),
    );

    const batch = hooks.runs.find((r) => r.event === 'PostToolBatch');
    expect(batch).toBeDefined();
    const input = batch!.input as {
      tool_calls: Array<{ tool_name: string; tool_input: unknown; tool_use_id?: string }>;
      tool_names: string[];
    };
    expect(input.tool_names).toEqual(['Read']);
    expect(input.tool_calls).toEqual([
      { tool_name: 'Read', tool_input: { file_path: '/a.txt' }, tool_use_id: 'toolu_x' },
    ]);
  });
});
