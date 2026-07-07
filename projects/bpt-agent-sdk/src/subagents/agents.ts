/**
 * Subagent definition + model resolution helpers (pure, no I/O).
 *
 * These back the Agent (Task) built-in tool and the subagent runtime:
 *  - resolveAgentDefinition() maps a subagent_type name to an AgentDefinition,
 *    falling back to a synthetic 'general-purpose' agent for the reserved name
 *    or any unknown type (with a debug warn).
 *  - resolveModelAlias() maps the short model aliases an AgentDefinition may
 *    use ('opus'/'sonnet'/'haiku'/'fable'/'inherit') onto concrete model ids,
 *    passing a full model id through untouched.
 *  - MAX_SUBAGENT_DEPTH bounds recursive nesting (root loop = depth 0).
 */

import type { AgentDefinition } from '../types.js';

/**
 * Maximum subagent nesting depth. The root agent loop runs at depth 0; a loop
 * at depth < MAX_SUBAGENT_DEPTH may spawn a child (at depth+1); a loop at depth
 * MAX_SUBAGENT_DEPTH cannot spawn further agents. Enforced structurally (the
 * Agent tool is removed from a depth-5 child's tool set) AND by a guard in the
 * spawn function. A FORK child inherits the parent's full tool set but still
 * loses Agent at the max depth, so fork cannot bypass the nesting limit either.
 */
export const MAX_SUBAGENT_DEPTH = 5;

/**
 * Fallback turn cap for a spawned subagent when neither the AgentDefinition nor
 * the parent EngineConfig specifies one. Without a cap a delegated child loop
 * (especially a foreground one that blocks the parent) could iterate tool calls
 * indefinitely, hanging the parent and running with no cost/turn ceiling. A
 * bounded default keeps every subagent terminating.
 */
export const DEFAULT_SUBAGENT_MAX_TURNS = 20;

/** The reserved always-available subagent type. */
export const GENERAL_PURPOSE_TYPE = 'general-purpose';

/**
 * System prompt for the synthetic general-purpose subagent — a faithful OPEN
 * reproduction of the official general-purpose agent prompt (archive slugs
 * agent-prompt-general-purpose + agent-prompt-general-purpose-agent under
 * Public-Info-Pool/Reference/Claude-Code-System-Prompts/), adapted to this SDK:
 * the "agent for Claude Code, Anthropic's official CLI" self-reference is
 * replaced with the parent-agent framing (the child sees only this prompt plus
 * the delegated task, and the parent sees only its final message). The Strengths
 * and Guidelines blocks are reproduced verbatim. A corpus-sync guard
 * (tests/subagents.test.ts) holds the reproduced anchors against the archive.
 * Provenance is declared in GENERAL_PURPOSE_PROMPT_PROVENANCE.
 */
export const GENERAL_PURPOSE_PROMPT = [
  '你是一名代表父代理工作的通用子代理。你被委派了一个单一、自足的任务。用你可用的工具来完成该任务。把任务完整做完——不要镀金，但也不要留半成品。完成任务时，用一条最终消息回复：一份简明的报告，涵盖做了什么以及任何关键发现——父代理只看到这条最终消息，而非你的中间步骤，所以要包含它将需要的每一个结果、路径与细节。不要向父代理提追问；做出合理的假设并说明它们。',
  '',
  '你的强项：',
  '- 在大型代码库中搜索代码、配置与模式',
  '- 分析多个文件以理解系统架构',
  '- 调查需要探索许多文件的复杂问题',
  '- 执行多步骤的调研任务',
  '',
  '准则：',
  '- 文件搜索：当你不知道某样东西在哪里时，广泛地搜索。当你知道具体文件路径时，用 Read。',
  '- 分析：从宽处入手、逐步收窄。若第一种搜索没有结果，就用多种搜索策略。',
  '- 力求周密：检查多个位置、考虑不同的命名约定、查找相关文件。',
  '- 绝不创建文件，除非它们对达成你的目标绝对必要。始终优先编辑已有文件，而非创建新文件。',
  '- 绝不主动创建文档文件（*.md）或 README 文件。仅在被明确要求时才创建文档文件。',
].join('\n');

/** Provenance for the generator/sub-agent surface (Track B): archive source this prompt reproduces. */
export const GENERAL_PURPOSE_PROMPT_PROVENANCE = {
  slugs: ['agent-prompt-general-purpose'],
  faithful: false, // i18n-zh Phase 2 batch B: translated to Chinese
} as const;

// ---------------------------------------------------------------------------
// Worker-fork preset (O-B0) — rides the ALREADY-SHIPPED fork branch (G4)
// ---------------------------------------------------------------------------

/**
 * Worker-fork task framing — a faithful OPEN reproduction of the official
 * worker-fork prompt body (archive slug agent-prompt-worker-fork), adapted for
 * this SDK: the `${SYSTEM_TAG_NAME}` wrapper resolves to `system` (applied by
 * buildWorkerForkPrompt) and `${AGENT_TOOL_NAME}` to `Agent`. In fork mode the
 * child inherits the parent's REAL system prompt (AgentDefinition.prompt is
 * intentionally ignored to preserve the cached prefix), so — exactly like the
 * official — this framing rides IN the delegated task turn, not as a separate
 * system prompt. Corpus-sync guard: tests/subagents.test.ts.
 */
export const WORKER_FORK_FRAMING = `你是一个工作分叉（worker fork）。上面的记录是父代理的历史——继承来的参照，而非你的处境。你不是那个代理的延续。执行一条指令，然后停止。

硬性规则：
- 不要用 Agent 工具派生子代理。"默认分叉"的指引是给父代理的；你就是那个分叉，直接执行。
- 一次性：报告一次然后停止。不提追问、不提议后续步骤、不等待用户。

准则（你的指令可覆盖其中任何一条）：
- 守住范围。其他分叉可能在处理相邻的工作；若你发现你指令之外的东西，用一句话记下它然后继续。
- 开头用一行重述你的任务，好让父代理一眼就能发现范围漂移。
- 简明——短到答案允许的程度，不再更短。纯文本，无开场白、无元评论。
- 若你提交了更改，在报告中列出路径与提交哈希。`;

/** Provenance for the worker-fork framing surface. */
export const WORKER_FORK_PROVENANCE = {
  slug: 'agent-prompt-worker-fork',
  faithful: false, // i18n-zh Phase 2 batch B: translated to Chinese
} as const;

/**
 * Assemble the delegated task prompt for a worker fork: the tagged framing
 * block, then the directive, then optional additional context — mirroring the
 * official `<system>…</system>\n\n${WORKER_DIRECTIVE}${ADDITIONAL_CONTEXT}`
 * assembly. Pass the result as the Agent tool's `prompt` for a fork-mode type.
 */
export function buildWorkerForkPrompt(directive: string, additionalContext = ''): string {
  return `<system>\n${WORKER_FORK_FRAMING}\n</system>\n\n${directive}${additionalContext}`;
}

/**
 * Ready-made worker-fork AgentDefinition preset. Register it under a type name
 * (e.g. `agents: { worker: WORKER_FORK_AGENT }`) and invoke the Agent tool with
 * `prompt: buildWorkerForkPrompt(directive)` — the shipped fork machinery (G4)
 * seeds the child with the parent's history + cached prefix, and this preset's
 * metadata mirrors the official worker profile (maxTurns 200; prompt/tools are
 * intentionally inherited from the parent in fork mode). The `prompt` field
 * satisfies resolveAgentDefinition's non-empty requirement but is IGNORED at
 * fork spawn time by design.
 *
 * NOTE: the coordinator/teams presets are deliberately NOT shipped here — they
 * presuppose a SendMessage/teams tool body this SDK does not ship yet (O-B2);
 * reproducing their prompts now would describe a non-existent capability.
 */
export const WORKER_FORK_AGENT: AgentDefinition = {
  description:
    '工作分叉：在父代理继承来的上下文（共享的缓存前缀）之上执行一条被委派的指令，' +
    '报告一次，然后停止。用于自主执行任务——调研、实现或核验。',
  prompt: WORKER_FORK_FRAMING, // ignored in fork mode (parent system inherited)
  fork: true,
  maxTurns: 200,
};

/** A resolved subagent: the type name plus the definition to run it with. */
export type ResolvedAgent = {
  /** The subagent type name (may be the general-purpose fallback). */
  type: string;
  definition: AgentDefinition;
  /** True when this is the synthetic general-purpose fallback. */
  synthetic: boolean;
};

/**
 * Resolve a subagent_type to a runnable definition.
 *  - A type present in `agents` returns that definition (unless its prompt is
 *    missing/empty, which is an error).
 *  - The reserved 'general-purpose' type returns the synthetic default.
 *  - Any other (unknown) type falls back to general-purpose with a debug warn.
 */
export function resolveAgentDefinition(
  type: string,
  agents: Record<string, AgentDefinition>,
  debug: (msg: string) => void,
): ResolvedAgent | { error: string } {
  const named = agents[type];
  if (named !== undefined) {
    if (typeof named.prompt !== 'string' || named.prompt.length === 0) {
      return {
        error: `subagent type "${type}" has no usable prompt`,
      };
    }
    return { type, definition: named, synthetic: false };
  }

  if (type !== GENERAL_PURPOSE_TYPE) {
    debug(
      `subagent: unknown subagent_type "${type}"; falling back to ` +
        `"${GENERAL_PURPOSE_TYPE}"`,
    );
  }
  return {
    type: GENERAL_PURPOSE_TYPE,
    definition: {
      description:
        '通用代理，用于调研复杂问题与执行多步骤任务。',
      prompt: GENERAL_PURPOSE_PROMPT,
    },
    synthetic: true,
  };
}

/** Short model aliases an AgentDefinition may use -> concrete model ids. */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5',
};

/**
 * Resolve an AgentDefinition.model onto a concrete model id.
 *  - undefined / 'inherit' -> parentModel (subagent inherits the parent model)
 *  - a known short alias -> its concrete id
 *  - anything else -> passed through verbatim (assumed a full model id)
 */
export function resolveModelAlias(
  model: string | undefined,
  parentModel: string,
): string {
  if (model === undefined || model === 'inherit') return parentModel;
  return MODEL_ALIASES[model] ?? model;
}
