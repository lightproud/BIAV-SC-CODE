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

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/**
 * Build the Agent tool. `agentNames` are the spawnable subagent_type values
 * (the keys of options.agents plus 'general-purpose'); they are enumerated in
 * the subagent_type field description so the model knows what it may request.
 */
export function createAgentTool(agentNames: string[]): BuiltinTool {
  const typeList = agentNames.length > 0 ? agentNames.join(', ') : 'general-purpose';
  return {
    name: 'Agent',
    description:
      'Delegate a self-contained task to a subagent that runs in its own ' +
      'isolated context and returns only its final message. Use this to fan ' +
      'out research or multi-step work without cluttering the main thread. ' +
      'Provide a complete, standalone prompt: the subagent does not see the ' +
      'current conversation. Set run_in_background to true to launch the ' +
      'subagent without blocking; its result is delivered on a later turn.',
    readOnly: false,
    isFileEdit: false,
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
          description: `The type of subagent to spawn. One of: ${typeList}.`,
        },
        run_in_background: {
          type: 'boolean',
          description:
            'When true, launch the subagent as a non-blocking background task ' +
            'and return immediately; its result arrives on a subsequent turn.',
        },
      },
      required: ['description', 'prompt', 'subagent_type'],
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
      const subagentType = input['subagent_type'];
      if (typeof subagentType !== 'string' || subagentType.length === 0) {
        return errorResult(
          'Agent failed: "subagent_type" must be a non-empty string.',
        );
      }
      const descRaw = input['description'];
      const description = typeof descRaw === 'string' ? descRaw : undefined;
      const runInBackground = input['run_in_background'] === true;

      const result = await spawn({
        subagentType,
        prompt,
        description,
        runInBackground,
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
