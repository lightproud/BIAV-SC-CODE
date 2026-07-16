/**
 * SendMessage built-in tool (O-B2).
 *
 * Continues a previously spawned subagent's conversation with its context
 * intact — the "continue an existing worker" half of the official
 * coordinator/teams surface (archive slug tool-description-sendmessagetool,
 * ccVersion 2.1.199). This SDK's scoped v1 addresses agents by agentId only:
 * teammate NAMES and the "main" address belong to the agent-teams naming
 * machinery this SDK does not ship (COMPAT: PARTIAL), and describing them
 * here would describe a non-existent capability (red-line discipline).
 *
 * Root-loop-only: the runtime bridge (`ctx.subagents`) is wired on the root
 * ToolContext exclusively. An isolated child never sees this tool (its schema
 * is withheld at child-builtin build time); a FORK child retains the schema
 * (prefix byte-match with the parent) and gets an honest error here.
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { SENDMESSAGE_DESCRIPTION } from './descriptions.js';

export const sendMessageTool: BuiltinTool = {
  name: 'SendMessage',
  description: SENDMESSAGE_DESCRIPTION,
  // Same trust shape as Agent: the continued child executes tools behind its
  // OWN permission gate, but the call itself spends model budget and can
  // mutate state through the child — never auto-approved as read-only.
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description:
          'The agentId of the subagent to continue (from its Agent spawn result).',
      },
      summary: {
        type: 'string',
        description:
          'Short (5-10 word) recap of the message, for progress display.',
      },
      message: {
        type: 'string',
        description: 'The message to deliver to the agent.',
      },
    },
    required: ['to', 'message'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const to = input['to'];
    if (typeof to !== 'string' || to.length === 0) {
      return {
        content:
          'SendMessage: "to" must be a non-empty string (a subagent agentId).',
        isError: true,
      };
    }
    const message = input['message'];
    if (typeof message !== 'string' || message.length === 0) {
      return {
        content: 'SendMessage: "message" must be a non-empty string.',
        isError: true,
      };
    }
    const summary = input['summary'];
    if (summary !== undefined && typeof summary !== 'string') {
      return {
        content: 'SendMessage: "summary" must be a string when provided.',
        isError: true,
      };
    }
    const bridge = ctx.subagents;
    if (bridge === undefined) {
      return {
        content:
          'SendMessage is not available in this context: subagent messaging ' +
          'is root-loop-only in this SDK (a subagent cannot message other agents).',
        isError: true,
      };
    }
    const result = await bridge.send({ to, message, signal: ctx.signal });
    return { content: result.content, isError: result.isError };
  },
};
