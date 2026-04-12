/**
 * memory-api.ts — Unified Silver Core API (strongly-typed TS wrapper).
 *
 * Why unify: The renderer doesn't need to know whether a silver core call
 * goes through MCP or direct Python. This module provides a single interface
 * that routes internally based on tool type.
 *
 * Routing:
 *   MCP (Tier 2): memory_search, graph_query, graph_related_files, store_facts
 *   Direct (Tier 1): check_cache, memory_utility, recommend_context, rebuild_indexes, memory_writeback
 */

import type { McpClient } from './mcp-client';
import type { SilverDirectClient } from './direct-client';
import type { SilverSearchResult, SilverGraphNode, SilverGraphNeighbor } from '../../src/types';

export class SilverCoreApi {
  constructor(
    private mcp: McpClient | null,
    private direct: SilverDirectClient | null,
  ) {}

  // ── MCP-routed tools (Tier 2) ─────────────────────────────

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

  // ── Direct-routed tools (Tier 1) ──────────────────────────

  async checkCache(query: string): Promise<unknown> {
    if (!this.direct) return { hit: false };
    const result = await this.direct.checkCache(query);
    return result.data;
  }

  async memoryUtility(topN: number = 10): Promise<unknown> {
    if (!this.direct) return { rankings: [] };
    const result = await this.direct.memoryUtility(topN);
    return result.data;
  }

  async recommendContext(query: string, role: string = ''): Promise<unknown> {
    if (!this.direct) return { recommended_files: [] };
    const result = await this.direct.recommendContext(query, role);
    return result.data;
  }

  async rebuildIndexes(): Promise<unknown> {
    if (!this.direct) return { error: 'Direct client not initialized' };
    const result = await this.direct.rebuildIndexes();
    return result.data;
  }

  async memoryWriteback(dryRun: boolean = false): Promise<unknown> {
    if (!this.direct) return { error: 'Direct client not initialized' };
    const result = await this.direct.memoryWriteback(dryRun);
    return result.data;
  }

  // ── Status ────────────────────────────────────────────────

  getStatus(): { mcpConnected: boolean; mcpTools: string[]; directAvailable: boolean } {
    return {
      mcpConnected: this.mcp?.isConnected() ?? false,
      mcpTools: this.mcp?.getTools().map((t) => t.name) ?? [],
      directAvailable: this.direct !== null,
    };
  }

  // ── Helpers ───────────────────────────────────────────────

  /**
   * MCP tool results come as { content: [{ type: 'text', text: '...' }] }.
   * The inner text is JSON from our Python tools. Parse it out.
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
