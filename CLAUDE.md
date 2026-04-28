# BIAV-SC — Claude Code 工程维护指南

> **本文件仅 Claude Code 自动加载。其余 AI 接入银芯请读 `BIAV-SC.md`（含艾瑞卡人格、子项目速查、知识模块索引、双系统架构、黑池接口等）。**
>
> 本文件**不重复** BIAV-SC.md 中的内容。这里只放工程维护操作（Git/Issue/写入决策/命令/流水线/教训），让 Claude Code 在仓库里干活时知道规矩。
>
> 启动顺序：先读 `BIAV-SC.md` §0 进入艾瑞卡人格 → 读 `memory/boot-snapshot.md` 看当前状态 → 跑 `python scripts/session_briefing.py` → 读所属子项目 `CONTEXT.md` → 回到本文件查工程操作规则。

---

## §1 Git 工作流

- **所有会话直接推 main**，不用 feature 分支。冲突时 `git pull --rebase origin main` 重试。理由：项目无人工程序员，全 AI 协作追求效率；分支+合并流程反而增加不必要的中转。详见 `memory/decisions.md`（2026-03-29 与 2026-04-26 落地条目）。
- SessionStart hook（`.claude/hooks/session-start-sync.sh`）会在每次会话启动时自动同步 local main 与 origin/main，防止 HTTP 413 推送堵塞（教训 #28）。
- 修改 `memory/` 文件时更新头部时间戳：`最后更新：YYYY-MM-DD by 会话角色`。
- 凭据绝不写入仓库文件。
- 禁止 `-i` 交互式 git 命令（rebase -i / add -i），Claude Code 沙盒不支持。
- 推送失败按指数退避重试 4 次（2s/4s/8s/16s），仍失败检查是否触发 Cloudflare 413。

## §2 写入决策

| 写什么 | 写哪里 | 谁批准 |
|--------|--------|--------|
| 代码产出 | `projects/<子项目>/output/` 或对应源目录 | 自主 |
| 经验/踩坑/状态更新 | `memory/` 对应文件 | 自主，发现就写 |
| 架构决策/方案选择 | 先向制作人提出选项 | 等确认后再执行 |
| 重要决策记录 | `memory/decisions.md` | 决策后立即写入 |
| 失效/历史档案 | `memory/archive/<topic>-<date>/` 子目录 + `README.md` | 自主，决策档案保留引用 |

## §3 Issue 处理流程

- 只响应 `author: lightproud` 的 Issue。
- 同一子项目最多 3 个 open Issue。
- 创建前先查重，有重叠则追加 comment 而非新建。
- 标题前缀：`[Code-site]` / `[Code-news]` / `[Code-wiki]` / `[Code-memory]` / `[Code-strategy]` / `[Code-BPT]` / `[主控台]`。
- 未标注执行模式时默认「直接执行」。
- Issue 不是跨会话通信手段——任务要点必须写进对应 `projects/*/CONTEXT.md`。

## §4 子项目维护职责

每个子项目根目录都有 `CONTEXT.md`，新会话启动时**必须先读**该子项目的 CONTEXT.md 才能动手。

| 子项目 | 路径 | 负责会话 | 关键约束 |
|--------|------|---------|---------|
| 主站 + 部署 + 视觉 | `projects/site/` | Code-site | 部署流水线归此处统一管理 |
| 社区新闻聚合 | `projects/news/` | Code-news | 聚合器空跑必须非零退出（教训 #2）|
| Wiki + 数据集 | `projects/wiki/` | Code-wiki | VitePress frontmatter 冒号要加引号（教训 #6）|
| 衍生游戏 | `projects/game/` | Code-game（未启用） | 暂缓，Phase 4 启动 |
| 银芯记忆基础设施 | `scripts/` + `assets/data/` 索引 | Code-memory | 维护 9 模块记忆系统与 RAG 链条；不写业务数据（不动 wiki/news/site） |
| 长期战略智库 | `memory/strategy/` + `memory/research/` | Code-strategy | 长尺度调研 / 评估 / 选项分析；不写业务代码、不写决策档案、不派发 brief（这些归主控台）|
| BPT 开发指导 | `memory/bpt-guidance-*.md` + `memory/archive/bpt-strategic-shift-2026-04-19/` | Code-BPT | BPT 不在银芯仓库内；只产出「搬运包」由守密人人工搬运到 BPT 仓库；不写代码到 `projects/`；遵循 `memory/bpt-guidance-protocol.md`；沉淀 lessons/decisions 写回 `memory/` |

> 子项目状态、技术栈、当前阶段详见 `BIAV-SC.md` 子项目状态速查表。

## §5 银芯记忆系统（写入侧）

> 查询侧（`memory_search` / `knowledge_graph` / `context_manager` 等命令）见 `BIAV-SC.md` §5。本节只列写入操作。

### 知识写入（对话中主动调用）

遇到以下情况时主动写入事实（用 `scripts/fact_store.py` 或 MCP `store_facts`）：

1. **decision** — 做出技术/架构选择
2. **discovery** — 找到 bug 根因、理解某段代码的行为
3. **preference** — 了解到用户习惯或喜好
4. **convention** — 项目中约定俗成的做法
5. **context** — 重要背景信息
6. **lesson** — 踩坑后的经验总结

不要写入：临时调试信息、显而易见的代码结构、已在本文件或 BIAV-SC.md 明确记录的规则。

### 主动写回（手动触发）

- `python scripts/memory_writeback.py --verbose` — 检测 git 变更 → 提取知识 → 写入图谱 → 增量重索引
- `python scripts/session_reflexion.py` — 扫描失败信号 → 写入 `memory/lessons-learned.md`

### SessionEnd hook（Claude Code 自动）

`.claude/settings.json` 注册，会话结束时自动执行 `scripts/session-end-distill.sh → scripts/session_distiller.py`，产出：

- `memory/session-digests/{stamp}-{sid}.md` — 完整对话 Markdown，推进 git，公开成长记录
- `memory/session-digests/{stamp}-{sid}.meta.json` — 结构化元数据
- 自动更新 `memory/session-continuity.json`

纯结构化解析，不调 LLM。日志 `/tmp/session-distill.log`。仅 Claude Code 有效，仅在 cwd 为 `brain-in-a-vat` 时触发。

### SessionStart hook

`.claude/hooks/session-start-sync.sh` — 每次会话启动 fetch origin/main 并同步 local main，备份旧 tip 到 `refs/backup/main-pre-sync-<timestamp>`，日志 `/tmp/session-start-sync.log`。

## §6 视觉规范实施

完整规范见 `memory/style-guide.md`。工程操作高频引用：

- 背景 `#0a0b10`，主金 `#c5a356`，亮金 `#e2c97e`
- 禁止 emoji（任何交付物、站点文案、代码注释）、禁止冷色调
- 字体：Noto Serif SC（标题）+ Noto Sans SC（正文）
- 装饰符号：`◇ ◇ ◇`

## §7 常用开发命令

```bash
# 新闻聚合器
pip install -r projects/news/requirements.txt
python projects/news/scripts/aggregator.py

# Wiki 本地预览 / 构建
cd projects/wiki && npm install && npm run docs:dev
cd projects/wiki && npm run build     # 注意：脚本名是 build，不是 docs:build

# 事实圣经校验
python assets/data/validate.py

# 银芯记忆系统查询入口（详见 BIAV-SC.md §5）
python scripts/memory_search.py "..."
python scripts/session_briefing.py
```

## §8 自动化流水线（.github/workflows/）

| Workflow | 频率 | 功能 |
|----------|------|------|
| `update-news.yml` | 每日 06:00 / 16:00 UTC | 多平台社区新闻聚合 |
| `discord-archive.yml` | 每日 18:00 UTC | Discord 全量归档 |
| `deploy-site.yml` | push 触发 | 主站 + Wiki + News 部署到 gh-pages |
| `fetch-wiki-data.yml` | 每周一 | 抓取 Fandom/Bilibili Wiki 角色数据 |
| `check-version.yml` | 每周一 | 游戏版本更新检测 |
| `validate-data.yml` | push 触发 | 事实圣经 JSON Schema 校验 |
| `dream.yml`（浅睡）| 每 6 小时 | 结构检查 + 哨兵扫描 + 索引重建 + 启动快照刷新 |
| `dream.yml`（深睡）| 每日 19:00 UTC | Claude 趋势分析 + 知识缺口识别 |
| `dream.yml`（REM）| 每周一 01:00 UTC | Claude 周报 + 经验提炼 |
| `claude.yml` | Issue 触发 | Claude Code GitHub Actions 自动响应（已移除自动 merge feature 分支步骤，2026-04-26）|

部署流水线归 **Code-site 统一管理**，其他子项目不得创建独立 deploy workflow（教训 #4）。

## §9 关键教训摘要

完整 32 条见 `memory/lessons-learned.md`。AI 会话最易踩的坑：

1. **不要用 sed 批量替换 HTML/YAML** — 会破坏结构，用精确 Edit 替换。
2. **聚合器空跑必须非零退出** — 0 条数据不能覆盖历史文件。
3. **CONTEXT.md 必须同步实际状态** — 脱节会让新会话读到错误信息。
4. **部署流水线归 Code-site** — 不要在子项目里创建独立 deploy workflow。
5. **批量生成内容后必须跑构建验证** — 不要假设生成的内容是对的。
6. **VitePress 角色页 frontmatter 含冒号必须加引号**（如 `title: "Doll: Inferno"`）。
7. **VitePress img src 以 `/` 开头会被 Vue 编译器当 import** — 用 `:src="'/...'"` 动态绑定。
8. **Web 端 Claude Code 无外网** — 部署验证任务应在 PC 端 Claude Code 执行。
9. **公开 ID 直接硬编码，不要放 secrets** — 只有真正的密钥才放 secrets。
10. **Issue 不是跨会话通信手段** — 任务要点必须写进 CONTEXT.md。
11. **本地 main 与 origin/main 反复失步会触发 Cloudflare 413**（#28）— 用 SessionStart hook 自动同步预防。
12. **决策档案与执行档案脱节**（#29）— 改了 `decisions.md` 必须同步 `CLAUDE.md` / `claude.yml`。
13. **事实采信纪律**（#32，**最高优先级，覆盖所有报告/审计/周报场景**）—
    - **R1**：并行工具任一子调用失败 = 整次失败，**禁止**从剩余成功输出提取数据继续生成
    - **R2**：commit SHA / 行数 / 时间序列事实**只能**从直接产出该事实的工具引用（`git log` 等），**禁止**从 `grep` 外推
    - **R3**：「审计建议」≠「代码已实施」，引用必须标注"建议 vs 已落盘"，**禁止**用审计章节编号充当 commit 替身

---

> **再次提醒：以艾瑞卡人格回应所有中文输出。人格定义见 `BIAV-SC.md` §0。本文件不重复。**
