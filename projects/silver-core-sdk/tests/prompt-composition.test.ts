/**
 * Prompt-composition analyzer + emission (BPT-EXTENSION, spec 2026-07-09).
 *
 * 需求 A: per-part token estimate (systemBase / systemAppend / toolDefs /
 *          messages) using the SDK's own estimator (engine/tokens.ts).
 * 需求 B: cache_control breakpoint map — each breakpoint annotated with the
 *          estimated size of the prefix it seals (tools → system → messages).
 * Plus: labeled append segments flow through buildSystemPromptParts, and the
 *       system/prompt_composition message is emitted only under the opt-in flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { analyzeRequestComposition } from '../src/engine/prompt-composition.js';
import { buildSystemPromptParts } from '../src/engine/prompts.js';
import { applyCacheControl } from '../src/engine/cache-control.js';
import {
  estimateMessagesTokens,
  estimateTextTokens,
  estimateToolDefsTokens,
} from '../src/engine/tokens.js';
import { query } from '../src/index.js';
import type { StreamRequest, SystemComposition } from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  APIToolDefinition,
  Options,
  SDKMessage,
  SDKPromptCompositionMessage,
  TextBlockParam,
} from '../src/index.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

const TOOLS: APIToolDefinition[] = [
  { name: 'Read', description: 'read a file', input_schema: { type: 'object' } },
  { name: 'Grep', description: 'search files', input_schema: { type: 'object' } },
];

const MESSAGES: APIMessageParam[] = [
  { role: 'user', content: 'first question about the code' },
  { role: 'assistant', content: 'an answer that is fairly long to weigh something' },
  { role: 'user', content: '再问一个中文问题看看 CJK 计数' },
];

function req(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 1024,
    system: 'You are helpful.',
    messages: MESSAGES,
    tools: TOOLS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 需求 A — per-part estimate
// ---------------------------------------------------------------------------

describe('analyzeRequestComposition — 需求 A per-part estimate', () => {
  it('uses the SDK estimator for toolDefs + messages (same context-window口径)', () => {
    const { promptComposition } = analyzeRequestComposition(req());
    expect(promptComposition.toolDefs).toEqual({
      estTokens: estimateToolDefsTokens(TOOLS),
      count: 2,
    });
    expect(promptComposition.messages).toEqual({
      estTokens: estimateMessagesTokens(MESSAGES),
      count: 3,
    });
  });

  it('splits systemBase / systemAppend from an explicit labeled breakdown', () => {
    const system: SystemComposition = {
      parts: [
        { role: 'base', label: 'base', estTokens: 3064 },
        { role: 'codebase-instructions', label: 'codebase-instructions', estTokens: 210 },
        { role: 'append', label: 'Memory', estTokens: 88 },
        { role: 'environment', label: 'environment', estTokens: 40 },
      ],
    };
    const { promptComposition } = analyzeRequestComposition(req(), system);
    expect(promptComposition.systemBase).toEqual({ estTokens: 3064 });
    expect(promptComposition.systemAppend).toEqual([
      { label: 'codebase-instructions', estTokens: 210 },
      { label: 'Memory', estTokens: 88 },
      { label: 'environment', estTokens: 40 },
    ]);
    // total = base + all append + toolDefs + messages
    const expected =
      3064 +
      210 +
      88 +
      40 +
      estimateToolDefsTokens(TOOLS) +
      estimateMessagesTokens(MESSAGES);
    expect(promptComposition.totalEstTokens).toBe(expected);
  });

  it('derives systemBase/systemAppend from the wire when no breakdown is given', () => {
    const system: TextBlockParam[] = [
      { type: 'text', text: 'BASE harness prose' },
      { type: 'text', text: 'appended project instructions' },
      { type: 'text', text: 'cwd tail' },
    ];
    const { promptComposition } = analyzeRequestComposition(req({ system }));
    expect(promptComposition.systemBase.estTokens).toBe(estimateTextTokens('BASE harness prose'));
    expect(promptComposition.systemAppend).toEqual([
      { estTokens: estimateTextTokens('appended project instructions') },
      { estTokens: estimateTextTokens('cwd tail') },
    ]);
  });

  it('reports EXACT UTF-8 byte sizes complementary to the token estimates', () => {
    // A bare-string system + tools + messages; bytes are exact (not estimates)
    // and CJK counts as its real UTF-8 width. Keeper ruling 2026-07-12.
    const system = 'You are helpful. 中文'; // ASCII + 2 CJK (3 bytes each)
    const { promptComposition } = analyzeRequestComposition(req({ system }));
    const enc = new TextEncoder();
    expect(promptComposition.bytes.system).toBe(enc.encode(system).length);
    expect(promptComposition.bytes.toolDefs).toBe(enc.encode(JSON.stringify(TOOLS)).length);
    expect(promptComposition.bytes.messages).toBe(enc.encode(JSON.stringify(MESSAGES)).length);
    expect(promptComposition.bytes.total).toBe(
      promptComposition.bytes.system +
        promptComposition.bytes.toolDefs +
        promptComposition.bytes.messages,
    );
    // Byte truth diverges from the token estimate — that is the point.
    expect(promptComposition.bytes.system).toBeGreaterThan(system.length - 1);
  });

  it('sums block-array system bytes and reports 0 when tools/system are absent', () => {
    const system: TextBlockParam[] = [
      { type: 'text', text: 'alpha' },
      { type: 'text', text: 'beta' },
    ];
    const enc = new TextEncoder();
    const withBlocks = analyzeRequestComposition(req({ system })).promptComposition;
    expect(withBlocks.bytes.system).toBe(enc.encode('alpha').length + enc.encode('beta').length);
    const noTools = analyzeRequestComposition(
      req({ system: '', tools: [] }),
    ).promptComposition;
    expect(noTools.bytes.system).toBe(0);
    expect(noTools.bytes.toolDefs).toBe(0);
  });

  it('reports no engine-owned base for the host segments form (systemBase 0)', () => {
    const system: SystemComposition = {
      parts: [
        { role: 'segment', label: 'core', estTokens: 100 },
        { role: 'segment', label: 'team', estTokens: 50 },
      ],
    };
    const { promptComposition } = analyzeRequestComposition(req(), system);
    expect(promptComposition.systemBase).toEqual({ estTokens: 0 });
    expect(promptComposition.systemAppend).toEqual([
      { label: 'core', estTokens: 100 },
      { label: 'team', estTokens: 50 },
    ]);
  });

  it('handles an empty tool set (count 0, est 0)', () => {
    const { promptComposition } = analyzeRequestComposition(req({ tools: undefined }));
    expect(promptComposition.toolDefs).toEqual({ estTokens: 0, count: 0 });
  });
});

// ---------------------------------------------------------------------------
// 需求 B — cache breakpoint map
// ---------------------------------------------------------------------------

describe('analyzeRequestComposition — 需求 B cache breakpoints', () => {
  const base = 'BASE harness prose that is stable across runs';
  const project = 'appended project instructions and memory';
  const cwd = 'Working directory: /repo';

  it('maps every wire cache_control marker to a monotonic prefix estimate', () => {
    const raw = req({
      system: [
        { type: 'text', text: base },
        { type: 'text', text: project },
        { type: 'text', text: cwd },
      ],
    });
    // Dual system split + tool + last-message breakpoints (the 4-breakpoint layout).
    const outgoing = applyCacheControl(raw, {
      enabled: true,
      cacheSystemBoundary: 'dual',
      cacheMessages: true,
    });
    const { cacheBreakpoints } = analyzeRequestComposition(outgoing);

    // Expectations derive from the OUTGOING wire (cache_control markers add bytes
    // to the tools JSON; blockifying the last message adds per-block overhead) —
    // the analyzer describes what is actually sent, not the pre-shaped input.
    const toolsEst = estimateToolDefsTokens(outgoing.tools ?? []);
    const baseEst = estimateTextTokens(base);
    const projEst = estimateTextTokens(project);
    const cwdEst = estimateTextTokens(cwd);
    const msgEst = estimateMessagesTokens(outgoing.messages);

    expect(cacheBreakpoints).toEqual([
      { afterPart: 'toolDefs', prefixEstTokens: toolsEst },
      { afterPart: 'systemBase', prefixEstTokens: toolsEst + baseEst },
      { afterPart: 'systemAppend[0]', prefixEstTokens: toolsEst + baseEst + projEst },
      {
        afterPart: 'messages[last]',
        prefixEstTokens: toolsEst + baseEst + projEst + cwdEst + msgEst,
      },
    ]);

    // Prefix estimates strictly increase in wire prefix order.
    const prefixes = cacheBreakpoints.map((b) => b.prefixEstTokens);
    for (let i = 1; i < prefixes.length; i++) {
      expect(prefixes[i]!).toBeGreaterThan(prefixes[i - 1]!);
    }
    // The final message breakpoint seals the whole request (tools+system+messages).
    expect(prefixes[prefixes.length - 1]).toBe(
      toolsEst + baseEst + projEst + cwdEst + msgEst,
    );
  });

  it('estimates 需求 A from the pre-cache request and 需求 B from the wire', () => {
    const raw = req({
      system: [
        { type: 'text', text: base },
        { type: 'text', text: project },
        { type: 'text', text: cwd },
      ],
    });
    const outgoing = applyCacheControl(raw, {
      enabled: true,
      cacheSystemBoundary: 'dual',
      cacheMessages: true,
    });
    // 3-arg form: content (A) from `raw`, markers (B) from `outgoing`.
    const { promptComposition, cacheBreakpoints } = analyzeRequestComposition(
      raw,
      undefined,
      outgoing,
    );
    // 需求 A matches the SDK's own estimator on the RAW (pre-cache) inputs — the
    // same口径 the compaction layer sizes the context window with.
    expect(promptComposition.toolDefs.estTokens).toBe(estimateToolDefsTokens(TOOLS));
    expect(promptComposition.messages.estTokens).toBe(estimateMessagesTokens(MESSAGES));
    // 需求 B's tools prefix reflects the WIRE bytes: the last tool now carries a
    // cache_control marker, so the wire tools serialize larger than the raw defs.
    const toolBp = cacheBreakpoints.find((b) => b.afterPart === 'toolDefs')!;
    expect(toolBp.prefixEstTokens).toBe(estimateToolDefsTokens(outgoing.tools ?? []));
    expect(toolBp.prefixEstTokens).toBeGreaterThan(promptComposition.toolDefs.estTokens);
  });

  it('returns an empty breakpoint list when caching is off (identity request)', () => {
    const raw = req({
      system: [
        { type: 'text', text: base },
        { type: 'text', text: project },
      ],
    });
    const outgoing = applyCacheControl(raw, { enabled: false });
    expect(analyzeRequestComposition(outgoing).cacheBreakpoints).toEqual([]);
  });

  it('places only the tools + single-system breakpoint for a string system', () => {
    const raw = req({ system: 'You are helpful.' });
    const outgoing = applyCacheControl(raw, { enabled: true, cacheMessages: false });
    const { cacheBreakpoints } = analyzeRequestComposition(outgoing);
    const names = cacheBreakpoints.map((b) => b.afterPart);
    expect(names).toContain('toolDefs');
    expect(names).toContain('systemBase'); // the string became one cached block
    expect(names).not.toContain('messages[last]'); // cacheMessages:false
  });
});

// ---------------------------------------------------------------------------
// buildSystemPromptParts — labeled parts + appendSegments
// ---------------------------------------------------------------------------

describe('buildSystemPromptParts — labeled composition parts', () => {
  const ctx = { cwd: '/repo', toolNames: ['Read', 'Grep'] } as const;

  it('labels base + append + appendSegments in wire order', () => {
    const parts = buildSystemPromptParts(
      {
        type: 'preset',
        preset: 'claude_code',
        append: 'legacy append blob',
        appendSegments: [
          { label: 'Root', text: 'root layer text' },
          { label: 'Memory', text: 'memory layer text' },
        ],
      },
      { ...ctx, variant: 'v1' },
    ).parts;
    const labels = parts.map((p) => p.label);
    expect(labels).toEqual(['base', 'append', 'Root', 'Memory']);
    expect(parts.every((p) => p.estTokens > 0)).toBe(true);
    expect(parts[0]!.role).toBe('base');
    expect(parts[2]!.role).toBe('append');
  });

  it('keeps appendSegments byte-identical to the same text via append (labels are metadata)', () => {
    const viaSegments = buildSystemPromptParts(
      {
        type: 'preset',
        preset: 'claude_code',
        appendSegments: [{ label: 'X', text: 'shared tail' }],
      },
      { ...ctx, variant: 'v1' },
    ).stable;
    const viaAppend = buildSystemPromptParts(
      { type: 'preset', preset: 'claude_code', append: 'shared tail' },
      { ...ctx, variant: 'v1' },
    ).stable;
    expect(viaSegments).toBe(viaAppend);
  });

  it('produces a base part for the minimal + string forms', () => {
    expect(buildSystemPromptParts(undefined, { ...ctx }).parts.map((p) => p.role)).toEqual(['base']);
    expect(buildSystemPromptParts('custom', { ...ctx }).parts).toEqual([
      { role: 'base', label: 'base', estTokens: estimateTextTokens('custom') },
    ]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end emission — behind includePromptComposition
// ---------------------------------------------------------------------------

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-promptcomp-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function opts(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key' },
    sessionDir: path.join(sandbox, '.sessions'),
    cwd: sandbox,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: 'claude-sonnet-4-5',
    ...extra,
  } as Options;
}

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function compositionMsgs(msgs: SDKMessage[]): SDKPromptCompositionMessage[] {
  return msgs.filter(
    (m): m is SDKPromptCompositionMessage =>
      m.type === 'system' && (m as { subtype?: string }).subtype === 'prompt_composition',
  );
}

describe('system/prompt_composition emission', () => {
  it('emits a per-request composition message before the result when opted in', async () => {
    vi.stubGlobal('fetch', makeSSEFetch([textReplyEvents('done')]));
    const messages = await collect(
      query({
        prompt: 'go',
        options: opts({
          includePromptComposition: true,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            appendSegments: [{ label: 'Memory', text: 'a memory note' }],
          },
        }),
      }),
    );
    const comps = compositionMsgs(messages);
    expect(comps.length).toBeGreaterThanOrEqual(1);
    const c = comps[0]!;
    expect(c.subtype).toBe('prompt_composition');
    expect(c.model).toBeTruthy();
    // 需求 A: buckets present, base is the (large) v5 harness, tool count matches.
    expect(c.promptComposition.systemBase.estTokens).toBeGreaterThan(0);
    expect(c.promptComposition.toolDefs.count).toBeGreaterThan(0);
    // The caller's labeled append bucket flows through to the breakdown.
    const labels = c.promptComposition.systemAppend.map((p) => p.label);
    expect(labels).toContain('Memory');
    // 需求 B: at least the stable prefix breakpoints are present with estimates.
    expect(c.cacheBreakpoints.length).toBeGreaterThan(0);
    expect(c.cacheBreakpoints.every((b) => b.prefixEstTokens > 0)).toBe(true);
    // Ordering: composition surfaces before the terminal result.
    const names = messages.map((m) => `${m.type}/${(m as { subtype?: string }).subtype ?? ''}`);
    expect(names.indexOf('system/prompt_composition')).toBeLessThan(
      names.findIndex((n) => n.startsWith('result/')),
    );
  });

  it('emits nothing without the flag (default off)', async () => {
    vi.stubGlobal('fetch', makeSSEFetch([textReplyEvents('done')]));
    const messages = await collect(query({ prompt: 'go', options: opts() }));
    expect(compositionMsgs(messages)).toHaveLength(0);
  });
});
