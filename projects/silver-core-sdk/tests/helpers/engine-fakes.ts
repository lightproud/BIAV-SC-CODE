/**
 * Minimal engine collaborators for driving runAgentLoop in tests.
 *
 * These started as inline fakes in engine.test.ts. They were then pasted into
 * suite after suite — FakeMcp alone had 14 definitions across the tests/ tree
 * in 5 slightly different shapes (some with setServers, some without, differing
 * only in an error string nothing asserts). This module is now the one home:
 * add a method here when the contract grows, instead of hunting copies.
 */

import type {
  AggregatedHookResult,
  BuiltinTool,
  HookRunner,
  McpRegistry,
  PermissionCheckResult,
  PermissionGate,
  SessionStore,
  StoredSession,
} from '../../src/internal/contracts.js';
import type {
  CallToolResult,
  HookEvent,
  HookInput,
  McpServerStatus,
  PermissionMode,
  PermissionUpdate,
  SDKPermissionDenial,
} from '../../src/types.js';

/** Allow-everything permission gate. */
export class FakeGate implements PermissionGate {
  private mode: PermissionMode = 'default';
  async check(
    _toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionCheckResult> {
    return { decision: 'allow', updatedInput: input };
  }
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }
  getMode(): PermissionMode {
    return this.mode;
  }
  applyUpdates(_updates: PermissionUpdate[]): void {}
  denials(): SDKPermissionDenial[] {
    return [];
  }
}

/** No-op hook runner (no hooks registered for any event). */
export class FakeHookRunner implements HookRunner {
  hasHooks(_event: HookEvent): boolean {
    return false;
  }
  async run(_event: HookEvent, _input: HookInput): Promise<AggregatedHookResult> {
    return {
      continue: true,
      systemMessages: [],
      additionalContext: [],
    };
  }
}

/** Empty MCP registry (no servers, no tools). */
export class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(_qualifiedName: string): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'unexpected mcp call' }], isError: true };
  }
  async reconnect(_serverName: string): Promise<void> {}
  setEnabled(_serverName: string, _enabled: boolean): void {}
  async setServers() {
    return { servers: [] };
  }
  async closeAll(): Promise<void> {}
}

/** Session store that records appended entries and reads back as empty. */
export class FakeStore implements SessionStore {
  readonly entries = new Map<string, Array<Record<string, unknown>>>();
  append(sessionId: string, entry: Record<string, unknown>): void {
    const arr = this.entries.get(sessionId) ?? [];
    arr.push(entry);
    this.entries.set(sessionId, arr);
  }
  async load(): Promise<StoredSession | null> {
    return null;
  }
  async list(): Promise<StoredSession[]> {
    return [];
  }
  async latestSessionId(): Promise<string | null> {
    return null;
  }
}

/** Builtin tool that pushes each input it receives onto `executed`. */
export function recordingTool(
  name: string,
  executed: Array<Record<string, unknown>>,
  opts: { readOnly?: boolean; isFileEdit?: boolean } = {},
): BuiltinTool {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {} },
    readOnly: opts.readOnly ?? false,
    isFileEdit: opts.isFileEdit,
    async execute(input) {
      executed.push(input);
      return { content: `${name} ran` };
    },
  };
}
