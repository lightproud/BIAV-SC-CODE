/**
 * Module B (engine) test suite: MessageAccumulator, pricing helpers and
 * runAgentLoop. Transport is the scripted MockTransport; permission gate,
 * hook runner and MCP registry are minimal recordable fakes.
 */

import { describe, expect, it } from 'vitest';

import { MessageAccumulator } from '../src/engine/accumulator.js';
import {
  addUsage,
  estimateCostUsd,
  normalizeUsage,
} from '../src/engine/pricing.js';
import { runAgentLoop } from '../src/engine/loop.js';
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
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';

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
      env: {},
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

  it('maxBudgetUsd fires only when about to continue after a tool_use turn, as error_max_budget_usd (findings #3 + rename)', async () => {
    // Turn 1 is a tool_use turn (the loop wants to continue with another
    // billable call); the accumulated cost exceeds the budget, so the run
    // stops BEFORE the second API call with the renamed subtype.
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

    // The tool of turn 1 ran, but the second stream call never happened.
    expect(executed).toEqual([{ file_path: '/a.txt' }]);
    expect(transport.requests).toHaveLength(1);

    const result = lastResult(messages);
    expect(result.subtype).toBe('error_max_budget_usd');
    expect(result.is_error).toBe(true);
    if (result.subtype === 'error_max_budget_usd') {
      expect(result.errorMessage).toContain('maxBudgetUsd');
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
        makeConfig({ maxOutputTokens: 8192, thinking: { type: 'enabled' } }),
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
