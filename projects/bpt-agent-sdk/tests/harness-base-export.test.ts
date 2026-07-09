/**
 * Public harness-base constructor export (black-pool ContextRing request
 * 2026-07-08). The package entry re-exports buildSystemPromptParts /
 * buildSystemPrompt so a host can size the built-in harness base — the V5 preset
 * prose injected on the `claude_code` preset path — via the public API, instead
 * of reaching into dist/engine/prompts.js by file path.
 *
 * These tests pin the acceptance criteria: the export is reachable from the
 * entry, it IS the same function the engine uses (so `.base` matches what preset
 * mode injects), `.base` is the harness prose only (no append / project /
 * <env> tail), and toolNames flow through.
 */

import { describe, expect, it } from 'vitest';

import {
  buildSystemPromptParts,
  buildSystemPrompt,
  type SystemPromptParts,
  type PromptContext,
} from '../src/index.js';
import { buildSystemPromptParts as engineBuildParts } from '../src/engine/prompts.js';
import type { Options } from '../src/types.js';

const PRESET: Options['systemPrompt'] = {
  type: 'preset',
  preset: 'claude_code',
  append: '',
};

const TOOLS = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'Agent'];

describe('harness-base constructor export', () => {
  it('is reachable from the package entry as functions', () => {
    expect(typeof buildSystemPromptParts).toBe('function');
    expect(typeof buildSystemPrompt).toBe('function');
  });

  it('is the SAME function the engine uses (so .base matches what preset mode injects)', () => {
    // Identity guarantees the host-computed base is produced by the exact
    // function query.ts measures — not a divergent copy.
    expect(buildSystemPromptParts).toBe(engineBuildParts);
  });

  it('.base is the default harness prose for the claude_code preset', () => {
    const { base } = buildSystemPromptParts(PRESET, { cwd: '', toolNames: TOOLS });
    expect(base).toContain(
      'You are an interactive agent that helps users with software engineering tasks.',
    );
    // The comprehensive reproduction — comfortably large (the ~11.7k-char preset
    // base the request sizes).
    expect(base.length).toBeGreaterThan(5000);
    // undefined resolves to the SAME single default (the variant ladder is gone).
    const fromUndefined = buildSystemPromptParts(undefined, { cwd: '', toolNames: TOOLS }).base;
    expect(fromUndefined).toBe(base);
  });

  it('flows toolNames into the base (Available-tools line + tool-gated fragments)', () => {
    const withAgent = buildSystemPromptParts(PRESET, {
      cwd: '',
      toolNames: TOOLS,
    }).base;
    expect(withAgent).toContain(`Available tools: ${TOOLS.join(', ')}.`);
    // the Agent tool clause is gated on the Agent tool being present
    expect(withAgent).toContain('Use the Agent tool');

    const noAgent = buildSystemPromptParts(PRESET, {
      cwd: '',
      toolNames: ['Read', 'Edit'],
    }).base;
    expect(noAgent).not.toContain('Use the Agent tool');
  });

  it('.base excludes caller append / project instructions / <env> tail', () => {
    const parts = buildSystemPromptParts(
      { type: 'preset', preset: 'claude_code', append: 'ZZZ_APPEND_MARKER' },
      {
        cwd: '/repo',
        toolNames: TOOLS,
        projectInstructions: 'ZZZ_PROJECT_MARKER',
        environment: { platform: 'linux', date: '2026-07-08' },
      },
    );
    // base is the harness prose only — none of append / project / env bleeds in
    expect(parts.base).not.toContain('ZZZ_APPEND_MARKER');
    expect(parts.base).not.toContain('ZZZ_PROJECT_MARKER');
    expect(parts.base).not.toContain('<env>');
    // and the append/project DO land in the stable tail (invariant base+project===stable)
    expect(parts.project).toContain('ZZZ_APPEND_MARKER');
    expect(parts.project).toContain('ZZZ_PROJECT_MARKER');
    expect(parts.base + parts.project).toBe(parts.stable);
  });

  it('append does not change .base (append is not part of the harness base)', () => {
    const a = buildSystemPromptParts(
      { type: 'preset', preset: 'claude_code', append: '' },
      { cwd: '', toolNames: TOOLS },
    ).base;
    const b = buildSystemPromptParts(
      { type: 'preset', preset: 'claude_code', append: 'anything at all' },
      { cwd: '', toolNames: TOOLS },
    ).base;
    expect(a).toBe(b);
  });

  it('buildSystemPrompt joins stable + volatile (flat form still reachable)', () => {
    const flat = buildSystemPrompt(PRESET, {
      cwd: '/repo',
      toolNames: TOOLS,
      environment: { platform: 'linux' },
    });
    expect(flat).toContain(
      'You are an interactive agent that helps users with software engineering tasks.',
    );
    // the volatile tail (cwd) is present in the flat form
    expect(flat).toContain('/repo');
  });

  it('exports the SystemPromptParts / PromptContext types (assignable)', () => {
    const ctx: PromptContext = { cwd: '', toolNames: TOOLS };
    const parts: SystemPromptParts = buildSystemPromptParts(PRESET, ctx);
    expect(typeof parts.base).toBe('string');
    expect(typeof parts.stable).toBe('string');
    expect(typeof parts.volatile).toBe('string');
  });
});
