# Changelog

## [0.1.0] - 2026-04-12

### Added
- L0 Shell: Electron window, system tray, global hotkey (Ctrl+Shift+B)
- L1 Core: IPC trunk, electron-store config, structured logger, token usage SQLite
- L2 Silver Core: MCP client (4 tools), direct Python client (5 tools), unified API
- L2 BPE: Index loader (SQLite FTS5), keyword search, symbol lookup, @Cite mechanism
- L3 Conversation: Claude LLM provider (streaming + tool_use + cache_control), token accounting (6-dim), tool registry with gear filtering, history compression
- L4 Renderer: ChatView, Sidebar, SilverPanel, BPEPanel, TokenMeter, GearSwitch, StatusBar
- Gear system: Chat (lightweight) / Work (full tools) with cost-aware switching
- Documentation: ARCHITECTURE.md, MASTER-PROTOCOL.md, PLUGIN-PROTOCOL.md

### Known Issues
- BPE vector search not implemented (Phase 0 uses FTS5 keyword fallback only)
- bpe_indexer.py not included (Phase 0.5)
- Conversation history is session-only (not persisted to SQLite yet)
- No Artifacts panel
- No multi-LLM backend (only Claude adapter)
- @Cite injection to conversation not wired end-to-end
- No electron-builder packaging

### TODO (Phase 0.5+)
- BPE vector search: bge-m3 + sqlite-vss
- bpe_indexer.py: tree-sitter chunking for C#/Lua/Python/JS, bge-m3 embedding
- Full conversation persistence (SQLite)
- Artifacts panel
- Multi-LLM backend (OpenAI, 国产 models)
- Plugin loader implementation
- electron-builder packaging for SVN distribution
