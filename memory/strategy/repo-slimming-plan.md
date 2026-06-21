# 仓库瘦身方案（体量优化 + Releases 归档）

> 产出：2026-06-20 `/grill 优化银芯仓库` 拷问会话 B 分支（艾瑞卡）。
> **2026-06-20 重大更正**：本档案初版（PR #263）误断「Releases 归档从未写脚本」，
> 经守密人「先验证上传」裁定逼出真相——归档系统**早已完整存在并运行**。下文为更正后版本。
>
> 守密人逐分支裁定：优先维度 = git 健康；A 分支 413 防护已落地（pre-push 钩子）；
> 体量瘦身跟 Releases 内容一起考虑；fanart = 月归档 Releases。

## 1. 体量诊断（2026-06-20 实测）

| 层 | 体量 | 占比 |
|----|------|------|
| `projects/news/data/discord/` | 3.1G | 工作树 ~81% |
| `projects/news/data/fanart/` | 588M | ~15% |
| `.git`（历史） | 1.1G | — |
| `assets/data/vectors.json.gz` | 8.7M | 已清（孤儿）|

> 比喻：行李箱 96% 重量来自聊天记录 + 同人图两个箱格。

## 2. 上传链路验证结论（守密人「先验证上传」裁定的答案）

| 路径 | 可行性 | 铁证 |
|------|--------|------|
| **GitHub Actions workflow 上传** | **可行，且早在用** | `discord-archive.yml`（每月1日 06:00 UTC + 手动 force-month / monthly-cleanup）调 `archive_discord.py` 上传，已发布 9+ 月归档 release（discord-archive-2025-08 ~ 2026-04）+ media-archive-v1 |
| **云容器手动上传** | **不可行** | gh / hub 均不存在；mcp__github__ 无 release 上传工具（仅 list/get 只读）；直接 API 仅 GET 可达 |

**含义**：任何瘦身的「上传」步必须走 workflow（runner 的 GITHUB_TOKEN），云容器（含本会话艾瑞卡）只能查、不能传。

## 3. 现有归档系统（更正：并非缺基建）

完整存在，**非「从未实现」**：

- 脚本：`projects/news/scripts/discord_archiver.py`（增量采集）、`archive_discord.py`（月清理：归档老月→Releases→删 git）、`archive_platforms.py`。
- workflow：`discord-archive.yml` / `discord-archive-jp.yml` / `discord-archive-volunteer.yml` / `backfill-media.yml`。
- 日志：`archive-log.json` 标记 2023-11 ~ 2026-04 全部 `uploaded_to_releases: true`。

落实决策 179 的代码**早已写好并跑过**。初版方案「决策 179/199 从未写脚本」论断作废。

## 4. 真实缺口（2026-06-21 已闭合）

归档日志标记 2023-11~2026-04 已上传并应删 git，但 `channels/` 里这些月的 jsonl **仍在**（每月百余文件，构成 3.3G）。

**诊断结论（2026-06-21）**：真因 = `discord-history-backfill.yml`（每小时跑 `discord_archiver.py --history-only`）逐月回拉已归档月写回 git，与月清理（一月一次）形成对冲循环。git-log 铁证：样本 `channels/.../2024-01-18.jsonl` 仅由 `discord history backfill` 提交添加。`archive_discord.py` 删除步本身正常（workflow 有 commit+push）。

**修复**：
1. **断环（根因）**：`discord_archiver.py` 历史回填两处循环加「已归档月跳过」守卫——`_archived_months()` 读 `archive-log.json`（`uploaded_to_releases` 为真的月，兼容 `month`/`group` 双 schema），命中即 `_advance_historical_month` 跳过、零 API 零写入。已在 main 生效（守密人/并行会话独立实现，本会话另写同款后按 lesson #35 弃用、采用 main 版）。
2. **排空存量**：2026-06-21 经 `discord-archive.yml` force-month 对 30 个已归档月重归档（--clobber 把 `community-data` 更新为含回填补全的更全版本 6.6MB→287MB）+ git_rm + push。channels/ **12,803→1,882 文件、3.3G→600M**，仅留近月 2026-05/06（未够 60 天龄）。守卫已生效，回填不再填回。

> 比喻：以前一个人往外搬旧报纸、另一个每小时从仓库搬回来；现在给搬回来那人立了规矩「已入库的别再搬」，并把门口堆积的旧报纸一次清走。

## 5. fanart 现状（待核）

fanart 有 `collect-fanart.yml` / `recover-fanart.yml` / `backfill-media.yml` + `collect_fanart.py`，且 media-archive-v1 release 已发布——fanart 是否已纳入某归档、月归档是否已部分实现，**初版未核实，待查**。守密人裁定的「fanart 月归档」方向不变，但落地前须先核现状，避免重复造轮子（lesson #35）。

## 6. 已落地（确定无误部分）

- `assets/data/vectors.json.gz` 孤儿清理（语义检索 6-20 退役残留，无脚本引用）+ 修 .gitignore 陈旧注释。
- **不改写 git 历史**（避撞 main Ruleset + 破坏现有 clone / 采集基线）；`.git` 1.1G 历史留待真瓶颈（延续决策 178 精神）。

## 7. 后续（守密人择期）

- ~~**诊断**：对冲缺口~~ **2026-06-21 已闭合**（见 §4：断环守卫 + 30 月排空，channels/ 3.3G→600M）。
- ~~**fanart 现状核实**~~ 已落地：fanart 归档进 `community-assets` 滚动 release（`archive_sources.json` fanart 条目，见 RELEASES.md §2.4）。
- 所有「上传 / 删 git」执行走 workflow，非云容器手动。
