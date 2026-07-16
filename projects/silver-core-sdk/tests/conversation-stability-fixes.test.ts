/**
 * Conversation-stability fixes (2026-07-13 audit batch). Regression guards for
 * the 13 verified findings fixed on branch claude/sdk-conversation-stability:
 *   H1 compaction no-op on pure tool-loops · H2 doubled-transcript dedup ·
 *   M1 unknown-block graceful degrade · M2 Anthropic truncation visibility ·
 *   M3 checkpoint blob collision · L3 CJK punctuation tokens · L4 rewind to a
 *   no-file-change turn · L5 unsigned-thinking wire strip.
 * (M4/M5/L1/L2/L6 are guarded by their subsystem suites / reasoning.)
 */
// @ts-nocheck

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { partitionForCompaction, buildCompactionConfig } from '../src/engine/compaction.js';
import { estimateTextTokens } from '../src/engine/tokens.js';
import { MessageAccumulator } from '../src/engine/accumulator.js';
import { JsonlSessionStore } from '../src/sessions/store.js';
import { FileCheckpointStore } from '../src/sessions/checkpoints.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';

// --- fixtures ---------------------------------------------------------------

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stability-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** A pure tool-loop history: one string prompt, then only assistant tool_use /
 *  user tool_result pairs (the SDK's headline autonomous shape). */
function pureToolLoop(pairs: number): unknown[] {
  const msgs: unknown[] = [
    { role: 'user', content: 'do the thing'.repeat(10) },
  ];
  for (let i = 0; i < pairs; i += 1) {
    msgs.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: { path: `/f${i}` } }],
    });
    msgs.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: `t${i}`, content: `file ${i} body `.repeat(20) },
      ],
    });
  }
  return msgs;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
function sse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const MSG_START = frame('message_start', {
  type: 'message_start',
  message: {
    id: 'm1', type: 'message', role: 'assistant', model: 'claude-test',
    content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  },
});
async function drain(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
function makeTransport(): AnthropicTransport {
  return new AnthropicTransport({
    provider: { apiKey: 'k', maxRetries: 0 },
    env: { BPT_HTTP_CLIENT: 'fetch' },
    debug: () => undefined,
  });
}

// ---------------------------------------------------------------------------
// H1 — compaction now folds a pure tool-loop
// ---------------------------------------------------------------------------

describe('H1 — compaction folds pure tool-loops', () => {
  const cfg = buildCompactionConfig(undefined);

  it('partitions a single-prompt tool loop at an assistant boundary (was: null)', () => {
    const part = partitionForCompaction(pureToolLoop(40), 2000, cfg);
    expect(part).not.toBeNull();
    // The retained suffix leads with an assistant turn (user-terminated fold).
    expect(part!.suffix[0]!.role).toBe('assistant');
    // No tool_use in the prefix is ever split from its result: the prefix ends
    // on a complete user tool_result turn.
    expect(part!.prefix[part!.prefix.length - 1]!.role).toBe('user');
  });

  it('still returns null when there is no safe boundary at all', () => {
    // Only a prompt + one assistant: prefix would be too small to fold.
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ];
    expect(partitionForCompaction(msgs, 2000, cfg)).toBeNull();
  });

  it('a mixed conversation (genuine follow-up turns) is unchanged: suffix leads user', () => {
    const msgs = [
      { role: 'user', content: 'first task '.repeat(20) },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(200) }] },
      { role: 'user', content: 'second task '.repeat(20) },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ];
    const part = partitionForCompaction(msgs, 400, cfg);
    if (part !== null) expect(part.suffix[0]!.role).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// H2 — read-time uuid dedup collapses a doubled transcript
// ---------------------------------------------------------------------------

describe('H2 — doubled transcript dedup on load', () => {
  it('a transcript materialized twice replays each message once', async () => {
    const store = new JsonlSessionStore({ sessionDir: dir });
    const entries = [
      { type: 'user', uuid: 'u1', session_id: 's', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', uuid: 'a1', session_id: 's', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    ];
    // Simulate the concurrent double-materialization: every entry appended twice.
    for (const e of entries) store.append('s', e);
    for (const e of entries) store.append('s', e);

    const loaded = await store.load('s');
    expect(loaded).not.toBeNull();
    // Without the dedup this was 4 (the doubled transcript); now 2.
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

// ---------------------------------------------------------------------------
// M1 — accumulator degrades gracefully on an unmodeled block type
// ---------------------------------------------------------------------------

describe('M1 — unknown content block does not crash the turn', () => {
  it('registers an unmodeled block opaquely and ignores its deltas', () => {
    const acc = new MessageAccumulator();
    acc.feed(JSON.parse(MSG_START.split('data: ')[1]));
    // A server_tool_use block the accumulator does not model, followed by an
    // input_json_delta that (pre-fix) threw "delta for unopened block index".
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } });
    expect(() =>
      acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } }),
    ).not.toThrow();
    acc.feed({ type: 'content_block_stop', index: 0 });
    acc.feed({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'done' } });
    acc.feed({ type: 'content_block_stop', index: 1 });
    acc.feed({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } });
    acc.feed({ type: 'message_stop' });

    const msg = acc.finalize();
    // The opaque block round-trips, and the healthy text block survives.
    expect(msg.content.map((b) => b.type)).toEqual(['server_tool_use', 'text']);
    expect(msg.content[1]).toMatchObject({ type: 'text', text: 'done' });
  });
});

// ---------------------------------------------------------------------------
// M2 — Anthropic arm surfaces mid-stream truncation
// ---------------------------------------------------------------------------

describe('M2 — truncated stream is visible, complete stream is not', () => {
  it('throws midStreamTruncation when partial content drops with no stop_reason', async () => {
    const body =
      MSG_START +
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is 4' } });
    vi.stubGlobal('fetch', vi.fn(async () => sse(body)));
    let caught: unknown;
    try {
      await drain(makeTransport().stream({ model: 'claude-test', max_tokens: 10, messages: [{ role: 'user', content: 'q' }] } as never));
    } catch (err) {
      caught = err;
    }
    expect((caught as { midStreamTruncation?: boolean }).midStreamTruncation).toBe(true);
  });

  it('completes normally when a terminal stop_reason arrived (only message_stop lost)', async () => {
    const body =
      MSG_START +
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }) +
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    vi.stubGlobal('fetch', vi.fn(async () => sse(body)));
    const events = await drain(makeTransport().stream({ model: 'claude-test', max_tokens: 10, messages: [{ role: 'user', content: 'q' }] } as never));
    expect(events.some((e) => (e as { type?: string }).type === 'message_delta')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M3 — concurrent same-session checkpoints do not collide on the blob path
// ---------------------------------------------------------------------------

describe('M3 — checkpoint blob collision across concurrent stores', () => {
  it('two stores on one session keep distinct pre-images; rewind restores each', async () => {
    const fileA = join(dir, 'a.txt');
    const fileB = join(dir, 'b.txt');
    const cp1 = new FileCheckpointStore({ sessionDir: dir });
    const cp2 = new FileCheckpointStore({ sessionDir: dir });
    cp1.bind('sess');
    cp2.bind('sess');
    cp1.beginTurn('turn');
    cp2.beginTurn('turn');
    cp1.record(fileA, 'ORIGINAL-A'); // both start at seq 0
    cp2.record(fileB, 'ORIGINAL-B');

    const blobs = readdirSync(join(dir, 'checkpoints', 'sess', 'blobs'));
    expect(blobs).toHaveLength(2); // no overwrite -> two distinct blob files

    // Post-edit state on disk, then rewind the turn and verify each file's bytes.
    await writeFile(fileA, 'EDITED-A');
    await writeFile(fileB, 'EDITED-B');
    const reader = new FileCheckpointStore({ sessionDir: dir });
    reader.bind('sess');
    const res = await reader.rewind('turn');
    expect(res.canRewind).toBe(true);
    expect(await readFile(fileA, 'utf8')).toBe('ORIGINAL-A');
    expect(await readFile(fileB, 'utf8')).toBe('ORIGINAL-B');
  });
});

// ---------------------------------------------------------------------------
// L3 — CJK punctuation / fullwidth forms now count ~1 token each
// ---------------------------------------------------------------------------

describe('L3 — CJK punctuation token estimate', () => {
  it('charges fullwidth punctuation ~1 token/char, not len/4', () => {
    const punct = '、。「」《》，'; // 7 CJK-punct codepoints
    // Pre-fix these fell in the len/4 bucket (~2 tokens); now ~1 each.
    expect(estimateTextTokens(punct)).toBeGreaterThanOrEqual(7);
  });
  it('fullwidth ASCII counts as CJK too', () => {
    expect(estimateTextTokens('ＡＢＣＤ')).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// L4 — rewind can target a turn that changed no files
// ---------------------------------------------------------------------------

describe('L4 — rewind to a no-file-change turn', () => {
  it('undoes later edits even when the target turn touched no file', async () => {
    const f = join(dir, 'c.txt');
    const cp = new FileCheckpointStore({ sessionDir: dir });
    cp.bind('sess');
    cp.beginTurn('turnA');
    cp.record(f, 'V0'); // turn A edits f
    cp.beginTurn('turnB'); // turn B is chat-only: NO record
    cp.beginTurn('turnC');
    cp.record(f, 'V1'); // turn C edits f again
    await writeFile(f, 'V2');

    // Rewinding to B must discard C's edit (restore f to its state as-of B = V1's pre-image).
    const res = await cp.rewind('turnB');
    expect(res.canRewind).toBe(true);
    expect(await readFile(f, 'utf8')).toBe('V1');
  });
});

// ---------------------------------------------------------------------------
// L5 — an unsigned thinking block is stripped from the Anthropic wire body
// ---------------------------------------------------------------------------

describe('L5 — unsigned thinking never reaches the wire', () => {
  it('drops an empty-signature thinking block but keeps a signed one', async () => {
    const captured: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: { body?: string }) => {
        captured.push(init.body ?? '');
        return sse(MSG_START + frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) + frame('message_stop', { type: 'message_stop' }));
      }),
    );
    const messages = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'unsigned', signature: '' },
          { type: 'thinking', thinking: 'signed', signature: 'sig-abc' },
          { type: 'text', text: 'answer' },
        ],
      },
      { role: 'user', content: 'again' },
    ];
    await drain(makeTransport().stream({ model: 'claude-test', max_tokens: 10, messages } as never));
    const body = JSON.parse(captured[0]!);
    const thinking = body.messages[1].content.filter((b: { type: string }) => b.type === 'thinking');
    expect(thinking).toHaveLength(1);
    expect(thinking[0].signature).toBe('sig-abc');
  });

  it('drops the WHOLE assistant turn when stripping empties its content (待裁①)', async () => {
    // An assistant message that is ONLY unsigned thinking becomes empty after
    // the strip; sending an empty content array 400s, so the turn is dropped
    // entirely (keeper 2026-07-16: 滤空则整条丢弃).
    const captured: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: { body?: string }) => {
        captured.push(init.body ?? '');
        return sse(MSG_START + frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) + frame('message_stop', { type: 'message_stop' }));
      }),
    );
    const messages = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'only-unsigned', signature: '' }] },
      { role: 'user', content: 'again' },
    ];
    await drain(makeTransport().stream({ model: 'claude-test', max_tokens: 10, messages } as never));
    const body = JSON.parse(captured[0]!);
    // The emptied assistant turn is gone; no empty-content message on the wire.
    expect(body.messages).toHaveLength(2);
    expect(body.messages.every((m: { role: string }) => m.role === 'user')).toBe(true);
    expect(
      body.messages.some(
        (m: { content?: unknown }) => Array.isArray(m.content) && m.content.length === 0,
      ),
    ).toBe(false);
  });
});
