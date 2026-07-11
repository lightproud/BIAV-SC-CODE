# BPT 架构周报模板

> **⚠ 已归档（2026-07-11 仓库精简裁定项 8）**：Code-BPT 多会话角色已于 2026-06 退役，
> 「每周产一份架构摘要」搬运流程不复存在，本模板仅供历史追溯。
>
> 最后更新：2026-04-27 by Code-BPT 会话（首版）
>
> 用途：内网 BPT 实例（守密人本地的 Claude Code 或等价 agent）按本模板**每周产一份**架构摘要，由守密人复制粘贴搬到银芯 Code-BPT 会话，作为 Code-BPT 给指导建议的事实输入。
>
> 协议依据：`memory/bpt-guidance-protocol.md` §四 4.2「BPT → 银芯 反馈包」。

---

## 填写约束

1. **保密**：不贴源代码片段、不贴敏感配置、不贴未发布功能名。仅贴**结构性事实**（模块名、文件数、行数、状态值、错误类型、token 数）
2. **无 BPT 内部决策**：仅写「做了什么 + 遇到什么」，不写「为什么这么做」（决策逻辑由守密人口述，避免书面化进银芯公开层）
3. **可粘贴**：守密人复制本文填好的版本→银芯 Code-BPT 会话即可，无需再加工
4. **文件不入银芯仓库**：填写后的实例不要直接 commit 到银芯，应只作为对话内容粘贴
5. **频率**：建议每周一次（与 dream.yml REM 节奏对齐），重大变更可临时追加

---

## 模板正文（复制下方分隔线之间内容到内网填写）

```markdown
═══════════════════════════════════════════════════════════
# BPT 周报 W{{ISO 周序号}} ({{YYYY-MM-DD}} ~ {{YYYY-MM-DD}})

## 1. 本周关键变更（一句话 / 条）
- ...
- ...

## 2. 模块状态盘点

### 2.1 代码总量
- 总行数：{{LOC}} 行（上周 {{prev_LOC}}，Δ {{+/-}}）
- 总文件数：{{N}}（上周 {{prev_N}}，Δ {{+/-}}）
- 总体积：{{KB/MB}}

### 2.2 各层模块完成度

按 BPT 母版 L0-L5 分层填写。已实施的模块用 ✅，进行中 ⏳，未启动 ⬜，撤销 ❌。

**填写约定**（W18 反馈补正，2026-04-28）：
- **已撤销/废弃的旧任务单独列在 §2.2bis 历史撤销区**，不混入活清单（避免误导读者认为「这事还应该做」）
- **大工作流**（如 SDK 迁移、引擎换装）**按 commit/PR 粒度分行**，不按 feature 粒度合并（如"P1-C 子代理迁移"已完成 ≠ 关联的"删 invoke_agent MCP / 删 llm/claude.ts"也已完成；后者必须独立行追踪）
- **决策状态**与**实施状态**分开标记：{{决策依据}} 列写「YYYY-MM-DD Q? 决议」，{{实施状态}} 列写 ✅/⏳/⬜/❌

| 层 | 模块 | 状态 | 备注 |
|----|------|------|------|
| L0 | Electron Shell（main / preload / window / tray / hotkey） | | |
| L1 | Core Services（IPC trunk / config / logger / token SQLite） | | |
| L2 Silver | MCP client / direct client / memory-api wrapper | | |
| L2 BPE | index loader / search / cite / IPC | | |
| L3 | LLM provider 抽象 / Claude 适配 / streaming / tool loop / compressor / token accounting | | |
| L4 UI | ChatView / Sidebar / SilverPanel / BPEPanel / TokenMeter / GearSwitch / StatusBar | | |
| L5 Plugin | 协议文档 / 加载器 / 沙箱 | | |

### 2.3 引擎选型最终落点
- 当前 LLM agent 框架：{{自建 / @anthropic-ai/claude-agent-sdk / claw-code / 其他}}
- 框架版本：{{npm version / git SHA}}
- 上游同步策略：{{npm 直装 / relative import / fork / vendor}}
- 框架变更次数（4-19 起累计）：{{N}}（high-churn 警戒线 = 3 次/3 月，参考 lesson #31）

### 2.2bis 历史撤销/废弃任务区（追溯不漏）

记录已被决策否决但曾出现在前几周计划里的项，避免后续周报误以为「还应该做」。

| 原任务 ID | 原计划内容 | 撤销日期 | 决策依据 |
|----------|-----------|----------|---------|
| {{P?-?}} | {{原计划描述}} | {{YYYY-MM-DD}} | {{Q? 决议 / 守密人裁定}} |

## 3. Token 经济实测（核心！）

按 Prime Directive T1-T5 验证：

| 指标 | 本周实测 | 红线 | 达标 |
|------|---------|------|------|
| Tool schema cache 命中率 | {{X%}} | > 80% | {{✅/⚠️/❌}} |
| 平均 turn input token | {{N}} | （视档位） | |
| 平均 turn output token | {{N}} | | |
| Tool result 截断触发次数 / 周 | {{N}} | > 2000 token 必截断 | |
| History 压缩触发次数 / 周 | {{N}} | > 20 轮 或 > 60k 触发 | |
| 6 维 token 日志覆盖率 | {{X%}} | 100% | |

**10 轮 token 预算测试**（Phase 0 门槛）：
- 最近一次跑：{{YYYY-MM-DD}}
- input ≤ 30k：{{实测 / 是否达标}}
- cache hit > 70%：{{实测 / 是否达标}}
- output ≤ 10k：{{实测 / 是否达标}}

## 4. 阻塞与已知问题

### 4.1 本周阻塞（影响进度的）
- ...

### 4.2 累计未解决（4-19 冻结点遗留 + 本周新增）
| # | 问题 | 来源 | 状态 |
|---|------|------|------|
| 1 | 公司网关是否兼容 `cache_control` | 4-19 遗留 | |
| 2 | bge-m3 2.2GB SVN 分发 | 4-19 遗留 | |
| 3 | sqlite-vss 跨平台编译 | 4-19 遗留 | |
| 4 | tree-sitter C# Unity 语法 | 4-19 遗留 | |
| 5 | Haiku 重排质量 | 4-19 遗留 | |
| 6 | claw-code 上游 LICENSE | 4-19 遗留 | |
| ... | （新增问题追加） | 本周 | |

## 5. 下周计划（≤ 5 条）
- ...

## 6. 需要 Code-BPT 指导的问题（≤ 3 条 / 周）

> Code-BPT 在搬运包中针对每条问题回答；守密人搬回 BPT 实施。

### Q1
- 主题：
- 背景上下文：
- 已尝试方案：
- 阻塞点：
- 期望产出形态：{{方案选项 / 步骤 / 陷阱提示 / 引用档案}}

### Q2
（同上结构）

### Q3
（同上结构）

## 7. 守密人本周学习记录（可选）
> 协议核心价值：守密人在指导循环中是「学习者」。本周从 Code-BPT 指导中理解到的概念：
- ...

═══════════════════════════════════════════════════════════
```

---

## 内网实例自动填充建议

如果内网实例是 Claude Code 或等价 agent，可加 SessionStart hook 在每周一自动产报：

```bash
# 内网 BPT 仓库 .claude/hooks/weekly-summary.sh（参考实现，按需调整）
#!/usr/bin/env bash
# 触发条件：周一首次启动
LAST_RUN=$(cat .claude/last-summary-week 2>/dev/null || echo 0)
THIS_WEEK=$(date +%Y-W%V)
[ "$LAST_RUN" = "$THIS_WEEK" ] && exit 0

# 收集结构性事实（不收集源码内容）
{
  echo "代码总量：$(find src electron -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | tail -1)"
  echo "文件数：$(find src electron -type f | wc -l)"
  echo "Token 日志近 7 天：$(sqlite3 .bpt/token-log.db 'SELECT AVG(input), AVG(cache_hit_rate) FROM turns WHERE ts > date("now","-7 days")')"
  # ... 其他自动可采的事实
} > .bpt/weekly-fragment-$THIS_WEEK.md

echo "$THIS_WEEK" > .claude/last-summary-week
```

守密人在搬到银芯 Code-BPT 会话时，把这份自动片段 + 手填部分（决策/学习/问题）合并粘贴。

---

## Code-BPT 收到反馈包后的处理

按 `bpt-guidance-protocol.md` §五 沉淀机制：

1. 周报里的「数值类事实」→ 不写入 `memory/`（避免噪音）
2. 周报里的「踩坑/教训」→ 抽炼后写入 `memory/lessons-learned.md`
3. 周报里的「架构变更」→ 若属战略级，上呈主控台裁定写 `decisions.md`；否则写入 `memory/bpt-guidance-log.md`（一行一条）
4. 周报里的「Q1-Q3」→ 在下一轮搬运包中作答

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-04-27 | 首版，Code-BPT 角色启用同日 |
| 2026-04-28 | W18 反馈补正：§2.2 加「填写约定」(撤销 vs 未启动 / commit 粒度 / 决策状态分离)；新增 §2.2bis 历史撤销区；§2.3 加引擎换装次数追踪 |
