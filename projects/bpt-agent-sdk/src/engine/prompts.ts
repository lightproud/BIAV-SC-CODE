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
};

/** Short default used when the caller passes no systemPrompt at all. */
function minimalDefault(ctx: PromptContext): string {
  return [
    'You are a coding agent running inside the bpt-agent-sdk harness.',
    `Working directory: ${ctx.cwd}`,
    'Use the available tools when they help you complete the task accurately, and report results concisely.',
  ].join('\n');
}

/** Full default harness prompt (selected by the `claude_code` preset). */
function defaultHarnessPrompt(ctx: PromptContext): string {
  const lines: string[] = [
    'You are an autonomous coding agent running inside the bpt-agent-sdk harness. You help the user by inspecting files, running commands, and making precise edits in their project.',
    '',
    `Working directory: ${ctx.cwd}`,
    'Treat relative paths as relative to this directory and prefer absolute paths in tool calls.',
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
 * Build the system prompt string for the run.
 * - undefined        -> minimal default prompt
 * - string           -> used verbatim
 * - claude_code preset -> this SDK's default harness prompt, with the
 *   optional `append` text concatenated after two newlines.
 */
export function buildSystemPrompt(
  opt: Options['systemPrompt'],
  ctx: PromptContext,
): string {
  if (opt === undefined) {
    return minimalDefault(ctx);
  }
  if (typeof opt === 'string') {
    return opt;
  }
  const base = defaultHarnessPrompt(ctx);
  if (opt.append !== undefined && opt.append.length > 0) {
    return `${base}\n\n${opt.append}`;
  }
  return base;
}
