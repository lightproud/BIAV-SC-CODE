/**
 * loader.ts -- Plugin scanner and lifecycle manager.
 *
 * Why: Scans the plugins directory for valid manifests, loads enabled
 * plugins, and manages their lifecycle (load/unload/enable/disable).
 *
 * Design:
 * - Scan `plugins/` dir at startup (+ configurable extra dirs)
 * - Validate each manifest.json against the protocol
 * - Only load plugins that are in the whitelist (explicit opt-in)
 * - Use sandboxed execution for plugin entry points
 * - Register plugin tools in the central tool registry
 */

import fs from 'node:fs';
import path from 'node:path';
import { getConfig, setConfig } from '../core/config';
import { registerTool, unregisterTool } from '../llm/tool-registry';
import { logger } from '../core/logger';
import { validateManifest } from './types';
import { createPluginSandbox } from './sandbox';
import type { PluginManifest, PluginInstance, PluginInfo, PluginConfig } from './types';
import { BPT_VERSION } from '../../src/version';

/** All known plugin instances, keyed by name. */
const plugins = new Map<string, PluginInstance>();

/**
 * Scan plugin directories and load enabled plugins.
 * Called once at startup from main.ts.
 */
export async function initPlugins(): Promise<void> {
  const pluginDirs = getPluginDirs();
  logger.info('plugin', 'Scanning for plugins', { dirs: pluginDirs });

  for (const dir of pluginDirs) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = path.join(dir, entry.name);
      const manifestPath = path.join(pluginDir, 'manifest.json');

      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        const error = validateManifest(parsed);

        if (error) {
          logger.warn('plugin', `Invalid manifest in ${entry.name}`, { error });
          plugins.set(entry.name, {
            manifest: { name: entry.name, version: '?', description: error, entry: '', permissions: [], minBptVersion: '' },
            dir: pluginDir,
            status: 'error',
            error: `Invalid manifest: ${error}`,
            tools: [],
          });
          continue;
        }

        const manifest = parsed as PluginManifest;

        // Version check
        if (!isVersionCompatible(manifest.minBptVersion, BPT_VERSION)) {
          const msg = `Requires BPT >= ${manifest.minBptVersion}, current is ${BPT_VERSION}`;
          logger.warn('plugin', `Plugin ${manifest.name} incompatible`, { msg });
          plugins.set(manifest.name, {
            manifest,
            dir: pluginDir,
            status: 'error',
            error: msg,
            tools: [],
          });
          continue;
        }

        // Check if plugin is enabled in whitelist
        const config = getPluginConfig();
        if (!config.enabled[manifest.name]) {
          plugins.set(manifest.name, {
            manifest,
            dir: pluginDir,
            status: 'disabled',
            tools: [],
          });
          logger.info('plugin', `Plugin ${manifest.name} found but not enabled`);
          continue;
        }

        // Load the plugin
        await loadPlugin(manifest, pluginDir);
      } catch (err) {
        logger.error('plugin', `Failed to process plugin at ${pluginDir}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const summary = [...plugins.values()].map((p) => `${p.manifest.name}:${p.status}`);
  logger.info('plugin', 'Plugin scan complete', { plugins: summary });
}

/**
 * Load a single plugin: execute its entry point in a sandbox,
 * collect registered tools, and add them to the tool registry.
 */
async function loadPlugin(manifest: PluginManifest, dir: string): Promise<void> {
  const entryPath = path.join(dir, manifest.entry);

  if (!fs.existsSync(entryPath)) {
    const msg = `Entry point not found: ${manifest.entry}`;
    plugins.set(manifest.name, { manifest, dir, status: 'error', error: msg, tools: [] });
    logger.error('plugin', `Plugin ${manifest.name}: ${msg}`);
    return;
  }

  try {
    const sandbox = await createPluginSandbox(manifest, dir);
    const instance: PluginInstance = {
      manifest,
      dir,
      status: 'running',
      tools: sandbox.tools,
      execute: sandbox.execute,
    };

    plugins.set(manifest.name, instance);

    // Register tools in the central registry
    for (const tool of sandbox.tools) {
      registerTool(tool);
      logger.info('plugin', `Registered tool "${tool.name}" from plugin ${manifest.name}`);
    }

    logger.info('plugin', `Plugin ${manifest.name} loaded`, {
      tools: sandbox.tools.map((t) => t.name),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    plugins.set(manifest.name, { manifest, dir, status: 'error', error: msg, tools: [] });
    logger.error('plugin', `Plugin ${manifest.name} failed to load`, { error: msg });
  }
}

/**
 * Enable a plugin by name. Adds it to the whitelist and loads it.
 */
export async function enablePlugin(name: string): Promise<boolean> {
  const instance = plugins.get(name);
  if (!instance) return false;

  const config = getPluginConfig();
  config.enabled[name] = true;
  setConfig('plugins', config);

  if (instance.status === 'disabled' || instance.status === 'error') {
    await loadPlugin(instance.manifest, instance.dir);
  }
  return true;
}

/**
 * Disable a plugin by name. Removes its tools and marks it disabled.
 */
export function disablePlugin(name: string): boolean {
  const instance = plugins.get(name);
  if (!instance) return false;

  // Unregister all tools from this plugin
  for (const tool of instance.tools) {
    unregisterTool(tool.name);
  }

  instance.status = 'disabled';
  instance.tools = [];
  instance.execute = undefined;

  const config = getPluginConfig();
  config.enabled[name] = false;
  setConfig('plugins', config);

  logger.info('plugin', `Plugin ${name} disabled`);
  return true;
}

/**
 * Get metadata for all known plugins (safe for renderer).
 */
export function listPlugins(): PluginInfo[] {
  return [...plugins.values()].map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    status: p.status,
    error: p.error,
    permissions: p.manifest.permissions,
    toolCount: p.tools.length,
    author: p.manifest.author,
  }));
}

/**
 * Get plugin instance by name (for tool execution routing).
 */
export function getPluginInstance(name: string): PluginInstance | undefined {
  return plugins.get(name);
}

/**
 * Find which plugin owns a given tool name.
 */
export function findPluginForTool(toolName: string): PluginInstance | undefined {
  for (const instance of plugins.values()) {
    if (instance.tools.some((t) => t.name === toolName)) {
      return instance;
    }
  }
  return undefined;
}

// ── Helpers ────────────────────────────────────────────────────

function getPluginDirs(): string[] {
  const config = getPluginConfig();
  const repoRoot = (getConfig('repoRoot') as string) || findRepoRoot();
  const defaultDir = path.join(repoRoot, 'projects', 'bpt', 'plugins');
  return [defaultDir, ...config.extraDirs];
}

function getPluginConfig(): PluginConfig {
  const raw = getConfig('plugins') as PluginConfig | undefined;
  return raw ?? { enabled: {}, extraDirs: [] };
}

/**
 * Simple semver comparison: is `current` >= `required`?
 * Only compares major.minor.patch (no pre-release).
 */
function isVersionCompatible(required: string, current: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const req = parse(required);
  const cur = parse(current);

  for (let i = 0; i < 3; i++) {
    const r = req[i] ?? 0;
    const c = cur[i] ?? 0;
    if (c > r) return true;
    if (c < r) return false;
  }
  return true; // Equal
}

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir);
  }
  return dir;
}
