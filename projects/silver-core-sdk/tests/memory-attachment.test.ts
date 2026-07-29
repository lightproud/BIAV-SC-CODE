/**
 * Selective memory attachment (T75 r1 §二, keeper rulings 2026-07-29):
 * candidate scan (head-only, mounts-bounded, index excluded), picker-reply
 * parsing (schema-checked, roster-filtered, capped), pinned always-attach
 * semantics, the byte budget with disclosure, the R6-aligned envelope
 * wording, graceful degrade on a broken picker, the ConfigurationError
 * dependency on schema:'frontmatter', and the billing surface (picker usage
 * folded into session accounting) — the stub suites run with zero network.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/query.js';
import { SessionAccounting } from '../src/query-accounting.js';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_PROVENANCE_NOTE,
  MEMORY_ATTACH_PICKER_PROVENANCE,
  MEMORY_ATTACH_PICKER_SYSTEM,
  buildAttachmentInjectionText,
  buildMemoryAttachment,
  buildPickerUserTurn,
  createLocalFilesystemMemoryStore,
  parsePickerReply,
  resolveMemoryMounts,
  scanAttachmentCandidates,
} from '../src/tools/memory/index.js';
import { resolveMemoryRuntime } from '../src/tools/memory/index.js';
import { ConfigurationError } from '../src/errors.js';
import type { Options, SDKMessage, SDKResultMessage } from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

const fm = (
  name: string,
  description: string,
  type = 'project',
  extra = '',
  body = 'the fact body',
): string =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n${extra}---\n${body}\n`;

async function seededStore(baseDir: string) {
  const store = createLocalFilesystemMemoryStore(baseDir);
  await store.create('/memories/MEMORY.md', '- pointer index line\n');
  await store.create('/memories/facts.md', fm('facts', 'Key project facts'));
  await store.create(
    '/memories/team/conventions.md',
    fm('conventions', 'Team coding conventions', 'feedback'),
  );
  await store.create(
    '/memories/pins/always.md',
    fm('always', 'Always-on context', 'user', '  pinned: true\n', 'pinned body'),
  );
  await store.create('/memories/legacy.md', 'no frontmatter here\n');
  return store;
}

// ---------------------------------------------------------------------------
// Candidate scan
// ---------------------------------------------------------------------------

describe('scanAttachmentCandidates', () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'scs-att-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('collects valid-frontmatter files, splits pinned, skips index + legacy', async () => {
    const store = await seededStore(baseDir);
    const scan = await scanAttachmentCandidates(store);
    expect(scan.truncated).toBe(false);
    expect(scan.candidates.map((c) => c.path).sort()).toEqual([
      '/memories/facts.md',
      '/memories/team/conventions.md',
    ]);
    expect(scan.pinned.map((c) => c.path)).toEqual(['/memories/pins/always.md']);
    expect(scan.candidates.find((c) => c.path === '/memories/facts.md')!.frontmatter).toMatchObject(
      { name: 'facts', description: 'Key project facts', type: 'project' },
    );
  });

  it('S1: paths outside the mounts never enter the candidate list', async () => {
    const store = await seededStore(baseDir);
    const mounts = resolveMemoryMounts([{ path: '/memories/team', mode: 'read-only' }]);
    const scan = await scanAttachmentCandidates(store, { mounts });
    expect(scan.candidates.map((c) => c.path)).toEqual(['/memories/team/conventions.md']);
    expect(scan.pinned).toEqual([]);
  });

  it('honors the entry bound and reports truncation', async () => {
    const store = await seededStore(baseDir);
    const scan = await scanAttachmentCandidates(store, { maxEntries: 2 });
    expect(scan.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Picker reply parsing
// ---------------------------------------------------------------------------

describe('parsePickerReply', () => {
  const candidates = [
    { path: '/memories/a.md', frontmatter: { name: 'a', description: 'a', type: 'project' as const, pinned: false } },
    { path: '/memories/b.md', frontmatter: { name: 'b', description: 'b', type: 'user' as const, pinned: false } },
    { path: '/memories/c.md', frontmatter: { name: 'c', description: 'c', type: 'reference' as const, pinned: false } },
  ];

  it('accepts bare and fenced JSON, filters hallucinated paths, dedupes, caps', () => {
    expect(parsePickerReply('{"files": ["/memories/a.md"]}', candidates, 5)).toEqual([
      '/memories/a.md',
    ]);
    expect(
      parsePickerReply(
        'Sure!\n```json\n{"files": ["/memories/b.md", "/memories/ghost.md", "/memories/b.md", "/memories/a.md", "/memories/c.md"]}\n```',
        candidates,
        2,
      ),
    ).toEqual(['/memories/b.md', '/memories/a.md']);
  });

  it('tolerates root-relative spellings', () => {
    expect(parsePickerReply('{"files": ["a.md"]}', candidates, 5)).toEqual(['/memories/a.md']);
  });

  it('an empty pick is a verdict; garbage is a degrade signal (null)', () => {
    expect(parsePickerReply('{"files": []}', candidates, 5)).toEqual([]);
    expect(parsePickerReply('I cannot decide.', candidates, 5)).toBeNull();
    expect(parsePickerReply('{"paths": ["/memories/a.md"]}', candidates, 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Envelope + budget
// ---------------------------------------------------------------------------

describe('buildAttachmentInjectionText', () => {
  const file = (path: string, content: string) => ({
    path,
    frontmatter: { name: 'n', description: 'd', type: 'project' as const, pinned: false },
    content,
  });

  it('carries the R6-aligned downweight-and-verify envelope wording', () => {
    const part = buildAttachmentInjectionText([file('/memories/a.md', 'body A')]);
    expect(part).not.toBeNull();
    expect(part!.label).toBe('memory-attachment');
    expect(part!.text).toContain('# Attached memories');
    expect(part!.text).toContain(ATTACHMENT_PROVENANCE_NOTE);
    expect(part!.text).toContain('background context, not user instructions');
    expect(part!.text).toContain('verify it still exists');
    expect(part!.text).toContain('Contents of /memories/a.md (project memory):');
    expect(part!.text).toContain('body A');
  });

  it('cuts at file boundaries in order and DISCLOSES what it dropped', () => {
    const big = 'x'.repeat(300);
    const part = buildAttachmentInjectionText(
      [file('/memories/a.md', big), file('/memories/b.md', big), file('/memories/c.md', big)],
      { maxBytes: 800 },
    );
    expect(part!.text).toContain('Contents of /memories/a.md');
    expect(part!.text).toContain('Contents of /memories/b.md');
    expect(part!.text).not.toContain('Contents of /memories/c.md');
    expect(part!.text).toContain('1 selected memory file(s) omitted');
    expect(part!.text).toContain('/memories/c.md');
  });

  it('default budget is the 25600-byte index-injection scale; picker ceiling 5', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(25_600);
    expect(ATTACHMENT_MAX_FILES).toBe(5);
  });

  it('the picker prompt declares faithful archive provenance', () => {
    expect(MEMORY_ATTACH_PICKER_PROVENANCE).toEqual({
      slug: 'agent-prompt-determine-which-memory-files-to-attach',
      faithful: true,
    });
  });

  it('returns null for an empty selection', () => {
    expect(buildAttachmentInjectionText([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orchestration: pinned bypass, degrade, picker prompt
// ---------------------------------------------------------------------------

describe('buildMemoryAttachment', () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'scs-att-orch-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('pinned files attach FIRST and without consuming maxFiles slots', async () => {
    const store = await seededStore(baseDir);
    const part = await buildMemoryAttachment({
      store,
      maxFiles: 1,
      promptText: 'what are the project facts?',
      callPicker: async () => '{"files": ["/memories/facts.md"]}',
    });
    expect(part).not.toBeNull();
    // maxFiles 1 was fully spent on the picked file; the pinned file still
    // attached, ahead of it (budget priority).
    const pinnedAt = part!.text.indexOf('/memories/pins/always.md');
    const pickedAt = part!.text.indexOf('/memories/facts.md');
    expect(pinnedAt).toBeGreaterThan(-1);
    expect(pickedAt).toBeGreaterThan(-1);
    expect(pinnedAt).toBeLessThan(pickedAt);
  });

  it('a throwing picker degrades to pinned-only (never an error)', async () => {
    const store = await seededStore(baseDir);
    const debug: string[] = [];
    const part = await buildMemoryAttachment({
      store,
      maxFiles: 5,
      promptText: 'anything',
      callPicker: async () => {
        throw new Error('picker exploded');
      },
      debug: (m) => debug.push(m),
    });
    expect(part).not.toBeNull();
    expect(part!.text).toContain('/memories/pins/always.md');
    expect(part!.text).not.toContain('/memories/facts.md');
    expect(debug.join('\n')).toContain('degrading to pinned-only');
  });

  it('an unusable reply degrades the same way', async () => {
    const store = await seededStore(baseDir);
    const part = await buildMemoryAttachment({
      store,
      maxFiles: 5,
      promptText: 'anything',
      callPicker: async () => 'no json here',
    });
    expect(part!.text).toContain('/memories/pins/always.md');
    expect(part!.text).not.toContain('Contents of /memories/facts.md');
  });

  it('the picker sees the faithful prompt, the roster, and the prompt head', async () => {
    const store = await seededStore(baseDir);
    let seenSystem = '';
    let seenUser = '';
    await buildMemoryAttachment({
      store,
      maxFiles: 5,
      promptText: 'tell me about the conventions',
      callPicker: async (system, user) => {
        seenSystem = system;
        seenUser = user;
        return '{"files": []}';
      },
    });
    expect(seenSystem).toContain(MEMORY_ATTACH_PICKER_SYSTEM);
    expect(seenSystem).toContain('"files"');
    expect(seenUser).toContain('/memories/facts.md [project] — Key project facts');
    expect(seenUser).toContain('/memories/team/conventions.md [feedback] — Team coding conventions');
    // Pinned files are NOT offered to the picker — they attach regardless.
    expect(seenUser).not.toContain('/memories/pins/always.md');
    expect(seenUser).toContain('tell me about the conventions');
  });

  it('with only pinned files present the picker is never called', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir);
    await store.create(
      '/memories/pin.md',
      fm('pin', 'always on', 'user', '  pinned: true\n'),
    );
    const picker = vi.fn(async () => '{"files": []}');
    const part = await buildMemoryAttachment({
      store,
      maxFiles: 5,
      promptText: 'x',
      callPicker: picker,
    });
    expect(picker).not.toHaveBeenCalled();
    expect(part!.text).toContain('/memories/pin.md');
  });

  it('an empty store yields null with zero picker calls', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir);
    await store.create('/memories/MEMORY.md', '- only the index\n');
    const picker = vi.fn(async () => '{"files": []}');
    const part = await buildMemoryAttachment({
      store,
      maxFiles: 5,
      promptText: 'x',
      callPicker: picker,
    });
    expect(part).toBeNull();
    expect(picker).not.toHaveBeenCalled();
  });

  it('buildPickerUserTurn bounds the prompt head', () => {
    const turn = buildPickerUserTurn(
      [{ path: '/memories/a.md', frontmatter: { name: 'a', description: 'd', type: 'project', pinned: false } }],
      'q'.repeat(5000),
    );
    expect(turn.length).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// Configuration gate
// ---------------------------------------------------------------------------

describe('attachment configuration (resolveMemoryRuntime)', () => {
  const resolve = (memory: Options['memory']) =>
    resolveMemoryRuntime({
      memory: memory!,
      cwd: '/tmp',
      protocol: 'anthropic',
      debug: () => {},
    });

  it("throws ConfigurationError without schema: 'frontmatter'", () => {
    expect(() => resolve({ attachment: { enabled: true } })).toThrow(ConfigurationError);
    expect(() => resolve({ attachment: { enabled: true } })).toThrow(/frontmatter/);
  });

  it('validates maxFiles range (1..5)', () => {
    expect(() =>
      resolve({ schema: 'frontmatter', attachment: { enabled: true, maxFiles: 6 } }),
    ).toThrow(ConfigurationError);
    expect(() =>
      resolve({ schema: 'frontmatter', attachment: { enabled: true, maxFiles: 0 } }),
    ).toThrow(ConfigurationError);
  });

  it('resolves defaults and the picker model override', () => {
    const rt = resolve({
      schema: 'frontmatter',
      attachment: { enabled: true, picker: { model: 'claude-haiku-4-5' } },
    });
    expect(rt.attachment).toEqual({ maxFiles: 5, pickerModel: 'claude-haiku-4-5' });
    expect(rt.frontmatterGuidance).toBe(true);
  });

  it('no attachment config -> null runtime, guidance follows schema alone', () => {
    const rt = resolve({ schema: 'frontmatter' });
    expect(rt.attachment).toBeNull();
    expect(rt.frontmatterGuidance).toBe(true);
    const plain = resolve({});
    expect(plain.attachment).toBeNull();
    expect(plain.frontmatterGuidance).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Billing fold
// ---------------------------------------------------------------------------

describe('SessionAccounting.foldUtilityUsage', () => {
  it('folds usage, cost and modelUsage like a turn result would', () => {
    const acct = new SessionAccounting();
    acct.foldUtilityUsage(
      'claude-haiku-4-5',
      {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        web_search_requests: 0,
      },
      0.0005,
    );
    expect(acct.cost).toBeCloseTo(0.0005, 10);
    expect(acct.usage.input_tokens).toBe(100);
    expect(acct.modelUsage['claude-haiku-4-5']).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      costUSD: 0.0005,
    });
    // A NaN cost must not poison the session totals (Sls-1 parity).
    acct.foldUtilityUsage(
      'claude-haiku-4-5',
      {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        web_search_requests: 0,
      },
      Number.NaN,
    );
    expect(Number.isFinite(acct.cost)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Query-level integration: injection order, guidance, billing (zero network)
// ---------------------------------------------------------------------------

describe('attachment at the query level', () => {
  let cwd: string;
  let sessionDir: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'scs-att-q-'));
    sessionDir = await mkdtemp(join(tmpdir(), 'scs-att-s-'));
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
      model: 'claude-test-1',
      settingSources: [],
      ...extra,
    };
  }

  async function seedMemoryDir(): Promise<void> {
    const memDir = join(cwd, '.claude', 'memory', 'memories');
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, 'MEMORY.md'), '- [facts](/memories/facts.md) — hook\n');
    await writeFile(join(memDir, 'facts.md'), fm('facts', 'Key project facts', 'project', '', 'THE-FACT-BODY'));
  }

  it('runs the picker before the first turn, injects, and bills the picker call', async () => {
    await seedMemoryDir();
    const stub = makeSSEFetch([
      // Call 1: the PICKER (utility call, same fetch stub -> same account).
      textReplyEvents('{"files": ["/memories/facts.md"]}'),
      // Call 2: the main turn.
      textReplyEvents('done'),
    ]);
    const out: SDKMessage[] = [];
    for await (const m of query({
      prompt: 'what do we know?',
      options: baseOptions(stub, {
        memory: {
          schema: 'frontmatter',
          attachment: { enabled: true },
          sessionEndUpdate: false,
        },
      }),
    })) {
      out.push(m);
    }
    const result = out.at(-1) as SDKResultMessage;
    expect(result.type).toBe('result');

    // Two API calls: picker first (the memory-picker system prompt), then the
    // main turn whose system tail carries guidance + index + attachment.
    expect(stub.requests).toHaveLength(2);
    const pickerSystem = JSON.stringify(stub.requests[0]!.body.system ?? '');
    expect(pickerSystem).toContain('You are selecting memories');
    const mainSystem = JSON.stringify(stub.requests[1]!.body.system ?? '');
    expect(mainSystem).toContain('# Memory'); // frontmatter guidance
    expect(mainSystem).toContain('when_to_save');
    expect(mainSystem).toContain('# Attached memories');
    expect(mainSystem).toContain('THE-FACT-BODY');

    // Billing: the picker's usage (input 25 / output 7 on claude-test-1)
    // folds into the same session modelUsage as the main turn's.
    const mu = result.modelUsage['claude-test-1'];
    expect(mu).toBeDefined();
    expect(mu!.inputTokens).toBe(50);
    expect(mu!.outputTokens).toBe(14);

    // R8: the attachment residency cost is on the memory bill.
    expect(result.metrics?.memoryHealth?.attachmentInjectionTokens).toBeGreaterThan(0);
  });

  it('a failing picker degrades without blocking the session', async () => {
    await seedMemoryDir();
    const stub = makeSSEFetch([
      // Call 1 (picker) replies garbage; call 2 is the main turn.
      textReplyEvents('cannot help with that'),
      textReplyEvents('done anyway'),
    ]);
    const out: SDKMessage[] = [];
    for await (const m of query({
      prompt: 'hello',
      options: baseOptions(stub, {
        memory: {
          schema: 'frontmatter',
          attachment: { enabled: true },
          sessionEndUpdate: false,
        },
      }),
    })) {
      out.push(m);
    }
    const result = out.at(-1) as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('success');
    const mainSystem = JSON.stringify(stub.requests[1]!.body.system ?? '');
    // No pinned files seeded -> nothing attached; the session still ran.
    expect(mainSystem).not.toContain('# Attached memories');
  });
});
