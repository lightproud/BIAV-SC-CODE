/**
 * Main-loop assembler (Track B): byte-identity golden lock + fragment-store
 * invariants (provenance, tool-gating, red line).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assembleMainLoop, selectMainLoopFragments } from '../src/engine/prompt-assembler.js';
import { MAIN_LOOP_INTRO, MAIN_LOOP_BODY } from '../src/engine/prompt-fragments.js';
import { buildSystemPromptParts } from '../src/engine/prompts.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'fixtures', 'v5-mainloop-golden.json'), 'utf8')) as Record<
  string,
  string
>;

const SETS: Record<string, string[]> = {
  full: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'BashOutput', 'KillShell', 'TodoWrite', 'WebFetch', 'WebSearch', 'AskUserQuestion'],
  withAgent: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'TodoWrite', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'Agent'],
  minimal: ['Read', 'Bash'],
  noWeb: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'TodoWrite', 'AskUserQuestion'],
};

const preset = { type: 'preset' as const, preset: 'claude_code' as const };

describe('main-loop assembler: byte-identity golden lock', () => {
  it('assembleMainLoop reproduces the frozen v5 output for every tool set', () => {
    for (const [name, toolNames] of Object.entries(SETS)) {
      expect(assembleMainLoop({ toolNames }), name).toBe(golden[name]);
    }
  });

  it('the default claude_code preset (through buildSystemPromptParts) equals the golden stable prefix', () => {
    for (const [name, toolNames] of Object.entries(SETS)) {
      const stable = buildSystemPromptParts(preset, { cwd: '/GOLDEN_CWD', toolNames }).stable;
      expect(stable, name).toBe(golden[name]);
    }
  });
});

describe('fragment store invariants', () => {
  it('every fragment carries provenance (id + slug)', () => {
    for (const f of [MAIN_LOOP_INTRO, ...MAIN_LOOP_BODY]) {
      expect(f.id.length).toBeGreaterThan(0);
      expect(f.slug.length).toBeGreaterThan(0);
      expect(f.text.length).toBeGreaterThan(0);
    }
  });

  it('fragment ids are unique', () => {
    const ids = [MAIN_LOOP_INTRO, ...MAIN_LOOP_BODY].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('RED LINE: any fragment naming a conditionally-shipped tool is gated on it', () => {
    // The Agent tool is registered only when subagents are configured.
    const agent = MAIN_LOOP_BODY.find((f) => f.id === 'agent');
    expect(agent?.gate).toBeDefined();
    // Assembled without Agent, the prompt must not name the Agent tool.
    expect(assembleMainLoop({ toolNames: ['Read', 'Bash', 'TodoWrite'] })).not.toContain('Agent tool');
    // Assembled with Agent, it appears.
    expect(assembleMainLoop({ toolNames: ['Read', 'Bash', 'Agent'] })).toContain('Agent tool');
  });

  it('selectMainLoopFragments drops gated fragments whose tool is absent', () => {
    const picked = selectMainLoopFragments({ toolNames: ['Read', 'Bash'] }).map((f) => f.id);
    expect(picked).toContain('intro');
    expect(picked).toContain('safety-destructive-commands');
    expect(picked).not.toContain('agent');
    expect(picked).not.toContain('todowrite');
    expect(picked).not.toContain('webfetch-websearch');
  });
});
