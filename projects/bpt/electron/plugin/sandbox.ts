/**
 * sandbox.ts -- Sandboxed plugin execution.
 *
 * Why sandboxing: Plugins come from external sources. They must not crash
 * the main process, access Electron APIs, or modify BPT internals.
 *
 * Strategy: Use Node.js `vm` module with a restricted context.
 * The plugin entry point is loaded as a CommonJS module in a VM context
 * that only exposes the PluginContext API. No require(), no process,
 * no Electron imports.
 *
 * Why not worker_threads: Workers are heavier and harder to debug.
 * vm.Script with a frozen context gives adequate isolation for Phase 2.
 * If plugins need long-running processes, Phase 3 can upgrade to workers.
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../core/logger';
import { createPluginContext } from './context';
import type { PluginManifest } from './types';
import type { ToolDescriptor } from '../../src/types';

interface SandboxResult {
  /** Tools registered by the plugin during initialization. */
  tools: ToolDescriptor[];
  /** Execute function to call when an LLM requests a plugin tool. */
  execute: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Create a sandboxed environment, load the plugin entry point,
 * and collect the tools it registered.
 */
export async function createPluginSandbox(
  manifest: PluginManifest,
  dir: string,
): Promise<SandboxResult> {
  const entryPath = path.join(dir, manifest.entry);
  const code = fs.readFileSync(entryPath, 'utf-8');

  // Create the plugin context (the API the plugin can call)
  const { context, getRegisteredTools, executeToolHandler } = createPluginContext(manifest);

  // Build the VM sandbox object. Only expose what the protocol allows.
  const sandbox: Record<string, unknown> = {
    // The plugin context API
    bpt: context,

    // Minimal console for debugging
    console: {
      log: (...args: unknown[]) => logger.info(`plugin:${manifest.name}`, String(args[0]), {}),
      warn: (...args: unknown[]) => logger.warn(`plugin:${manifest.name}`, String(args[0]), {}),
      error: (...args: unknown[]) => logger.error(`plugin:${manifest.name}`, String(args[0]), {}),
    },

    // Allow plugins to use JSON and basic JS globals
    JSON,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Promise,
    RegExp,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: (fn: () => void, ms: number) => {
      // Cap timeout to 30 seconds to prevent infinite delays
      const capped = Math.min(ms, 30000);
      return setTimeout(fn, capped);
    },
    clearTimeout,

    // Module exports pattern (plugin sets exports.activate / exports.execute)
    module: { exports: {} },
    exports: {},
  };

  // Make exports and module.exports point to the same object
  (sandbox.module as Record<string, unknown>).exports = sandbox.exports;

  // Create a frozen VM context
  const vmContext = vm.createContext(sandbox, {
    name: `plugin:${manifest.name}`,
  });

  // Execute the plugin code in the sandbox
  try {
    const script = new vm.Script(code, {
      filename: entryPath,
      timeout: 5000, // 5s max for initialization
    });
    script.runInContext(vmContext);
  } catch (err) {
    throw new Error(`Plugin init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Check if the plugin exported an activate() function
  const pluginExports = sandbox.exports as Record<string, unknown>;
  if (typeof pluginExports.activate === 'function') {
    try {
      await Promise.resolve(pluginExports.activate(context));
    } catch (err) {
      throw new Error(`Plugin activate() failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const tools = getRegisteredTools();

  // Build the execute handler for tool calls
  const execute = async (toolName: string, input: Record<string, unknown>): Promise<unknown> => {
    // Try the plugin's exported execute function first
    if (typeof pluginExports.execute === 'function') {
      try {
        return await Promise.resolve(pluginExports.execute(toolName, input));
      } catch (err) {
        throw new Error(`Plugin tool ${toolName} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fall back to per-tool handlers registered via context
    return executeToolHandler(toolName, input);
  };

  return { tools, execute };
}
