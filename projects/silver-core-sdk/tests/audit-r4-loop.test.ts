/**
 * Audit r4 (2026-07-17) — engine/loop.ts regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - V5-1: ModelUsage.maxOutputTokens reports the ACTUAL per-request cap the
 *    engine sends (config.maxOutputTokens re-clamped down to the model's
 *    output ceiling), not the raw configured value — metric and wire agree.
 *  - V5-2: an abort that lands mid-batch stops the loop BEFORE it dispatches
 *    any further tool in the batch (tools 2..N never run their side effects).
 *  - V5-3: a compaction summary API call's time is attributed to a perTurn
 *    entry, so sum(perTurn.apiMs) reconciles with the top-line durationApiMs
 *    instead of trailing it by exactly the summary time.
 *  - Z1-2: a truncated tool_use turn fails before any tool runs and records
 *    ZERO dispatched tool calls; a non-truncated batch still counts every
 *    requested call.
 */

import { describe, expect, it, vi } from 'vitest';

import { runAgentLoop } from '../src/engine/loop.js';
import { buildCompactionConfig } from '../src/engine/compaction.js';
import { isAbortError } from '../src/errors.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
  PermissionGate,
  StreamRequest,
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
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Shared minimal engine fakes (mirrors t49-batch-b.test.ts)
// ---------------------------------------------------------------------------

/** Module-private test-harness sentinel (error-discipline: no bare Error). */
class HarnessError extends Error {}

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

function makeDeps(
  transport: Transport,
  over: {
    builtinTools?: Map<string, BuiltinTool>;
    signal?: AbortSignal;
    requestView?: { messages: APIMessageParam[] };
  } = {},
): EngineDeps {
  return {
    transport,
    builtinTools: over.builtinTools ?? new Map(),
    mcp: new FakeMcp(),
    permissions: allowAllGate,
    hooks: noHooks,
    toolContext: {
      cwd: '/tmp/audit-r4-loop',
      additionalDirectories: [],
      env: {},
      signal: over.signal ?? new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
    ...(over.requestView !== undefined ? { requestView: over.requestView } : {}),
  };
}

function makeConfig(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-test-1',
    maxOutputTokens: 1024,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-audit-r4-loop',
    cwd: '/tmp/audit-r4-loop',
    ...over,
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
// Event builders
// ---------------------------------------------------------------------------

function msgStart(model = 'claude-test-1'): RawMessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_r4',
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

/** A tool_use turn requesting two non-parallel-safe 'Mark' calls (dispatched
 *  sequentially, one group per iteration). */
function twoMarkTurn(): RawMessageStreamEvent[] {
  return [
    msgStart(),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_m1', name: 'Mark', input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"n":1}' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_m2', name: 'Mark', input: {} },
    },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"n":2}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}

/** A stop_reason:'tool_use' turn whose single tool_use has truncated arg JSON
 *  (the second delta chunk never arrives — a routine max_tokens cut). */
function truncatedToolTurn(): RawMessageStreamEvent[] {
  return [
    msgStart(),
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_cut', name: 'Read', input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path": "/etc/' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}

/** A non-read-only, non-parallel-safe builtin that records each call's `n`.
 *  `onFirst` runs once, right after the FIRST call executes. */
function markTool(executed: number[], onFirst?: () => void): BuiltinTool {
  return {
    name: 'Mark',
    description: 'test mark tool',
    inputSchema: { type: 'object', properties: {} },
    readOnly: false,
    async execute(input) {
      executed.push(Number(input['n']));
      if (executed.length === 1 && onFirst !== undefined) onFirst();
      return { content: 'ok' };
    },
  };
}

/** Transport that advances a FAKED clock by a fixed amount per stream() call,
 *  so each API call's measured apiMs is deterministic and nonzero. */
class ClockTransport implements Transport {
  readonly requests: StreamRequest[] = [];
  private calls = 0;
  constructor(
    private readonly scripts: RawMessageStreamEvent[][],
    private readonly advances: number[],
    private readonly clock: { t: number },
  ) {}
  apiKeySource(): ApiKeySource {
    return 'user';
  }
  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    this.requests.push(req);
    const idx = this.calls++;
    const events = this.scripts[idx];
    if (events === undefined) {
      throw new HarnessError(`ClockTransport: unexpected call #${idx + 1}`);
    }
    // Advance the faked clock as this call's API time (before yielding, so the
    // caller's apiStart..finally bracket measures exactly this delta).
    this.clock.t += this.advances[idx] ?? 0;
    for (const ev of events) yield ev;
  }
}

function pad(prefix: string, len: number): string {
  return (prefix + ' ').repeat(Math.ceil(len / (prefix.length + 1))).slice(0, len);
}
function bigHistory(n: number, len = 240): APIMessageParam[] {
  const msgs: APIMessageParam[] = [];
  for (let i = 0; i < n; i += 1) {
    msgs.push({ role: 'user', content: pad(`user turn ${i}`, len) });
    msgs.push({ role: 'assistant', content: [{ type: 'text', text: pad(`assistant reply ${i}`, len) }] });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// V5-1: ModelUsage.maxOutputTokens reports the ACTUAL clamped cap
// ---------------------------------------------------------------------------

describe('V5-1: modelUsage.maxOutputTokens tracks the real per-request cap', () => {
  it('a config cap above the model ceiling is reported as the clamped cap (matching the wire)', async () => {
    // opus output ceiling is 32k; config asks for 64k, so the wire clamps to 32k.
    const transport = new MockTransport([textReplyEvents('done', { model: 'claude-opus-4-1' })]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'hi' }],
        makeDeps(transport),
        makeConfig({ model: 'claude-opus-4-1', maxOutputTokens: 64_000 }),
      ),
    );
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    // The wire request WAS clamped down to the model ceiling ...
    expect(transport.requests[0]!.max_tokens).toBe(32_000);
    // ... and the metric now reports THAT actual cap, not the raw 64k config.
    expect(result.modelUsage['claude-opus-4-1']!.maxOutputTokens).toBe(32_000);
  });

  it('a config cap below the model ceiling is reported unchanged (no over-clamp)', async () => {
    const transport = new MockTransport([textReplyEvents('done', { model: 'claude-opus-4-1' })]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'hi' }],
        makeDeps(transport),
        makeConfig({ model: 'claude-opus-4-1', maxOutputTokens: 8_192 }),
      ),
    );
    const result = lastResult(messages);
    expect(transport.requests[0]!.max_tokens).toBe(8_192);
    expect(result.modelUsage['claude-opus-4-1']!.maxOutputTokens).toBe(8_192);
  });
});

// ---------------------------------------------------------------------------
// V5-2: a mid-batch interrupt stops later tools
// ---------------------------------------------------------------------------

describe('V5-2: an interrupt lands between tool groups, before later side effects', () => {
  it('aborting during tool 1 stops tool 2 from executing; the run throws abort', async () => {
    const controller = new AbortController();
    const executed: number[] = [];
    const tool = markTool(executed, () => controller.abort());
    const transport = new MockTransport([twoMarkTurn()]);
    const deps = makeDeps(transport, {
      builtinTools: new Map([['Mark', tool]]),
      signal: controller.signal,
    });

    let thrown: unknown;
    try {
      await collect(runAgentLoop([{ role: 'user', content: 'go' }], deps, makeConfig()));
    } catch (e) {
      thrown = e;
    }
    expect(isAbortError(thrown)).toBe(true);
    expect(executed).toEqual([1]); // the second Mark never ran
  });

  it('without an interrupt the whole batch runs (the guard is abort-specific)', async () => {
    const executed: number[] = [];
    const tool = markTool(executed); // no abort
    const transport = new MockTransport([twoMarkTurn(), textReplyEvents('done')]);
    const deps = makeDeps(transport, { builtinTools: new Map([['Mark', tool]]) });

    const messages = await collect(runAgentLoop([{ role: 'user', content: 'go' }], deps, makeConfig()));
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(executed).toEqual([1, 2]);
    // Z1-2 companion: a non-truncated batch still counts every requested call.
    expect(result.metrics!.perTurn[0]!.toolCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// V5-3: compaction summary apiMs is attributed to a perTurn entry
// ---------------------------------------------------------------------------

describe('V5-3: compaction summary apiMs reconciles with the per-turn ledger', () => {
  it('the summary call time is folded into the turn, so sum(perTurn.apiMs) == durationApiMs', async () => {
    const clock = { t: 5_000_000 };
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock.t);
    try {
      // Call #1 = the compaction summary (+50ms); call #2 = the assistant turn (+30ms).
      const transport = new ClockTransport(
        [textReplyEvents('MODEL SUMMARY TEXT'), textReplyEvents('final answer')],
        [50, 30],
        clock,
      );
      const view = { messages: bigHistory(12) };
      const deps = makeDeps(transport, { requestView: view });
      const config = makeConfig({
        compaction: buildCompactionConfig({ contextWindowTokens: 2000, useApiSummary: true }),
      });

      const messages = await collect(runAgentLoop([{ role: 'user', content: 'hi' }], deps, config));
      const result = lastResult(messages);
      expect(result.subtype).toBe('success');
      // The summary API call really fired (call #1), then the assistant turn (#2).
      expect(transport.requests).toHaveLength(2);

      const m = result.metrics!;
      expect(m.durationApiMs).toBe(80); // 50 (summary) + 30 (assistant)
      expect(m.perTurn).toHaveLength(1);
      // The summary's 50ms is folded into the turn, so the ledger reconciles
      // with the top-line rather than trailing it by 50.
      const summed = m.perTurn.reduce((s, t) => s + t.apiMs, 0);
      expect(summed).toBe(80);
      expect(m.perTurn[0]!.apiMs).toBe(80);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Z1-2: a truncated tool_use turn records zero dispatched tool calls
// ---------------------------------------------------------------------------

describe('Z1-2: a truncated tool_use turn counts zero tool calls', () => {
  it('the unexecuted, truncated block does not inflate perTurn.toolCalls', async () => {
    const transport = new MockTransport([truncatedToolTurn()]);
    const messages = await collect(
      runAgentLoop([{ role: 'user', content: 'go' }], makeDeps(transport), makeConfig()),
    );
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    expect((result as { error_code?: string }).error_code).toBe('tool_input_truncated');

    const per = result.metrics!.perTurn;
    expect(per).toHaveLength(1);
    expect(per[0]!.stopReason).toBe('tool_use');
    // No tool ever ran (the turn fails before dispatch): the count must be 0.
    expect(per[0]!.toolCalls).toBe(0);
  });
});
