/**
 * Frontmatter memory schema (T75 r1 §一, keeper rulings 2026-07-29): parser
 * red-green cases, the structured error's migration guidance, the index
 * exemption at both enforcement layers, the health-scan completeness
 * dimension + its consolidation task, and the corpus-sync guard holding the
 * injected official guidance to its archived sources.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FRONTMATTER_DESCRIPTION_MAX_CHARS,
  MEMORY_FRONTMATTER_TYPES,
  assessMemoryStoreHealth,
  buildConsolidationPrompt,
  createLocalFilesystemMemoryStore,
  createLocalMemoryFileOps,
  createMemoryStore,
  parseMemoryFrontmatter,
  validateMemoryFrontmatter,
} from '../src/index.js';
import type { MemoryStore } from '../src/internal/contracts.js';
import { createMemoryTool } from '../src/tools/memory/memory-tool.js';
import {
  MEMORY_FRONTMATTER_GUIDANCE,
  MEMORY_FRONTMATTER_SOURCES,
} from '../src/engine/prompt-fragments.js';
import type { ToolContext } from '../src/internal/contracts.js';

const VALID = [
  '---',
  'name: acme-prefers-email',
  'description: Customer Acme Corp prefers email follow-ups',
  'metadata:',
  '  type: feedback',
  '---',
  'Acme Corp prefers email follow-ups.',
  '**Why:** phone calls interrupted their on-call rotation.',
  '**How to apply:** default to email when proposing next steps.',
  '',
].join('\n');

function toolCtx(): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  } as unknown as ToolContext;
}

// ---------------------------------------------------------------------------
// Parser red-green (r1 acceptance: 缺头 / 缺 name / 坏 type / 超长 description)
// ---------------------------------------------------------------------------

describe('parseMemoryFrontmatter', () => {
  it('accepts the official shape and returns the typed head + body', () => {
    const parsed = parseMemoryFrontmatter(VALID);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.frontmatter).toEqual({
        name: 'acme-prefers-email',
        description: 'Customer Acme Corp prefers email follow-ups',
        type: 'feedback',
        pinned: false,
      });
      expect(parsed.body).toContain('**Why:**');
    }
  });

  it('rejects a file with no frontmatter head (缺头)', () => {
    const parsed = parseMemoryFrontmatter('just some notes\n');
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('---');
  });

  it('rejects an unterminated frontmatter block', () => {
    const parsed = parseMemoryFrontmatter('---\nname: x\ndescription: y\n');
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('never closed');
  });

  it('rejects a missing name (缺 name)', () => {
    const parsed = parseMemoryFrontmatter(
      '---\ndescription: y\nmetadata:\n  type: user\n---\nbody\n',
    );
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('"name"');
  });

  it('rejects a missing description', () => {
    const parsed = parseMemoryFrontmatter('---\nname: x\nmetadata:\n  type: user\n---\nbody\n');
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('"description"');
  });

  it('rejects a bad type by name, listing the enum (坏 type)', () => {
    const parsed = parseMemoryFrontmatter(
      '---\nname: x\ndescription: y\nmetadata:\n  type: opinion\n---\nbody\n',
    );
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) {
      expect(parsed.reason).toContain('"opinion"');
      for (const t of MEMORY_FRONTMATTER_TYPES) expect(parsed.reason).toContain(t);
    }
  });

  it('rejects a missing type', () => {
    const parsed = parseMemoryFrontmatter('---\nname: x\ndescription: y\n---\nbody\n');
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('"type"');
  });

  it('rejects an over-long description (超长 description)', () => {
    const long = 'x'.repeat(FRONTMATTER_DESCRIPTION_MAX_CHARS + 1);
    const parsed = parseMemoryFrontmatter(
      `---\nname: x\ndescription: ${long}\nmetadata:\n  type: user\n---\nbody\n`,
    );
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) {
      expect(parsed.reason).toContain(String(FRONTMATTER_DESCRIPTION_MAX_CHARS));
    }
  });

  it('parses pinned true/false and rejects other spellings', () => {
    const pinned = parseMemoryFrontmatter(
      '---\nname: x\ndescription: y\nmetadata:\n  type: user\n  pinned: true\n---\nbody\n',
    );
    expect(pinned.ok).toBe(true);
    if (pinned.ok) expect(pinned.frontmatter.pinned).toBe(true);
    const bad = parseMemoryFrontmatter(
      '---\nname: x\ndescription: y\nmetadata:\n  type: user\n  pinned: yes\n---\nbody\n',
    );
    expect(bad.ok).toBe(false);
  });

  it('rejects duplicated known keys (a duplicate is a confused write)', () => {
    const parsed = parseMemoryFrontmatter(
      '---\nname: a\nname: b\ndescription: y\nmetadata:\n  type: user\n---\nbody\n',
    );
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.reason).toContain('"name"');
  });

  it('strips matched surrounding quotes and tolerates unknown keys', () => {
    const parsed = parseMemoryFrontmatter(
      '---\nname: "quoted-name"\ndescription: \'quoted desc\'\ncustom_key: kept\nmetadata:\n  type: reference\n---\nbody\n',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.frontmatter.name).toBe('quoted-name');
      expect(parsed.frontmatter.description).toBe('quoted desc');
    }
  });

  it('a later "---" in the BODY does not confuse the head parse', () => {
    const parsed = parseMemoryFrontmatter(`${VALID}\n---\ntrailing section\n`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.body).toContain('trailing section');
  });
});

describe('validateMemoryFrontmatter (structured retryable error)', () => {
  it('returns null on valid content', () => {
    expect(validateMemoryFrontmatter(VALID)).toBeNull();
  });

  it('restates the format and the delete+create migration path (迁移悬崖)', () => {
    const msg = validateMemoryFrontmatter('free-form prose');
    expect(msg).toMatch(/^Error: frontmatter validation failed:/);
    expect(msg).toContain('name: <short-kebab-case-slug>');
    expect(msg).toContain('type: user | feedback | project | reference');
    // The self-heal guidance: an old-format file is rewritten via delete +
    // create, never str_replace'd into shape.
    expect(msg).toContain('delete the file and re-create it');
    expect(msg).toContain('retry the command');
  });
});

// ---------------------------------------------------------------------------
// Enforcement layers: store engine + tool layer, with the index exemption
// ---------------------------------------------------------------------------

describe("schema 'frontmatter' in the store engine", () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'scs-fm-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('create accepts valid frontmatter and rejects free-form content', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { schema: 'frontmatter' });
    await expect(store.create('/memories/acme.md', VALID)).resolves.toContain(
      'File created successfully',
    );
    await expect(store.create('/memories/free.md', 'just some notes')).rejects.toThrow(
      /^Error: frontmatter validation failed:/,
    );
  });

  it('the resident index is exempt (pointer lines are not memories)', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { schema: 'frontmatter' });
    await expect(
      store.create(
        '/memories/MEMORY.md',
        '- [acme](/memories/acme.md) — follow-up preference\n',
      ),
    ).resolves.toContain('File created successfully');
  });

  it('str_replace breaking the head is rejected and the file is unchanged', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir, { schema: 'frontmatter' });
    await store.create('/memories/acme.md', VALID);
    await expect(
      store.strReplace('/memories/acme.md', 'name: acme-prefers-email', undefined),
    ).rejects.toThrow(/frontmatter validation failed/);
    expect(await store.view('/memories/acme.md')).toContain('name: acme-prefers-email');
  });
});

describe("schema 'frontmatter' at the tool layer (direct stores shielded)", () => {
  it('create validation runs before the store is called; index exempt', async () => {
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
    const tool = createMemoryTool(direct, { schema: 'frontmatter' });
    const bad = await tool.execute(
      { command: 'create', path: '/memories/x.md', file_text: 'free-form' },
      toolCtx(),
    );
    expect(bad.isError).toBe(true);
    expect(String(bad.content)).toMatch(/^Error: frontmatter validation failed:/);
    expect(calls).toEqual([]);
    const good = await tool.execute(
      { command: 'create', path: '/memories/x.md', file_text: VALID },
      toolCtx(),
    );
    expect(good.isError).not.toBe(true);
    const index = await tool.execute(
      { command: 'create', path: '/memories/MEMORY.md', file_text: '- pointer line\n' },
      toolCtx(),
    );
    expect(index.isError).not.toBe(true);
    expect(calls).toEqual(['/memories/x.md', '/memories/MEMORY.md']);
  });
});

// ---------------------------------------------------------------------------
// Health-scan completeness dimension + consolidation task (r1 §1.2)
// ---------------------------------------------------------------------------

describe('frontmatter completeness in the health scan', () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'scs-fm-health-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('reports non-compliant files (index exempt) only when schema is passed', async () => {
    const store = createLocalFilesystemMemoryStore(baseDir);
    await store.create('/memories/good.md', VALID);
    await store.create('/memories/old-format.md', 'pre-migration prose\n');
    await store.create('/memories/MEMORY.md', '- pointer line\n');
    // FileOps root = the real directory the /memories virtual root maps to.
    const ops = createLocalMemoryFileOps(join(baseDir, 'memories'));

    const plain = await assessMemoryStoreHealth(ops);
    expect(plain.frontmatter).toBeUndefined();

    const scanned = await assessMemoryStoreHealth(ops, { schema: 'frontmatter' });
    expect(scanned.frontmatter).toBeDefined();
    expect(scanned.frontmatter!.nonCompliant).toBe(1);
    expect(scanned.frontmatter!.nonCompliantList).toEqual(['/memories/old-format.md']);
    // good.md + old-format.md checked; the index is exempt, not counted.
    expect(scanned.frontmatter!.checkedFiles).toBe(2);

    const prompt = buildConsolidationPrompt(scanned);
    expect(prompt).toContain('lack a valid memory frontmatter head');
    expect(prompt).toContain('/memories/old-format.md');
    expect(prompt).toContain('delete + create');
  });
});

// ---------------------------------------------------------------------------
// Corpus-sync guard: the injected guidance is faithful to its archive sources
// ---------------------------------------------------------------------------

describe('frontmatter guidance provenance (corpus-sync guard)', () => {
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

  it('every faithful source is composed into the guidance; glue is declared', () => {
    for (const [key, src] of Object.entries(MEMORY_FRONTMATTER_SOURCES)) {
      expect(MEMORY_FRONTMATTER_GUIDANCE, key).toContain(src.text.slice(0, 60));
      if (!src.faithful) expect(src.slug).toBe('sdk-original');
    }
  });

  const verbatim = [
    'userDescription',
    'feedbackWhenToSave',
    'feedbackBodyStructure',
    'projectWhenToSave',
    'projectBodyStructure',
  ] as const;
  for (const key of verbatim) {
    it.runIf(existsSync(archive))(`${key} is verbatim from its archived source`, () => {
      const src = MEMORY_FRONTMATTER_SOURCES[key]!;
      expect(src.faithful).toBe(true);
      const body = norm(stripHeader(readFileSync(join(archive, `${src.slug}.md`), 'utf8')));
      expect(body).toContain(norm(src.text));
    });
  }

  it.runIf(existsSync(archive))(
    'the instructions core stays faithful to its templated source (branch-resolved)',
    () => {
      const src = MEMORY_FRONTMATTER_SOURCES.instructions!;
      const body = norm(
        stripHeader(readFileSync(join(archive, `${src.slug}.md`), 'utf8')),
      );
      // The archive text is a template (variables interpolated at runtime), so
      // faithfulness is judged sentence-wise: every long literal sentence of
      // the reproduction must appear in the source (same rule as the
      // hooks-condition corpus guard).
      const drifted = norm(src.text)
        .split(/(?<=[.:])\s+/)
        .map(norm)
        .filter((s) => s.length >= 60)
        .filter((s) => !s.includes('/memories directory')) // resolved variable sentence
        .filter((s) => !s.includes('```')) // fence boundaries sit next to template variables
        .filter((s) => !body.includes(s.slice(0, 60)));
      expect(drifted, `not found in archive:\n${drifted.join('\n')}`).toEqual([]);
    },
  );
});
