# Brain in a Vat - Desktop Application

> 最后更新：2026-04-05 by Code-site

## 概述

缸中之脑桌面版 AI 对话应用。基于 Electron + React + Vite 构建，
连接银芯（BIAV-SC）和黑池（BIAV-BP）双系统。

## 技术栈

- Electron 33（Chromium 内核桌面壳）
- React 18 + TypeScript
- Vite 6（构建工具）
- Tailwind CSS（BIAV 暗金主题）
- SQLite（better-sqlite3，本地持久化）
- electron-store（设置存储）

## 支持的 LLM 后端

| Provider | 说明 | 配置 |
|----------|------|------|
| Claude | Anthropic API | 设置面板输入 API Key |
| OpenAI | OpenAI / 兼容 API | 设置面板输入 API Key + Base URL |

## 启动方式

```bash
cd projects/biav-desktop
npm install
npm run electron:dev
```

## 桌面能力

- 系统托盘（最小化到托盘）
- 全局快捷键 Cmd/Ctrl+Shift+B 唤起/隐藏
- macOS 隐藏式标题栏
- 外部链接在系统浏览器打开
- API Key 安全存储（electron-store）

## 目录结构

```
electron/
  main.ts          # Electron 主进程
  preload.ts       # IPC 桥接
  ipc/             # IPC 处理器
    chat.ts        # 对话流式处理
    conversations.ts # 对话 CRUD
    db.ts          # SQLite 数据库
    models.ts      # 模型列表
    settings.ts    # 设置管理
  llm/             # LLM 提供商
    index.ts       # 路由
    claude.ts      # Anthropic SDK
    openai.ts      # OpenAI SDK
src/               # React 渲染进程
  App.tsx          # 主界面
  components/      # UI 组件
  hooks/           # React hooks
  types.ts         # 类型定义
```
