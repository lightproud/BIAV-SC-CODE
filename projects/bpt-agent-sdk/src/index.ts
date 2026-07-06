/**
 * bpt-agent-sdk - public entry point.
 *
 * Drop-in compatible surface for @anthropic-ai/claude-agent-sdk, driving
 * the Anthropic Messages API directly. See docs/COMPAT.md for the exact
 * per-feature compatibility tiers.
 */

export { query } from './query.js';
// BPT-EXTENSION: in-process multi-conversation coordinator (SessionManager /
// SessionManagerOptions / SessionManagerUsage types ride the types.js export).
export { createBptSession } from './session-manager.js';
// Built-in durable session store (SM-乙a): fileSessionStore(dir) for the
// SessionManager's `store` option and options.sessionStore recovery.
export { FileSessionStore, fileSessionStore } from './sessions/file-store.js';
export { tool, createSdkMcpServer } from './mcp/sdk-server.js';
export { getSessionInfo, listSessions } from './sessions/store.js';
export {
  getSessionMessages,
  renameSession,
  tagSession,
  deleteSession,
  forkSession,
} from './sessions/session-functions.js';
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
} from './subagents/agents.js';
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
export type * from './types.js';
// Official tool input/output schema types (ToolInputSchemas / ToolOutputSchemas
// and their members) — the drop-in consumer surface for typed tool interactions.
export type * from './tool-types.js';
