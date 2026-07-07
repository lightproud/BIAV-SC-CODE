/**
 * Prompt assembler — main-loop surface (Track B).
 *
 * Deterministically composes the main-loop system prompt from the fragment
 * store (prompt-fragments.ts): intro -> dynamic "Available tools" line ->
 * the ordered body, dropping any fragment whose tool gate is not satisfied.
 * Same context in => byte-identical output out (the cached-prefix invariant).
 *
 * This reproduces defaultHarnessStableV5 byte-for-byte (golden-locked in
 * tests/prompt-assembler.test.ts). Fragments carry provenance + a faithful flag
 * so a build-from-archive check (subsequent Track B phase) can hold them to the
 * upstream reconstruction.
 */

import {
  MAIN_LOOP_INTRO,
  MAIN_LOOP_BODY,
  type PromptFragment,
} from './prompt-fragments.js';

export interface AssembleContext {
  toolNames: string[];
}

/** Fragments selected for this context, in order (intro first). Useful for provenance/audit. */
export function selectMainLoopFragments(ctx: AssembleContext): PromptFragment[] {
  const has = (t: string) => ctx.toolNames.includes(t);
  const out: PromptFragment[] = [MAIN_LOOP_INTRO];
  for (const f of MAIN_LOOP_BODY) {
    if (f.gate && !f.gate(has)) continue;
    out.push(f);
  }
  return out;
}

/**
 * Assemble the main-loop stable prefix. Blocks are joined with a blank line, and
 * the dynamic "Available tools: ..." line is inserted right after the intro
 * (matching the official runtime assembly and the prior v5 layout).
 */
export function assembleMainLoop(ctx: AssembleContext): string {
  const has = (t: string) => ctx.toolNames.includes(t);
  const blocks: string[] = [MAIN_LOOP_INTRO.text];
  if (ctx.toolNames.length > 0) {
    // i18n-zh Phase 2 batch A: the "可用工具" label is Chinese; tool names stay English.
    blocks.push(`可用工具：${ctx.toolNames.join(', ')}。`);
  }
  for (const f of MAIN_LOOP_BODY) {
    if (f.gate && !f.gate(has)) continue;
    blocks.push(f.text);
  }
  return blocks.join('\n\n');
}
