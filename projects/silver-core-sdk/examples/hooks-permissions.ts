/**
 * Hooks and permissions: a PreToolUse hook that blocks destructive Bash
 * commands, an allow rule with a specifier prefix, and a canUseTool
 * callback that logs every permission decision it is asked to make.
 *
 * Run:  ANTHROPIC_API_KEY=... npx tsx examples/hooks-permissions.ts
 */

import { query } from '../src/index.js';

const q = query({
  prompt:
    'Run the date command to show the current date, then explain what it printed.',
  options: {
    maxTurns: 6,
    // Rule form: Bash calls whose command starts with "date" are pre-approved.
    allowedTools: ['Bash(date:*)'],
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            async (input) => {
              if (input.hook_event_name !== 'PreToolUse') return {};
              const toolInput = input.tool_input as { command?: unknown } | undefined;
              const command = String(toolInput?.command ?? '');
              if (/rm\s+-rf|git\s+push\s+--force/.test(command)) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason:
                      'Destructive command blocked by PreToolUse hook',
                  },
                };
              }
              return {};
            },
          ],
        },
      ],
    },
    // Fallback prompt: called only when no rule or hook already decided.
    canUseTool: async (toolName, input) => {
      process.stdout.write(`[canUseTool] ${toolName} requested\n`);
      return { behavior: 'allow', updatedInput: input };
    },
  },
});

for await (const message of q) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') process.stdout.write(`${block.text}\n`);
    }
  } else if (message.type === 'result') {
    process.stdout.write(
      `[result] subtype=${message.subtype} denials=${
        message.permission_denials.length
      }\n`,
    );
  }
}
