/**
 * Memory system M2 tests (spec R7 / R8 / R9):
 *  - R7: the pre-compaction flush turn (injected before the fold, exactly
 *    once per episode, suppressed by a PreCompact deny) and the session-end
 *    progress-card round (normal end only; result absorbed);
 *  - R8: governance limits (file size / directory count / view truncation)
 *    at both enforcement layers, and the memoryHealth accounting fields on
 *    SDKRunMetrics;
 *  - R9: cards-mode validation (structured retryable errors).
 */

import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/query.js';
import { runAgentLoop } from '../src/engine/loop.js';
import { buildCompactionConfig } from '../src/engine/compaction.js';
import {
  MEMORY_COMPACTION_FLUSH_PROMPT,
  MEMORY_SESSION_END_PROMPT,
} from '../src/engine/prompt-fragments.js';
import {
  DEFAULT_CARDS_CONFIG,
  DEFAULT_MEMORY_LIMITS,
  createLocalFilesystemMemoryStore,
  createMemoryHealth,
  createMemoryTool,
  parseMemoryCards,
  truncateViewBody,
  validateCardsContent,
} from '../src/tools/memory/index.js';
import type {
  MemoryStore,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '../src/types.js';
import type {
  AggregatedHookResult,
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
  PermissionGate,
  ToolContext,
  APIMessageParam,
} from '../src/internal/contracts.js';
import {
  MockTransport,
  pricedReplyEvents,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';

// ---------------------------------------------------------------------------
// Shared doubles
// ---------------------------------------------------------------------------

function emptyMcp(): McpRegistry {
  return {
    async connectAll() {},
    statuses: () => [],
    allTools: () => [],
    has: () => false,
    async call() {
      return { content: [{ type: 'text' as const, text: '' }], isError: false };
    },
    listResources: async () => [],
    readResource: async () => [],
    async reconnect() {},
    setEnabled() {},
    async setServers() {},
    async closeAll() {},
  };
}

function allowGate(): PermissionGate {
  return {
    async check(_t, input) {
      return { decision: 'allow', updatedInput: input };
    },
    setMode() {},
    getMode: () => 'default',
    applyUpdates() {},
    denials: () => [],
  };
}

function noHooks(): HookRunner {
  return {
    hasHooks: () => false,
    async run() {
      return {
        continue: true,
        systemMessages: [],
        additionalContext: [],
      } as AggregatedHookResult;
    },
  };
}

function denyPreCompactHooks(calls: string[]): HookRunner {
  return {
    hasHooks: (e) => e === 'PreCompact',
    async run(event) {
      calls.push(event);
      return {
        continue: false,
        systemMessages: [],
        additionalContext: [],
      } as AggregatedHookResult;
    },
  };
}

function toolCtx(): ToolContext {
  return {
    cwd: '/',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}

const echoTool: BuiltinTool = {
  name: 'Echo',
  description: 'echo',
  inputSchema: { type: 'object', properties: {} },
  readOnly: true,
  async execute() {
    return { content: 'ok' };
  },
};

function engineConfig(extra: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-test-1',
    maxOutputTokens: 100,
    systemPrompt: '',
    includePartialMessages: false,
    sessionId: 'sess-m2',
    cwd: '/',
    ...extra,
  };
}

function makeDeps(transport: MockTransport, extra: Partial<EngineDeps> = {}): EngineDeps {
  return {
    transport,
    builtinTools: new Map([[echoTool.name, echoTool]]),
    mcp: emptyMcp(),
    permissions: allowGate(),
    hooks: noHooks(),
    toolContext: toolCtx(),
    debug: () => {},
    ...extra,
  };
}

/** Alternating user/assistant filler large enough to trip a 2000-token window. */
function bigHistory(turns: number): APIMessageParam[] {
  const out: APIMessageParam[] = [];
  for (let i = 0; i < turns; i += 1) {
    out.push(
      i % 2 === 0
        ? { role: 'user', content: `q${i} ${'x'.repeat(1200)}` }
        : { role: 'assistant', content: [{ type: 'text', text: `a${i} ${'y'.repeat(1200)}` }] },
    );
  }
  if (out[out.length - 1]!.role !== 'user') {
    out.push({ role: 'user', content: 'go' });
  }
  return out;
}

async function collectLoop(
  history: APIMessageParam[],
  deps: EngineDeps,
  config: EngineConfig,
): Promise<SDKMessage[]> {
  const msgs: SDKMessage[] = [];
  for await (const m of runAgentLoop(history, deps, config)) msgs.push(m);
  return msgs;
}

const flatText = (c: unknown): string => JSON.stringify(c);

// ---------------------------------------------------------------------------
// R7: pre-compaction flush turn (engine level)
// ---------------------------------------------------------------------------

describe('R7: pre-compaction memory flush', () => {
  const compaction = () => buildCompactionConfig({ contextWindowTokens: 2000 });

  it('injects the flush turn BEFORE the fold, then folds on the next check', async () => {
    const transport = new MockTransport([
      toolUseReplyEvents('Echo', {}),
      textReplyEvents('done'),
    ]);
    const history = bigHistory(12);
    const requestView = { messages: [...history] };
    const deps = makeDeps(transport, { requestView });
    const config = engineConfig({
      compaction: compaction(),
      memoryFlush: { prompt: MEMORY_COMPACTION_FLUSH_PROMPT },
    });

    const msgs = await collectLoop(history, deps, config);

    // Request 1 carries the injected flush turn as its trailing user message
    // (no fold yet: the pre-fold context is what the model must save from).
    expect(flatText(transport.requests[0]!.messages)).toContain(
      'Context compaction is about to summarize',
    );
    // The fold happened on the SECOND check (after the flush turn ran).
    const boundary = msgs.find(
      (m) => m.type === 'system' && (m as { subtype?: string }).subtype === 'compact_boundary',
    );
    expect(boundary).toBeDefined();
    // Exactly one flush injection across the whole run.
    const flushCount = requestView.messages.filter((m) =>
      flatText(m.content).includes('Context compaction is about to summarize'),
    ).length;
    expect(flushCount).toBe(1);
    const result = msgs.at(-1) as SDKResultMessage;
    expect(result.subtype).toBe('success');
  });

  it('a PreCompact deny suppresses the flush and the fold', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const history = bigHistory(12);
    const requestView = { messages: [...history] };
    const hookCalls: string[] = [];
    const deps = makeDeps(transport, {
      requestView,
      hooks: denyPreCompactHooks(hookCalls),
    });
    const config = engineConfig({
      compaction: compaction(),
      memoryFlush: { prompt: MEMORY_COMPACTION_FLUSH_PROMPT },
    });

    const msgs = await collectLoop(history, deps, config);

    expect(hookCalls).toContain('PreCompact');
    expect(flatText(transport.requests[0]!.messages)).not.toContain(
      'Context compaction is about to summarize',
    );
    expect(
      msgs.some(
        (m) => m.type === 'system' && (m as { subtype?: string }).subtype === 'compact_boundary',
      ),
    ).toBe(false);
  });

  it('no flush config -> the fold happens directly (M1 behavior unchanged)', async () => {
    const transport = new MockTransport([textReplyEvents('ok')]);
    const history = bigHistory(12);
    const requestView = { messages: [...history] };
    const deps = makeDeps(transport, { requestView });
    const config = engineConfig({ compaction: compaction() });

    const msgs = await collectLoop(history, deps, config);
    expect(
      msgs.some(
        (m) => m.type === 'system' && (m as { subtype?: string }).subtype === 'compact_boundary',
      ),
    ).toBe(true);
    expect(flatText(transport.requests[0]!.messages)).not.toContain(
      'Context compaction is about to summarize',
    );
  });
});

// ---------------------------------------------------------------------------
// Query-level fixtures (R7 session end + R8 metrics)
// ---------------------------------------------------------------------------

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-m2-cwd-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-m2-sess-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
  await rm(sessionDir, { recursive: true, force: true });
});

function baseOptions(stub: SSEFetchStub, extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false, fetch: stub },
    cwd,
    sessionDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    settingSources: [],
    ...extra,
  };
}

async function collectQuery(prompt: string, options: Options): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of query({ prompt, options })) out.push(m);
  return out;
}

describe('R7: session-end progress-card round (query level)', () => {
  it('runs after the final result, executes memory writes, absorbs its own result', async () => {
    const stub = makeSSEFetch([
      textReplyEvents('the answer'),
      toolUseReplyEvents('memory', {
        command: 'create',
        path: '/memories/MEMORY.md',
        file_text: 'progress: done\n',
      }),
      textReplyEvents('progress saved'),
    ]);
    const messages = await collectQuery('do the task', baseOptions(stub, { memory: {} }));

    // Exactly ONE result in the public stream — the task's own.
    const results = messages.filter((m): m is SDKResultMessage => m.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]!.subtype).toBe('success');
    if (results[0]!.subtype === 'success') {
      expect(results[0]!.result).toBe('the answer');
    }
    // The round's request carried the session-end prompt.
    expect(flatText(stub.requests[1]!.body['messages'])).toContain(
      'The session is ending.',
    );
    // The write actually landed in the store.
    expect(
      await readFile(join(cwd, '.claude', 'memory', 'memories', 'MEMORY.md'), 'utf8'),
    ).toBe('progress: done\n');
    // The round's assistant messages streamed AFTER the result.
    const resultIdx = messages.findIndex((m) => m.type === 'result');
    const savedIdx = messages.findIndex(
      (m) => m.type === 'assistant' && flatText(m.message.content).includes('progress saved'),
    );
    expect(savedIdx).toBeGreaterThan(resultIdx);
    // The prompt constant is what rode the wire.
    expect(flatText(stub.requests[1]!.body['messages'])).toContain(
      MEMORY_SESSION_END_PROMPT.slice(0, 40),
    );
  });

  it('待裁⑤: a session-end round that adds cost yields a corrected final result', async () => {
    // Priced RESPONSE model so the round accrues real cost. The round's result
    // is absorbed, but its spend grows the session totals past what the task's
    // own (already-yielded) result reported — so a corrected final result is
    // emitted carrying the COMPLETE cumulative cost (keeper 2026-07-16 完整修).
    const stub = makeSSEFetch([
      pricedReplyEvents('the answer', { inputTokens: 100 }),
      pricedReplyEvents('progress saved', { inputTokens: 900 }),
    ]);
    const messages = await collectQuery('do the task', baseOptions(stub, { memory: {} }));
    const results = messages.filter((m): m is SDKResultMessage => m.type === 'result');
    expect(results).toHaveLength(2); // task's own + accounting-corrected final
    const [first, corrected] = results;
    expect(first!.subtype).toBe('success');
    if (first!.subtype === 'success') expect(first!.result).toBe('the answer');
    // The fixture is genuinely PRICED — if it silently reverted to an unpriced
    // model, cost would be 0 and this whole accounting assertion would be vacuous.
    expect(first!.total_cost_usd).toBeGreaterThan(0);
    // Complete cumulative cost (round's spend now included), no new per-turn usage.
    expect(corrected!.total_cost_usd).toBeGreaterThan(first!.total_cost_usd);
    expect(corrected!.num_turns).toBe(0);
    expect(corrected!.usage.input_tokens).toBe(0);
    // The corrected result is the LAST message on the stream.
    expect(messages[messages.length - 1]!.type).toBe('result');
    // 丙 (keeper 2026-07-18): the correction REUSES the first result's uuid, so a
    // consumer that dedupes by uuid collapses the two into one (latest-wins =
    // complete accounting), while a non-deduping consumer still sees both.
    expect(corrected!.uuid).toBe(first!.uuid);
  });

  it('a zero-cost session-end round adds NO corrected result (exactly one)', async () => {
    // Unpriced responses -> acct.cost stays 0 -> nothing to correct -> the
    // "exactly one public result" invariant is preserved when there is no delta.
    const stub = makeSSEFetch([
      textReplyEvents('the answer'),
      textReplyEvents('progress saved'),
    ]);
    const messages = await collectQuery('do the task', baseOptions(stub, { memory: {} }));
    expect(messages.filter((m) => m.type === 'result')).toHaveLength(1);
  });

  it('sessionEndUpdate: false -> exactly one request, no extra round', async () => {
    const stub = makeSSEFetch([textReplyEvents('answer')]);
    const messages = await collectQuery(
      'hi',
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    expect(stub.requests).toHaveLength(1);
    expect(messages.filter((m) => m.type === 'result')).toHaveLength(1);
  });

  it('an error termination never reaches the session-end round', async () => {
    const stub = makeSSEFetch([]);
    const messages = await collectQuery(
      'hi',
      baseOptions(stub, { memory: {}, maxTurns: 0 }),
    );
    const last = messages.at(-1) as SDKResultMessage;
    expect(last.type).toBe('result');
    expect(last.subtype).toBe('error_max_turns');
    // No turn ran, no session-end round fired.
    expect(stub.requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R7 write-back observability: memoryHealth.sessionEndUpdate (keeper
// 2026-07-20, BPT memory-rot diagnosis) — a host must be able to detect a
// session that ended WITHOUT updating its progress card, on every exit path.
// ---------------------------------------------------------------------------

describe('R7 observability: sessionEndUpdate stamp + memoryHealthSnapshot()', () => {
  async function collectWithHandle(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: Options,
  ) {
    const q = query({ prompt, options });
    const messages: SDKMessage[] = [];
    for await (const m of q) messages.push(m);
    return { q, messages };
  }

  it("a completed round stamps 'ran'; the corrected final result carries the REFRESHED snapshot", async () => {
    const stub = makeSSEFetch([
      pricedReplyEvents('the answer', { inputTokens: 100 }),
      pricedReplyEvents('progress saved', { inputTokens: 900 }),
    ]);
    const { q, messages } = await collectWithHandle(
      'do the task',
      baseOptions(stub, { memory: {} }),
    );
    expect(q.memoryHealthSnapshot()?.sessionEndUpdate).toBe('ran');
    const results = messages.filter((m): m is SDKResultMessage => m.type === 'result');
    expect(results).toHaveLength(2);
    // The task's own result predates the decision point -> its snapshot is
    // honest 'pending'; the corrected final result is emitted AFTER the round
    // and must NOT re-report that stale snapshot.
    expect(results[0]!.metrics?.memoryHealth?.sessionEndUpdate).toBe('pending');
    expect(results[1]!.metrics?.memoryHealth?.sessionEndUpdate).toBe('ran');
  });

  it("sessionEndUpdate: false stamps 'disabled'; no memory system -> snapshot is null", async () => {
    const stub = makeSSEFetch([textReplyEvents('answer')]);
    const { q } = await collectWithHandle(
      'hi',
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    expect(q.memoryHealthSnapshot()?.sessionEndUpdate).toBe('disabled');

    const bare = makeSSEFetch([textReplyEvents('answer')]);
    const { q: q2 } = await collectWithHandle('hi', baseOptions(bare));
    expect(q2.memoryHealthSnapshot()).toBeNull();
  });

  it("a maxTurns-capped run stamps 'skipped-turns' (the round is silently starved without it)", async () => {
    const stub = makeSSEFetch([]);
    const { q, messages } = await collectWithHandle(
      'hi',
      baseOptions(stub, { memory: {}, maxTurns: 0 }),
    );
    expect((messages.at(-1) as SDKResultMessage).subtype).toBe('error_max_turns');
    expect(q.memoryHealthSnapshot()?.sessionEndUpdate).toBe('skipped-turns');
  });

  it("a maxBudgetUsd-exhausted run stamps 'skipped-budget' and never drives the round", async () => {
    // The single priced turn spends past the (tiny) session cap, so the
    // decision point finds no budget left: exactly one request, no round.
    const stub = makeSSEFetch([pricedReplyEvents('the answer', { inputTokens: 5000 })]);
    const { q } = await collectWithHandle(
      'do the task',
      baseOptions(stub, { memory: {}, maxBudgetUsd: 0.000001 }),
    );
    expect(stub.requests).toHaveLength(1);
    expect(q.memoryHealthSnapshot()?.sessionEndUpdate).toBe('skipped-budget');
  });

  it("a zero-turn run (input closes with no items) stamps 'skipped-no-turns'", async () => {
    const stub = makeSSEFetch([]);
    const empty = (async function* (): AsyncGenerator<SDKUserMessage> {})();
    const { q } = await collectWithHandle(empty, baseOptions(stub, { memory: {} }));
    expect(stub.requests).toHaveLength(0);
    expect(q.memoryHealthSnapshot()?.sessionEndUpdate).toBe('skipped-no-turns');
  });
});

// ---------------------------------------------------------------------------
// R8: governance limits
// ---------------------------------------------------------------------------

describe('R8: defaults and the shared truncation helper', () => {
  it('spec defaults: 64KB file / 64 files per directory / 16k view chars; cards 500/50', () => {
    expect(DEFAULT_MEMORY_LIMITS).toEqual({
      maxFileBytes: 65_536,
      maxFilesPerDirectory: 64,
      maxViewChars: 16_000,
    });
    expect(DEFAULT_CARDS_CONFIG).toEqual({ maxCardChars: 500, maxCardsPerFile: 50 });
  });

  it('truncateViewBody cuts on a line boundary and is a no-op under the cap', () => {
    const body = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n');
    expect(truncateViewBody(body, 1000)).toBe(body);
    const cut = truncateViewBody(body, 90);
    expect(cut).toContain('a'.repeat(40));
    expect(cut).toContain('b'.repeat(40));
    expect(cut).not.toContain('c'.repeat(40));
    expect(cut).toContain('[Output truncated at 90 characters.');
  });
});

describe('R8: limits in the store engine', () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'bpt-m2-store-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('create beyond maxFileBytes returns the SDK limit error', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { limits: { maxFileBytes: 100 } });
    await expect(store.create('/memories/big.txt', 'x'.repeat(101))).rejects.toThrow(
      'Error: File /memories/big.txt would exceed the maximum memory file size (100 bytes)',
    );
    await expect(store.create('/memories/ok.txt', 'x'.repeat(100))).resolves.toContain(
      'File created successfully',
    );
  });

  it('str_replace / insert growing past the cap are rejected and leave the file unchanged', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { limits: { maxFileBytes: 40 } });
    await store.create('/memories/f.txt', 'short seed');
    await expect(
      store.strReplace('/memories/f.txt', 'seed', 'x'.repeat(60)),
    ).rejects.toThrow('maximum memory file size (40 bytes)');
    await expect(store.insert('/memories/f.txt', 0, 'y'.repeat(60))).rejects.toThrow(
      'maximum memory file size (40 bytes)',
    );
    expect(await store.view('/memories/f.txt')).toContain('short seed');
  });

  it('the per-directory file-count cap blocks the N+1th create', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, {
      limits: { maxFilesPerDirectory: 2 },
    });
    await store.create('/memories/d/a.txt', '1');
    await store.create('/memories/d/b.txt', '2');
    await expect(store.create('/memories/d/c.txt', '3')).rejects.toThrow(
      'Error: Directory /memories/d already contains the maximum number of memory files (2)',
    );
    // The error carries self-rescue guidance so a model can reorganize instead
    // of looping on create: it names the three routes and clarifies the cap is
    // per-directory and blocks only new-file creation.
    await expect(store.create('/memories/d/c.txt', '3')).rejects.toThrow(
      /blocks only new-file creation/,
    );
    await expect(store.create('/memories/d/c.txt', '3')).rejects.toThrow(/subdirectory/);
    // Other directories are unaffected.
    await expect(store.create('/memories/e/a.txt', '1')).resolves.toContain('successfully');
    // An existing file in the full directory can still be edited and deleted.
    await expect(store.strReplace('/memories/d/a.txt', '1', '11')).resolves.toContain('edited');
    await expect(store.delete('/memories/d/b.txt')).resolves.toContain('deleted');
    // With a file removed, a new create in the same directory succeeds again.
    await expect(store.create('/memories/d/c.txt', '3')).resolves.toContain('successfully');
  });

  it('view output beyond maxViewChars truncates on a line boundary with the pagination hint', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { limits: { maxViewChars: 200 } });
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${'z'.repeat(20)}`).join('\n');
    await store.create('/memories/long.txt', lines);
    const out = await store.view('/memories/long.txt');
    expect(out).toContain(
      '[Output truncated at 200 characters. Use the view_range parameter to view the rest of the file.]',
    );
    expect(out).not.toContain('line 49');
    // view_range still pages the untruncated tail.
    const page = await store.view('/memories/long.txt', [49, 50]);
    expect(page).toContain('line 48');
  });
});

describe('R8: tool-layer limits hold for directly-implemented stores', () => {
  it('view truncation applies to a direct store; oversized create never reaches it', async () => {
    const calls: string[] = [];
    const direct: MemoryStore = {
      view: async () => `Here's the content of /memories/f.txt with line numbers:\n     1\t${'w'.repeat(500)}`,
      create: async (p) => {
        calls.push(p);
        return `File created successfully at: ${p}`;
      },
      strReplace: async () => '',
      insert: async () => '',
      delete: async () => '',
      rename: async () => '',
    };
    const tool = createMemoryTool(direct, { limits: { maxViewChars: 120, maxFileBytes: 10 } });
    const view = await tool.execute({ command: 'view', path: '/memories/f.txt' }, toolCtx());
    expect(String(view.content)).toContain('[Output truncated at 120 characters.');
    const create = await tool.execute(
      { command: 'create', path: '/memories/f.txt', file_text: 'x'.repeat(11) },
      toolCtx(),
    );
    expect(create.isError).toBe(true);
    expect(String(create.content)).toContain('maximum memory file size (10 bytes)');
    expect(calls).toEqual([]);
  });
});

describe('R8: memoryHealth accounting', () => {
  it('unit: counters record operations / reads / writes / errors / bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bpt-m2-health-'));
    try {
      const health = createMemoryHealth();
      const tool = createMemoryTool(createLocalFilesystemMemoryStore(dir), { health });
      await tool.execute(
        { command: 'create', path: '/memories/a.txt', file_text: 'hello' },
        toolCtx(),
      );
      await tool.execute({ command: 'view', path: '/memories/a.txt' }, toolCtx());
      const err = await tool.execute({ command: 'view', path: '/memories/nope' }, toolCtx());
      expect(err.isError).toBe(true);
      expect(health.operations).toBe(3);
      expect(health.writes).toBe(1);
      expect(health.reads).toBe(1);
      expect(health.errors).toBe(1);
      expect(health.bytesWritten).toBe(5);
      expect(health.bytesRead).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('query level: metrics.memoryHealth rides the result, index tokens included', async () => {
    const memDir = join(cwd, '.claude', 'memory', 'memories');
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, 'MEMORY.md'), '# index\nremember the things\n', 'utf8');
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', {
        command: 'create',
        path: '/memories/note.txt',
        file_text: 'noted',
      }),
      textReplyEvents('done'),
    ]);
    const messages = await collectQuery(
      'go',
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    const result = messages.at(-1) as SDKResultMessage;
    expect(result.type).toBe('result');
    const health = result.metrics?.memoryHealth;
    expect(health).toBeDefined();
    expect(health!.operations).toBe(1);
    expect(health!.writes).toBe(1);
    expect(health!.bytesWritten).toBe(5);
    expect(health!.indexInjectionTokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// R9: cards mode
// ---------------------------------------------------------------------------

const VALID_CARD = '## 命名规范\n结论: 采用 kebab-case\n依据: 2026-07-04 团队约定\n过期条件: 迁移到新框架时\n';

describe('R9: card parsing', () => {
  it('accepts a single valid card and multi-card files', () => {
    expect(parseMemoryCards(VALID_CARD)).toMatchObject({ ok: true });
    const two = parseMemoryCards(VALID_CARD + '\n' + VALID_CARD.replace('命名规范', '部署口径'));
    expect(two.ok).toBe(true);
    if (two.ok) expect(two.cards).toHaveLength(2);
  });

  it('accepts full-width colons and multi-line field values', () => {
    const card =
      '## 结论卡\n结论：第一行\n  第二行继续\n依据：某次会议\n过期条件：无\n';
    const parsed = parseMemoryCards(card);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.cards[0]!.conclusion).toContain('第二行继续');
  });

  it('rejects a missing field with a reason naming it', () => {
    const parsed = parseMemoryCards('## t\n结论: x\n依据: y\n');
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('过期条件');
  });

  it('rejects content before the first heading, empty files and repeated fields', () => {
    expect(parseMemoryCards('loose text\n' + VALID_CARD).ok).toBe(false);
    expect(parseMemoryCards('').ok).toBe(false);
    expect(parseMemoryCards('## t\n结论: a\n结论: b\n依据: y\n过期条件: z\n').ok).toBe(false);
  });

  it('enforces card-count and card-size limits', () => {
    const two = VALID_CARD + '\n' + VALID_CARD;
    expect(parseMemoryCards(two, { maxCardChars: 500, maxCardsPerFile: 1 }).ok).toBe(false);
    expect(parseMemoryCards(VALID_CARD, { maxCardChars: 10, maxCardsPerFile: 50 }).ok).toBe(false);
  });

  it('validateCardsContent returns the structured retryable error', () => {
    const msg = validateCardsContent('not a card');
    expect(msg).toMatch(/^Error: cards-mode validation failed:/);
    expect(msg).toContain('## <card title>');
    expect(msg).toContain('结论: <conclusion>');
    expect(validateCardsContent(VALID_CARD)).toBeNull();
  });
});

describe('R9: cards mode in the store engine + tool layer', () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'bpt-m2-cards-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('create accepts valid cards and rejects free-form content', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { schema: 'cards' });
    await expect(store.create('/memories/MEMORY.md', VALID_CARD)).resolves.toContain(
      'File created successfully',
    );
    await expect(store.create('/memories/free.md', 'just some notes')).rejects.toThrow(
      /^Error: cards-mode validation failed:/,
    );
  });

  it('str_replace producing invalid cards is rejected and the file is unchanged', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { schema: 'cards' });
    await store.create('/memories/MEMORY.md', VALID_CARD);
    await expect(
      store.strReplace('/memories/MEMORY.md', '依据: 2026-07-04 团队约定', undefined),
    ).rejects.toThrow(/cards-mode validation failed/);
    expect(await store.view('/memories/MEMORY.md')).toContain('依据: 2026-07-04 团队约定');
  });

  it('tool-layer create validation shields a directly-implemented store', async () => {
    const calls: string[] = [];
    const direct: MemoryStore = {
      view: async () => '',
      create: async (p) => {
        calls.push(p);
        return `File created successfully at: ${p}`;
      },
      strReplace: async () => '',
      insert: async () => '',
      delete: async () => '',
      rename: async () => '',
    };
    const tool = createMemoryTool(direct, { schema: 'cards' });
    const bad = await tool.execute(
      { command: 'create', path: '/memories/x.md', file_text: 'free-form' },
      toolCtx(),
    );
    expect(bad.isError).toBe(true);
    expect(String(bad.content)).toMatch(/^Error: cards-mode validation failed:/);
    expect(calls).toEqual([]);
    const good = await tool.execute(
      { command: 'create', path: '/memories/x.md', file_text: VALID_CARD },
      toolCtx(),
    );
    expect(good.isError).not.toBe(true);
    expect(calls).toEqual(['/memories/x.md']);
  });
});
