/**
 * Audit r4 (2026-07-17) — compaction cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y2-1: the foldViaApi summary sink bills a call AT MOST ONCE. The D3 catch
 *    now skips its partial-usage booking when the success path already billed,
 *    so a post-bill throw cannot double-record the same summary call. (The pure
 *    double-bill is latent — the post-bill steps are pure/sync today — so the
 *    reachable contract locked here is "the failing/aborting paths each book
 *    the call exactly zero or one times", plus success books exactly once.)
 *  - Y2-2: NOT APPLIED (deliberate) — batch-F D3 deliberately books the
 *    message_start seed on abort for honest cost accounting; see the lock below.
 *  - R7j-4: buildRecap tolerates a tool_use whose `input` is absent/undefined —
 *    JSON.stringify(undefined) is coerced to '{}' instead of crashing firstChars
 *    on `.length` and taking down the whole recap/fold.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCompactionConfig,
  foldDeterministic,
  maybeAutoCompact,
} from '../src/engine/compaction.js';
import type {
  CompactionConfig,
  EngineConfig,
  EngineDeps,
} from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  ContentBlockParam,
  RawMessageStreamEvent,
  SDKMessage,
} from '../src/types.js';
import { AbortError } from '../src/errors.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Helpers (compaction.test.ts conventions)
// ---------------------------------------------------------------------------

function makeDeps(transport: EngineDeps['transport']): EngineDeps {
  return {
    transport,
    builtinTools: new Map(),
    mcp: {} as unknown as EngineDeps['mcp'],
    permissions: {} as unknown as EngineDeps['permissions'],
    hooks: {
      hasHooks: () => false,
      run: async () => ({ continue: true, systemMessages: [], additionalContext: [] }),
    } as unknown as EngineDeps['hooks'],
    toolContext: {} as unknown as EngineDeps['toolContext'],
    debug: () => {},
  };
}

function makeConfig(compaction: CompactionConfig): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 500,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-1',
    cwd: '/work',
    compaction,
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, boolean>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

function pad(prefix: string, len: number): string {
  return (prefix + ' ').repeat(Math.ceil(len / (prefix.length + 1))).slice(0, len);
}

/** History with n genuine user/assistant text pairs, each turn ~len chars. */
function bigHistory(n: number, len = 240): APIMessageParam[] {
  const msgs: APIMessageParam[] = [];
  for (let i = 0; i < n; i += 1) {
    msgs.push({ role: 'user', content: pad(`user turn ${i}`, len) });
    msgs.push({ role: 'assistant', content: [{ type: 'text', text: pad(`assistant reply ${i}`, len) }] });
  }
  return msgs;
}

/** A lone message_start event carrying provider-billed input usage. */
function messageStartEvent(inputTokens: number): RawMessageStreamEvent {
  return {
    type: 'message_start',
    message: {
      id: 'msg_partial',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

const apiSummaryCfg = (): CompactionConfig =>
  buildCompactionConfig({ contextWindowTokens: 2000, useApiSummary: true });

// ---------------------------------------------------------------------------
// R7j-4: recap tolerates a tool_use with absent input
// ---------------------------------------------------------------------------

describe('R7j-4: recap tolerates a tool_use whose input is absent', () => {
  it('foldDeterministic does not crash on a tool_use with undefined input', () => {
    const prefix: APIMessageParam[] = [
      { role: 'user', content: 'run the read' },
      {
        role: 'assistant',
        // Malformed / legacy block: `input` is absent (undefined at runtime).
        // Before the fix, JSON.stringify(undefined) -> undefined -> firstChars
        // threw `Cannot read properties of undefined (reading 'length')`.
        content: [{ type: 'tool_use', id: 't1', name: 'Read' } as unknown as ContentBlockParam],
      },
    ];
    const fold = foldDeterministic(prefix, null);
    const recap = (fold[1]!.content as Array<{ type: 'text'; text: string }>)[0]!.text;
    expect(recap).toContain('Assistant called: Read');
    expect(recap).toContain('{}'); // the coerced empty-object args, not a throw
  });

  it('a well-formed tool_use input still renders verbatim (no regression)', () => {
    const prefix: APIMessageParam[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'ERROR' } }],
      },
    ];
    const recap = (foldDeterministic(prefix, null)[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(recap).toContain('Assistant called: Grep');
    expect(recap).toContain('{"pattern":"ERROR"}');
  });
});

// ---------------------------------------------------------------------------
// Y2-2 NOT APPLIED (deliberate, prior-audit-locked): the audit proposed
// skipping the partial-usage sink on abort, but batch-F D3
// (tests/audit-t50-batch-f.test.ts) deliberately books the message_start seed
// on abort so a cancelled-mid-stream attempt's real token spend stays honest.
// The established D3 accounting wins; this lock documents the KEEP behavior.
// ---------------------------------------------------------------------------

describe('Y2-2 (not applied): a cancelled summary fold still books its partial usage', () => {
  it('abort AFTER message_start rethrows AbortError and books the message_start seed', async () => {
    const transport: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      async *stream() {
        yield messageStartEvent(100_000); // provider already accepted -> input billed
        throw new AbortError(); // ...but the user cancels mid-stream
      },
    };
    const seen: number[] = [];
    await expect(
      collect(
        maybeAutoCompact(
          { messages: bigHistory(12) },
          makeDeps(transport),
          makeConfig(apiSummaryCfg()),
          0,
          new AbortController().signal,
          (_m, u) => seen.push(u.input_tokens),
        ),
      ),
    ).rejects.toBeInstanceOf(AbortError);
    // Per batch-F D3: the seed the provider already billed IS booked.
    expect(seen).toEqual([100_000]);
  });
});

// ---------------------------------------------------------------------------
// Y2-1: the summary sink bills at most once per fold
// ---------------------------------------------------------------------------

describe('Y2-1: the summary sink bills at most once per fold', () => {
  it('a successful fold books the summary call exactly once', async () => {
    const seen: number[] = [];
    await collect(
      maybeAutoCompact(
        { messages: bigHistory(12) },
        makeDeps(new MockTransport([textReplyEvents('MODEL RECAP')])),
        makeConfig(apiSummaryCfg()),
        0,
        new AbortController().signal,
        (_m, u) => seen.push(u.output_tokens),
      ),
    );
    expect(seen).toHaveLength(1);
  });

  it('a mid-stream FAILURE after message_start books the partial usage exactly once', async () => {
    const transport: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      async *stream() {
        yield messageStartEvent(90_000);
        throw new Error('network reset'); // non-abort failure after billing began
      },
    };
    const seen: number[] = [];
    const view = { messages: bigHistory(12) };
    const msgs = await collect(
      maybeAutoCompact(
        view,
        makeDeps(transport),
        makeConfig(apiSummaryCfg()),
        0,
        new AbortController().signal,
        (_m, u) => seen.push(u.input_tokens),
      ),
    );
    // D3 captures the partial (message_start) spend — exactly once (the catch
    // does not re-book) — and the fold degrades to the deterministic recap.
    expect(seen).toEqual([90_000]);
    expect(msgs.some((m) => m.type === 'system' && m.subtype === 'compact_boundary')).toBe(true);
    const foldText = (view.messages[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(foldText).toContain('[Conversation summary');
  });
});
