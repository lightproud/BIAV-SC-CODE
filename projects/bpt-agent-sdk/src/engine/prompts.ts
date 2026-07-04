/**
 * System prompt construction for the engine.
 *
 * All prompt text here is ORIGINAL clean-room copy written for this SDK.
 * It intentionally does not reproduce any proprietary system prompt; the
 * `claude_code` preset only selects this SDK's own default harness prompt
 * for drop-in call-site compatibility.
 */

import type { Options } from '../types.js';

type PromptContext = {
  cwd: string;
  toolNames: string[];
  /**
   * Harness-prompt variant (BPT experiment). 'v1' = the terse original;
   * 'v2' = a richer clean-room prompt written from PUBLIC prompt-engineering
   * guidance + open-source agent practice (no proprietary text copied). Only
   * affects the `claude_code` preset / default path. Default 'v1'.
   */
  variant?: 'v1' | 'v2';
};

/**
 * A system prompt split into a STABLE prefix and a VOLATILE tail.
 *
 * The stable part is byte-identical across every run in an org (tool list +
 * static guidance), so it is the segment worth prompt-caching: placing the
 * cache breakpoint at the stable/volatile boundary lets independent queries
 * share the cached prefix within the cache TTL (cross-query reuse). The
 * volatile tail (the working directory, which varies per run) is sent AFTER
 * the breakpoint so it never invalidates the cached prefix.
 */
export type SystemPromptParts = {
  stable: string;
  volatile: string;
};

/** The per-run volatile tail: the working directory + its path guidance. */
function volatileTail(ctx: PromptContext, withPathGuidance: boolean): string {
  const lines = [`Working directory: ${ctx.cwd}`];
  if (withPathGuidance) {
    lines.push('Treat relative paths as relative to this directory and prefer absolute paths in tool calls.');
  }
  return lines.join('\n');
}

/** Stable part of the minimal default (no cwd). */
function minimalStable(): string {
  return [
    'You are a coding agent running inside the bpt-agent-sdk harness.',
    'Use the available tools when they help you complete the task accurately, and report results concisely.',
  ].join('\n');
}

/** Stable part of the full default harness prompt (no cwd). */
function defaultHarnessStable(ctx: PromptContext): string {
  const lines: string[] = [
    'You are an autonomous coding agent running inside the bpt-agent-sdk harness. You help the user by inspecting files, running commands, and making precise edits in their project.',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`Available tools: ${ctx.toolNames.join(', ')}.`);
  }
  lines.push(
    'Tool guidance:',
    '- Read files before editing them, and keep edits minimal and targeted.',
    '- Prefer dedicated file tools (Read, Write, Edit, Glob, Grep) over shell commands for inspecting or modifying files.',
    '- Base every claim on actual tool output; if a tool call fails, say so instead of guessing.',
    '- When a task is complete, summarize what changed briefly and accurately.',
    '',
    'Safety: never run destructive or irreversible commands (deleting files or branches, force-pushing, dropping databases, mass overwrites) unless the user has explicitly requested that exact operation.',
  );
  return lines.join('\n');
}

/**
 * Stable part of the v2 harness prompt (no cwd). Written from PUBLIC
 * prompt-engineering guidance and common open-source agent practice — it is
 * richer than v1 because it encodes more real behavioral discipline (plan,
 * gather context first, parallel read-only lookups, verify after editing,
 * ground claims in tool output, clean stop conditions), NOT because it is
 * padded. Clean-room: original composition, zero proprietary text.
 */
function defaultHarnessStableV2(ctx: PromptContext): string {
  const lines: string[] = [
    'You are an autonomous software-engineering agent operating inside the bpt-agent-sdk harness. You complete the user\'s task end to end by inspecting the project, running commands, and making precise edits — always using the available tools rather than guessing.',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`Available tools: ${ctx.toolNames.join(', ')}.`, '');
  }
  lines.push(
    'Approach:',
    '- Before acting, form a brief plan: what you must learn, and the smallest set of steps that accomplishes the task.',
    '- Gather context first. Read the relevant files and search the project before changing anything; never assume a file\'s contents or a path you have not verified.',
    '- When several independent read-only lookups would help (reading different files, separate searches), issue them together rather than one at a time.',
    '',
    'Making changes:',
    '- Keep edits minimal and targeted; change only what the task requires and match the surrounding style.',
    '- Read a file immediately before editing it, and read the result back afterward to confirm the change landed as intended.',
    '- Prefer the dedicated file tools (Read, Write, Edit, Glob, Grep) over shell commands for inspecting or modifying files.',
    '',
    'Grounding and honesty:',
    '- Base every statement on actual tool output. If a tool call fails or returns something unexpected, say so plainly and adjust; never fabricate a result or paper over an error.',
    '- If the task is ambiguous in a way that changes the outcome, state the assumption you are making and proceed with the most reasonable interpretation.',
    '',
    'Finishing:',
    '- Stop when the task is complete; do not perform work the user did not request.',
    '- End with a short, accurate summary of what you changed and how you verified it.',
    '',
    'Safety: never run destructive or irreversible commands (deleting files or branches, force-pushing, dropping databases, mass overwrites) unless the user has explicitly requested that exact operation.',
  );
  return lines.join('\n');
}

/**
 * Build the system prompt split into stable prefix + volatile (cwd) tail.
 * - undefined          -> minimal default (stable) + cwd tail
 * - string             -> the caller's text is treated as entirely stable
 *   (we cannot know which parts vary), with no volatile tail
 * - claude_code preset -> this SDK's default harness prompt (stable, v1 or v2
 *   per ctx.variant) + cwd tail, with optional `append` in the stable segment
 */
export function buildSystemPromptParts(
  opt: Options['systemPrompt'],
  ctx: PromptContext,
): SystemPromptParts {
  if (opt === undefined) {
    return { stable: minimalStable(), volatile: volatileTail(ctx, false) };
  }
  if (typeof opt === 'string') {
    return { stable: opt, volatile: '' };
  }
  let stable =
    ctx.variant === 'v2' ? defaultHarnessStableV2(ctx) : defaultHarnessStable(ctx);
  if (opt.append !== undefined && opt.append.length > 0) {
    stable = `${stable}\n\n${opt.append}`;
  }
  return { stable, volatile: volatileTail(ctx, true) };
}

/**
 * Build the system prompt as one string (stable + volatile joined). Retained
 * for callers/tests that want the flat prompt; the engine uses the split form
 * so the stable prefix can be cached independently of the cwd tail.
 */
export function buildSystemPrompt(
  opt: Options['systemPrompt'],
  ctx: PromptContext,
): string {
  const { stable, volatile } = buildSystemPromptParts(opt, ctx);
  return volatile.length > 0 ? `${stable}\n${volatile}` : stable;
}
