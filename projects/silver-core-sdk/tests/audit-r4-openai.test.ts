/**
 * Audit r4 (2026-07-17) — OpenAI-protocol transport cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md). One or more `it` per FIXED item:
 *
 *  - Y6-1: cleanBase64 rejects a valid-alphabet but invalid-LENGTH payload
 *    (len ≡ 1 mod 4, or padding not completing a 4-char group) byte-free.
 *  - Soa-2: reasoning_effort without an explicit maxTokensParam defaults the
 *    token cap to max_completion_tokens (reasoning models 400 on max_tokens).
 *  - Soa-4: a tool name outside ^[A-Za-z0-9_-]{1,64}$ raises a locatable debug
 *    WARNING (not a hard reject that would break a lenient gateway).
 *  - Roa-1: delta.refusal is surfaced as assistant text (never a blank turn)
 *    and mapped to stop_reason 'refusal'.
 *  - Roa-2: a legacy delta.function_call stream yields a real tool_use block
 *    (was: stop_reason tool_use with ZERO blocks).
 *  - Roa-4: a nameless, id-less args-only orphan with no sibling is dropped —
 *    no undispatchable empty-name tool_use block, no forged stop_reason.
 *  - Rdt-1: the idle watchdog uses a monotonic clock, so a wall-clock rollback
 *    still aborts a genuinely stalled stream.
 *  - R7s-7: a >2000-char error body is truncated without splitting a surrogate.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  encodeOpenAIRequest,
  OpenAIChatTransport,
  OpenAIStreamTranslator,
} from '../src/transport/openai.js';
import { MessageAccumulator } from '../src/engine/accumulator.js';
import { APIConnectionError, APIStatusError, ConfigurationError } from '../src/errors.js';
import type { RawMessageStreamEvent } from '../src/types.js';
import type { StreamRequest } from '../src/internal/contracts.js';

const enc = new TextEncoder();
const noop = (): void => {};

const REQ: StreamRequest = {
  model: 'gpt-4o',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'hi' }],
};

async function collect(
  gen: AsyncGenerator<RawMessageStreamEvent, void>,
): Promise<RawMessageStreamEvent[]> {
  const out: RawMessageStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  expect.unreachable('expected the promise to reject, but it resolved');
}

/** Run a translator's events through the accumulator and return the message. */
function finalizeEvents(events: RawMessageStreamEvent[]): ReturnType<MessageAccumulator['finalize']> {
  const acc = new MessageAccumulator();
  for (const ev of events) acc.feed(ev);
  return acc.finalize();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Y6-1 — base64 length hygiene
// ---------------------------------------------------------------------------

describe('Y6-1: cleanBase64 validates length, not just alphabet+padding', () => {
  const imageReq = (data: string) => ({
    model: 'm',
    max_tokens: 8,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data } },
        ],
      },
    ],
  });

  it('rejects a valid-alphabet payload of length ≡ 1 (mod 4) byte-free', () => {
    // "YWJjZ" (5 chars) passes BASE64_RE but can never be valid base64.
    const attempt = (): unknown => encodeOpenAIRequest(imageReq('YWJjZ'));
    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(/invalid base64 length/);
    let message = '';
    try {
      attempt();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('YWJjZ'); // never echo the payload
  });

  it('rejects trailing padding that does not complete a 4-char group', () => {
    // "YWJjYQ=" (7 chars, one '='): alphabet+padding pass, but 7 % 4 !== 0.
    expect(() => encodeOpenAIRequest(imageReq('YWJjYQ='))).toThrow(/invalid base64 length/);
  });

  it('still accepts a correctly-sized base64 payload', () => {
    // "YWJjZGVm" is 8 chars (% 4 === 0) -> valid, no throw.
    expect(() => encodeOpenAIRequest(imageReq('YWJjZGVm'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Soa-2 — reasoning models default to max_completion_tokens
// ---------------------------------------------------------------------------

describe('Soa-2: reasoning_effort couples the token-cap param name', () => {
  it('defaults to max_completion_tokens when reasoningEffort is set without maxTokensParam', () => {
    const body = encodeOpenAIRequest(
      { model: 'o3', max_tokens: 1000, messages: [{ role: 'user', content: 'x' }] },
      { reasoningEffort: 'medium' },
    );
    expect(body.max_completion_tokens).toBe(1000);
    expect('max_tokens' in body).toBe(false);
    expect(body.reasoning_effort).toBe('medium');
  });

  it('leaves max_tokens as the default when no reasoning is requested', () => {
    const body = encodeOpenAIRequest(
      { model: 'gpt-4o', max_tokens: 1000, messages: [{ role: 'user', content: 'x' }] },
      {},
    );
    expect(body.max_tokens).toBe(1000);
    expect('max_completion_tokens' in body).toBe(false);
  });

  it('honors an explicit maxTokensParam over the reasoning default', () => {
    const body = encodeOpenAIRequest(
      { model: 'o3', max_tokens: 1000, messages: [{ role: 'user', content: 'x' }] },
      { reasoningEffort: 'high', maxTokensParam: 'max_tokens' },
    );
    expect(body.max_tokens).toBe(1000);
    expect('max_completion_tokens' in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Soa-4 — out-of-spec tool names get a locatable warning
// ---------------------------------------------------------------------------

describe('Soa-4: tool names outside the OpenAI charset/length constraint warn', () => {
  const toolReq = (name: string) => ({
    model: 'm',
    max_tokens: 8,
    messages: [{ role: 'user' as const, content: 'x' }],
    tools: [{ name, input_schema: { type: 'object' } }],
  });

  it('warns on a tool name with disallowed characters', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(toolReq('bad.tool.name'), {}, (m) => lines.push(m));
    expect(lines.some((l) => l.includes('WARNING') && l.includes('bad.tool.name'))).toBe(true);
  });

  it('warns on a tool name over 64 characters', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(toolReq('a'.repeat(65)), {}, (m) => lines.push(m));
    expect(lines.some((l) => l.includes('WARNING'))).toBe(true);
  });

  it('emits no warning for a conforming tool name', () => {
    const lines: string[] = [];
    encodeOpenAIRequest(toolReq('mcp__server__do_thing'), {}, (m) => lines.push(m));
    expect(lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Roa-1 — delta.refusal is decoded
// ---------------------------------------------------------------------------

describe('Roa-1: delta.refusal is surfaced, not silently dropped', () => {
  it('surfaces refusal text and maps to stop_reason refusal', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { refusal: 'I cannot help with that.' } }] }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      ...t.finish(),
    ];
    // A refusal counts as real content, so the transport never treats the turn
    // as an empty message.
    expect(t.sawContent()).toBe(true);
    const msg = finalizeEvents(events);
    expect(msg.content).toEqual([{ type: 'text', text: 'I cannot help with that.' }]);
    expect(msg.stop_reason).toBe('refusal');
  });
});

// ---------------------------------------------------------------------------
// Roa-2 — legacy function_call streaming is decoded
// ---------------------------------------------------------------------------

describe('Roa-2: legacy delta.function_call yields a real tool_use block', () => {
  it('accumulates name/arguments across chunks into one callable tool_use', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { function_call: { name: 'get_weather', arguments: '{"loc":' } } }] }),
      ...t.feed({ choices: [{ delta: { function_call: { arguments: '"SF"}' } } }] }),
      ...t.feed({ choices: [{ delta: {}, finish_reason: 'function_call' }] }),
      ...t.finish(),
    ];
    const msg = finalizeEvents(events);
    expect(msg.stop_reason).toBe('tool_use');
    const toolUses = msg.content.filter((b) => b.type === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({ name: 'get_weather', input: { loc: 'SF' } });
    expect((toolUses[0] as { id: string }).id).toMatch(/^call_\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Roa-4 — a nameless args-only orphan does not forge a tool call
// ---------------------------------------------------------------------------

describe('Roa-4: a nameless/id-less args-only orphan with no sibling is dropped', () => {
  it('emits no empty-name tool_use block and keeps stop_reason end_turn', () => {
    const t = new OpenAIStreamTranslator('m');
    const events = [
      ...t.feed({ id: 'c', choices: [{ delta: { content: 'hi' } }] }),
      // A doubly-malformed fragment: argument bytes but NO id and NO name, and
      // no other tool call anywhere to merge into.
      ...t.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1}' } }] } }] }),
      // Bare EOF (no finish_reason).
      ...t.finish(),
    ];
    const msg = finalizeEvents(events);
    expect(msg.content.some((b) => b.type === 'tool_use')).toBe(false);
    expect(msg.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(msg.stop_reason).toBe('end_turn');
  });
});

// ---------------------------------------------------------------------------
// Rdt-1 — monotonic idle watchdog
// ---------------------------------------------------------------------------

describe('Rdt-1: the idle watchdog survives a wall-clock rollback', () => {
  it('aborts a stalled stream even when Date.now() is frozen', async () => {
    const head = `data: ${JSON.stringify({
      id: 'c',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' } }],
    })}\n\n`;
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(head));
        // never enqueue again, never close -> the connection stalls
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(stalling, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    );
    // Freeze the wall clock: with a Date.now()-based watchdog the measured
    // elapsed stays 0 and the timer re-arms forever; the monotonic
    // performance.now() clock still measures real time and aborts.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'sk', streamIdleTimeoutMs: 50 },
      env: { BPT_HTTP_CLIENT: 'fetch' }, // late-bind the stubbed global fetch
      debug: noop,
    });
    const err = await captureError(collect(transport.stream(REQ)));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as APIConnectionError).code).toBe('stream_idle_timeout');
  });
});

// ---------------------------------------------------------------------------
// R7s-7 — surrogate-safe error-message truncation
// ---------------------------------------------------------------------------

describe('R7s-7: a long error body is truncated without splitting a surrogate', () => {
  it('never leaves a lone surrogate at the 2000-char cut', async () => {
    // U+1F600 is an astral codepoint (a surrogate pair in UTF-16); placed so
    // the pair straddles index 2000, a raw slice(0, 2000) keeps only the high
    // half, leaving a lone surrogate.
    const body = 'a'.repeat(1999) + '\u{1F600}';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 400 })));
    const transport = new OpenAIChatTransport({
      provider: { protocol: 'openai-chat', apiKey: 'sk' },
      env: { BPT_HTTP_CLIENT: 'fetch' }, // late-bind the stubbed global fetch
      debug: noop,
    });
    const err = await captureError(collect(transport.stream(REQ)));
    expect(err).toBeInstanceOf(APIStatusError);
    const message = (err as APIStatusError).message;
    expect(/[\uD800-\uDFFF]/.test(message)).toBe(false);
    expect(message.length).toBe(1999);
  });
});

describe('Soa-3: system message role is configurable for reasoning models', () => {
  const sysReq = {
    model: 'o1',
    system: 'be helpful',
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 16,
  };

  it("defaults to role 'system'", () => {
    const body = encodeOpenAIRequest(sysReq) as { messages: Array<{ role: string }> };
    expect(body.messages[0]!.role).toBe('system');
  });

  it("emits role 'developer' when systemRole is set", () => {
    const body = encodeOpenAIRequest(sysReq, { systemRole: 'developer' }) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]!.role).toBe('developer');
    expect(body.messages[0]!.content).toBe('be helpful');
  });
})
