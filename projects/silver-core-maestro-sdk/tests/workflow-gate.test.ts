/**
 * Workflow confirmation gate (design round 3 ruling 裁3): a node declared
 * `manualClaim: true` dispatches with runAt: null — it parks in
 * pending+manualClaim, invisible to claimDue, until the host claims it
 * (a human confirming a plan) and records the outcome. Zero new states:
 * the Cowork awaiting_confirm projection rides the ledger's existing
 * manual-claim vocabulary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import { GraphError, validateGraph, type WorkflowGraph } from '../src/workflow/graph.js';
import { parseWorkflowGraphSource } from '../src/workflow/load.js';
import { WorkflowRun, workflowSessionId } from '../src/workflow/run.js';
import { memoryStore } from './helpers/memory-store.js';

const T0 = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** The Cowork shape: plan -> confirmation gate -> execute -> deliver. */
const coworkGraph = (): WorkflowGraph => ({
  id: 'cowork',
  nodes: [
    { id: 'plan', intent: 'draft-plan' },
    { id: 'gate', intent: 'await-confirmation', manualClaim: true, deps: ['plan'] },
    { id: 'execute', intent: 'do-the-work', deps: ['gate'] },
    { id: 'deliver', intent: 'deliver', deps: ['execute'] },
  ],
});

describe('validateGraph manualClaim', () => {
  it('accepts literal true and undefined; rejects every other value', () => {
    expect(() => validateGraph(coworkGraph())).not.toThrow();
    for (const bad of [false, 1, 'yes', null, 0]) {
      expect(() =>
        validateGraph({
          id: 'g',
          nodes: [{ id: 'n', intent: 'i', manualClaim: bad as unknown as true }],
        }),
      ).toThrow(GraphError);
    }
  });

  it('the declarative loader carries manualClaim through (hot-layer JSON is data)', () => {
    const source = JSON.stringify(coworkGraph());
    const loaded = parseWorkflowGraphSource(source);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.graph.nodes.find((n) => n.id === 'gate')!.manualClaim).toBe(true);
    }
    // A malformed gate value degrades to skip, never throws (loader contract).
    const bad = parseWorkflowGraphSource(
      JSON.stringify({ id: 'g', nodes: [{ id: 'n', intent: 'i', manualClaim: 'yes' }] }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/manualClaim/);
  });
});

describe('WorkflowRun gate dispatch and confirmation flow', () => {
  it('dispatches a ready gate node as manual-claim: pending, invisible to claimDue', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const run = new WorkflowRun({ ledger, graph: coworkGraph(), runId: 'r1' });

    // Tick 1: only plan is ready (gate depends on it).
    await run.tick();
    const planId = workflowSessionId('cowork', 'r1', 'plan');
    await ledger.claimSession(planId);
    await ledger.recordOutcome(planId, {
      outcome: 'ok',
      summary: 'plan drafted',
      startedAt: T0,
      endedAt: T0 + 1,
    });

    // Tick 2: gate becomes ready and dispatches as a manual-claim session.
    expect(await run.tick()).toBe('running');
    const gateId = workflowSessionId('cowork', 'r1', 'gate');
    const gate = await ledger.getSession(gateId);
    expect(gate).not.toBeNull();
    expect(gate!.state).toBe('pending');
    expect(gate!.manualClaim).toBe(true);
    expect(gate!.nextRunAt).toBeNull();

    // Invisible to a driver's due-poll — the whole point of the gate.
    expect(await ledger.claimDue(T0 + 10_000)).toHaveLength(0);

    // The host confirms: claim surgically + record ok (the executor is a human).
    await ledger.claimSession(gateId);
    await ledger.recordOutcome(gateId, {
      outcome: 'ok',
      summary: '守密人确认',
      startedAt: T0 + 2,
      endedAt: T0 + 3,
    });

    // Tick 3: execute is now ready — downstream flows exactly as before.
    expect(await run.tick()).toBe('running');
    expect(await ledger.getSession(workflowSessionId('cowork', 'r1', 'execute'))).not.toBeNull();
  });

  it('rejecting the gate (cancelSession) fails the run fast — nothing downstream dispatches', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const run = new WorkflowRun({ ledger, graph: coworkGraph(), runId: 'r1' });
    await run.tick();
    const planId = workflowSessionId('cowork', 'r1', 'plan');
    await ledger.claimSession(planId);
    await ledger.recordOutcome(planId, { outcome: 'ok', startedAt: T0, endedAt: T0 + 1 });
    await run.tick();

    const gateId = workflowSessionId('cowork', 'r1', 'gate');
    await ledger.cancelSession(gateId, { reason: 'user-rejected' });

    expect(await run.tick()).toBe('failed');
    expect(await ledger.getSession(workflowSessionId('cowork', 'r1', 'execute'))).toBeNull();
    const gate = await ledger.getSession(gateId);
    expect(gate!.cancelReason).toBe('user-rejected');
  });

  it('a non-gate node still dispatches due-immediately (default byte-for-byte)', async () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    const run = new WorkflowRun({
      ledger,
      graph: { id: 'plain', nodes: [{ id: 'only', intent: 'work' }] },
      runId: 'r1',
    });
    await run.tick();
    const s = await ledger.getSession(workflowSessionId('plain', 'r1', 'only'));
    expect(s!.manualClaim).toBeUndefined();
    expect(s!.nextRunAt).toBe(T0);
    expect(await ledger.claimDue(T0)).toHaveLength(1);
  });
});
