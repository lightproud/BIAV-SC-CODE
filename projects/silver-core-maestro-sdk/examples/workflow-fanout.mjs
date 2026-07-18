/**
 * Workflow fan-out example (example 3, campaign 4; SCS-REQ orchestrator-sdk
 * §3 "declarative graph executor; the graph definition is data" + §6.3
 * "declaratively dispatch multiple workers and converge the results").
 *
 * Host-shape proof, same rules as examples 1 and 2:
 * - imports ONLY the maestro SDK's public surface + node builtins (the agent
 *   SDK is not needed: the executor is pure computation, hard property §1.1);
 * - the graph is DATA — a JSON literal below: three word-count workers fan
 *   out over text chunks and converge into one join node, which receives the
 *   workers' summaries through the WorkflowRun convergence envelope;
 * - batteries are HOST code: the memory ledger store is inlined here;
 * - the LedgerDriver executes the node sessions; WorkflowRun only reads
 *   states and dispatches ready nodes.
 *
 * Run (from the repo root, after npm ci + workspace builds):
 *   RUN_WORKFLOW_FANOUT=1 node projects/silver-core-maestro-sdk/examples/workflow-fanout.mjs
 */

import process from 'node:process';
import { TaskLedger, LedgerDriver, WorkflowRun } from 'silver-core-maestro-sdk';

/** Host storage battery: the SDK's LedgerStore contract, in memory. */
export function memoryLedgerStore() {
  const sessions = new Map();
  const queries = [];
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
      if (filter?.states !== undefined) all = all.filter((s) => filter.states.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore);
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

/**
 * The workflow as pure data (a JSON literal): fan-out over three text chunks,
 * converge into `merge`. Nothing here is code — a host could load this from a
 * file, a DB row, or a network payload unchanged.
 */
export const WORDCOUNT_FANOUT_GRAPH = {
  id: 'wordcount-fanout',
  nodes: [
    { id: 'chunk-1', intent: 'wordcount', payload: { text: 'the vat holds a silver core' } },
    { id: 'chunk-2', intent: 'wordcount', payload: { text: 'workers fan out over the text' } },
    { id: 'chunk-3', intent: 'wordcount', payload: { text: 'and converge into one summary' } },
    { id: 'merge', intent: 'merge', deps: ['chunk-1', 'chunk-2', 'chunk-3'] },
  ],
};

function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Pure-computation executor keyed by node intent. Workers read their chunk
 * from the envelope's `node` slot; the join reads its deps' summaries from
 * the envelope's `workflow.deps` slot (the convergence contract).
 */
function makeExecutor() {
  return async (session) => {
    const { node, workflow } = session.payload;
    if (session.intent === 'wordcount') {
      const result = { nodeId: workflow.nodeId, words: countWords(node.text) };
      return { outcome: 'ok', summary: JSON.stringify(result) };
    }
    if (session.intent === 'merge') {
      const parts = Object.entries(workflow.deps).map(([depId, summary]) => [
        depId,
        summary === null ? null : JSON.parse(summary),
      ]);
      const merged = {
        totalWords: parts.reduce((n, [, part]) => n + (part === null ? 0 : part.words), 0),
        chunks: Object.fromEntries(parts.map(([depId, part]) => [depId, part === null ? null : part.words])),
      };
      return { outcome: 'ok', summary: JSON.stringify(merged) };
    }
    return { outcome: 'error', error: `unknown intent '${session.intent}'` };
  };
}

/**
 * Runs the fan-out workflow end to end and returns { status, states, merged }
 * where `merged` is the join node's parsed final summary (or null on failure).
 */
export async function runWorkflowFanout(opts = {}) {
  const graph = opts.graph ?? WORDCOUNT_FANOUT_GRAPH;
  const runId = opts.runId ?? `fanout-${Date.now()}`;
  const pollIntervalMs = opts.pollIntervalMs ?? 20;
  const ledger = new TaskLedger({ store: opts.store ?? memoryLedgerStore() });
  const driver = new LedgerDriver({ ledger, executor: makeExecutor(), pollIntervalMs });
  const run = new WorkflowRun({ ledger, graph, runId, pollIntervalMs });
  driver.start();
  try {
    const { status, states } = await run.run({ drainTimeoutMs: opts.drainTimeoutMs ?? 30_000 });
    const joinRows = await ledger.listQueries(run.sessionId('merge'));
    const lastOk = [...joinRows].reverse().find((q) => q.outcome === 'ok');
    const merged = lastOk?.summary !== undefined ? JSON.parse(lastOk.summary) : null;
    return { status, states, merged, runId };
  } finally {
    await driver.stop();
  }
}

// Manual/CI entry (gated so importing this module never runs the workflow):
//   RUN_WORKFLOW_FANOUT=1 node projects/silver-core-maestro-sdk/examples/workflow-fanout.mjs
if (process.env.RUN_WORKFLOW_FANOUT === '1') {
  runWorkflowFanout().then(({ status, states, merged }) => {
    console.log('[workflow-fanout] status:', status);
    for (const [nodeId, state] of Object.entries(states)) {
      console.log(`[workflow-fanout] ${nodeId}: ${state}`);
    }
    console.log('[workflow-fanout] merged:', JSON.stringify(merged));
    if (status !== 'done') process.exit(1);
  }, (err) => {
    console.error('[workflow-fanout] fatal:', err);
    process.exit(1);
  });
}
