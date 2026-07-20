/**
 * §7.1 ASSEMBLY ACCEPTANCE (SCS-REQ-REPOS-01) — the proof that a black-pool
 * runner can build an unattended loop from the OUTSIDE with zero engine
 * patches, using only the R1–R5 public interfaces (everything imported from
 * the package entry point):
 *
 *   - same-session turn-by-turn looping        (R1: query + resume + prelude
 *                                               + getSessionAccounting)
 *   - cross-turn dedup that SURVIVES a forced
 *     compaction                               (R4 ledger + R3 retained region)
 *   - budget-cap shutdown with a closeout
 *     report                                   (R2 budget:exhausted)
 *   - a model stop-proposal reaching the host
 *     as a structured event while the loop
 *     runs on unaffected                       (R5 LoopControl)
 *   - goal assembled as structured config:
 *     judge says not-achieved -> reason is fed
 *     back and the loop re-drives; impossible
 *     escapes                                  (§4.3 options.goal)
 *
 * NO REAL CLOCK anywhere: rounds are sequential query() calls; there is no
 * setTimeout/setInterval in this file (the cadence between rounds belongs to
 * the runner layer and is out of engine scope by design).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The assembly uses ONLY the package's public entry point.
import {
  ReportLedger,
  getSessionAccounting,
  query,
} from '../src/index.js';
import type {
  BudgetExhaustedHookInput,
  GoalEvent,
  LoopStopProposal,
  Options,
  SDKMessage,
  SDKSystemMessage,
} from '../src/types.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

let sessionDir: string;
beforeAll(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'sdk-loop-assembly-'));
});
afterAll(async () => {
  await rm(sessionDir, { recursive: true, force: true });
});

const PRICED = { model: 'claude-sonnet-4-5', usage: { input_tokens: 1000 } };

function baseOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function pad(s: string, len: number): string {
  return s + ' '.repeat(Math.max(0, len - s.length));
}

describe('§7.1 assembly acceptance — a host-built loop over R1–R5', () => {
  it('drives the full loop: inject, dedup across a forced fold, propose, cap out', async () => {
    const ledger = new ReportLedger();
    const proposals: LoopStopProposal[] = [];
    let exhausted: BudgetExhaustedHookInput | undefined;
    let sessionId = '';

    /** One loop round = one injected turn into the shared session (R1). */
    const round = async (
      prompt: string,
      fetchImpl: ReturnType<typeof makeSSEFetch>,
      extra: Partial<Options> = {},
    ) => {
      const q = query({
        prompt,
        options: baseOptions({
          provider: { apiKey: 'test-key', fetch: fetchImpl, promptCaching: false },
          ...(sessionId !== '' ? { resume: sessionId } : {}),
          // R1: the ledger digest rides every injected turn…
          prelude: [ledger.toPrelude()],
          // …and R3 makes it survive any fold in between.
          compaction: {
            retainedRegions: [ledger.toRetainedRegion()],
            ...(extra.compaction ?? {}),
          },
          // R5: the model may propose stopping; the HOST decides.
          loopControl: { onProposal: (p) => proposals.push(p) },
          // R2: subscribe to the budget event stream.
          hooks: {
            'budget:exhausted': [
              {
                hooks: [
                  async (input) => {
                    exhausted = input as BudgetExhaustedHookInput;
                    return {};
                  },
                ],
              },
            ],
          },
          ...extra,
        }),
      });
      const messages = await collect(q);
      if (sessionId === '') {
        sessionId = (messages[0] as SDKSystemMessage).session_id;
      }
      return messages;
    };

    // ---- Round 1: first injection creates the session. --------------------
    const fetch1 = makeSSEFetch([textReplyEvents(pad('found incident-1', 1600), PRICED)]);
    await round(pad('scan the fleet, round 1', 1600), fetch1);
    // Host-side dedup bookkeeping (R4): record what round 1 reported.
    expect(ledger.record('incident-1', { at: 1000, summary: 'disk full on host-3' })).toBe(
      true,
    );
    expect(ledger.has('incident-1')).toBe(true);

    // ---- R1 pre-injection read: cost/turns/context are visible BEFORE
    // injecting the next round. ---------------------------------------------
    const snapBefore = await getSessionAccounting(sessionId, { sessionDir });
    expect(snapBefore.cumulativeCostUsd).toBeGreaterThan(0);
    expect(snapBefore.cumulativeTurns).toBe(1);
    expect(snapBefore.estimatedContextTokens).toBeGreaterThan(0);

    // ---- Round 2: the model proposes stopping (R5); the host decides to
    // keep looping — the round itself completes and a THIRD round still runs.
    const fetch2 = makeSSEFetch([
      toolUseReplyEvents(
        'LoopControl',
        { action: 'propose_stop', reason: 'nothing new since incident-1' },
        PRICED,
      ),
      textReplyEvents(pad('acknowledged, continuing', 1600), PRICED),
    ]);
    const round2 = await round(pad('scan the fleet, round 2', 1600), fetch2);
    expect(proposals).toEqual([
      { action: 'propose_stop', reason: 'nothing new since incident-1' },
    ]);
    expect(round2[round2.length - 1]?.type).toBe('result');
    // The prelude carried the dedup digest into the turn (R4 -> R1).
    const round2Body = JSON.parse(String(fetch2.requests[0]?.init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(JSON.stringify(round2Body.messages)).toContain('incident-1');

    // ---- Round 3: force a compaction fold and prove the ledger SURVIVES it
    // verbatim (R3). The tiny context window folds the accumulated history
    // before the turn's request is sent, so the wire request itself is the
    // evidence: post-fold context still carries the retained region. --------
    const fetch3 = makeSSEFetch([textReplyEvents('post-fold reply', PRICED)]);
    const round3 = await round(pad('scan the fleet, round 3', 1600), fetch3, {
      compaction: {
        retainedRegions: [ledger.toRetainedRegion()],
        contextWindowTokens: 2600, // small window: the accumulated history folds
        minRecentTurns: 1, // assembly-time knob: keep just the fresh injection
      },
      provider: {
        apiKey: 'test-key',
        fetch: fetch3,
        promptCaching: false,
        maxOutputTokens: 500, // shrink reserved output so the window can fold
      },
    });
    const boundary = round3.find(
      (m) => m.type === 'system' && m.subtype === 'compact_boundary',
    );
    expect(boundary).toBeDefined();
    const round3Body = JSON.parse(String(fetch3.requests[0]?.init?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const wire3 = JSON.stringify(round3Body.messages);
    expect(wire3).toContain('<retained-context id='); // region block present…
    expect(wire3).toContain('reported-events-ledger'); // …with the ledger id…
    expect(wire3).toContain('incident-1'); // …and dedup semantics survived the fold
    expect(exhausted).toBeUndefined(); // budget untouched so far

    // ---- Round 4: cap out. The engine stops on the budget gate and hands
    // the host the structured closeout report (R2). -------------------------
    const fetch4 = makeSSEFetch([
      toolUseReplyEvents('Read', { file_path: '/x' }, PRICED),
      textReplyEvents('never reached', PRICED),
    ]);
    const round4 = await round(pad('scan the fleet, round 4', 1600), fetch4, {
      maxBudgetUsd: 0.000001,
    });
    const last = round4[round4.length - 1] as { subtype?: string };
    expect(last.subtype).toBe('error_max_budget_usd');
    expect(exhausted).toBeDefined();
    expect(exhausted?.report.cumulative_cost_usd).toBeGreaterThan(0.000001);
    expect(exhausted?.report.num_turns).toBeGreaterThanOrEqual(1);
    expect(typeof exhausted?.report.last_assistant_summary).toBe('string');

    // The session's TRUE cross-round cost is still readable afterwards (R1).
    const snapAfter = await getSessionAccounting(sessionId, { sessionDir });
    expect(snapAfter.cumulativeCostUsd).toBeGreaterThan(snapBefore.cumulativeCostUsd);
    expect(snapAfter.resultCount).toBeGreaterThanOrEqual(3);
  });

  it('assembles the goal as structured config: rejected verdict re-drives, impossible escapes', async () => {
    // Judge rejects once (reason fed back, loop re-drives), then accepts.
    const events: GoalEvent[] = [];
    const fetchGoal = makeSSEFetch([
      textReplyEvents('half done', PRICED),
      textReplyEvents('all done', PRICED),
    ]);
    const q = query({
      prompt: 'finish the sweep',
      options: baseOptions({
        provider: { apiKey: 'test-key', fetch: fetchGoal, promptCaching: false },
        persistSession: false,
        goal: {
          goal: 'sweep complete',
          evaluator: ({ blocks }) =>
            blocks === 0
              ? { status: 'not_achieved', reason: 'segment B still unswept' }
              : { status: 'achieved', reason: 'both segments swept' },
          onEvent: (e) => events.push(e),
        },
      }),
    });
    const messages = await collect(q);
    expect((messages[messages.length - 1] as { subtype?: string }).subtype).toBe(
      'success',
    );
    expect(events.map((e) => e.kind)).toEqual(['blocked', 'achieved']);
    // Two model rounds ran; the judge's reason was injected into round 2.
    expect(fetchGoal.requests).toHaveLength(2);
    const body2 = JSON.parse(String(fetchGoal.requests[1]?.init?.body)) as {
      messages: unknown[];
    };
    expect(JSON.stringify(body2.messages)).toContain('segment B still unswept');

    // Impossible is the judged escape hatch: one round, clean success.
    const fetchEsc = makeSSEFetch([textReplyEvents('tried everything', PRICED)]);
    const escEvents: GoalEvent[] = [];
    const q2 = query({
      prompt: 'attempt the impossible',
      options: baseOptions({
        provider: { apiKey: 'test-key', fetch: fetchEsc, promptCaching: false },
        persistSession: false,
        goal: {
          goal: 'contact the decommissioned fleet endpoint',
          evaluator: () => ({ status: 'impossible', reason: 'endpoint is gone' }),
          onEvent: (e) => escEvents.push(e),
        },
      }),
    });
    const messages2 = await collect(q2);
    expect((messages2[messages2.length - 1] as { subtype?: string }).subtype).toBe(
      'success',
    );
    expect(escEvents.map((e) => e.kind)).toEqual(['impossible']);
    expect(fetchEsc.requests).toHaveLength(1);
  });
});
