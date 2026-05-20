# Light 维护速查（runbook）

> 从 CLAUDE.md §8 外迁，2026-05-20。仅供 Light 个人做仓库维护时参考。
> CLAUDE.md 入口只保留一行指针，避免每次会话强加载到上下文。

---

## §1 SessionStart hook

`.claude/hooks/session-start-sync.sh` 每次会话启动 fetch origin/main 并同步 local main，
备份旧 tip 到 `refs/backup/main-pre-sync-<timestamp>`。日志 `/tmp/session-start-sync.log`。

## §2 SessionEnd hook

`.claude/settings.json` 注册 SessionEnd hook，会话结束跑 `scripts/session-end-distill.sh
→ scripts/session_distiller.py`，产出 `memory/session-digests/{stamp}-{sid}.md`，自动
commit + push。日志 `/tmp/session-distill.log`。

## §3 stop-hook

`~/.claude/stop-hook-git-check.sh`（Light 个人级，跨仓库），检测未追踪文件或未推 commit 提示。

## §4 workflow 频率

| Workflow | 频率 | 功能 |
|---|---|---|
| `update-news.yml` | 每日 06:00 / 16:00 UTC | 多平台社区聚合 |
| `discord-archive.yml` | 每日 18:00 UTC | Discord 全量归档 |
| `deploy-site.yml` | push 触发 | 主站 + Wiki + News 部署 gh-pages |
| `fetch-wiki-data.yml` | 每周一 | 抓取 Fandom/Bilibili Wiki 角色 |
| `check-version.yml` | 每周一 | 游戏版本更新检测 |
| `validate-data.yml` | push 触发 | 事实圣经 JSON Schema 校验 |
| `dream.yml`（浅睡）| 每 6h | 结构检查 + 哨兵扫描 + 索引重建 |
| `dream.yml`（深睡）| 每日 19:00 UTC | Claude 趋势分析 + 知识缺口识别 |
| `dream.yml`（REM）| 每周一 01:00 UTC | Claude 周报 + 经验提炼 |
| `claude.yml` | Issue 触发 | Claude Code GitHub Actions（已禁自动 merge） |
| `cleanup-stale-branches.yml` | 每周一 02:00 UTC | 清理已合 main 的 claude/* 分支 |

## §5 高频故障

- **空数据导致历史覆盖**（lesson #2）：聚合器空跑必须非零退出。
- **VitePress frontmatter 冒号未引号**（lesson #6）：title 含冒号必须 `title: "Doll: Inferno"`。
- **VitePress img src 以 / 开头被 Vue 编译器当 import**（lesson #7）：用 `:src="'/...'"` 动态绑定。
- **批量生成内容后未跑构建验证**（lesson #5）。
- **数据层 vs 输出层混淆**（lesson #30，详见 CLAUDE.md §4）。

## §6 凭据 / 部署 / Cloudflare

- 公开 ID（NGA 版块 / TapTap APP ID / Discord Guild ID）直接硬编码（lesson #9）
- 真凭据（`ANTHROPIC_API_KEY` / `DISCORD_BOT_TOKEN` / `GITHUB_TOKEN`）放 repo secrets
- GitHub Pages Source = `gh-pages` 分支；用 `peaceiris/actions-gh-pages@v4` 而非 `actions/deploy-pages`（lesson #9）
- Cloudflare 413 → SessionStart hook 自动同步预防（lesson #28）。手动：`git fetch origin main && git reset --hard origin/main`
- 部署后视觉验证：Web 端 Claude Code 无外网（lesson #16），用 PC 端或浏览器手动 review

## §7 子项目维护备忘表

每个子项目根目录有 `CONTEXT.md`，新会话启动前必读对应子项目的 CONTEXT.md。

| 子项目 | 路径 | 负责会话 | 关键约束 |
|--------|------|---------|---------|
| 主站 + 部署 + 视觉 | `projects/site/` | Code-site | 部署流水线归此处统一管理 |
| 社区新闻聚合 | `projects/news/` | Code-news | 聚合器空跑必须非零退出（lesson #2） |
| Wiki + 数据集 | `projects/wiki/` | Code-wiki | VitePress frontmatter 冒号要加引号（lesson #6） |
| 衍生游戏 | `projects/game/` | Code-game（未启用） | 暂缓 |
| 记忆基础设施 | `scripts/` + `assets/data/` 索引 | Code-memory | 9 模块；不写业务数据 |
| 长期战略智库 | `memory/strategy/` + `memory/research/` | Code-strategy | 长尺度调研；不写代码、不写决策档 |
| BPT 开发指导 | `memory/bpt-guidance-*.md` | Code-BPT | 不写银芯代码；只产出搬运包 |

## §8 关键决策档（快查）

| 日期 | 决策 |
|------|------|
| 2026-03-29 | 直推 main 落地 |
| 2026-04-19 | 战略转向：BPT 删除 + 主控台长期锚点 |
| 2026-04-26 | 银芯重新定位 v2.0 + 三新使命 + Phase 大一统 |
| 2026-04-26 | 贡献协议 v1.0 落档（Q1-Q5 守密人裁决） |
| 2026-05-06 | 入口架构重设计批 1 落地（双入口设计）|
| 2026-05-06 | 信息分类法则 v1.0 落档 |
| 2026-05-10 | 卡帕西编码 4 原则采纳 |
| 2026-05-19 | 入口架构反转：CLAUDE.md 统一入口 / BIAV-SC.md 彻底废弃 |
| 2026-05-20 | CLAUDE.md 卡帕西审视瘦身（§8 外迁本文件）|

完整 32 条 lessons 见 `lessons-learned.md`。完整决策档见 `decisions.md`。
