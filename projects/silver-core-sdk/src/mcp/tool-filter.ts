/**
 * Read-side MCP registry decorator hiding fully-denied tools (extracted from
 * query.ts, audit 2026-07-10 P2-3). Hidden tools disappear from allTools()
 * (never advertised to the model) and has() (execution refuses), while every
 * pass-through member delegates verbatim.
 */

import type {
  CallToolResult,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpServerStatus,
} from '../types.js';
import type { McpRegistry, McpToolEntry } from '../internal/contracts.js';

/**
 * McpRegistry decorator that hides tools matched by bare-name disallowedTools
 * entries so the model never sees their definitions (audit v0.1.1 P0). A tool
 * whose qualified name matches a bare disallowed pattern is dropped from
 * allTools() (which feeds the request's tool list and the init message) and
 * reported as absent by has() (so a hallucinated call yields "No such tool"
 * rather than executing). Scoped `Tool(spec)` deny rules are NOT applied here;
 * they remain call-time gate decisions.
 */
export class ToolFilterMcpRegistry implements McpRegistry {
  constructor(
    private readonly inner: McpRegistry,
    private readonly hidden: (qualifiedName: string) => boolean,
  ) {}
  connectAll(): Promise<void> {
    return this.inner.connectAll();
  }
  statuses(): McpServerStatus[] {
    // A fully-denied tool is hidden from allTools()/has(); drop it from each
    // server's per-tool status list too, or the status would advertise a tool
    // whose execution refuses. Qualified name is `mcp__<server>__<tool>`.
    return this.inner.statuses().map((s) =>
      s.tools === undefined
        ? s
        : { ...s, tools: s.tools.filter((t) => !this.hidden(`mcp__${s.name}__${t.name}`)) },
    );
  }
  allTools(): McpToolEntry[] {
    return this.inner.allTools().filter((t) => !this.hidden(t.qualifiedName));
  }
  has(qualifiedName: string): boolean {
    if (this.hidden(qualifiedName)) return false;
    return this.inner.has(qualifiedName);
  }
  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    return this.inner.call(qualifiedName, args, signal);
  }
  listResources(server: string | undefined, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.listResources(server, signal);
  }
  readResource(server: string, uri: string, signal: AbortSignal): Promise<McpResourceContent[]> {
    return this.inner.readResource(server, uri, signal);
  }
  readResourceDir(server: string, uri: string, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.readResourceDir(server, uri, signal);
  }
  reconnect(serverName: string): Promise<void> {
    return this.inner.reconnect(serverName);
  }
  setEnabled(serverName: string, enabled: boolean): void {
    this.inner.setEnabled(serverName, enabled);
  }
  setServers(servers: Record<string, McpServerConfig>): Promise<void> {
    return this.inner.setServers(servers);
  }
  closeAll(): Promise<void> {
    return this.inner.closeAll();
  }
}
