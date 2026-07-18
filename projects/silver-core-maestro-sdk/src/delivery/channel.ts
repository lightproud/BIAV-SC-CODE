/**
 * Delivery contract (SCS-REQ orchestrator-sdk §5): agent-initiated messaging.
 * The SDK defines ONE delivery interface; every implementation (feishu
 * webhook, client push, ...) is host-injected — the SDK ships none (§7
 * non-goal). Initiating a delivery writes one audit record into the normal
 * ledger lifecycle (no schema extension), and the send itself goes through
 * the injected sink DIRECTLY for immediacy — no polling, no driver. This is
 * the one component that executes inline by spec.
 *
 * Claiming: deliver() uses TaskLedger.claimSession (surgical, claims only its
 * own audit session), so the channel can safely share a ledger/store with a
 * driver and with concurrent deliver() calls. (An earlier draft used claimDue
 * and required a dedicated store partition; the review 2026-07-18 flagged the
 * steal/race and claimSession removed the constraint.)
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { TaskLedger } from '../ledger/ledger.js';

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
  /** DEDICATED ledger — see the design constraint in the file-head comment. */
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
      const session = await opts.ledger.dispatch({
        id: `delivery:${idFactory()}`,
        intent: 'agent-delivery',
        maxAttempts: 1,
        payload: { message },
      });
      // Surgical claim: claimSession takes ONLY the audit session — claimDue
      // would claim every due session in the store (stealing a co-resident
      // driver's work and racing concurrent deliver() calls; review finding
      // 2026-07-18, fixed by the ledger's claimSession API).
      await opts.ledger.claimSession(session.id, clock.now());
      const startedAt = clock.now();
      try {
        await opts.sink(message);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        await opts.ledger.recordOutcome(session.id, {
          outcome: 'error',
          error: text,
          startedAt,
          endedAt: clock.now(),
        });
        return { sessionId: session.id, delivered: false, error: text };
      }
      await opts.ledger.recordOutcome(session.id, {
        outcome: 'ok',
        startedAt,
        endedAt: clock.now(),
      });
      return { sessionId: session.id, delivered: true };
    },
  };
}
