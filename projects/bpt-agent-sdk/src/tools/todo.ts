/**
 * Built-in TodoWrite tool: maintain a structured task checklist.
 *
 * Stateless by design - the model resends the complete list on every call, so
 * the tool simply validates the payload and renders a markdown checklist plus a
 * one-line count summary back as the tool_result. A dedicated SDK message
 * variant is deferred (see docs/COMPAT.md).
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError } from '../errors.js';

type TodoStatus = 'pending' | 'in_progress' | 'completed';
const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed'];

type TodoItem = {
  content: string;
  status: TodoStatus;
  activeForm: string;
};

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

export const todoWriteTool: BuiltinTool = {
  name: 'TodoWrite',
  description:
    'Create and update a structured task list for the current session. Send ' +
    'the COMPLETE list every time (the tool is stateless and replaces the ' +
    'prior list). Each todo has: content (imperative form, e.g. "Run tests"), ' +
    'status (pending | in_progress | completed), and activeForm (present ' +
    'continuous form shown while in progress, e.g. "Running tests"). Keep ' +
    'exactly one task in_progress at a time.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete todo list (replaces any prior list).',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Imperative task description.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current task status.',
            },
            activeForm: {
              type: 'string',
              description: 'Present-continuous label shown while the task is in progress.',
            },
          },
          required: ['content', 'status', 'activeForm'],
        },
      },
    },
    required: ['todos'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const rawTodos = input['todos'];
    if (!Array.isArray(rawTodos)) {
      return errorResult('TodoWrite failed: "todos" must be an array.');
    }

    const todos: TodoItem[] = [];
    for (let i = 0; i < rawTodos.length; i++) {
      const raw = rawTodos[i];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return errorResult(`TodoWrite failed: todos[${i}] must be an object.`);
      }
      const t = raw as Record<string, unknown>;
      const content = t['content'];
      if (typeof content !== 'string' || content.length === 0) {
        return errorResult(
          `TodoWrite failed: todos[${i}].content must be a non-empty string.`,
        );
      }
      const status = t['status'];
      if (typeof status !== 'string' || !STATUSES.includes(status as TodoStatus)) {
        return errorResult(
          `TodoWrite failed: todos[${i}].status must be one of pending, in_progress, completed.`,
        );
      }
      const activeForm = t['activeForm'];
      if (typeof activeForm !== 'string' || activeForm.length === 0) {
        return errorResult(
          `TodoWrite failed: todos[${i}].activeForm must be a non-empty string.`,
        );
      }
      todos.push({ content, status: status as TodoStatus, activeForm });
    }

    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    const lines: string[] = [];
    for (const todo of todos) {
      if (todo.status === 'pending') {
        pending++;
        lines.push(`- [ ] ${todo.content}`);
      } else if (todo.status === 'in_progress') {
        inProgress++;
        lines.push(`- [~] ${todo.activeForm}`);
      } else {
        completed++;
        lines.push(`- [x] ${todo.content}`);
      }
    }

    ctx.debug(
      `TodoWrite: ${todos.length} todos (${pending} pending, ${inProgress} in progress, ${completed} completed)`,
    );

    const summary = `Todos: ${pending} pending, ${inProgress} in progress, ${completed} completed.`;
    const content = lines.length > 0 ? `${summary}\n${lines.join('\n')}` : summary;
    return { content };
  },
};
