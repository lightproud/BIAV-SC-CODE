/**
 * memory-api.ts — Unified knowledge engine API (strongly-typed TS wrapper).
 *
 * Architecture change (2026-04-13): BPT Server runs locally, so all 11 tools
 * route through MCP. No more split between MCP (Tier 2) and direct Python
 * calls (Tier 1). The SilverDirectClient is no longer used.
 *
 * Why keep this wrapper: The renderer and tool-loop call typed methods here
 * instead of raw MCP callTool(). This isolates them from wire format changes.
 */

import type { McpClient } from './mcp-client';
import type { SilverSearchResult, SilverGraphNode, SilverGraphNeighbor } from '../../src/types';

export class SilverCoreApi {
  constructor(
    private mcp: McpClient | null,
  ) {}

  // ── Search & Query ────────────────────────────────────────

  async memorySearch(query: string, topK: number = 5): Promise<{
    query: string;
    results: SilverSearchResult[];
  }> {
    if (!this.mcp?.isConnected()) {
      return { query, results: [] };
    }
    const raw = await this.mcp.callTool('memory_search', { query, top_k: topK });
    return this.parseToolResult(raw);
  }

  async graphQuery(entity: string, depth: number = 1): Promise<{
    entity: SilverGraphNode;
    neighbors: SilverGraphNeighbor[];
    totalNeighbors: number;
  }> {
    if (!this.mcp?.isConnected()) {
      return { entity: { name: entity, type: 'unknown', properties: {} }, neighbors: [], totalNeighbors: 0 };
    }
    const raw = await this.mcp.callTool('graph_query', { entity, depth });
    const parsed = this.parseToolResult(raw);
    return {
      entity: parsed.entity ?? { name: entity, type: 'unknown', properties: {} },
      neighbors: parsed.neighbors ?? [],
      totalNeighbors: parsed.total_neighbors ?? 0,
    };
  }

  async graphRelatedFiles(entity: string): Promise<{
    entity: string;
    relatedFiles: Array<{ file: string; distance: number }>;
  }> {
    if (!this.mcp?.isConnected()) {
      return { entity, relatedFiles: [] };
    }
    const raw = await this.mcp.callTool('graph_related_files', { entity });
    const parsed = this.parseToolResult(raw);
    return {
      entity,
      relatedFiles: parsed.related_files ?? [],
    };
  }

  async storeFacts(facts: Array<{ content: string; category?: string }>): Promise<unknown> {
    if (!this.mcp?.isConnected()) {
      return { error: 'MCP not connected' };
    }
    return this.mcp.callTool('store_facts', { facts: JSON.stringify(facts) });
  }

  // ── Management & Utility ──────────────────────────────────

  async checkCache(query: string): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { hit: false };
    const raw = await this.mcp.callTool('check_cache', { query });
    return this.parseToolResult(raw);
  }

  async memoryUtility(topN: number = 10): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { rankings: [] };
    const raw = await this.mcp.callTool('memory_utility', { top_n: topN });
    return this.parseToolResult(raw);
  }

  async recommendContext(query: string, role: string = ''): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { recommended_files: [] };
    const raw = await this.mcp.callTool('recommend_context', { query, role });
    return this.parseToolResult(raw);
  }

  async rebuildIndexes(): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { error: 'MCP not connected' };
    const raw = await this.mcp.callTool('rebuild_indexes', {});
    return this.parseToolResult(raw);
  }

  async memoryWriteback(dryRun: boolean = false): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { error: 'MCP not connected' };
    const raw = await this.mcp.callTool('memory_writeback', { dry_run: dryRun });
    return this.parseToolResult(raw);
  }

  async sessionBriefing(role: string = ''): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { error: 'MCP not connected' };
    const raw = await this.mcp.callTool('session_briefing', { role });
    return this.parseToolResult(raw);
  }

  async characterPersona(character: string = 'erica', action: string = 'prompt'): Promise<unknown> {
    if (!this.mcp?.isConnected()) return { error: 'MCP not connected' };
    const raw = await this.mcp.callTool('character_persona', { character, action });
    return this.parseToolResult(raw);
  }

  // ── Status ────────────────────────────────────────────────

  getStatus(): { mcpConnected: boolean; mcpTools: string[] } {
    return {
      mcpConnected: this.mcp?.isConnected() ?? false,
      mcpTools: this.mcp?.getTools().map((t) => t.name) ?? [],
    };
  }

  // ── Helpers ───────────────────────────────────────────────

  /**
   * MCP tool results come as { content: [{ type: 'text', text: '...' }] }.
   * The inner text is JSON from the Python server. Parse it out.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseToolResult(raw: unknown): any {
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as { content?: Array<{ type: string; text?: string }> };
    const textBlock = r.content?.find((c) => c.type === 'text');
    if (!textBlock?.text) return {};
    try {
      return JSON.parse(textBlock.text);
    } catch {
      return { rawText: textBlock.text };
    }
  }
}
