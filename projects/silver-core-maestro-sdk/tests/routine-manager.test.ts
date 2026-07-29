/**
 * RoutineManager (campaign 8, design round 3 rulings 裁4 / D4): the
 * duty-routine management surface over the Scheduler. Fake timers
 * throughout; the assertions that matter most are the ones that keep the
 * two id segments apart — a manual fire must never move the Scheduler's
 * recovery footprint.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskLedger, DuplicateSessionError } from '../src/ledger/ledger.js';
import { ScheduleSpecError } from '../src/schedule/spec.js';
import {
  RoutineManager,
  manualFireSessionId,
  type RoutineEvent,
  type RoutineSpec,
} from '../src/routine/manager.js';
import { memoryStore } from './helpers/memory-store.js';

// T0 is itself a fire point of every=1000/anchor 0: first fire = T0 + 1000.
const T0 = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const routine = (over: Partial<RoutineSpec> = {}): RoutineSpec => ({
  id: 'patrol',
  name: '每日商店巡检',
  intent: 'store-patrol',
  every: 1_000,
  ...over,
});

function build(opts: {
  routines?: RoutineSpec[];
  initiallyDisabled?: string[];
  seedFirstRun?: boolean;
  events?: RoutineEvent[];
} = {}) {
  const ledger = new TaskLedger({ store: memoryStore() });
  const manager = new RoutineManager({
    ledger,
    routines: opts.routines ?? [routine()],
    ...(opts.initiallyDisabled !== undefined ? { initiallyDisabled: opts.initiallyDisabled } : {}),
    ...(opts.seedFirstRun !== undefined ? { seedFirstRun: opts.seedFirstRun } : {}),
    pollIntervalMs: 100,
    ...(opts.events !== undefined ? { onEvent: (e) => opts.events!.push(e) } : {}),
  });
  return { ledger, manager };
}

describe('construction', () => {
  it('validates specs, names, duplicate ids and unknown initiallyDisabled ids', () => {
    const ledger = new TaskLedger({ store: memoryStore() });
    expect(
      () => new RoutineManager({ ledger, routines: [{ id: 'x', intent: 'y' } as RoutineSpec] }),
    ).toThrow(ScheduleSpecError);
    expect(
      () => new RoutineManager({ ledger, routines: [routine(), routine()] }),
    ).toThrow(/duplicate routine id 'patrol'/);
    expect(
      () => new RoutineManager({ ledger, routines: [routine({ name: '' })] }),
    ).toThrow(TypeError);
    expect(
      () => new RoutineManager({ ledger, routines: [routine()], initiallyDisabled: ['nope'] }),
    ).toThrow(/unknown routine 'nope'/);
  });
});

describe('scheduled firing through the internal Scheduler', () => {
  it('an enabled routine fires; a disabled one does not', async () => {
    const { ledger, manager } = build({
      routines: [routine(), routine({ id: 'weekly', name: '社区周报', intent: 'intel' })],
      initiallyDisabled: ['weekly'],
    });
    manager.start();
    manager.start(); // idempotent
    await vi.advanceTimersByTimeAsync(1_150);
    const ids = (await ledger.listSessions()).map((s) => s.id);
    expect(ids).toContain(`sched:patrol:${T0 + 1000}`);
    expect(ids.filter((id) => id.includes('weekly'))).toHaveLength(0);
    await manager.stop();
  });

  it('disable() stops future fires; enable() resumes them (events emitted)', async () => {
    const events: RoutineEvent[] = [];
    const { ledger, manager } = build({ events });
    manager.start();
    await vi.advanceTimersByTimeAsync(1_150);
    expect(await ledger.listSessions()).toHaveLength(1);

    await manager.disable('patrol');
    await manager.disable('patrol'); // idempotent, no second event
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await ledger.listSessions()).toHaveLength(1);

    await manager.enable('patrol');
    await vi.advanceTimersByTimeAsync(1_150);
    // Recovery + catch-up 'latest': the newest missed point fires once.
    expect((await ledger.listSessions()).length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === 'routine:disabled')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'routine:enabled')).toHaveLength(1);
    expect(events.some((e) => e.type === 'schedule:fire')).toBe(true);
    await manager.stop();
  });

  it('stop() halts dispatching', async () => {
    const { ledger, manager } = build();
    manager.start();
    await vi.advanceTimersByTimeAsync(1_150);
    await manager.stop();
    expect(manager.isRunning()).toBe(false);
    const count = (await ledger.listSessions()).length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await ledger.listSessions()).toHaveLength(count);
  });
});

describe('triggerNow (manual fires)', () => {
  it('dispatches manual:{id}:{firedAt} with the scheduled-fire envelope + manual flag', async () => {
    const events: RoutineEvent[] = [];
    const { ledger, manager } = build({
      routines: [routine({ payload: { target: 'steam' }, maxAttempts: 5 })],
      events,
    });
    // Works while stopped — an explicit human act needs no running scheduler.
    const session = await manager.triggerNow('patrol');
    expect(session.id).toBe(manualFireSessionId('patrol', T0));
    expect(session.id).toBe(`manual:patrol:${T0}`);
    expect(session.intent).toBe('store-patrol');
    expect(session.maxAttempts).toBe(5);
    expect(session.payload).toEqual({
      schedule: { specId: 'patrol', fireAt: T0, manual: true },
      data: { target: 'steam' },
    });
    expect(session.state).toBe('pending');
    expect(events).toEqual([
      { type: 'routine:manual-fire', routineId: 'patrol', sessionId: `manual:patrol:${T0}`, firedAt: T0 },
    ]);
  });

  it('a same-millisecond double click adopts the existing session (one event)', async () => {
    const events: RoutineEvent[] = [];
    const { manager } = build({ events });
    const first = await manager.triggerNow('patrol');
    const second = await manager.triggerNow('patrol');
    expect(second.id).toBe(first.id);
    expect(events.filter((e) => e.type === 'routine:manual-fire')).toHaveLength(1);
  });

  it('overrides the payload data when given, works on a disabled routine, throws on unknown', async () => {
    const { manager } = build({ initiallyDisabled: ['patrol'] });
    const session = await manager.triggerNow('patrol', { payload: { target: 'override' } });
    expect((session.payload as { data: unknown }).data).toEqual({ target: 'override' });
    await expect(manager.triggerNow('nope')).rejects.toThrow(/unknown routine 'nope'/);
  });

  it('a manual fire NEVER moves the Scheduler recovery footprint', async () => {
    const { ledger, manager } = build();
    // Manual fire at T0+500 — inside the window before the first due point.
    await vi.advanceTimersByTimeAsync(500);
    await manager.triggerNow('patrol');
    manager.start();
    await vi.advanceTimersByTimeAsync(650); // reaches T0+1150: point T0+1000 due
    const ids = (await ledger.listSessions()).map((s) => s.id);
    // Both exist: the manual fire did not swallow the scheduled point.
    expect(ids).toContain(`manual:patrol:${T0 + 500}`);
    expect(ids).toContain(`sched:patrol:${T0 + 1000}`);
    await manager.stop();
  });

  it('rethrows non-duplicate dispatch failures untouched', async () => {
    const { ledger, manager } = build();
    const dispatch = vi.spyOn(ledger, 'dispatch').mockRejectedValueOnce(new Error('store down'));
    await expect(manager.triggerNow('patrol')).rejects.toThrow('store down');
    dispatch.mockRestore();
    // And a duplicate whose getSession then misses rethrows the duplicate.
    vi.spyOn(ledger, 'dispatch').mockRejectedValueOnce(new DuplicateSessionError('manual:patrol:x'));
    vi.spyOn(ledger, 'getSession').mockResolvedValueOnce(null);
    await expect(manager.triggerNow('patrol')).rejects.toThrow(DuplicateSessionError);
  });
});

describe('list() / get() status reverse-lookup', () => {
  it('no footprint: lastFireAt null, nextFireAt = next point after now, lastSession null', async () => {
    const { manager } = build();
    const [status] = await manager.list();
    expect(status!.spec.name).toBe('每日商店巡检');
    expect(status!.enabled).toBe(true);
    expect(status!.lastFireAt).toBeNull();
    expect(status!.nextFireAt).toBe(T0 + 1000);
    expect(status!.lastSession).toBeNull();
  });

  it('lastFireAt is the newest point across BOTH segments; nextFireAt from sched only', async () => {
    const { ledger, manager } = build();
    manager.start();
    await vi.advanceTimersByTimeAsync(1_150); // sched:patrol:T0+1000 fired
    await manager.triggerNow('patrol'); // manual:patrol:T0+1150
    const status = await manager.get('patrol');
    expect(status!.lastFireAt).toBe(T0 + 1_150);
    expect(status!.lastSession!.id).toBe(`manual:patrol:${T0 + 1_150}`);
    // Display next = what the Scheduler will actually do: after sched footprint.
    expect(status!.nextFireAt).toBe(T0 + 2_000);
    await manager.stop();
    expect(await ledger.listSessions()).toHaveLength(2);
  });

  it('a disabled routine reports nextFireAt null but keeps its history', async () => {
    const { manager } = build();
    await manager.triggerNow('patrol');
    await manager.disable('patrol');
    const status = await manager.get('patrol');
    expect(status!.enabled).toBe(false);
    expect(status!.nextFireAt).toBeNull();
    expect(status!.lastFireAt).toBe(T0);
    expect(await manager.get('nope')).toBeNull();
  });

  it('seedFirstRun mirrors the Scheduler seed in the displayed next point', async () => {
    const { manager } = build({ seedFirstRun: true });
    const status = await manager.get('patrol');
    // Seeded base = now - every: the single most recent due point (T0) is
    // reported as already due... strictly-greater semantics put the next
    // point one cadence after the seeded base.
    expect(status!.nextFireAt).toBe(T0);
  });

  it('malformed and foreign ids never pollute the reverse-lookup', async () => {
    const { ledger, manager } = build();
    await ledger.dispatch({ id: 'sched:patrol:', intent: 'x' });
    await ledger.dispatch({ id: 'sched:patrol:abc', intent: 'x' });
    await ledger.dispatch({ id: 'sched:patrol:9999999999999999', intent: 'x' });
    await ledger.dispatch({ id: 'patrol-unrelated', intent: 'x' });
    const status = await manager.get('patrol');
    expect(status!.lastFireAt).toBeNull();
    expect(status!.lastSession).toBeNull();
  });
});
