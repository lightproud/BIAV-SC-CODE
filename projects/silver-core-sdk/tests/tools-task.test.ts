/**
 * Task quartet (TaskCreate / TaskGet / TaskUpdate / TaskList) unit tests:
 * CRUD, dependency edges (blocks/blockedBy symmetry), owner + status
 * workflow, list rendering/filtering, per-session store keying, and the
 * TodoWrite deprecation gate (CLAUDE_CODE_ENABLE_TASKS=0) on the registry.
 */

import { describe, expect, it } from 'vitest';

import type { ToolContext, ToolResultPayload } from '../src/internal/contracts.js';
import { AbortError } from '../src/errors.js';
import {
  peekTasks,
  taskCreateTool,
  taskGetTool,
  taskListTool,
  taskUpdateTool,
} from '../src/tools/task.js';
import { createBuiltinTools } from '../src/tools/index.js';
import * as D from '../src/tools/descriptions.js';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

function text(r: ToolResultPayload): string {
  return String(r.content);
}

async function create(
  ctx: ToolContext,
  subject: string,
  extra: Record<string, unknown> = {},
): Promise<ToolResultPayload> {
  return taskCreateTool.execute(
    { subject, description: `${subject} description`, ...extra },
    ctx,
  );
}

describe('TaskCreate', () => {
  it('creates a pending task and returns its assigned sequential ID', async () => {
    const ctx = makeCtx();
    const r1 = await create(ctx, 'Fix bug');
    const r2 = await create(ctx, 'Run tests');
    expect(r1.isError).toBeUndefined();
    expect(text(r1)).toBe('Created task 1: Fix bug');
    expect(text(r2)).toBe('Created task 2: Run tests');
    const tasks = peekTasks(ctx);
    expect(tasks.map((t) => [t.id, t.status])).toEqual([
      ['1', 'pending'],
      ['2', 'pending'],
    ]);
  });

  it('accepts optional activeForm and metadata', async () => {
    const ctx = makeCtx();
    await create(ctx, 'Ship it', { activeForm: 'Shipping it', metadata: { pr: 42 } });
    const [task] = peekTasks(ctx);
    expect(task.activeForm).toBe('Shipping it');
    expect(task.metadata).toEqual({ pr: 42 });
  });

  it('rejects a missing/empty subject or description', async () => {
    const ctx = makeCtx();
    const noSubject = await taskCreateTool.execute({ description: 'd' }, ctx);
    expect(noSubject.isError).toBe(true);
    expect(text(noSubject)).toContain('subject');
    const noDescription = await taskCreateTool.execute({ subject: 's' }, ctx);
    expect(noDescription.isError).toBe(true);
    expect(text(noDescription)).toContain('description');
    expect(peekTasks(ctx)).toEqual([]);
  });

  it('rejects a non-object metadata', async () => {
    const ctx = makeCtx();
    const r = await create(ctx, 'X', { metadata: ['nope'] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('metadata');
  });

  it('throws AbortError on an aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      create(makeCtx({ signal: ac.signal }), 'X'),
    ).rejects.toBeInstanceOf(AbortError);
  });
});

describe('TaskGet', () => {
  it('returns full details for an existing task', async () => {
    const ctx = makeCtx();
    await create(ctx, 'Fix bug');
    const r = await taskGetTool.execute({ taskId: '1' }, ctx);
    expect(r.isError).toBeUndefined();
    const t = text(r);
    expect(t).toContain('Task 1: Fix bug');
    expect(t).toContain('Status: pending');
    expect(t).toContain('Description: Fix bug description');
    expect(t).toContain('Blocks: (none)');
    expect(t).toContain('Blocked by: (none)');
  });

  it('an unknown ID is a null result, not an error (official semantics)', async () => {
    const ctx = makeCtx();
    const r = await taskGetTool.execute({ taskId: '99' }, ctx);
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('No task found with ID 99');
  });

  it('rejects a missing taskId', async () => {
    const r = await taskGetTool.execute({}, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('taskId');
  });
});

describe('TaskUpdate', () => {
  it('walks the official status workflow with statusChange reporting', async () => {
    const ctx = makeCtx();
    await create(ctx, 'Fix bug');
    const started = await taskUpdateTool.execute(
      { taskId: '1', status: 'in_progress' },
      ctx,
    );
    expect(text(started)).toContain('status pending -> in_progress');
    const done = await taskUpdateTool.execute({ taskId: '1', status: 'completed' }, ctx);
    expect(text(done)).toContain('status in_progress -> completed');
    expect(peekTasks(ctx)[0].status).toBe('completed');
  });

  it('patches subject / description / activeForm / owner and reports updatedFields', async () => {
    const ctx = makeCtx();
    await create(ctx, 'Old subject');
    const r = await taskUpdateTool.execute(
      {
        taskId: '1',
        subject: 'New subject',
        description: 'New description',
        activeForm: 'Doing new thing',
        owner: 'agent-a',
      },
      ctx,
    );
    expect(text(r)).toContain('subject, description, activeForm, owner');
    const [task] = peekTasks(ctx);
    expect(task.subject).toBe('New subject');
    expect(task.description).toBe('New description');
    expect(task.activeForm).toBe('Doing new thing');
    expect(task.owner).toBe('agent-a');
  });

  it('merges metadata keys and deletes null-valued keys', async () => {
    const ctx = makeCtx();
    await create(ctx, 'X', { metadata: { keep: 1, drop: 2 } });
    await taskUpdateTool.execute(
      { taskId: '1', metadata: { drop: null, added: 'v' } },
      ctx,
    );
    expect(peekTasks(ctx)[0].metadata).toEqual({ keep: 1, added: 'v' });
  });

  it('addBlocks/addBlockedBy maintain symmetric dependency edges', async () => {
    const ctx = makeCtx();
    await create(ctx, 'A'); // 1
    await create(ctx, 'B'); // 2
    await create(ctx, 'C'); // 3
    await taskUpdateTool.execute({ taskId: '1', addBlocks: ['2'] }, ctx);
    await taskUpdateTool.execute({ taskId: '3', addBlockedBy: ['1'] }, ctx);
    const byId = new Map(peekTasks(ctx).map((t) => [t.id, t]));
    expect(byId.get('1')!.blocks.sort()).toEqual(['2', '3']);
    expect(byId.get('2')!.blockedBy).toEqual(['1']);
    expect(byId.get('3')!.blockedBy).toEqual(['1']);
    // duplicate adds are idempotent
    await taskUpdateTool.execute({ taskId: '1', addBlocks: ['2'] }, ctx);
    expect(byId.get('1')!.blocks.filter((id) => id === '2')).toEqual(['2']);
  });

  it('rejects dependency edges to unknown tasks and to the task itself', async () => {
    const ctx = makeCtx();
    await create(ctx, 'A');
    const unknown = await taskUpdateTool.execute({ taskId: '1', addBlocks: ['9'] }, ctx);
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('unknown task 9');
    const self = await taskUpdateTool.execute({ taskId: '1', addBlockedBy: ['1'] }, ctx);
    expect(self.isError).toBe(true);
    expect(text(self)).toContain('cannot reference the task itself');
  });

  it('status deleted removes the task and scrubs its edges from other tasks', async () => {
    const ctx = makeCtx();
    await create(ctx, 'A'); // 1
    await create(ctx, 'B'); // 2
    await taskUpdateTool.execute({ taskId: '1', addBlocks: ['2'] }, ctx);
    const r = await taskUpdateTool.execute({ taskId: '1', status: 'deleted' }, ctx);
    expect(text(r)).toContain('Deleted task 1');
    const tasks = peekTasks(ctx);
    expect(tasks.map((t) => t.id)).toEqual(['2']);
    expect(tasks[0].blockedBy).toEqual([]); // edge scrubbed
    const gone = await taskGetTool.execute({ taskId: '1' }, ctx);
    expect(text(gone)).toContain('No task found with ID 1');
  });

  it('an unknown taskId is an error', async () => {
    const r = await taskUpdateTool.execute({ taskId: '7', status: 'completed' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('task 7 not found');
  });

  it('rejects an invalid status and leaves the task untouched', async () => {
    const ctx = makeCtx();
    await create(ctx, 'A');
    const r = await taskUpdateTool.execute({ taskId: '1', status: 'done' }, ctx);
    expect(r.isError).toBe(true);
    expect(peekTasks(ctx)[0].status).toBe('pending');
  });

  it('a no-op patch reports "unchanged"', async () => {
    const ctx = makeCtx();
    await create(ctx, 'A');
    const r = await taskUpdateTool.execute({ taskId: '1' }, ctx);
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('unchanged');
  });
});

describe('TaskList', () => {
  it('reports an empty list', async () => {
    const r = await taskListTool.execute({}, makeCtx());
    expect(text(r)).toContain('No tasks in the task list');
  });

  it('renders id, status, subject, owner and OPEN blockers only', async () => {
    const ctx = makeCtx();
    await create(ctx, 'A'); // 1
    await create(ctx, 'B'); // 2
    await create(ctx, 'C'); // 3
    await taskUpdateTool.execute({ taskId: '3', addBlockedBy: ['1', '2'] }, ctx);
    await taskUpdateTool.execute({ taskId: '1', status: 'completed' }, ctx);
    await taskUpdateTool.execute({ taskId: '2', owner: 'agent-b' }, ctx);
    const t = text(await taskListTool.execute({}, ctx));
    expect(t).toContain('1. [completed] A');
    expect(t).toContain('2. [pending] B (owner: agent-b)');
    // task 1 is completed -> only the open blocker 2 remains listed
    expect(t).toContain('3. [pending] C (blocked by: 2)');
  });
});

describe('task store keying (per-session isolation and sharing)', () => {
  it('two bare contexts have independent task lists', async () => {
    const a = makeCtx();
    const b = makeCtx();
    await create(a, 'Only in A');
    expect(peekTasks(b)).toEqual([]);
    expect(text(await taskListTool.execute({}, b))).toContain('No tasks');
  });

  it('contexts sharing a readFilePaths Set (parent + subagent) share one list', async () => {
    const shared = new Set<string>();
    const parent = makeCtx({ readFilePaths: shared });
    const child = makeCtx({ readFilePaths: shared });
    await create(parent, 'Visible to child');
    const t = text(await taskListTool.execute({}, child));
    expect(t).toContain('Visible to child');
    // and the child's updates are visible to the parent
    await taskUpdateTool.execute({ taskId: '1', owner: 'child' }, child);
    expect(peekTasks(parent)[0].owner).toBe('child');
  });
});

describe('registry gate: Task quartet default, TodoWrite legacy revert', () => {
  const TASK_NAMES = ['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList'];

  it('default toolset ships the Task quartet and NOT TodoWrite', () => {
    const tools = createBuiltinTools({ env: {} });
    for (const name of TASK_NAMES) expect(tools.has(name), name).toBe(true);
    expect(tools.has('TodoWrite')).toBe(false);
  });

  it('CLAUDE_CODE_ENABLE_TASKS=0 reverts to TodoWrite (official escape hatch)', () => {
    const tools = createBuiltinTools({ env: { CLAUDE_CODE_ENABLE_TASKS: '0' } });
    expect(tools.has('TodoWrite')).toBe(true);
    for (const name of TASK_NAMES) expect(tools.has(name), name).toBe(false);
  });

  it('any other CLAUDE_CODE_ENABLE_TASKS value keeps the Task quartet', () => {
    const tools = createBuiltinTools({ env: { CLAUDE_CODE_ENABLE_TASKS: '1' } });
    for (const name of TASK_NAMES) expect(tools.has(name), name).toBe(true);
    expect(tools.has('TodoWrite')).toBe(false);
  });

  it('wires the faithful descriptions onto the Task tools', () => {
    const tools = createBuiltinTools({ env: {} });
    expect(tools.get('TaskCreate')?.description).toBe(D.TASKCREATE_DESCRIPTION);
    expect(tools.get('TaskGet')?.description).toBe(D.TASKGET_DESCRIPTION);
    expect(tools.get('TaskUpdate')?.description).toBe(D.TASKUPDATE_DESCRIPTION);
    expect(tools.get('TaskList')?.description).toBe(D.TASKLIST_DESCRIPTION);
  });

  it('all four Task tools are session-state-only (readOnly for the permission gate)', () => {
    for (const tool of [taskCreateTool, taskGetTool, taskUpdateTool, taskListTool]) {
      expect(tool.readOnly, tool.name).toBe(true);
      expect(tool.isFileEdit ?? false, tool.name).toBe(false);
    }
  });
});
