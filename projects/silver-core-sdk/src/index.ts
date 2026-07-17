/**
 * silver-core-sdk - public entry point.
 *
 * Drop-in compatible surface for @anthropic-ai/claude-agent-sdk, driving
 * the Anthropic Messages API directly. See docs/COMPAT.md for the exact
 * per-feature compatibility tiers.
 */

export { query } from './query.js';
// BPT-EXTENSION (SCS-REQ-002 loop 1): run-signal ledger + daily runtime report.
// RunLogOptions rides the types.js export.
export { generateRuntimeReport } from './reporting/runtime-report.js';
export type { RuntimeReportOptions, RuntimeReportResult } from './reporting/runtime-report.js';
export { buildRunLogRecord, createRunLogSink, runLogFileName } from './reporting/run-log.js';
export type { RunLogRecord, RunLogSink } from './reporting/run-log.js';
// BPT-EXTENSION (SCS-REQ-002 loop 1 / REQ-1.2): day-over-day key-metric
// deltas for loop 3's direction-finding.
export { aggregateDay, compareReports } from './reporting/compare-reports.js';
export type {
  CompareReportsOptions,
  CompareReportsResult,
  DayAggregate,
  MetricDelta,
} from './reporting/compare-reports.js';
// BPT-EXTENSION: in-process multi-conversation coordinator (SessionManager /
// SessionManagerOptions / SessionManagerUsage types ride the types.js export).
export { createBptSession, runConcurrent } from './session-manager.js';
export type { ManagedTask, RunConcurrentOutcome } from './session-manager.js';
// BPT-EXTENSION: /loop interval-loop primitive (parser is the grammar's
// single source of truth; the controller drives a host-owned runner on a
// fixed-delay cadence — see src/prompt-loop.ts module header).
export {
  createPromptLoop,
  parseLoopCommand,
  DEFAULT_LOOP_INTERVAL_MS,
  DEFAULT_LOOP_INTERVAL_LABEL,
  MIN_LOOP_INTERVAL_MS,
  MAX_LOOP_INTERVAL_MS,
  LOOP_SLASH_COMMAND,
} from './prompt-loop.js';
export type {
  LoopCommandParse,
  LoopDirective,
  LoopErrorDecision,
  LoopStopReason,
  PromptLoopController,
  PromptLoopOptions,
  PromptLoopSummary,
} from './prompt-loop.js';
// BPT-EXTENSION: /goal session-goal primitive (the surface companion to the
// engine's Stop-hook block semantics — parser + goal manager producing the
// Stop matcher; see src/hooks/session-goal.ts module header for the deliberately
// inverted failure direction).
export { createSessionGoal, parseGoalCommand, GOAL_SLASH_COMMAND } from './hooks/session-goal.js';
export type {
  GoalCommandAction,
  GoalCommandOutcome,
  GoalCommandParse,
  SessionGoal,
  SessionGoalEvent,
  SessionGoalOptions,
} from './hooks/session-goal.js';
// Loop-support interface surface (SCS-REQ-REPOS-01 §3): primitives for a
// HOST-BUILT unattended loop. The engine never becomes the loop — the clock
// and the assembly belong to the runner layer; these exports make that loop
// externally buildable with zero engine patches.
export { ReportLedger } from './loop-support/ledger.js';
export type {
  LedgerConfig,
  LedgerEntry,
  LedgerPrelude,
  LedgerRegion,
} from './loop-support/ledger.js';
// Built-in durable session store (SM-乙a): fileSessionStore(dir) for the
// SessionManager's `store` option and options.sessionStore recovery.
export { FileSessionStore, fileSessionStore } from './sessions/file-store.js';
export { tool, createSdkMcpServer } from './mcp/sdk-server.js';
// BPT-EXTENSION (2026-07-06, black-pool ContextRing request): a public,
// read-only enumeration of the built-in tools' definition metadata
// (`{ name, description, inputJsonSchema }`), zero side effects — mirrors the
// SDK MCP tool metadata shape so a host can size the built-in tool block the
// same way it sizes MCP tools.
export { enumerateBuiltinToolMetadata } from './tools/index.js';
export type { BuiltinToolMetadata } from './tools/index.js';
// Unified tool-search (lazy loading): the default cold built-in set (schemas
// deferred behind the ToolSearch builtin when options.toolSearch === true) and
// the 银芯/SVN-world variant options bundle. The faithful createBuiltinTools()
// factory is unchanged; both of these are opt-in caller surfaces.
export { DEFAULT_DEFERRED_BUILTINS, silverCoreToolOptions } from './tools/index.js';
// Memory system (BPT-EXTENSION, docs/MEMORY.md): the MemoryStore contract and
// MemoryOptions ride the types.js export; here are the store engine (implement
// the MemoryFileOps primitives, inherit the byte-exact reference formats), the
// built-in local-filesystem store, the SDK-layer path validator, and the
// contract test suite a hosting application runs against its own store.
export {
  DEFAULT_CARDS_CONFIG,
  DEFAULT_MEMORY_LIMITS,
  INCOGNITO_MEMORY_ERROR,
  MEMORY_INDEX_PATH,
  MEMORY_ROOT,
  MEMORY_SERVER_TOOL,
  MEMORY_TOOL_NAME,
  MemoryPathError,
  createLocalFilesystemMemoryStore,
  createLocalMemoryFileOps,
  createMemoryHealth,
  createMemoryStore,
  describeMounts,
  memoryStoreContractCheckNames,
  mountAllowsWrite,
  mountReadAccess,
  outsideMountsError,
  parseMemoryCards,
  readOnlyMountError,
  resolveMemoryMounts,
  runMemoryStoreContractSuite,
  truncateViewBody,
  validateCardsContent,
  validateMemoryPath,
} from './tools/memory/index.js';
export type {
  CreateMemoryStoreOptions,
  CreateMemoryToolOptions,
  MemoryCard,
  MemoryCardsConfig,
  MemoryDirEntry,
  MemoryEntryStat,
  MemoryFileOps,
  MemoryLimits,
  MemoryStoreContractReport,
  MemoryStoreContractResult,
  MountReadAccess,
  ResolvedMemoryMount,
  ResolvedMemoryMounts,
} from './tools/memory/index.js';
// BPT-EXTENSION (2026-07-08, black-pool ContextRing request): expose the harness
// system-prompt base constructor so a host can size the built-in harness base —
// the ~2.9k-token V5 preset prose injected on the `claude_code` preset path — the
// SAME way the engine does. `buildSystemPromptParts(opt, ctx).base` returns the
// vN harness prose only (no caller `append` / project instructions / `<env>`
// tail), which is exactly the segment query.ts measures as `base`. Read-only,
// zero side effects — same rationale as enumerateBuiltinToolMetadata (ADR 0014),
// so a host no longer has to reach into dist/engine/prompts.js by file path.
export { buildSystemPromptParts, buildSystemPrompt } from './engine/prompts.js';
export type { SystemPromptParts, EnvironmentContext, PromptContext } from './engine/prompts.js';
// BPT-EXTENSION (2026-07-09, black-pool ContextRing "上下文构成" panel request):
// describe a request's per-part token estimate (需求 A) + cache_control
// breakpoint map (需求 B). Same lineage as buildSystemPromptParts
// (ADR 0014/0022) — the SDK exposes what it knows at request-build time (its own
// tokens.ts estimator + the real cache markers) so the panel stops reverse-
// engineering the transcript. Also emitted per-request as the
// system/prompt_composition observability message when
// options.includePromptComposition is set.
export { analyzeRequestComposition } from './engine/prompt-composition.js';
export type {
  SystemComposition,
  SystemCompositionPart,
  SystemPartRole,
} from './internal/contracts.js';
export { getSessionInfo, listSessions } from './sessions/store.js';
export {
  getSessionMessages,
  getSessionToolCalls,
  renameSession,
  tagSession,
  deleteSession,
  forkSession,
} from './sessions/session-functions.js';
// Tool-claim verification (BPT-EXTENSION, governance spec S4): flag assistant
// turns that CLAIM a tool action with no backing record in the S3 structured
// tool-call log. Heuristic by design — findings go to human review.
export {
  DEFAULT_TOOL_CLAIM_DETECTORS,
  MEMORY_WRITE_CLAIM_DETECTOR,
  auditSessionToolClaims,
  auditToolClaims,
  isMemoryWriteRecord,
} from './sessions/tool-claims.js';
export type {
  AuditToolClaimsArgs,
  ToolClaimDetector,
  ToolClaimFinding,
  ToolClaimRecordView,
} from './sessions/tool-claims.js';
export { InMemorySessionStore, encodeProjectKey } from './sessions/store-adapter.js';
export {
  // v0.6 utility-call product features (generators / classifiers).
  detectCommandPrefix,
  parseCommandPrefix,
  classifyBackgroundState,
  parseBackgroundState,
  generateSessionTitle,
  generateTitleAndBranch,
  generateSessionName,
  generateAwaySummary,
  parseAwaySummary,
  selectMemoryFilesToAttach,
  parseMemoryFileSelection,
  normalizeBranch,
  COMMAND_INJECTION_TOKEN,
  DEFAULT_UTILITY_MODEL,
  runUtilityCall,
  extractJsonObject,
  resolveUtilityTransport,
  GENERATOR_PROVENANCE,
  type CommandPrefixResult,
  type BackgroundRunState,
  type BackgroundStateResult,
  type TitleAndBranch,
  type MemoryFileDescriptor,
  type UtilityCallOptions,
  type GeneratorProvenance,
} from './generators/index.js';
export {
  // v0.6 context-tips subsystem (selector + reception evaluator).
  selectContextTip,
  parseContextTip,
  buildSelectorUserTurn,
  evaluateTipReception,
  parseTipReception,
  CONTEXT_TIP_CATALOG,
  renderCatalog,
  TIP_PROVENANCE,
  CONTEXT_TIP_SELECTOR_SYSTEM,
  TIP_RECEPTION_SYSTEM,
  type ContextTipSituation,
  type ContextTipDecision,
  type SelectContextTipInput,
  type TipSessionMetadata,
  type TipReception,
  type TipReceptionResult,
  type TipProvenance,
} from './tips/index.js';
export {
  // v0.6 three-state adversarial verifier (CONFIRMED / PLAUSIBLE / REFUTED).
  adversarialVerify,
  runVerification,
  parseVerdict,
  buildVerifierUserTurn,
  VERIFIER_DEFAULT_MODEL,
  SAFE_VERDICT,
  type Verdict,
  type Finding,
  type VerificationResult,
} from './verifier/index.js';
export {
  VERIFIER_PROVENANCE,
  VERIFY_VERDICT_SYSTEM,
  THREE_STATE_VERDICT_DEFINITIONS,
  RECALL_BIAS_GUIDANCE,
  VERIFY_KEEP_RULE,
  type VerifierProvenance,
} from './verifier/prompts.js';
export {
  // v0.6 hook-condition evaluator (condition-gated HookCallbackMatcher).
  evaluateHookCondition,
  parseHookCondition,
  HOOK_CONDITION_SYSTEM,
  HOOK_STOP_CONDITION_SYSTEM,
  HOOK_CONDITION_PROVENANCE_TABLE,
  type HookConditionResult,
  type HookConditionInput,
  type HookConditionProvenance,
} from './hooks/condition.js';
export {
  // v0.6 worker-fork preset (rides the shipped G4 fork machinery).
  WORKER_FORK_AGENT,
  WORKER_FORK_FRAMING,
  WORKER_FORK_PROVENANCE,
  buildWorkerForkPrompt,
  // O-B2 coordinator preset (rides the SendMessage tool body).
  COORDINATOR_MODE_PROMPT,
  COORDINATOR_MODE_PROMPT_PROVENANCE,
  COORDINATOR_WORKER_AGENT,
  COORDINATOR_WORKER_INSTRUCTIONS,
  COORDINATOR_WORKER_PROVENANCE,
} from './subagents/agents.js';
export {
  // Cross-protocol subagent transport routing (2026-07-13): the standard
  // Options.resolveSubagentTransport implementation.
  createSubagentTransportResolver,
} from './subagents/transport-resolver.js';
export type { SubagentTransportResolverOptions } from './subagents/transport-resolver.js';
export {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  McpError,
  NotImplementedError,
  errorCodeOf,
  isAbortError,
} from './errors.js';
export type { ErrorCode, McpErrorCode, McpPhase, McpTransportKind } from './errors.js';
export {
  normalizeProviderError,
  normalizeRetry,
  isRetryableHttpStatus,
  extractProviderErrorObject,
  looksLikeErrorObject,
} from './error-normalize.js';
export type {
  NormalizedProviderError,
  NormalizeContext,
  RetryLike,
} from './error-normalize.js';
export type * from './types.js';
// Official tool input/output schema types (ToolInputSchemas / ToolOutputSchemas
// and their members) — the drop-in consumer surface for typed tool interactions.
export type * from './tool-types.js';
