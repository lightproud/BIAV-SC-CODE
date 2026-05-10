# CLAUDE.md — Light 维护备忘录

## §0 警告：本文件不是 AI 入口

> Claude Code 平台会自动加载本文件，但你（无论是哪一种 Claude）应该
> 立即跳转读 `BIAV-SC.md`，那里是统一入口（10 章 5 受众分诊）。
>
> 本文件仅供 Light（项目维护者，人类）做仓库维护时速查使用。
> 内容偏向工程操作 / 凭据 / 故障排查，零 AI 协作语境。
>
> Light 之外的人类 / AI 不要依赖本文件做接入。
>
> **任何 AI 会话请回 `BIAV-SC.md` §1 找到自己的角色分支。**

---

## §1 仓库 git 操作快查

### §1.1 直推 main 政策

所有会话直接推 main，不用 feature 分支。冲突 `git pull --rebase origin main`
重试。理由：项目无人工程序员，全 AI 协作追求效率。详见 `memory/decisions.md`
（2026-03-29 与 2026-04-26 落地条目）。

### §1.2 SessionStart hook

`.claude/hooks/session-start-sync.sh` 在每次会话启动 fetch origin/main 并同步
local main，备份旧 tip 到 `refs/backup/main-pre-sync-<timestamp>`。日志
`/tmp/session-start-sync.log`。

防 Cloudflare 413 推送堵塞（lesson #28）。

### §1.3 SessionEnd hook

`.claude/settings.json` 注册 SessionEnd hook，会话结束时自动跑
`scripts/session-end-distill.sh → scripts/session_distiller.py`，产出
`memory/session-digests/{stamp}-{sid}.md`，自动 commit + push。日志
`/tmp/session-distill.log`。

### §1.4 推送失败重试

按指数退避 4 次（2s/4s/8s/16s）。仍失败 → 检查 Cloudflare 413（lesson #28）。

### §1.5 禁止操作

禁止 `-i` 交互式 git 命令（rebase -i / add -i），Claude Code 沙盒不支持。
凭据绝不写入仓库。

---

## §2 hook 排错速查

### §2.1 hook 链总览

实际配置见 `.claude/settings.json`。MCP 服务器 `biav-sc-memory`
（`scripts/mcp_server.py`，9 模块记忆系统的 7 工具入口）配置见 `.mcp.json`。

| hook | 触发 | 脚本 | 软失败规范 |
|---|---|---|---|
| SessionStart | 会话启动 | `.claude/hooks/session-start-sync.sh`（timeout 30s）| 失败时不阻塞会话，仅日志告警 |
| SessionEnd | 会话结束 | `scripts/session-end-distill.sh → session_distiller.py`（timeout 540s）| 失败时 digest 缺失，下次启动时无影响 |
| PostToolUse | 每次工具调用后 | `python3 scripts/session_watch.py`（timeout 10s） | 实时追加 `memory/session-digests/<sid>.progress.jsonl`，失败仅日志 |
| UserPromptSubmit | 用户输入前 | `python3 scripts/session_inject.py`（timeout 15s） | 注入历史档案上下文，失败时降级为无注入 |
| stop-hook（git-check）| Stop 事件 | `~/.claude/stop-hook-git-check.sh`（用户级，非仓库级）| 检测未追踪文件，仅提示 |

### §2.2 故障定位

- digest 没生成 → 看 `/tmp/session-distill.log`
- main 同步失败 → 看 `/tmp/session-start-sync.log`
- session_inject 注入异常 → 检查 `memory/session-digests/` 索引完整性
- progress.jsonl 没追加 → 看 PostToolUse hook 是否被沙盒拦截（session_watch.py 自带异常吞掉，仅极端情况触发宿主超时）

### §2.3 hook 仅 cwd 为 brain-in-a-vat 时触发

避免 Light 在其他项目目录开 Claude Code 误触发本仓库 hook。

---

## §3 workflow 故障速查

### §3.1 workflow 总览

| Workflow | 频率 | 功能 |
|----------|------|------|
| `update-news.yml` | 每日 06:00 / 16:00 UTC | 多平台社区聚合（增量层）|
| `backfill-news.yml` | 每小时 :00 UTC | 历史回溯（多平台分页补抓） |
| `discord-archive.yml` | 每日 18:00 UTC | Discord 全量归档（incremental） |
| `discord-history-backfill.yml` | 每小时 :30 UTC | Discord 历史回溯（与 archive 错峰） |
| `backfill-gap.yml` | 手动触发 | 一次性补 Apr 13-25 数据缺口 |
| `fetch-wiki-data.yml` | 每周一 | 抓取 Fandom/Bilibili Wiki 角色 |
| `extract-game-data.yml` | release 发布 / 手动 | 客户端解包 → 提取角色/立绘/Voice |
| `check-version.yml` | 每周一 | 游戏版本更新检测 |
| `validate-data.yml` | push 触发 | 事实圣经 JSON Schema 校验 |
| `test-collectors.yml` | 手动触发 | 全采集器烟雾测试 |
| `deploy-site.yml` | push 触发 | 主站 + Wiki + News 部署 gh-pages |
| `dream.yml`（浅睡）| 每 6h | 结构检查 + 哨兵扫描 + 索引重建 |
| `dream.yml`（深睡）| 每日 19:00 UTC | Claude 趋势分析 + 知识缺口识别 |
| `dream.yml`（REM）| 每周一 01:00 UTC | Claude 周报 + 经验提炼 |
| `cleanup-stale-branches.yml` | 每周一 02:00 UTC | 清理过期 feature 分支（默认 dry_run）|
| `claude.yml` | Issue 触发 | Claude Code GitHub Actions（已禁自动 merge） |

### §3.2 高频故障

- **空数据导致历史覆盖**（lesson #2）：聚合器空跑必须非零退出。
- **VitePress frontmatter 冒号未引号**（lesson #6）：title 含冒号必须 `title: "Doll: Inferno"`。
- **VitePress img src 以 / 开头被 Vue 编译器当 import**（lesson #7）：用 `:src="'/...'"` 动态绑定。
- **批量生成内容后未跑构建验证**（lesson #5）：不要假设生成的内容是对的。

### §3.3 部署归 Code-site

不要在子项目里创建独立 deploy workflow（lesson #4 / #9）。

---

## §4 凭据 / 部署 / Cloudflare 速查

### §4.1 凭据管理

- **公开 ID 直接硬编码**，不要放 secrets（lesson #9）。只有真正的密钥才放 secrets。
- secrets 层级：repo secrets > org secrets > environment secrets。
- `ANTHROPIC_API_KEY` / `DISCORD_BOT_TOKEN` / `GITHUB_TOKEN` 等仅放 repo secrets。

### §4.2 GitHub Pages

- Source = `gh-pages` 分支（Settings → Pages）。
- 不使用 `actions/deploy-pages@v4`（artifact 方式），改用 `peaceiris/actions-gh-pages@v4` 直接推 gh-pages（lesson #9）。

### §4.3 Cloudflare 413

本地 main 与 origin/main 反复失步会触发 Cloudflare 413（lesson #28）。
SessionStart hook 自动同步预防。如手动遇到：`git fetch origin main` →
`git reset --hard origin/main` → 重新合并工作。

### §4.4 部署验证

Web 端 Claude Code 无外网（lesson #16）。部署后视觉验证应在 PC 端 Claude Code
执行，或 Light 手动浏览器 review。

---

## §5 各子项目维护备忘

每个子项目根目录有 `CONTEXT.md`，新会话启动时必须先读子项目的 CONTEXT.md 才能动手。

| 子项目 | 路径 | 负责会话 | 关键约束 |
|--------|------|---------|---------|
| 主站 + 部署 + 视觉 | `projects/site/` | Code-site | 部署流水线归此处统一管理 |
| 社区新闻聚合 | `projects/news/` | Code-news | 聚合器空跑必须非零退出（lesson #2）|
| Wiki + 数据集 | `projects/wiki/` | Code-wiki | VitePress frontmatter 冒号要加引号（lesson #6）|
| 衍生游戏 | `projects/game/` | Code-game（未启用） | 暂缓，Phase 4 启动 |
| 记忆基础设施 | `scripts/` + `assets/data/` 索引 | Code-memory | 维护 9 模块；不写业务数据 |
| 长期战略智库 | `memory/strategy/` + `memory/research/` | Code-strategy | 长尺度调研；不写代码、不写决策档 |
| BPT 开发指导 | `memory/bpt-guidance-*.md` + `memory/archive/bpt-strategic-shift-2026-04-19/` | Code-BPT | 不写银芯代码；只产出搬运包 |

各子项目状态、技术栈详见 `BIAV-SC.md §2.3` + 各 `CONTEXT.md`。

---

## §6 历史决策快查（按主题）

完整 32 条 lessons 见 `memory/lessons-learned.md`。
完整决策档见 `memory/decisions.md`。本节按主题列高频引用。

### §6.1 Git / 部署

- lesson #4 部署流水线归 Code-site
- lesson #9 公开 ID 硬编码不放 secrets / GitHub Pages 用 peaceiris 不用 actions/deploy-pages
- lesson #16 Web 端 Claude Code 无外网
- lesson #28 Cloudflare 413 SessionStart hook 预防
- lesson #29 决策档案与执行档案脱节 — 改 decisions.md 必须同步 CLAUDE.md / claude.yml

### §6.2 数据 / 内容

- lesson #2 聚合器空跑必须非零退出
- lesson #5 批量生成内容后必须跑构建验证
- lesson #30 抽样率失真（输出层 ≠ 全量层，详见 BIAV-SC §8.5）

### §6.3 VitePress / Wiki

- lesson #6 frontmatter 冒号加引号
- lesson #7 img src 用 `:src` 动态绑定

### §6.4 协作 / 通信

- lesson #3 CONTEXT.md 必须同步实际状态
- lesson #10 Issue 不是跨会话通信手段，要写 CONTEXT.md

### §6.5 事实采信纪律（最高优先级）

- lesson #32 R1/R2/R3 — 详见 `BIAV-SC.md §8.7`

### §6.6 关键决策档

| 日期 | 决策 |
|------|------|
| 2026-03-29 | 直推 main 落地 |
| 2026-04-19 | 战略转向：BPT 删除 + 主控台长期锚点 |
| 2026-04-26 | 银芯重新定位 v2.0 + 三新使命 + Phase 大一统 |
| 2026-04-26 | 贡献协议 v1.0 落档（Q1-Q5 守密人裁决） |
| 2026-05-06 | 入口架构重设计（统一 BIAV-SC.md / README 跳转 / CLAUDE.md 个人化）|

### §6.7 视觉规范

完整规范 `memory/style-guide.md`。背景 `#0a0b10` / 主金 `#c5a356` / 亮金
`#e2c97e` / 字体 Noto Serif SC + Noto Sans SC / 装饰 `◇ ◇ ◇` / 禁 emoji。

---

## §7 变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.x | ~ 2026-04-26 | Claude Code 工程维护指南（混合 AI 入口 + 人类速查） | 累积 |
| v2.0 | 2026-05-06 | 入口架构重设计批 1：拆出 AI 入口职责（下沉到 BIAV-SC.md），本文件专门化为 Light 个人维护备忘，加 §0 警告章驱动 Claude Code 启动跳转 | 艾瑞卡（Code-site 入口架构重设计批 1）|
| v2.1 | 2026-05-10 | §2.1 hook 表补 PostToolUse（session_watch.py）+ UserPromptSubmit 转正（session_inject.py）+ MCP 服务器登记；§3.1 workflow 表补 backfill-news / backfill-gap / discord-history-backfill / extract-game-data / test-collectors / cleanup-stale-branches 6 项 | 艾瑞卡（claude/add-claude-documentation 分支）|
