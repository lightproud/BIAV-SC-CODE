/**
 * Example 1 (SCS-REQ orchestrator-sdk §6.1): the MINIMAL LOOP — periodic
 * dispatch + budget cap + wind-down on cap, running on the task ledger and
 * consuming the agent SDK's R2 budget event stream (`budget:threshold` /
 * `budget:exhausted` hook events + the structured closeout report).
 *
 * Living proof of hard property §1.2 (no privileged channel): this file
 * imports ONLY the two packages' public surfaces. If this example could not
 * be written, that would be a hole in the public interfaces — never a reason
 * to reach inside.
 *
 * Seam demonstration (§4): the storage battery is HOST code — the in-memory
 * store below implements the SDK's LedgerStore interface in ~30 lines; a
 * production host injects its DB-backed implementation the same way.
 *
 * Run: RUN_MINIMAL_LOOP=1 npx tsx examples/minimal-loop.ts
 * (needs ANTHROPIC_API_KEY; without it the entry prints a notice and exits.
 * The e2e test drives runMinimalLoop() against a local emulator instead.)
 */

import { query } from '@biav/agent-sdk';
import type { BudgetCloseoutReport, Options } from '@biav/agent-sdk';
import {
  TaskLedger,
  LedgerDriver,
  type DriverEvent,
  type LedgerStore,
  type QueryRecord,
  type SessionFilter,
  type SessionRecord,
} from '@biav/orchestrator-sdk';

/** Host-side storage battery (the SDK ships none — §7 non-goals). */
export function memoryLedgerStore(): LedgerStore {
  const sessions = new Map<string, SessionRecord>();
  const queries: QueryRecord[] = [];
  return {
    async putSession(r) {
      sessions.set(r.id, { ...r });
    },
    async getSession(id) {
      const r = sessions.get(id);
      return r === undefined ? null : { ...r };
    },
    async listSessions(filter?: SessionFilter) {
      let all = [...sessions.values()];
      if (filter?.states !== undefined) all = all.filter((s) => filter.states!.includes(s.state));
      if (filter?.dueBefore !== undefined) {
        all = all.filter((s) => s.nextRunAt !== null && s.nextRunAt <= filter.dueBefore!);
      }
      return all.map((s) => ({ ...s }));
    },
    async appendQuery(r) {
      queries.push({ ...r });
    },
    async listQueries(sessionId) {
      return queries.filter((q) => q.sessionId === sessionId).map((q) => ({ ...q }));
    },
  };
}

export interface MinimalLoopOptions {
  /** Dispatch cadence: one ledger session per interval. */
  intervalMs: number;
  /** The LOOP's budget cap across all ticks (USD). */
  totalBudgetUsd: number;
  /** Prompt sent on every tick. */
  prompt: string;
  /** Pass-through to the agent query (model / provider / persistSession / ...). */
  queryOptions?: Partial<Options>;
  /** Host-injected store; defaults to the in-memory battery above. */
  store?: LedgerStore;
  /** Driver poll cadence (default 250 ms). */
  pollIntervalMs?: number;
  /** Stop dispatching after this many ticks (safety stop for demos/tests). */
  maxTicks?: number;
  /** Observability pass-through (data plane; rendering is the host's). */
  onEvent?: (ev: DriverEvent) => void;
}

export interface MinimalLoopResult {
  /** R2 closeout report when the engine stopped on the cap; null otherwise. */
  closeout: BudgetCloseoutReport | null;
  /** Whether the R2 `budget:threshold` event was observed. */
  thresholdSeen: boolean;
  /** Cost accrued across all ticks (from result messages). */
  spentUsd: number;
  windDownReason: 'budget:exhausted' | 'budget:spent' | 'max-ticks';
  /** Final ledger rows: what ran, what finished, what parked where. */
  sessions: SessionRecord[];
}

/**
 * The loop: dispatch a session per interval; the driver claims and executes
 * each through an agent query armed with the REMAINING loop budget; when the
 * engine stops on the cap (R2 `budget:exhausted` + closeout report) the loop
 * winds down — stops dispatching, stops the driver, reports.
 */
export async function runMinimalLoop(opts: MinimalLoopOptions): Promise<MinimalLoopResult> {
  const store = opts.store ?? memoryLedgerStore();
  const ledger = new TaskLedger({ store });

  let spentUsd = 0;
  let closeout: BudgetCloseoutReport | null = null;
  let thresholdSeen = false;
  let windDownReason: MinimalLoopResult['windDownReason'] = 'max-ticks';
  let stopped = false;
  let dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));

  const windDown = (reason: MinimalLoopResult['windDownReason']): void => {
    if (stopped) return;
    stopped = true;
    windDownReason = reason;
    if (dispatchTimer !== null) clearTimeout(dispatchTimer);
    resolveDone();
  };

  const executor = async (session: SessionRecord): Promise<{ outcome: 'ok' | 'error'; error?: string; summary?: string }> => {
    const remaining = opts.totalBudgetUsd - spentUsd;
    if (remaining <= 0) {
      windDown('budget:spent');
      return { outcome: 'error', error: 'loop budget already spent' };
    }
    const { prompt } = session.payload as { prompt: string };
    const q = query({
      prompt,
      options: {
        ...opts.queryOptions,
        maxBudgetUsd: remaining,
        budgetThresholdRatio: 0.8,
        hooks: {
          ...opts.queryOptions?.hooks,
          'budget:threshold': [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name === 'budget:threshold') thresholdSeen = true;
                  return {};
                },
              ],
            },
          ],
          'budget:exhausted': [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name === 'budget:exhausted') closeout = input.report;
                  return {};
                },
              ],
            },
          ],
        },
      },
    });

    let resultText = '';
    let errorSubtype: string | undefined;
    for await (const message of q) {
      if (message.type !== 'result') continue;
      spentUsd += message.total_cost_usd;
      if (message.subtype === 'success') resultText = message.result;
      else errorSubtype = message.subtype;
    }

    if (closeout !== null) {
      // Cap hit inside this query: record the attempt honestly, then wind down.
      windDown('budget:exhausted');
      return { outcome: 'error', error: errorSubtype ?? 'budget exhausted' };
    }
    if (spentUsd >= opts.totalBudgetUsd) windDown('budget:spent');
    if (errorSubtype !== undefined) return { outcome: 'error', error: errorSubtype };
    return { outcome: 'ok', summary: resultText.slice(0, 200) };
  };

  let ticks = 0;
  const dispatchTick = async (): Promise<void> => {
    if (stopped) return;
    ticks += 1;
    await ledger.dispatch({
      intent: `minimal-loop tick ${ticks}`,
      payload: { prompt: opts.prompt },
      maxAttempts: 1,
    });
    if (opts.maxTicks === undefined || ticks < opts.maxTicks) {
      dispatchTimer = setTimeout(() => void dispatchTick(), opts.intervalMs);
    }
  };

  const driver = new LedgerDriver({
    ledger,
    executor,
    pollIntervalMs: opts.pollIntervalMs ?? 250,
    onEvent: (ev) => {
      opts.onEvent?.(ev);
      // Drain detection for the max-ticks stop: all dispatched, none left open.
      if (ev.type === 'session:terminal' && opts.maxTicks !== undefined && ticks >= opts.maxTicks) {
        void ledger
          .listSessions({ states: ['pending', 'running', 'retrying'] })
          .then((open) => {
            if (open.length === 0) windDown('max-ticks');
          });
      }
    },
  });

  await dispatchTick();
  driver.start();
  await done;
  await driver.stop();

  return {
    closeout,
    thresholdSeen,
    spentUsd,
    windDownReason,
    sessions: await ledger.listSessions(),
  };
}

// Manual entry (gated so importing this module never runs the loop):
//   RUN_MINIMAL_LOOP=1 ANTHROPIC_API_KEY=sk-... npx tsx examples/minimal-loop.ts
if (process.env.RUN_MINIMAL_LOOP === '1') {
  if (process.env.ANTHROPIC_API_KEY === undefined) {
    console.error('minimal-loop: set ANTHROPIC_API_KEY to run against the real API.');
    process.exit(1);
  }
  void runMinimalLoop({
    intervalMs: 5_000,
    totalBudgetUsd: 0.05,
    prompt: 'Reply with one short sentence: what time-of-day vibe is it?',
    maxTicks: 3,
    queryOptions: { maxTurns: 1 },
  }).then((r) => {
    console.log(
      `minimal-loop: wind-down=${r.windDownReason} spent=$${r.spentUsd.toFixed(6)} ` +
        `sessions=${r.sessions.map((s) => `${s.intent}:${s.state}`).join(', ')}`,
    );
    if (r.closeout !== null) console.log('closeout report:', r.closeout);
  });
}
