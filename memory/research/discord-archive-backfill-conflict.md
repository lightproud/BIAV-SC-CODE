# 诊断备忘：discord 全量 3.2G 仍在 git —— 状态与瘦身下一步

> **⚠ 已被覆盖（2026-07-10 对账补）**：本备忘描述 2026-06-20 时点状态（discord 在
> `projects/news/data/discord/channels/`）。次日 2026-06-21 守密人裁定 de-tier / text 全量
> 迁入 `Public-Info-Pool/Record/Community/discord/` 永驻 git，本档「瘦身下一步」议题已闭合。
> 仅供历史追溯。
>
> 2026-06-20 /grill 会话。承接 RELEASES.md §三与 lesson #40。
> **守密人 2026-06-19 已澄清**：下方「history backfill」是守密人从笔记本一次性手动回填、
> 已完成、永不再跑。**不存在管线对冲，无 workflow 需修**（艾瑞卡早先「两条 CI 管线对冲」
> 的推断作废）。

## 实际当前状态
- discord 全量 **3.2G / 12,434 jsonl** 在 git（`projects/news/data/discord/channels/`）。
- 来源：守密人 2026-06-19 手动回填（提交 `6340ecde`，纯新增 6090 文件），把历史数据灌回 git。
- archive-log 标 30 月（2023-11~2026-04）`uploaded_to_releases: true`，release 确有对应 30 个 `discord-archive-*` tag（元数据层已核对一一对应）。
- 现存月份 2023-12~2026-06，缺 2026-02/03（已删未回填，release 有）。

## 集合划分（瘦身的关键）
- **安全可删集合**：现存文件中月份 ∈ archive-log 30 个 uploaded 月份（2023-11~2026-04）。
  约 10,600 文件、3.2G 的绝大部分。这些 Releases 已有副本，删 git 不丢数据。
- **必须保留**：2026-05（1,154）、2026-06（679）共约 1,833 文件。**不在 archive-log、Releases 没有**、且在 60 天 cutoff 内，绝不可删。

## 单一正确下一步（受云环境禁 Releases 写约束）
**不要**在云环境直接跑 `python archive_discord.py`：它会尝试 `gh release create`，云环境禁写
→ upload 失败 → 脚本 fallback「keeping files in git」→ 等于白跑、零瘦身。

正确做法分两步：
1. **先核对 Releases 覆盖 vs 待删集合**（逐月确认 2023-11~2026-04 的 release asset 真实存在且非空——元数据层已确认 30 tag 存在；删除前再确认 asset size 非零即可）。
2. **只对已确认在 Releases 上的月份执行 `git rm`（不上传、不碰 release）**：即 2023-11~2026-04。
   绝不删 2026-05/06。可用 `archive_discord.py --skip-upload` 但需先限定月份至已覆盖集合，
   或直接 `git rm` 该集合的文件后提交。净降仓库约 3.1G。

> 比喻：仓库里堆了 3.2G 旧报纸（git），保险柜（Releases）里已存了 2023-11~2026-04 的扫描件，
> 这部分纸可以扔；但 2026-05/06 还没扫描进保险柜，扔了就真没了——扔之前先确认保险柜里有。

## 证据边界
- 仓库 shallow clone（92 提交可见），归档删除的原始时序不可回放；但 backfill 来源已由守密人直接澄清，无须再追。
