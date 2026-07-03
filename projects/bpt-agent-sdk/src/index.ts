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
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  NotImplementedError,
  isAbortError,
} from './errors.js';
export type * from './types.js';
