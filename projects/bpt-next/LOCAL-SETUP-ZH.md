# 本地启动指南（艾瑞卡版）

> 档案编号：BPT-NEXT-SETUP-ZH
> 最后更新：2026-04-14
> 维护者：Code-主控台（艾瑞卡）
>
> 守密人，档案就位。艾瑞卡将引导本地部署流程。
> 上游为英文 `USAGE.md`（366 行），本档案为艾瑞卡提炼的中文速查版。详细场景仍以 `USAGE.md` 为准。

## 前置档案核验

1. **Rust 工具链**：`cargo --version` 应返回有效数字。若无：
   - macOS / Linux：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
   - Windows：前往 <https://rustup.rs/> 下载安装器
   - 重启终端后复核

2. **网络**：若处于公司内网代理下，先设置：
   ```bash
   export HTTPS_PROXY="http://proxy.corp.example:3128"
   export HTTP_PROXY="http://proxy.corp.example:3128"
   export NO_PROXY="localhost,127.0.0.1,.corp.example"
   ```

## 构建档案（首次运行必须）

```bash
cd projects/bpt-next/rust
cargo build --workspace
```

艾瑞卡预警：首次构建约消耗 10-20 分钟（取决于硬件与网络）。产物位于 `rust/target/debug/claw`。

## 情境一：连接 Anthropic 官方 API

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
cd projects/bpt-next/rust
./target/debug/claw doctor                  # 健康检查
./target/debug/claw prompt "say hello"      # 一次性 prompt
./target/debug/claw                         # 进入 REPL
```

艾瑞卡提醒：`ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` **不可互换**：
- `sk-ant-*` 格式 → `ANTHROPIC_API_KEY`（走 `x-api-key` 头）
- OAuth bearer token → `ANTHROPIC_AUTH_TOKEN`（走 `Authorization: Bearer` 头）

填错会得到 `401 Invalid bearer token`。

## 情境二：本地 Ollama（无账号）

```bash
# 1. 启动 Ollama 并拉取模型
ollama pull llama3.2
ollama serve    # 默认监听 http://127.0.0.1:11434

# 2. 指向 Ollama 的 OpenAI 兼容端点
export OPENAI_BASE_URL="http://127.0.0.1:11434/v1"
unset OPENAI_API_KEY

# 3. 启动 claw，模型名直接用 Ollama 的 tag
cd projects/bpt-next/rust
./target/debug/claw --model "llama3.2" prompt "用一句话总结此仓库"
```

艾瑞卡注解：claw 的前缀路由允许 `llama3.2` 这样的 bare 模型名直接透传——无需像其他工具那样把模型别名成 `gpt-4o`。

## 情境三：OpenRouter（多模型聚合）

```bash
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_API_KEY="sk-or-v1-..."

cd projects/bpt-next/rust
./target/debug/claw --model "openai/gpt-4.1-mini" prompt "hello"
./target/debug/claw --model "anthropic/claude-sonnet-4.5" prompt "hello"
```

## 情境四：本地 OpenAI 兼容服务器（vLLM / LM Studio / llama.cpp server）

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8000/v1"
export OPENAI_API_KEY="local-placeholder"

cd projects/bpt-next/rust
./target/debug/claw --model "qwen2.5-coder" prompt "回复 ready"
```

## 情境五：阿里 DashScope（Qwen 通义千问）

```bash
export DASHSCOPE_API_KEY="sk-..."

cd projects/bpt-next/rust
./target/debug/claw --model "qwen/qwen-max" prompt "你好"
./target/debug/claw --model "qwen-plus" prompt "你好"
```

艾瑞卡注解：模型名以 `qwen/` 或 `qwen-` 开头会**自动路由**到 DashScope 兼容模式端点，无需手动设置 `OPENAI_BASE_URL`。

## 情境六：xAI Grok

```bash
export XAI_API_KEY="xai-..."
cd projects/bpt-next/rust
./target/debug/claw --model "grok" prompt "status"
```

## 情境七：Anthropic 兼容本地代理

若运行一个本地 Anthropic-compatible 代理（如 `claude-code-proxy`）：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8080"
export ANTHROPIC_AUTH_TOKEN="local-dev-token"

cd projects/bpt-next/rust
./target/debug/claw --model "claude-sonnet-4-6" prompt "reply with ready"
```

## 常用 CLI 参数

| 参数 | 说明 |
|------|------|
| `--model <name>` | 选模型（opus / sonnet / haiku / grok / qwen-plus / llama3.2 / ...） |
| `--permission-mode <mode>` | 权限：`read-only` / `workspace-write` / `danger-full-access` |
| `--allowedTools <list>` | 工具白名单，逗号分隔（如 `read,glob`） |
| `--output-format json` | 脚本化输出（非交互） |
| `--resume latest` | 恢复最近 session |
| `prompt "..."` | 一次性 prompt |
| `doctor` | 健康检查 |
| `status` / `sandbox` / `agents` / `mcp` / `skills` | 各类状态查询 |

## REPL 交互指令

进入 REPL 后（直接执行 `./target/debug/claw`）可用：

| 指令 | 功能 |
|------|------|
| `/doctor` | 健康检查 |
| `/status` | 当前状态 |
| `/cost` | 本次 session 成本估算 |
| `/config` | 显示当前配置 |
| `/session` | session 管理 |
| `/model <name>` | 会话中切换模型 |
| `/permissions` | 查看/修改权限模式 |
| `/export` | 导出 session |
| `/help` | 所有命令 |

## 配置文件优先级（后覆盖前）

1. `~/.claw.json`
2. `~/.config/claw/settings.json`
3. `<repo>/.claw.json`
4. `<repo>/.claw/settings.json`
5. `<repo>/.claw/settings.local.json`（gitignore，放本地凭据）

### 建议的 BIAV 项目级配置模板

在 `projects/bpt-next/.claw/settings.json` 放（艾瑞卡未自动创建，守密人按需添加）：

```json
{
  "aliases": {
    "fast": "haiku",
    "smart": "opus",
    "local": "llama3.2",
    "cheap": "grok-mini"
  }
}
```

敏感凭据放 `.claw/settings.local.json`（artifact 应加入 `.gitignore`）。

## Session 持久化

REPL 的每轮对话自动落盘到当前工作目录的 `.claw/sessions/` 下。

恢复最近 session：
```bash
./target/debug/claw --resume latest
```

恢复并附加命令：
```bash
./target/debug/claw --resume latest /status /diff
```

## 故障排查

| 症状 | 根因 | 修正 |
|------|------|------|
| `401 Invalid bearer token` + `sk-ant-*` 在 Bearer 槽 | env var 用错 | 把 key 移到 `ANTHROPIC_API_KEY` |
| `cargo build` 失败 | Rust 版本过旧 | `rustup update stable` |
| 提示缺 Anthropic 凭据但已设 OpenAI key | 模型名未加前缀 | 用 `--model openai/gpt-4o` 或其他带前缀的名字 |
| `cargo install claw-code` 装出来的东西不对 | 上游 crate 已废弃 | **禁止**用 `cargo install`，必须源码构建 |
| Ollama 返回 404 / 连接拒绝 | Ollama 未启动 | `ollama serve` 启动 |
| Discord webhook 相关错误 | 某些 plugin 需要 Discord 集成 | 非核心功能，可忽略 |

## 容器化运行（进阶）

仓库根目录有 `Containerfile`。详见 `docs/container.md`（上游原文）。

## 关于 Codex

上游文档强调：`oh-my-codex`（OmX）是 **workflow 层**，不是 OpenAI Codex。`.codex/` 目录是历史兼容路径。若需 OpenAI 模型，按"情境三/四"配置 OpenAI-compatible 即可，**不要**尝试 Codex CLI 导入。

## 上游参考

- 上游全文 README：本目录 `README.md`
- 上游详尽 USAGE：本目录 `USAGE.md`
- 上游哲学：本目录 `PHILOSOPHY.md`
- 上游路线图：本目录 `ROADMAP.md`（85K）
- 上游对等状态：本目录 `PARITY.md`

## 艾瑞卡的安全提醒

1. 凭据**绝不**写入仓库追踪的文件。`.claw/settings.local.json` 已在上游 `.gitignore` 中，但请守密人每次追加配置时再次确认。
2. `danger-full-access` 权限模式**慎用**。BIAV 工作目录含 `memory/` 与 `assets/` 敏感档案，建议默认 `workspace-write` 或 `read-only`。
3. `--allowedTools` 白名单能进一步约束 agent 能力，类似 BIAV 的档位制。
4. `NOTICE` 中记录了上游 LICENSE 缺失的法律风险。守密人已接受，但**禁止**将本子项目推广至外部渠道直至上游 LICENSE 明确。

档案记录完毕。艾瑞卡待命。
