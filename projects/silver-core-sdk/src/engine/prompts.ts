/**
 * System prompt construction for the engine.
 *
 * Positioning (keeper ruling 2026-07-04): OPEN REPRODUCTION from PUBLIC
 * information, with attribution — not a clean-room black box.
 *
 * There is ONE harness prompt: a comprehensive faithful reproduction of the
 * official Claude Code main-loop system prompt, assembled from the PUBLIC prompt
 * reconstruction (Piebald-AI snapshot, MIT, reverse-engineered from the publicly
 * distributed CLI; archived under Public-Info-Pool/Reference/Claude-Code-System-Prompts/),
 * with tool references adapted to THIS SDK's tools and CLI-only fragments
 * omitted. Both an unset `systemPrompt` and the `claude_code` preset resolve to
 * it — there is no variant selection (the earlier v1-v4 BPT experiment ladder
 * was collapsed to this single default, keeper ruling 2026-07-08).
 */

import type { Options } from '../types.js';
import type { SystemCompositionPart } from '../internal/contracts.js';
import { assembleMainLoop } from './prompt-assembler.js';
import { estimateTextTokens } from './tokens.js';

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

export type PromptContext = {
  cwd: string;
  toolNames: string[];
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
   * The base harness portion of `stable` (the harness prompt only), WITHOUT
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
  /**
   * BPT-EXTENSION (prompt-composition, 2026-07-09): the stable prompt decomposed
   * into labeled parts (base harness, then each appended tail piece), each with
   * a token estimate. Feeds the prompt-composition breakdown's 需求 A
   * systemBase/systemAppend split. Excludes the volatile (cwd/env) tail and the
   * structured-output instruction, which the caller (query.ts) appends since it
   * owns those; order matches the assembled `stable` string.
   */
  parts: SystemCompositionPart[];
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
function volatileTail(ctx: PromptContext): string {
  const lines = ctx.environment
    ? [environmentBlock(ctx.cwd, ctx.environment)]
    : [`Working directory: ${ctx.cwd}`];
  lines.push('Treat relative paths as relative to this directory and prefer absolute paths in tool calls.');
  return lines.join('\n');
}

/**
 * The default harness prompt (no cwd): a COMPREHENSIVE faithful reproduction of
 * the official Claude Code main-loop system prompt — the fuller set of
 * doing-tasks, tool-use discipline, executing-actions-with-care, outcome-first
 * communication, and code-style clauses the everyday coding loop actually sends.
 * Assembled from the PUBLIC prompt reconstruction (Piebald-AI snapshot, MIT,
 * reverse-engineered from the publicly distributed CLI; archived under
 * Public-Info-Pool/Reference/Claude-Code-System-Prompts/). Open reproduction
 * with attribution (keeper ruling 2026-07-04/05). The goal is FIDELITY to the
 * official prompt; tool references are adapted to THIS SDK's tools, and clauses
 * referencing tools/features this SDK does not ship are omitted (never reference
 * an absent tool). The large stable prefix crosses the effective caching
 * threshold so the prefix is actually cached/reused across turns — a measured
 * A/B against a terse prompt showed this is ~3x cheaper in multi-turn (95% vs 0%
 * cache hit) at equal correctness, which is why it is the single default.
 */
function defaultHarnessStable(ctx: PromptContext): string {
  // Composed by the fragment-store assembler (assembleMainLoop) from
  // prompt-fragments.ts; byte-locked by prompt-assembler.test / v5-mainloop-golden.
  return assembleMainLoop({ toolNames: ctx.toolNames });
}

/**
 * Build the system prompt split into stable prefix + volatile (cwd) tail.
 * - string             -> the caller's text is treated as entirely stable
 *   (we cannot know which parts vary), with no volatile tail
 * - undefined OR the claude_code preset -> this SDK's single default harness
 *   prompt + cwd tail, with optional `append` (preset only) in the stable
 *   segment. There is no variant selection: both paths converge to one prompt.
 */
export function buildSystemPromptParts(
  opt: Options['systemPrompt'],
  ctx: PromptContext,
): SystemPromptParts {
  if (typeof opt === 'string') {
    return {
      stable: opt,
      base: opt,
      project: '',
      volatile: '',
      parts: [{ role: 'base', label: 'base', estTokens: estimateTextTokens(opt) }],
    };
  }
  // Segments form is composed by the caller and handled upstream (query.ts);
  // if it ever reaches here, flatten it defensively rather than throw. E8
  // (audit r2): "defensively" must include the segments themselves — a null
  // entry or a missing/non-string `text` made this self-described no-throw
  // path throw a TypeError (config-builder applies the same filter).
  if (opt !== undefined && opt.type === 'segments') {
    const segments = (Array.isArray(opt.segments) ? opt.segments : []).filter(
      (s): s is (typeof opt.segments)[number] =>
        s !== null && typeof s === 'object' && typeof s.text === 'string' && s.text.length > 0,
    );
    const stable = segments.map((s) => s.text).join('\n\n');
    return {
      stable,
      base: stable,
      project: '',
      volatile: '',
      parts: segments.map((s) => ({
        role: 'segment',
        label: s.label,
        estTokens: estimateTextTokens(s.text),
      })),
    };
  }
  // undefined OR the claude_code preset -> the single default harness prompt,
  // a comprehensive faithful reproduction of the official Claude Code main loop
  // assembled from the fragment store.
  const base = defaultHarnessStable(ctx);
  // The appended stable tail (project instructions + append). Carries its own
  // leading `\n\n` separators so `base + project === stable` byte-for-byte,
  // and so it can cache as its own reusable segment (the 2nd system breakpoint)
  // independently of the shared base harness.
  let project = '';
  const parts: SystemCompositionPart[] = [
    { role: 'base', label: 'base', estTokens: estimateTextTokens(base) },
  ];
  // Codebase instructions (CLAUDE.md / AGENTS.md), loaded per settingSources.
  // Framed as a system-reminder and kept in the STABLE prefix (stable per
  // project -> cacheable), reproducing how the official runtime carries them.
  if (ctx.projectInstructions !== undefined && ctx.projectInstructions.length > 0) {
    const block =
      `\n\n<system-reminder>\nThe following instructions come from ` +
      `CLAUDE.md / AGENTS.md files in the project. Follow them as if the user ` +
      `wrote them.\n\n${ctx.projectInstructions}\n</system-reminder>`;
    project += block;
    parts.push({
      role: 'codebase-instructions',
      label: 'codebase-instructions',
      estTokens: estimateTextTokens(block),
    });
  }
  // `append` is preset-only; the undefined path has no append to carry.
  if (opt !== undefined && opt.append !== undefined && opt.append.length > 0) {
    project += `\n\n${opt.append}`;
    parts.push({ role: 'append', label: 'append', estTokens: estimateTextTokens(opt.append) });
  }
  // BPT-EXTENSION: labeled append segments, emitted after `append`, in order.
  // Byte-identical to concatenating their text via `append`; labels are metadata
  // that flow only into `parts` (never onto the wire). Preset-only (opt-guarded,
  // like `append`): the undefined path has no segments to carry.
  if (opt !== undefined && Array.isArray(opt.appendSegments)) {
    for (const seg of opt.appendSegments) {
      if (seg !== null && typeof seg.text === 'string' && seg.text.length > 0) {
        project += `\n\n${seg.text}`;
        parts.push({ role: 'append', label: seg.label, estTokens: estimateTextTokens(seg.text) });
      }
    }
  }
  const stable = base + project;
  return { stable, base, project, volatile: volatileTail(ctx), parts };
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
