# BPT Master Protocol v0

Canonical type definitions for the BPT ecosystem.

## Message Format

```typescript
interface Conversation {
  id: string;
  title: string;
  createdAt: number;  // epoch ms
  updatedAt: number;
  messages: Message[];
  gear: 'chat' | 'work';
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
  timestamp: number;
  tokenUsage?: TokenUsage;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | CiteBlock;
```

## LLM Provider Interface

```typescript
interface LlmProvider {
  name: string;
  stream(config: LlmRequestConfig, onEvent: (event: LlmStreamEvent) => void): Promise<void>;
  abort(): void;
}
```

All providers must support streaming and tool_use.

## Tool Descriptor

```typescript
interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  source: 'builtin' | 'mcp' | 'plugin';
  gears: Array<'chat' | 'work'>;  // empty = always active
}
```

## Silver Core API

9 tools, split across 2 access tiers:

| Tool | Tier | Gears |
|------|------|-------|
| memory_search | MCP | chat, work |
| graph_query | MCP | chat, work |
| graph_related_files | MCP | chat, work |
| store_facts | MCP | work |
| check_cache | Direct | - |
| memory_utility | Direct | - |
| recommend_context | Direct | - |
| rebuild_indexes | Direct | - |
| memory_writeback | Direct | - |

## Token Accounting

6-dimensional per-turn tracking:

```typescript
interface TokenUsage {
  system: number;      // system prompt tokens
  tools: number;       // tool schema tokens
  history: number;     // conversation history tokens
  generation: number;  // LLM output tokens
  cacheHit: number;    // tokens served from prompt cache
  cacheWrite: number;  // tokens written to prompt cache
  estimatedCostUsd: number;
}
```
