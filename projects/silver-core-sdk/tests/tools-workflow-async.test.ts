/**
 * Workflow async launch (v0.92.0, keeper ruling 2026-07-27 "1 改").
 *
 * The tool used to run the whole workflow inside the tool call and return the
 * finished result; official launches it in the background and returns a task
 * id. The gap could not be closed at the type level — emitting
 * `status: 'async_launched'` from a synchronous run hands the caller a claim
 * ticket for goods it is already holding — so the behaviour moved instead.
 *
 * What is actually at risk in that move, and therefore what these tests pin:
 *
 *  1. **Detaching onto the wrong signal.** `ctx.signal` is per-TURN. A
 *     background run driven by it would ack the launch and then die at the
 *     turn boundary, silently, with the caller waiting for a result that never
 *     comes. The run must survive a turn-signal abort and must NOT survive a
 *     query-lifetime abort.
 *  2. **Losing the synchronous syntax verdict.** Official documents Workflow as
 *     returning immediately AND as throwing on a syntax error. A typo must not
 *     ack as launched.
 *  3. **Lying when there is no host.** Outside query() there is no
 *     query-lifetime signal to detach onto; the honest answer is to run inline
 *     and SAY so, not to pretend.
 *  4. **Stop semantics.** A stopped task must not later report `completed`.
 */

import { describe, expect, it } from 'vitest';

import { createShellManager } from '../src/tools/shells.js';
import { workflowTool } from '../src/tools/workflow.js';
import type {
  ShellManager,
  SpawnSubagentFn,
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';
import type { WorkflowOutput } from '../src/types/tools.js';
import { toolContext as makeCtx } from './helpers/tool-context.js';

const SCRIPT = `export const meta = { name: 'w', description: 'd' }
const a = await agent('hello')
return { a }`;

const spawn: SpawnSubagentFn = async (p) => ({
  content: `R:${p.prompt.split('\n')[0]}`,
  isError: false,
  agentId: 'agent_1',
  background: false,
});

function asyncCtx(extra: Partial<ToolContext> = {}): {
  ctx: ToolContext;
  shells: ShellManager;
  life: AbortController;
  turn: AbortController;
} {
  const shells = createShellManager(() => {});
  const life = new AbortController();
  const turn = new AbortController();
  const ctx = makeCtx({
    spawnSubagent: spawn,
    shells,
    lifeSignal: life.signal,
    // The real engine hands the tool AbortSignal.any([life, turn]); reproduce
    // that exactly, or the turn-boundary case below proves nothing.
    signal: AbortSignal.any([life.signal, turn.signal]),
    ...extra,
  }) as ToolContext;
  return { ctx, shells, life, turn };
}

const text = (r: ToolResultPayload): string =>
  typeof r.content === 'string' ? r.content : JSON.stringify(r.content);

async function settle(shells: ShellManager, id: string, tries = 200): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const rec = shells.get(id);
    if (rec !== undefined && rec.status !== 'running') return rec.status;
    await new Promise((r) => setTimeout(r, 5));
  }
  return shells.get(id)?.status ?? 'missing';
}

describe('Workflow async launch', () => {
  it('returns a task id immediately and settles in the background', async () => {
    const { ctx, shells } = asyncCtx();
    const res = await workflowTool.execute({ script: SCRIPT }, ctx);
    expect(res.isError).toBeUndefined();

    const s = res.structuredOutput as WorkflowOutput;
    // Official's REQUIRED discriminant, now honest: the launch really happened.
    expect(s.status).toBe('async_launched');
    expect(s.taskId).toMatch(/^task_\d+$/);
    expect(s.runId).toMatch(/^wf-run-\d+$/);
    expect(s.summary).toBe('d');
    // Absent, not faked: this engine has no transcript directory.
    expect('transcriptDir' in s).toBe(false);

    // The ack names the tools that actually read and stop it, rather than
    // promising a task-notification this engine never delivers.
    expect(text(res)).toContain('TaskOutput');
    expect(text(res)).toContain('TaskStop');
    expect(text(res)).not.toContain('task-notification');

    expect(await settle(shells, s.taskId)).toBe('completed');
    expect(shells.get(s.taskId)?.stdout).toContain('Workflow completed: w');
    shells.dispose();
  });

  it('survives the turn ending — the whole point of the lifeSignal split', async () => {
    const { ctx, shells, turn } = asyncCtx();
    const res = await workflowTool.execute({ script: SCRIPT }, ctx);
    const id = (res.structuredOutput as WorkflowOutput).taskId;

    // End the turn the way the engine does. Driving the run off ctx.signal
    // would kill it right here, and the caller would never learn why.
    turn.abort();
    expect(ctx.signal.aborted).toBe(true);

    expect(await settle(shells, id)).toBe('completed');
    shells.dispose();
  });

  it('dies with the query, not after it', async () => {
    const { ctx, shells, life } = asyncCtx();
    const res = await workflowTool.execute({ script: SCRIPT }, ctx);
    const id = (res.structuredOutput as WorkflowOutput).taskId;
    life.abort();
    const status = await settle(shells, id);
    expect(status).not.toBe('running');
    shells.dispose();
  });

  it('reports a stopped task as killed, never completed', async () => {
    const { ctx, shells } = asyncCtx();
    const res = await workflowTool.execute({ script: SCRIPT }, ctx);
    const id = (res.structuredOutput as WorkflowOutput).taskId;
    expect(shells.kill(id)).toBe(true);
    // A stop that lands first WINS. Overwriting it with 'completed' would
    // contradict the notice the stop site already sent.
    expect(await settle(shells, id)).toBe('killed');
    shells.dispose();
  });

  it('keeps the syntax verdict synchronous', async () => {
    const { ctx, shells } = asyncCtx();
    const res = await workflowTool.execute({ script: 'export const meta = ( broken' }, ctx);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('did not start');
    // Nothing was registered: a script that never compiled has no task to read.
    expect(res.structuredOutput).toBeUndefined();
    shells.dispose();
  });

  it('runs inline and says so when there is no background host', async () => {
    // Bare tool use outside query(): no lifeSignal to detach onto. Running it
    // here is the honest degradation; detaching onto the turn signal is not.
    const ctx = makeCtx({ spawnSubagent: spawn }) as ToolContext;
    const res = await workflowTool.execute({ script: SCRIPT }, ctx);
    expect(res.isError).toBeUndefined();
    expect(text(res)).toContain('did NOT launch asynchronously');
    expect(text(res)).toContain('Workflow completed: w');
    // No async_launched claim when nothing was launched.
    expect(res.structuredOutput).toBeUndefined();
  });

  it('still reports a failing run, as a failed task rather than a tool error', async () => {
    const { ctx, shells } = asyncCtx();
    const res = await workflowTool.execute(
      { script: `export const meta = { name: 'boom', description: 'd' }\nthrow new Error('nope')` },
      ctx,
    );
    // The LAUNCH succeeded; the run failing is a fact about the task, and the
    // caller learns it from the task, not from the launch result.
    expect(res.isError).toBeUndefined();
    const id = (res.structuredOutput as WorkflowOutput).taskId;
    expect(await settle(shells, id)).toBe('failed');
    expect(shells.get(id)?.stdout).toContain('nope');
    shells.dispose();
  });

  it('registers the run in the same id space TaskOutput serves', async () => {
    const { ctx, shells } = asyncCtx();
    const res = await workflowTool.execute({ script: SCRIPT }, ctx);
    const id = (res.structuredOutput as WorkflowOutput).taskId;
    const rec = shells.get(id);
    expect(rec).toBeDefined();
    // A promise, not a process — undefined pid is the truth, not a placeholder.
    expect(rec?.pid).toBeUndefined();
    expect(rec?.command).toBe('Workflow: w');
    await settle(shells, id);
    shells.dispose();
  });
});
