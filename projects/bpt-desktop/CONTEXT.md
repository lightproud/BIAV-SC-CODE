# BPT-DESKTOP — 黑池终端 桌面版

> 最后更新：2026-04-11 by Code-主控台
>
> Black Pool Terminal (Desktop) — B.I.A.V. Studio 开源版 AI 对话终端。
> 在银芯（BIAV-SC）仓库开发，内部专有需求通过插件扩展方式实现。

## 概述

Electron 桌面端 AI 对话应用。与 BPT-WEB（纯前端 PWA）共享品牌和视觉体系，
但桌面版具备系统级能力：托盘常驻、全局热键、本地数据库、文件系统访问、
MCP（Model Context Protocol）工具调用、自动更新等。

## 技术栈

- **桌面壳**：Electron 33（Chromium + Node.js）
- **前端**：React 18 + TypeScript + Vite 6
- **样式**：Tailwind CSS 3（BPT 暗金主题，色板前缀 `bpt-*` / CSS 变量 `--bpt-*`）
- **数据库**：sql.js（WASM SQLite，本地持久化，路径：用户数据目录）
- **设置存储**：electron-store（API Key 等敏感项）
- **自动更新**：electron-updater
- **MCP 集成**：`electron/mcp/client.ts` + `manager.ts`（连接外部 MCP 服务器）
- **i18n**：`src/lib/i18n.ts`，三语（zh / en / ja），默认中文
- **PDF 解析**：pdf-parse（用户拖入 PDF 时提取文本）
- **Markdown**：react-markdown + remark-gfm + remark-math + rehype-katex + highlight.js

## 文件清单

| 文件/目录 | 用途 |
|-----------|------|
| `electron/main.ts` | 主进程入口、窗口/托盘/全局热键创建 |
| `electron/preload.ts` | `contextBridge.exposeInMainWorld('bpt', ...)` IPC 桥 |
| `electron/ipc/` | 所有 IPC 处理器（chat / conversations / db / settings / files / mcp / hooks / styles / projects 等） |
| `electron/llm/` | LLM 提供商适配（claude / openai） |
| `electron/mcp/` | MCP 客户端与多服务器管理器 |
| `electron/tools/` | 内置工具（builtin / context-compression / hooks / system-prompt / tasks） |
| `electron/updater.ts` | 自动更新集成 |
| `electron/window-state.ts` | 窗口位置/大小持久化 |
| `src/App.tsx` | 主对话界面 |
| `src/QuickEntry.tsx` | 全局热键唤起的快捷输入窗 |
| `src/components/` | 所有 UI 组件 |
| `src/hooks/` | React hooks（useChat / useTheme / useLocale / useKeyboardShortcuts） |
| `src/lib/i18n.ts` | 多语言管理（localStorage key: `bpt-locale`） |
| `src/lib/locales/` | 语言包（zh.ts / en.ts / ja.ts） |
| `src/types.ts` | 类型定义，包括 `window.bpt` IPC 桥类型 |
| `index.html` | 主窗口 HTML 入口 |
| `quick-entry.html` | 快捷输入窗 HTML 入口 |
| `tailwind.config.js` | Tailwind 配置（`colors.bpt.*`） |
| `src/index.css` | 全局样式 + CSS 变量（`--bpt-*`） |
| `package.json` | 依赖、脚本、`build.appId` = `com.bpt.desktop`、`productName` = `BPT-DESKTOP` |
| `CONTEXT.md` | 本文件 |

## 启动方式

```bash
cd projects/bpt-desktop
npm install
npm run electron:dev           # 开发模式（Vite dev server + Electron）
npm run typecheck              # TypeScript 检查
npm run build                  # 生产构建 + electron-builder 打包
```

## 支持的 LLM 后端

| Provider | 说明 | 配置 |
|----------|------|------|
| Claude | Anthropic Messages API | 设置面板输入 API Key |
| OpenAI | OpenAI / 兼容网关 | 设置面板输入 API Key + Base URL |

API Key 通过 `electron-store` 加密存储在用户数据目录，不进入 git。

## 桌面能力

- **系统托盘**：关闭窗口最小化到托盘，不退出进程（macOS `e.preventDefault()` + `hide()`）
- **全局热键**：`Cmd/Ctrl+Shift+B` 唤起快捷输入窗
- **无边框标题栏**：macOS `hiddenInset`，Windows `titleBarOverlay`，Linux `hidden`
- **外部链接**：通过 `shell.openExternal` 在系统浏览器打开
- **本地通知**：对话完成且窗口未聚焦时弹出 Notification
- **文件拖拽**：支持拖入文本/PDF 作为消息附件
- **剪贴板历史**：监听剪贴板变化，保留近期内容
- **MCP 工具**：可连接多个 MCP 服务器，调用外部工具
- **自动更新**：electron-updater 检测新版本并下载

## 版本管理（严格执行）

修改功能并提交时，必须同步更新 3 处版本号：

1. `package.json` 的 `"version": "x.y.z"`
2. `package-lock.json` 的 `"version": "x.y.z"`（`name` 处 + `packages.""` 处）
3. 用户可见的版本文案（`src/components/WelcomeScreen.tsx` / `src/components/AboutModal.tsx` 当前硬编码为 `v0.1.0`，修改功能后需同步）

**版本规则**：修复 → patch +1；新功能 → minor +1；重大变更 → major +1。

## 架构定位

本项目是 **黑池终端（BPT）桌面版**。双系统架构下：

- **银芯（BIAV-SC）**：本仓库 = 公开层 + 方法论验证 + BPT 开源核心开发
- **黑池（BIAV-BP）**：内部层 = 商业数据 + 私有插件扩展
- **BPT-WEB / BPT-DESKTOP**：终端产品本体，核心开源在银芯，黑池专有能力通过**插件扩展**接入

桌面版的插件扩展点预留在：
- `electron/mcp/`：通过 MCP 协议加载外部工具服务器
- `electron/tools/`：内置工具加载器，可扩展新工具
- `electron/tools/hooks.ts`：Hook 系统，项目级 `.bpt/hooks.json` 配置

具体插件接口待 Phase 2 定型。

## localStorage / 存储命名空间

- 渲染进程 localStorage：`bpt-locale` 等以 `bpt-` 为前缀
- electron-store：默认 JSON 文件在用户数据目录（macOS `~/Library/Application Support/BPT-DESKTOP/`）
- SQLite：`bpt-desktop.db` 在用户数据目录
- 项目级配置：`<project>/.bpt/hooks.json`

## 验证清单

新会话启动时：
- [ ] 读根目录 `CLAUDE.md` 了解全局
- [ ] 读 `memory/project-status.md` 确认当前阶段
- [ ] 本地 `npm run typecheck` 无类型错误
- [ ] 本地 `npm run electron:dev` 能启动
- [ ] 如涉及 IPC 桥：`electron/preload.ts` 与 `src/types.ts` 的 `window.bpt` 类型保持同步
- [ ] 如涉及 Tailwind 色板：`tailwind.config.js` 的 `colors.bpt` 与 `src/index.css` 的 `--bpt-*` 变量保持同步

## 历史沿革

- 项目原名「缸中之脑」(Brain in a Vat)，目录 `projects/biav-desktop/`，`productName: "Brain in a Vat"`
- **v0.1.0（当前）**：更名「黑池终端 BPT-DESKTOP」，目录迁移至 `projects/bpt-desktop/`，`window.biav` → `window.bpt`，`biav-*` Tailwind 色板 → `bpt-*`，版本重置到 v0.1.0
