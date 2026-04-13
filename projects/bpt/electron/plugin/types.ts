/**
 * types.ts -- Plugin system type definitions.
 *
 * Why separate from src/types.ts: Plugin types are internal to the main
 * process (loader, sandbox, context). The renderer only sees plugin metadata
 * through IPC — it doesn't need these implementation types.
 */

import type { ToolDescriptor, Gear } from '../../src/types';

// ── Plugin Manifest ────────────────────────────────────────────

/** Permission tokens a plugin can request. */
export type PluginPermission =
  | 'tools:register'   // Register new tools in the tool registry
  | 'tools:call'       // Call existing tools
  | 'config:read'      // Read app configuration
  | 'config:write'     // Write app configuration
  | 'fs:read'          // Read files from the repo
  | 'fs:write';        // Write files (requires explicit user approval)

/**
 * manifest.json — the source of truth for a plugin.
 * Every field here is validated at load time.
 */
export interface PluginManifest {
  /** Unique plugin identifier (no spaces, lowercase + hyphens). */
  name: string;
  version: string;
  description: string;
  /** Entry point JS file relative to plugin directory. */
  entry: string;
  /** Permissions this plugin requires. */
  permissions: PluginPermission[];
  /** Minimum BPT version required. */
  minBptVersion: string;
  /** Which gears the plugin's tools should be active in. Empty = always. */
  gears?: Gear[];
  /** Author name (informational). */
  author?: string;
}

// ── Runtime Plugin State ───────────────────────────────────────

export type PluginStatus = 'loaded' | 'running' | 'error' | 'disabled';

/** Runtime representation of a loaded plugin. */
export interface PluginInstance {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  dir: string;
  status: PluginStatus;
  /** Error message if status is 'error'. */
  error?: string;
  /** Tools registered by this plugin. */
  tools: ToolDescriptor[];
  /** Plugin's execute function for handling tool calls. */
  execute?: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
}

/** What the renderer sees (no execute function, no dir). */
export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  status: PluginStatus;
  error?: string;
  permissions: PluginPermission[];
  toolCount: number;
  author?: string;
}

// ── Plugin Config ──────────────────────────────────────────────

/** Per-plugin enablement config stored in electron-store. */
export interface PluginConfig {
  /** Map of plugin name → enabled state. Missing = disabled by default. */
  enabled: Record<string, boolean>;
  /** Custom plugin directories to scan (in addition to default). */
  extraDirs: string[];
}

// ── Manifest Validation ────────────────────────────────────────

const VALID_PERMISSIONS: Set<string> = new Set([
  'tools:register', 'tools:call',
  'config:read', 'config:write',
  'fs:read', 'fs:write',
]);

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate a plugin manifest. Returns error message or null if valid.
 */
export function validateManifest(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') {
    return 'Manifest must be a JSON object';
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.name !== 'string' || !NAME_PATTERN.test(m.name)) {
    return `Invalid name: must be lowercase alphanumeric + hyphens, got "${String(m.name)}"`;
  }
  if (typeof m.version !== 'string' || !m.version) {
    return 'Missing or invalid "version" field';
  }
  if (typeof m.description !== 'string' || !m.description) {
    return 'Missing or invalid "description" field';
  }
  if (typeof m.entry !== 'string' || !m.entry) {
    return 'Missing or invalid "entry" field';
  }
  if (typeof m.minBptVersion !== 'string') {
    return 'Missing "minBptVersion" field';
  }

  // Validate permissions array
  if (!Array.isArray(m.permissions)) {
    return '"permissions" must be an array';
  }
  for (const perm of m.permissions) {
    if (!VALID_PERMISSIONS.has(perm as string)) {
      return `Unknown permission: "${String(perm)}"`;
    }
  }

  // Entry file must not escape plugin directory
  if ((m.entry as string).includes('..') || (m.entry as string).startsWith('/')) {
    return `Entry point must be relative and cannot contain "..": "${m.entry as string}"`;
  }

  return null;
}
