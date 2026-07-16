/**
 * Minimal engine collaborators for driving runAgentLoop in tests that only care
 * about the transport/error path (no tools, no hooks, no MCP). Mirrors the
 * inline fakes in engine.test.ts, extracted so other suites can reuse them.
 */

import type {
  AggregatedHookResult,
  HookRunner,
  McpRegistry,
  PermissionCheckResult,
  PermissionGate,
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
  async closeAll(): Promise<void> {}
}
