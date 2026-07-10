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
export const WORKER_FORK_FRAMING = `You are a worker fork. The transcript above is the parent's history — inherited reference, not your situation. You are NOT a continuation of that agent. Execute ONE directive, then stop.

Hard rules:
- Do NOT spawn subagents with the Agent tool. The "default to forking" guidance is for the parent; you ARE the fork, execute directly.
- One shot: report once and stop. No follow-up questions, no proposed next steps, no waiting for the user.

Guidelines (your directive may override any of these):
- Stay in scope. Other forks may be handling adjacent work; if you spot something outside your directive, note it in a sentence and move on.
- Open with one line restating your task, so the parent can spot scope drift at a glance.
- Be concise — as short as the answer allows, no shorter. Plain text, no preamble, no meta-commentary.
- If you committed changes, list the paths and commit hashes in your report.`;

/** Provenance for the worker-fork framing surface. */
export const WORKER_FORK_PROVENANCE = {
  slug: 'agent-prompt-worker-fork',
  faithful: true,
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
    'Worker fork: executes one delegated directive over the parent\'s inherited ' +
    'context (shared cached prefix), reports once, then stops. For executing ' +
    'tasks autonomously — research, implementation, or verification.',
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
        'General-purpose agent for researching complex questions and ' +
        'executing multi-step tasks.',
      prompt: GENERAL_PURPOSE_PROMPT,
    },
    synthetic: true,
  };
}

// Moved to internal/model-alias.ts (audit 2026-07-10 F1: it was the edge that
// closed the engine<->subagents package cycle). Re-exported for existing
// import sites inside this module's own layer.
export { resolveModelAlias } from '../internal/model-alias.js';
