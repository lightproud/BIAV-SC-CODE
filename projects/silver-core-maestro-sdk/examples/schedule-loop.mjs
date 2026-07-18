/**
 * Schedule loop (campaign 3, SCS-REQ orchestrator-sdk §6.2 example 2):
 * fixed-point firing + missed-fire compensation + cross-restart recovery,
 * end to end on the public package surface.
 *
 * Host-shape proof, same rules as examples 1 and 2:
 * - imports ONLY the maestro SDK package name + node builtins;
 * - the storage battery is HOST code: fileLedgerStore persists the ledger to
 *   one JSON file, which is exactly what makes the restart phase recover —
 *   fire bookkeeping lives in the ledger (session ids sched:{spec}:{fireAt}),
 *   not in scheduler memory;
 * - the Scheduler only DISPATCHES due fire sessions; a LedgerDriver with a
 *   trivial executor runs them (division of labor per §3/§4).
 *
 * Flow: phase 1 runs one interval spec for a few fires, stops (simulated
 * crash), sleeps a gap so fire points fall while "down", then phase 2 builds
 * a NEW Scheduler + driver over the same file store: recovery skips every
 * already-fired point and compensates the gap per the spec's catchUp policy.
 *
 * Run (from the repo root, after npm ci + workspace builds):
 *   RUN_SCHEDULE_LOOP=1 node projects/silver-core-maestro-sdk/examples/schedule-loop.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LedgerDriver, Scheduler, TaskLedger } from 'silver-core-maestro-sdk';

/**
 * Host storage battery: the SDK's LedgerStore contract over one JSON file
 * (write-through with atomic rename). Same shape as examples/store-patrol.mjs.
 */
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The demo. opts (all injectable for the e2e test):
 * - archiveDir (required): sandbox dir; the ledger file lives at state/ledger.json
 * - everyMs (default 500), catchUp (default 'latest'), pollIntervalMs (default 50)
 * - phase1Fires (default 2): fires to observe before the simulated crash
 * - phase2Fires (default 1): fires to observe after the restart
 * - gapMs (default 3 * everyMs): simulated down time between the phases
 * - deadlineMs (default 15000): per-phase safety deadline
 * - log (default no-op): host-side rendering seam
 * Returns { phase1FiredIds, phase2FiredIds, allSessions }.
 */
export async function runScheduleLoop(opts) {
  const archiveDir = opts.archiveDir;
  const everyMs = opts.everyMs ?? 500;
  const catchUp = opts.catchUp ?? 'latest';
  const pollIntervalMs = opts.pollIntervalMs ?? 50;
  const phase1Fires = opts.phase1Fires ?? 2;
  const phase2Fires = opts.phase2Fires ?? 1;
  const gapMs = opts.gapMs ?? everyMs * 3;
  const deadlineMs = opts.deadlineMs ?? 15_000;
  const log = opts.log ?? (() => {});
  const ledgerPath = join(archiveDir, 'state', 'ledger.json');

  const spec = {
    id: 'heartbeat',
    intent: 'schedule-loop heartbeat',
    payload: { demo: 'schedule-loop' },
    every: everyMs,
    catchUp,
  };

  // One phase = a fresh Scheduler + driver over the SAME file-backed ledger.
  // Everything a phase knows about past fires comes back out of that file.
  const runPhase = async (label, minNewFires) => {
    const ledger = new TaskLedger({ store: fileLedgerStore(ledgerPath) });
    const fired = [];
    const scheduler = new Scheduler({
      ledger,
      specs: [spec],
      pollIntervalMs,
      onEvent: (ev) => {
        if (ev.type === 'schedule:fire') {
          fired.push(ev.sessionId);
          log(`${label}: fire ${ev.sessionId}`);
        }
      },
    });
    const driver = new LedgerDriver({
      ledger,
      executor: async (session) => ({
        outcome: 'ok',
        summary: `beat at ${session.payload.schedule.fireAt}`,
      }),
      pollIntervalMs,
    });
    scheduler.start();
    driver.start();
    const deadline = Date.now() + deadlineMs;
    const bail = async (reason) => {
      await scheduler.stop();
      await driver.stop();
      throw new Error(`schedule-loop ${label}: ${reason}`);
    };
    while (fired.length < minNewFires) {
      if (Date.now() > deadline) await bail(`deadline before ${minNewFires} fire(s)`);
      await sleep(10);
    }
    for (;;) {
      const sessions = await Promise.all(fired.map((id) => ledger.getSession(id)));
      if (sessions.every((s) => s !== null && (s.state === 'done' || s.state === 'failed'))) break;
      if (Date.now() > deadline) await bail('drain deadline — fired sessions still open');
      await sleep(10);
    }
    await scheduler.stop();
    await driver.stop();
    return { fired, allSessions: await ledger.listSessions() };
  };

  const phase1 = await runPhase('phase1', phase1Fires);
  log(`crash simulated; down for ${gapMs}ms (fire points now fall unfired)`);
  await sleep(gapMs);
  const phase2 = await runPhase('phase2', phase2Fires);

  return {
    phase1FiredIds: phase1.fired,
    phase2FiredIds: phase2.fired,
    allSessions: phase2.allSessions,
  };
}

// Manual/CI entry (gated so importing this module never runs the demo):
//   RUN_SCHEDULE_LOOP=1 node projects/silver-core-maestro-sdk/examples/schedule-loop.mjs
if (process.env.RUN_SCHEDULE_LOOP === '1') {
  const archiveDir = mkdtempSync(join(tmpdir(), 'schedule-loop-'));
  runScheduleLoop({
    archiveDir,
    log: (line) => console.log('[schedule-loop]', line),
  }).then(({ phase1FiredIds, phase2FiredIds, allSessions }) => {
    console.log(`[schedule-loop] phase1 fired: ${phase1FiredIds.join(', ')}`);
    console.log(`[schedule-loop] phase2 fired (post-restart): ${phase2FiredIds.join(', ')}`);
    for (const s of allSessions) console.log(`[schedule-loop] ${s.id}: ${s.state} (attempts ${s.attempts})`);
    console.log(`[schedule-loop] ledger file: ${join(archiveDir, 'state', 'ledger.json')}`);
  }, (err) => {
    console.error('[schedule-loop] fatal:', err);
    process.exit(1);
  });
}
