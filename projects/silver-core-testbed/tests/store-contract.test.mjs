/**
 * LedgerStore contract suite, run against the testbed's injected JSON-file
 * store (acceptance §4.1: the contract green over a second, non-BPT storage
 * implementation is the proof that the seam works outside its home world).
 *
 * The maestro SDK does not export a runnable contract suite for LedgerStore
 * (gap ledger entry G1) — this suite is derived from the documented contract
 * notes on the public `LedgerStore` interface (store seam doc comments) plus
 * an end-to-end pass through the public TaskLedger + LedgerDriver, so every
 * assertion here holds against public surface semantics only.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LedgerDriver, TaskLedger, runLedgerStoreContractSuite } from 'silver-core-maestro-sdk';
import { fileLedgerStore } from '../src/store.mjs';

const freshStore = () =>
  fileLedgerStore(join(mkdtempSync(join(tmpdir(), 'testbed-store-')), 'ledger.json'));

const session = (over = {}) => ({
  id: 's1',
  intent: 'contract',
  state: 'pending',
  attempts: 0,
  maxAttempts: 3,
  createdAt: 1000,
  updatedAt: 1000,
  nextRunAt: 1000,
  ...over,
});

describe('delivered contract suite (gap G1 adopted in 0.69.0)', () => {
  it('runLedgerStoreContractSuite passes the testbed store', async () => {
    const report = await runLedgerStoreContractSuite(() => freshStore());
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(true);
  });
});

describe('LedgerStore contract: sessions', () => {
  it('getSession returns null for an unknown id', async () => {
    expect(await freshStore().getSession('nope')).toBeNull();
  });

  it('putSession/getSession round-trips a full row', async () => {
    const store = freshStore();
    const rec = session({ payload: { deep: [1, { two: 2 }] }, lastError: 'boom' });
    await store.putSession(rec);
    expect(await store.getSession('s1')).toEqual(rec);
  });

  it('putSession is create-or-replace by id (full row, not a patch)', async () => {
    const store = freshStore();
    await store.putSession(session({ lastError: 'old' }));
    // Replacement row without lastError: the old field must not survive.
    await store.putSession(session({ state: 'running', attempts: 1, nextRunAt: null }));
    const got = await store.getSession('s1');
    expect(got.state).toBe('running');
    expect(got.nextRunAt).toBeNull();
    expect(got.lastError).toBeUndefined();
  });

  it('returned records are copies, not live references into the store', async () => {
    const store = freshStore();
    await store.putSession(session());
    const a = await store.getSession('s1');
    a.state = 'failed';
    expect((await store.getSession('s1')).state).toBe('pending');
    const [b] = await store.listSessions();
    b.state = 'failed';
    expect((await store.getSession('s1')).state).toBe('pending');
  });

  it('listSessions without filter returns every session', async () => {
    const store = freshStore();
    await store.putSession(session());
    await store.putSession(session({ id: 's2', state: 'done', nextRunAt: null }));
    expect((await store.listSessions()).map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('listSessions applies the states filter', async () => {
    const store = freshStore();
    await store.putSession(session());
    await store.putSession(session({ id: 's2', state: 'retrying', nextRunAt: 2000 }));
    await store.putSession(session({ id: 's3', state: 'done', nextRunAt: null }));
    const got = await store.listSessions({ states: ['pending', 'retrying'] });
    expect(got.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('listSessions applies dueBefore (nextRunAt non-null and <= dueBefore)', async () => {
    const store = freshStore();
    await store.putSession(session({ id: 'due', nextRunAt: 500 }));
    await store.putSession(session({ id: 'later', nextRunAt: 5000 }));
    await store.putSession(session({ id: 'unscheduled', state: 'running', nextRunAt: null }));
    const got = await store.listSessions({ dueBefore: 1000 });
    expect(got.map((s) => s.id)).toEqual(['due']);
  });

  it('listSessions applies BOTH filter fields together', async () => {
    const store = freshStore();
    await store.putSession(session({ id: 'hit', state: 'retrying', nextRunAt: 500 }));
    await store.putSession(session({ id: 'wrong-state', state: 'done', nextRunAt: 500 }));
    await store.putSession(session({ id: 'not-due', state: 'retrying', nextRunAt: 9000 }));
    const got = await store.listSessions({ states: ['retrying'], dueBefore: 1000 });
    expect(got.map((s) => s.id)).toEqual(['hit']);
  });
});

describe('LedgerStore contract: queries', () => {
  const row = (over = {}) => ({
    id: 'q1',
    sessionId: 's1',
    attempt: 1,
    startedAt: 1000,
    endedAt: 1001,
    outcome: 'ok',
    ...over,
  });

  it('listQueries of an unknown session is empty', async () => {
    expect(await freshStore().listQueries('nope')).toEqual([]);
  });

  it('appendQuery is append-only and listQueries preserves append order', async () => {
    const store = freshStore();
    await store.appendQuery(row({ id: 'q1', outcome: 'error', error: 'x' }));
    await store.appendQuery(row({ id: 'q2', attempt: 2, outcome: 'timeout' }));
    await store.appendQuery(row({ id: 'q3', attempt: 3, summary: 'fine' }));
    const rows = await store.listQueries('s1');
    expect(rows.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(rows[0].error).toBe('x');
    expect(rows[2].summary).toBe('fine');
  });

  it('listQueries isolates sessions from each other', async () => {
    const store = freshStore();
    await store.appendQuery(row({ id: 'qa', sessionId: 'a' }));
    await store.appendQuery(row({ id: 'qb', sessionId: 'b' }));
    await store.appendQuery(row({ id: 'qa2', sessionId: 'a', attempt: 2 }));
    expect((await store.listQueries('a')).map((q) => q.id)).toEqual(['qa', 'qa2']);
    expect((await store.listQueries('b')).map((q) => q.id)).toEqual(['qb']);
  });
});

describe('LedgerStore contract: persistence across re-open', () => {
  it('a second store over the same file sees everything the first wrote', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'testbed-store-')), 'ledger.json');
    const first = fileLedgerStore(file);
    await first.putSession(session());
    await first.appendQuery({
      id: 'q1', sessionId: 's1', attempt: 1, startedAt: 1, endedAt: 2, outcome: 'ok',
    });
    const second = fileLedgerStore(file);
    expect((await second.getSession('s1'))?.intent).toBe('contract');
    expect((await second.listQueries('s1')).length).toBe(1);
  });
});

describe('end-to-end through the public TaskLedger + LedgerDriver', () => {
  it('dispatch -> claim -> ok lands in done with one query row', async () => {
    const store = freshStore();
    const ledger = new TaskLedger({ store });
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 10,
      executor: async () => ({ outcome: 'ok', summary: 'walked through' }),
    });
    const dispatched = await ledger.dispatch({ id: 'walk:1', intent: 'walkthrough' });
    expect(dispatched.state).toBe('pending');
    driver.start();
    const deadline = Date.now() + 5000;
    let final = null;
    while (Date.now() < deadline) {
      final = await ledger.getSession('walk:1');
      if (final?.state === 'done' || final?.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await driver.stop();
    expect(final?.state).toBe('done');
    const rows = await ledger.listQueries('walk:1');
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe('ok');
    expect(rows[0].summary).toBe('walked through');
  });

  it('a failing executor walks retrying -> failed with one row per attempt', async () => {
    const store = freshStore();
    const ledger = new TaskLedger({
      store,
      retry: { maxAttempts: 2, baseDelayMs: 10, factor: 2, maxDelayMs: 50 },
    });
    const driver = new LedgerDriver({
      ledger,
      pollIntervalMs: 10,
      executor: async () => ({ outcome: 'error', error: 'always down' }),
    });
    await ledger.dispatch({ id: 'walk:fail', intent: 'walkthrough' });
    driver.start();
    const deadline = Date.now() + 5000;
    let final = null;
    while (Date.now() < deadline) {
      final = await ledger.getSession('walk:fail');
      if (final?.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await driver.stop();
    expect(final?.state).toBe('failed');
    expect(final?.lastError).toBe('always down');
    const rows = await ledger.listQueries('walk:fail');
    expect(rows.map((q) => q.attempt)).toEqual([1, 2]);
    expect(rows.every((q) => q.outcome === 'error')).toBe(true);
  });
});
