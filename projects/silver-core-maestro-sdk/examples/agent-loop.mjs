/**
 * Agent loop (example 5, design round 3 rulings 裁2 / 裁4 / D3): the
 * "combination IS the loop" wiring — RoutineManager (duty face) +
 * LedgerDriver + createAgentExecutor, end to end on the TWO packages'
 * public surfaces only. This is memory-tidy's executor seat swapped for the
 * injected agent executor, and the living proof that the injection shape
 * needs no LoopRunner module (ruling D3) and no agent-SDK import inside the
 * maestro package (ruling 裁2 — the import below is HOST code, which is the
 * point).
 *
 * Host-shape proof, same rules as examples 1-4:
 * - imports ONLY the two package names + node builtins;
 * - the storage battery is HOST code (fileLedgerStore, one JSON file);
 * - the RoutineManager dispatches (scheduled or triggerNow); the
 *   LedgerDriver executes; every run is one auditable ledger session with
 *   its cost on the query row (ruling D2).
 *
 * Keyless by default: the stub query below is a deterministic fake agent so
 * the example runs anywhere. With ANTHROPIC_API_KEY set the CLI entry uses
 * the real silver-core-agent-sdk `query` in the very same seat — proving the
 * structural shape live.
 *
 * Run (from the repo root, after npm ci + builds):
 *   RUN_AGENT_LOOP=1 node projects/silver-core-maestro-sdk/examples/agent-loop.mjs
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  LedgerDriver,
  RoutineManager,
  TaskLedger,
  createAgentExecutor,
  isTerminal,
} from 'silver-core-maestro-sdk';
import { query } from 'silver-core-agent-sdk';

/** Host storage battery: the LedgerStore contract over one JSON file (same
 *  shape as examples/memory-tidy.mjs / store-patrol.mjs). */
export function fileLedgerStore(filePath) {
  const state = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf8'))
    : { sessions: {}, queries: [] };
  const save = () => {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, filePath);
  };
  return {
    async putSession(record) {
      state.sessions[record.id] = { ...record };
      save();
    },
    async getSession(id) {
      const r = state.sessions[id];
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter) {
      let all = Object.values(state.sessions);
      if (filter?.states !== undefined) all = all.filter((s) => filter.states.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      state.queries.push({ ...record });
      save();
    },
    async listQueries(sessionId) {
      return state.queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

/**
 * Keyless stand-in for the agent SDK's query(): a deterministic fake agent
 * speaking the same message grammar (HOST code — the injection seam takes
 * any structurally compatible function; the real `query` drops into the
 * identical seat, see the CLI entry).
 */
export function stubAgentQuery({ text = 'stub agent result', costUsd = 0.0042 } = {}) {
  return ({ prompt }) => ({
    async interrupt() {
      return {};
    },
    close() {},
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init' };
      yield { type: 'task_progress', progress: 'thinking' };
      yield {
        type: 'result',
        subtype: 'success',
        result: `${text} (prompt: ${prompt.slice(0, 48)})`,
        total_cost_usd: costUsd,
        session_id: 'stub-agent-session',
      };
    },
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The demo. opts (all injectable for the e2e test):
 * - archiveDir (required): sandbox dir; the ledger file lives at state/ledger.json
 * - queryFn (default stubAgentQuery()): the injected agent query function
 * - prompt (default a one-line task), everyMs (default 3_600_000),
 *   pollIntervalMs (default 25), deadlineMs (default 15_000), log (no-op)
 * Fires the routine ONCE via triggerNow (the duty-panel button), drains the
 * session to a terminal state, then reports the routine status the way an
 * inbox would read it. Returns { session, queries, status, messages }.
 */
export async function runAgentLoop(opts) {
  const { archiveDir } = opts;
  const queryFn = opts.queryFn ?? stubAgentQuery();
  const prompt = opts.prompt ?? 'Summarize today\'s patrol snapshots in one line.';
  const everyMs = opts.everyMs ?? 3_600_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const deadlineMs = opts.deadlineMs ?? 15_000;
  const log = opts.log ?? (() => {});

  const ledger = new TaskLedger({ store: fileLedgerStore(join(archiveDir, 'state', 'ledger.json')) });
  const messages = [];
  const manager = new RoutineManager({
    ledger,
    routines: [
      {
        id: 'agent-loop',
        name: 'Agent duty loop',
        intent: 'agent:duty-loop',
        every: everyMs,
        payload: { agent: { prompt } },
        maxAttempts: 2,
      },
    ],
    pollIntervalMs,
  });
  const driver = new LedgerDriver({
    ledger,
    executor: createAgentExecutor({
      query: queryFn,
      onMessage: (session, message) => {
        messages.push(message);
        log(`${session.id}: ${message?.type ?? 'message'}`);
      },
    }),
    pollIntervalMs,
  });

  manager.start();
  driver.start();
  const fired = await manager.triggerNow('agent-loop');
  log(`manual fire ${fired.id}`);

  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const s = await ledger.getSession(fired.id);
    if (s !== null && isTerminal(s.state)) break;
    if (Date.now() > deadline) {
      await manager.stop();
      await driver.stop();
      throw new Error('agent-loop: drain deadline — session still open');
    }
    await sleep(10);
  }
  const status = await manager.get('agent-loop');
  await manager.stop();
  await driver.stop();

  return {
    session: await ledger.getSession(fired.id),
    queries: await ledger.listQueries(fired.id),
    status,
    messages,
  };
}

// Manual/CI entry (gated so importing this module never runs the demo):
//   RUN_AGENT_LOOP=1 node projects/silver-core-maestro-sdk/examples/agent-loop.mjs
if (process.env.RUN_AGENT_LOOP === '1') {
  const sandbox = mkdtempSync(join(tmpdir(), 'agent-loop-'));
  // With a key, the REAL query() takes the seat — same shape, zero adapter.
  const queryFn =
    process.env.ANTHROPIC_API_KEY !== undefined && process.env.ANTHROPIC_API_KEY !== ''
      ? (args) => query({ prompt: args.prompt, options: { ...args.options, maxTurns: 1 } })
      : stubAgentQuery();
  runAgentLoop({
    archiveDir: sandbox,
    queryFn,
    log: (line) => console.log('[agent-loop]', line),
  }).then(({ session, queries, status }) => {
    console.log(`[agent-loop] ${session.id}: ${session.state} (attempts ${session.attempts})`);
    for (const row of queries) {
      console.log(
        `[agent-loop] attempt ${row.attempt}: ${row.outcome}` +
          (row.costUsd !== undefined ? ` ($${row.costUsd})` : '') +
          (row.summary !== undefined ? ` — ${row.summary}` : ''),
      );
    }
    console.log(
      `[agent-loop] routine '${status.spec.name}': lastFireAt ${status.lastFireAt}, nextFireAt ${status.nextFireAt}`,
    );
  }, (err) => {
    console.error('[agent-loop] fatal:', err);
    process.exit(1);
  });
}
