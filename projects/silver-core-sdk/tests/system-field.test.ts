/**
 * Assembly <-> derivation contract for the system prompt (audit 2026-07-10
 * P2-2). engine/config-builder.ts writes the four-field protocol
 * (systemPrompt / systemPromptSuffix / systemPromptBaseLen / systemBlocks);
 * engine/system-field.ts is the ONLY interpreter. The fragile invariant is
 * systemPromptBaseLen: a CHAR OFFSET into the stable prompt — anything the
 * builder appends to the stable prompt must land AFTER `base`, or the derived
 * [base | project | cwd] blocks silently shift. These tests build real
 * configs through buildEngineConfig and assert the derived blocks reassemble
 * the exact prompt, so either side drifting turns red.
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

describe('system assembly <-> derivation contract', () => {
  it('preset + caching derives [stable...] blocks that reassemble the stable prompt exactly', () => {
    const { engineConfig } = build({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'PROJECT RULES' },
      includeEnvironmentContext: true,
      settingSources: [],
    });
    const derived = deriveSystemField(engineConfig);
    const blocks = texts(derived.system);
    // Whatever the split shape (dual [base, tail, cwd] or [stable, cwd]), the
    // stable-prefix blocks must concatenate back to the EXACT stable prompt —
    // the invariant that breaks when an append lands before the baseLen offset.
    const stableJoined = blocks.slice(0, blocks.length - 1).join('');
    expect(stableJoined).toBe(engineConfig.systemPrompt);
    // audit r4 Z8-1: the volatile block carries a leading '\n' so the split
    // path's wire bytes match the flat path (which joins stable+suffix with
    // '\n'); the stable prefix above is unchanged.
    expect(blocks.at(-1)).toBe('\n' + engineConfig.systemPromptSuffix);
    expect(derived.boundary).toBe(
      engineConfig.systemPromptBaseLen !== undefined &&
        engineConfig.systemPromptBaseLen > 0 &&
        engineConfig.systemPromptBaseLen < engineConfig.systemPrompt.length
        ? 'dual'
        : 'first',
    );
    // The appended project tail must live in the tail slice, after base.
    expect(
      engineConfig.systemPrompt.slice(engineConfig.systemPromptBaseLen ?? 0),
    ).toContain('PROJECT RULES');
  });

  it('structured output appends AFTER the base boundary (offset stays valid)', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const { engineConfig } = build({
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      outputFormat: { type: 'json_schema', schema },
      settingSources: [],
    });
    const baseLen = engineConfig.systemPromptBaseLen;
    expect(baseLen).toBeDefined();
    // The instruction must be entirely inside the tail slice.
    const base = engineConfig.systemPrompt.slice(0, baseLen);
    expect(base).not.toContain('json_schema');
    const derived = deriveSystemField(engineConfig);
    const blocks = texts(derived.system);
    expect(blocks.slice(0, -1).join('')).toBe(engineConfig.systemPrompt);
  });

  it('caching off derives the flat single-string join', () => {
    const { engineConfig } = build({
      systemPrompt: 'You are a test harness.',
      provider: { promptCaching: false },
      settingSources: [],
    });
    engineConfig.promptCaching = false;
    const derived = deriveSystemField(engineConfig);
    expect(typeof derived.system).toBe('string');
    expect(derived.boundary).toBe('last');
    if (engineConfig.systemPromptSuffix !== undefined) {
      expect(derived.system).toBe(
        `${engineConfig.systemPrompt}\n${engineConfig.systemPromptSuffix}`,
      );
    }
  });

  it('segments form forwards caller blocks verbatim with boundary preserve', () => {
    const { engineConfig } = build({
      systemPrompt: {
        type: 'segments',
        segments: [
          { text: 'base seg', cache: true },
          { text: 'project seg' },
        ],
      },
      settingSources: [],
    });
    const derived = deriveSystemField(engineConfig);
    expect(derived.boundary).toBe('preserve');
    expect(derived.callerBlocks).toBe(true);
    expect(texts(derived.system)).toEqual(['base seg', 'project seg']);
    // Verbatim: the derived value IS the config's blocks (no clone, no edits).
    expect(derived.system).toBe(engineConfig.systemBlocks);
  });

  it('a stale/oversized baseLen degrades cleanly to the [stable, cwd] split', () => {
    const { engineConfig } = build({
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: [],
    });
    engineConfig.systemPromptBaseLen = engineConfig.systemPrompt.length + 100;
    const derived = deriveSystemField(engineConfig);
    const blocks = texts(derived.system);
    expect(derived.boundary).toBe(
      engineConfig.systemPromptSuffix !== undefined ? 'first' : 'last',
    );
    if (engineConfig.systemPromptSuffix !== undefined) {
      // audit r4 Z8-1: volatile block carries a leading '\n' (see above).
      expect(blocks).toEqual([engineConfig.systemPrompt, '\n' + engineConfig.systemPromptSuffix]);
    }
  });
});
