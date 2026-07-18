/**
 * Store patrol (campaign 2, SCS-REQ orchestrator-sdk §8 "new-scenario
 * first-flight"): the first REAL recurring task grown directly on the task
 * ledger + driver. It patrols the Morimens storefront surfaces (Steam
 * appdetails + review summary), fingerprints each into a stable signature,
 * archives daily snapshots and appends a change log when the store state
 * moves — price changes, review-score shifts, release-surface edits.
 *
 * Host-shape proof, same rules as example 1:
 * - imports ONLY the maestro SDK's public surface (the agent SDK is not
 *   needed here — the executor is plain HTTP; the ledger/driver are
 *   agent-agnostic by design, hard property §1.1: parts can be taken alone);
 * - the storage battery is HOST code: fileLedgerStore below persists the
 *   ledger to one JSON file, so patrol history and scheduling survive
 *   restarts (the §4 seam doing real cross-restart work);
 * - the driver holds the clock: per-attempt timeout aborts a hung fetch via
 *   the executor's AbortSignal, failures retry with backoff, exhaustion
 *   lands in `failed` and flips the process exit code for CI visibility.
 *
 * Run (from the repo root, after npm ci + workspace builds):
 *   RUN_STORE_PATROL=1 node projects/silver-core-maestro-sdk/examples/store-patrol.mjs
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskLedger, LedgerDriver } from 'silver-core-maestro-sdk';

/**
 * Host storage battery: the SDK's LedgerStore contract over one JSON file
 * (write-through with atomic rename). A production host would inject a DB;
 * a patrol job needs exactly this much.
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

/**
 * Signature extractors: reduce a storefront response to the STABLE fields
 * whose movement means "the store changed" (volatile/request-scoped fields
 * excluded, so unchanged stores hash identically day after day).
 */
export const extractors = {
  'steam-appdetails': (body, target) => {
    const entry = JSON.parse(body)?.[target.key ?? ''];
    if (entry?.success !== true || entry.data === undefined) {
      throw new Error('steam-appdetails: no data for app ' + (target.key ?? '(missing key)'));
    }
    const d = entry.data;
    return {
      name: d.name ?? null,
      type: d.type ?? null,
      is_free: d.is_free ?? null,
      price: d.price_overview
        ? {
            currency: d.price_overview.currency ?? null,
            initial: d.price_overview.initial ?? null,
            final: d.price_overview.final ?? null,
            discount_percent: d.price_overview.discount_percent ?? null,
          }
        : null,
      release_date: d.release_date?.date ?? null,
      coming_soon: d.release_date?.coming_soon ?? null,
    };
  },
  'steam-review-summary': (body) => {
    const s = JSON.parse(body)?.query_summary;
    if (s === undefined) throw new Error('steam-review-summary: no query_summary');
    // num_reviews is request-scoped (page size), never part of the signature.
    return {
      review_score: s.review_score ?? null,
      review_score_desc: s.review_score_desc ?? null,
      total_positive: s.total_positive ?? null,
      total_negative: s.total_negative ?? null,
      total_reviews: s.total_reviews ?? null,
    };
  },
};

const USER_AGENT = 'biav-store-patrol/1.0 (+https://github.com/lightproud/brain-in-a-vat)';

/**
 * One patrol run: dispatch one ledger session per target (idempotent per
 * target × day; a failed earlier run gets a fresh :rN retry session), let the
 * driver execute them with timeout + backoff, archive snapshots/changes, and
 * report. Returns { sessions, failures, changes }.
 */
export async function runStorePatrol(opts) {
  const targets = opts.targets;
  const archiveDir = opts.archiveDir;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (() => {});

  const store = fileLedgerStore(join(archiveDir, 'state', 'ledger.json'));
  const ledger = new TaskLedger({
    store,
    retry: {
      maxAttempts: opts.maxAttempts ?? 3,
      baseDelayMs: opts.retryBaseMs ?? 2_000,
      factor: 2,
      maxDelayMs: 30_000,
    },
  });

  const changes = [];
  const executor = async (session, { signal }) => {
    const target = session.payload.target;
    const res = await fetchImpl(target.url, { headers: { 'user-agent': USER_AGENT }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${target.id}`);
    const body = await res.text();
    const extract = extractors[target.extract];
    if (extract === undefined) throw new Error(`no extractor '${target.extract}' for ${target.id}`);
    const signature = extract(body, target);

    const dir = join(archiveDir, target.id);
    mkdirSync(dir, { recursive: true });
    const latestPath = join(dir, 'latest.json');
    const prev = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, 'utf8')) : null;
    const changed = prev === null || JSON.stringify(prev.signature) !== JSON.stringify(signature);
    const snapshot = {
      target: target.id,
      title: target.title ?? target.id,
      url: target.url,
      checked_at: new Date().toISOString(),
      signature,
    };
    writeFileSync(join(dir, `${today}.json`), JSON.stringify(snapshot, null, 2) + '\n');
    if (changed) {
      writeFileSync(latestPath, JSON.stringify(snapshot, null, 2) + '\n');
      appendFileSync(
        join(dir, 'changes.jsonl'),
        JSON.stringify({ at: snapshot.checked_at, target: target.id, from: prev?.signature ?? null, to: signature }) + '\n',
      );
      changes.push({ target: target.id, from: prev?.signature ?? null, to: signature });
    }
    return { outcome: 'ok', summary: changed ? `${target.id}: CHANGED` : `${target.id}: unchanged` };
  };

  // Idempotent daily dispatch: one session per target per day; if an earlier
  // run today already FAILED terminally, open a fresh :rN retry session.
  const sessionIds = [];
  for (const target of targets) {
    const baseId = `patrol:${target.id}:${today}`;
    let id = baseId;
    let n = 1;
    let existing = await ledger.getSession(id);
    while (existing !== null && existing.state === 'failed') {
      id = `${baseId}:r${(n += 1)}`;
      existing = await ledger.getSession(id);
    }
    if (existing === null) {
      await ledger.dispatch({ id, intent: `store-patrol ${target.id} ${today}`, payload: { target } });
      log(`dispatched ${id}`);
    } else {
      log(`skipping ${id} (already ${existing.state})`);
    }
    sessionIds.push(id);
  }

  const driver = new LedgerDriver({
    ledger,
    executor,
    pollIntervalMs: opts.pollIntervalMs ?? 300,
    queryTimeoutMs: opts.queryTimeoutMs ?? 30_000,
    onEvent: (ev) => {
      if (ev.type === 'attempt:settle') log(`attempt ${ev.session.attempts} ${ev.session.id}: ${ev.outcome}`);
      opts.onEvent?.(ev);
    },
  });
  driver.start();

  const deadline = Date.now() + (opts.drainTimeoutMs ?? 120_000);
  for (;;) {
    const sessions = await Promise.all(sessionIds.map((id) => ledger.getSession(id)));
    if (sessions.every((s) => s !== null && (s.state === 'done' || s.state === 'failed'))) break;
    if (Date.now() > deadline) {
      await driver.stop();
      throw new Error('store-patrol: drain timeout — sessions still open');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await driver.stop();

  const sessions = await Promise.all(sessionIds.map((id) => ledger.getSession(id)));
  const failures = sessions.filter((s) => s.state === 'failed');
  return { sessions, failures, changes };
}

// Manual/CI entry (gated so importing this module never runs the patrol):
//   RUN_STORE_PATROL=1 node projects/silver-core-maestro-sdk/examples/store-patrol.mjs
if (process.env.RUN_STORE_PATROL === '1') {
  const here = dirname(fileURLToPath(import.meta.url));
  const config = JSON.parse(readFileSync(join(here, 'store-patrol.targets.json'), 'utf8'));
  const archiveDir = resolve(here, '..', '..', '..', 'Public-Info-Pool', 'Record', 'store-patrol');
  runStorePatrol({
    targets: config.targets,
    archiveDir,
    log: (line) => console.log('[store-patrol]', line),
  }).then(({ sessions, failures, changes }) => {
    for (const s of sessions) console.log(`[store-patrol] ${s.id}: ${s.state} (attempts ${s.attempts})`);
    for (const c of changes) console.log(`[store-patrol] CHANGE ${c.target}:`, JSON.stringify(c.to));
    if (failures.length > 0) {
      console.error(`[store-patrol] ${failures.length} target(s) failed`);
      process.exit(1);
    }
    console.log(`[store-patrol] all ${sessions.length} targets patrolled, ${changes.length} change(s)`);
  }, (err) => {
    console.error('[store-patrol] fatal:', err);
    process.exit(1);
  });
}
