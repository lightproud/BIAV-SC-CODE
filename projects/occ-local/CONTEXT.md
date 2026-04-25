# OCC-LOCAL — 本地无账号 Claude Code CLI

> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 上游：[ruvnet/open-claude-code](https://github.com/ruvnet/open-claude-code) v2.0.0（2026-04-04）
> 引入动机：银芯需要一个可脱离 Anthropic 官方账号、对接本地模型的终端 AI 编码助手，用于无网环境/内部研究/制作人个人工作流。

## 概述

`occ-local` 是上游 open-claude-code 的**定向裁剪 + 本地化适配版**。保留其核心架构（async generator agent loop + 25 tools + MCP + 6 permission modes + hooks + sessions），剥离 archive 历史版本与营销素材，便于审阅与维护。

适合场景：
- 本地推理后端（Ollama / LM Studio / vLLM / llama.cpp server）+ 类 Claude Code 终端体验
- 银芯研究架构对照参考（对比 ghuntley 反混淆版、nano-claude-code）
- 无需 Anthropic 账号即可运行的 coding agent

## 技术栈

- **语言**：JavaScript ESM（纯 Node.js，无 TS 编译步骤）
- **运行时**：Node >= 18
- **UI**：Ink React TUI（交互模式）+ readline REPL（fallback）
- **依赖**：`ink` / `ink-spinner` / `ink-text-input` / `react`
- **协议**：Anthropic Messages API（默认）/ OpenAI Chat Completions（兼容 Ollama 等本地端点）/ Google Generative API
- **工具系统**：25 内建工具 + MCP（stdio/SSE/Streamable HTTP/WebSocket 四传输）
- **测试**：1,581 测试（上游维护）

## 文件清单

| 路径 | 来源 | 用途 |
|------|------|------|
| `v2/` | 上游 `v2/` 原样 | 核心源码、package.json、test |
| `docs/` | 上游 `docs/` 原样 | ADR 与架构说明 |
| `upstream-scripts/` | 上游 `scripts/` | 上游构建与发布脚本（非银芯使用） |
| `UPSTREAM-README.md` | 上游 `README.md` | 原始 README，保留归属 |
| `LICENSE` | 上游 `LICENSE` | MIT 许可证（必须保留） |
| `NOTICE` | 银芯新增 | 引入背景、归属声明、本地化策略 |
| `CONTEXT.md` | 银芯新增 | 本文件 |

**上游未引入**：`archive/`（35M 历史版本）、`assets/`（12M 截图素材）、`rudevolution/`（子模块空壳）、`.github/`（上游 CI）。

## 启动方式

### 本地无账号运行（OpenAI 兼容后端，方案 A）

```bash
# 1. 启动本地推理后端（以 Ollama 为例）
ollama pull qwen2.5-coder:14b
ollama cp qwen2.5-coder:14b gpt-4o    # 别名为 gpt- 前缀以触发 OpenAI 路径
ollama serve                          # 默认监听 http://localhost:11434

# 2. 安装依赖
cd projects/occ-local/v2
npm install

# 3. 注入环境变量
export OPENAI_API_KEY=sk-local-placeholder       # Ollama 不校验，填任意值
export OPENAI_BASE_URL=http://localhost:11434/v1
export CLAUDE_CODE_DISABLE_TELEMETRY=1

# 4. 启动（模型名必须触发 OpenAI 分支）
node src/index.mjs -m gpt-4o "explain this codebase"
```

### 使用官方 Anthropic（若守密人有 key）

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node src/index.mjs "hello"
```

## 职责边界（重要）

1. **不修改 `v2/src/` 原始源码**，以保持可随时 pull 上游更新的能力。
2. 银芯定制（模型前缀扩展 / OPENAI 流式补完 / Ollama 别名支持）以 **patch 文件**形式放在 `v2/patches/` 下，commit 时应用。
3. 若需深度改造，先在 `memory/decisions.md` 记录选项与权衡，守密人确认后再 fork。
4. **禁止** 在 `v2/` 下新增业务代码（避免污染上游骨架）。银芯业务扩展放在 `projects/occ-local/biav-ext/`（按需创建）。

## 当前状态

- **引入版本**：v2.0.0（上游 package.json 标注）/ v2.1.0（上游 README 标注，可能已有 npm publish）
- **银芯适配**：未开始。仅完成纯拷贝归档。
- **验证状态**：未在银芯环境实际运行过（需 Node 环境 + Ollama）

## 下一步候选任务

1. 编写 `v2/patches/001-detect-provider-local-prefix.patch` — 新增 `local/` 与 `ollama/` 模型前缀识别
2. 编写 `v2/patches/002-openai-streaming.patch` — 补完 `callOpenAI` 的流式路径
3. 产出 `v2/LOCAL-SETUP.md` — 银芯风格的本地部署指南（艾瑞卡语气）
4. 在银芯 MCP 服务器（`scripts/mcp_server.py`）旁挂接 occ-local 作为 MCP 客户端

## 验证清单

首次运行前必须确认：
- [ ] Node >= 18 可用
- [ ] 已执行 `cd v2 && npm install`
- [ ] 本地推理后端监听端口可达（`curl -s $OPENAI_BASE_URL/models` 返回列表）
- [ ] `CLAUDE_CODE_DISABLE_TELEMETRY=1` 已设置（银芯默认关闭遥测）
- [ ] `.claude/settings.local.json` 未包含外泄敏感数据（若使用自定义 agents/skills）

## 上游同步流程

若需拉取上游更新：
```bash
cd /tmp
git clone --depth 1 https://github.com/ruvnet/open-claude-code occ-upstream
diff -r occ-upstream/v2 projects/occ-local/v2   # 人工 review 差异
# 选择性同步，不直接 rsync 覆盖
```

## 相关档案

- 决策记录：`memory/decisions.md`（2026-04-14 引入条目）
- 项目状态：`memory/project-status.md`
- 同类仓库对比：艾瑞卡研究档案（`/root/.claude/plans/shiny-roaming-eclipse.md`）

## 合规声明

- 许可证：MIT（上游保留）。引入至银芯不改变其许可证状态。
- 上游基于 ruDevolution 对**已发布 npm 包**的分析，援引 US DMCA §1201(f) / EU Software Directive Art. 6 / UK CDPA §50B 作为合规依据，非基于 sourcemap 泄露源码。
- 守密人如对外分发基于此子项目的衍生版本，需保留 `LICENSE` 与 `NOTICE` 文件，并在衍生品中注明改动。
