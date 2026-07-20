/**
 * The deliverable LedgerStore contract suite (gap G1) — proven against a
 * compliant in-memory store, and against deliberately broken stores to show
 * failures land in the report instead of being thrown.
 */

import { describe, expect, it } from 'vitest';
import {
  ledgerStoreContractCheckNames,
  runLedgerStoreContractSuite,
} from '../src/ledger/contract-suite.js';
import type { LedgerStore } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';

function memoryStore(): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    async putSession(record) {
      sessions.set(record.id, { ...record });
    },
    async getSession(id) {
      const r = sessions.get(id);
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter) {
      let all = [...sessions.values()];
      if (filter?.states !== undefined) all = all.filter((s) => filter.states!.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(record) {
      queries.push({ ...record });
    },
    async listQueries(sessionId) {
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

describe('runLedgerStoreContractSuite', () => {
  it('passes a compliant store and reports every check', async () => {
    const report = await runLedgerStoreContractSuite(() => memoryStore());
    expect(report.passed).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.total).toBe(ledgerStoreContractCheckNames().length);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it('supports async factories', async () => {
    const report = await runLedgerStoreContractSuite(async () => memoryStore());
    expect(report.passed).toBe(true);
  });

  it('catches a patch-instead-of-replace store into the report (never throws)', async () => {
    const broken = (): LedgerStore => {
      const base = memoryStore();
      const rows = new Map<string, SessionRecord>();
      return {
        ...base,
        async putSession(record) {
          // Violation: merge-patch semantics keep stale fields alive.
          rows.set(record.id, { ...rows.get(record.id), ...record });
        },
        async getSession(id) {
          const r = rows.get(id);
          return r === undefined ? null : { ...r };
        },
        async listSessions() {
          return [...rows.values()].map((s) => ({ ...s }));
        },
      };
    };
    const report = await runLedgerStoreContractSuite(() => broken());
    expect(report.passed).toBe(false);
    const replaceCheck = report.results.find((r) => r.name.includes('create-or-replace'));
    expect(replaceCheck?.ok).toBe(false);
    expect(replaceCheck?.error).toContain('stale field');
  });

  it('catches live-reference leaks', async () => {
    const leaky = (): LedgerStore => {
      const base = memoryStore();
      const rows = new Map<string, SessionRecord>();
      return {
        ...base,
        async putSession(record) {
          rows.set(record.id, record as SessionRecord);
        },
        async getSession(id) {
          return rows.get(id) ?? null; // no copy: caller mutations leak in
        },
        async listSessions() {
          return [...rows.values()];
        },
      };
    };
    const report = await runLedgerStoreContractSuite(() => leaky());
    expect(report.passed).toBe(false);
    expect(report.results.some((r) => !r.ok && r.name.includes('copies'))).toBe(true);
  });

  it('a factory that throws lands in the report as failures, not a rejection', async () => {
    const report = await runLedgerStoreContractSuite(() => {
      throw new Error('factory exploded');
    });
    expect(report.passed).toBe(false);
    expect(report.failed).toBe(report.total);
    expect(report.results[0]?.error).toContain('factory exploded');
  });
});
