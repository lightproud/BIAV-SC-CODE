/**
 * Delivery contract (SCS-REQ orchestrator-sdk §5): agent-initiated messaging.
 * The SDK defines ONE delivery interface; every implementation (feishu
 * webhook, client push, ...) is host-injected — the SDK ships none (§7
 * non-goal). Initiating a delivery writes one audit record into the normal
 * ledger lifecycle (no schema extension), and the send itself goes through
 * the injected sink DIRECTLY for immediacy — no polling, no driver. This is
 * the one component that executes inline by spec.
 *
 * Claiming: deliver() dispatches the audit session with runAt: null
 * (manual-claim only — nextRunAt persists as null, so claimDue never lists
 * it) and then uses TaskLedger.claimSession (surgical, claims only its own
 * audit session). Together these make the channel safe to share a
 * ledger/store with a co-resident driver and with concurrent deliver()
 * calls: even in the dispatch->claimSession window the session is invisible
 * to a due-poll. (An earlier draft used claimDue and required a dedicated
 * store partition; the review 2026-07-18 flagged the steal/race —
 * claimSession plus runAt: null removed the constraint.)
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { OutcomeInput, TaskLedger } from '../ledger/ledger.js';
import { ClaimConflictError } from '../ledger/ledger.js';
import { InvalidTransitionError } from '../ledger/state.js';

/** Data-plane message shape; rendering/formatting is host-side (§7). */
export interface DeliveryMessage {
  /** Host-defined route hint (e.g. a feishu channel id). */
  channel?: string;
  title?: string;
  /** Required, non-empty; the audited content core. */
  body: string;
  /** Opaque host payload, carried through, never interpreted. */
  data?: unknown;
}

/** Host-injected transport. NEVER implemented in the SDK (§7 non-goal). */
export type DeliverySink = (message: DeliveryMessage) => Promise<void>;

/** Outcome of one deliver() call; sink failure lands HERE, not as a throw. */
export interface DeliveryReceipt {
  /** Ledger session id of the audit record. */
  sessionId: string;
  delivered: boolean;
  error?: string;
}

export interface DeliveryChannel {
  deliver(message: DeliveryMessage): Promise<DeliveryReceipt>;
}

export interface DeliveryChannelOptions {
  /**
   * Ledger to audit into. Safe to SHARE with a driver: deliver() dispatches
   * runAt: null (invisible to claimDue) and claims surgically via
   * claimSession — no dedicated store partition required.
   */
  ledger: TaskLedger;
  sink: DeliverySink;
  clock?: Pick<Clock, 'now'>;
  /** Session-id suffix factory (default crypto.randomUUID). */
  idFactory?: () => string;
}

/**
 * Audit-before-send: dispatch + claim must land in the ledger BEFORE the sink
 * is called — a delivery that cannot be audited is a hard error and aborts
 * (ledger/store failures rethrow). Sink failure is recorded and returned in
 * the receipt; deliver() never throws for it.
 */
export function createDeliveryChannel(opts: DeliveryChannelOptions): DeliveryChannel {
  const clock = opts.clock ?? systemClock;
  const idFactory = opts.idFactory ?? (() => crypto.randomUUID());
  return {
    async deliver(message: DeliveryMessage): Promise<DeliveryReceipt> {
      if (typeof message.body !== 'string' || message.body.length === 0) {
        throw new TypeError('deliver: message.body must be a non-empty string');
      }
      // Audit record = the full message, riding the normal session lifecycle.
      // runAt: null = manual-claim only — a co-resident driver polling
      // claimDue on the same store must never see this session, even in the
      // dispatch->claimSession window (review finding 2026-07-18).
      const session = await opts.ledger.dispatch({
        id: `delivery:${idFactory()}`,
        intent: 'agent-delivery',
        maxAttempts: 1,
        payload: { message },
        runAt: null,
      });
      // Surgical claim: claimSession takes ONLY the audit session — claimDue
      // would claim every due session in the store (stealing a co-resident
      // driver's work and racing concurrent deliver() calls; review finding
      // 2026-07-18, fixed by the ledger's claimSession API). With runAt: null
      // above, claimSession is also the ONLY way this session can start.
      let claimed;
      try {
        claimed = await opts.ledger.claimSession(session.id, clock.now());
      } catch (err) {
        // A lost store-level CAS (rival writer on a putSessionIf store) means
        // the audit claim did not land — nothing was sent, and throwing an
        // internal state-machine error at the host would violate the receipt
        // contract (r5). The un-started audit session remains for host-side
        // cleanup (it is manual-claim, invisible to claimDue).
        if (err instanceof ClaimConflictError) {
          return { sessionId: session.id, delivered: false, error: err.message };
        }
        throw err;
      }
      const startedAt = clock.now();
      // Post-claim bookkeeping is best-effort (r5): a co-resident driver's
      // lease sweep can settle the audit session mid-send (lease semantics —
      // the send outran its lease), making our recordOutcome a fenced late
      // write that throws InvalidTransitionError. The message's fate is
      // decided by the SINK, not the bookkeeping; absorb the lease-race
      // rejection into the receipt instead of rejecting deliver() after a
      // send that actually happened.
      const record = async (input: OutcomeInput): Promise<void> => {
        try {
          await opts.ledger.recordOutcome(session.id, input);
        } catch (err) {
          if (err instanceof InvalidTransitionError || err instanceof ClaimConflictError) return;
          throw err;
        }
      };
      try {
        await opts.sink(message);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        await record({
          outcome: 'error',
          error: text,
          startedAt,
          endedAt: clock.now(),
          attempt: claimed.attempts,
        });
        return { sessionId: session.id, delivered: false, error: text };
      }
      await record({
        outcome: 'ok',
        startedAt,
        endedAt: clock.now(),
        attempt: claimed.attempts,
      });
      return { sessionId: session.id, delivered: true };
    },
  };
}
