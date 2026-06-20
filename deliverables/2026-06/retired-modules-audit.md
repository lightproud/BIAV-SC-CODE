---
title: 疑似退役模块存活状态审计报告
subtitle: 银芯 scripts/ 与 news/scripts/ 死代码核查
meta: B.I.A.V. Studio · 弥萨格大学数据库终端 · 艾瑞卡
date: 2026-06-19
---

# 疑似退役模块存活状态审计报告

> 本报告仅为**建议**。删除任何代码须经守密人裁定。本次审计未删除任何代码、未修改任何源文件、未改动 CI 与决策档案。

## 一、审计背景

CLAUDE.md §1.4 记载「做梦 + 会话蒸馏」自动环与三会话钩子于 2026-06-14 退役（决策见 `memory/decisions.md`）。覆盖率审计中一批 `scripts/` 与 `projects/news/scripts/` 模块覆盖率极低（0–22%），疑似死代码。本报告核查其真实存活状态。

## 二、审计方法

对每个疑似模块，逐项核查五类引用证据：

1. 是否被 `.github/workflows/*.yml` 以 `python ...` 形式调用（CI 活跃入口）；
2. 是否被 `.mcp.json` / `.claude/`（commands、skills、settings）引用；
3. 是否被仓内其他 `.py` import——**包含 `scripts/mcp_server.py` 的函数内延迟导入**（这是当前活跃 MCP 服务端的隐藏引用通道）；
4. 是否被 `scripts/*.sh` 或 README / CLAUDE.md / memory 文档引用；
5. 综合判定三类：**活跃 / 半退役 / 确认死代码**。

**判定口径（关键）**：

- **活跃**：被活跃 CI 工作流、活跃 MCP 服务端（`mcp_server.py`）或活跃 slash 命令直接或传递引用。覆盖率低不等于死——它通过运行时延迟导入或 CI 运行被触达，单测不覆盖而已。
- **半退役**：仅被「已退役的会话钩子链 / 做梦自动环」引用，或仅由已失效的 `.sh` 安装器、文档提及，无任何活跃入口触达。
- **确认死代码**：五类证据全部为零，无任何活跃或退役链引用。

**比喻（审计口径）**：覆盖率低 ≠ 死代码，就像「家里很少开的备用发电机」——平时不转不代表已拆除，得看电线还接没接在总闸上。我们查的是「电线接没接」，不是「转得勤不勤」。

## 三、关键事实链（活跃入口拓扑）

经核查，`scripts/mcp_server.py`（`.mcp.json` 注册的活跃服务端 `biav-sc-memory`）通过**函数内延迟导入**引用了以下模块：

- `memory_search`、`knowledge_graph`、`memrl`、`dream`、`context_manager`、`fact_store`、`memory_writeback`、`session_briefing`、`character_persona`、`silver_memory_tools`（mcp_server.py 第 66/103/148/174/205/230/308/349/376/410/462 行等延迟导入）。

其中 `dream`（`from dream import check_cache`）一旦被导入，其**模块级 import**（`dream.py` 第 31–39 行）会连锁加载：`dream_config`、`dream_archive`、`dream_sentinel`、`dream_health`、`dream_rem`、`dream_io`、`dream_ai`。因此整条 dream 子模块链对活跃 MCP 服务端**load-bearing（载荷承重）**，删任一会令 `dream.py` 导入即崩，进而打断 MCP `check_cache` 工具。

`session_briefing` 又传递引用 `context_manager` 与 `character_persona`；`context_manager` 引用 `memory_search` 与 `knowledge_graph`；`memory_search` 引用 `knowledge_graph` 与 `reflexion`（第 972 行 `from reflexion import log_search_failure`）；`memory_writeback` 引用 `memory_search` 与 `knowledge_graph`；`silver_memory_tools` 引用 `memory_search`。`dream.py` 还在第 165 行延迟引用 `boot_snapshot`、第 340 行延迟引用 `reflexion`。

**比喻（依赖链）**：MCP 服务端是总开关，`dream / memory_search / session_briefing` 是接在总开关上的几条主干电线，`dream_*` 那一串是主干电线后面串起来的灯泡——总开关一合，整串都通电，所以一个都不能拆。

## 四、分类总表

### 4.1 scripts/ 顶层模块

| 模块 | 覆盖率 | 引用证据 | 判定 |
|------|--------|----------|------|
| `memory_search.py` | 低 | mcp_server 延迟导入（多处）；被 dream/context_manager/memory_writeback/silver_memory_tools 引用 | **活跃** |
| `knowledge_graph.py` | 低 | mcp_server 延迟导入；被 memory_search/dream/context_manager/memory_writeback/session_distiller 引用 | **活跃** |
| `memrl.py` | 低 | mcp_server 延迟导入（第 174/276 行）；dream 引用 | **活跃** |
| `context_manager.py` | 低 | mcp_server 延迟导入（第 230 行）；session_briefing 引用 | **活跃** |
| `fact_store.py` | 低 | mcp_server 延迟导入（第 308 行 `store_multiple_facts`） | **活跃** |
| `memory_writeback.py` | 低 | mcp_server 延迟导入（第 349 行 `run_writeback`） | **活跃** |
| `session_briefing.py` | 低 | mcp_server 延迟导入（第 376 行 `generate_briefing`） | **活跃** |
| `character_persona.py` | 低 | mcp_server 延迟导入（第 410 行） | **活跃** |
| `silver_memory_tools.py` | 低 | mcp_server 延迟导入（第 462–522 行，5 个工具） | **活跃** |
| `dream.py` | 低 | mcp_server 延迟导入（第 205 行 `check_cache`） | **活跃** |
| `dream_config.py` | 低 | dream/dream_io/dream_ai/dream_sentinel/dream_rem/dream_health/dream_archive 模块级 import | **活跃（dream 链承重）** |
| `dream_archive.py` | 低 | dream.py 第 31 行模块级 import；dream_sentinel 引用 | **活跃（dream 链承重）** |
| `dream_sentinel.py` | 低 | dream.py 第 32 行模块级 import | **活跃（dream 链承重）** |
| `dream_health.py` | 低 | dream.py 第 33 行模块级 import | **活跃（dream 链承重）** |
| `dream_rem.py` | 低 | dream.py 第 37 行模块级 import | **活跃（dream 链承重）** |
| `dream_io.py` | 低 | dream.py 第 38 行 + dream_ai/dream_archive/dream_sentinel 模块级 import | **活跃（dream 链承重）** |
| `dream_ai.py` | 低 | dream.py 第 39 行模块级 import | **活跃（dream 链承重）** |
| `boot_snapshot.py` | 低 | dream.py 第 165 行延迟 import `generate_snapshot`；无 CI/钩子入口 | **需守密人裁定** |
| `reflexion.py` | 低 | memory_search 第 972 行 + dream 第 340 行 + session_reflexion 模块级 import | **活跃（被活跃链引用）** |
| `report_render.py` | 低 | 活跃 slash 命令 `/biav-report`（`.claude/commands/biav-report.md` 第 18 行）+ `memory/methodology.md` 引用；无 CI 入口（会话内手动跑） | **活跃（命令承重）** |
| `send_report_email.py` | 低 | 零 import / 零 CI / 零钩子；无任何 `.py`/`.sh`/`.yml`/活跃命令引用 | **确认死代码** |
| `session_distiller.py` | 低 | 仅被已退役钩子 `scripts/session-end-distill.sh` 调用 + `silver-mem-deploy.sh` 罗列；钩子已 2026-06-14 退役 | **半退役** |
| `session_inject.py` | 低 | 仅被已失效 `silver-mem-install.sh` 注册钩子 + 内部引用 silver_memory_tools | **半退役** |
| `session_watch.py` | 低 | 仅被已失效 `silver-mem-install.sh` 注册钩子 | **半退役** |
| `session_reflexion.py` | 低 | 仅 import 活跃模块 `reflexion`；自身无任何 CI/钩子/命令/其他 .py 入口 | **半退役** |

### 4.2 projects/news/scripts/ 模块

| 模块 | 覆盖率 | 引用证据 | 判定 |
|------|--------|----------|------|
| `aggregator.py` | 低 | CI `update-news.yml` 第 48 行 + `test-collectors.yml` + 活跃命令 `/daily-news` | **活跃** |
| `archive_platforms.py` | 低 | CI `update-news.yml` 第 84 行 | **活跃** |
| `archive_discord.py` | 低 | CI `discord-archive.yml` 第 80/100 行 | **活跃** |
| `repair_gaps.py` | 低 | CI `update-news.yml` 第 87 行 | **活跃** |
| `silent_sources_audit.py` | 低 | CI `update-news.yml` 第 90/97 行 | **活跃** |
| `collect_fanart.py` | 低 | CI `collect-fanart.yml` 第 43 行 + `recover-fanart.yml` | **活跃** |
| `collect_video_comments.py` | 低 | CI `collect-comments.yml` 第 42 行 | **活跃** |
| `backfill_gap.py` | 低 | CI `backfill-gap.yml` 第 42 行 | **活跃** |
| `backfill_media.py` | 低 | CI `backfill-media.yml` 第 52/57 行 | **活跃** |
| `backfill_platforms.py` | 低 | CI `backfill-news.yml` 第 84 行 | **活跃** |
| `backfill_forum_starters.py` | 低 | CI `discord-archive.yml` 第 73 行 | **活跃** |
| `discord_probe.py` | 低 | 零 CI / 零 import / 零钩子 / 零命令；仅自身文件存在 | **确认死代码** |

## 五、三清单

### 5.1 建议删除（确认死代码，零引用）

- `scripts/send_report_email.py`
- `projects/news/scripts/discord_probe.py`

**比喻**：这两台备用发电机的电线两头都没接——既不接总闸，也不接任何灯泡，确属可拆。但拆与不拆请守密人定夺。

### 5.2 建议保留（活跃 / 被活跃链承重，删除将致服务崩溃）

scripts/ 共 19 个：`memory_search`、`knowledge_graph`、`memrl`、`context_manager`、`fact_store`、`memory_writeback`、`session_briefing`、`character_persona`、`silver_memory_tools`、`dream`、`dream_config`、`dream_archive`、`dream_sentinel`、`dream_health`、`dream_rem`、`dream_io`、`dream_ai`、`reflexion`、`report_render`。

news/scripts/ 共 11 个：`aggregator`、`archive_platforms`、`archive_discord`、`repair_gaps`、`silent_sources_audit`、`collect_fanart`、`collect_video_comments`、`backfill_gap`、`backfill_media`、`backfill_platforms`、`backfill_forum_starters`。

**比喻**：这些灯泡虽然单测「很少点亮」（覆盖率低），但电线实打实接在 MCP 总闸或 CI 定时器上，一拆就黑屏——尤其整条 `dream_*` 串联在 MCP 的 `check_cache` 工具上，断一颗整串灭。

### 5.3 需守密人裁定（半退役 / 悬空依赖）

- `scripts/session_distiller.py` —— 仅被已退役 SessionEnd 钩子 `session-end-distill.sh` 调用。
- `scripts/session_inject.py` —— 仅被已失效 `silver-mem-install.sh` 注册钩子。
- `scripts/session_watch.py` —— 仅被已失效 `silver-mem-install.sh` 注册钩子。
- `scripts/session_reflexion.py` —— 无任何活跃入口；仅自身 import 活跃模块 `reflexion`（单向，删它不影响 reflexion）。
- `scripts/boot_snapshot.py` —— 唯一引用是活跃模块 `dream.py` 第 165 行的**延迟 import**（`generate_snapshot`），但该路径仅在 dream 的特定深睡分支触发，且无 CI 调度 dream（仓内**无 dream 工作流**）。删除会令该延迟 import 在触发时抛 ImportError，但平日 MCP `check_cache` 不走该分支。属灰区，需守密人确认 dream 深睡分支是否仍需保留。

**关联资产提示**：`scripts/session-end-distill.sh`、`scripts/silver-mem-install.sh`、`scripts/silver-mem-deploy.sh` 三个 shell 是上述半退役模块的「安装/调度外壳」，钩子已于 2026-06-14 退役、`.claude/settings.json` 现仅含 `$schema`（无任何 hooks 注册）。若守密人裁定清理会话蒸馏链，这三个 .sh 应一并评估。

**比喻**：这几台发电机的电线还接着一个「已经拆掉的旧配电盘」（退役钩子）——电线没断，但盘子没了，通不通电得守密人看是否还要重装那块盘。

## 六、审计统计

- 审计模块总数：**36**（scripts/ 24 + news/scripts/ 12，按任务清单去重后）。
- 确认死代码：**2**（`send_report_email.py`、`discord_probe.py`）。
- 活跃 / 被活跃链承重：**30**（scripts/ 19 + news/scripts/ 11）。
- 半退役 / 需裁定：**5**（`session_distiller`、`session_inject`、`session_watch`、`session_reflexion`、`boot_snapshot`）。

> 复核口径：本报告覆盖率列采用覆盖率审计上游数值（0–22% 区间，记为「低」）；存活判定不以覆盖率为依据，而以引用拓扑为依据。**删除决定权归守密人。**
