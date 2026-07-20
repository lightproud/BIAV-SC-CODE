/**
 * Audit r4 (2026-07-17) — accumulator cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - U1-1: a content_block_delta for an index whose content_block_stop already
 *    arrived must NOT mutate the finalized (closed = whole) block.
 *  - U1-2: a DUPLICATE content_block_start for an index already opened/closed
 *    must not wholesale-overwrite the pending block (losing accumulated text
 *    and stranding a stale closedIndices entry).
 *  - U1-4: a message_delta frame that OMITS `usage` is a no-op, never a
 *    TypeError that kills the turn.
 *  - V8-1: usage folding keeps cache_creation/cache_read (the loop's recovery
 *    fold dropped them); the shared foldMessageDeltaUsage primitive and the
 *    accumulator's own merge both preserve the cache fields.
 *
 * U1-3 (finalize emits thinking with signature:'') is NOT fixed here — it is a
 * deliberate, test-locked design (OpenAI reasoning arm) whose replay-400 risk
 * is defended at the transport request-building layer, not the accumulator.
 * See the structured skip note for the full rationale.
 */

import { describe, expect, it } from 'vitest';

import { MessageAccumulator, foldMessageDeltaUsage } from '../src/engine/accumulator.js';
import type { RawMessageStreamEvent, Usage } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers (engine.test.ts MessageAccumulator conventions)
// ---------------------------------------------------------------------------

function startEvent(usage: Partial<Usage> = {}): RawMessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-test-1',
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

// ---------------------------------------------------------------------------
// U1-1: late delta on a CLOSED index must not corrupt the finalized block
// ---------------------------------------------------------------------------

describe('U1-1: a delta on an already-closed index is dropped, not applied', () => {
  it('a late text_delta after content_block_stop does not append to the closed text', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    // A late/duplicate fragment for the CLOSED index arrives.
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' CORRUPTED' } });

    const msg = acc.finalize();
    expect(msg.content).toEqual([{ type: 'text', text: 'answer' }]);
  });

  it('a late MISMATCHED delta on a closed index is a no-op instead of throwing a protocol error', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    // Without the closed-index guard this wrong-typed late delta reached the
    // typed switch and THREW a mismatch error, killing the whole turn.
    expect(() =>
      acc.feed({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
      } as unknown as RawMessageStreamEvent),
    ).not.toThrow();
    expect(acc.finalize().content).toEqual([{ type: 'text', text: 'done' }]);
  });
});

// ---------------------------------------------------------------------------
// U1-2: duplicate content_block_start must not overwrite the pending block
// ---------------------------------------------------------------------------

describe('U1-2: a duplicate content_block_start keeps the first registration', () => {
  it('a duplicate start mid-stream does not reset accumulated text', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } });
    // A stray repeat start for the SAME open index would wipe 'hello' to ''.
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } });
    acc.feed({ type: 'content_block_stop', index: 0 });

    expect(acc.finalize().content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('a duplicate start after close does not strand a stale closedIndices entry', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent());
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'kept' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    // Reopening index 0 as a fresh empty block would leave it EMPTY at finalize
    // (closedIndices still marks 0 closed) — the reported content-loss path.
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });

    expect(acc.finalize().content).toEqual([{ type: 'text', text: 'kept' }]);
  });
});

// ---------------------------------------------------------------------------
// U1-4: a message_delta that omits `usage` must not TypeError
// ---------------------------------------------------------------------------

describe('U1-4: a usage-less message_delta frame degrades to a no-op', () => {
  it('feeding a message_delta without a usage field does not throw and preserves the seed', () => {
    const acc = new MessageAccumulator();
    acc.feed(startEvent({ input_tokens: 40, output_tokens: 3 }));
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    expect(() =>
      acc.feed({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        // usage omitted entirely (non-conformant / gateway-rewritten frame)
      } as unknown as RawMessageStreamEvent),
    ).not.toThrow();

    const msg = acc.finalize();
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.usage.input_tokens).toBe(40);
    expect(msg.usage.output_tokens).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// V8-1: usage folding must keep cache_creation / cache_read
// ---------------------------------------------------------------------------

describe('V8-1: cache_creation/cache_read survive the usage fold', () => {
  it('foldMessageDeltaUsage merges both cache fields with max and is undefined-safe', () => {
    const u: Usage = {
      input_tokens: 10,
      output_tokens: 0,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 200,
    };
    foldMessageDeltaUsage(u, {
      output_tokens: 7,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 50,
    });
    expect(u.output_tokens).toBe(7); // replaces
    expect(u.cache_creation_input_tokens).toBe(500); // max(100, 500)
    expect(u.cache_read_input_tokens).toBe(200); // max(200, 50)

    // A usage-less frame is a no-op (shares the U1-4 guard).
    foldMessageDeltaUsage(u, undefined);
    expect(u.output_tokens).toBe(7);
    expect(u.cache_creation_input_tokens).toBe(500);
  });

  it('the accumulator folds cache tokens from a message_delta into the finalized usage', () => {
    const acc = new MessageAccumulator();
    acc.feed(
      startEvent({ cache_creation_input_tokens: 100, cache_read_input_tokens: 200 }),
    );
    acc.feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    acc.feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } });
    acc.feed({ type: 'content_block_stop', index: 0 });
    // The wire delta carries larger cumulative cache counts (typed usage omits
    // the cache fields, so the wire shape is cast in the accumulator/tests).
    acc.feed({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        output_tokens: 5,
        cache_creation_input_tokens: 400,
        cache_read_input_tokens: 300,
      },
    } as unknown as RawMessageStreamEvent);

    const msg = acc.finalize();
    expect(msg.usage.cache_creation_input_tokens).toBe(400);
    expect(msg.usage.cache_read_input_tokens).toBe(300);
    expect(msg.usage.output_tokens).toBe(5);
  });
});
