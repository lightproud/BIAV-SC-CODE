/**
 * Effect baseline export (施工封面 §2 第四战): the task ledger IS the
 * evaluation data source — no separate stats plumbing. Reads the production
 * ledger through the public TaskLedger query surface and derives:
 *
 *   - completion rate per task class (done / terminal),
 *   - mid-flight stalls (熄火): error/timeout attempt rows, split out by
 *     crash sweeps (hard-kill forensics),
 *   - schedule fidelity: expected fire points (firesBetween over the hot
 *     specs) vs fire sessions actually on the ledger,
 *   - per-task token cost: honestly null — the current inspectors are
 *     deterministic executors with zero model consumption; the field is the
 *     slot the endpoint-swap comparison experiments will fill.
 *
 * Format keeps evals-baseline.json's style: a self-describing note + a
 * small metrics object, regenerated only by rerunning this exporter.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskLedger, firesBetween } from 'silver-core-maestro-sdk';
import { fileLedgerStore } from './store.mjs';
import { TESTBED_ROOT } from './daemon.mjs';

const classOf = (intent) => (intent.startsWith('inspect:') ? intent : intent.split(' ')[0]);

export async function exportBaseline({
  stateDir = join(TESTBED_ROOT, 'state'),
  specsFile = join(TESTBED_ROOT, 'targets', 'schedule.specs.json'),
  outFile = join(TESTBED_ROOT, 'testbed-baseline.json'),
  now = Date.now(),
} = {}) {
  const ledger = new TaskLedger({ store: fileLedgerStore(join(stateDir, 'ledger.json')) });
  const sessions = await ledger.listSessions();
  if (sessions.length === 0) throw new Error('baseline: the ledger is empty — nothing to export');

  const windowStart = Math.min(...sessions.map((s) => s.createdAt));
  const windowEnd = Math.max(...sessions.map((s) => s.updatedAt));

  const byClass = {};
  let stalls = 0;
  let crashSweeps = 0;
  let attemptRows = 0;
  for (const s of sessions) {
    const cls = (byClass[classOf(s.intent)] ??= {
      sessions: 0, done: 0, failed: 0, open: 0, attempts: 0, stalls: 0,
    });
    cls.sessions += 1;
    cls.attempts += s.attempts;
    if (s.state === 'done') cls.done += 1;
    else if (s.state === 'failed') cls.failed += 1;
    else cls.open += 1;
    for (const q of await ledger.listQueries(s.id)) {
      attemptRows += 1;
      if (q.outcome !== 'ok') {
        stalls += 1;
        cls.stalls += 1;
        if (q.error?.startsWith('crash-sweep:')) crashSweeps += 1;
      }
    }
  }
  for (const cls of Object.values(byClass)) {
    const terminal = cls.done + cls.failed;
    cls.completionRate = terminal === 0 ? null : +(cls.done / terminal).toFixed(4);
  }

  // Schedule fidelity: expected vs present fire sessions per spec. With
  // catchUp 'latest' on a daily-CI cadence, collapsed backlogs are the
  // DESIGNED behavior — both raw numbers are reported, judged per policy.
  const specs = JSON.parse(readFileSync(specsFile, 'utf8')).specs;
  const schedule = {};
  for (const spec of specs) {
    const present = sessions
      .filter((s) => s.id.startsWith(`sched:${spec.id}:`))
      .map((s) => Number(s.id.split(':')[2]))
      .sort((a, b) => a - b);
    if (present.length === 0) {
      schedule[spec.id] = { fires: 0, note: 'no fire sessions on the ledger yet' };
      continue;
    }
    const expected = firesBetween(spec, present[0] - 1, windowEnd, 10_000);
    const missed = expected.filter((t) => !present.includes(t));
    schedule[spec.id] = {
      catchUp: spec.catchUp ?? 'latest',
      fires: present.length,
      expectedPoints: expected.length,
      uncoveredPoints: missed.length,
      note:
        (spec.catchUp ?? 'latest') === 'latest'
          ? 'uncovered points under catchUp latest = designed backlog collapse, not loss'
          : 'uncovered points under catchUp all = real missed fires',
    };
  }

  const terminalAll = sessions.filter((s) => s.state === 'done' || s.state === 'failed');
  const baseline = {
    note:
      'silver-core-testbed effect baseline — derived ENTIRELY from the task ledger ' +
      '(施工封面 §0.3: the ledger is the evaluation data source). Regenerate with ' +
      '`npm run baseline -w silver-core-testbed`; comparison experiments (endpoint/model ' +
      'swaps) rerun the same patrols and diff this file.',
    exportedAt: new Date(now).toISOString(),
    window: { from: new Date(windowStart).toISOString(), to: new Date(windowEnd).toISOString() },
    totals: {
      sessions: sessions.length,
      terminal: terminalAll.length,
      done: terminalAll.filter((s) => s.state === 'done').length,
      failed: terminalAll.filter((s) => s.state === 'failed').length,
      completionRate:
        terminalAll.length === 0
          ? null
          : +(terminalAll.filter((s) => s.state === 'done').length / terminalAll.length).toFixed(4),
      attemptRows,
      stalls,
      crashSweepStalls: crashSweeps,
      meanAttemptsPerTerminalSession:
        terminalAll.length === 0
          ? null
          : +(terminalAll.reduce((a, s) => a + s.attempts, 0) / terminalAll.length).toFixed(3),
    },
    perClass: byClass,
    schedule,
    tokensPerTask: null,
    tokensNote:
      'honestly null: the four inspectors and the dream merge are deterministic executors ' +
      '(zero model calls, no API key in the unattended cron). This slot is where the ' +
      'three-configuration endpoint experiments (黑池侧 todo §7) will land their numbers.',
  };
  writeFileSync(outFile, JSON.stringify(baseline, null, 2) + '\n');
  return { outFile, baseline };
}

if (process.argv[1] && process.argv[1].endsWith('baseline.mjs')) {
  exportBaseline()
    .then(({ outFile, baseline }) => {
      console.log(`baseline written: ${outFile}`);
      console.log(
        `sessions=${baseline.totals.sessions} done=${baseline.totals.done} ` +
          `failed=${baseline.totals.failed} completionRate=${baseline.totals.completionRate} ` +
          `stalls=${baseline.totals.stalls}`,
      );
    })
    .catch((err) => {
      console.error('baseline export failed:', err.message);
      process.exit(1);
    });
}
