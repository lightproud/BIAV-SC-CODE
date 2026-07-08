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
 *
 * i18n-zh Phase 2 (keeper ruling B, 2026-07-08): the harness SYSTEM PROMPTS are
 * translated to Chinese in-place. batch A translated the default v5 (the
 * fragment-store main-loop); batch E translated the opt-in variants
 * minimalStable / v1 / v2 / v3 / v4 (tool names + `file_path:line_number` + the
 * calc.mjs example kept English; the "可用工具" label replaces "Available tools").
 * DELIBERATELY STILL ENGLISH: the runtime `<env>` context block (environmentBlock
 * / volatileTail path-guidance) and the CLAUDE.md/AGENTS.md system-reminder
 * wrapper — these are not "prompts" but a conformance-LOCKED reproduction of the
 * official Claude Code runtime-context assembly (working directory, git status,
 * date, model line), byte-asserted by conformance-l2-locks / api-surface /
 * engine / cache-control. Translating them would break the SDK's official-parity
 * claim, so they stay English (same scope boundary as the runtime stderr hints).
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
    '你是一个在 bpt-agent-sdk 框架内运行的编码代理。',
    '当可用工具有助于你准确完成任务时就使用它们，并简明地报告结果。',
  ].join('\n');
}

/** Stable part of the full default harness prompt (no cwd). */
function defaultHarnessStable(ctx: PromptContext): string {
  const lines: string[] = [
    '你是一个在 bpt-agent-sdk 框架内运行的自主编码代理。你通过检查文件、运行命令、并在用户的项目中做精确的编辑来帮助用户。',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`可用工具：${ctx.toolNames.join(', ')}。`);
  }
  lines.push(
    '工具指引：',
    '- 编辑文件前先读取它们，且让编辑保持精简、有针对性。',
    '- 检查或修改文件时，优先用专用文件工具（Read、Write、Edit、Glob、Grep）而非 shell 命令。',
    '- 每一条主张都基于真实的工具输出；若某次工具调用失败，就如实说明而非猜测。',
    '- 任务完成时，简短而准确地总结改了什么。',
    '',
    '安全：绝不运行破坏性或不可逆的命令（删除文件或分支、强制推送、删除数据库、大规模覆盖），除非用户明确请求了那个确切的操作。',
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
    '你是一个在 bpt-agent-sdk 框架内运行的自主软件工程代理。你通过检查项目、运行命令、并做精确的编辑，端到端地完成用户的任务——始终使用可用工具而非猜测。',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`可用工具：${ctx.toolNames.join(', ')}。`, '');
  }
  lines.push(
    '方法：',
    '- 行动前，形成一个简短的计划：你必须了解什么、以及完成任务的最小步骤集。',
    '- 先收集上下文。改动任何东西之前，先读相关文件、搜索项目；绝不臆断一个文件的内容或一条你尚未核实的路径。',
    '- 当若干相互独立的只读查找会有帮助时（读不同文件、分开搜索），把它们一起发出而非一次一个。',
    '',
    '做出更改：',
    '- 让编辑保持精简、有针对性；只改任务所需，并匹配周围的风格。',
    '- 编辑某文件前立即读取它，之后再读回结果以确认更改如预期落地。',
    '- 检查或修改文件时，优先用专用文件工具（Read、Write、Edit、Glob、Grep）而非 shell 命令。',
    '',
    '基于事实与诚实：',
    '- 每一条陈述都基于真实的工具输出。若某次工具调用失败或返回意料之外的东西，就直白地说明并调整；绝不捏造结果或掩盖错误。',
    '- 若任务的含糊之处会改变结果，就说明你所作的假设，并以最合理的解读继续。',
    '',
    '收尾：',
    '- 任务完成时停止；不要做用户未请求的工作。',
    '- 以一段简短、准确的总结结尾，说明你改了什么、以及如何核实的。',
    '',
    '安全：绝不运行破坏性或不可逆的命令（删除文件或分支、强制推送、删除数据库、大规模覆盖），除非用户明确请求了那个确切的操作。',
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
    '你是一个在 bpt-agent-sdk 框架内运行的自主软件工程代理。你通过检查项目、运行命令、并做精确的编辑，端到端地完成用户的任务——始终使用可用工具而非猜测。',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`可用工具：${ctx.toolNames.join(', ')}。`, '');
  }
  lines.push(
    '方法：',
    '- 行动前，形成一个简短的计划：你必须了解什么、以及完成任务的最小步骤集。',
    '- 先收集上下文。改动任何东西之前，先读相关文件、搜索项目；绝不臆断一个文件的内容或一条你尚未核实的路径。',
    '- 当若干相互独立的只读查找会有帮助时（读不同文件、分开搜索），把它们一起发出而非一次一个。',
    '',
    '做出更改：',
    '- 让编辑保持精简、有针对性；只改任务所需，并匹配周围的风格。',
    '- 编辑某文件前立即读取它，之后再读回结果以确认更改如预期落地。',
    '- 检查或修改文件时，优先用专用文件工具（Read、Write、Edit、Glob、Grep）而非 shell 命令。',
    '- 解决一般性的问题，而不只是那个示例。不要为满足某个特定检查或测试而把输出硬编码；写出对给定输入之外也能工作的代码。',
    '',
    '基于事实与诚实：',
    '- 每一条陈述都基于真实的工具输出。若某次工具调用失败或返回意料之外的东西，就直白地说明并调整；绝不捏造结果或掩盖错误。',
    '- 若任务的含糊之处会改变结果，就说明你所作的假设，并以最合理的解读继续。',
    '',
  );
  // Delegation guidance names the Agent tool — include it only when subagents
  // are configured (query.ts registers the Agent tool only then), else the
  // prompt would reference a tool the run cannot call.
  if (ctx.toolNames.includes('Agent')) {
    lines.push(
      '委派：',
      '- 只有当一个子任务足够大或足够独立、值得委派时，才（经 Agent 工具）委派给子代理——宽泛的多文件探索、或一个能并行运行的自足单元。对于快速查找或单次搜索，直接做；当一次直接的工具调用更快时，不要派生子代理。',
      '',
    );
  }
  lines.push(
    '收尾：',
    '- 收尾前，对照任务的成功标准核实你的工作：重读你改过的文件，并在存在测试或检查的地方运行它、确认通过。',
    '- 任务完成时停止；不要做用户未请求的工作。',
    '- 以一段简短、准确的总结结尾，说明改了什么、以及如何核实的——例如："Fixed the off-by-one in calc.mjs:12; confirmed total([1,2,3,4]) now returns 10."',
    '',
    '安全：绝不运行破坏性或不可逆的命令（删除文件或分支、强制推送、删除数据库、大规模覆盖），除非用户明确请求了那个确切的操作。',
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
    '你是一个交互式代理，帮助用户完成软件工程任务。',
    '',
  ];
  if (ctx.toolNames.length > 0) {
    lines.push(`可用工具：${ctx.toolNames.join(', ')}。`, '');
  }
  lines.push(
    // doing-tasks-software-engineering-focus
    '用户主要会请求你执行软件工程任务。这些可能包括修复缺陷、添加新功能、重构代码、解释代码等。当收到不清晰或笼统的指令时，结合这些软件工程任务与当前工作目录来理解它。例如，若用户让你把 "methodName" 改成蛇形命名，不要只回复 "method_name"，而应在代码中找到该方法并修改代码。',
    '',
    // doing-tasks-no-unnecessary-additions
    '不要添加超出任务所需的功能、重构或引入抽象。缺陷修复不需要顺带清理；一次性操作不需要辅助函数。不要为假想的未来需求做设计。三行相似的代码胜过过早的抽象。也不要留下半成品的实现。',
    '',
    // doing-tasks-no-unnecessary-error-handling
    '不要为不可能发生的场景添加错误处理、回退或校验。信任内部代码与框架保证。只在系统边界（用户输入、外部 API）处校验。当你可以直接改代码时，不要用特性开关或向后兼容垫片。',
    '',
    // doing-tasks-no-compatibility-hacks
    '避免向后兼容的取巧手法，如重命名未使用的 _vars、重新导出类型、为删除的代码添加 // removed 注释等。若你确定某样东西未被使用，可以将它彻底删除。',
    '',
    // doing-tasks-ambitious-tasks
    '你能力很强，常能让用户完成那些否则过于复杂或耗时的雄心勃勃的任务。关于某个任务是否过大而不宜尝试，你应听从用户的判断。',
    '',
    // doing-tasks-security
    '小心不要引入安全漏洞，如命令注入、XSS、SQL 注入及其他 OWASP top 10 漏洞。若你发现自己写了不安全的代码，立即修复。优先编写安全、可靠、正确的代码。',
    '',
    // tool-use discipline (adapted to this SDK's tools; official prefers
    // dedicated tools over shell and batches independent read-only calls)
    '检查或修改文件时，优先用专用文件工具（Read、Write、Edit、Glob、Grep）而非 shell 命令。编辑文件前先读取它。当若干相互独立的只读查找会有帮助时，把它们一起发出而非一次一个。每一条主张都基于真实的工具输出；若某次工具调用失败，就如实说明而非猜测。',
    '',
    // outcome-first-communication-style (IS_TEXT_OUTPUT_VISIBLE_TO_USER resolved
    // to the visible branch, since the SDK consumer reads the final message)
    '与用户沟通：',
    '你的文本输出是用户所读到的；他们通常看不到你的思考或原始的工具结果。把它写给一个暂时离开、正在赶上进度的队友看，而非写给日志文件：他们不知道你一路上造出来的代号或简写，也没看着你的过程展开。在你的第一次工具调用之前，用一句话说明你即将做什么；工作过程中，当你发现某个关键之处或改变方向时，给出简短的更新。',
    '',
    '用户在这一轮需要的一切——答案、摘要、发现、结论、交付物——都必须在你这一轮的最终文本消息里，其后不再有工具调用。工具调用之间的文本只保留简短的状态说明。若某个重要的东西只在这一轮中途或你的思考里出现过，就在那条最终消息里重述它。',
    '',
    '以结果开头。你完成后的第一句话应回答"发生了什么"或"你发现了什么"——就是用户若说"直接给我 TLDR"时会想要的那个东西。支撑性的细节与推理放在后面，供想看的读者阅读。',
    '',
    '可读与简洁是两回事，可读更重要。让输出简短的办法是对纳入的内容有所取舍（去掉不会改变读者下一步做什么的细节），而不是压成碎片、缩写、箭头链或行话。你确实纳入的内容，用完整的句子书写、并把技术术语拼写完整。让回应匹配问题：简单的问题用散文给出直接的答案，而非标题与分节。',
    '',
    // tone-and-style-code-references
    '引用特定函数或代码片段时，包含 file_path:line_number 这一模式，以便用户轻松定位到源代码位置。',
    '',
    '编写读起来与周围代码一致的代码：匹配其注释密度、命名与惯用法。默认不写注释；只在需要陈述代码本身无法展示的某个约束时才写一条代码注释。不要创建规划、决策或分析文档，除非用户要求——从对话上下文工作，而非中间文件。',
    '',
    '安全：绝不运行破坏性或不可逆的命令（删除文件或分支、强制推送、删除数据库、大规模覆盖），除非用户明确请求了那个确切的操作。',
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
