/**
 * tool-registry.ts — Central tool registry with gear-based filtering.
 *
 * Why a registry: Tools come from 3 sources (builtin/mcp/plugin) and must
 * be filtered by the current gear (chat/work). The registry is the single
 * place that answers "what tools should be in the next LLM request?"
 *
 * Why gear filtering matters: Behavioral steering. Chat gear is discussion
 * mode — the model should analyze and advise, not execute. Work gear is
 * execution mode. Removing write tools in chat reinforces the system prompt
 * guidance and prevents the model from acting when it should be thinking.
 */

import type { ToolDescriptor, Gear } from '../../src/types';

const registry: ToolDescriptor[] = [];

/**
 * Register a tool. Called during initialization by silver-ipc, bpe-ipc, etc.
 */
export function registerTool(tool: ToolDescriptor): void {
  // Prevent duplicates
  const existing = registry.findIndex((t) => t.name === tool.name);
  if (existing >= 0) {
    registry[existing] = tool;
  } else {
    registry.push(tool);
  }
}

/**
 * Get all tools active for the given gear.
 * Tools with empty gears[] are always active.
 */
export function getActiveTools(gear: Gear): ToolDescriptor[] {
  return registry.filter(
    (t) => t.gears.length === 0 || t.gears.includes(gear),
  );
}

/**
 * Get all registered tools regardless of gear.
 */
export function getAllTools(): ToolDescriptor[] {
  return [...registry];
}

/**
 * Remove a tool by name.
 */
export function unregisterTool(name: string): void {
  const idx = registry.findIndex((t) => t.name === name);
  if (idx >= 0) {
    registry.splice(idx, 1);
  }
}

/**
 * Register the default Silver Core MCP tools.
 * Called after MCP client connects and reports its tool list.
 */
export function registerSilverMcpTools(
  mcpTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): void {
  // Only register the 4 MCP-exposed tools. Others are direct-only.
  const allowedMcpTools = new Set([
    'memory_search',
    'graph_query',
    'graph_related_files',
    'store_facts',
  ]);

  for (const tool of mcpTools) {
    if (!allowedMcpTools.has(tool.name)) continue;

    // Assign gears: read tools = both gears, write tools = work only
    const gears: Gear[] = tool.name === 'store_facts'
      ? ['work']
      : ['chat', 'work'];

    registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      source: 'mcp',
      gears,
    });
  }
}

/**
 * Register BPE tools (always available in both gears).
 */
export function registerBpeTools(): void {
  registerTool({
    name: 'bpe_semantic_search',
    description: '搜索黑池代码和配置（语义搜索 + 关键词兜底）。返回 top-5 代码/配置切片。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言查询' },
        limit: { type: 'number', description: '返回结果数量，默认 5', default: 5 },
      },
      required: ['query'],
    },
    source: 'builtin',
    gears: ['chat', 'work'],
  });

  registerTool({
    name: 'bpe_lookup_symbol',
    description: '按符号名查找定义位置（精确匹配），返回代码上下文。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '符号名（函数名/类名/变量名）' },
        limit: { type: 'number', description: '最大返回数，默认 3', default: 3 },
      },
      required: ['name'],
    },
    source: 'builtin',
    gears: ['chat', 'work'],
  });
}
