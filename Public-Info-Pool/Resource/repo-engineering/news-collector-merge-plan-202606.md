# news 采集器层治理调研 — 零产出源降级 + 双采集器合并

日期：2026-06-02
分支：`claude/news-source-cleanup`
范围：`projects/news/` 采集器层
结论摘要：**两项任务经排查均不存在「安全且语义自洽」的代码改动，故只产调研结论，不动采集代码。** 下方逐条给出证据。

---

## 任务 1：9 个零产出源降级 —— 不执行降级，理由如下

### 1.1 零产出事实（已核实）

`projects/news/output/source-health.json` 中以下 9 源均 `total_items: 0` 且 `last_success_date: null`：

| 源 | total_items | last_success_date | 健康分级 |
|----|-------------|-------------------|----------|
| nga | 0 | null | active（reseed） |
| taptap | 0 | null | active（reseed） |
| steam_discussion | 0 | null | active（reseed） |
| bahamut | 0 | null | active（reseed） |
| naver_cafe | 0 | null | active（reseed） |
| fivech | 0 | null | active（reseed） |
| arca_live | 0 | null | active（reseed） |
| zhihu | 0 | null | active（reseed） |
| note_com | 0 | null | active（reseed） |

（`source-health.json` 的 `active` 是 `silent_sources_audit.write_health` 把 `never` 强制 reseed 为 `active` 的结果，见该文件第 194-200 行注释，非真实活跃。）

### 1.2 `LEGACY_SOURCES` 语义不匹配（核心阻断点）

`projects/news/scripts/sources.py` 第 85-92 行对 `LEGACY_SOURCES` 的定义是：

> data/platforms/ 下仍有历史归档、但采集逻辑已移除的遗留源。不再产出新数据，仅供审计可见。

两个前提对这 9 源**全部不成立**：

1. **采集逻辑未移除**。9 源全部仍有活跃 fetcher：
   - `nga` / `taptap` / `steam_discussion`：`aggregator.py` 第 41-43、57-61 行直接调用 `fetch_nga` / `fetch_taptap` / `fetch_steam_discussions`（定义于 `aggregator_collectors.py`）。
   - `bahamut` / `naver_cafe` / `fivech` / `arca_live` / `zhihu` / `note_com`：`collect_global.py` 经 `global_collectors.py` 调用对应 `fetch_*`（`global_collectors.py` 第 642/690/901/1021/1083/1371 行等）。
   - `arca_live` / `naver_cafe`：另有 `backfill_platforms.py` 第 713-714 行的 `PLATFORM_BACKFILLERS` 活跃回溯采集器。
2. **无历史归档**。`data/platforms/` 下这 9 源**全部无目录**（实测 `NO DIR`）。`LEGACY_SOURCES` 的唯一功能价值是让 `silent_sources_audit.scan_unregistered_dirs()` + `print_legacy_section()` 把「有归档但未注册采集」的孤儿目录显形；这 9 源没有目录可显形，移入 LEGACY 不产生任何审计价值。

故移入 `LEGACY_SOURCES` 会得到一个**双重失真**的标签：既谎报「采集逻辑已移除」，又进入一个为「有归档孤儿」服务的列表却没有归档。

### 1.3 移出 `KNOWN_SOURCES` 会使核心源健康门控失明（回归）

`silent_sources_audit.py` 第 42 行 `ALL_REGISTERED_SOURCES = list(KNOWN_SOURCES)`；门控函数 `core_source_alarms`（第 291-297 行）遍历 `report['entries']`，而 entries 仅由 `ALL_REGISTERED_SOURCES` 生成。

`nga` / `taptap` 同时在 `CORE_SOURCES`（`sources.py` 第 71-74 行）。一旦把它们移出 `KNOWN_SOURCES`，它们就不再进入 `entries`，`core_source_alarms` 永远看不到它们 → update-news.yml 第 82-86 行「Core-source health gate」对 nga/taptap 沉默**彻底失明**。

而该门控的存在目的，正是「nga/taptap 等核心源零产出时标红告警」（workflow 注释原文）。降级它们 = 拆掉为它们设的告警。这与降级意图（让故障可见）直接相悖。

### 1.4 「不发明新机制」约束封死了第三条路

`sources.py` 除 `LEGACY_SOURCES` 外无任何 inactive / disabled 标记位。任务明令「不要发明新机制」。因此无法新增一个语义正确的「采集中但持续零产出」标记。

### 1.5 结论与推荐

- **不修改 `sources.py`。** 9 源全部保留在 `KNOWN_SOURCES`。
- 真正的问题不是「清单污染」，而是「9 个 fetcher 在产线持续失败」。正确处理是**修 fetcher 或停 fetcher**，而非把活 fetcher 的源名挪进「逻辑已移除」列表。
- 若守密人确认要让这些源退出产线，正确顺序是：先在 `aggregator.py` / `collect_global.py` / `backfill_platforms.py` 移除/禁用对应 fetcher 调用 → 再把源名移入 `LEGACY_SOURCES`（此时「逻辑已移除」才成立）→ 同步从 `CORE_SOURCES` 移除 nga/taptap/steam_discussion。这是一组有耦合的改动，需守密人就「砍源还是修源」先定方向，不属于「低风险外科手术」范畴。

---

## 任务 2：aggregator_collectors.py 与 global_collectors.py 合并 —— 方向有架构歧义，只产方案

### 2.1 生产调用链（已确认两套都在产线）

update-news.yml 第 34-65 行顺序执行：

1. `Run aggregator` → `aggregator.py`，`from aggregator_collectors import ...`（第 40 行）。
2. `Run global collectors (29 platforms)` → `collect_global.py`，`import global_collectors as c`（第 101 行）。

importer 实测：
- `aggregator_collectors.py` 仅被 `aggregator.py` import。
- `global_collectors.py` 被 `collect_global.py`、`backfill_gap.py`、`backfill_platforms.py` import。

**两套都在生产路径，各有独立下游 importer，均非死代码。**

### 2.2 同名 fetcher 与实现漂移

两模块各自定义同名 fetcher：`fetch_reddit` / `fetch_bilibili` / `fetch_youtube` / `fetch_nga` / `fetch_taptap`。实现已实质漂移，例（`fetch_reddit`）：

| 维度 | aggregator_collectors.fetch_reddit | global_collectors.fetch_reddit |
|------|-----------------------------------|--------------------------------|
| subreddit 清单 | `['Morimens', 'MorimensGame']` | `['Morimens', 'MorimensGame', 'gachagaming']` |
| 取数策略 | 浏览器 UA + 评论抓取（`_fetch_reddit_comments`） | RSS fallback（`_parse_reddit_rss`） |
| 辅助基建 | 自带 `_fetch_reddit_rss` / `_fetch_reddit_search` | 共享 `_get` / `_make_item` / `_refresh_cutoff` |

这不是「一份 canonical + 一份可删冗余」的关系，而是**两份服务不同管线、各有不可替代逻辑的并行实现**。

### 2.3 方向判断

任务规定：「若两套都在生产路径且各有不可替代逻辑，则不要动代码，改为产出合并方案」。本案正属此列：

- 删 `aggregator_collectors` 会破坏 `aggregator.py`（日报主管线 + 评论链 + Discord 本地读取）。
- 删 `global_collectors` 会破坏 `collect_global.py` + 两个 backfill 脚本（29 平台扩展 + 历史回溯）。
- 同名 fetcher 的去重需先统一「subreddit 清单 / UA 策略 / RSS fallback / 辅助基建」的语义，这是**行为变更**，超出「外科手术式去重」边界，且任一改动错误都会污染每小时产出的 `output/*.json`。

故**选择「只产方案，不动采集代码」**。

### 2.4 推荐迁移方向（供守密人决策，非本次实施）

目标：单一 canonical 采集器，两条管线共用，dedup 退化为纯兜底。

1. **选 canonical**：以 `global_collectors.py` 为基（覆盖面更广：29 平台 + 被 3 个脚本复用 + 已有 `_get`/`_make_item`/RSS 基建），把 `aggregator_collectors.py` 独有能力并入。
2. **盘点 aggregator_collectors 独有且不可丢的逻辑**（迁移清单）：
   - `fetch_discord_local`（本地 jsonl 读取 + 回复链 `_build_reply_chains`）—— global 侧的 `fetch_discord` 是 API 拉取，语义不同，必须保留本地版。
   - reddit 评论抓取 `_fetch_reddit_comments` / 媒体提取 `_extract_reddit_media`。
   - bilibili WBI 签名 `_get_wbi_mixin_key` / `_sign_wbi_params` / space + search 双路。
   - youtube web search fallback `_fetch_youtube_web_search`。
   - steam 三件套 `fetch_steam_reviews` / `fetch_steam_news` / `fetch_steam_discussions`。
3. **统一同名 fetcher 语义**（逐个对齐，每个一 commit + 一测）：
   - subreddit 清单取并集还是以日报口径为准？需守密人定（影响日报热度榜）。
   - nga / taptap：两套都失败中（见任务 1），合并时一并评估是否同步处置。
4. **改 importer**：`aggregator.py` 改为从 canonical import；保留薄适配层（如 discord_local）。
5. **回归基线**：合并前后 `python3 -m pytest tests/ -q` 必须全绿；并人工核对 `output/*-latest.json` 字段与 `news.json` 产出格式零变更。

### 2.5 风险

- 同名 fetcher 行为合并 = 直接影响每小时产线，错一处即污染 `output/`。
- subreddit / UA / 时间窗口口径差异若处理不当，会改变日报选样，触碰数据层/输出层隔离语义（CLAUDE.md §4）。
- nga/taptap 当前全失败，合并时若顺手「优化」反而引入新故障，应严守外科手术边界。
- 建议拆成 5+ 个独立小 PR（先 reddit，再 bilibili……），每个独立可回滚，禁止一把梭。

---

## 验证

- 基线测试：`python3 -m pytest tests/ -q` → 40 passed（改动前后一致，本次无代码改动）。
- 本次仅新增本调研文档，未触碰 `projects/news/` 任何采集代码、`sources.py`、`output/`、`data/`。

https://claude.ai/code/session_017yicupuexwbWdXV9i8SJah
