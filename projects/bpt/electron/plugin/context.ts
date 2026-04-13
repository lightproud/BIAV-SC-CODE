/**
 * context.ts -- PluginContext API implementation.
 *
 * Why: The protocol defines a PluginContext interface that plugins use
 * to interact with BPT. This module creates that context object with
 * permission-gated methods. Each plugin gets its own context instance.
 */

import { getConfig, setConfig } from '../core/config';
import { logger } from '../core/logger';
import type { PluginManifest, PluginPermission } from './types';
import type { ToolDescriptor, Gear } from '../../src/types';

interface ContextInternals {
  /** The frozen context object given to the plugin. */
  context: PluginContextApi;
  /** Retrieve all tools registered during plugin init. */
  getRegisteredTools: () => ToolDescriptor[];
  /** Execute a tool handler registered by the plugin. */
  executeToolHandler: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * The API surface exposed to plugins via `bpt.*`.
 * Methods are permission-gated: calling without permission throws.
 */
interface PluginContextApi {
  /** Register a new tool. Requires: tools:register */
  registerTool: (descriptor: PluginToolDescriptor) => void;
  /** Register a handler function for a tool. Requires: tools:register */
  registerToolHandler: (toolName: string, handler: ToolHandler) => void;
  /** Read a config value. Requires: config:read */
  getConfig: (key: string) => unknown;
  /** Write a config value. Requires: config:write */
  setConfig: (key: string, value: unknown) => void;
  /** Log a message. Always allowed. */
  log: (level: string, message: string) => void;
  /** Plugin's own name. */
  pluginName: string;
}

/** Simplified tool descriptor for plugins (no source field). */
interface PluginToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  gears?: Gear[];
}

type ToolHandler = (input: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Create a PluginContext for a specific plugin.
 * Returns the context API and internal accessors.
 */
export function createPluginContext(manifest: PluginManifest): ContextInternals {
  const permissions = new Set<PluginPermission>(manifest.permissions);
  const registeredTools: ToolDescriptor[] = [];
  const toolHandlers = new Map<string, ToolHandler>();

  function requirePermission(perm: PluginPermission, action: string): void {
    if (!permissions.has(perm)) {
      throw new Error(
        `Plugin "${manifest.name}" lacks permission "${perm}" for: ${action}`,
      );
    }
  }

  const context: PluginContextApi = {
    pluginName: manifest.name,

    registerTool(descriptor: PluginToolDescriptor): void {
      requirePermission('tools:register', 'registerTool');

      // Namespace tool names to prevent collisions: plugin_name.tool_name
      const namespacedName = `${manifest.name}.${descriptor.name}`;

      const tool: ToolDescriptor = {
        name: namespacedName,
        description: `[${manifest.name}] ${descriptor.description}`,
        inputSchema: descriptor.inputSchema,
        source: 'plugin',
        gears: descriptor.gears ?? manifest.gears ?? [],
      };

      registeredTools.push(tool);
      logger.info(`plugin:${manifest.name}`, `Tool registered: ${namespacedName}`);
    },

    registerToolHandler(toolName: string, handler: ToolHandler): void {
      requirePermission('tools:register', 'registerToolHandler');
      const namespacedName = `${manifest.name}.${toolName}`;
      toolHandlers.set(namespacedName, handler);
    },

    getConfig(key: string): unknown {
      requirePermission('config:read', 'getConfig');
      return getConfig(key);
    },

    setConfig(key: string, value: unknown): void {
      requirePermission('config:write', 'setConfig');
      // Plugins can only write to a namespaced config key
      const namespacedKey = `plugin.${manifest.name}.${key}`;
      setConfig(namespacedKey, value);
    },

    log(level: string, message: string): void {
      const validLevels = ['info', 'warn', 'error'];
      const safeLevel = validLevels.includes(level) ? level : 'info';
      logger[safeLevel as 'info' | 'warn' | 'error'](
        `plugin:${manifest.name}`,
        message,
      );
    },
  };

  return {
    context,
    getRegisteredTools: () => [...registeredTools],
    executeToolHandler: async (toolName: string, input: Record<string, unknown>): Promise<unknown> => {
      const handler = toolHandlers.get(toolName);
      if (!handler) {
        throw new Error(`No handler registered for tool: ${toolName}`);
      }
      return Promise.resolve(handler(input));
    },
  };
}
