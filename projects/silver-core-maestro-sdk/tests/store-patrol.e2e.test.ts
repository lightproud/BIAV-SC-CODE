/**
 * Campaign 2 acceptance: the store patrol — a real recurring task grown on
 * the ledger + driver — runs end to end against a local fake storefront:
 * baseline snapshot, change detection across days, HTTP-failure retry into
 * done, hung-endpoint timeout into failed, and ledger persistence across
 * runs through the host's file store. FAKE timers throughout (clock
 * discipline audit 2026-07-18): the test drives time, real HTTP I/O flows
 * between advances.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS example module, no type declarations by design
import { runStorePatrol } from '../examples/store-patrol.mjs';

/** Drive fake time until the run settles (clock discipline audit 2026-07-18:
 *  no real clock — the test advances time; real HTTP I/O still flows because
 *  every advance yields to the event loop). Bounded — a hang fails the test. */
async function drive<T>(run: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = run.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  for (let i = 0; i < 4000 && !settled; i += 1) {
    await vi.advanceTimersByTimeAsync(25);
  }
  expect(settled, 'run did not settle within the driven fake-time budget').toBe(true);
  return tracked;
}

let server: http.Server;
let baseUrl: string;
let sandbox: string;

// Mutable fake storefront state (the "Steam" the patrol sees). Built fresh
// per test (audit H3): tests mutate it (the "moved store" day-2 scenario), so
// a shared instance order-couples the suite. The factory returns a brand-new
// object graph — a FULL deep reset, not a field patch.
const freshStorefront = () => ({
  appdetails: {
    '77': { success: true, data: { name: 'Morimens', type: 'game', is_free: true, release_date: { date: '1 Nov, 2025', coming_soon: false } } },
  },
  reviews: { query_summary: { num_reviews: 0, review_score: 8, review_score_desc: 'Very Positive', total_positive: 100, total_negative: 10, total_reviews: 110 } },
  flakyRemaining: 0,
  hangRequests: [] as http.ServerResponse[],
});
let storefront = freshStorefront();

beforeEach(async () => {
  vi.useFakeTimers();
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'store-patrol-'));
  storefront = freshStorefront();
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/appdetails')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(storefront.appdetails));
    } else if (url.startsWith('/reviews')) {
      if (storefront.flakyRemaining > 0) {
        storefront.flakyRemaining -= 1;
        res.writeHead(500);
        res.end('storefront hiccup');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: 1, query_summary: storefront.reviews.query_summary }));
    } else if (url.startsWith('/hang')) {
      storefront.hangRequests.push(res); // never answered
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
      resolve();
    });
  });
});
afterEach(async () => {
  vi.useRealTimers();
  for (const res of storefront.hangRequests) res.destroy();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const targetsFor = (base: string) => [
  { id: 'steam-appdetails', url: `${base}/appdetails`, extract: 'steam-appdetails', key: '77' },
  { id: 'steam-review-summary', url: `${base}/reviews`, extract: 'steam-review-summary' },
];

const fastOpts = { pollIntervalMs: 20, retryBaseMs: 30, queryTimeoutMs: 400, drainTimeoutMs: 10_000 };

describe('store patrol on the ledger + driver (real HTTP, fake storefront)', () => {
  it('baseline day: snapshots + change log seeded, sessions done, ledger persisted', async () => {
    const result = await drive(runStorePatrol({
      targets: targetsFor(baseUrl),
      archiveDir: sandbox,
      today: '2026-07-18',
      ...fastOpts,
    }));
    expect(result.failures).toHaveLength(0);
    expect(result.sessions.map((s: { state: string }) => s.state)).toEqual(['done', 'done']);
    // Archive layout: latest + dated snapshot + baseline change (from null).
    const latest = JSON.parse(fs.readFileSync(path.join(sandbox, 'steam-review-summary', 'latest.json'), 'utf8'));
    expect(latest.signature.total_reviews).toBe(110);
    expect(latest.signature.num_reviews).toBeUndefined(); // volatile field excluded
    expect(fs.existsSync(path.join(sandbox, 'steam-appdetails', '2026-07-18.json'))).toBe(true);
    const changeLines = fs.readFileSync(path.join(sandbox, 'steam-review-summary', 'changes.jsonl'), 'utf8').trim().split('\n');
    expect(changeLines).toHaveLength(1);
    expect(JSON.parse(changeLines[0]!).from).toBeNull();
    // The ledger lives in a FILE (host battery): state survives the process.
    const ledgerFile = JSON.parse(fs.readFileSync(path.join(sandbox, 'state', 'ledger.json'), 'utf8'));
    expect(Object.keys(ledgerFile.sessions)).toHaveLength(2);
    expect(ledgerFile.queries).toHaveLength(2);
  });

  it('next day with a moved store: change detected and appended; unchanged target stays quiet', async () => {
    await drive(runStorePatrol({ targets: targetsFor(baseUrl), archiveDir: sandbox, today: '2026-07-18', ...fastOpts }));
    storefront.reviews.query_summary = { ...storefront.reviews.query_summary, total_positive: 150, total_reviews: 160 };
    const day2 = await drive(runStorePatrol({ targets: targetsFor(baseUrl), archiveDir: sandbox, today: '2026-07-19', ...fastOpts }));
    expect(day2.failures).toHaveLength(0);
    expect(day2.changes).toHaveLength(1); // reviews moved, appdetails did not
    expect(day2.changes[0].target).toBe('steam-review-summary');
    expect(day2.changes[0].from.total_reviews).toBe(110);
    expect(day2.changes[0].to.total_reviews).toBe(160);
    const changeLines = fs.readFileSync(path.join(sandbox, 'steam-review-summary', 'changes.jsonl'), 'utf8').trim().split('\n');
    expect(changeLines).toHaveLength(2); // baseline + the move
    const appdetailsChanges = fs.readFileSync(path.join(sandbox, 'steam-appdetails', 'changes.jsonl'), 'utf8').trim().split('\n');
    expect(appdetailsChanges).toHaveLength(1); // baseline only
    // Same-day rerun is idempotent: sessions already done, nothing re-runs.
    const rerun = await drive(runStorePatrol({ targets: targetsFor(baseUrl), archiveDir: sandbox, today: '2026-07-19', ...fastOpts }));
    expect(rerun.changes).toHaveLength(0);
    const ledgerFile = JSON.parse(fs.readFileSync(path.join(sandbox, 'state', 'ledger.json'), 'utf8'));
    expect(ledgerFile.queries).toHaveLength(4); // 2 days x 2 targets; rerun added none
  });

  it('fixture isolation: each test starts from the pristine storefront (H3 regression)', async () => {
    // MUST run after the 'moved store' test above, which rewrites
    // reviews.query_summary (110 -> 160). Without the beforeEach deep reset
    // this baseline patrol observes the mutated store and the suite becomes
    // order-coupled.
    const result = await runStorePatrol({
      targets: targetsFor(baseUrl),
      archiveDir: sandbox,
      today: '2026-07-18',
      ...fastOpts,
    });
    expect(result.failures).toHaveLength(0);
    const latest = JSON.parse(fs.readFileSync(path.join(sandbox, 'steam-review-summary', 'latest.json'), 'utf8'));
    expect(latest.signature.total_reviews).toBe(110);
    expect(latest.signature.total_positive).toBe(100);
  });

  it('flaky endpoint: 500 then 200 -> retry path lands in done with 2 attempts', async () => {
    storefront.flakyRemaining = 1;
    const result = await drive(runStorePatrol({ targets: targetsFor(baseUrl), archiveDir: sandbox, today: '2026-07-18', ...fastOpts }));
    expect(result.failures).toHaveLength(0);
    const reviews = result.sessions.find((s: { id: string }) => s.id.includes('steam-review-summary'));
    expect(reviews.state).toBe('done');
    expect(reviews.attempts).toBe(2);
    const ledgerFile = JSON.parse(fs.readFileSync(path.join(sandbox, 'state', 'ledger.json'), 'utf8'));
    const rows = ledgerFile.queries.filter((q: { sessionId: string }) => q.sessionId === reviews.id);
    expect(rows.map((q: { outcome: string }) => q.outcome)).toEqual(['error', 'ok']);
    expect(rows[0].error).toContain('HTTP 500');
  });

  it('hung endpoint: driver timeout x maxAttempts -> failed, exit surface reports it', async () => {
    const targets = [{ id: 'steam-appdetails', url: `${baseUrl}/hang`, extract: 'steam-appdetails', key: '77' }];
    const result = await drive(runStorePatrol({ targets, archiveDir: sandbox, today: '2026-07-18', ...fastOpts }));
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].state).toBe('failed');
    expect(result.failures[0].attempts).toBe(3);
    const ledgerFile = JSON.parse(fs.readFileSync(path.join(sandbox, 'state', 'ledger.json'), 'utf8'));
    expect(ledgerFile.queries.map((q: { outcome: string }) => q.outcome)).toEqual(['timeout', 'timeout', 'timeout']);
    // A rerun the same day opens a fresh :rN retry session (failed is terminal).
    storefront.hangRequests.forEach((r) => r.destroy());
    const retry = await drive(runStorePatrol({
      targets: [{ id: 'steam-appdetails', url: `${baseUrl}/appdetails`, extract: 'steam-appdetails', key: '77' }],
      archiveDir: sandbox,
      today: '2026-07-18',
      ...fastOpts,
    }));
    expect(retry.failures).toHaveLength(0);
    expect(retry.sessions[0].id).toBe('patrol:steam-appdetails:2026-07-18:r2');
    expect(retry.sessions[0].state).toBe('done');
  }, 15_000);

  it('crash-orphaned running session is swept into the retry path and recovered (G1)', async () => {
    // A previous run that crashed mid-attempt leaves the session in 'running':
    // the id is taken, the state is not terminal, and claimDue never re-claims
    // running sessions — without the orphan sweep every rerun of that day's
    // patrol hangs until drain timeout.
    const targets = [
      { id: 'steam-appdetails', url: `${baseUrl}/appdetails`, extract: 'steam-appdetails', key: '77' },
    ];
    const id = 'patrol:steam-appdetails:2026-07-18';
    const now = Date.now();
    const ledgerPath = path.join(sandbox, 'state', 'ledger.json');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        sessions: {
          [id]: {
            id,
            intent: 'store-patrol steam-appdetails 2026-07-18',
            payload: { target: targets[0] },
            state: 'running',
            attempts: 1,
            maxAttempts: 3,
            createdAt: now - 60_000,
            updatedAt: now - 60_000,
            nextRunAt: null,
          },
        },
        queries: [],
      }) + '\n',
    );

    const result = await runStorePatrol({
      targets,
      archiveDir: sandbox,
      today: '2026-07-18',
      ...fastOpts,
    });
    expect(result.failures).toHaveLength(0);
    // The SAME session recovered through the normal retry path (no :rN fork):
    // sweep closes the interrupted attempt as an error, retry lands in done.
    expect(result.sessions[0].id).toBe(id);
    expect(result.sessions[0].state).toBe('done');
    expect(result.sessions[0].attempts).toBe(2);
    const ledgerFile = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    const rows = ledgerFile.queries.filter((q: { sessionId: string }) => q.sessionId === id);
    expect(rows.map((q: { outcome: string }) => q.outcome)).toEqual(['error', 'ok']);
    expect(rows[0].error).toBe('orphaned by previous run');
  }, 15_000);
});
