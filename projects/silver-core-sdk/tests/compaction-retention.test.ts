/**
 * R3 compaction retained regions (SCS-REQ-REPOS-01 §3 R3).
 *
 * Store semantics: declare/replace/remove under a hard byte cap that THROWS
 * on overflow (never a silent truncation). Fold semantics: every declared
 * region is re-stamped VERBATIM into the compaction fold's leading user turn
 * — both the genuine-turn [user, assistant] shape and the H1 pure-tool-loop
 * single-user shape — and keeps surviving fold after fold.
 */

import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../src/errors.js';
import {
  DEFAULT_RETAINED_REGION_MAX_BYTES,
  RetentionStore,
  renderRetainedRegion,
} from '../src/loop-support/retention.js';
import {
  buildCompactionConfig,
  maybeAutoCompact,
} from '../src/engine/compaction.js';
import type {
  EngineConfig,
  EngineDeps,
  HookRunner,
} from '../src/internal/contracts.js';
import type { APIMessageParam, SDKMessage } from '../src/types.js';
import { query } from '../src/query.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

// ---------------------------------------------------------------------------
// Fixtures (mirrors tests/compaction.test.ts)
// ---------------------------------------------------------------------------

const noHooks: HookRunner = {
  hasHooks: () => false,
  run: async () => ({ continue: true, systemMessages: [], additionalContext: [] }),
};

function makeDeps(): EngineDeps {
  return {
    transport: new MockTransport([]),
    builtinTools: new Map(),
    mcp: {} as unknown as EngineDeps['mcp'],
    permissions: {} as unknown as EngineDeps['permissions'],
    hooks: noHooks,
    toolContext: {} as unknown as EngineDeps['toolContext'],
    debug: () => {},
  };
}

function makeConfig(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 500,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-r3',
    cwd: '/work',
    compaction: buildCompactionConfig({ contextWindowTokens: 1200 }),
    ...over,
  };
}

function pad(s: string, len: number): string {
  return s + ' '.repeat(Math.max(0, len - s.length));
}

/** History with n genuine user/assistant pairs, each turn ~len chars. */
function bigHistory(n: number, len = 240): APIMessageParam[] {
  const msgs: APIMessageParam[] = [];
  for (let i = 0; i < n; i += 1) {
    msgs.push({ role: 'user', content: pad(`user turn ${i}`, len) });
    msgs.push({
      role: 'assistant',
      content: [{ type: 'text', text: pad(`assistant reply ${i}`, len) }],
    });
  }
  return msgs;
}

async function drain(gen: AsyncGenerator<SDKMessage, boolean>): Promise<boolean> {
  let next = await gen.next();
  while (next.done !== true) next = await gen.next();
  return next.value;
}

async function foldOnce(view: { messages: APIMessageParam[] }, config: EngineConfig) {
  const compacted = await drain(
    maybeAutoCompact(view, makeDeps(), config, 0, new AbortController().signal),
  );
  expect(compacted).toBe(true);
}

// ---------------------------------------------------------------------------
// RetentionStore
// ---------------------------------------------------------------------------

describe('RetentionStore', () => {
  it('declares, replaces by id, removes, and renders in declaration order', () => {
    const store = new RetentionStore();
    expect(store.isEmpty).toBe(true);
    store.set({ id: 'a', content: 'A1' });
    store.set({ id: 'b', title: 'Bee', content: 'B1' });
    store.set({ id: 'a', content: 'A2' }); // replace keeps declaration slot
    expect(store.regions().map((r) => r.content)).toEqual(['A2', 'B1']);
    expect(store.renderBlocks()).toBe(
      '<retained-context id="a">\nA2\n</retained-context>\n\n' +
        '<retained-context id="b" title="Bee">\nB1\n</retained-context>',
    );
    expect(store.remove('a')).toBe(true);
    expect(store.remove('a')).toBe(false);
    expect(store.regions().map((r) => r.id)).toEqual(['b']);
  });

  it('defaults the cap and rejects a bad cap or empty id', () => {
    expect(new RetentionStore().maxBytes).toBe(DEFAULT_RETAINED_REGION_MAX_BYTES);
    expect(() => new RetentionStore(0)).toThrow(ConfigurationError);
    expect(() => new RetentionStore().set({ id: '', content: 'x' })).toThrow(
      /non-empty/,
    );
  });

  it('THROWS on an over-cap declaration instead of truncating', () => {
    const store = new RetentionStore(120);
    store.set({ id: 'small', content: 'ok' });
    expect(() => store.set({ id: 'big', content: 'y'.repeat(200) })).toThrow(
      ConfigurationError,
    );
    expect(() => store.set({ id: 'big', content: 'y'.repeat(200) })).toThrow(
      /never truncates/,
    );
    // The failed declaration left the store untouched.
    expect(store.regions().map((r) => r.id)).toEqual(['small']);
  });

  it('rejects a region that fits ALONE but overflows COMBINED with existing ones', () => {
    const store = new RetentionStore(200);
    store.set({ id: 'first', content: 'a'.repeat(100) }); // ~142 rendered bytes
    // ~120 rendered bytes: fine alone, over-cap on top of `first`.
    expect(() => store.set({ id: 'second', content: 'b'.repeat(80) })).toThrow(
      ConfigurationError,
    );
    // Message names the actual total, the cap knob, and the no-truncation vow.
    expect(() => store.set({ id: 'second', content: 'b'.repeat(80) })).toThrow(
      /would total \d+ bytes/,
    );
    expect(() => store.set({ id: 'second', content: 'b'.repeat(80) })).toThrow(
      /retainedRegionMaxBytes/,
    );
    expect(() => new RetentionStore(0)).toThrow(/positive/);
  });

  it('replacement re-measures instead of double-counting the old content', () => {
    const store = new RetentionStore(150);
    store.set({ id: 'a', content: 'x'.repeat(80) });
    // Same id, same size: fits ONLY if the old copy is not double-counted.
    store.set({ id: 'a', content: 'y'.repeat(80) });
    expect(store.regions()[0]?.content).toBe('y'.repeat(80));
  });

  it('the byte cap measures the RENDERED region (utf8), not just content', () => {
    const rendered = renderRetainedRegion({ id: 'i', title: 't', content: '缸中脑' });
    expect(rendered).toContain('缸中脑');
    const exact = Buffer.byteLength(rendered, 'utf8');
    const store = new RetentionStore(exact);
    store.set({ id: 'i', title: 't', content: '缸中脑' }); // exactly at cap: fits
    expect(() =>
      new RetentionStore(exact - 1).set({ id: 'i', title: 't', content: '缸中脑' }),
    ).toThrow(ConfigurationError);
  });

  it('buildCompactionConfig surfaces a bad initial declaration up front', () => {
    expect(() =>
      buildCompactionConfig({
        retainedRegionMaxBytes: 10,
        retainedRegions: [{ id: 'too-big', content: 'z'.repeat(100) }],
      }),
    ).toThrow(ConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// Fold integration
// ---------------------------------------------------------------------------

describe('retained regions survive compaction', () => {
  it('stamps every declared region into the fold and keeps the summary', async () => {
    const config = makeConfig();
    config.compaction?.retention?.set({
      id: 'ledger',
      title: 'Reported events',
      content: 'Events reported so far: incident-42',
    });
    const view = { messages: bigHistory(14) };
    await foldOnce(view, config);
    const first = view.messages[0];
    expect(first?.role).toBe('user');
    const text = first?.content as string;
    expect(text).toContain('Please summarize our conversation');
    expect(text).toContain('<retained-context id="ledger" title="Reported events">');
    expect(text).toContain('incident-42');
  });

  it('keeps re-stamping across successive folds (region outlives every fold)', async () => {
    const config = makeConfig();
    config.compaction?.retention?.set({ id: 'r', content: 'MUST-SURVIVE-TOKEN' });
    const view = { messages: bigHistory(14) };
    await foldOnce(view, config);
    // Grow the conversation past the trigger again and fold a second time.
    view.messages.push(...bigHistory(14, 260));
    await foldOnce(view, config);
    expect(view.messages[0]?.content as string).toContain('MUST-SURVIVE-TOKEN');
  });

  it('stamps the H1 single-user fold shape too (pure tool-loop history)', async () => {
    const config = makeConfig();
    config.compaction?.retention?.set({ id: 'r', content: 'H1-SURVIVOR' });
    // Pure tool-loop: one genuine prompt, then assistant/tool_result churn.
    const msgs: APIMessageParam[] = [{ role: 'user', content: 'drive the loop' }];
    for (let i = 0; i < 14; i += 1) {
      msgs.push({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: `t${i}`, name: 'Read', input: { n: i } },
          { type: 'text', text: pad(`working ${i}`, 200) },
        ],
      });
      msgs.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: `t${i}`, content: pad(`out ${i}`, 200) },
        ],
      });
    }
    const view = { messages: msgs };
    await foldOnce(view, config);
    const first = view.messages[0];
    expect(first?.role).toBe('user');
    expect(first?.content as string).toContain('H1-SURVIVOR');
  });

  it('a fold with NO declared regions stays region-free (golden shapes hold)', async () => {
    const config = makeConfig();
    const view = { messages: bigHistory(14) };
    await foldOnce(view, config);
    expect(view.messages[0]?.content as string).not.toContain('<retained-context');
  });
});

// ---------------------------------------------------------------------------
// Query surface
// ---------------------------------------------------------------------------

describe('Query.setRetainedRegion / removeRetainedRegion', () => {
  it('manages the live store and surfaces the over-cap error at the call site', async () => {
    const q = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'test-key', fetch: makeSSEFetch([textReplyEvents('ok')]) },
        persistSession: false,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        model: 'claude-sonnet-4-5',
        compaction: { retainedRegionMaxBytes: 128 },
      },
    });
    q.setRetainedRegion({ id: 'ledger', content: 'small enough' });
    expect(() =>
      q.setRetainedRegion({ id: 'big', content: 'x'.repeat(500) }),
    ).toThrow(ConfigurationError);
    expect(q.removeRetainedRegion('ledger')).toBe(true);
    expect(q.removeRetainedRegion('ledger')).toBe(false);
    // Drain the (single-turn) run so no open handles outlive the test.
    for await (const _m of q) void _m;
  });
});

// ---------------------------------------------------------------------------
// Audit 2026-07-17 batch A: L62 — the cap must measure the JOINED render
// ---------------------------------------------------------------------------

describe('RetentionStore byte cap covers renderBlocks() joiners (L62)', () => {
  it('counts the 2-byte \\n\\n joiner between regions toward the cap', () => {
    const a = { id: 'a', content: 'x' };
    const b = { id: 'b', content: 'y' };
    const rendered = (r: { id: string; content: string }) =>
      Buffer.byteLength(renderRetainedRegion(r), 'utf8');
    // Cap set to EXACTLY the two independent renders: before the fix this
    // admitted both regions while renderBlocks() emitted 2 bytes more.
    const exactSum = rendered(a) + rendered(b);
    const store = new RetentionStore(exactSum, [a]);
    expect(() => store.set(b)).toThrow(ConfigurationError);
    expect(() => store.set(b)).toThrow(/never truncates/);
    // With the joiner budgeted, both fit — and the emitted form obeys the cap.
    const roomy = new RetentionStore(exactSum + 2, [a]);
    roomy.set(b);
    expect(Buffer.byteLength(roomy.renderBlocks(), 'utf8')).toBeLessThanOrEqual(
      roomy.maxBytes,
    );
    expect(Buffer.byteLength(roomy.renderBlocks(), 'utf8')).toBe(exactSum + 2);
  });

  it('holds the invariant for N regions (2·(N−1) joiner bytes)', () => {
    const regions = ['a', 'b', 'c', 'd'].map((id) => ({ id, content: id.repeat(3) }));
    const sum = regions.reduce(
      (acc, r) => acc + Buffer.byteLength(renderRetainedRegion(r), 'utf8'),
      0,
    );
    const cap = sum + 2 * (regions.length - 1);
    const store = new RetentionStore(cap, regions);
    expect(Buffer.byteLength(store.renderBlocks(), 'utf8')).toBe(cap);
    // One byte less than the true joined size must throw at declaration.
    expect(() => new RetentionStore(cap - 1, regions)).toThrow(ConfigurationError);
  });

  it('a single region carries no joiner surcharge', () => {
    const solo = { id: 'solo', content: 'z'.repeat(10) };
    const exact = Buffer.byteLength(renderRetainedRegion(solo), 'utf8');
    const store = new RetentionStore(exact, [solo]);
    expect(Buffer.byteLength(store.renderBlocks(), 'utf8')).toBe(exact);
  });

  it('replacement re-measures the joiner count correctly (no double surcharge)', () => {
    const a = { id: 'a', content: 'aaa' };
    const b = { id: 'b', content: 'bbb' };
    const bigger = { id: 'b', content: 'bbbb' };
    const size = (r: { id: string; content: string }) =>
      Buffer.byteLength(renderRetainedRegion(r), 'utf8');
    const cap = size(a) + size(bigger) + 2;
    const store = new RetentionStore(cap, [a, b]);
    store.set(bigger); // replaces b; still two regions, one joiner
    expect(Buffer.byteLength(store.renderBlocks(), 'utf8')).toBe(cap);
  });
});
