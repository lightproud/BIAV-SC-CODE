# Brain in a Vat - AI Chat Application

> 最后更新：2026-04-04 by Code-主控台

## 概述

缸中之脑内部 AI 对话应用，连接银芯（BIAV-SC）和黑池（BIAV-BP）双系统。
功能类似 Claude Desktop，支持多后端切换。

## 技术栈

- Next.js 14 App Router
- Tailwind CSS（BIAV 暗金主题）
- SQLite（better-sqlite3）
- SSE 流式传输

## 支持的 LLM 后端

| Provider | 说明 | 配置 |
|----------|------|------|
| Claude | Anthropic API | `ANTHROPIC_API_KEY` |
| OpenAI | OpenAI / 兼容 API | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |
| Ollama | 本地模型 | `OLLAMA_BASE_URL`（默认 localhost:11434） |

## 启动方式

```bash
cd projects/biav
cp .env.example .env  # 填入 API key
npm install
npm run dev
```

访问 http://localhost:3000

## 目录结构

```
src/
  app/           # Next.js App Router
    api/         # API routes (chat, conversations, models)
    layout.tsx   # Root layout
    page.tsx     # Main chat page
    globals.css  # BIAV dark-gold theme
  components/    # UI components
  hooks/         # React hooks (useChat)
  lib/           # Core logic
    llm/         # LLM provider abstraction
    db.ts        # SQLite database
    types.ts     # TypeScript types
```
