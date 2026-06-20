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

## 4. 真实缺口（待诊断，非本次范围）

归档日志标记 2023-11~2026-04 已上传并应删 git，但 `channels/` 里这些月的 jsonl **仍在**（2023-12 至 2025-07+，每月百余文件，构成 3.1G）。

疑似真因：`discord-history-backfill.yml` 历史回填把月清理删掉的老数据**又拉回 git**，与月清理形成对冲循环；或 `archive_discord.py` 删除步未生效。**需 diagnosing 确认**，守密人 2026-06-20 暂未派此诊断。

> 比喻：一个人往外搬旧报纸，另一个人又从仓库搬回来，门口永远堆着。

## 5. fanart 现状（待核）

fanart 有 `collect-fanart.yml` / `recover-fanart.yml` / `backfill-media.yml` + `collect_fanart.py`，且 media-archive-v1 release 已发布——fanart 是否已纳入某归档、月归档是否已部分实现，**初版未核实，待查**。守密人裁定的「fanart 月归档」方向不变，但落地前须先核现状，避免重复造轮子（lesson #35）。

## 6. 已落地（确定无误部分）

- `assets/data/vectors.json.gz` 孤儿清理（语义检索 6-20 退役残留，无脚本引用）+ 修 .gitignore 陈旧注释。
- **不改写 git 历史**（避撞 main Ruleset + 破坏现有 clone / 采集基线）；`.git` 1.1G 历史留待真瓶颈（延续决策 178 精神）。

## 7. 后续（守密人择期）

- **诊断**：归档标记成功但 git 数据仍在的对冲缺口（读 `archive_discord.py` 删除逻辑 + `discord-history-backfill.yml` 回填范围）。
- **fanart 现状核实**后再定是否需补月归档。
- 所有「上传 / 删 git」执行走 workflow，非云容器手动。
