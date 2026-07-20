/**
 * Prompt assembler — main-loop surface (Track B).
 *
 * Deterministically composes the main-loop system prompt from the fragment
 * store (prompt-fragments.ts): intro -> dynamic "Available tools" line ->
 * the ordered body, dropping any fragment whose tool gate is not satisfied.
 * Same context in => byte-identical output out (the cached-prefix invariant).
 *
 * This reproduces the default harness prompt byte-for-byte (golden-locked in
 * tests/prompt-assembler.test.ts). Fragments carry provenance + a faithful flag
 * so a build-from-archive check (subsequent Track B phase) can hold them to the
 * upstream reconstruction.
 */

import {
  CONTINUATION_FRAGMENT,
  MAIN_LOOP_INTRO,
  MAIN_LOOP_BODY,
  type PromptFragment,
} from './prompt-fragments.js';

export interface AssembleContext {
  toolNames: string[];
  /** Arm the automation-continuation fragment (keeper memo 2026-07-18 §3).
   *  Appended LAST so the shared prefix bytes are unchanged when unarmed. */
  continuation?: boolean;
}

/** Fragments selected for this context, in order (intro first). Useful for provenance/audit. */
export function selectMainLoopFragments(ctx: AssembleContext): PromptFragment[] {
  const has = (t: string) => ctx.toolNames.includes(t);
  const out: PromptFragment[] = [MAIN_LOOP_INTRO];
  for (const f of MAIN_LOOP_BODY) {
    if (f.gate && !f.gate(has)) continue;
    out.push(f);
  }
  if (ctx.continuation === true) out.push(CONTINUATION_FRAGMENT);
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
    blocks.push(`Available tools: ${ctx.toolNames.join(', ')}.`);
  }
  for (const f of MAIN_LOOP_BODY) {
    if (f.gate && !f.gate(has)) continue;
    blocks.push(f.text);
  }
  if (ctx.continuation === true) blocks.push(CONTINUATION_FRAGMENT.text);
  return blocks.join('\n\n');
}
