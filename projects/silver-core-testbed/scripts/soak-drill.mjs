/**
 * Soak drills (施工封面 §2 第三战): REAL-CLOCK rehearsals of the two soak
 * scenarios against the REAL daemon binary — the fake-timer discipline of
 * the SDK e2e suites is deliberately inverted here (the cover sheet declares
 * real clocks non-negotiable for the soak battle; the drill runs seconds-
 * scale schedules, the 72 h soak runs the same daemon via driverctl).
 *
 *   drill 1  kill -9 recovery: hard-kill mid-flight, restart, prove the
 *            crash sweep settles orphaned `running` sessions into the retry
 *            path and the schedule keeps firing.
 *   drill 2  outage compensation: stop for a multiple of the cadence, prove
 *            catchUp 'latest' collapses the gap to one fire and catchUp
 *            'all' replays every missed point, ascending, no duplicates.
 *
 * Writes state/drills/{stamp}.json and exits non-zero on any FAIL.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskLedger } from 'silver-core-maestro-sdk';
import { fileLedgerStore } from '../src/store.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const TESTBED = resolve(HERE, '..');
const DAEMON = join(TESTBED, 'src', 'daemon.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CADENCE_MS = 2_000;

function drillSandbox(name, specList) {
  const dir = join(TESTBED, 'state', 'drill-sandbox', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const anchor = Date.now();
  const specs = {
    specs: specList ?? [
      { id: 'tick-latest', intent: 'tick', every: CADENCE_MS, anchorAt: anchor, catchUp: 'latest', maxAttempts: 2 },
      { id: 'tick-all', intent: 'tick', every: CADENCE_MS, anchorAt: anchor, catchUp: 'all', maxAttempts: 2 },
    ],
  };
  for (const s of specs.specs) s.anchorAt ??= anchor;
  const specsFile = join(dir, 'specs.json');
  writeFileSync(specsFile, JSON.stringify(specs, null, 2));
  return { dir, specsFile, anchor };
}

function startDaemon(sandbox) {
  const child = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      TESTBED_STATE_DIR: sandbox.dir,
      TESTBED_SPECS_FILE: sandbox.specsFile,
      TESTBED_MEMORY_DIR: join(sandbox.dir, 'memory'),
      TESTBED_POLL_MS: '200',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return child;
}

const openLedger = (sandbox) =>
  new TaskLedger({ store: fileLedgerStore(join(sandbox.dir, 'ledger.json')) });

const firesOf = (sessions, specId) =>
  sessions
    .filter((s) => s.id.startsWith(`sched:${specId}:`))
    .map((s) => Number(s.id.split(':')[2]))
    .sort((a, b) => a - b);

async function drillKill9() {
  // tick-slow attempts stay in flight ~1.5 s on a 1 s cadence, so a SIGKILL
  // reliably lands mid-attempt and the crash sweep gets REAL orphans to eat.
  const sandbox = drillSandbox('kill9', [
    { id: 'slow-latest', intent: 'tick-slow', every: 1_000, catchUp: 'latest', maxAttempts: 3 },
  ]);
  const checks = [];
  let child = startDaemon(sandbox);
  await sleep(5_200); // a few real fire points land; one attempt in flight
  child.kill('SIGKILL');
  await sleep(300);

  const ledger = openLedger(sandbox);
  const before = await ledger.listSessions();
  checks.push({
    name: 'fires happened before the kill',
    pass: before.length >= 2,
    detail: `${before.length} sessions at kill time`,
  });
  const orphans = before.filter((s) => s.state === 'running');
  checks.push({
    name: 'hard kill caught an attempt in flight (orphaned running session)',
    pass: orphans.length >= 1,
    detail: `${orphans.length} orphaned running session(s): ${orphans.map((s) => s.id).join(', ')}`,
  });

  child = startDaemon(sandbox);
  await sleep(5_200);
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));

  const reopened = openLedger(sandbox);
  const after = await reopened.listSessions();
  const stillRunning = after.filter((s) => s.state === 'running');
  checks.push({
    name: 'crash sweep: no session stuck in running after restart + settle',
    pass: stillRunning.length === 0,
    detail: stillRunning.map((s) => s.id).join(', ') || 'none stuck',
  });
  let sweptRows = 0;
  for (const s of after) {
    sweptRows += (await reopened.listQueries(s.id)).filter((q) =>
      q.error?.startsWith('crash-sweep:'),
    ).length;
  }
  checks.push({
    name: 'crash sweep recorded the orphan as an error attempt (retry path)',
    pass: orphans.length === 0 || sweptRows >= 1,
    detail: `${sweptRows} crash-sweep query row(s)`,
  });
  const orphanFinal = orphans.length === 0 ? null : await reopened.getSession(orphans[0].id);
  checks.push({
    name: 'the orphaned session itself reached a healthy state after restart',
    pass: orphanFinal === null || orphanFinal.state === 'done' || orphanFinal.state === 'retrying' || orphanFinal.state === 'failed',
    detail: orphanFinal === null ? 'n/a' : `${orphanFinal.id} -> ${orphanFinal.state}`,
  });
  checks.push({
    name: 'schedule kept firing after restart (new fire points)',
    pass: after.length > before.length,
    detail: `${before.length} -> ${after.length} sessions`,
  });
  const done = after.filter((s) => s.state === 'done').length;
  checks.push({
    name: 'ticks completed across the kill boundary',
    pass: done >= 3,
    detail: `${done} done sessions`,
  });
  return { drill: 'kill9-recovery', checks };
}

async function drillOutage() {
  const sandbox = drillSandbox('outage');
  const checks = [];
  let child = startDaemon(sandbox);
  await sleep(4_500);
  child.kill('SIGTERM'); // graceful stop = planned outage begins
  await new Promise((r) => child.on('exit', r));
  const atStop = await openLedger(sandbox).listSessions();

  const OUTAGE_MS = 8_000; // 4 missed fire points at 2 s cadence
  await sleep(OUTAGE_MS);

  child = startDaemon(sandbox);
  await sleep(4_000);
  child.kill('SIGTERM');
  await sleep(1_000);

  const after = await openLedger(sandbox).listSessions();
  const latestBefore = firesOf(atStop, 'tick-latest');
  const latestAfter = firesOf(after, 'tick-latest');
  const allBefore = firesOf(atStop, 'tick-all');
  const allAfter = firesOf(after, 'tick-all');

  const stopEdge = latestBefore[latestBefore.length - 1] ?? sandbox.anchor;
  const restartEdge = stopEdge + OUTAGE_MS;
  // Half-cadence upper slack: the compensated point lands ON the grid at or
  // just before the restart moment; the first regular post-restart fire is a
  // full cadence later and must stay outside this window.
  const latestGapFires = latestAfter.filter((t) => t > stopEdge && t <= restartEdge + CADENCE_MS / 2);
  checks.push({
    name: "catchUp 'latest': the outage gap collapses to exactly one compensated fire",
    pass: latestGapFires.length === 1,
    detail: `gap fires: [${latestGapFires.join(', ')}] (stop edge ${stopEdge})`,
  });

  const allStopEdge = allBefore[allBefore.length - 1] ?? sandbox.anchor;
  const gapAll = allAfter.filter((t) => t > allStopEdge && t <= allStopEdge + OUTAGE_MS + CADENCE_MS);
  const expectedAll = Math.floor((OUTAGE_MS + CADENCE_MS) / CADENCE_MS);
  checks.push({
    name: "catchUp 'all': every missed point in the gap is compensated",
    pass: gapAll.length >= expectedAll - 1 && gapAll.length <= expectedAll + 1,
    detail: `${gapAll.length} gap fires (expected ~${expectedAll}): [${gapAll.join(', ')}]`,
  });
  const ascendingNoDup = allAfter.every((t, i) => i === 0 || t > allAfter[i - 1]);
  checks.push({
    name: "catchUp 'all': fire points ascending, no duplicate sessions",
    pass: ascendingNoDup,
    detail: `${allAfter.length} total fire points`,
  });
  return { drill: 'outage-compensation', checks };
}

async function main() {
  const report = {
    at: new Date().toISOString(),
    clock: 'real (seconds-scale cadence; no fake timers — soak-battle discipline)',
    drills: [await drillKill9(), await drillOutage()],
  };
  const failed = report.drills.flatMap((d) => d.checks.filter((c) => !c.pass));
  report.verdict = failed.length === 0 ? 'PASS' : `FAIL (${failed.length} checks)`;

  const outDir = join(TESTBED, 'state', 'drills');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = join(outDir, `${stamp}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');

  for (const d of report.drills) {
    console.log(`\n[${d.drill}]`);
    for (const c of d.checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'} ${c.name} — ${c.detail}`);
  }
  console.log(`\nverdict: ${report.verdict}\nreport: ${outFile}`);
  rmSync(join(TESTBED, 'state', 'drill-sandbox'), { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('drill fatal:', err);
  process.exit(1);
});
