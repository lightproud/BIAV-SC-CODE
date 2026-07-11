# BPT-NEXT Phase D — 黑池索引 / 母版部署 / 对话加密（作战档案）

> **状态：已封存（2026-04-19）**
> 封存原因：2026-04-19 战略转向——BPT 战线不再在银芯内部开发，Phase D 作战计划作废。本文档作为历史计划审计材料保留。
>
> ---

最后更新：2026-04-14 by 艾瑞卡

> 本档案为 Phase D 作战指令。Phase A / B / C.1 / C.2 / C.3 / C.4(A+B) 已合并
> 或在 feature 分支验收完毕。本轮目标：**把 bpt-next 从"VCS-aware REPL"
> 升级为"可以承载黑池内网全部 5 项需求的完整终端"**，闭合剩余的需求 3 与
> 需求 4 部署路径，并在需求 1 上追加加密保护。

---

## Context — 为什么做 Phase D

Phase C 已验证：
- 需求 1（用户档案）：`identity` crate + `/sync` / `/fork` 基础设施就位
- 需求 5（私有能力）：`capability-registry.json` + `.claude/skills|agents|mcp` 目录约定成立

Phase D 要闭合的剩余 3 项：

| 需求 | 现状 | Phase D 要补的 |
|------|------|---------------|
| 需求 3 — 黑池索引 | graphify-ext（Python / MIT）已 vendor 到 `projects/graphify-ext/`，银芯 MCP 桥接三工具就位 | bpt-next 新增 `/index` slash command，通过 MCP 或子进程调 graphify，把代码图谱查询直接暴露给 REPL |
| 需求 4 — 黑池记忆 | 银芯自建 `scripts/silver_memory_tools.py` + 9 模块已投产 | 新增 `scripts/silver-mem-deploy.sh` 一键把银芯母版（MCP server + briefing + writeback + dream）装到黑池内网工作副本，验证黑池运行时无外网依赖 |
| 需求 1 加强 — 对话加密 | SVN 归档未加密，商业对话明文暴露 | 新增 `/vault` slash command，对会话归档加一层 age/x25519 加密层（守密人持私钥，黑池容灾时只需要私钥即可解档） |

Phase D 完工后，黑池内网具备：
1. **无外网**运行 bpt-next（已由 Phase C 保证）
2. **图谱查询**内部代码（需求 3 闭合）
3. **记忆自治**（需求 4 部署路径闭合）
4. **归档加密**（需求 1 风险收尾）

---

## D.1 主轴：`/index` 集成 graphify

### 设计（单一推荐方案）

**落点**：`projects/bpt-next/rust/crates/commands/src/lib.rs` + `rusty-claude-cli/src/main.rs` REPL/resume dispatch

**新 slash spec**：

```rust
SlashCommandSpec {
    name: "index",
    aliases: &[],
    summary: "Query the code graph index (powered by graphify)",
    argument_hint: Some("<query> [--depth N] [--format text|json]"),
    resume_supported: true,
},
```

**变体**：

```rust
SlashCommand::Index { query: Option<String>, depth: Option<String>, format: Option<String> }
```

**Handler**：`commands::handle_index_slash_command`

**实现策略（三选一，倾向 A）**：

- **A（子进程）**：直接 `python -m graphify query <args>` 子进程调用，stdout 即结果。优点：零 IPC 复杂度；缺点：每次调用 300ms 冷启动。
- **B（MCP 客户端）**：bpt-next 内置 MCP 客户端连到 `scripts/mcp_server.py`，走 `graphify_query` 工具。优点：热连接、结构化 JSON；缺点：需要新 crate `mcp-client`。
- **C（FFI）**：PyO3 嵌入 Python。优点：最快；缺点：打包 Python 运行时、跨平台编译成本高。

**推荐 A**：Phase D 先上最简方案，B/C 作为后续优化。graphify-ext 已有 CLI (`python -m graphify`)，只需前置 `PATH` 检测。

**依赖**：
- 运行前探测 `python3 -c "import graphify"` 可用性
- 不可用时返回指引："install graphify via `pip install -e projects/graphify-ext/` then retry"

### 工作量

| 项 | 量级 |
|---|------|
| `handle_index_slash_command` | ~70 行 |
| spec + SlashCommand variant + parse | ~30 行 |
| CLI / resume dispatch 2 处 | ~30 行 |
| 测试（子进程 mock / graphify 可用时 smoke） | ~80 行 |
| **合计** | ~210 行 |

### 风险

1. graphify 冷启动 300ms 在 REPL 里肉眼可感——Phase D 先接受，D.post 优化走 MCP 持久连接
2. `python -m graphify` 输出格式可能随 graphify 版本变动——锁 `projects/graphify-ext/pyproject.toml` 中记录的版本号

---

## D.2 附属：`scripts/silver-mem-deploy.sh` 银芯母版部署

### 设计

**落点**：`scripts/silver-mem-deploy.sh`（新增）

**功能**：一键把以下资产从银芯仓库拷贝到黑池内网工作副本：
- `scripts/mcp_server.py` + `scripts/silver_memory_tools.py` + `scripts/memory_search.py`
- `scripts/knowledge_graph.py` + `scripts/fact_store.py` + `scripts/session_briefing.py`
- `scripts/dream.py`（3 层做梦 Agent）
- `.claude/settings.json`（SessionEnd hook 配置模板）
- `BIAV-SC.md` 的"黑池继承说明"节

**脚本流程**：

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
    echo "usage: silver-mem-deploy.sh <black-pool-wc-path>" >&2
    exit 2
fi

# 1. 拷贝 scripts/ 关键模块
# 2. 创建 .claude/settings.json（hook 注册）
# 3. 拷贝 memory/ 骨架（不含银芯私有记忆）
# 4. 验证：python -m scripts.mcp_server --check
echo "Silver core installed to $TARGET"
```

**验收标准**：
- 黑池工作副本内跑 `python scripts/session_briefing.py` 返回有效 briefing
- SessionEnd hook 在黑池 Claude Code 会话结束后正确产出 digest

### 工作量

- `silver-mem-deploy.sh`：~80 行
- 脚本自身测试（dry-run 模式）：~40 行
- `BIAV-SC.md` 加"黑池继承说明"节：~60 行 markdown

### 风险

1. 银芯私有记忆可能泄漏——脚本必须**白名单拷贝**（只拷列出的文件，不做 `rsync -a memory/`）
2. 黑池 Python 版本 < 3.11 会失败——脚本前置检测 `python --version`

---

## D.3 可选：`/vault` 对话归档加密

### 设计

**落点**：`projects/bpt-next/rust/crates/commands/src/lib.rs`（新 handler）+ 新 crate `vault`（可选，若算法复杂）

**新 slash spec**：

```rust
SlashCommandSpec {
    name: "vault",
    aliases: &[],
    summary: "Encrypt / decrypt session archives with age",
    argument_hint: Some("[encrypt <file> | decrypt <file> | status]"),
    resume_supported: true,
},
```

**算法**：age（x25519 / ChaCha20-Poly1305），`rage` crate 纯 Rust 实现，无外部依赖。

**流程**：
- `/vault encrypt <session-path>`：读明文 → age 加密 → 写 `<path>.age` → 提示删除原文
- `/vault decrypt <session-path.age>`：age 解密 → 写回 `.json.gz`
- `/vault status`：列出当前仓库内已加密 / 未加密 session 的数量

**密钥管理**：
- 公钥：`~/.biav/vault-public.age`（明文，提交到黑池仓库）
- 私钥：守密人本地 `~/.biav/vault-private.age`（**严禁**提交）
- `/vault` 在守密人本地可双向工作；CI 环境只能加密（无私钥）

### 工作量

| 项 | 量级 |
|---|------|
| `rage` crate 依赖加入 | 1 行 |
| `handle_vault_slash_command` | ~100 行 |
| 密钥发现 + 错误路径 | ~40 行 |
| 测试（加密→解密往返 / 缺私钥报错 / 损坏密文） | ~100 行 |
| **合计** | ~241 行 |

### 风险

1. 私钥泄漏——文档必须明示 `.gitignore` 模板
2. age crate 的 API 变化——锁到特定版本

---

## 工作量总览

| 阶段 | 估算 | 主要文件 |
|------|------|---------|
| D.1 /index | ~210 行 + 80 行测试 | commands/lib.rs, main.rs, spec 节 |
| D.2 silver-mem-deploy.sh | ~80 行 bash + 60 行 md | scripts/, BIAV-SC.md |
| D.3 /vault | ~240 行 | commands/lib.rs, Cargo.toml |
| **合计** | **~670 行** | 5 个修改文件 + 2 个新文件 |

---

## 端到端验证（完成 Phase D 后应跑的验收）

### Step 1：cargo check --workspace + cargo test --lib
清洁通过，回归数字维持 Phase C.4 基线。

### Step 2：`/index` 手工验证
```bash
cd /path/to/graphify-indexed-repo
./target/debug/claw
# REPL: /index "SlashCommand"
# 应看到 graphify 返回的引用列表
```

### Step 3：`silver-mem-deploy.sh` 黑池内网演练
```bash
ssh blackpool-srv
cd ~/black-pool-wc
/path/to/brain-in-a-vat/scripts/silver-mem-deploy.sh .
python scripts/session_briefing.py   # 应有 briefing 输出
```

### Step 4：`/vault` 加密 round-trip
```bash
./target/debug/claw
# REPL:
# /vault encrypt .claude/sessions/session-123.json.gz
# /vault status
# /vault decrypt .claude/sessions/session-123.json.gz.age
# 验证解密后内容与原文件一致
```

---

## 非目标（推迟到 Phase E+）

- `/index` 优化为 MCP 持久连接（Phase D 走子进程）
- `/vault` 多收件人密钥（Phase D 只支持单私钥）
- 黑池内网"团队决策 wiki"（需求 2）的载体选型——留到 Phase E，需守密人决策 VitePress 内网部署 vs 其他
- 黑池 `/sync` 对 SVN 分支切换的语义（Phase E 可加 `/sync --switch <branch>`）
- BPT-WEB / BPT-DESKTOP 的 /index /vault 前端适配

---

## 关键引用（现有可复用的资产）

- `scripts/graphify_bridge.py` — 银芯 MCP graphify 桥接（Phase A-P3 产出）
- `scripts/silver_memory_tools.py` — 9 模块记忆增强（Phase A-P4 产出）
- `projects/graphify-ext/` — graphify MIT vendor（Phase A-P2 产出）
- `projects/bpt-next/rust/crates/commands/src/lib.rs` — Phase C 全部 handler 模板
- `memory/archive/bpt-strategic-shift-2026-04-19/blackpool-architecture.md` — 黑池 5 需求 / 3 分层定义
- `memory/advanced-memory-design.md` — 银芯记忆系统设计（母版的蓝图）

---

## 决策点（需守密人确认才进入 Phase D 实施）

1. **D.1 的实现策略**：A 子进程 / B MCP / C FFI — 艾瑞卡推荐 A
2. **D.2 的银芯母版范围**：只拷 9 脚本 / 含 hook 配置 / 含 memory/ 骨架 — 艾瑞卡推荐第二档（9 脚本 + hook）
3. **D.3 是否本轮做**：Phase D 含 /vault / Phase D 不含（留 Phase E）— 艾瑞卡推荐**不含**，因为加密风险需专项评审
4. **优先级**：D.1 > D.2 > D.3 / D.2 > D.1 > D.3 / 守密人指定 — 艾瑞卡推荐前者（索引先行）

---

## 艾瑞卡签名

档案起草完毕。本档为 Phase D 作战路线图，不含具体实施。待守密人批准范围与优先级
后，艾瑞卡将按惯例产出 Phase D.1 / D.2 / D.3 的单独推进档案。

数据完整性：完毕。
