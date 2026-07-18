/**
 * Memory tidy loop (example 4, "综合整理任务" — keeper todo 2026-07-18 item 4):
 * the consolidation ("dream") routine the black pool schedules over its
 * memory store, end to end on the TWO packages' public surfaces only.
 *
 * Shape: scheduled dispatch -> read the health surface -> merge fragments
 * into a digest card -> delete the merged fragments -> ledger closeout.
 *
 * Host-shape proof, same rules as examples 1-3:
 * - imports ONLY the two package names (silver-core-maestro-sdk for the
 *   clock/ledger machinery, silver-core-agent-sdk for the memory store +
 *   health assessment) + node builtins;
 * - the storage battery is HOST code (fileLedgerStore, one JSON file);
 * - the Scheduler only DISPATCHES tidy sessions; the LedgerDriver executes
 *   them; every run is one auditable ledger session (台账收口).
 *
 * The executor here is deterministic (pure store surgery) so the example is
 * runnable keyless; the black pool puts an agent `query()` in the same
 * executor seat to have a model write the digest instead.
 *
 * Run (from the repo root, after npm ci + agent-SDK build):
 *   RUN_MEMORY_TIDY=1 node projects/silver-core-maestro-sdk/examples/memory-tidy.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LedgerDriver, Scheduler, TaskLedger } from 'silver-core-maestro-sdk';
import {
  assessMemoryStoreHealth,
  createLocalMemoryFileOps,
  createMemoryStore,
} from 'silver-core-agent-sdk';

/** Host storage battery: the LedgerStore contract over one JSON file (same
 *  shape as examples/schedule-loop.mjs / store-patrol.mjs). */
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

const FRAGMENTS_DIR = '/memories/fragments';
const DIGEST_PATH = '/memories/cards/digest.md';

/**
 * One tidy pass over the store (the executor body — the part the black pool
 * replaces with an agent query). Reads the health surface first; only when
 * it flags something (fragments present / waterline warning / broken
 * supersede link) does it touch the store. Returns a facts summary for the
 * ledger closeout.
 */
export async function tidyOnce({ ops, store, softWaterline, staleAfterDays }) {
  const health = await assessMemoryStoreHealth(ops, {
    ...(softWaterline !== undefined ? { softWaterline } : {}),
    ...(staleAfterDays !== undefined ? { staleAfterDays } : {}),
  });
  const fragments = health.waterlines.find((w) => w.path === FRAGMENTS_DIR);
  const fragmentCount = fragments?.files ?? 0;
  const flagged =
    fragmentCount > 0 || health.warnDirectories.length > 0 || !health.supersede.intact;
  if (!flagged) {
    return { health, merged: 0, summary: 'memory healthy — nothing to tidy' };
  }

  // 归并写卡: fold every fragment file into one digest card file.
  const names = [];
  if (fragmentCount > 0) {
    const listing = await store.view(FRAGMENTS_DIR);
    for (const line of listing.split('\n').slice(1)) {
      const m = /\t(\/memories\/fragments\/[^/]+)$/.exec(line);
      if (m !== null) names.push(m[1]);
    }
  }
  const sections = [];
  for (const path of names) {
    const viewed = await store.view(path);
    const body = viewed
      .split('\n')
      .slice(1)
      .map((l) => l.replace(/^\s*\d+\t/, ''))
      .join('\n');
    sections.push(`## ${path.slice(FRAGMENTS_DIR.length + 1)}\n\n${body}`);
  }
  if (sections.length > 0) {
    const digest = `# Memory digest\n\n${sections.join('\n\n')}\n`;
    await store.create(DIGEST_PATH, digest);
  }

  // 删碎片: the merged fragments go away — consolidation, not duplication.
  for (const path of names) await store.delete(path);

  return {
    health,
    merged: names.length,
    summary:
      `merged ${names.length} fragment(s) into ${DIGEST_PATH}; ` +
      `waterline warnings: ${health.warnDirectories.length}; ` +
      `broken supersede links: ${health.supersede.broken.length}`,
  };
}

/**
 * The demo. opts (all injectable for the e2e test):
 * - memoriesDir (required): REAL directory backing the /memories tree
 * - archiveDir (required): sandbox dir; the ledger file lives at state/ledger.json
 * - everyMs (default 500), pollIntervalMs (default 25)
 * - softWaterline / staleAfterDays: forwarded to the health assessment
 * - deadlineMs (default 15000), log (default no-op)
 * Runs until ONE tidy session settles, then stops both live components.
 * Returns { sessionId, session, result, digestOnDisk }.
 */
export async function runMemoryTidy(opts) {
  const { memoriesDir, archiveDir } = opts;
  const everyMs = opts.everyMs ?? 500;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const deadlineMs = opts.deadlineMs ?? 15_000;
  const log = opts.log ?? (() => {});

  const ops = createLocalMemoryFileOps(memoriesDir);
  const store = createMemoryStore(ops, { createOverwrite: true });
  const ledger = new TaskLedger({ store: fileLedgerStore(join(archiveDir, 'state', 'ledger.json')) });

  const tidyResults = new Map();
  const fired = [];
  const scheduler = new Scheduler({
    ledger,
    specs: [
      {
        id: 'memory-tidy',
        intent: 'consolidate memory fragments',
        every: everyMs,
        catchUp: 'latest',
      },
    ],
    pollIntervalMs,
    onEvent: (ev) => {
      if (ev.type === 'schedule:fire') {
        fired.push(ev.sessionId);
        log(`fire ${ev.sessionId}`);
      }
    },
  });
  const driver = new LedgerDriver({
    ledger,
    executor: async (session) => {
      const tidy = await tidyOnce({
        ops,
        store,
        softWaterline: opts.softWaterline,
        staleAfterDays: opts.staleAfterDays,
      });
      tidyResults.set(session.id, tidy);
      log(tidy.summary);
      return { outcome: 'ok', summary: tidy.summary };
    },
    pollIntervalMs,
  });

  scheduler.start();
  driver.start();
  const deadline = Date.now() + deadlineMs;
  const bail = async (reason) => {
    await scheduler.stop();
    await driver.stop();
    throw new Error(`memory-tidy: ${reason}`);
  };
  while (fired.length < 1) {
    if (Date.now() > deadline) await bail('deadline before the first tidy fire');
    await sleep(10);
  }
  // One observed cycle is the demo; stop dispatching so a fast-forwarded
  // clock (fake-timer e2e) cannot fire a second pass over the now-tidy tree.
  await scheduler.stop();
  for (;;) {
    const s = await ledger.getSession(fired[0]);
    if (s !== null && (s.state === 'done' || s.state === 'failed')) break;
    if (Date.now() > deadline) await bail('drain deadline — tidy session still open');
    await sleep(10);
  }
  await scheduler.stop();
  await driver.stop();

  const session = await ledger.getSession(fired[0]);
  return {
    sessionId: fired[0],
    session,
    result: tidyResults.get(fired[0]),
    digestOnDisk: join(memoriesDir, 'cards', 'digest.md'),
  };
}

// Manual/CI entry (gated so importing this module never runs the demo):
//   RUN_MEMORY_TIDY=1 node projects/silver-core-maestro-sdk/examples/memory-tidy.mjs
if (process.env.RUN_MEMORY_TIDY === '1') {
  const sandbox = mkdtempSync(join(tmpdir(), 'memory-tidy-'));
  const memoriesDir = join(sandbox, 'memories');
  mkdirSync(join(memoriesDir, 'fragments'), { recursive: true });
  writeFileSync(join(memoriesDir, 'fragments', 'note-a.md'), 'alpha fact\n');
  writeFileSync(join(memoriesDir, 'fragments', 'note-b.md'), 'beta fact\n');
  runMemoryTidy({
    memoriesDir,
    archiveDir: sandbox,
    log: (line) => console.log('[memory-tidy]', line),
  }).then(({ sessionId, session, result, digestOnDisk }) => {
    console.log(`[memory-tidy] ${sessionId}: ${session.state} (attempts ${session.attempts})`);
    console.log(`[memory-tidy] ${result.summary}`);
    console.log(`[memory-tidy] digest: ${digestOnDisk}`);
  }, (err) => {
    console.error('[memory-tidy] fatal:', err);
    process.exit(1);
  });
}
