# Changelog

## [0.2.0] - 2026-04-12

### Added
- **Tool-use loop**: LLM can now call tools and continue generating after receiving results (up to 10 iterations per turn)
- **Multi-turn conversation**: Main process maintains full conversation history; previous messages included in every LLM request
- **History compression**: Automatic compression when conversation exceeds 20 turns or 60k tokens
- **OpenAI-compatible provider**: New `openai.ts` adapter for company gateway and Chinese LLMs (DeepSeek, Qwen, GLM)
- **Settings panel**: Configure API endpoint, provider (Claude/OpenAI), model, API key from sidebar
- **@Cite end-to-end**: BPE panel search results can be cited into conversation with full context injection
- **SQLite conversation persistence**: Conversations and messages stored in SQLite, survive app restarts
- **ErrorBoundary**: Global error boundary catches React crashes with recovery UI
- **bpe_indexer.py**: BPE index builder with tree-sitter chunking (optional), FTS5 keyword index, bge-m3 vector embedding (optional)
- Model preset selector: Quick-switch between Claude Sonnet 4, Opus 4, Haiku 3.5, GPT-4o, GPT-4o-mini, DeepSeek V3, or custom model
- Pending cite badges above input area showing queued @Cite attachments
- Error banner in chat view with dismiss button
- Markdown rendering in assistant messages (react-markdown + remark-gfm)
- `conv:clearHistory` IPC for clearing conversation state
- `conv:rename` IPC for renaming conversations

### Changed
- `stream.ts` fully rewritten: now orchestrates tool loop, compression, multi-turn history
- `ChatView.tsx` rewritten: handles tool_result and assistant_continue events, proper content block tracking
- `ipc-trunk.ts` now uses SQLite for conversation CRUD (was electron-store)
- `main.ts` boot sequence updated: database init before window creation
- `BPEPanel.tsx` now accepts `onCite` prop for real citation injection
- `Sidebar.tsx` now includes Settings panel toggle
- `App.tsx` wraps in ErrorBoundary, manages @Cite state, supports Settings panel

### Known Issues
- BPE vector search requires bge-m3 model download and `pip install sentence-transformers` (FTS5 keyword fallback works without)
- tree-sitter chunking in bpe_indexer.py requires `pip install tree-sitter tree-sitter-{language}` (line-based fallback works without)
- No Artifacts panel yet
- No electron-builder packaging

### TODO (Phase 1+)
- Artifacts panel for long tool outputs
- Plugin loader implementation
- electron-builder packaging for SVN distribution
- 63 persona switching
- Dream visualization panel
- Sentinel alerting UI

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
