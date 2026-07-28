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
import { TaskLedger, LedgerDriver, isTerminal, isUnsuccessfulTerminal } from 'silver-core-maestro-sdk';

/**
 * Load the ledger file, QUARANTINING anything unreadable. An unattended daily
 * job must not be killable by one bad byte: the file is committed to git, so a
 * botched rebase-conflict resolution (the push-retry loop in the workflow can
 * stage a conflicted file) or a process killed mid-write leaves JSON that
 * throws here — before a single target is patrolled — and then EVERY future
 * run dies the same way. Move the bad file aside (evidence survives, it is
 * committed next to the good one) and start from an empty ledger; the day's
 * sessions simply re-dispatch and the archive itself is untouched.
 */
function loadLedgerState(filePath) {
  if (!existsSync(filePath)) return { sessions: {}, queries: [] };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.sessions !== 'object' ||
      parsed.sessions === null ||
      !Array.isArray(parsed.queries)
    ) {
      throw new Error('ledger file is not a { sessions, queries } object');
    }
    return parsed;
  } catch {
    renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    return { sessions: {}, queries: [] };
  }
}

/**
 * Host storage battery: the SDK's LedgerStore contract over one JSON file
 * (write-through with atomic rename). A production host would inject a DB;
 * a patrol job needs exactly this much.
 */
export function fileLedgerStore(filePath) {
  const state = loadLedgerState(filePath);
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
    // Optional retention seam (0.78.0): the ledger is append-only without it,
    // and a daily patrol accretes two sessions plus two query rows per day
    // forever. Deleting the session MUST take its query rows with it, or the
    // orphans defeat the purpose. Reached only through
    // TaskLedger.purgeSession, which holds the session mutex and refuses
    // non-terminal rows.
    async deleteSession(id) {
      if (state.sessions[id] === undefined) return false;
      delete state.sessions[id];
      state.queries = state.queries.filter((q) => q.sessionId !== id);
      save();
      return true;
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

const USER_AGENT = 'biav-store-patrol/1.0 (+https://github.com/lightproud/BIAV-SC-CODE)';

/** Snapshot write, same atomic discipline as the ledger file: a plain
 *  writeFileSync truncates first, so a process killed between truncate and
 *  flush leaves a half-file — and the workflow commits the archive even when
 *  the patrol step failed (continue-on-error), so that half-file reaches main. */
function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

/** Previous signature, or null when there is no USABLE baseline. Corrupt
 *  latest.json must not wedge the target: unguarded, the parse throws inside
 *  every attempt of every future run, so that storefront is never snapshotted
 *  again and the job goes red daily until a human notices. Treating it as "no
 *  baseline" self-heals — one honest `from: null` change entry, file rewritten. */
function readLatestSnapshot(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

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

  // Orphan sweep: a previous run that crashed mid-attempt leaves its session
  // wedged in 'running' — the id is taken, the state is not terminal, and
  // claimDue never re-claims it (it only lists pending/retrying), so that
  // day's patrol would hang until drain timeout on every rerun. Close the
  // interrupted attempt out as an error so the session re-enters the normal
  // retry/failed path; the :rN retry logic below then applies unchanged.
  const orphans = await ledger.listSessions({ states: ['running'] });
  for (const orphan of orphans) {
    const now = Date.now();
    await ledger.recordOutcome(orphan.id, {
      outcome: 'error',
      error: 'orphaned by previous run',
      startedAt: now,
      endedAt: now,
    });
    log(`recovered orphan ${orphan.id} (was running)`);
  }

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
    const prev = readLatestSnapshot(latestPath);
    const changed = prev === null || JSON.stringify(prev.signature) !== JSON.stringify(signature);
    const snapshot = {
      target: target.id,
      title: target.title ?? target.id,
      url: target.url,
      checked_at: new Date().toISOString(),
      signature,
    };
    writeJsonAtomic(join(dir, `${today}.json`), snapshot);
    if (changed) {
      writeJsonAtomic(latestPath, snapshot);
      appendFileSync(
        join(dir, 'changes.jsonl'),
        JSON.stringify({ at: snapshot.checked_at, target: target.id, from: prev?.signature ?? null, to: signature }) + '\n',
      );
      changes.push({ target: target.id, from: prev?.signature ?? null, to: signature });
    }
    return { outcome: 'ok', summary: changed ? `${target.id}: CHANGED` : `${target.id}: unchanged` };
  };

  // Idempotent daily dispatch: one session per target per day. If an earlier
  // run today already FAILED terminally, reopen it.
  //
  // This used to be a hand-rolled loop that minted `:r2`, `:r3` ids of its own
  // (design review F5: the closed state machine has no reopen edge, so every
  // host invented a convention, and one logical job ended up scattered across
  // rows nothing tied together). 0.79.0's `reopenSession` owns the convention:
  // it mints the successor id, stamps `reopenOf` + `attemptRound`, and refuses
  // to reopen anything non-terminal. `reopenChain()` reassembles the day's
  // attempts without parsing id prefixes.
  const sessionIds = [];
  for (const target of targets) {
    const baseId = `patrol:${target.id}:${today}`;
    let id = baseId;
    let existing = await ledger.getSession(id);
    if (existing === null) {
      await ledger.dispatch({ id, intent: `store-patrol ${target.id} ${today}`, payload: { target } });
      log(`dispatched ${id}`);
    } else {
      // Walk to the newest link in today's chain, then reopen it if it failed.
      const chain = await ledger.reopenChain(baseId);
      const newest = chain[chain.length - 1] ?? existing;
      if (newest.state === 'failed') {
        // Pass the CURRENT target explicitly. reopenSession inherits the
        // predecessor's payload by default ("run that again"), which is the
        // wrong default here: the registry may have been edited between runs,
        // and inheriting would rerun the old endpoint. The e2e caught exactly
        // this — the retry re-hit the hung URL it was supposed to be moving off.
        const reopened = await ledger.reopenSession(newest.id, { payload: { target } });
        id = reopened.id;
        log(`reopened ${newest.id} -> ${id} (round ${reopened.attemptRound})`);
      } else {
        id = newest.id;
        log(`skipping ${id} (already ${newest.state})`);
      }
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
    // Terminal test through the SDK's vocabulary, never a literal pair: the
    // state set grew a third terminal (`cancelled`) and a hand-spelled
    // `done || failed` reads it as still in flight — the patrol would then
    // burn the whole drain timeout and throw, failing the healthy targets too.
    if (sessions.every((s) => s !== null && isTerminal(s.state))) break;
    if (Date.now() > deadline) {
      await driver.stop();
      throw new Error('store-patrol: drain timeout — sessions still open');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await driver.stop();

  const sessions = await Promise.all(sessionIds.map((id) => ledger.getSession(id)));
  // Every unsuccessful terminal counts, not just `failed`: a target that ended
  // `cancelled` was NOT patrolled, and reporting "all targets patrolled" with
  // exit 0 would be a false clean bill of health.
  const failures = sessions.filter((s) => isUnsuccessfulTerminal(s.state));
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
