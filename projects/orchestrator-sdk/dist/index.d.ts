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
 * Phase 0 (monorepo migration): empty package. Capability modules (task
 * ledger, driver, loop scaffold, ...) land in their own campaigns.
 */
export declare const ORCHESTRATOR_SDK_VERSION = "0.1.0";
//# sourceMappingURL=index.d.ts.map