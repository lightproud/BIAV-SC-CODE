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

---

## 8. 2026-06-21 方向反转：text 回归 git（`/grill 规划社区数据存放和目录`）

> **重大转向**：§1–§7 的瘦身路线（把 discord 等推出 git → Releases）于同日 `/grill` 拷问会话被守密人反转。**新总纲：按性质分流——可检索 text 回归 git，二进制留 Releases。** 本节为新权威，§1–§7 降为历史记录。直接反转决策 86（discord 60 天分级）与 178/179/199 的 text 部分；§4 刚完成的 discord 排空（3.3G→600M）将被 de-tier 回填覆盖。

**反转理由（拷问 Q1 对齐）**：text 进 Releases = 自废 grep/read/diff/AI 分析武功（本会话建社区索引被迫写 `restore_release_data.py` 下 301MB 即铁证）；二进制留 Releases 几乎零访问损失（本就按整件下载）。故 text 的访问便利是刚需。

### 8.1 三方真相源（铁律）

| 真相源 | 收纳 |
|--------|------|
| **git** | 全部 text：discord 全量 / platforms / 解包 text / 索引 |
| **「解包」release** | 全部游戏二进制：立绘/CG/音视频/特效/UI + lua-bytecode + config binary |
| **「社区二创」release** | 社区二进制：fanart + media |

### 8.2 git 目录树（套 BPT v2.0 4R 本体 = 银芯↔黑池接口协议）

```
Public-Info-Pool/
├── Root/        Resource/                 # 后置（社区索引归 Resource/projection/）
├── Record/Community/{discord, bilibili, reddit, steam, …16+源摊平对齐} + index.md
└── Reference/Game-Unpacked/ + index.md
```

原始时序数据（百万 jsonl）**免逐文件 frontmatter**：目录归位 + 每目录 `index.md` 概述即合规；frontmatter 留策展知识层（OKF/索引）。

### 8.3 Release 收敛为 2

- **「解包」** = `unpacked-assets` + `unpacked-data` 二进制残余合并（config 重打包剥 text）。
- **「社区二创」** = `community-assets`（fanart/media）。
- `community-data`（discord）**退役删除**（全量入 git）；`unpacked-data` text 入 git。

### 8.4 discord de-tier（高风险执行件）

转「全量永驻 git、退役月度 git_rm 瘦身」——拆 `discord_archiver.py` 月度清理 + §4 刚加的「已归档月跳过」防重拉守卫（前提消失）。fanart/media `git rm` 移出工作树（**不改历史**，历史压缩守密人未来另议）、采集链改直传 release。

### 8.5 执行策略

守密人裁定**一次到位**（单次原子迁移，非分阶段）。Release 写 + 大推走 CI workflow（容器无权限/推不动，决策 2026-06-20 不变），容器仅备工具、CI 跑、守密人盯头几班采集。

> 比喻：上午刚把聊天记录从手边书架搬去异地仓库腾地方，下午发现「手边搜不到」才是真痛点，于是决定全搬回书架；代价是书架重些，但二进制海报仍留仓库不占地——书架只放能翻能搜的手稿。

### 8.6 决策落档

两条决策草案（数据本体总纲 + Release 收敛/discord de-tier）已拟，待守密人提交 `memory/decisions.md`（§3.1 仅守密人权限）。

---

## 9. 历史压缩 runbook（守密人本地执行；艾瑞卡只出方案不动历史）

> **前提警告**：本操作**改写 git 全历史**，反转决策 2026-06-20「不改写 git 历史」。
> 反转理由需守密人重新裁定 + 记一笔。**云容器执行不了**（强推受保护 main 被 Ruleset 挡、
> 改全 SHA 废所有 clone），故下列步骤**全部在守密人本地机执行**。
>
> **诚实预期**：本操作瘦的是 `.git`（清掉历史里已移出的废二进制），**不会让 CI checkout 变快**
> ——checkout 慢源于当前树大（729 万 discord text 常驻，是想要的），与历史无关。

### 9.1 剥离清单（2026-06-21 核验：以下路径在【当前工作树】均 0 跟踪文件，剥离不丢现存数据）

| 路径 | 性质 | 现存数据是否受影响 |
|------|------|------|
| `assets/data/vectors.json.gz` | 语义检索退役孤儿 | 否（已不在树）|
| `deliverables/` | 旧废目录 | 否 |
| `projects/news/data/fanart/` | 已移出的同人图二进制（reclaim 大头）| 否（本体在 community-assets release）|
| `projects/news/data/media/` | 已移出的回填媒体 + churn manifest | 否（本体在 community-assets release）|
| `projects/news/data/discord/` | 迁移前旧路径 discord（对冲 churn）| **否**——现存全量已在 `Public-Info-Pool/Record/Community/discord/`（17,516 文件，同 blob 经 git mv 仍被新路径引用）|
| `projects/news/data/platforms/` | 迁移前旧路径平台 | 否——现存在 `Public-Info-Pool/Record/Community/<platform>/` |

### 9.2 执行步骤（守密人本地）

```bash
# 0) 装工具 + 全量备份（铁律：先备份，重写不可逆）
pip install git-filter-repo
git clone --mirror https://github.com/lightproud/brain-in-a-vat.git biav-backup.git  # 异地备份

# 1) 在一份全新 clone 上操作（filter-repo 要求 fresh clone）
git clone https://github.com/lightproud/brain-in-a-vat.git biav-rewrite && cd biav-rewrite

# 2) 剥离（--invert-paths = 删这些路径的全部历史；其余不动）
git filter-repo --invert-paths \
  --path assets/data/vectors.json.gz \
  --path deliverables/ \
  --path projects/news/data/fanart/ \
  --path projects/news/data/media/ \
  --path projects/news/data/discord/ \
  --path projects/news/data/platforms/

# 3) 核验：当前树文件数不变、.git 显著变小、现存数据(新路径)完好
git ls-files | wc -l          # 与重写前对比应一致（旧路径本就不在树）
du -sh .git                   # 应从 ~1.6G 显著下降
git ls-files Public-Info-Pool/Record/Community/discord | wc -l   # 应仍 ~17,516

# 4) 临时解 main Ruleset 保护（GitHub repo Settings → Rules），强推，立即恢复保护
git remote add origin https://github.com/lightproud/brain-in-a-vat.git
git push --force origin main

# 5) 善后：所有 clone 方（含云容器环境、本地其它 clone）必须【重新 clone】，旧 clone 作废
#    采集 workflow 下一轮自动跑 fresh checkout，确认首轮正常不断料
```

### 9.3 风险核对表（执行前逐项确认）

- [ ] 已 `git clone --mirror` 异地备份（可回滚的唯一保险）
- [ ] 已重新裁定并记录「反转 2026-06-20 不改写历史」决策
- [ ] 确认无未合并的开放 PR（强推后全失效）
- [ ] 临时解保护 → 强推 → **立即恢复** main Ruleset 保护
- [ ] 推后核验：`Public-Info-Pool/` 全量数据完好、采集 workflow 首轮 GREEN
- [ ] 通知所有 clone 方重新 clone（旧 SHA 全废）

### 9.4 更省事的替代（若只想缓解，不想动历史）

历史压缩治不了「CI/clone 慢」（当前树大）。若真痛点是 CI 慢，更安全的是让重型 CI job 用
`actions/checkout` 的 `sparse-checkout` 只拉所需子树（不触历史、零 clone 破坏）——这是另案，
可单独评估。

## 10. Discord 记录紧凑 schema（2026-06-22 已执行，省当前树 41%）

决策见 `memory/decisions.md` 同日条目。这是 §8 迁移（text→git）后的**当前树**体积优化，
与 §9 历史压缩正交、互补：§10 缩小当前树，§9 缩小 .git 历史。

- **依据**：全量 721 万条实测 91.8% 字节是元数据 + 重复 JSON key，content 正文仅 8.2%；
  7 个字段近 100% 恒为默认值（测量器 `scripts/measure_discord_compaction.py` 出账）。
- **方案（变体 A）**：紧凑 schema「缺字段=默认值」契约，删恒定/空值字段，恒留
  id/channel_id/author_id/author_name/content/timestamp，非空才留可选容器；**保留 channel_id**
  （不取变体 B 多省 250MB，换 grep 自足、不寄生 channel_index.json）。
- **落地**：`projects/news/scripts/discord_compact.py`（单一权威：`compact_record`/`expand_record`）；
  归档器写盘点前向紧凑；存量一次性 `scripts/compact_discord_archive.py`（幂等/原子写/dry-run）
  重写 16,023 文件。
- **效果**：discord 工作树 3.4G→2.0G（-1381.5MB / 41.2%）。
- **验证**：60 文件 16,122 条同源 A/B（vs git HEAD）索引输入逐条无损；全量 pytest 绿。
- **遗留**：.git 实际瘦身仍待 §9 历史压缩（紧凑前的胖 blob 仍在历史里）；config release 文本冗余另议。
