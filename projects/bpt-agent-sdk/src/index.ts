/**
 * bpt-agent-sdk - public entry point.
 *
 * Drop-in compatible surface for @anthropic-ai/claude-agent-sdk, driving
 * the Anthropic Messages API directly. See docs/COMPAT.md for the exact
 * per-feature compatibility tiers.
 */

export { query } from './query.js';
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
  type UtilityCallOptions,
  type GeneratorProvenance,
} from './generators/index.js';
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
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  NotImplementedError,
  isAbortError,
} from './errors.js';
export type * from './types.js';
