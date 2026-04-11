# BPT-WEB — 黑池终端 Web 版

> 最后更新：2026-04-11 by Code-主控台
>
> Black Pool Terminal (Web Edition) — B.I.A.V. Studio 开源版 AI 对话终端。
> 在银芯（BIAV-SC）仓库开发，内部专有需求通过插件扩展方式实现。

## 概述

单文件渐进式 Web 应用（PWA），无构建步骤。所有 UI / 逻辑 / 样式内联于 `index.html`，
配合 `sw.js` 离线缓存、`manifest.json` PWA 元数据即可独立运行。

适合场景：
- 直接部署到 GitHub Pages / 任意静态托管
- 浏览器访问即用，无需 npm install / 服务端
- 支持安装为 PWA，离线继续可读历史对话
- 团队内部通过 API 网关 + Token 共享配置，避免裸露 API Key

## 技术栈

- **前端**：原生 HTML + 内联 CSS + 内联 JS（单文件 ~4000 行）
- **存储**：`localStorage`（命名空间：`bpt-*`、`bpt-{user}-*`）
- **离线**：Service Worker（`sw.js`）+ Web App Manifest
- **Markdown**：marked@15 + highlight.js@11 + KaTeX（CDN 加载）
- **图表**：Chart.js（按需 lazy-load）
- **图形**：Mermaid（按需 lazy-load）
- **LLM**：Anthropic Messages API（SSE 流式）/ 可配置 OpenAI 兼容网关

## 文件清单

| 文件 | 用途 |
|------|------|
| `index.html` | 完整应用（UI + 状态 + LLM 调用 + 工具系统） |
| `sw.js` | Service Worker，离线缓存静态资源 |
| `manifest.json` | PWA 安装元数据 |
| `CHANGELOG.md` | 版本更新日志 |
| `CONTEXT.md` | 本文件 |

## 启动方式

```bash
# 任意静态服务器即可（必须 HTTP，不能 file://，否则 SW 失效）
cd projects/bpt-web
python -m http.server 8000
# 或
npx serve .
```

访问 `http://localhost:8000`。首次加载后可安装为 PWA。

## API 配置

应用启动后在设置面板配置：
- **直连模式**：填入 Anthropic / OpenAI API Key
- **网关模式**：填入内部 API 网关 URL + 网关 Token（团队部署推荐，避免泄露 Key）
- **用户隔离**：对话和记忆按用户名存储，切换账号自动加载

## 版本管理（严格执行）

修改 `index.html` 并提交时，**必须**同步更新 5 处版本号：

1. `const APP_VERSION = 'x.y.z'`（JS 常量，行 ~667）
2. `<div id="sidebar-footer">vx.y.z</div>`（侧边栏 HTML，行 ~463）
3. `sw.js` 的 `const SW_VERSION = 'x.y.z'`（触发 SW 更新清缓存）
4. `manifest.json` 的 `description` 字段中的版本（如有）
5. `CHANGELOG.md` 顶部添加新版本条目

**版本规则**：修复 → patch +1；新功能 → minor +1；重大变更 → major +1。

绝对禁止提交 `index.html` 功能改动但不更新版本号。

## 架构定位

本项目是 **黑池终端（BPT）开源版**。双系统架构下：

- **银芯（BIAV-SC）**：本仓库 = 公开层 + 方法论验证 + BPT 开源核心开发
- **黑池（BIAV-BP）**：内部层 = 商业数据 + 私有插件扩展
- **BPT-WEB / BPT-DESKTOP**：终端产品本体，核心开源在银芯，黑池专有能力通过**插件扩展**接入

插件扩展机制预留设计，具体接口待 Phase 2 定型。

## 验证清单

新会话启动时：
- [ ] 读根目录 `CLAUDE.md` 了解全局
- [ ] 读 `memory/project-status.md` 确认当前阶段
- [ ] 如修改 `index.html`，确认 5 处版本号同步更新
- [ ] 本地 `python -m http.server` 验证无报错再提交

## 历史沿革

- v0.0.1（MVP，已废弃）：初名「碧瓦」(BIVA)，部署 `/biva/`
- v0.1.0 ~ v0.16.0（已归档）：更名「缸中之脑」(Brain in a Vat)，迁移 `/biav/`，单文件 PWA 重写
- **v0.1.0（当前）**：更名「黑池终端」(Black Pool Terminal)，迁移 `/bpt-web/`，版本重置

详见 `CHANGELOG.md`。
