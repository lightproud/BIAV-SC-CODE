/**
 * Harness system-prompt construction: stable/volatile split + v1/v2/v3 variant.
 */

import { describe, expect, it } from 'vitest';
import { buildSystemPromptParts, buildSystemPrompt } from '../src/engine/prompts.js';

const ctx = (variant?: 'v1' | 'v2' | 'v3') => ({
  cwd: '/tmp/run-xyz',
  toolNames: ['Read', 'Write', 'Bash'],
  variant,
});
const preset = { type: 'preset' as const, preset: 'claude_code' as const };

describe('system prompt split', () => {
  it('keeps the cwd out of the stable segment and in the volatile tail', () => {
    const { stable, volatile } = buildSystemPromptParts(preset, ctx());
    expect(stable).not.toContain('/tmp/run-xyz');
    expect(volatile).toContain('/tmp/run-xyz');
  });

  it('a string systemPrompt is entirely stable with no volatile tail', () => {
    const { stable, volatile } = buildSystemPromptParts('custom prompt', ctx());
    expect(stable).toBe('custom prompt');
    expect(volatile).toBe('');
  });

  it('buildSystemPrompt joins stable + volatile', () => {
    const flat = buildSystemPrompt(preset, ctx());
    expect(flat).toContain('/tmp/run-xyz');
  });
});

describe('harness prompt v1/v2 variant', () => {
  it('defaults to v1 (terse) when no variant is given', () => {
    const v1 = buildSystemPromptParts(preset, ctx()).stable;
    const explicitV1 = buildSystemPromptParts(preset, ctx('v1')).stable;
    expect(v1).toBe(explicitV1);
    expect(v1).toContain('Tool guidance:');
  });

  it('v2 is the richer clean-room prompt and is larger than v1', () => {
    const v1 = buildSystemPromptParts(preset, ctx('v1')).stable;
    const v2 = buildSystemPromptParts(preset, ctx('v2')).stable;
    expect(v2).not.toBe(v1);
    expect(v2.length).toBeGreaterThan(v1.length);
    // v2 encodes real behavioral discipline, not padding.
    expect(v2).toContain('Approach:');
    expect(v2).toContain('Grounding and honesty:');
    expect(v2).toContain('Finishing:');
    // both keep the cwd out of the cached (stable) segment
    expect(v2).not.toContain('/tmp/run-xyz');
  });

  it('v3 adds the four flagged disciplines on top of v2 and is larger still', () => {
    const v2 = buildSystemPromptParts(preset, ctx('v2')).stable;
    const v3 = buildSystemPromptParts(preset, ctx('v3')).stable;
    expect(v3).not.toBe(v2);
    expect(v3.length).toBeGreaterThan(v2.length);
    // the four techniques the public best-practices comparison flagged as missing
    expect(v3).toContain('Delegation:'); // when-to-delegate guidance
    expect(v3).toContain('verify your work against'); // verify-before-finishing
    expect(v3).toContain('Do not hard-code'); // solve the general problem
    expect(v3).toContain('for example:'); // one concrete style example
    // still keeps the cwd out of the cached (stable) segment
    expect(v3).not.toContain('/tmp/run-xyz');
  });

  it('append text lands in the stable segment for all variants', () => {
    const withAppend = { ...preset, append: 'EXTRA_INSTRUCTION' };
    for (const v of ['v1', 'v2', 'v3'] as const) {
      expect(buildSystemPromptParts(withAppend, ctx(v)).stable).toContain('EXTRA_INSTRUCTION');
    }
  });
});
