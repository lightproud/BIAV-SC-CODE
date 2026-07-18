/**
 * audit r4 — prompt-assembly cluster regression tests.
 *
 * Z8-1 (system-field.ts): toggling promptCaching must NOT change the system
 * bytes the model sees. The split/dual array path now carries the volatile
 * tail's leading '\n' (the API joins system text blocks with no separator), so
 * the blocks concatenate to exactly the flat single-string form. The cached
 * stable prefix (base/tail) is left byte-identical.
 */

import { describe, expect, it } from 'vitest';

import { buildEngineConfig } from '../src/engine/config-builder.js';
import { deriveSystemField } from '../src/engine/system-field.js';
import type { Options, TextBlockParam } from '../src/types.js';

const noop = (): void => {};

function build(options: Options): ReturnType<typeof buildEngineConfig> {
  return buildEngineConfig({
    options,
    cwd: '/tmp/proj',
    initialModel: 'claude-sonnet-4-5',
    builtinToolNames: ['Read', 'Grep'],
    debug: noop,
  });
}

function texts(system: string | TextBlockParam[]): string[] {
  return typeof system === 'string' ? [system] : system.map((b) => b.text);
}

describe('audit r4 Z8-1: caching toggle is system-byte-invariant', () => {
  it('2-block split blocks concatenate to the flat single-string form', () => {
    const { engineConfig } = build({
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includeEnvironmentContext: true,
      settingSources: [], // no project tail -> baseLen === stable.length -> 'first'
    });
    // caching ON -> split array
    engineConfig.promptCaching = true;
    const split = deriveSystemField(engineConfig);
    expect(Array.isArray(split.system)).toBe(true);
    expect(split.boundary).toBe('first');
    // caching OFF -> flat string
    engineConfig.promptCaching = false;
    const flat = deriveSystemField(engineConfig);
    expect(typeof flat.system).toBe('string');
    // The API concatenates system text blocks with NO separator; joining the
    // split blocks with '' must reproduce the flat string byte-for-byte.
    expect(texts(split.system).join('')).toBe(flat.system as string);
    // The volatile tail block carries the leading '\n'; the stable prefix
    // blocks are untouched (cached bytes intact).
    const blocks = texts(split.system);
    expect(blocks.at(-1)!.startsWith('\n')).toBe(true);
    expect(blocks.slice(0, -1).join('')).toBe(engineConfig.systemPrompt);
  });

  it('3-block dual [base, project, cwd] split also matches the flat form', () => {
    const { engineConfig } = build({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'PROJECT RULES' },
      includeEnvironmentContext: true,
      settingSources: [],
    });
    engineConfig.promptCaching = true;
    const split = deriveSystemField(engineConfig);
    expect(split.boundary).toBe('dual');
    expect(texts(split.system)).toHaveLength(3);
    engineConfig.promptCaching = false;
    const flat = deriveSystemField(engineConfig);
    expect(texts(split.system).join('')).toBe(flat.system as string);
    // stable prefix (base + project) reconstructs the cached prompt unchanged
    expect(texts(split.system).slice(0, -1).join('')).toBe(engineConfig.systemPrompt);
  });

  it('deriveSystemField unit: the bare volatile suffix gains the flat-path separator', () => {
    // 2-block split (no base/tail boundary)
    const first = deriveSystemField({
      promptCaching: true,
      systemPrompt: 'STABLE',
      systemPromptSuffix: 'CWD',
      systemPromptBaseLen: undefined,
      systemBlocks: undefined,
    });
    expect(first.boundary).toBe('first');
    expect(texts(first.system)).toEqual(['STABLE', '\nCWD']);

    // 3-block dual split ('BASE' | 'TAIL')
    const dual = deriveSystemField({
      promptCaching: true,
      systemPrompt: 'BASETAIL',
      systemPromptSuffix: 'CWD',
      systemPromptBaseLen: 4,
      systemBlocks: undefined,
    });
    expect(dual.boundary).toBe('dual');
    expect(texts(dual.system)).toEqual(['BASE', 'TAIL', '\nCWD']);

    // flat form for the same inputs
    const flat = deriveSystemField({
      promptCaching: false,
      systemPrompt: 'BASETAIL',
      systemPromptSuffix: 'CWD',
      systemPromptBaseLen: 4,
      systemBlocks: undefined,
    });
    expect(flat.system).toBe('BASETAIL\nCWD');

    // byte-invariance across the toggle
    expect(texts(dual.system).join('')).toBe(flat.system as string);
  });
});

// ---------------------------------------------------------------------------
// Z8-3 (runtime-context.ts): osVersion uses os.type() so the OS name is
// capitalized ('Linux 6.x') to match the official <env> reproduction, while
// the separate `platform` field stays lowercase by design.
// ---------------------------------------------------------------------------

describe('audit r4 Z8-3: osVersion carries the capitalized OS name', () => {
  it('gatherEnvironment osVersion starts with os.type(), platform stays os.platform()', async () => {
    const os = await import('node:os');
    const { gatherEnvironment } = await import('../src/engine/runtime-context.js');
    const env = gatherEnvironment('/tmp/proj', 'claude-sonnet-4-5', '2026-07-18');
    expect(env.osVersion.startsWith(os.type())).toBe(true); // e.g. 'Linux 6.x'
    expect(env.platform).toBe(os.platform()); // e.g. 'linux'
    // On Linux the two differ only by case — proving osVersion is NOT lowercased.
    if (os.type() !== os.platform()) {
      expect(env.osVersion.startsWith(os.platform())).toBe(false);
    }
  });
})

// ---------------------------------------------------------------------------
// Z8-2 / Rdt-4 (config-builder + loop): the volatile <env> tail is rebuilt per
// turn for the LIVE model (and a freshly-computed calendar day), so a fallback-
// model switch no longer serves the construction-time model name.
// ---------------------------------------------------------------------------

describe('audit r4 Z8-2/Rdt-4: <env> model line tracks the live model', () => {
  it('config exposes a rebuild closure; the baked suffix names the initial model', () => {
    const { engineConfig } = build({ systemPrompt: { type: 'preset', preset: 'claude_code' } });
    expect(engineConfig.rebuildVolatileSuffix).toBeTypeOf('function');
    // Baked at construction from initialModel.
    expect(engineConfig.systemPromptSuffix).toContain(
      'You are powered by the model named claude-sonnet-4-5.',
    );
  });

  it('rebuilding with a fallback model reflects THAT model, not the initial one', () => {
    const { engineConfig } = build({ systemPrompt: { type: 'preset', preset: 'claude_code' } });
    const refreshed = engineConfig.rebuildVolatileSuffix!('claude-opus-4-8');
    expect(refreshed).toContain('You are powered by the model named claude-opus-4-8.');
    expect(refreshed).not.toContain('claude-sonnet-4-5');
  });

  it('rebuilding with the SAME model reproduces the baked tail byte-for-byte', () => {
    const { engineConfig } = build({ systemPrompt: { type: 'preset', preset: 'claude_code' } });
    // Same model + same calendar day => identical bytes (cache-safe: an unchanged
    // turn refreshes to the exact same suffix, so the wire prefix is stable).
    expect(engineConfig.rebuildVolatileSuffix!('claude-sonnet-4-5')).toBe(
      engineConfig.systemPromptSuffix,
    );
  });

  it('no rebuild closure when the <env> block is disabled', () => {
    const { engineConfig } = build({
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includeEnvironmentContext: false,
    });
    expect(engineConfig.rebuildVolatileSuffix).toBeUndefined();
  });
})
