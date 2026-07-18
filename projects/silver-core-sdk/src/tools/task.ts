/**
 * Built-in Task tools (TaskCreate / TaskGet / TaskUpdate / TaskList): the
 * official task-tracking surface that supersedes TodoWrite (as of the official
 * TypeScript Agent SDK 0.3.142, TodoWrite is disabled by default and these
 * four tools replace it; `CLAUDE_CODE_ENABLE_TASKS=0` reverts — see
 * createBuiltinTools in ./index.ts for the gate).
 *
 * Storage: a per-session in-memory task store. The store is keyed on the
 * session's shared `readFilePaths` Set when present — the ONE object the
 * runtime documents as "the SAME reference threaded into child contexts"
 * (src/internal/contracts.ts), so parent and subagent loops in a query see one
 * shared task list (the official teammate/owner workflow needs a shared
 * list). Bare tool use outside query() (no readFilePaths) falls back to
 * keying on the ToolContext itself. Nothing is persisted; the list dies with
 * the query, like the official session task list.
 *
 * Task ids are assigned sequentially per store ("1", "2", ...) — matching the
 * official guidance "prefer working on tasks in ID order (lowest ID first)".
 * Dependency edges are kept symmetric: A.blocks contains B iff B.blockedBy
 * contains A. Setting status "deleted" removes the task and scrubs its id
 * from every other task's edge lists.
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError } from '../errors.js';
import {
  TASKCREATE_DESCRIPTION,
  TASKGET_DESCRIPTION,
  TASKLIST_DESCRIPTION,
  TASKUPDATE_DESCRIPTION,
} from './descriptions.js';

type TaskStatus = 'pending' | 'in_progress' | 'completed';
const STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'completed'];
const UPDATE_STATUSES = [...STATUSES, 'deleted'] as const;

export type TaskRecord = {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: TaskStatus;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
};

type TaskStore = {
  nextId: number;
  tasks: Map<string, TaskRecord>;
};

/**
 * Store registry. WeakMap so a finished query's task list is collectable.
 * Key selection: see the module header (shared readFilePaths Set -> shared
 * per-session store across parent + subagent contexts).
 */
const STORES = new WeakMap<object, TaskStore>();

function storeKey(ctx: ToolContext): object {
  return ctx.sessionKey ?? ctx.readFilePaths ?? ctx;
}

function storeFor(ctx: ToolContext): TaskStore {
  const key = storeKey(ctx);
  let store = STORES.get(key);
  if (store === undefined) {
    store = { nextId: 1, tasks: new Map() };
    STORES.set(key, store);
  }
  return store;
}

/** Test/inspection hook: the current task records for a context (no create). */
export function peekTasks(ctx: ToolContext): TaskRecord[] {
  const store = STORES.get(storeKey(ctx));
  return store === undefined ? [] : [...store.tasks.values()];
}

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const raw = input[field];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: `"${field}" must be a non-empty string.` };
  }
  return { ok: true, value: raw };
}

function optionalMetadata(
  input: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string } {
  const raw = input['metadata'];
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '"metadata" must be an object.' };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

function optionalIdArray(
  input: Record<string, unknown>,
  field: string,
): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  const raw = input[field];
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || v.length === 0)) {
    return { ok: false, error: `"${field}" must be an array of task ID strings.` };
  }
  return { ok: true, value: raw as string[] };
}

function addUnique(list: string[], id: string): void {
  if (!list.includes(id)) list.push(id);
}

function scrub(list: string[], id: string): string[] {
  return list.filter((v) => v !== id);
}

/** Format an id list for display. */
function idList(ids: string[]): string {
  return ids.length > 0 ? ids.join(', ') : '(none)';
}

// ---------------------------------------------------------------------------
// TaskCreate
// ---------------------------------------------------------------------------

export const taskCreateTool: BuiltinTool = {
  name: 'TaskCreate',
  description: TASKCREATE_DESCRIPTION,
  readOnly: true, // session task list only; never touches files (TodoWrite precedent, keeps plan-mode task tracking allowed)
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description:
          'A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow").',
      },
      description: {
        type: 'string',
        description: 'What needs to be done.',
      },
      activeForm: {
        type: 'string',
        description:
          'Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.',
      },
      metadata: {
        type: 'object',
        description: 'Arbitrary key/value metadata to attach to the task.',
      },
    },
    required: ['subject', 'description'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const subject = input['subject'];
    if (typeof subject !== 'string' || subject.length === 0) {
      return errorResult('TaskCreate failed: "subject" must be a non-empty string.');
    }
    const description = input['description'];
    if (typeof description !== 'string' || description.length === 0) {
      return errorResult('TaskCreate failed: "description" must be a non-empty string.');
    }
    const activeForm = optionalString(input, 'activeForm');
    if (!activeForm.ok) return errorResult(`TaskCreate failed: ${activeForm.error}`);
    const metadata = optionalMetadata(input);
    if (!metadata.ok) return errorResult(`TaskCreate failed: ${metadata.error}`);

    const store = storeFor(ctx);
    const id = String(store.nextId);
    store.nextId += 1;
    const task: TaskRecord = {
      id,
      subject,
      description,
      status: 'pending', // all tasks are created with status pending
      blocks: [],
      blockedBy: [],
      metadata: metadata.value ?? {},
    };
    if (activeForm.value !== undefined) task.activeForm = activeForm.value;
    store.tasks.set(id, task);
    ctx.debug(`TaskCreate: task ${id} ("${subject}") created`);
    return { content: `Created task ${id}: ${subject}` };
  },
};

// ---------------------------------------------------------------------------
// TaskGet
// ---------------------------------------------------------------------------

export const taskGetTool: BuiltinTool = {
  name: 'TaskGet',
  description: TASKGET_DESCRIPTION,
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The ID of the task to retrieve.' },
    },
    required: ['taskId'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const taskId = input['taskId'];
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return errorResult('TaskGet failed: "taskId" must be a non-empty string.');
    }
    const task = storeFor(ctx).tasks.get(taskId);
    // Official semantics: an unknown ID returns a null task, not an error.
    if (task === undefined) {
      return { content: `No task found with ID ${taskId}.` };
    }
    const lines = [
      `Task ${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
      `Blocks: ${idList(task.blocks)}`,
      `Blocked by: ${idList(task.blockedBy)}`,
    ];
    if (task.owner !== undefined) lines.push(`Owner: ${task.owner}`);
    // Metadata round-trip (audit r4 Z5-3): TaskCreate/TaskUpdate accept
    // metadata but no reader ever surfaced it — write-only storage. Rendered
    // here (TaskGet is the detail view; TaskList stays a compact summary).
    if (Object.keys(task.metadata).length > 0) {
      lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
    }
    return { content: lines.join('\n') };
  },
};

// ---------------------------------------------------------------------------
// TaskUpdate
// ---------------------------------------------------------------------------

export const taskUpdateTool: BuiltinTool = {
  name: 'TaskUpdate',
  description: TASKUPDATE_DESCRIPTION,
  readOnly: true, // session task list only; never touches files (see TaskCreate)
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The ID of the task to update.' },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'deleted'],
        description:
          'New task status. Set to "deleted" to permanently remove the task.',
      },
      subject: { type: 'string', description: 'New task title (imperative form).' },
      description: { type: 'string', description: 'New task description.' },
      activeForm: {
        type: 'string',
        description:
          'Present continuous form shown in the spinner when in_progress (e.g., "Running tests").',
      },
      owner: { type: 'string', description: 'The task owner (agent name).' },
      metadata: {
        type: 'object',
        description:
          'Metadata keys to merge into the task (set a key to null to delete it).',
      },
      addBlocks: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of tasks that cannot start until this one completes.',
      },
      addBlockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of tasks that must complete before this one can start.',
      },
    },
    required: ['taskId'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const taskId = input['taskId'];
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return errorResult('TaskUpdate failed: "taskId" must be a non-empty string.');
    }
    const store = storeFor(ctx);
    const task = store.tasks.get(taskId);
    if (task === undefined) {
      return errorResult(`TaskUpdate failed: task ${taskId} not found.`);
    }

    // ---- validate the whole patch before mutating anything -----------------
    const status = input['status'];
    if (
      status !== undefined &&
      (typeof status !== 'string' ||
        !(UPDATE_STATUSES as readonly string[]).includes(status))
    ) {
      return errorResult(
        'TaskUpdate failed: "status" must be one of pending, in_progress, completed, deleted.',
      );
    }
    const subject = optionalString(input, 'subject');
    if (!subject.ok) return errorResult(`TaskUpdate failed: ${subject.error}`);
    const description = optionalString(input, 'description');
    if (!description.ok) return errorResult(`TaskUpdate failed: ${description.error}`);
    const activeForm = optionalString(input, 'activeForm');
    if (!activeForm.ok) return errorResult(`TaskUpdate failed: ${activeForm.error}`);
    const owner = optionalString(input, 'owner');
    if (!owner.ok) return errorResult(`TaskUpdate failed: ${owner.error}`);
    const metadata = optionalMetadata(input);
    if (!metadata.ok) return errorResult(`TaskUpdate failed: ${metadata.error}`);
    const addBlocks = optionalIdArray(input, 'addBlocks');
    if (!addBlocks.ok) return errorResult(`TaskUpdate failed: ${addBlocks.error}`);
    const addBlockedBy = optionalIdArray(input, 'addBlockedBy');
    if (!addBlockedBy.ok) return errorResult(`TaskUpdate failed: ${addBlockedBy.error}`);
    for (const [field, ids] of [
      ['addBlocks', addBlocks.value],
      ['addBlockedBy', addBlockedBy.value],
    ] as const) {
      for (const id of ids ?? []) {
        if (id === taskId) {
          return errorResult(`TaskUpdate failed: "${field}" cannot reference the task itself.`);
        }
        if (!store.tasks.has(id)) {
          return errorResult(`TaskUpdate failed: "${field}" references unknown task ${id}.`);
        }
      }
    }

    // ---- deletion: remove the task and scrub its edges ---------------------
    if (status === 'deleted') {
      store.tasks.delete(taskId);
      for (const other of store.tasks.values()) {
        other.blocks = scrub(other.blocks, taskId);
        other.blockedBy = scrub(other.blockedBy, taskId);
      }
      ctx.debug(`TaskUpdate: task ${taskId} deleted`);
      return { content: `Deleted task ${taskId}: ${task.subject}` };
    }

    // ---- apply the patch ----------------------------------------------------
    const updatedFields: string[] = [];
    let statusChange: { from: string; to: string } | undefined;
    if (status !== undefined && status !== task.status) {
      statusChange = { from: task.status, to: status };
      task.status = status as TaskStatus;
      updatedFields.push('status');
    }
    if (subject.value !== undefined && subject.value !== task.subject) {
      task.subject = subject.value;
      updatedFields.push('subject');
    }
    if (description.value !== undefined && description.value !== task.description) {
      task.description = description.value;
      updatedFields.push('description');
    }
    if (activeForm.value !== undefined && activeForm.value !== task.activeForm) {
      task.activeForm = activeForm.value;
      updatedFields.push('activeForm');
    }
    if (owner.value !== undefined && owner.value !== task.owner) {
      task.owner = owner.value;
      updatedFields.push('owner');
    }
    if (metadata.value !== undefined) {
      for (const [key, value] of Object.entries(metadata.value)) {
        if (value === null) delete task.metadata[key];
        else task.metadata[key] = value;
      }
      updatedFields.push('metadata');
    }
    if (addBlocks.value !== undefined && addBlocks.value.length > 0) {
      for (const id of addBlocks.value) {
        addUnique(task.blocks, id);
        addUnique(store.tasks.get(id)!.blockedBy, taskId);
      }
      updatedFields.push('blocks');
    }
    if (addBlockedBy.value !== undefined && addBlockedBy.value.length > 0) {
      for (const id of addBlockedBy.value) {
        addUnique(task.blockedBy, id);
        addUnique(store.tasks.get(id)!.blocks, taskId);
      }
      updatedFields.push('blockedBy');
    }

    if (updatedFields.length === 0) {
      return { content: `Task ${taskId} unchanged (no fields to update).` };
    }
    ctx.debug(`TaskUpdate: task ${taskId} updated (${updatedFields.join(', ')})`);
    const note =
      statusChange !== undefined
        ? `; status ${statusChange.from} -> ${statusChange.to}`
        : '';
    return {
      content: `Updated task ${taskId} (${updatedFields.join(', ')})${note}`,
    };
  },
};

// ---------------------------------------------------------------------------
// TaskList
// ---------------------------------------------------------------------------

export const taskListTool: BuiltinTool = {
  name: 'TaskList',
  description: TASKLIST_DESCRIPTION,
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(
    _input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const store = storeFor(ctx);
    if (store.tasks.size === 0) {
      return { content: 'No tasks in the task list.' };
    }
    const lines: string[] = [];
    for (const task of store.tasks.values()) {
      // blockedBy is reported as OPEN blockers only (official TaskList output:
      // "list of open task IDs that must be resolved first").
      const openBlockedBy = task.blockedBy.filter(
        (id) => store.tasks.get(id) !== undefined && store.tasks.get(id)!.status !== 'completed',
      );
      let line = `${task.id}. [${task.status}] ${task.subject}`;
      if (task.owner !== undefined) line += ` (owner: ${task.owner})`;
      if (openBlockedBy.length > 0) line += ` (blocked by: ${openBlockedBy.join(', ')})`;
      lines.push(line);
    }
    return { content: lines.join('\n') };
  },
};

/** The four Task tools, registration order. */
export const taskTools: BuiltinTool[] = [
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
];
