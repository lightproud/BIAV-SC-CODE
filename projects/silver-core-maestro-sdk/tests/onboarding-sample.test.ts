/**
 * The ONBOARDING doc's store sample is executable, and it passes the contract
 * suite the doc tells you to run.
 *
 * Why this test exists: `docs/ONBOARDING.md` §1 exists to be COPIED — it was
 * added (keeper ruling 2026-07-26, product review P3) because the two real
 * consumers each hand-wrote a 40-line file store, 86% line-identical, and the
 * package's only help was a 16-check suite to verify your copy rather than the
 * thing to copy. A sample that consumers paste into production is load-bearing
 * code; shipping it unverified would be worse than shipping nothing, because a
 * subtly wrong store breaks idempotent dispatch and cross-restart recovery in
 * ways that surface days later.
 *
 * So the sample is not transcribed here — it is EXTRACTED from the markdown,
 * written to a temp .ts file, imported (vitest transpiles it), and run through
 * runLedgerStoreContractSuite. If the doc drifts from the contract, this reds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import {
  runLedgerStoreContractSuite,
  ledgerStoreContractCheckNames,
  type LedgerStore,
} from 'silver-core-maestro-sdk';

const DOC = join(fileURLToPath(new URL('..', import.meta.url)), 'docs', 'ONBOARDING.md');

/** The first ```ts fence of the doc (§1, the complete memory store). */
function firstTsFence(markdown: string): string {
  const m = /```ts\n([\s\S]*?)```/.exec(markdown);
  if (m === null) throw new Error('ONBOARDING.md: no ```ts fence found');
  return m[1] as string;
}

let dir: string;
let makeStore: () => LedgerStore;

beforeAll(async () => {
  const source = firstTsFence(readFileSync(DOC, 'utf8'));
  // Sanity: we extracted the store sample and not some later snippet.
  expect(source).toContain('export function memoryLedgerStore');
  dir = mkdtempSync(join(tmpdir(), 'onboarding-sample-'));
  const file = join(dir, 'sample.ts');
  writeFileSync(file, source, 'utf8');
  const mod = (await import(pathToFileURL(file).href)) as {
    memoryLedgerStore: () => LedgerStore;
  };
  makeStore = mod.memoryLedgerStore;
});

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("docs/ONBOARDING.md §1 sample", () => {
  it('is executable as written (imports resolve, TS compiles)', () => {
    expect(typeof makeStore).toBe('function');
    const store = makeStore();
    for (const method of [
      'putSession',
      'getSession',
      'listSessions',
      'appendQuery',
      'listQueries',
    ] as const) {
      expect(typeof store[method]).toBe('function');
    }
  });

  it('passes every base contract check', async () => {
    const report = await runLedgerStoreContractSuite(() => makeStore());
    // Name the failures rather than just the count — a red here should tell the
    // maintainer WHICH promise the doc's sample broke.
    expect(report.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error ?? ''}`)).toEqual(
      [],
    );
    expect(report.passed).toBe(true);
  });

  it('implements the optional deleteSession seam and passes its checks too', async () => {
    // The doc includes the seam; if a future edit drops it, the check count
    // silently falls back to base-only and consumers lose the retention story.
    expect(makeStore().deleteSession).toBeTypeOf('function');
    const report = await runLedgerStoreContractSuite(() => makeStore());
    expect(report.total).toBe(ledgerStoreContractCheckNames({ withDeleteSession: true }).length);
  });

  it('negative control: the suite would REJECT the classic wrong sample', async () => {
    // Proves the check above is not vacuous. This store commits the fourth
    // trap the doc names — deletes the session row and orphans its query rows.
    const orphaning = (): LedgerStore => {
      const good = makeStore();
      return {
        ...good,
        deleteSession: async (id: string) => {
          const had = (await good.getSession(id)) !== null;
          await good.putSession({
            id: '__tombstone__',
            intent: 'x',
            state: 'done',
            attempts: 0,
            maxAttempts: 1,
            createdAt: 0,
            updatedAt: 0,
            nextRunAt: null,
          });
          void id;
          return had;
        },
      };
    };
    const report = await runLedgerStoreContractSuite(orphaning);
    expect(report.passed).toBe(false);
    expect(report.results.some((r) => !r.ok && /orphan query row/.test(r.error ?? ''))).toBe(true);
  });
});
