# BPT-NEXT — 新一代黑池终端（基于 claw-code）

> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 上游：[instructkr/claw-code](https://github.com/instructkr/claw-code) / [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code)
> 引入时间：2026-04-14，分支 `claude/bpt-next-bootstrap-Q41x3`
> **重要**：上游无 LICENSE 文件，法律风险已在 `NOTICE` 中详述，守密人已明示接受。

## 概述

新一代黑池终端（BPT）的底座，基于 claw-code 的 Rust 实现。选型理由：
- **多 provider 原生支持**：Anthropic / OpenAI-compatible / xAI / DashScope / OpenRouter
- **本地模型开箱即用**：Ollama / 任意 OpenAI-compat 本地端点（vLLM / LM Studio / llama.cpp）
- **前缀路由**：模型名 `openai/gpt-4.1-mini` / `qwen/qwen-max` / `llama3.2` 自动选 backend
- **企业代理**：原生 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`
- **PARITY 严谨**：48,599 行 Rust + 2,568 行测试 + 10 脚本化场景 mock parity harness
- **5 层配置链** + 用户别名定制
- **哲学契合**：humans set direction; claws perform the labor（与 BIAV 双系统理念共鸣）

## 技术栈

- **主运行时**：Rust（9 crates，~48K 行）
- **镜像参考**：Python 3.x（`src/` 目录，port 模式）
- **构建**：`cargo build --workspace`，产物 `rust/target/debug/claw`
- **测试**：`cargo test --workspace`，含 mock parity harness
- **容器**：`Containerfile` 提供容器优先工作流

## 文件清单

| 路径 | 来源 | 用途 |
|------|------|------|
| `rust/` | 上游原样 | 9 crates Rust 核心（api / commands / compat-harness / mock-anthropic-service / plugins / runtime / rusty-claude-cli / telemetry / tools） |
| `src/` | 上游原样 | Python 镜像层（参考实现，非主运行时） |
| `tests/` | 上游原样 | 验证 surface |
| `docs/` | 上游原样 | 容器工作流文档 |
| `README.md` | 上游原样 | 英文快速上手 |
| `USAGE.md` | 上游原样 | **英文详尽操作指南（艾瑞卡推荐首读）** |
| `PHILOSOPHY.md` | 上游原样 | 项目哲学（autonomous claws / Discord-native） |
| `PARITY.md` | 上游原样 | Rust port 对等状态 |
| `ROADMAP.md` | 上游原样 | 未来路线图（85K 内容） |
| `UPSTREAM-CLAUDE.md` | 上游 CLAUDE.md 改名 | 上游自己的 Claude Code 指引（避免与 BIAV 根目录 CLAUDE.md 混淆） |
| `install.sh` | 上游原样 | 上游安装脚本 |
| `Containerfile` | 上游原样 | 容器构建脚本 |
| `.claude.json` / `.gitignore` / `.clawd-todos.json` | 上游原样 | 上游元数据 |
| `NOTICE` | BIAV 新增 | **版权风险声明（必读）** |
| `CONTEXT.md` | BIAV 新增 | 本文件 |
| `LOCAL-SETUP-ZH.md` | BIAV 新增 | 艾瑞卡语气中文启动指南 |

**未引入**：`.git/`（完整历史）、`assets/`（5M 品牌图片）、`.github/`（上游 CI）

## 启动方式

### 前置要求

- Rust toolchain（rustup + cargo，稳定版）
- 推荐：macOS / Linux / Windows（PowerShell / Git Bash / WSL 都可）

### 最快上手（Anthropic）

```bash
cd projects/bpt-next/rust
cargo build --workspace

export ANTHROPIC_API_KEY="sk-ant-..."
./target/debug/claw doctor                  # 健康检查
./target/debug/claw prompt "say hello"
./target/debug/claw                         # 进入交互 REPL
```

### 本地 Ollama

```bash
cd projects/bpt-next/rust
cargo build --workspace

export OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
unset OPENAI_API_KEY
./target/debug/claw --model "llama3.2" prompt "summarize this repo"
```

### 其他后端

- **OpenRouter**：`OPENAI_BASE_URL=https://openrouter.ai/api/v1` + `OPENAI_API_KEY=sk-or-v1-*`，模型如 `openai/gpt-4.1-mini`
- **xAI Grok**：`XAI_API_KEY`，模型 `grok` / `grok-3` / `grok-mini`
- **阿里 DashScope**：`DASHSCOPE_API_KEY`，模型 `qwen/qwen-max` 或 `qwen-plus`（自动路由）
- **Anthropic 兼容代理**：`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`

详细示例见 `LOCAL-SETUP-ZH.md`（中文）或 `USAGE.md`（英文）。

## 职责边界（重要）

1. **不修改上游 `rust/` 与 `src/` 源码**，保持可同步上游的能力
2. BIAV 定制走**配置文件**，不改代码：
   - 项目级：`projects/bpt-next/.claw/settings.json`
   - 用户级：`~/.claw.json` 或 `~/.config/claw/settings.json`
3. 若需代码改动，先在 `memory/decisions.md` 提出决策选项，守密人批准后再改
4. **禁止**将本子项目的修改推送到上游 claw-code 仓库
5. **禁止**在外部渠道（社群发帖 / 社交媒体 / PR）推广 bpt-next 作为 claw-code 的衍生品——直到上游明确 LICENSE
6. 上游 LICENSE 若明确 MIT/Apache/BSD，立即更新 NOTICE 并考虑是否开放推广

## 当前状态

- **引入状态**：初始引入完成（2026-04-14），上游源码未修改
- **构建状态**：**未验证**（Rust toolchain 尚未在银芯环境测试过 `cargo build`）
- **BIAV 定制**：未开始
- **与 BPT 其他变体的关系**：bpt-web / bpt-desktop / bpt 母版暂时共存，不归档；待 bpt-next 成熟后再讨论收敛

## 验证清单

首次使用前：
- [ ] Rust toolchain 可用：`cargo --version` 返回正确版本
- [ ] `cd rust && cargo build --workspace` 成功编译（大约需要 10-20 分钟）
- [ ] `./target/debug/claw doctor` 通过所有健康检查
- [ ] 已设置至少一个 provider 的认证（见启动方式）
- [ ] `./target/debug/claw prompt "ping"` 能获得响应

如改动 BIAV 层文档：
- [ ] 同步更新 `memory/project-status.md`
- [ ] 同步更新 `memory/decisions.md`（若涉及决策）

## 下一步候选任务

1. 守密人本地执行 `cargo build` 验证可编译
2. 写 BIAV 项目级 `.claw/settings.json` 模板（常用 provider + 别名）
3. 整理 `ROADMAP.md`（85K 内容）的中文摘要到 `memory/claw-roadmap-zh.md`
4. 向 `instructkr/claw-code` 提 Issue 请求 LICENSE 明确化
5. 评估是否将 `projects/bpt/` / `projects/bpt-web/` / `projects/bpt-desktop/` 归档

## 上游同步策略

若需 pull 上游更新：
```bash
cd /tmp
git clone --depth 1 https://github.com/instructkr/claw-code claw-upstream
diff -r --brief \
  --exclude='.git' --exclude='assets' --exclude='.github' \
  claw-upstream projects/bpt-next
# 人工 review 差异，选择性 rsync 同步
```

## 相关档案

- 版权风险声明：`NOTICE`（必读）
- 中文启动指南：`LOCAL-SETUP-ZH.md`
- 英文详尽指南：`USAGE.md`
- 上游哲学：`PHILOSOPHY.md`
- 决策记录：`memory/decisions.md`（2026-04-14 条目）
- 原计划（已废止）：`memory/bpt-next-design.md`（基于 occ-local 的旧方案，已封存）
- 研究档案：`/root/.claude/plans/shiny-roaming-eclipse.md`

## 合规与风险

| 项 | 状态 |
|----|------|
| 上游 LICENSE | **缺失** |
| 默认版权归属 | **All Rights Reserved（上游作者）** |
| 守密人风险接受 | 已明示（2026-04-14） |
| 对外发布许可 | **禁止**（至上游 LICENSE 明确前） |
| 内部 BIAV 使用 | 允许（守密人自担风险） |
| Anthropic 商标 | Claude / Claude Code 为 Anthropic PBC 商标，本项目非官方 |
