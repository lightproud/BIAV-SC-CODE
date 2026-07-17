/**
 * Regression locks for the T50 batch-F fixes (audit r2 2026-07-17,
 * silver-core-sdk-bug-audit-r2-20260717.md): the engine compaction /
 * accounting safety net — D1..D7 + C2. One suite per audit item.
 */

import { describe, expect, it } from 'vitest';

import {
  estimateMessagesTokens,
  estimateToolDefsTokens,
} from '../src/engine/tokens.js';
import {
  contextWindowFor,
  outputCeilingFor,
  DEFAULT_CONTEXT_WINDOW,
} from '../src/engine/context-window.js';
import { estimateCostUsd } from '../src/engine/pricing.js';
import {
  buildCompactionConfig,
  foldDeterministic,
  maybeAutoCompact,
} from '../src/engine/compaction.js';
import { MessageAccumulator } from '../src/engine/accumulator.js';
import { AbortError } from '../src/errors.js';
import type {
  CompactionConfig,
  EngineConfig,
  EngineDeps,
} from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  APIToolDefinitionParam,
  NonNullableUsage,
  RawMessageStreamEvent,
  SDKMessage,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(prefix: string, len: number): string {
  return (prefix + ' ').repeat(Math.ceil(len / (prefix.length + 1))).slice(0, len);
}

function makeDeps(over: { transport?: EngineDeps['transport'] } = {}): EngineDeps {
  return {
    transport:
      over.transport ??
      ({
        apiKeySource: () => 'user',
        // eslint-disable-next-line require-yield
        async *stream() {
          throw new Error('unexpected transport call');
        },
      } as EngineDeps['transport']),
    builtinTools: new Map(),
    mcp: {} as unknown as EngineDeps['mcp'],
    permissions: {} as unknown as EngineDeps['permissions'],
    hooks: { hasHooks: () => false, run: async () => ({ continue: true, systemMessages: [], additionalContext: [] }) },
    toolContext: {} as unknown as EngineDeps['toolContext'],
    debug: () => undefined,
  };
}

function makeConfig(compaction: CompactionConfig, over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 500,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-batch-f',
    cwd: '/work',
    compaction,
    ...over,
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, boolean>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

const zeroUsage: NonNullableUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** True when `s` contains a lone (unpaired) UTF-16 surrogate. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i += 1; // well-formed pair
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // low surrogate with no preceding high
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// D1 — unmodeled content block must not NaN-poison the history estimate
// ---------------------------------------------------------------------------

describe('D1: estimateBlockTokens default branch (NaN poisoning)', () => {
  it('returns a finite positive estimate for an unmodeled block type', () => {
    const messages = [
      { role: 'user' as const, content: 'hello world' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'searching…' },
          // The accumulator round-trips unmodeled blocks (finding M1) verbatim,
          // so shapes like server_tool_use reach the estimator.
          {
            type: 'server_tool_use',
            id: 'srvtoolu_1',
            name: 'web_search',
            input: { query: 'morimens release date' },
          } as unknown as APIMessageParam['content'] extends string ? never : object,
        ],
      },
    ] as unknown as APIMessageParam[];
    const total = estimateMessagesTokens(messages);
    expect(Number.isFinite(total)).toBe(true);
    expect(Number.isNaN(total)).toBe(false);
    expect(total).toBeGreaterThan(0);
  });

  it('an unmodeled block does not zero out the rest of the history', () => {
    const withoutOpaque = estimateMessagesTokens([
      { role: 'user', content: pad('context', 4000) },
    ]);
    const withOpaque = estimateMessagesTokens([
      { role: 'user', content: pad('context', 4000) },
      {
        role: 'assistant',
        content: [{ type: 'web_search_tool_result', tool_use_id: 'x', content: [] }],
      } as unknown as APIMessageParam,
    ]);
    expect(withOpaque).toBeGreaterThanOrEqual(withoutOpaque);
  });
});

// ---------------------------------------------------------------------------
// D5 — CJK-aware tool-definition overhead estimate
// ---------------------------------------------------------------------------

describe('D5: estimateToolDefsTokens is CJK-aware', () => {
  it('charges CJK descriptions ~1 token per codepoint, not len/4', () => {
    const cjkDescription = '检索社区档案层的全量数据并按平台聚合统计'.repeat(20); // 400 CJK chars
    const defs: APIToolDefinitionParam[] = [
      {
        name: 'kb_search',
        description: cjkDescription,
        input_schema: { type: 'object', properties: {} },
      } as unknown as APIToolDefinitionParam,
    ];
    const estimate = estimateToolDefsTokens(defs);
    const flat = Math.ceil(JSON.stringify(defs).length / 4);
    // The CJK-aware estimate must charge the 400 CJK codepoints ~1 each; the
    // old flat len/4 sat far below that.
    expect(estimate).toBeGreaterThan(flat);
    expect(estimate).toBeGreaterThanOrEqual(400);
  });

  it('still returns 0 for an empty def list', () => {
    expect(estimateToolDefsTokens([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D2 — post-fold suffix-overflow check must charge overheadTokens
// ---------------------------------------------------------------------------

describe('D2: M5 post-fold overflow check includes overheadTokens', () => {
  it('sheds the retained suffix when messages fit but messages+overhead overflow', async () => {
    // window 10000 / maxOutput 500 -> input budget 9500. overhead 8800 forces
    // the trigger and — POST-fold — pushes the retained view (~1400 message
    // tokens) over budget even though the bare message estimate sits well
    // under 9500. Without charging overhead here the shed never fired and the
    // next request 400ed.
    const cfg = buildCompactionConfig({ contextWindowTokens: 10_000 });
    const config = makeConfig(cfg);
    const bigResult = pad('tool output line', 4400); // > preTier budget of 4000
    const view = {
      messages: [
        { role: 'user', content: 'q0 ' + pad('alpha', 2000) },
        { role: 'assistant', content: [{ type: 'text', text: pad('beta', 2000) }] },
        { role: 'user', content: 'q1 ' + pad('gamma', 2000) },
        { role: 'assistant', content: [{ type: 'text', text: pad('delta', 500) }] },
        { role: 'user', content: 'q2 keep me' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { p: 'x' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: bigResult }],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: 'q3' },
        { role: 'assistant', content: [{ type: 'text', text: 'ans' }] },
      ] as APIMessageParam[],
    };
    const msgs = await collect(
      maybeAutoCompact(view, makeDeps(), config, 8800, new AbortController().signal),
    );
    expect(msgs.some((m) => m.type === 'system' && m.subtype === 'compact_boundary')).toBe(true);
    // The oversized tool_result retained in the suffix must have been shed.
    const flat = JSON.stringify(view.messages);
    expect(flat).toContain('chars elided');
    expect(flat).not.toContain(bigResult);
  });
});

// ---------------------------------------------------------------------------
// D3 — failed summary API call still accounts its billed usage
// ---------------------------------------------------------------------------

function bigHistory(): APIMessageParam[] {
  return [
    { role: 'user', content: 'q0 ' + pad('alpha', 2000) },
    { role: 'assistant', content: [{ type: 'text', text: pad('beta', 2000) }] },
    { role: 'user', content: 'q1 ' + pad('gamma', 2000) },
    { role: 'assistant', content: [{ type: 'text', text: pad('delta', 2000) }] },
    { role: 'user', content: 'q2 ' + pad('epsilon', 2000) },
    { role: 'assistant', content: [{ type: 'text', text: pad('zeta', 2000) }] },
    { role: 'user', content: 'q3' },
    { role: 'assistant', content: [{ type: 'text', text: 'fin' }] },
  ];
}

function messageStartEvent(inputTokens: number): RawMessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_partial_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as unknown as RawMessageStreamEvent;
}

describe('D3: failed summary call books its partial usage', () => {
  const cfg = buildCompactionConfig({ contextWindowTokens: 2000, useApiSummary: true });

  it('fires the summary sink with the billed input when the stream dies mid-flight', async () => {
    const transport: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      async *stream() {
        yield messageStartEvent(12_345);
        throw new Error('mid-stream boom');
      },
    };
    const config = makeConfig(cfg);
    const view = { messages: bigHistory() };
    const seen: Array<{ model: string; input: number }> = [];
    const msgs = await collect(
      maybeAutoCompact(view, makeDeps({ transport }), config, 0, new AbortController().signal, (m, u) =>
        seen.push({ model: m, input: u.input_tokens }),
      ),
    );
    // The failure degraded to the deterministic fold — but the spend is booked.
    expect(seen).toEqual([{ model: 'claude-sonnet-4-5', input: 12_345 }]);
    expect(msgs.some((m) => m.type === 'system' && m.subtype === 'compact_boundary')).toBe(true);
    const text = (view.messages[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('[Conversation summary');
  });

  it('books partial usage before rethrowing an abort', async () => {
    const transport: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      async *stream() {
        yield messageStartEvent(777);
        throw new AbortError();
      },
    };
    const config = makeConfig(cfg);
    const view = { messages: bigHistory() };
    const seen: number[] = [];
    await expect(
      collect(
        maybeAutoCompact(view, makeDeps({ transport }), config, 0, new AbortController().signal, (_m, u) =>
          seen.push(u.input_tokens),
        ),
      ),
    ).rejects.toBeInstanceOf(AbortError);
    expect(seen).toEqual([777]);
  });

  it('books nothing when the stream fails before message_start', async () => {
    const transport: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('request-phase failure');
      },
    };
    const config = makeConfig(cfg);
    const view = { messages: bigHistory() };
    const seen: number[] = [];
    await collect(
      maybeAutoCompact(view, makeDeps({ transport }), config, 0, new AbortController().signal, (_m, u) =>
        seen.push(u.input_tokens),
      ),
    );
    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D4 — recap truncation never emits a lone surrogate
// ---------------------------------------------------------------------------

describe('D4: recap truncation is surrogate-safe', () => {
  it('per-line cap cutting through an astral codepoint drops the split pair', () => {
    // 199 ASCII chars + an astral emoji: the 200-unit line cap lands exactly
    // between the surrogate halves.
    const text = 'a'.repeat(199) + '😀 tail';
    const fold = foldDeterministic([{ role: 'user', content: text }], null);
    const recap = (fold[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(hasLoneSurrogate(recap)).toBe(false);
  });

  it('recap body cap stays surrogate-safe across boundary parities', () => {
    // Sweep the cap offset across parities/line positions so at least one pad
    // forces the 4000-char body cap to land inside an emoji run.
    for (let padLen = 0; padLen < 14; padLen += 1) {
      const prefix: APIMessageParam[] = [
        { role: 'user', content: 'x'.repeat(padLen + 1) },
      ];
      for (let i = 0; i < 25; i += 1) {
        prefix.push({
          role: 'assistant',
          content: [{ type: 'text', text: '😀'.repeat(150) }],
        });
      }
      const fold = foldDeterministic(prefix, null);
      const recap = (fold[1]!.content as Array<{ text: string }>)[0]!.text;
      expect(recap).toContain('…[truncated]');
      expect(hasLoneSurrogate(recap)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// D6 — web_search server-tool calls are priced
// ---------------------------------------------------------------------------

describe('D6: estimateCostUsd charges web_search requests', () => {
  it('adds $10 per 1k searches on a priced model', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5', {
      ...zeroUsage,
      web_search_requests: 500,
    });
    expect(cost).toBeCloseTo(5.0, 10);
  });

  it('charges web searches even for a model the token table does not know', () => {
    const cost = estimateCostUsd('gpt-4o', {
      ...zeroUsage,
      web_search_requests: 1000,
    });
    expect(cost).toBeCloseTo(10.0, 10);
  });

  it('keeps token-only estimates unchanged when no searches ran', () => {
    const cost = estimateCostUsd('claude-sonnet-4-5', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(3.0, 10);
  });
});

// ---------------------------------------------------------------------------
// D7 — context-window/output-ceiling tables normalize cloud model ids
// ---------------------------------------------------------------------------

describe('D7: window tables normalize Bedrock/Vertex model ids', () => {
  it('outputCeilingFor matches a Bedrock-form id', () => {
    expect(outputCeilingFor('us.anthropic.claude-opus-4-8-v1:0')).toBe(32_000);
    expect(outputCeilingFor('apac.anthropic.claude-3-5-haiku-20241022-v1:0')).toBe(8_192);
  });

  it('outputCeilingFor matches a Vertex-form id', () => {
    expect(outputCeilingFor('claude-opus-4-8@20260101')).toBe(32_000);
  });

  it('contextWindowFor resolves cloud ids to the canonical row', () => {
    expect(contextWindowFor('us.anthropic.claude-sonnet-4-5-v1:0')).toBe(
      contextWindowFor('claude-sonnet-4-5'),
    );
    expect(contextWindowFor('utterly-unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

// ---------------------------------------------------------------------------
// C2 — content_block_start seed fields guard field omission
// ---------------------------------------------------------------------------

describe('C2: accumulator seeds omitted start-frame fields as empty strings', () => {
  function feedAll(acc: MessageAccumulator, events: unknown[]): void {
    for (const ev of events) acc.feed(ev as RawMessageStreamEvent);
  }

  it('text block with an omitted seed does not become "undefinedfoo"', () => {
    const acc = new MessageAccumulator();
    feedAll(acc, [
      messageStartEvent(10),
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'foo' } },
      { type: 'content_block_stop', index: 0 },
    ]);
    const msg = acc.finalize();
    expect(msg.content[0]).toEqual({ type: 'text', text: 'foo' });
  });

  it('thinking block with omitted seed fields accumulates cleanly', () => {
    const acc = new MessageAccumulator();
    feedAll(acc, [
      messageStartEvent(10),
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'th' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index: 0 },
    ]);
    const msg = acc.finalize();
    expect(msg.content[0]).toEqual({ type: 'thinking', thinking: 'th', signature: 'sig' });
  });

  it('redacted_thinking block with an omitted data seed finalizes as empty string', () => {
    const acc = new MessageAccumulator();
    feedAll(acc, [
      messageStartEvent(10),
      { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking' } },
      { type: 'content_block_stop', index: 0 },
    ]);
    const msg = acc.finalize();
    expect(msg.content[0]).toEqual({ type: 'redacted_thinking', data: '' });
  });

  it('usageSnapshot exposes the partial usage after message_start (D3 support)', () => {
    const acc = new MessageAccumulator();
    expect(acc.usageSnapshot()).toBeUndefined();
    acc.feed(messageStartEvent(4242));
    expect(acc.usageSnapshot()?.input_tokens).toBe(4242);
  });
});
