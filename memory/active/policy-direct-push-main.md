# 直推 main 政策（active hub）

> 注：与 CLAUDE.md §7.6 现行口径存在冲突（本卡：直推 main；§7.6：本会话按派发要求在指定 feature 分支开发），待守密人裁定。
> **2026-07-10 补**：§7.6 合并治理线三段演进已补入下方决策时间线——2026-06-11 合并默认规则、
> 2026-06-21 自查自合（撤 required test）、2026-07-10 CI 硬门禁重启获批（Ruleset 待守密人手动勾选，
> 勾选前过渡期仍按自查自合）。现行运行时口径以 CLAUDE.md §7.6 为准。
>
> 主题入口卡 / Code-memory batch 1 落档 2026-05-03
> 决策版本号：v1.1（2026-06-03 补网页/远端环境等效执行条款）
> 上游决策：`memory/decisions.md` 2026-03-29 + 2026-04-26 双条目
> 工程规则：`CLAUDE.md` §7.6 分支与提交（2026-06-09 修正：原引「§1」对应旧版结构，现行 §1 为项目本质）

---

## 一、引文 + 摘要

> 「**所有会话直接推 main**，不用 feature 分支。冲突时 `git pull --rebase origin main` 重试。」（旧版 `CLAUDE.md` §1，2026-04-26 落地；现行 CLAUDE.md 已无此条文，政策源头见 `memory/decisions.md` 2026-03-29 + 2026-04-26 条目）

**一句话摘要**：银芯仓库自 2026-03-29 决策、2026-04-26 PR #141 全档案对齐落地起，**所有 AI 会话（现为守密人 ↔ 单一艾瑞卡会话；原主控台 / Code-* 多会话角色已于 2026-06 退役）的所有 commit 直接推送到 `origin/main`**，不创建 feature 分支、不走 PR / merge 流程，冲突时 `git pull --rebase` 后重推。

理由：项目无人工程序员，全 AI 协作，分支 + 合并流程徒增 round-trip。直推 main 让多会话并行不阻塞。

---

## 二、当前结论（2026-05-03 截）

| 项 | 现状 |
|---|---|
| 决策版本 | v1.0（2026-04-26 PR #141 合并落地）|
| 适用范围 | 所有 AI 会话所有 commit 类型（业务代码 / 文档 / 索引 / hub / brief） |
| 例外清单 | 仅 dependabot 自动 PR（按 batch 升级模式人工合并）|
| 配套基础设施（2026-06-14 更替）| 原 `.claude/hooks/session-start-sync.sh`（会话启动 sync）已随全部会话钩子退役删除；413 防护改由 **git 层** `.githooks/pre-push` 承担（push 前对齐 origin/main，需 `git config core.hooksPath .githooks` 启用，见 CLAUDE.md §7.4）|
| 失步重新同步 | `git fetch origin main` + `git pull --rebase origin main`，必要时 `git stash -u` 暂存本地未跟踪 |
| 推送失败重试 | 指数退避 4 次（2s / 4s / 8s / 16s），仍失败检查 Cloudflare 413 |
| 禁用项 | `git rebase -i` / `git add -i`（Claude Code 沙盒不支持）/ `git push --force` 至 main / `--no-verify` |
| 历史 feature 分支 | 2026-04-26 24 个未合并 `claude/*` 分支审计后全部删除（守密人本地批量执行）|
| 网页/远端环境等效执行（2026-06-03）| Claude Code 网页/远端环境平台级强制「推送后建 PR」，无法跳过建 PR 本身。默认动作：**推分支 → 开 PR → 立即转正合并 main → 撤监听，不停等评审**，体验等同直推 main。本地终端会话仍按本政策直推 main 不开 PR |

### 配套教训

- **lesson #28**：本地 main 与 origin/main 反复失步触发 Cloudflare HTTP 413 推送堵塞；现由 git 层 `.githooks/pre-push` 预防（原 SessionStart hook 解法 2026-06-14 退役，见 lesson #34/#39）
- **lesson #29**：决策档案与执行档案脱节，规则改了 `decisions.md` 必须同步 `CLAUDE.md` / `claude.yml`
- **lesson #32（最高优先级）**：事实采信纪律（R1 / R2 / R3）覆盖所有报告 / 审计 / 周报场景

### 决策时间线

| 日期 | 事件 |
|---|---|
| 2026-03-29 | 主控台决策「废弃分支工作流，全部直接推 main」，写入 `decisions.md`、`BIAV-SC.md` |
| 2026-04-25 | 发现 `CLAUDE.md` Git 规则章节未同步更新，仍写「推 feature 分支」（lesson #29 根因）|
| 2026-04-26 | PR #141 落地：`CLAUDE.md` / `claude.yml` 全部对齐 2026-03-29 决策；删除 `claude.yml` 自动 merge step；24 个未合并 `claude/*` 分支审计后清理；装 `SessionStart` hook |
| 2026-06-11 | 合并默认规则：feature 分支任务完成且验证通过后，守密人「合并」即默认合并 main，不逐项确认（CLAUDE.md §7.6）|
| 2026-06-14/21 | 直接合并 main + PR 订阅可选：Web 环境强制建 PR，验证通过后默认立即 squash 合并；退订不再强制（§7.6）|
| 2026-06-21 | 自查自合：main Ruleset 撤 required `test` 检查，验证责任移交会话（合并前自跑 pytest，全绿才合）|
| 2026-07-10 | CI 硬门禁重启获批：Ruleset 恢复 required `test` + require branches up to date（GitHub 设置项待守密人手动勾选，勾选前过渡期仍按自查自合）|

---

## 三、相关档案

### 决策与规则源头

- `memory/decisions.md` — 完整决策日志（2026-03-29 / 2026-04-26 直推 main 双条目）
- `CLAUDE.md` §7.6 分支与提交 — 现行 Git 工作流条款（已无直推 main 条文，默认政策指回本卡；与本卡冲突待守密人裁定）
- `CLAUDE.md` §0 / §2 — 任何 AI 接入银芯的统一入口（**原 `BIAV-SC.md` 已退役，入口收归 CLAUDE.md**）

### 工程基础设施

- `.githooks/pre-push` — push 前对齐 origin/main 防 413（2026-06-20 重新引入的 **git 钩子**；原 `.claude/hooks/session-start-sync.sh` 会话钩子 2026-06-14 已退役删除）
- `.claude/settings.json` — 现仅留 `$schema`，**无任何自定义会话钩子**（2026-06-14 全部退役，见 CLAUDE.md §7.4）
- `.github/workflows/claude.yml` — Claude Code GitHub Actions 已移除 auto-merge feature 分支步骤（2026-04-26）

### 相关教训

- `memory/lessons-learned.md` #28 — Cloudflare HTTP 413 推送堵塞与 SessionStart hook 解法
- `memory/lessons-learned.md` #29 — 决策档案与执行档案脱节（`CLAUDE.md` 滞后 28 天）
- `memory/lessons-learned.md` #32 — 事实采信纪律 R1/R2/R3

### 历史档案

- `memory/archive/bpt-strategic-shift-2026-04-19/` — 2026-04-19 BPT 战略转向归档（含早期分支工作流痕迹）

### 子项目执行参照

- `projects/site/CONTEXT.md` — Code-site 直推 main 实操记录
- `projects/news/CONTEXT.md` — Code-news 直推 main 实操记录（dependabot batch update 例外）
- `projects/wiki/CONTEXT.md` — Code-wiki 直推 main 实操记录

---

## 四、新会话快速核对清单

启动会话时执行：

```bash
# 1. 确认当前在 main
git branch --show-current

# 2. 确认本地与 origin 同步
git fetch origin main && git log --oneline HEAD..origin/main
# (应为空：本地领先于或等于 origin)

# 3. 推送前检查
git push -u origin main
# 失败时：git pull --rebase origin main && git push -u origin main
```

如 `git push --delete` 删除远端分支返回 HTTP 403，由守密人本地终端或 GitHub UI 处理（沙盒环境无远端删除权限）。

---

## 五、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-03 | 初版主题入口 hub 落档（Code-memory batch 1） | Code-memory 艾瑞卡 |
| v1.1 | 2026-06-03 | 补网页/远端环境等效执行条款（推→开 PR→即合并→撤监听），守密人 2026-06-03 确认默认 | 艾瑞卡 |
| v1.2 | 2026-07-10 | 决策时间线补 2026-06-11 / 06-14/21 / 06-21 / 07-10 四段合并治理演进，头注明确现行口径以 CLAUDE.md §7.6 为准 | 艾瑞卡（记忆档案事实核对会话）|
