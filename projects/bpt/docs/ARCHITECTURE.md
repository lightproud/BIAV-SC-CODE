# BPT Architecture

## Layer Diagram

```
┌─────────────────────────────────────────────────┐
│ L5  Plugin Layer (Phase 2, protocol only now)    │
├─────────────────────────────────────────────────┤
│ L4  Renderer (React)                             │
│     ChatView / Sidebar / StatusBar               │
│     SilverPanel / BPEPanel                       │
│     TokenMeter / GearSwitch                      │
├─────────────────────────────────────────────────┤
│ L3  Conversation Engine                          │
│     LLM Provider + Claude Adapter                │
│     Streaming + Tool Loop                        │
│     History Compression + Result Truncation      │
│     Token Accounting (6-dim)                     │
├─────────────────────────────────────────────────┤
│ L2  Data Engines (dual)                          │
│  ┌──────────────────┐ ┌───────────────────────┐ │
│  │ Silver Core      │ │ BPE                   │ │
│  │ 4 MCP tools      │ │ FTS5 / Vector search  │ │
│  │ 5 direct tools   │ │ Haiku reranker        │ │
│  └──────────────────┘ └───────────────────────┘ │
├─────────────────────────────────────────────────┤
│ L1  Core Services                                │
│     IPC Trunk / Config / Logger / Token SQLite   │
├─────────────────────────────────────────────────┤
│ L0  Shell (Electron main)                        │
│     Window / Tray / Hotkey                       │
└─────────────────────────────────────────────────┘
```

## Data Access Model

### Silver Core (small, semantic)
- **Tier 1 Direct**: UI panels, system prompt injection, admin ops
- **Tier 2 MCP**: LLM-driven queries (4 tools only)

### Black Pool (large, raw)
- **BPE Panel**: UI-first, zero LLM cost
- **@Cite**: User selects → inject into conversation
- **2 narrow MCP tools**: bpe_semantic_search, bpe_lookup_symbol (hard result caps)

## Key Design Decisions

1. **Token economy as Prime Directive** — all architecture serves token discipline
2. **Gear-based tool filtering** — chat gear (4 tools) vs work gear (10 tools)
3. **UI-first search** — BPE panel, not LLM-driven grep
4. **No self-evolve** — lesson from biav-desktop failure
5. **Single package.json** — non-programmer maintainability
