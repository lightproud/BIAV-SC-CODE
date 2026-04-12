# BPT — Black Pool Terminal 子项目上下文

> 最后更新：2026-04-12 by 主控台（记忆反思管理）
> 给未来 AI 会话的断档补救文件。新会话请先读这份。

## 这是什么

BPT (Black Pool Terminal) 是 B.I.A.V. Studio 的母版 AI 终端，用来替代公司内网的 Qoder。
核心范式是 Claude Code 式的对话型 agentic 工作流，但深度绑定了银芯（Silver Core）记忆系统和黑池（Black Pool）数据。

## 历史关系

| 项目 | 状态 | 说明 |
|------|------|------|
| `projects/biav/` | 已废 | 旧 PWA 快照 v0.16.0，不再维护 |
| `projects/biav-desktop/` | 已废 | 第一版 Electron 桌面端，死于 token 经济失控 + self-evolve 代码污染。**仅作参考材料，不复制代码** |
| `projects/bpt/` | **活跃** | 本项目，母版 |

## 技术栈

- Electron 33 + React 18 + Vite 6 + TypeScript 5 (strict)
- Tailwind CSS (BIAV 暗金主题)
- electron-store (配置持久化)
- better-sqlite3 (token 日志 + BPE 索引)
- @anthropic-ai/sdk (LLM 通信)
- MCP stdio 协议 (银芯工具)

## 核心设计原则

### Prime Directive: Token 经济纪律
biav-desktop 死因是 tool call token 占对话 80%。BPT 的 **所有架构决策** 都要向 token 经济妥协：
- tool schema 首轮发 + cache_control，后续必须命中 cache
- tool result > 2000 token 必截断
- history > 20 轮 或 > 60k token 触发压缩
- active tool set 按档位最小化

### Secondary Directive: 非程序员可维护
Light（制作人）不写代码，靠 AI 驱动搭建和维护。代码必须：
- 禁 `any`、禁 `as unknown as`
- 一文件一模块，无 helpers/utils 垃圾桶
- 注释写"为什么"不写"是什么"
- 禁止 self-evolve / 运行时动态代码加载

### 双引擎
- **Silver Core**: 银芯记忆/图谱/推荐。9 工具中 4 个走 MCP（LLM 能调用），5 个走直接调用（UI/系统用）
- **BPE (Black Pool Explorer)**: 海量代码(百万行 C#/Lua/Python/JS) + 配置(120 个 × 1-2MB JSON/Lua/CSV)的语义检索。Phase 0 用 FTS5 关键词，Phase 0.5 上 bge-m3 向量

### 档位 (Gear)
- **对话档 (chat)**: 4 个轻量工具，~1.5k token/turn
- **工作档 (work)**: 10 个完整工具，~4k token/turn

## 维护守则

1. **不要引入 monorepo / workspace / pnpm** — 单目录单 package.json
2. **不要搞 self-evolve 或运行时代码加载** — biav-desktop 教训
3. **不要让 LLM 自由搜索大仓库** — 用 BPE UI + @Cite 注入
4. **每次改 electron/ 下的 IPC 通道名，必须同步改 preload.ts 和 src/types.ts 的 IPC 常量**
5. **TypeScript strict 模式不可降级**

## 常见错误排障

| 症状 | 原因 | 解法 |
|------|------|------|
| MCP status 显示 disconnected | Python 环境没装 mcp 包 | `pip install mcp` in repo root |
| BPE status 显示 no index | .bpe-index 目录不存在 | `python scripts/bpe_indexer.py` (Phase 0.5) |
| Token meter cache rate < 80% (红灯) | 网关不支持 cache_control | 检查网关日志，确认 Anthropic SDK 透传 |
| electron:dev 启动白屏 | Vite dev server 没起来 | 检查 5173 端口占用 |
