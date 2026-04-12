/**
 * BPT SDK -- Public entry point for embedding BPT core modules.
 *
 * Why: Phase 5 deliverable. Internal tools on the company network can import
 * BPT's conversation engine, LLM abstraction, tool system, and plugin types
 * as a library instead of running the full Electron app. The desktop app is
 * the "reference implementation"; this SDK is the reusable core.
 *
 * Usage:
 *   import { LlmProvider, ToolRegistry, ... } from 'bpt/sdk';
 *
 * Build:
 *   npm run build:sdk   (produces dist-sdk/)
 *
 * Note: This SDK targets Node.js (not browser). It re-exports modules from
 * electron/ that use Node.js APIs (fs, path, child_process). Electron-specific
 * APIs (BrowserWindow, ipcMain) are NOT exported.
 */

// ── Shared Types ────────────────────────────────────────────────
// These types are used by both renderer and main process.

export type {
  Gear,
  Message,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  CiteBlock,
  TokenUsage,
  LLMEndpoint,
  StreamEvent,
  ToolSource,
  ToolDescriptor,
} from '../src/types';

// ── LLM Provider Abstraction ────────────────────────────────────
// The core abstraction for talking to any LLM backend.

export type {
  LlmProvider,
  LlmMessage,
  LlmContentBlock,
  LlmStreamEvent,
  LlmRequestConfig,
} from '../electron/llm/provider';

// ── Token Accounting ────────────────────────────────────────────

export { createTokenAccounting } from '../electron/llm/token-accounting';

// ── Tool Registry ───────────────────────────────────────────────

export { ToolRegistry } from '../electron/llm/tool-registry';

// ── Plugin System Types ─────────────────────────────────────────
// Types only — plugin loader/sandbox depend on Electron runtime.

export type {
  PluginManifest,
  PluginPermission,
  PluginInstance,
  PluginInfo,
  PluginConfig,
} from '../electron/plugin/types';

export { validateManifest } from '../electron/plugin/types';

// ── Dream / Sentinel Types ──────────────────────────────────────

export type {
  DreamReport,
  DreamCheckSection,
  DreamInsight,
  InsightsLibrary,
  SentinelAlert,
  DreamReportEntry,
} from '../electron/dream/dream-reader';

// ── Version ─────────────────────────────────────────────────────

export const BPT_VERSION = '0.4.0';
