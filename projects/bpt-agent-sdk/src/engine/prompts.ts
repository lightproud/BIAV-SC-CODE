/**
 * System prompt construction for the engine.
 *
 * Positioning (keeper ruling 2026-07-04): OPEN REPRODUCTION from PUBLIC
 * information, with attribution — not a clean-room black box.
 * - Variants v1-v3 are original compositions from public prompt-engineering
 *   guidance + open-source agent practice.
 * - Variant v4 is a faithful reproduction of the official Claude Code main-loop
 *   prompt, assembled from the PUBLIC prompt reconstruction (Piebald-AI
 *   snapshot, MIT, reverse-engineered from the publicly distributed CLI;
 *   archived under Public-Info-Pool/Reference/Claude-Code-System-Prompts/),
 *   with tool references adapted to THIS SDK's tools and CLI-only fragments
 *   (feedback channels, sandbox specifics) omitted.
 * The `claude_code` preset selects this SDK's default harness prompt for
 * drop-in call-site compatibility.
 */

import type { Options } from '../types.js';
import { assembleMainLoop } from './prompt-assembler.js';

/**
 * Runtime environment facts injected into the `<env>` block, reproducing the
 * official Claude Code runtime-assembly context (open reproduction). All
 * fields are optional; only those present are rendered. Gathered by the caller
 * (query.ts) since they require I/O (git, os, clock) that this pure module avoids.
 */
export type EnvironmentContext = {
  platform?: string;
  osVersion?: string;
  /** ISO date (YYYY-MM-DD). */
  date?: string;
  /** Model id the run is bound to. */
  model?: string;
  isGitRepo?: boolean;
  gitBranch?: string;
};

type PromptContext = {
  cwd: string;
  toolNames: string[];
  /**
   * Harness-prompt variant (BPT experiment). 'v1' = the terse original;
   * 'v2' = a richer prompt composed from PUBLIC prompt-engineering guidance +
   * open-source agent practice; 'v3' = v2 plus verify-before-finishing,
   * no-hard-coding, delegation guidance, and a style example; 'v4' = a faithful
   * reproduction of the official main-loop prompt from the PUBLIC prompt
   * reconstruction, tool references adapted to this SDK; 'v5' = a COMPREHENSIVE
   * faithful reproduction of the official main-loop prompt (fuller doing-tasks /
   * tool-use discipline / executing-actions / communication clauses) — fidelity
   * to the official, adapted to our tools (open reproduction, see file header).
   * Only affects the `claude_code` preset / default path. Default 'v1'.
   */
  variant?: 'v1' | 'v2' | 'v3' | 'v4' | 'v5';
  /**
   * Runtime environment facts. When present, an `<env>` block reproducing the
   * official runtime-assembly context is rendered into the volatile tail.
   */
  environment?: EnvironmentContext;
  /**
   * Project/user instruction text (CLAUDE.md / AGENTS.md contents), loaded per
   * `settingSources`. Injected into the STABLE prefix (stable per project, so
   * cacheable) as a `<system-reminder>`-framed block, matching how the official
   * runtime carries codebase instructions.
   */
  projectInstructions?: string;
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
  /**
   * The base harness portion of `stable` (the vN harness prompt only), WITHOUT
   * the appended project-instructions / append tail. Shared across projects, so
   * worth caching as its own reusable segment. Invariant: `base + project ===
   * stable` byte-for-byte (project carries its own leading separators).
   */
  base: string;
  /**
   * The appended stable tail of `stable`: the CLAUDE.md / AGENTS.md
   * `<system-reminder>` block and/or `append` text, INCLUDING the leading
   * `\n\n` separators, or '' when there is no such tail. Per-project (so it
   * caches independently of the shared base) — this is the second system cache
   * segment. Invariant: `base + project === stable`.
   */
  project: string;
  volatile: string;
};

/**
 * The official-style `<env>` runtime-context block. Reproduces the public
 * Claude Code runtime assembly: working directory, git-repo status/branch,
 * platform, OS version, and date, followed by the model line. Only fields
 * present in `env` are emitted. Lives in the volatile tail (it carries
 * per-run/per-day facts) so it never invalidates the cached stable prefix.
 */
function environmentBlock(cwd: string, env: EnvironmentContext): string {
  const inner = [`Working directory: ${cwd}`];
  if (env.isGitRepo !== undefined) {
    inner.push(`Is directory a git repo: ${env.isGitRepo ? 'Yes' : 'No'}`);
  }
  if (env.isGitRepo && env.gitBranch) inner.push(`Git branch: ${env.gitBranch}`);
  if (env.platform) inner.push(`Platform: ${env.platform}`);
  if (env.osVersion) inner.push(`OS Version: ${env.osVersion}`);
  if (env.date) inner.push(`Today's date: ${env.date}`);
  const lines = [
    'Here is useful information about the environment you are running in:',
    '<env>',
    ...inner,
    '</env>',
  ];
  if (env.model) lines.push(`You are powered by the model named ${env.model}.`);
  return lines.join('\n');
}

/**
 * The per-run volatile tail: the `<env>` context block when environment facts
 * are supplied, else the bare working directory. Either way the cwd is present
 * so relative-path guidance stays valid.
 */
function volatileTail(ctx: PromptContext, withPathGuidance: boolean): string {
  const lines = ctx.environment
    ? [environmentBlock(ctx.cwd, ctx.environment)]
    : [`Working directory: ${ctx.cwd}`];
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
 * padded. Open reproduction: original composition from PUBLIC prompt-engineering
 * guidance + open-source practice, no verbatim proprietary clone.
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
 * Stable part of the v3 harness prompt (no cwd). v2 + four techniques the
 * public best-practices comparison flagged as missing/partial, each a genuine
 * behavioral discipline (not padding): verify-before-finishing, solve the
 * general problem (no hard-coding to a check), when-to-delegate guidance, and
 * one concrete style example for the closing summary. Open reproduction:
 * original composition from PUBLIC prompt-engineering guidance + open-source
 * practice, no verbatim proprietary clone.
 */
function defaultHarnessStableV3(ctx: PromptContext): string {
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
    '- Solve the general problem, not just the example. Do not hard-code an output to satisfy a specific check or test; write code that also works for inputs beyond the ones you were given.',
    '',
    'Grounding and honesty:',
    '- Base every statement on actual tool output. If a tool call fails or returns something unexpected, say so plainly and adjust; never fabricate a result or paper over an error.',
    '- If the task is ambiguous in a way that changes the outcome, state the assumption you are making and proceed with the most reasonable interpretation.',
    '',
  );
  // Delegation guidance names the Agent tool — include it only when subagents
  // are configured (query.ts registers the Agent tool only then), else the
  // prompt would reference a tool the run cannot call.
  if (ctx.toolNames.includes('Agent')) {
    lines.push(
      'Delegation:',
      '- Delegate to a subagent (via the Agent tool) only when a subtask is large or independent enough to benefit — broad multi-file exploration, or a self-contained unit that can run in parallel. For a quick lookup or a single search, do it directly; do not spawn a subagent when a direct tool call is faster.',
      '',
    );
  }
  lines.push(
    'Finishing:',
    '- Before finishing, verify your work against the task\'s success criteria: re-read the files you changed, and where a test or check exists, run it and confirm it passes.',
    '- Stop when the task is complete; do not perform work the user did not request.',
    '- End with a short, accurate summary of what changed and how you verified it — for example: "Fixed the off-by-one in calc.mjs:12; confirmed total([1,2,3,4]) now returns 10."',
    '',
    'Safety: never run destructive or irreversible commands (deleting files or branches, force-pushing, dropping databases, mass overwrites) unless the user has explicitly requested that exact operation.',
  );
  return lines.join('\n');
}

/**
 * Stable part of the v4 harness prompt (no cwd): a FAITHFUL REPRODUCTION of the
 * official Claude Code main-loop system prompt, assembled from the PUBLIC prompt
 * reconstruction (Piebald-AI snapshot v2.1.x, MIT, reverse-engineered from the
 * publicly distributed CLI; archived under
 * Public-Info-Pool/Reference/Claude-Code-System-Prompts/). Open reproduction
 * from public information with attribution (keeper ruling 2026-07-04). The
 * behavioral / communication clauses are reproduced faithfully; tool references
 * are adapted to THIS SDK's tools; CLI-only fragments (feedback channels,
 * sandbox specifics, tools this SDK does not ship) are omitted so the prompt
 * never references a tool that is not present.
 */
function defaultHarnessStableV4(ctx: PromptContext): string {
  const lines: string[] = [
    // intro (interactive-agent-intro-short)
    'You are an interactive agent that helps users with software engineering tasks.',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`Available tools: ${ctx.toolNames.join(', ')}.`, '');
  }
  lines.push(
    // doing-tasks-software-engineering-focus
    'The user will primarily request you to perform software engineering tasks. These may include solving bugs, adding new functionality, refactoring code, explaining code, and more. When given an unclear or generic instruction, consider it in the context of these software engineering tasks and the current working directory. For example, if the user asks you to change "methodName" to snake case, do not reply with just "method_name", instead find the method in the code and modify the code.',
    '',
    // doing-tasks-no-unnecessary-additions
    "Don't add features, refactor, or introduce abstractions beyond what the task requires. A bug fix doesn't need surrounding cleanup; a one-shot operation doesn't need a helper. Don't design for hypothetical future requirements. Three similar lines is better than a premature abstraction. No half-finished implementations either.",
    '',
    // doing-tasks-no-unnecessary-error-handling
    "Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries (user input, external APIs). Don't use feature flags or backwards-compatibility shims when you can just change the code.",
    '',
    // doing-tasks-no-compatibility-hacks
    'Avoid backwards-compatibility hacks like renaming unused _vars, re-exporting types, adding // removed comments for removed code, etc. If you are certain that something is unused, you can delete it completely.',
    '',
    // doing-tasks-ambitious-tasks
    'You are highly capable and often allow users to complete ambitious tasks that would otherwise be too complex or take too long. You should defer to user judgement about whether a task is too large to attempt.',
    '',
    // doing-tasks-security
    'Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities. If you notice that you wrote insecure code, immediately fix it. Prioritize writing safe, secure, and correct code.',
    '',
    // tool-use discipline (adapted to this SDK's tools; official prefers
    // dedicated tools over shell and batches independent read-only calls)
    'Prefer the dedicated file tools (Read, Write, Edit, Glob, Grep) over shell commands for inspecting or modifying files. Read a file before editing it. When several independent read-only lookups would help, issue them together rather than one at a time. Base every claim on actual tool output; if a tool call fails, say so instead of guessing.',
    '',
    // outcome-first-communication-style (IS_TEXT_OUTPUT_VISIBLE_TO_USER resolved
    // to the visible branch, since the SDK consumer reads the final message)
    'Communicating with the user:',
    "Your text output is what the user reads; they usually can't see your thinking or the raw tool results. Write it for a teammate who stepped away and is catching up, not for a log file: they don't know the codenames or shorthand you created along the way, and they didn't watch your process unfold. Before your first tool call, say in a sentence what you're about to do; while working, give brief updates when you find something load-bearing or change direction.",
    '',
    'Everything the user needs from this turn — answers, summaries, findings, conclusions, deliverables — must be in the final text message of your turn, with no tool calls after it. Keep text between tool calls to brief status notes. If something important appeared only mid-turn or in your thinking, restate it in that final message.',
    '',
    'Lead with the outcome. Your first sentence after finishing should answer "what happened" or "what did you find" — the thing the user would ask for if they said "just give me the TLDR." Supporting detail and reasoning come after, for readers who want them.',
    '',
    'Being readable and being concise are different things, and readable matters more. Keep output short by being selective about what you include (drop details that don\'t change what the reader would do next), not by compressing into fragments, abbreviations, arrow chains, or jargon. Write what you include in complete sentences with the technical terms spelled out. Match the response to the question: a simple question gets a direct answer in prose, not headers and sections.',
    '',
    // tone-and-style-code-references
    'When referencing specific functions or pieces of code include the pattern file_path:line_number to allow the user to easily navigate to the source code location.',
    '',
    'Write code that reads like the surrounding code: match its comment density, naming, and idiom. Default to writing no comments; only write a code comment to state a constraint the code itself can\'t show. Don\'t create planning, decision, or analysis documents unless the user asks for them — work from conversation context, not intermediate files.',
    '',
    'Safety: never run destructive or irreversible commands (deleting files or branches, force-pushing, dropping databases, mass overwrites) unless the user has explicitly requested that exact operation.',
  );
  return lines.join('\n');
}

/**
 * Stable part of the v5 harness prompt (no cwd): a COMPREHENSIVE faithful
 * reproduction of the official Claude Code main-loop system prompt — the fuller
 * set of doing-tasks, tool-use discipline, executing-actions-with-care,
 * outcome-first communication, and code-style clauses the everyday coding loop
 * actually sends. Assembled from the PUBLIC prompt reconstruction (Piebald-AI
 * snapshot, MIT, reverse-engineered from the publicly distributed CLI; archived
 * under Public-Info-Pool/Reference/Claude-Code-System-Prompts/). Open
 * reproduction with attribution (keeper ruling 2026-07-04/05). The goal is
 * FIDELITY to the official prompt (not size); tool references are adapted to
 * THIS SDK's tools, and clauses referencing tools/features this SDK does not
 * ship are omitted (never reference an absent tool). A comfortably large stable
 * prefix is a byproduct, and — per the 2026-07-05 cache probe — it also crosses
 * Haiku's effective caching threshold so the prefix is actually cached/reused.
 */
function defaultHarnessStableV5(ctx: PromptContext): string {
  // Migrated to the fragment-store assembler (Track B): assembleMainLoop
  // composes the main-loop prompt from prompt-fragments.ts and reproduces
  // the prior inline v5 byte-for-byte (golden-locked in prompt-assembler.test).
  return assembleMainLoop({ toolNames: ctx.toolNames });
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
    const stable = minimalStable();
    return { stable, base: stable, project: '', volatile: volatileTail(ctx, false) };
  }
  if (typeof opt === 'string') {
    return { stable: opt, base: opt, project: '', volatile: '' };
  }
  // Segments form is composed by the caller and handled upstream (query.ts);
  // if it ever reaches here, flatten it defensively rather than throw.
  if (opt.type === 'segments') {
    const stable = opt.segments.map((s) => s.text).join('\n\n');
    return { stable, base: stable, project: '', volatile: '' };
  }
  // Default (no explicit variant) emulates the official Claude Code harness:
  // v5 is the comprehensive faithful reproduction. A measured v1-vs-v5 A/B
  // showed v5 is ~3x CHEAPER in multi-turn (95% vs 0% cache hit — v1's tiny
  // prompt sits below the effective cache threshold, so nothing caches and
  // every turn re-sends at full price; v5's big stable prefix caches and is
  // read back at ~10% cost) at equal correctness. Explicit v1-v4 remain
  // available as opt-in for a terser prompt.
  const base =
    ctx.variant === 'v5'
      ? defaultHarnessStableV5(ctx)
      : ctx.variant === 'v4'
        ? defaultHarnessStableV4(ctx)
        : ctx.variant === 'v3'
          ? defaultHarnessStableV3(ctx)
          : ctx.variant === 'v2'
            ? defaultHarnessStableV2(ctx)
            : ctx.variant === 'v1'
              ? defaultHarnessStable(ctx)
              : defaultHarnessStableV5(ctx);
  // The appended stable tail (project instructions + append). Carries its own
  // leading `\n\n` separators so `base + project === stable` byte-for-byte,
  // and so it can cache as its own reusable segment (the 2nd system breakpoint)
  // independently of the shared base harness.
  let project = '';
  // Codebase instructions (CLAUDE.md / AGENTS.md), loaded per settingSources.
  // Framed as a system-reminder and kept in the STABLE prefix (stable per
  // project -> cacheable), reproducing how the official runtime carries them.
  if (ctx.projectInstructions !== undefined && ctx.projectInstructions.length > 0) {
    project +=
      `\n\n<system-reminder>\nThe following instructions come from ` +
      `CLAUDE.md / AGENTS.md files in the project. Follow them as if the user ` +
      `wrote them.\n\n${ctx.projectInstructions}\n</system-reminder>`;
  }
  if (opt.append !== undefined && opt.append.length > 0) {
    project += `\n\n${opt.append}`;
  }
  const stable = base + project;
  return { stable, base, project, volatile: volatileTail(ctx, true) };
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
