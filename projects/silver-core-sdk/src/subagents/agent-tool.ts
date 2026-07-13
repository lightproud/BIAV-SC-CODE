/**
 * The built-in `Agent` (a.k.a. Task) tool.
 *
 * A stateless factory: createAgentTool(agentNames) returns a BuiltinTool whose
 * execute() simply forwards to ctx.spawnSubagent — a closure the subagent
 * runtime installs on the ToolContext. All depth tracking, dependency wiring
 * and recursion live in that closure, so the tool itself never knows its depth
 * or holds any collaborators. When no runtime is wired (ctx.spawnSubagent is
 * undefined) the tool returns a plain isError payload rather than throwing.
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { GENERAL_PURPOSE_TYPE } from './agents.js';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/**
 * Build the Agent tool. `agentNames` are the spawnable subagent_type values
 * (the keys of options.agents plus 'general-purpose'); they are enumerated in
 * the subagent_type field description so the model knows what it may request.
 *
 * E7-02 (official parity): required is [description, prompt] — subagent_type
 * is optional and defaults to 'general-purpose'; `model` overrides the child
 * model per call; `isolation: 'worktree'` runs the child in a temporary git
 * worktree (auto-removed when left unchanged).
 */
export function createAgentTool(agentNames: string[]): BuiltinTool {
  const typeList = agentNames.length > 0 ? agentNames.join(', ') : GENERAL_PURPOSE_TYPE;
  return {
    name: 'Agent',
    description:
      'Delegate a self-contained task to a subagent that runs in its own ' +
      'isolated context and returns only its final message. Use this to fan ' +
      'out research or multi-step work without cluttering the main thread. ' +
      'Provide a complete, standalone prompt: the subagent does not see the ' +
      'current conversation. Set run_in_background to true to launch the ' +
      'subagent without blocking; its result is delivered on a later turn. ' +
      'Set isolation to "worktree" to give the subagent its own temporary ' +
      'git worktree as its working directory (auto-cleaned if unchanged), ' +
      'and model to override which model it runs on. ' +
      'Set fork to true to instead continue from the current context (shared ' +
      'cache, more privileged) rather than a fresh isolated one.',
    readOnly: false,
    isFileEdit: false,
    // Foreground Agent calls batched in one assistant turn must run
    // concurrently (official parity: "send them in a single message with
    // multiple tool uses so they run concurrently"). Each child runs in its
    // own isolated loop/session, so batch-mates share no mutable state here.
    parallelSafe: true,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short (3-5 word) label for the delegated task.',
        },
        prompt: {
          type: 'string',
          description:
            'The self-contained instruction for the subagent. It becomes the ' +
            'subagent\'s first (and only) user turn, so it must include every ' +
            'detail needed to complete the task without the parent context.',
        },
        subagent_type: {
          type: 'string',
          description:
            `The type of subagent to spawn. One of: ${typeList}. ` +
            `Defaults to ${GENERAL_PURPOSE_TYPE} when omitted.`,
        },
        model: {
          type: 'string',
          enum: ['sonnet', 'opus', 'haiku', 'fable'],
          description:
            'Optional model override for this subagent. Takes precedence ' +
            'over the agent definition\'s model. Ignored when forking — a ' +
            'fork always inherits the parent model.',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'When true, launch the subagent as a non-blocking background task ' +
            'and return immediately; its result arrives on a subsequent turn.',
        },
        isolation: {
          type: 'string',
          enum: ['worktree'],
          description:
            '"worktree" creates a temporary git worktree of the current ' +
            'repository and uses it as the subagent\'s working directory; ' +
            'the worktree is removed automatically when the subagent leaves ' +
            'it unchanged (uncommitted changes keep it alive).',
        },
        fork: {
          type: 'boolean',
          description:
            'When true, continue from the parent\'s context (shared cache) ' +
            'instead of a fresh isolated context; the subagent inherits the ' +
            'parent model, system prompt and tool set and is as privileged as ' +
            'the parent. Default false.',
        },
      },
      required: ['description', 'prompt'],
    },
    async execute(
      input: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolResultPayload> {
      const spawn = ctx.spawnSubagent;
      if (spawn === undefined) {
        return errorResult(
          'Agent failed: subagent runtime not available in this context.',
        );
      }

      const prompt = input['prompt'];
      if (typeof prompt !== 'string' || prompt.length === 0) {
        return errorResult('Agent failed: "prompt" must be a non-empty string.');
      }
      // Optional (E7-02, official required set is [description, prompt]):
      // omitted -> the default general-purpose agent type.
      const subagentTypeRaw = input['subagent_type'];
      if (
        subagentTypeRaw !== undefined &&
        (typeof subagentTypeRaw !== 'string' || subagentTypeRaw.length === 0)
      ) {
        return errorResult(
          'Agent failed: "subagent_type" must be a non-empty string when provided.',
        );
      }
      const subagentType =
        (subagentTypeRaw as string | undefined) ?? GENERAL_PURPOSE_TYPE;
      const modelRaw = input['model'];
      if (
        modelRaw !== undefined &&
        (typeof modelRaw !== 'string' || modelRaw.length === 0)
      ) {
        return errorResult(
          'Agent failed: "model" must be a non-empty string when provided.',
        );
      }
      const isolationRaw = input['isolation'];
      if (isolationRaw !== undefined && isolationRaw !== 'worktree') {
        return errorResult(
          'Agent failed: "isolation" must be "worktree" when provided.',
        );
      }
      const descRaw = input['description'];
      const description = typeof descRaw === 'string' ? descRaw : undefined;
      const runInBackground = input['run_in_background'] === true;
      const fork = input['fork'] === true;

      // EAGERLY snapshot the parent context here (a value copy, not a lazy
      // thunk) so a background fork captures the parent as it was at spawn.
      // Always snapshot when a getter is wired: the tool cannot see
      // AgentDefinition.fork (the runtime resolves that), so the runtime needs
      // the snapshot available whenever EITHER the input flag OR agentDef.fork
      // may request a fork. The snapshot is a cheap shallow copy; the runtime
      // decides whether to actually seed the child with it.
      const parentHistory = ctx.getForkHistory?.();

      const result = await spawn({
        subagentType,
        prompt,
        description,
        runInBackground,
        model: modelRaw as string | undefined,
        isolation: isolationRaw as 'worktree' | undefined,
        fork,
        parentHistory,
        // The loop does not expose the spawning tool_use block id to the tool;
        // the runtime mints a stable correlation id (the child agentId) when
        // this is empty. See the runtime's parentToolUseId handling.
        toolUseId: '',
        signal: ctx.signal,
      });
      return { content: result.content, isError: result.isError };
    },
  };
}
