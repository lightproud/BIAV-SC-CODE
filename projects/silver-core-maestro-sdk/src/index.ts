/**
 * silver-core-maestro-sdk — reusable parts for agents that outlive a single
 * call: clock, cross-session state, session assembly.
 *
 * Three hard properties (SCS-REQ orchestrator-sdk §1, keeper ruling
 * 2026-07-17), enforced across every module in this package:
 *
 * 1. A library, not a framework. The host owns main(); every part can be
 *    taken alone, combined freely, or skipped entirely. No host is ever
 *    required to grow into a shape this package dictates.
 * 2. No privileged channel into the agent SDK. Everything this package does
 *    must be achievable by hand through silver-core-agent-sdk's public surface
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

export const MAESTRO_SDK_VERSION = '0.70.0';

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
export { TaskLedger, DuplicateSessionError } from './ledger/ledger.js';
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

// Schedule (campaign 3: 定点触发 + 错过补偿 + 跨重启恢复)
export { ScheduleSpecError, validateSpec, nextFireAt, firesBetween } from './schedule/spec.js';
export type { ScheduleSpec } from './schedule/spec.js';
export { Scheduler } from './schedule/scheduler.js';
export type { SchedulerOptions, SchedulerEvent } from './schedule/scheduler.js';

// Workflow graph executor (campaign 4: 声明式图,图定义是数据)
export { GraphError, validateGraph, readyNodes, graphStatus } from './workflow/graph.js';
export type { WorkflowNode, WorkflowGraph, WorkflowStatus } from './workflow/graph.js';
export { loadWorkflowGraphFile, parseWorkflowGraphSource } from './workflow/load.js';
export type { WorkflowGraphLoadResult, WorkflowGraphSourceFormat } from './workflow/load.js';
export { WorkflowRun, workflowSessionId } from './workflow/run.js';
export type {
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowNodeContext,
  WorkflowNodePayload,
} from './workflow/run.js';

// Goal chaser (campaign 5: 跨 query 重发起,记账为多 session)
export { nextGoalAction } from './goal/decision.js';
export type { GoalVerdict, GoalAction } from './goal/decision.js';
export { GoalChaser, goalRoundSessionId } from './goal/chaser.js';
export type {
  GoalRunConfig,
  GoalRoundPayload,
  GoalEvaluator,
  GoalChaserEvent,
  GoalChaserOptions,
  GoalChaseResult,
} from './goal/chaser.js';

// Delivery contract (campaign 6: 送达缝宿主注入 + 台账审计)
export { createDeliveryChannel } from './delivery/channel.js';
export type {
  DeliveryMessage,
  DeliverySink,
  DeliveryReceipt,
  DeliveryChannel,
  DeliveryChannelOptions,
} from './delivery/channel.js';
