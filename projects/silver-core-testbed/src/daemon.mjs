/**
 * The testbed daemon — the HOST main() (hard property §1.1: the library
 * never owns the loop; this file does). Assembles, from public surfaces
 * only: fileLedgerStore -> TaskLedger -> Scheduler (hot-layer specs) ->
 * LedgerDriver (executor routing intents to inspectors / dream / tick).
 *
 * Modes:
 *   --once   CI cadence: recover + fire due points, drain, exit.
 *            Exit 1 when any session TERMINALLY failed during this run.
 *   (none)   Soak cadence: run until SIGTERM/SIGINT, heartbeat every 30 s
 *            into state/heartbeat.jsonl (downtime forensics for the soak
 *            report), pid file for driverctl.
 *
 * Crash recovery (kill -9 semantics): a session claimed as `running` when
 * the process dies has no one left to record its outcome — the SDK has no
 * claim lease (gap ledger G2), so the HOST sweeps at boot: every `running`
 * session is settled as an error outcome, which re-enters the normal
 * retry/backoff path exactly like a graceful-stop abort would.
 */

import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DuplicateSessionError,
  LedgerDriver,
  Scheduler,
  TaskLedger,
  firesBetween,
} from 'silver-core-maestro-sdk';
import { fileLedgerStore } from './store.mjs';
import { INSPECTORS, renderReport } from './inspectors.mjs';
import { openMemory, writeReport } from './memory.mjs';
import { dream } from './dream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TESTBED_ROOT = resolve(HERE, '..');
export const REPO_ROOT = resolve(TESTBED_ROOT, '..', '..');

const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Build the wired components; exported so drills/tests assemble the same host. */
export function buildHost({
  stateDir = join(TESTBED_ROOT, 'state'),
  memoryDir = join(TESTBED_ROOT, 'memory'),
  targetsFile = join(TESTBED_ROOT, 'targets', 'inspect.targets.json'),
  specsFile = join(TESTBED_ROOT, 'targets', 'schedule.specs.json'),
  pollIntervalMs = 1_000,
  queryTimeoutMs = 120_000,
  log = () => {},
  onEvent = () => {},
} = {}) {
  // Hot layer: re-read on every boot, never compiled in.
  const targets = JSON.parse(readFileSync(targetsFile, 'utf8'));
  const specs = JSON.parse(readFileSync(specsFile, 'utf8')).specs;

  const store = fileLedgerStore(join(stateDir, 'ledger.json'));
  const ledger = new TaskLedger({
    store,
    retry: { maxAttempts: 3, baseDelayMs: 5_000, factor: 2, maxDelayMs: 20_000 },
  });
  const memory = openMemory(memoryDir);
  const inspectorIds = Object.keys(INSPECTORS);

  const executor = async (session, { signal }) => {
    const intent = session.intent;
    if (intent === 'tick') {
      // Self-target used by soak drills: proves the ledger plumbing without
      // touching the network.
      return { outcome: 'ok', summary: `tick at ${new Date().toISOString()}` };
    }
    if (intent === 'tick-slow') {
      // Drill target that stays in flight long enough for a kill -9 to land
      // mid-attempt (the crash-sweep rehearsal needs real orphans).
      await new Promise((r) => setTimeout(r, 1_500));
      return { outcome: 'ok', summary: `slow tick at ${new Date().toISOString()}` };
    }
    if (intent === 'dream') {
      // Serialize behind today's inspectors (driver claims everything due at
      // once; merging half-written days would be noise): wait bounded for
      // open inspect sessions to settle, then merge.
      const deadline = Date.now() + 240_000;
      for (;;) {
        const open = (await ledger.listSessions({ states: ['pending', 'running', 'retrying'] }))
          .filter((s) => s.intent.startsWith('inspect:') && s.id !== session.id);
        if (open.length === 0 || Date.now() > deadline || signal.aborted) break;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      const summary = await dream(memory, { date: utcDate(Date.now()), inspectorIds });
      return { outcome: 'ok', summary };
    }
    if (intent.startsWith('inspect:')) {
      const id = intent.slice('inspect:'.length);
      const inspect = INSPECTORS[id];
      if (inspect === undefined) return { outcome: 'error', error: `unknown inspector '${id}'` };
      const result = await inspect(
        { ...targets[id], repo: targets.repo },
        { repoRoot: REPO_ROOT, token: process.env.GITHUB_TOKEN, signal },
      );
      const date = utcDate(Date.now());
      await writeReport(memory, id, date, renderReport(id, date, result));
      return {
        outcome: 'ok',
        summary: `${id}: ${result.status} (${result.findings.length} findings) -> reports/${id}/${date}.md`,
      };
    }
    return { outcome: 'error', error: `unroutable intent '${intent}'` };
  };

  const scheduler = new Scheduler({
    ledger,
    specs,
    pollIntervalMs,
    onEvent: (ev) => {
      if (ev.type === 'schedule:fire') log(`fire ${ev.sessionId}`);
      else log(`schedule error: ${ev.error}`);
      onEvent(ev);
    },
  });
  const driver = new LedgerDriver({
    ledger,
    executor,
    pollIntervalMs,
    queryTimeoutMs,
    onEvent: (ev) => {
      if (ev.type === 'attempt:settle') log(`attempt ${ev.session.attempts} ${ev.session.id}: ${ev.outcome}`);
      else if (ev.type === 'session:terminal') log(`terminal ${ev.session.id}: ${ev.session.state}`);
      else if (ev.type === 'driver:error') log(`driver error: ${ev.error}`);
      onEvent(ev);
    },
  });

  return { store, ledger, scheduler, driver, stateDir, memory, inspectorIds };
}

/**
 * Day-zero schedule priming. The Scheduler's recovery deliberately does no
 * epoch backfill: a spec with no ledger footprint starts at `now`. Correct
 * for a long-lived process, but a SHORT-LIVED host (daily CI run, boots
 * after the fire point, exits seconds later) then never fires AT ALL — every
 * boot re-anchors at now, the footprint never appears (gap ledger G3). Host
 * fix over public surface: when a spec has no footprint, dispatch its most
 * recent due point using the documented `sched:{specId}:{fireAt}` id format,
 * which both runs today's patrol and seeds recovery for every later boot.
 * Self-healing: a spec newly added to the hot layer gets primed the same way.
 */
export async function primeSchedules(ledger, specs, log = () => {}, now = Date.now()) {
  const sessions = await ledger.listSessions();
  const primed = [];
  for (const spec of specs) {
    if (sessions.some((s) => s.id.startsWith(`sched:${spec.id}:`))) continue;
    const lookbackMs = Math.max(25 * 3_600_000, (spec.every ?? 0) * 2);
    const due = firesBetween(spec, now - lookbackMs, now);
    const fireAt = due[due.length - 1];
    if (fireAt === undefined) continue;
    const sessionId = `sched:${spec.id}:${fireAt}`;
    try {
      await ledger.dispatch({
        id: sessionId,
        intent: spec.intent,
        payload: { schedule: { specId: spec.id, fireAt }, data: spec.payload },
        ...(spec.maxAttempts !== undefined ? { maxAttempts: spec.maxAttempts } : {}),
      });
      primed.push(sessionId);
      log(`primed ${sessionId}`);
    } catch (err) {
      if (!(err instanceof DuplicateSessionError)) throw err;
    }
  }
  return primed;
}

/** Boot-time crash sweep (see header). Returns the swept session ids. */
export async function crashSweep(ledger, log = () => {}) {
  const orphans = await ledger.listSessions({ states: ['running'] });
  const now = Date.now();
  for (const s of orphans) {
    await ledger.recordOutcome(s.id, {
      outcome: 'error',
      error: 'crash-sweep: driver died mid-attempt (kill -9 / power loss)',
      startedAt: s.updatedAt,
      endedAt: now,
    });
    log(`crash-sweep ${s.id} (attempt ${s.attempts}) -> retry path`);
  }
  return orphans.map((s) => s.id);
}

/** Wait until nothing is open (all sessions terminal), bounded. */
export async function drain(ledger, { timeoutMs = 300_000, quietMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = null;
  for (;;) {
    const open = await ledger.listSessions({ states: ['pending', 'running', 'retrying'] });
    if (open.length === 0) {
      if (quietSince === null) quietSince = Date.now();
      // Hold the quiet period: the scheduler may still be firing this tick.
      if (Date.now() - quietSince >= quietMs) return true;
    } else {
      quietSince = null;
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  const once = process.argv.includes('--once');
  // Env overrides let the soak drill spawn THIS binary against a drill
  // sandbox (own state dir + dense tick specs) — the drill kills the real
  // daemon, not a simulation of it.
  const stateDir = process.env.TESTBED_STATE_DIR ?? join(TESTBED_ROOT, 'state');
  mkdirSync(stateDir, { recursive: true });
  const logFile = join(stateDir, 'daemon.log');
  const log = (line) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    appendFileSync(logFile, stamped + '\n');
  };

  const host = buildHost({
    stateDir,
    log,
    ...(process.env.TESTBED_SPECS_FILE ? { specsFile: process.env.TESTBED_SPECS_FILE } : {}),
    ...(process.env.TESTBED_TARGETS_FILE ? { targetsFile: process.env.TESTBED_TARGETS_FILE } : {}),
    ...(process.env.TESTBED_MEMORY_DIR ? { memoryDir: process.env.TESTBED_MEMORY_DIR } : {}),
    ...(process.env.TESTBED_POLL_MS ? { pollIntervalMs: Number(process.env.TESTBED_POLL_MS) } : {}),
  });
  const swept = await crashSweep(host.ledger, log);
  if (swept.length > 0) log(`crash sweep settled ${swept.length} orphaned running session(s)`);
  const specs = JSON.parse(
    readFileSync(process.env.TESTBED_SPECS_FILE ?? join(TESTBED_ROOT, 'targets', 'schedule.specs.json'), 'utf8'),
  ).specs;
  await primeSchedules(host.ledger, specs, log);

  host.scheduler.start();
  host.driver.start();
  log(`daemon up pid=${process.pid} mode=${once ? 'once' : 'soak'}`);

  if (once) {
    // Let the scheduler recover + fire (a couple of ticks), stop it so the
    // due set is closed, then drain the driver over that closed set.
    await new Promise((r) => setTimeout(r, 3_000));
    await host.scheduler.stop();
    const drained = await drain(host.ledger);
    await host.driver.stop();
    const failed = (await host.ledger.listSessions({ states: ['failed'] }))
      .filter((s) => s.updatedAt >= Date.now() - 3_600_000);
    log(`once-run complete drained=${drained} recentFailed=${failed.length}`);
    for (const s of failed) log(`  failed: ${s.id} — ${s.lastError}`);
    process.exit(drained && failed.length === 0 ? 0 : 1);
  }

  // Soak mode: pid file + heartbeat until signalled.
  const pidFile = join(stateDir, 'daemon.pid');
  writeFileSync(pidFile, String(process.pid) + '\n');
  const heartbeat = setInterval(() => {
    appendFileSync(
      join(stateDir, 'heartbeat.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid }) + '\n',
    );
  }, 30_000);
  heartbeat.unref?.();

  const shutdown = async (sig) => {
    log(`${sig} received — stopping`);
    clearInterval(heartbeat);
    await host.scheduler.stop();
    await host.driver.stop();
    rmSync(pidFile, { force: true });
    log('daemon down');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('daemon fatal:', err);
    process.exit(1);
  });
}
