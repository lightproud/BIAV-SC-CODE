/**
 * Delivery contract tests (SCS-REQ orchestrator-sdk §5): audit-before-send,
 * receipt semantics, dedicated-ledger operation. Store is an inline memory
 * implementation (hosts inject their own — the SDK ships no batteries).
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskLedger } from '../src/ledger/ledger.js';
import type { LedgerStore, SessionFilter } from '../src/ledger/store.js';
import type { QueryRecord, SessionRecord } from '../src/ledger/types.js';
import { createDeliveryChannel } from '../src/delivery/channel.js';
import type { DeliveryMessage } from '../src/delivery/channel.js';

/** Minimal in-memory store; DEDICATED to the delivery channel by design. */
function memoryStore(): LedgerStore & { sessions: Map<string, SessionRecord> } {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    sessions,
    async putSession(record) {
      sessions.set(record.id, { ...record });
    },
    async getSession(id) {
      const r = sessions.get(id);
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter?: SessionFilter) {
      let all = [...sessions.values()];
      if (filter?.states !== undefined) {
        all = all.filter((s) => filter.states!.includes(s.state));
      }
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

function testClock(startAt = 1_000) {
  let t = startAt;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const seq = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

function setup(sink: (m: DeliveryMessage) => Promise<void>) {
  const store = memoryStore();
  const clock = testClock();
  const ledger = new TaskLedger({ store, clock, idFactory: seq() });
  const channel = createDeliveryChannel({ ledger, sink, clock, idFactory: seq() });
  return { store, clock, ledger, channel };
}

describe('createDeliveryChannel.deliver', () => {
  it('success path: receipt delivered, one done session + one ok query row', async () => {
    const sink = vi.fn(async () => {});
    const { store, ledger, channel } = setup(sink);
    const message: DeliveryMessage = {
      channel: 'feishu:ops',
      title: 'patrol',
      body: 'shop 42 is back online',
      data: { shop: 42 },
    };

    const receipt = await channel.deliver(message);

    expect(receipt).toEqual({ sessionId: 'delivery:id-1', delivered: true });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(message);

    // Exactly one audit session, in the normal lifecycle, full message stored.
    expect(store.sessions.size).toBe(1);
    const session = await ledger.getSession('delivery:id-1');
    expect(session).toMatchObject({
      id: 'delivery:id-1',
      intent: 'agent-delivery',
      state: 'done',
      attempts: 1,
      maxAttempts: 1,
      payload: { message },
    });

    const rows = await ledger.listQueries('delivery:id-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'delivery:id-1', attempt: 1, outcome: 'ok' });
  });

  it('sink failure: receipt carries the error, session failed, query row error; no throw', async () => {
    const sink = vi.fn(async () => {
      throw new Error('webhook 502');
    });
    const { ledger, channel } = setup(sink);

    const receipt = await channel.deliver({ body: 'hello' });

    expect(receipt).toEqual({
      sessionId: 'delivery:id-1',
      delivered: false,
      error: 'webhook 502',
    });

    const session = await ledger.getSession('delivery:id-1');
    expect(session).toMatchObject({ state: 'failed', attempts: 1, lastError: 'webhook 502' });

    const rows = await ledger.listQueries('delivery:id-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'error', error: 'webhook 502' });
  });

  it('store failure on dispatch: deliver rejects and the sink is never called', async () => {
    const sink = vi.fn(async () => {});
    const store = memoryStore();
    store.putSession = async () => {
      throw new Error('disk full');
    };
    const clock = testClock();
    const ledger = new TaskLedger({ store, clock, idFactory: seq() });
    const channel = createDeliveryChannel({ ledger, sink, clock, idFactory: seq() });

    await expect(channel.deliver({ body: 'hello' })).rejects.toThrow('disk full');
    expect(sink).not.toHaveBeenCalled();
  });

  it('empty body: TypeError before any ledger write', async () => {
    const sink = vi.fn(async () => {});
    const { store, channel } = setup(sink);
    const put = vi.spyOn(store, 'putSession');

    // Byte-exact message pin (mutation-kill: a blanked/reworded guard message
    // must fail this assertion, not just the error type).
    await expect(channel.deliver({ body: '' })).rejects.toThrow(
      'deliver: message.body must be a non-empty string',
    );
    // Non-string body rejected too (runtime guard behind the type).
    await expect(
      channel.deliver({ body: 42 as unknown as string }),
    ).rejects.toThrow(TypeError);

    expect(put).not.toHaveBeenCalled();
    expect(store.sessions.size).toBe(0);
    expect(sink).not.toHaveBeenCalled();
  });

  it('two deliveries on one channel: two independent audit sessions, receipts ordered', async () => {
    const sink = vi.fn(async () => {});
    const { store, ledger, channel } = setup(sink);

    const first = await channel.deliver({ body: 'first' });
    const second = await channel.deliver({ body: 'second' });

    expect(first.sessionId).toBe('delivery:id-1');
    expect(second.sessionId).toBe('delivery:id-2');
    expect(store.sessions.size).toBe(2);

    for (const [id, body] of [
      ['delivery:id-1', 'first'],
      ['delivery:id-2', 'second'],
    ] as const) {
      expect(await ledger.getSession(id)).toMatchObject({
        state: 'done',
        attempts: 1,
        payload: { message: { body } },
      });
      const rows = await ledger.listQueries(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'ok', attempt: 1 });
    }
  });
});

describe('delivery claim surgery (review hardening 2026-07-18)', () => {
  it('does not steal a co-resident due session and survives concurrent delivers', async () => {
    const store = memoryStore();
    const ledger = new TaskLedger({ store });
    // A driver-owned session sits due in the SAME store.
    const driverJob = await ledger.dispatch({ intent: 'driver-job' });
    const seen: string[] = [];
    const channel = createDeliveryChannel({
      ledger,
      sink: async (m) => {
        seen.push(m.body);
        await new Promise((r) => setTimeout(r, 10)); // overlap the two delivers
      },
    });
    const [r1, r2] = await Promise.all([
      channel.deliver({ body: 'first' }),
      channel.deliver({ body: 'second' }),
    ]);
    expect(r1.delivered).toBe(true);
    expect(r2.delivered).toBe(true);
    expect(seen.sort()).toEqual(['first', 'second']);
    // The driver's session was never touched by the channel's claims.
    expect((await ledger.getSession(driverJob.id))?.state).toBe('pending');
  });
});
