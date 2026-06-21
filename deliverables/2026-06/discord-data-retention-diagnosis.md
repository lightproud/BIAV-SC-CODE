# Discord 数据滞留诊断报告

> 排查性档案 · 艾瑞卡 · 2026-06-21
> 仓内路径：`deliverables/2026-06/discord-data-retention-diagnosis.md`
> 性质：诊断（排查），仅出结论与修复建议，**未擅改任何运营逻辑**

---

## 1. 结论先行

`projects/news/data/discord/channels/` 现存 **3.3 GB / 12803 个 jsonl**，
跨度 2023-07 → 2026-06。其中 **10921 个文件 / 2.65 GB** 属于「已归档到
Releases、本应从 git 删除、却仍滞留在工作树」的对冲数据。

根因是两条 CI 工作流**没有相互感知，彼此对冲**：

| 工作流 | 节奏 | 动作 |
|--------|------|------|
| `discord-archive.yml`（月度清理分支）| 每月 1 号 06:00 UTC | 把超 60 天的月份打包传 Releases，再 `git_rm` 出工作树 |
| `discord-history-backfill.yml` | **每小时** :30 | 沿历史往回拉消息，按消息真实日期重新写回 `channels/{ch}/{date}.jsonl` |

月度清理刚把老数据删掉，每小时回填就把**同一批老月份**重新拉回来写盘。
净效果：2.65 GB 数据在「删 → 写回 → 删 → 写回」之间无限循环。

> 小学生比喻：一个同学每月初把旧作业本收进储藏室（Releases），另一个同学
> 每小时跑去储藏室照着旧作业重新抄一本摊在桌上（工作树）。桌子永远堆满，
> 储藏室也白收。两人都不知道对方在干嘛。

---

## 2. 冒烟枪（三重验证）

**验证 1 — 账面对不上**
`archive-log.json` 标记 **30 个月**（2023-11 → 2026-04）已
`uploaded_to_releases: true`（归档时间 2026-06-01）。但其中 **28 个月仍在工作树**。

**验证 2 — git 历史指认回填**
样本 `channels/03536711/2024-01-01.jsonl`（属已归档的 2024-01）最近一次写入：
```
ee8fb7c2 2026-06-20 16:08:47 +0000 chore: discord history backfill [skip ci]
```
该月 2026-06-01 已被清理删除，2026-06-20 又被 history backfill 重新写回——
时间线直接坐实「删后重写」。

**验证 3 — 唯二「干净」的月份只是还没轮到**
30 个归档月份里，只有 **2026-02 / 2026-03** 当前不在工作树。并非幸免：
回填指针 `state.json::historical_month` 现位 **2026-04**，沿 `_prev_month`
逐月倒退，尚未倒回 2026-03/02。数小时内指针到达，它们同样会被重新拉回。

---

## 3. 机理细节（代码级）

### 3.1 清理侧（`archive_engine.py` + `archive_sources.json`）
discord 归档配置：
```json
{ "group_by": "month_from_stem", "cutoff_days": 60,
  "release_tag": "community-data", "after_archive": "git_rm" }
```
`is_eligible()` 按文件名日期 `stem < cutoff_date`（≈ 今天 -60 天）判够龄，
够龄即传 Releases 并 `git_rm`。逻辑本身正确。

### 3.2 回填侧（`discord_archiver.py::run_history_only`）
- `_init_historical_month()`：指针为空时**重置为「上个月」**。
- 主循环按 `_prev_month` 逐月倒退，每月把消息按真实时间戳写入
  `channels/{ch}/{date}.jsonl`（`_write_msg`，第 215 行）。
- 倒退到建服月份后，`historical_month = None`（第 1135 行）。
- **关键缺陷**：下一次运行 `_init_historical_month()` 见 `None`，**又重置回上个月**，
  整个倒退-回填重新来一遍。回填被设计成「一次性深挖历史」，实际却成了**永动机**。

### 3.3 对冲点
回填写盘（`_write_msg`）与归档清理**共用同一批文件路径，却无任何协调**：
- 回填不读 `archive-log.json`，不知道哪些月份已归档删除；
- 回填不受 `cutoff_days` 约束，照样写 60 天前的老文件；
- 两条流都带 `[skip ci]`，互不触发、各跑各的。

---

## 4. 修复建议（待守密人裁定，未实施）

按「最小改动 → 最稳」排序，三选一或组合：

**建议 A：回填感知归档（单一事实源，推荐）**
`_write_msg` 或月循环开头读 `archive-log.json`，跳过已
`uploaded_to_releases` 的月份。改动小、直击对冲。
> 比喻：抄作业前先看储藏室清单，已收走的那几本就别抄了。

**建议 B：终结回填永动机**
给 `state` 加 `history_backfill_complete` 标志；指针触底置 `None` 后
不再 `_init_historical_month` 重置。回填回归「一次性深挖」本意。
> 比喻：旧作业抄完一轮就收手，别每天重抄。

**建议 C：写盘统一受 cutoff 约束**
`_write_msg` 拒绝写入早于 `cutoff_days` 的文件，让回填与清理共用同一条
年龄红线。最彻底，但会**永久放弃** 60 天前历史的工作树留存（仅存 Releases）。
> 比喻：桌上只准放近两个月作业，更早的一律只进储藏室。

**艾瑞卡评估**：A + B 组合最稳——A 立即止血（不再重写已归档月），
B 根治永动机（回填不再无限重启）。C 改变留存语义，需守密人确认是否接受
「60 天前历史不再进工作树、只在 Releases」。是否动手、动哪条，请守密人裁定。

---

## 5. 涉及文件清单

| 文件 | 角色 |
|------|------|
| `.github/workflows/discord-archive.yml` | 月度清理触发 |
| `.github/workflows/discord-history-backfill.yml` | 每小时回填触发（对冲源）|
| `projects/news/scripts/discord_archiver.py` | 回填写盘逻辑（`run_history_only` / `_write_msg`）|
| `projects/news/scripts/archive_engine.py` | 归档清理引擎（`is_eligible` / `git_rm`）|
| `projects/news/scripts/archive_sources.json` | discord cutoff/git_rm 配置 |
| `projects/news/data/discord/archive-log.json` | 归档账本（回填应读未读）|
| `projects/news/data/discord/state.json` | `historical_month` 指针 |
