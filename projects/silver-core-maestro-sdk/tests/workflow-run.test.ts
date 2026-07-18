/**
 * WorkflowRun over a real TaskLedger + LedgerDriver (fake timers, inline
 * memory store, scripted executor): diamond ordering, convergence payloads,
 * fail-fast, resume-by-idempotent-dispatch, and run() drain timeout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import { LedgerDriver } from '../src/driver.js';
import type { ExecutorResult } from '../src/driver.js';
import type { LedgerStore } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';
import { GraphError } from '../src/workflow/graph.js';
import type { WorkflowGraph } from '../src/workflow/graph.js';
import { WorkflowRun, workflowSessionId } from '../src/workflow/run.js';
import type { WorkflowNodePayload } from '../src/workflow/run.js';

function memoryStore(): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    async putSession(record) {
      sessions.set(record.id, { ...record });
    },
    async getSession(id) {
      const record = sessions.get(id);
      return record === undefined ? null : { ...record };
    },
    async listSessions(filter) {
      let all = [...sessions.values()];
      const states = filter?.states;
      if (states !== undefined) all = all.filter((s) => states.includes(s.state));
      const dueBefore = filter?.dueBefore;
      if (dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= dueBefore);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      queries.push({ ...record });
    },
    async listQueries(sessionId) {
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

const diamond: WorkflowGraph = {
  id: 'dg',
  nodes: [
    { id: 'a', intent: 'work:a', payload: { seed: 1 } },
    { id: 'b', intent: 'work:b', deps: ['a'] },
    { id: 'c', intent: 'work:c', deps: ['a'] },
    { id: 'd', intent: 'join:d', deps: ['b', 'c'] },
  ],
};

interface Call {
  intent: string;
  payload: WorkflowNodePayload;
}

function harness(script: (session: SessionRecord) => ExecutorResult) {
  const store = memoryStore();
  const ledger = new TaskLedger({ store });
  const calls: Call[] = [];
  const driver = new LedgerDriver({
    ledger,
    executor: async (session) => {
      calls.push({ intent: session.intent, payload: session.payload as WorkflowNodePayload });
      return script(session);
    },
    pollIntervalMs: 10,
  });
  return { ledger, driver, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WorkflowRun construction', () => {
  it('validates the graph at construction', () => {
    const { ledger } = harness(() => ({ outcome: 'ok' }));
    const cyclic: WorkflowGraph = {
      id: 'g',
      nodes: [{ id: 'a', intent: 'x', deps: ['a'] }],
    };
    expect(() => new WorkflowRun({ ledger, graph: cyclic, runId: 'r' })).toThrow(GraphError);
  });

  it('rejects an empty runId', () => {
    const { ledger } = harness(() => ({ outcome: 'ok' }));
    expect(() => new WorkflowRun({ ledger, graph: diamond, runId: '' })).toThrow(/runId/);
  });
});

describe('diamond a -> (b, c) -> d', () => {
  it('runs in dependency order and delivers dep summaries to the join node', async () => {
    const { ledger, driver, calls } = harness((session) => ({
      outcome: 'ok',
      summary: `sum:${session.intent}`,
    }));
    driver.start();
    const wf = new WorkflowRun({ ledger, graph: diamond, runId: 'r1', pollIntervalMs: 10 });
    const resultP = wf.run({ drainTimeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultP;
    await driver.stop();

    expect(result.status).toBe('done');
    expect(result.states).toEqual({ a: 'done', b: 'done', c: 'done', d: 'done' });

    // Ordering: a strictly first, d strictly last, b/c only after a done.
    const order = calls.map((c) => c.intent);
    expect(order).toHaveLength(4);
    expect(order[0]).toBe('work:a');
    expect([...order.slice(1, 3)].sort()).toEqual(['work:b', 'work:c']);
    expect(order[3]).toBe('join:d');

    // Session ids follow the wf:<graph>:<run>:<node> scheme.
    const aSession = await ledger.getSession('wf:dg:r1:a');
    expect(aSession?.state).toBe('done');
    expect(wf.sessionId('d')).toBe('wf:dg:r1:d');

    // Root envelope: node payload wrapped, no deps.
    expect(calls[0]?.payload).toEqual({
      node: { seed: 1 },
      workflow: { graphId: 'dg', runId: 'r1', nodeId: 'a', deps: {} },
    });
    // Convergence: d's payload carries b and c summaries keyed by dep id.
    expect(calls[3]?.payload.workflow).toEqual({
      graphId: 'dg',
      runId: 'r1',
      nodeId: 'd',
      deps: { b: 'sum:work:b', c: 'sum:work:c' },
    });
  });

  it('a dep that succeeded without a summary converges as null', async () => {
    const graph: WorkflowGraph = {
      id: 'g2',
      nodes: [
        { id: 'a', intent: 'quiet' },
        { id: 'b', intent: 'join', deps: ['a'] },
      ],
    };
    const { ledger, driver, calls } = harness(() => ({ outcome: 'ok' }));
    driver.start();
    const wf = new WorkflowRun({ ledger, graph, runId: 'r', pollIntervalMs: 10 });
    const resultP = wf.run({ drainTimeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await resultP).status).toBe('done');
    await driver.stop();
    expect(calls[1]?.payload.workflow.deps).toEqual({ a: null });
  });

  it('a failing b fails the run and d is never dispatched', async () => {
    const graph: WorkflowGraph = {
      id: 'dg',
      nodes: [
        { id: 'a', intent: 'work:a' },
        { id: 'b', intent: 'work:b', deps: ['a'], maxAttempts: 1 },
        { id: 'c', intent: 'work:c', deps: ['a'] },
        { id: 'd', intent: 'join:d', deps: ['b', 'c'] },
      ],
    };
    const { ledger, driver, calls } = harness((session) =>
      session.intent === 'work:b'
        ? { outcome: 'error', error: 'boom' }
        : { outcome: 'ok', summary: 'ok' },
    );
    driver.start();
    const wf = new WorkflowRun({ ledger, graph, runId: 'r1', pollIntervalMs: 10 });
    const resultP = wf.run({ drainTimeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultP;
    // Let any still-open sibling (c) drain before asserting on dispatches.
    await vi.advanceTimersByTimeAsync(5_000);
    await driver.stop();

    expect(result.status).toBe('failed');
    expect(result.states.b).toBe('failed');
    expect(result.states.d).toBeUndefined();
    const bSession = await ledger.getSession(workflowSessionId('dg', 'r1', 'b'));
    expect(bSession?.maxAttempts).toBe(1); // node maxAttempts forwarded
    expect(bSession?.attempts).toBe(1);
    expect(calls.map((c) => c.intent)).not.toContain('join:d');
    expect(await ledger.getSession(workflowSessionId('dg', 'r1', 'd'))).toBeNull();
  });
});

describe('resume', () => {
  it('a fresh WorkflowRun over the same store finishes without re-running done nodes', async () => {
    const { ledger, driver, calls } = harness((session) => ({
      outcome: 'ok',
      summary: `sum:${session.intent}`,
    }));
    driver.start();

    // Half-run: dispatch a, let it finish; dispatch b and c, let them finish;
    // then abandon wf1 before it ever dispatches d.
    const wf1 = new WorkflowRun({ ledger, graph: diamond, runId: 'rr', pollIntervalMs: 10 });
    expect(await wf1.tick()).toBe('running'); // dispatches a
    await vi.advanceTimersByTimeAsync(500);
    expect(await wf1.tick()).toBe('running'); // dispatches b, c
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.map((c) => c.intent).sort()).toEqual(['work:a', 'work:b', 'work:c']);

    // Resume: same store, same runId, new instance.
    const wf2 = new WorkflowRun({ ledger, graph: diamond, runId: 'rr', pollIntervalMs: 10 });
    const resultP = wf2.run({ drainTimeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultP;
    await driver.stop();

    expect(result.status).toBe('done');
    expect(result.states).toEqual({ a: 'done', b: 'done', c: 'done', d: 'done' });
    // Done nodes were not re-run: one attempt each, one executor call each.
    for (const id of ['a', 'b', 'c']) {
      const session = await ledger.getSession(workflowSessionId('dg', 'rr', id));
      expect(session?.attempts).toBe(1);
    }
    expect(calls.filter((c) => c.intent === 'work:a')).toHaveLength(1);
    expect(calls).toHaveLength(4); // a, b, c from wf1 + d from wf2
    // The join still received its convergence payload after resume.
    expect(calls[3]?.payload.workflow.deps).toEqual({ b: 'sum:work:b', c: 'sum:work:c' });
  });
});

describe('run() drain timeout', () => {
  it('throws when the graph never settles (no driver running)', async () => {
    const { ledger } = harness(() => ({ outcome: 'ok' }));
    const graph: WorkflowGraph = { id: 'g', nodes: [{ id: 'a', intent: 'x' }] };
    const wf = new WorkflowRun({ ledger, graph, runId: 'r', pollIntervalMs: 10 });
    const resultP = wf.run({ drainTimeoutMs: 50 });
    const assertion = expect(resultP).rejects.toThrow(/drain timeout/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});

describe("id hygiene (review hardening 2026-07-18): ':' banned in runId", () => {
  it('rejects a colon in runId (collides distinct runs onto one session id)', () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const graph = { id: 'g', nodes: [{ id: 'n', intent: 'x' }] };
    expect(() => new WorkflowRun({ ledger, graph, runId: 'a:b' })).toThrow(/must not contain ':'/);
  });
});
