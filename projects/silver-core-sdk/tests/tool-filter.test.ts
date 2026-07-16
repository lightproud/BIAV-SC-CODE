/**
 * ToolFilterMcpRegistry: a read-side decorator that hides fully-denied MCP
 * tools. Bug-fix 2026-07-15 — statuses() must drop hidden tools from each
 * server's per-tool list too, consistent with allTools()/has().
 */

import { describe, expect, it } from 'vitest';

import { ToolFilterMcpRegistry } from '../src/mcp/tool-filter.js';
import type { McpRegistry, McpToolEntry } from '../src/internal/contracts.js';
import type { McpServerStatus } from '../src/types.js';

/** Minimal inner registry exposing one server with two tools. */
function innerWith(status: McpServerStatus, tools: McpToolEntry[]): McpRegistry {
  const notImpl = () => {
    throw new Error('not used in this test');
  };
  return {
    connectAll: async () => {},
    statuses: () => [status],
    allTools: () => tools,
    has: (q: string) => tools.some((t) => t.qualifiedName === q),
    call: notImpl as McpRegistry['call'],
    listResources: notImpl as McpRegistry['listResources'],
    readResource: notImpl as McpRegistry['readResource'],
    readResourceDir: notImpl as McpRegistry['readResourceDir'],
    reconnect: async () => {},
    setEnabled: () => {},
    setServers: async () => {},
    closeAll: async () => {},
  };
}

describe('ToolFilterMcpRegistry.statuses hides denied tools', () => {
  it('drops a hidden tool from the per-server status.tools list', () => {
    const status: McpServerStatus = {
      name: 'gh',
      status: 'connected',
      tools: [{ name: 'get_me' }, { name: 'delete_repo' }],
    };
    const inner = innerWith(status, [
      { qualifiedName: 'mcp__gh__get_me' } as McpToolEntry,
      { qualifiedName: 'mcp__gh__delete_repo' } as McpToolEntry,
    ]);
    const filtered = new ToolFilterMcpRegistry(
      inner,
      (q) => q === 'mcp__gh__delete_repo',
    );

    // allTools()/has() already hid it; statuses() must agree now.
    expect(filtered.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__gh__get_me']);
    expect(filtered.has('mcp__gh__delete_repo')).toBe(false);
    const reported = filtered.statuses()[0]!.tools!.map((t) => t.name);
    expect(reported).toEqual(['get_me']);
  });

  it('leaves a server with no denied tools untouched', () => {
    const status: McpServerStatus = {
      name: 'srv',
      status: 'connected',
      tools: [{ name: 'a' }, { name: 'b' }],
    };
    const inner = innerWith(status, []);
    const filtered = new ToolFilterMcpRegistry(inner, () => false);
    expect(filtered.statuses()[0]!.tools!.map((t) => t.name)).toEqual(['a', 'b']);
  });
});
