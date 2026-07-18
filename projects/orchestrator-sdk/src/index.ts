/**
 * @biav/orchestrator-sdk — reusable parts for agents that outlive a single
 * call: clock, cross-session state, session assembly.
 *
 * Three hard properties (SCS-REQ orchestrator-sdk §1, keeper ruling
 * 2026-07-17), enforced across every module in this package:
 *
 * 1. A library, not a framework. The host owns main(); every part can be
 *    taken alone, combined freely, or skipped entirely. No host is ever
 *    required to grow into a shape this package dictates.
 * 2. No privileged channel into the agent SDK. Everything this package does
 *    must be achievable by hand through @biav/agent-sdk's public surface
 *    (R1-R5). If a feature ever needs to reach inside the engine, that is a
 *    hole in R1-R5 — fix the agent-side requirements, never open a back door
 *    here. CI enforces the one-way dependency orchestrator -> agent.
 * 3. Data plane in the SDK, rendering in the host. Anything shown to a human
 *    (delivery, display) is a contract seam only; implementations are
 *    host-injected.
 *
 * Campaign 1 surface: the task ledger (§4) — record types, the closed state
 * machine, the host-injected store seam, TaskLedger, and the clock-holding
 * LedgerDriver.
 */

export const ORCHESTRATOR_SDK_VERSION = '0.2.0';

// Clock seam
export type { Clock } from './clock.js';
export { systemClock } from './clock.js';

// Ledger record shapes
export type {
  SessionState,
  QueryOutcome,
  SessionRecord,
  QueryRecord,
} from './ledger/types.js';

// Pure state-machine core
export {
  SESSION_STATES,
  TERMINAL_STATES,
  InvalidTransitionError,
  transition,
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
} from './ledger/state.js';
export type { SessionEvent, TransitionContext, RetryPolicy } from './ledger/state.js';

// Storage seam (host-injected)
export type { LedgerStore, SessionFilter } from './ledger/store.js';

// Ledger API
export { TaskLedger } from './ledger/ledger.js';
export type { TaskLedgerOptions, DispatchInput, OutcomeInput } from './ledger/ledger.js';

// Driver (live component; host holds life-and-death)
export { LedgerDriver } from './driver.js';
export type {
  LedgerDriverOptions,
  DriverEvent,
  Executor,
  ExecutorResult,
  ExecutorContext,
} from './driver.js';
