/**
 * Regression tests for the context-compaction subsystem:
 * token estimator, context-window table, and the compaction engine.
 */

import { describe, expect, it } from 'vitest';

import {
  estimateContentTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTextTokens,
  estimateToolDefsTokens,
} from '../src/engine/tokens.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  contextWindowFor,
} from '../src/engine/context-window.js';
import {
  buildCompactionConfig,
  detectManualCompact,
  foldDeterministic,
  maybeAutoCompact,
  partitionForCompaction,
  runManualCompact,
  shouldAutoCompact,
  SUMMARIZER_SYSTEM,
  SUMMARIZER_SYSTEM_PROVENANCE,
} from '../src/engine/compaction.js';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  CompactionConfig,
  EngineConfig,
  EngineDeps,
} from '../src/internal/contracts.js';
import type {
  AggregatedHookResult,
  HookRunner,
} from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  APIToolDefinition,
  ContentBlockParam,
  SDKMessage,
} from '../src/types.js';
import { AbortError } from '../src/errors.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function userMsg(text: string): APIMessageParam {
  return { role: 'user', content: text };
}
function asstText(text: string): APIMessageParam {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}
function asstTool(name: string, input: Record<string, unknown>, id: string): APIMessageParam {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] };
}
function userToolResult(id: string, content: string, isError = false): APIMessageParam {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
  };
}

function pad(prefix: string, len: number): string {
  return (prefix + ' ').repeat(Math.ceil(len / (prefix.length + 1))).slice(0, len);
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type HookCall = {
  event: string;
  input: unknown;
  matchValue: string | undefined;
};

function makeHooks(opts: {
  has?: boolean;
  result?: Partial<AggregatedHookResult>;
  calls?: HookCall[];
}): HookRunner {
  return {
    hasHooks: () => opts.has ?? false,
    run: async (event, input, _toolUseID, matchValue): Promise<AggregatedHookResult> => {
      opts.calls?.push({ event, input, matchValue });
      return {
        continue: opts.result?.continue ?? true,
        systemMessages: opts.result?.systemMessages ?? [],
        additionalContext: opts.result?.additionalContext ?? [],
        ...(opts.result?.decision !== undefined ? { decision: opts.result.decision } : {}),
      };
    },
  };
}

function makeDeps(over: {
  hooks?: HookRunner;
  transport?: EngineDeps['transport'];
  debug?: (m: string) => void;
}): EngineDeps {
  const debugLines: string[] = [];
  return {
    transport: over.transport ?? new MockTransport([]),
    builtinTools: new Map(),
    mcp: {} as unknown as EngineDeps['mcp'],
    permissions: {} as unknown as EngineDeps['permissions'],
    hooks: over.hooks ?? makeHooks({ has: false }),
    toolContext: {} as unknown as EngineDeps['toolContext'],
    debug: over.debug ?? ((m: string): void => void debugLines.push(m)),
  };
}

function makeConfig(compaction: CompactionConfig, over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 500,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-1',
    cwd: '/work',
    compaction,
    ...over,
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

/** History with n genuine user/assistant pairs, each turn ~len chars. */
function bigHistory(n: number, len = 240): APIMessageParam[] {
  const msgs: APIMessageParam[] = [];
  for (let i = 0; i < n; i += 1) {
    msgs.push(userMsg(pad(`user turn ${i}`, len)));
    msgs.push(asstText(pad(`assistant reply ${i}`, len)));
  }
  return msgs;
}

// ===========================================================================
// tokens.ts
// ===========================================================================

describe('tokens.ts', () => {
  it('estimateTextTokens is ceil(chars/4)', () => {
    expect(estimateTextTokens('abcd')).toBe(1);
    expect(estimateTextTokens('abcde')).toBe(2);
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('a'.repeat(400))).toBe(100);
  });

  it('estimateContentTokens: string path vs block array with overhead', () => {
    expect(estimateContentTokens('abcd')).toBe(1);
    const blocks: ContentBlockParam[] = [{ type: 'text', text: 'abcd' }];
    // per-block overhead (3) + text (1)
    expect(estimateContentTokens(blocks)).toBe(4);
  });

  it('estimateContentTokens counts tool_use name + JSON input', () => {
    const input = { path: '/a/b' };
    const blocks: ContentBlockParam[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input },
    ];
    const expected =
      3 + estimateTextTokens('Read') + estimateTextTokens(JSON.stringify(input));
    expect(estimateContentTokens(blocks)).toBe(expected);
  });

  it('estimateContentTokens counts tool_result text and images', () => {
    const strResult: ContentBlockParam[] = [
      { type: 'tool_result', tool_use_id: 't1', content: 'abcdefgh' },
    ];
    expect(estimateContentTokens(strResult)).toBe(3 + estimateTextTokens('abcdefgh'));

    const imgResult: ContentBlockParam[] = [
      {
        type: 'tool_result',
        tool_use_id: 't2',
        content: [
          { type: 'text', text: 'abcd' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
        ],
      },
    ];
    // block overhead 3 + text 1 + image 1600
    expect(estimateContentTokens(imgResult)).toBe(3 + 1 + 1600);
  });

  it('estimateContentTokens counts a top-level image at the flat rate', () => {
    const blocks: ContentBlockParam[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
    ];
    expect(estimateContentTokens(blocks)).toBe(3 + 1600);
  });

  it('estimateMessageTokens adds per-message overhead; estimateMessagesTokens is additive', () => {
    const a = userMsg('abcd');
    const b = asstText('efgh');
    expect(estimateMessageTokens(a)).toBe(8 + 1);
    expect(estimateMessagesTokens([a, b])).toBe(
      estimateMessageTokens(a) + estimateMessageTokens(b),
    );
  });

  it('estimateToolDefsTokens is ceil(JSON length / 4); empty -> 0', () => {
    expect(estimateToolDefsTokens([])).toBe(0);
    const defs: APIToolDefinition[] = [
      { name: 'X', input_schema: { type: 'object' } },
    ];
    expect(estimateToolDefsTokens(defs)).toBe(Math.ceil(JSON.stringify(defs).length / 4));
  });

  // --- Finding 1: language-aware CJK estimation -------------------------------
  it('charges CJK codepoints ~1 token each (not chars/4)', () => {
    // Han: 100 ideographs -> ~100 tokens, NOT ceil(100/4)=25.
    expect(estimateTextTokens('中'.repeat(100))).toBe(100);
    // Hiragana / Katakana / Hangul are equally dense.
    expect(estimateTextTokens('ひらがな')).toBe(4);
    expect(estimateTextTokens('カタカナ')).toBe(4);
    expect(estimateTextTokens('한글')).toBe(2);
  });

  it('mixes CJK (1/codepoint) with Latin (len/4) additively', () => {
    // 'abcd' -> ceil(4/4)=1 ; '中文' -> 2 CJK tokens -> total 3.
    expect(estimateTextTokens('abcd中文')).toBe(3);
    // 30 Han chars -> 30 tokens (regression: old ceil(30/4)=8).
    expect(estimateTextTokens('字'.repeat(30))).toBe(30);
  });

  it('counts astral CJK Ext-B ideographs as 1 token (surrogate pair)', () => {
    // U+20000 is a single ideograph encoded as a surrogate pair (length 2).
    expect(estimateTextTokens('\u{20000}')).toBe(1);
    expect(estimateTextTokens('\u{20000}\u{20001}')).toBe(2);
  });

  it('leaves pure-ASCII estimates unchanged (no regression)', () => {
    expect(estimateTextTokens('abcd')).toBe(1);
    expect(estimateTextTokens('a'.repeat(400))).toBe(100);
    expect(estimateTextTokens('')).toBe(0);
  });
});

// ===========================================================================
// context-window.ts
// ===========================================================================

describe('context-window.ts', () => {
  it('matches opus/sonnet/haiku prefixes to 200000', () => {
    expect(contextWindowFor('claude-opus-4-1')).toBe(200_000);
    expect(contextWindowFor('claude-sonnet-4-5')).toBe(200_000);
    expect(contextWindowFor('claude-haiku-4-5')).toBe(200_000);
  });

  it('returns DEFAULT_CONTEXT_WINDOW for an unknown model', () => {
    expect(contextWindowFor('gpt-4o')).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowFor('')).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });
});

// ===========================================================================
// buildCompactionConfig
// ===========================================================================

describe('buildCompactionConfig', () => {
  it('applies all defaults when undefined', () => {
    const cfg = buildCompactionConfig(undefined);
    expect(cfg).toEqual({
      enabled: true,
      autoThresholdRatio: 0.85,
      keepRatio: 0.3,
      minRecentTurns: 2,
      useApiSummary: false,
      recognizeCommand: true,
      customInstructions: undefined,
      contextWindowTokens: undefined,
    });
  });

  it('honors overrides and enabled:false passthrough', () => {
    const cfg = buildCompactionConfig({
      enabled: false,
      autoThresholdRatio: 0.5,
      keepRatio: 0.1,
      minRecentTurns: 5,
      useApiSummary: true,
      recognizeCommand: false,
      customInstructions: 'keep auth',
      contextWindowTokens: 1_000_000,
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoThresholdRatio).toBe(0.5);
    expect(cfg.keepRatio).toBe(0.1);
    expect(cfg.minRecentTurns).toBe(5);
    expect(cfg.useApiSummary).toBe(true);
    expect(cfg.recognizeCommand).toBe(false);
    expect(cfg.customInstructions).toBe('keep auth');
    expect(cfg.contextWindowTokens).toBe(1_000_000);
  });
});

// ===========================================================================
// detectManualCompact
// ===========================================================================

describe('detectManualCompact', () => {
  const cfg = buildCompactionConfig(undefined);

  it('bare /compact -> null instructions', () => {
    expect(detectManualCompact([userMsg('/compact')], cfg)).toEqual({
      customInstructions: null,
    });
  });

  it('/compact with instructions -> parsed instructions', () => {
    expect(detectManualCompact([userMsg('/compact focus on X')], cfg)).toEqual({
      customInstructions: 'focus on X',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(detectManualCompact([userMsg('  /compact  ')], cfg)).toEqual({
      customInstructions: null,
    });
    expect(detectManualCompact([userMsg('/compact   keep tests  ')], cfg)).toEqual({
      customInstructions: 'keep tests',
    });
  });

  it('non-user last message -> null', () => {
    expect(detectManualCompact([userMsg('/compact'), asstText('hi')], cfg)).toBeNull();
  });

  it('tool_result-only user turn -> null', () => {
    expect(detectManualCompact([userToolResult('t1', '/compact')], cfg)).toBeNull();
  });

  it('plain prose is not a command', () => {
    expect(detectManualCompact([userMsg('compact the file please')], cfg)).toBeNull();
    expect(detectManualCompact([userMsg('please /compact this')], cfg)).toBeNull();
  });

  it('empty history -> null', () => {
    expect(detectManualCompact([], cfg)).toBeNull();
  });

  it('text-block array command is recognized', () => {
    const msg: APIMessageParam = { role: 'user', content: [{ type: 'text', text: '/compact go' }] };
    expect(detectManualCompact([msg], cfg)).toEqual({ customInstructions: 'go' });
  });
});

// ===========================================================================
// partitionForCompaction (pairing preservation)
// ===========================================================================

describe('partitionForCompaction', () => {
  // [user, asst(tool_use), user(tool_result), asst(text), user, asst(tool_use), user(tool_result), asst(text)]
  function pairedHistory(): APIMessageParam[] {
    return [
      userMsg(pad('first prompt', 400)),
      asstTool('Bash', { cmd: 'ls' }, 'tu1'),
      userToolResult('tu1', pad('result one', 400)),
      asstText(pad('assistant analysis one', 400)),
      userMsg(pad('second prompt', 400)),
      asstTool('Bash', { cmd: 'pwd' }, 'tu2'),
      userToolResult('tu2', pad('result two', 400)),
      asstText(pad('assistant analysis two', 400)),
    ];
  }

  it('cuts only on a genuine user turn and never splits a tool pair', () => {
    const msgs = pairedHistory();
    const cfg = buildCompactionConfig({ minRecentTurns: 1, keepRatio: 0.9 });
    const part = partitionForCompaction(msgs, 1500, cfg);
    expect(part).not.toBeNull();
    // The only genuine user turn (besides index 0) is index 4.
    expect(part!.prefix.length).toBe(4);
    // suffix begins at a genuine user turn
    const head = part!.suffix[0]!;
    expect(head.role).toBe('user');
    expect(typeof head.content === 'string').toBe(true);
    // prefix must not END on an assistant tool_use immediately preceding a
    // tool_result that landed in the suffix.
    const lastPrefix = part!.prefix[part!.prefix.length - 1]!;
    const isToolUse =
      Array.isArray(lastPrefix.content) &&
      lastPrefix.content.some((b) => b.type === 'tool_use');
    expect(isToolUse).toBe(false);
  });

  it('respects minRecentTurns (keeps >= N genuine user turns in suffix)', () => {
    const msgs = bigHistory(6); // 6 genuine user turns
    const cfg = buildCompactionConfig({ minRecentTurns: 3, keepRatio: 0.9 });
    const part = partitionForCompaction(msgs, 1500, cfg);
    expect(part).not.toBeNull();
    const genuineInSuffix = part!.suffix.filter(
      (m) => m.role === 'user' && typeof m.content === 'string',
    ).length;
    expect(genuineInSuffix).toBeGreaterThanOrEqual(3);
  });

  it('respects keepBudget (suffix estimate <= keepBudget when turns fit)', () => {
    const msgs = bigHistory(10);
    const cfg = buildCompactionConfig({ minRecentTurns: 1, keepRatio: 0.2 });
    const budget = 4000;
    const part = partitionForCompaction(msgs, budget, cfg);
    expect(part).not.toBeNull();
    const keepBudget = Math.floor(budget * 0.2);
    expect(estimateMessagesTokens(part!.suffix)).toBeLessThanOrEqual(keepBudget);
  });

  it('returns null when the foldable prefix is below minFoldTokens', () => {
    // Two tiny turns; prefix would be far below 15% of the budget.
    const msgs = [userMsg('hi'), asstText('yo'), userMsg('again'), asstText('ok')];
    const cfg = buildCompactionConfig({ minRecentTurns: 1, keepRatio: 0.9 });
    expect(partitionForCompaction(msgs, 100_000, cfg)).toBeNull();
  });

  it('returns null for a single giant turn with no genuine-user cut point', () => {
    const msgs = [userMsg(pad('one enormous turn', 4000)), asstText(pad('reply', 4000))];
    const cfg = buildCompactionConfig({ minRecentTurns: 1 });
    expect(partitionForCompaction(msgs, 4000, cfg)).toBeNull();
  });

  // --- Finding 2: don't fold a prefix that can't shrink (re-fold churn) -------
  it('returns null when the chosen prefix is only the synthetic pair (no count reduction)', () => {
    // bigHistory(3): genuine user turns at indices 0,2,4. With minRecentTurns=2
    // and a generous keepRatio, the only viable cut keeps indices 2 & 4 in the
    // suffix, leaving a 2-message prefix [user0, asst0]. Folding that into a
    // length-2 synthetic pair reduces nothing -> must return null.
    const msgs = bigHistory(3);
    const cfg = buildCompactionConfig({ minRecentTurns: 2, keepRatio: 0.9 });
    // budget 500: keepBudget=450 (fits the suffix), minFoldTokens=75 (< the
    // prefix estimate), so ONLY the new length guard can reject this fold.
    const part = partitionForCompaction(msgs, 500, cfg);
    // Sanity: the prefix estimate really does clear minFoldTokens, proving the
    // rejection comes from the length guard, not the ratio guard.
    const prefixEst = estimateMessagesTokens(msgs.slice(0, 2));
    expect(prefixEst).toBeGreaterThanOrEqual(Math.floor(500 * 0.15));
    expect(part).toBeNull();
  });
});

// ===========================================================================
// foldDeterministic
// ===========================================================================

describe('foldDeterministic', () => {
  it('returns an alternation-safe length-2 user/assistant pair', () => {
    const prefix = bigHistory(3);
    const pair = foldDeterministic(prefix, null);
    expect(pair).toHaveLength(2);
    expect(pair[0]!.role).toBe('user');
    expect(pair[1]!.role).toBe('assistant');
    expect(Array.isArray(pair[1]!.content)).toBe(true);
    const block = (pair[1]!.content as ContentBlockParam[])[0]!;
    expect(block.type).toBe('text');
  });

  it('recap names the compacted message count', () => {
    const prefix = bigHistory(2); // 4 messages
    const pair = foldDeterministic(prefix, null);
    const text = (pair[1]!.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('the earlier 4 messages were compacted');
  });

  it('appends custom instructions to the summary request turn', () => {
    const pair = foldDeterministic(bigHistory(2), 'keep the auth details');
    expect(pair[0]!.content).toContain('keep the auth details');
  });

  it('caps the recap at 4000 chars with a truncation marker', () => {
    // Many turns -> recap body exceeds the cap.
    const prefix = bigHistory(60, 200);
    const pair = foldDeterministic(prefix, null);
    const text = (pair[1]!.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text.length).toBeLessThanOrEqual(4000 + '…[truncated]'.length);
    expect(text.endsWith('…[truncated]')).toBe(true);
  });

  it('summarizes tool_result turns with a count and error flag', () => {
    const prefix: APIMessageParam[] = [
      userMsg(pad('prompt', 300)),
      asstTool('Bash', { cmd: 'x' }, 'tu1'),
      userToolResult('tu1', pad('err', 300), true),
    ];
    const text = (foldDeterministic(prefix, null)[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('Tool results: 1 result(s) (some errors)');
    expect(text).toContain('Assistant called: Bash');
  });
});

// ===========================================================================
// shouldAutoCompact
// ===========================================================================

describe('shouldAutoCompact', () => {
  const cfg = buildCompactionConfig({ autoThresholdRatio: 0.85 });

  it('returns preTokens once the estimate reaches the trigger', () => {
    const msgs = bigHistory(20); // large
    const res = shouldAutoCompact(msgs, 0, 2000, 500, cfg);
    expect(res).not.toBeNull();
    expect(res!.preTokens).toBe(estimateMessagesTokens(msgs));
  });

  it('returns null below the trigger', () => {
    const msgs = [userMsg('hi')];
    expect(shouldAutoCompact(msgs, 0, 200_000, 4096, cfg)).toBeNull();
  });

  it('folds overhead into the estimate', () => {
    const msgs = [userMsg('hi')];
    // window 200, reserved 100 -> E 100, trigger floor(85)=85. Overhead pushes over.
    const res = shouldAutoCompact(msgs, 1000, 200, 100, cfg);
    expect(res).not.toBeNull();
    expect(res!.preTokens).toBe(estimateMessagesTokens(msgs) + 1000);
  });

  // --- Finding 2: degenerate window must NOT always-fire ----------------------
  it('returns null when window <= reservedOutputTokens (compaction impossible)', () => {
    // window 8000 <= reserved 8192: old code clamped budget to 1, triggerAt=0,
    // and ALWAYS fired. Must now return null (do not compact).
    const msgs = bigHistory(4);
    expect(shouldAutoCompact(msgs, 0, 8000, 8192, cfg)).toBeNull();
    // exact-equality boundary is also impossible (no positive input budget).
    expect(shouldAutoCompact(msgs, 0, 500, 500, cfg)).toBeNull();
  });

  // --- Finding 1: CJK conversation actually trips the trigger -----------------
  it('a large Chinese conversation trips the trigger where chars/4 would not', () => {
    const han = '观测者的意识在缸中沉浮'; // 11 Han chars
    const msgs: APIMessageParam[] = [];
    for (let i = 0; i < 20; i += 1) {
      msgs.push(userMsg(han.repeat(20)));
      msgs.push(asstText(han.repeat(20)));
    }
    const window = 8000;
    const reserved = 500;
    const triggerAt = Math.floor((window - reserved) * 0.85);
    // Language-aware estimate exceeds the trigger -> compaction fires.
    expect(estimateMessagesTokens(msgs)).toBeGreaterThanOrEqual(triggerAt);
    expect(shouldAutoCompact(msgs, 0, window, reserved, cfg)).not.toBeNull();
    // The old chars/4 estimate would have been ~4x smaller and stayed BELOW
    // the trigger, i.e. it would never have compacted (the reported failure).
    const charCount = msgs.reduce((n, m) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : (m.content as Array<{ type: string; text?: string }>)
              .map((b) => b.text ?? '')
              .join('');
      return n + text.length;
    }, 0);
    expect(Math.ceil(charCount / 4)).toBeLessThan(triggerAt);
  });
});

// ===========================================================================
// maybeAutoCompact / performCompaction (via drivers)
// ===========================================================================

describe('maybeAutoCompact', () => {
  const smallWindow: CompactionConfig = buildCompactionConfig({ contextWindowTokens: 2000 });

  it('folds the view in place and yields a compact_boundary (auto)', async () => {
    const view = { messages: bigHistory(12) };
    const before = view.messages.length;
    const preEstimate = estimateMessagesTokens(view.messages);
    const deps = makeDeps({});
    const config = makeConfig(smallWindow);

    const msgs = await collect(maybeAutoCompact(view, deps, config, 0, new AbortController().signal));
    const boundary = msgs.find(
      (m) => m.type === 'system' && m.subtype === 'compact_boundary',
    );
    expect(boundary).toBeDefined();
    expect(boundary).toMatchObject({
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: preEstimate },
    });
    // View is folded: synthetic user/assistant pair now heads a shorter array.
    expect(view.messages.length).toBeLessThan(before);
    expect(view.messages[0]!.role).toBe('user');
    expect(view.messages[1]!.role).toBe('assistant');
  });

  it('is a no-op below the trigger threshold', async () => {
    const view = { messages: [userMsg('hi'), asstText('there')] };
    const deps = makeDeps({});
    const config = makeConfig(smallWindow);
    const msgs = await collect(maybeAutoCompact(view, deps, config, 0, new AbortController().signal));
    expect(msgs).toHaveLength(0);
    expect(view.messages).toHaveLength(2);
  });

  // --- Finding 2: degenerate window skips with a debug warn (no churn) --------
  it('skips (no fold, no boundary) with a debug warn when window <= maxOutputTokens', async () => {
    const debugLines: string[] = [];
    const deps = makeDeps({ debug: (m) => void debugLines.push(m) });
    // window 8000 <= maxOutputTokens 8192: a 12-turn conversation that fits fine
    // must NOT be folded (old code folded it on turn 1, then churned each turn).
    const config = makeConfig(buildCompactionConfig({ contextWindowTokens: 8000 }), {
      maxOutputTokens: 8192,
    });
    const view = { messages: bigHistory(12) };
    const before = view.messages.length;
    const msgs = await collect(
      maybeAutoCompact(view, deps, config, 0, new AbortController().signal),
    );
    expect(msgs).toHaveLength(0);
    expect(view.messages).toHaveLength(before);
    expect(debugLines.some((l) => l.includes('compaction impossible'))).toBe(true);
  });

  it('fires PreCompact with the right trigger + custom_instructions', async () => {
    const calls: HookCall[] = [];
    const deps = makeDeps({ hooks: makeHooks({ has: true, calls }) });
    const config = makeConfig(buildCompactionConfig({ contextWindowTokens: 2000, customInstructions: 'keep auth' }));
    const view = { messages: bigHistory(12) };
    await collect(maybeAutoCompact(view, deps, config, 0, new AbortController().signal));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe('PreCompact');
    expect(calls[0]!.matchValue).toBe('auto');
    expect(calls[0]!.input).toMatchObject({
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: 'keep auth',
    });
  });

  it('PreCompact continue:false vetoes compaction (view unchanged, no boundary)', async () => {
    const deps = makeDeps({ hooks: makeHooks({ has: true, result: { continue: false } }) });
    const config = makeConfig(smallWindow);
    const view = { messages: bigHistory(12) };
    const snapshot = [...view.messages];
    const msgs = await collect(maybeAutoCompact(view, deps, config, 0, new AbortController().signal));
    expect(msgs).toHaveLength(0);
    expect(view.messages).toEqual(snapshot);
  });

  it('PreCompact additionalContext flows into the fold instructions', async () => {
    const deps = makeDeps({
      hooks: makeHooks({ has: true, result: { additionalContext: ['FOCUS ON AUTH'] } }),
    });
    const config = makeConfig(smallWindow);
    const view = { messages: bigHistory(12) };
    await collect(maybeAutoCompact(view, deps, config, 0, new AbortController().signal));
    const userTurn = view.messages[0]!;
    expect(typeof userTurn.content === 'string' ? userTurn.content : '').toContain('FOCUS ON AUTH');
  });
});

// ===========================================================================
// runManualCompact
// ===========================================================================

describe('runManualCompact', () => {
  it('drops the /compact command and folds with trigger:manual', async () => {
    const cfg = buildCompactionConfig({ contextWindowTokens: 2000 });
    const view = { messages: [...bigHistory(12), userMsg('/compact')] };
    const deps = makeDeps({});
    const config = makeConfig(cfg);
    const msgs = await collect(
      runManualCompact(view, null, deps, config, 0, new AbortController().signal),
    );
    const boundary = msgs.find((m) => m.type === 'system' && m.subtype === 'compact_boundary');
    expect(boundary).toMatchObject({ compact_metadata: { trigger: 'manual' } });
    // The '/compact' command is never in the folded view.
    const stringified = JSON.stringify(view.messages);
    expect(stringified).not.toContain('/compact');
  });
});

// ===========================================================================
// foldViaApi (useApiSummary) via runManualCompact
// ===========================================================================

describe('foldViaApi (useApiSummary)', () => {
  const cfg = buildCompactionConfig({ contextWindowTokens: 2000, useApiSummary: true });

  it('folds using the model summary text and reports the summary call usage', async () => {
    const transport = new MockTransport([textReplyEvents('MODEL SUMMARY TEXT')]);
    const deps = makeDeps({ transport });
    const config = makeConfig(cfg);
    const view = { messages: [...bigHistory(12), userMsg('/compact')] };
    const seen: Array<{ model: string; output: number; apiMs: number }> = [];
    const msgs = await collect(
      runManualCompact(view, null, deps, config, 0, new AbortController().signal, (m, u, apiMs) =>
        seen.push({ model: m, output: u.output_tokens, apiMs }),
      ),
    );
    expect(msgs.some((m) => m.type === 'system' && m.subtype === 'compact_boundary')).toBe(true);
    const asst = view.messages[1]!;
    const text = (asst.content as Array<{ text: string }>)[0]!.text;
    expect(text).toBe('MODEL SUMMARY TEXT');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.model).toBe('claude-sonnet-4-5');
    expect(seen[0]!.output).toBe(7);
    expect(seen[0]!.apiMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the deterministic fold when the summary call throws', async () => {
    const throwing: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('boom');
      },
    };
    const deps = makeDeps({ transport: throwing });
    const config = makeConfig(cfg);
    const view = { messages: [...bigHistory(12), userMsg('/compact')] };
    const msgs = await collect(
      runManualCompact(view, null, deps, config, 0, new AbortController().signal),
    );
    expect(msgs.some((m) => m.type === 'system' && m.subtype === 'compact_boundary')).toBe(true);
    const text = (view.messages[1]!.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('[Conversation summary');
  });

  it('rethrows AbortError from the summary call (no fallback)', async () => {
    const aborting: EngineDeps['transport'] = {
      apiKeySource: () => 'user',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new AbortError();
      },
    };
    const deps = makeDeps({ transport: aborting });
    const config = makeConfig(cfg);
    const view = { messages: [...bigHistory(12), userMsg('/compact')] };
    await expect(
      collect(runManualCompact(view, null, deps, config, 0, new AbortController().signal)),
    ).rejects.toBeInstanceOf(AbortError);
  });
});

describe('summarizer prompt provenance (corpus-sync guard, Track B)', () => {
  const archive = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'Public-Info-Pool',
    'Reference',
    'Claude-Code-System-Prompts',
    'system-prompts',
  );
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

  it('reproduces the official 5-section continuation-summary structure', () => {
    for (const h of ['Task Overview', 'Current State', 'Important Discoveries', 'Next Steps', 'Context to Preserve']) {
      expect(SUMMARIZER_SYSTEM).toContain(h);
    }
    expect(SUMMARIZER_SYSTEM).toContain('continuation summary');
    // adaptation: the <summary> wrapper the official requests is omitted (we fold raw text)
    expect(SUMMARIZER_SYSTEM).not.toContain('<summary>');
  });

  it.runIf(existsSync(archive))('is faithful to its cited archive source', () => {
    const body = norm(stripHeader(readFileSync(join(archive, `${SUMMARIZER_SYSTEM_PROVENANCE.slug}.md`), 'utf8')));
    const desc = norm(SUMMARIZER_SYSTEM);
    // every non-variable sentence of our reproduction must appear in the archive
    const drifted = norm(SUMMARIZER_SYSTEM)
      .split(/(?<=[.:])\s+/)
      .map(norm)
      .filter((s) => s.length >= 40 && !s.includes('${'))
      .filter((s) => !body.includes(s.slice(0, 60)));
    expect(drifted, `not found in archive:\n${drifted.join('\n')}`).toEqual([]);
    expect(desc.length).toBeGreaterThan(0);
  });
});
