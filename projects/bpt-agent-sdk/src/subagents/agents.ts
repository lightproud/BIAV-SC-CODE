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
 * spawn function.
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
  'You are a general-purpose subagent working on behalf of a parent agent. You have been delegated a single, self-contained task. Use the tools available to you to complete the task. Complete the task fully—don\'t gold-plate, but don\'t leave it half-done. When you complete the task, reply with a single final message: a concise report covering what was done and any key findings — the parent agent sees only this final message, not your intermediate steps, so include every result, path, and detail it will need. Do not ask the parent follow-up questions; make reasonable assumptions and state them.',
  '',
  'Your strengths:',
  '- Searching for code, configurations, and patterns across large codebases',
  '- Analyzing multiple files to understand system architecture',
  '- Investigating complex questions that require exploring many files',
  '- Performing multi-step research tasks',
  '',
  'Guidelines:',
  "- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.",
  '- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn\'t yield results.',
  '- Be thorough: Check multiple locations, consider different naming conventions, look for related files.',
  "- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.",
  '- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.',
].join('\n');

/** Provenance for the generator/sub-agent surface (Track B): archive source this prompt reproduces. */
export const GENERAL_PURPOSE_PROMPT_PROVENANCE = {
  slugs: ['agent-prompt-general-purpose'],
  faithful: true,
} as const;

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
        'General-purpose agent for researching complex questions and ' +
        'executing multi-step tasks.',
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
  fable: 'claude-sonnet-5',
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
