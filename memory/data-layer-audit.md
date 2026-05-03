# 银芯数据层审计报告

最后更新：2026-04-26 by Code-news（艾瑞卡）

> **2026-05-03 增补**：守密人裁定砍掉日报管线（守密人从未消费过 daily-latest.md / daily-reports/）。
> - `data/archive/daily-reports/` 504 文件已删
> - `output/daily-latest.md` 已删
> - `generate_daily.py` + `backfill_daily_reports.py` 已删
> - `update-news.yml` / `dream.yml` / `backfill_gap.py` 相关步骤已移除
> - 本报告 §2.3 中 `archive/daily-reports/` 一行 + §四 BIAV-SC 补丁中对应行**已失效**
> - 长窗口社区分析改用 `data/platforms/{source}/{date}.json` 全量层

> 任务依据：`memory/dispatch-brief-code-news-data-layer-audit.md`（lesson #30 落地 W1）
> 审计范围：`projects/news/data/` 所有子目录 + 状态文件
> 边界：不动 archiver 代码、不改 BIAV-SC.md / COLLECTION_ARCHITECTURE.md（提议补丁）、不实现 helper

---

## 一、审计概览

| 指标 | 数值 |
|------|------|
| 平台档案目录数（`data/platforms/`） | **16** |
| Discord 子结构 | 4（channels / activity_daily / channel_index / guild_meta + state） |
| `archive_platforms.py` PLATFORMS 注册项 | 23（移除 dcinside 后） |
| 已注册但目录尚未产出 | **10**（新源未跑出数据） |
| 目录存在但 PLATFORMS 未注册（遗留） | **4**（dcinside / gamerch / miraheze_wiki / steam_review） |
| 文档与实际不一致项 | **8**（详见 §三） |
| Discord 全量大小 | **264 MB**（最大单一资产） |
| platforms/ 全量大小 | **5.7 MB**（16 目录合计） |

**核心结论**：
1. 全量档案层（`data/`）是黑池公开信息入口的真实底座，覆盖 16 个平台 + Discord 全量 + 5+ 年历史回溯（最长 weixin 2016 起）
2. BIAV-SC.md L148 仅一行模糊提及 `platforms/{source}/`，未列具体 16 个源 + 各自历史深度
3. `COLLECTION_ARCHITECTURE.md`（4-11 创建）严重滞后——仍提 29 平台、Twitter/Wiki 类、不存在的 `report-system/scripts/collector.py`
4. 实际有 4 个目录是"遗留 archive"（不在当前 archiver 写入清单），需要决策保留 or 清理

---

## 二、逐源详表

### 2.1 平台全量档案层（`data/platforms/{source}/`）

> 文件格式：`{date}.json`，结构 `{date, archived_at, source, item_count, items: [...]}`
> 由 `archive_platforms.py` 从 `output/{source}-latest.json` 按日快照写入

| 源 | files | 总字节 | 历史跨度 | 上游 archiver | 注册状态 | 已知缺陷 |
|-----|------|--------|---------|---------------|----------|----------|
| **steam_review** | 619 | 3.2 MB | 2024-08-02 → 2026-04-26 | `aggregator.fetch_steam_reviews` + `backfill_steam_reviews` | ❌ 未在 `archive_platforms.PLATFORMS` | 由 `backfill_platforms.py` 直接写，绕过统一 archiver |
| **appstore** | 166 | 154 KB | 2023-11-30 → 2026-04-21 | `collect_global.fetch_appstore_reviews` → `archive_platforms` | ✅ 已注册 | gap_report 显示巨大缺口（约 880 天缺失），需 backfill |
| **pixiv** | 129 | 79 KB | 2023-12-07 → 2026-04-27 | `collect_global.fetch_pixiv` → `archive_platforms` | ✅ 已注册 | 文件小但跨度大，每日产出稀疏 |
| **weixin** | 93 | 882 KB | **2016-02-03** → 2026-04-25 | `collect_global.fetch_weixin` → `archive_platforms` | ✅ 已注册 | 2016 起的种子数据来源未知（搜狗 fallback 历史检索？需复核）|
| **bilibili** | 43 | 430 KB | 2026-03-16 → 2026-04-27 | `aggregator.fetch_bilibili` → `archive_platforms` | ✅ 已注册 | — |
| **steam** | 25 | 202 KB | 2026-04-03 → 2026-04-27 | `aggregator.fetch_steam_news` → `archive_platforms` | ✅ 已注册 | 30 天宽窗口（OFFICIAL_HOURS_LOOKBACK） |
| **stopgame** | 10 | 6 KB | 2026-04-05 → 2026-04-27 | `collect_global.fetch_stopgame` → `archive_platforms` | ✅ 已注册 | 评测页本身稀疏，单条/日 |
| **gamerch** | 8 | 83 KB | 2026-04-05 → 2026-04-12 | **wiki 类（已废弃）** | ❌ 未在 PLATFORMS | 4-12 之后停止写入；遗留数据，建议归档历史 |
| **google_play** | 8 | 5 KB | 2026-04-05 → 2026-04-12 | `collect_global.fetch_google_play` → `archive_platforms` | ✅ 已注册 | **本次会话扩展 4→22 locales 后产出预期 900+/cron**，旧档案稀疏 |
| **reddit** | 8 | 160 KB | 2026-04-07 → 2026-04-27 | `aggregator.fetch_reddit` → `archive_platforms` | ✅ 已注册 | — |
| **youtube** | 8 | 258 KB | 2026-04-07 → 2026-04-27 | `aggregator.fetch_youtube` → `archive_platforms` | ✅ 已注册 | 缺 API key 时降级 RSS |
| **dcinside** | 3 | 106 KB | 2026-04-12 → 2026-04-27 | **已删除（2026-04-26）** | ❌ 已下架 | 历史档案保留作回溯参考 |
| **telegram** | 3 | 2.5 KB | 2026-04-07 → 2026-04-09 | `collect_global.fetch_telegram` → `archive_platforms` | ✅ 已注册 | 缺 `TELEGRAM_CHANNELS` secret，4-09 后无产出 |
| **weibo** | 3 | 155 KB | 2026-04-12 → 2026-04-27 | `aggregator/collect_global.fetch_weibo` → `archive_platforms` | ✅ 已注册 | 反爬 JSON parse error，需切 cloudscraper（待修） |
| **official** | 2 | 3.7 KB | 2026-04-03 → 2026-04-04 | `aggregator.fetch_steam_news` (source='official') | ✅ 已注册 | 2026-04-04 后无产出，需排查 fetch 逻辑 |
| **miraheze_wiki** | 1 | 2 KB | 2026-04-05 单点 | **wiki 类（已废弃）** | ❌ 未在 PLATFORMS | 单文件，建议归档历史 |

**已注册但 0 目录**（PLATFORMS 列入但 `data/platforms/` 无数据）：

| 源 | 原因 |
|-----|------|
| `steam_discussion` | 需登录态，长期 0 产出 |
| `nga` | JSON parse 错误（反爬），需切 cloudscraper（待修） |
| `taptap` | 需 chromium playwright，本地无 |
| `zhihu` | 缺 `ZHIHU_COOKIE` secret |
| `bahamut` | 0 results（selector 可能失效，待诊断） |
| `naver_cafe` | API 403（需 cookie） |
| `arca_live` | 0 items（forgettingeve 频道空，selector 待诊断） |
| `fivech` | 5ch 服务器 IP 限制（403/503） |
| `note_com` | API 403（需 auth） |
| `ruliweb` | **本次会话已修复**（0 → 51/cron），待下次 cron 落档 |

### 2.2 Discord 全量档案层（`data/discord/`）

| 路径 | 内容 | 规模 | 文件组织 |
|------|------|------|----------|
| `channels/{id_suffix}/{date}.jsonl` | Discord 全量历史归档（每日 JSONL）| 264 MB / **1946 jsonl 文件** / 468 频道目录 | 按 channel ID 后 8 位哈希桶 |
| `channel_index.json` | 频道 ID → {name, type, parent_id, dir} 映射 | **146 频道** | 由 `discord_archiver` 维护 |
| `guild_meta.json` | guild_id + updated_at + channels[] 元数据 | **163 频道** | 由 `discord_archiver` 维护 |
| `state.json` | `channels` 增量游标 + `historical_month` 回溯指针 + `last_run` | 3 keys | 由 `discord_archiver` 维护 |
| `activity_daily/{date}.json` | 每日纯统计摘要（messages/channel_activity/hourly_activity/message_types/top_reacted）| **913 文件** / 2023-07-21 → 2026-04-26 | 永久保留 |

**Discord 关键数据点**：
- `channels/` 实际有 468 子目录，但 `channel_index.json` 仅记录 146 频道，`guild_meta.json` 记录 163 —— **不一致**：468 vs 146/163，可能是历史遗留（已离线频道或重命名）
- `activity_daily/` 覆盖近 **3 年**（2023-07 起），是 Discord 长窗口分析的核心
- 上游 archiver: `discord_archiver.py`（独立于 `archive_platforms.py`）

### 2.3 其他子目录

| 路径 | 内容 | 规模 | 用途 |
|------|------|------|------|
| `archive/` | hourly snapshot（仅 3 个 2026-03-29 文件，早期格式遗留）+ `daily-reports/`（**498 个 markdown 日报**，2020-03-21 → 2026-04-27） | 320 KB / 501 文件 | daily-reports 由 `generate_daily.py` 产出，hourly snapshot 已废弃 |
| `backfill/state.json` | backfill 进度状态（按 platform 分键） | 683 字节 | 由 `backfill_platforms.py` 维护 |
| `media/manifest.json` | 媒体下载清单（downloaded/failed/archived） | 181 KB | 由 `download_media.py` 维护 |
| `debug_taptap_*.html` | 调试快照（taptap review/topic 页面）| ~9 KB 各 | **临时调试遗留，建议清理** |

### 2.4 状态文件（4 个 JSON）

| 文件 | 内容 | 维护者 |
|------|------|--------|
| `collection_state.json` | `last_collected_at` + `last_item_count` + `history`（最近 20 次运行）| `collection_state.py`（aggregator 调用） |
| `fetch_state.json` | 各源最近一次抓取的 latest_time + URL 去重列表（仅 bilibili 启用） | `aggregator.fetch_bilibili` |
| `state.json` | taptap 单源的 last_post_id + last_review_id + last_run | `taptap_collector.py` |
| `gap_report.json` | 各 platform 缺失日期清单（**5173 总缺口**，appstore 占大头）| `repair_gaps.py` |

---

## 三、交叉对照发现

### 3.1 BIAV-SC.md「全量档案层」条目缺失

`BIAV-SC.md` L140-149 当前仅 6 行，主要问题：

| 当前条目 | 问题 | 建议 |
|----------|------|------|
| L144 Discord channels jsonl | 标注"已回溯至 2026-02"，**实际 activity_daily 覆盖至 2023-07-21** | 更新表述：channels jsonl 至 2026-02，activity_daily 至 2023-07 |
| L148 platforms 一行 | 仅"10+ 平台"模糊提及，没列 16 个具体源、各自历史深度、上游 archiver | 替换为完整表（见 §四 索引补丁）|
| 缺 `archive/daily-reports/` | 6 年日报历史（2020-03 起）未在表中 | 补一行 |
| 缺 `media/manifest.json` | 媒体归档索引未提 | 补一行 |
| 缺状态文件层 | `collection_state.json` 等 4 个状态文件未提 | 补一节状态文件 |

### 3.2 COLLECTION_ARCHITECTURE.md 滞后（4-11 创建，至今未更新）

| 当前文档 | 实际状态 | 偏差程度 |
|----------|---------|---------|
| L11-13 提"29 个数据源" | 当前注册 22 项（本次会话清理 16 平台 + dcinside） | 严重 |
| L31 Twitter API v2 ❌ | Twitter 已彻底删除 | 严重 |
| L32-33 TapTap/NGA Playwright fallback | 这两个仍是 playwright fallback，**但 NGA cookie 改造已落地** | 中度 |
| L37 wiki 类已废弃 | 但 `data/platforms/gamerch/` 和 `miraheze_wiki/` **数据残留**未清理 | 中度 |
| L57-69 扩展采集"29 个平台" + DCInside/QooApp/Epic 等 | 全部已删；实际现存 22 源 | 严重 |
| L75 `report-system/scripts/collector.py` | **此路径不存在**，实际入口是 `projects/news/scripts/collect_global.py` | 严重 |
| L101-119 `collect.py` 统一入口 | 此文件存在但未维护 | 待复核 |
| L122-138 输出文件清单 | 列了已删的 `xiaohongshu-latest.json` + `extended-latest.json` 等 | 中度 |
| L140 "新增功能（2026-04-11）" | 后续两周大量改动未补 | 严重 |

**艾瑞卡建议主控台**：`COLLECTION_ARCHITECTURE.md` 滞后过深，建议作为独立任务全文重写（不在本审计范围）。

### 3.3 实际目录 vs 注册名单不一致（4 项）

| 目录 | archive_platforms.PLATFORMS 状态 | 处置建议 |
|------|----------------------------------|---------|
| `dcinside/` | 已下架（本会话 commit `6b4dfee`） | 历史档案保留作回溯，注释化 |
| `gamerch/` | 未注册（wiki 已废弃） | 数据归档到 `archive/legacy/` 子目录 |
| `miraheze_wiki/` | 未注册（wiki 已废弃） | 同上 |
| `steam_review/` | **未注册但持续产出**（aggregator + backfill 写入）| 应补入 PLATFORMS 或确认刻意排除 |

---

## 四、建议主控台采纳的 BIAV-SC.md 索引补丁

> 主控台直接 copy 到 BIAV-SC.md L140-149 替换原段。

### 4.1 「全量档案层」表完整版

```markdown
#### 全量档案层（真实数据，按频道/平台/日期组织）

##### Discord 全量

| 路径 | 内容 | 规模 / 跨度 |
|------|------|------|
| `projects/news/data/discord/channels/{id_suffix}/{date}.jsonl` | 全量消息归档（按频道哈希桶组织） | 264 MB / 1946 jsonl / 468 频道目录，已回溯至 2026-02 |
| `projects/news/data/discord/activity_daily/{date}.json` | 每日纯统计摘要（永久保留） | 913 文件，**2023-07-21 → 当日** |
| `projects/news/data/discord/channel_index.json` | 频道索引（146 个活跃频道）| 由 `discord_archiver.py` 维护 |
| `projects/news/data/discord/guild_meta.json` | guild + 163 频道元数据 | 由 `discord_archiver.py` 维护 |
| `projects/news/data/discord/state.json` | 增量游标 + 历史回溯指针 + last_run | 由 `discord_archiver.py` 维护 |

##### 平台全量（16 目录，由 `archive_platforms.py` 写入除非另注）

| 平台 | 跨度 | 规模 | 上游 archiver |
|------|------|------|---------------|
| `data/platforms/steam_review/` | 2024-08-02 → 当日 | **619 文件 / 3.2 MB** | `aggregator.fetch_steam_reviews` + `backfill_steam_reviews`（绕过 archive_platforms） |
| `data/platforms/appstore/` | 2023-11-30 → 当日 | 166 文件 / 154 KB | `collect_global.fetch_appstore_reviews` |
| `data/platforms/pixiv/` | 2023-12-07 → 当日 | 129 文件 / 79 KB | `collect_global.fetch_pixiv` |
| `data/platforms/weixin/` | 2016-02-03 → 当日 | 93 文件 / 882 KB | `collect_global.fetch_weixin` |
| `data/platforms/bilibili/` | 2026-03-16 → 当日 | 43 文件 / 430 KB | `aggregator.fetch_bilibili` |
| `data/platforms/steam/` | 2026-04-03 → 当日 | 25 文件 / 202 KB | `aggregator.fetch_steam_news` |
| `data/platforms/stopgame/` | 2026-04-05 → 当日 | 10 文件 / 6 KB | `collect_global.fetch_stopgame` |
| `data/platforms/google_play/` | 2026-04-05 → 当日 | 8 文件 / 5 KB | `collect_global.fetch_google_play` |
| `data/platforms/reddit/` | 2026-04-07 → 当日 | 8 文件 / 160 KB | `aggregator.fetch_reddit` |
| `data/platforms/youtube/` | 2026-04-07 → 当日 | 8 文件 / 258 KB | `aggregator.fetch_youtube` |
| `data/platforms/telegram/` | 2026-04-07 → 04-09 | 3 文件 / 2.5 KB | `collect_global.fetch_telegram`（缺 secret 后停） |
| `data/platforms/weibo/` | 2026-04-12 → 当日 | 3 文件 / 155 KB | `aggregator/collect_global.fetch_weibo` |
| `data/platforms/official/` | 2026-04-03 → 04-04 | 2 文件 / 3.7 KB | `aggregator.fetch_steam_news` |
| `data/platforms/dcinside/` | 2026-04-12 → 04-27 | 3 文件 / 106 KB（已下架，历史保留） | — |
| `data/platforms/gamerch/` | 2026-04-05 → 04-12 | 8 文件 / 83 KB（wiki 已废弃，遗留） | — |
| `data/platforms/miraheze_wiki/` | 2026-04-05 单点 | 1 文件 / 2 KB（wiki 已废弃，遗留） | — |

##### 衍生档案

| 路径 | 内容 |
|------|------|
| `projects/news/data/archive/daily-reports/` | 498 篇日报 markdown，**2020-03-21 → 当日**（6+ 年覆盖，前期占位）|
| `projects/news/data/media/manifest.json` | 媒体下载清单（downloaded/failed/archived） |
| `projects/news/data/backfill/state.json` | 回溯进度（按 platform 分键） |
| `projects/news/data/{collection_state,fetch_state,state,gap_report}.json` | 4 个状态文件（运行游标 / bilibili 增量 / taptap 增量 / 缺口诊断） |

> 完整 archiver 映射 + 已知缺陷见 `memory/data-layer-audit.md` §二
```

### 4.2 「输出展示层」勘误清单

L162 当前正确，无需改。建议补一句：

> ⚠ **抽样率提醒**：每个 `*-latest.json` 在 `output/` 是过滤选样（24h 窗口 + 热度阈值），数量级远小于 archive 全量。例：weixin output 当前 ~20 条 vs archive 882 KB / 93 文件历史。

---

## 五、给 Code-memory 的 helper 优先级建议（不实现，仅清单）

基于审计中发现的高频/复杂查询场景：

| 优先级 | helper 名 | 描述 | 用途场景 |
|--------|----------|------|---------|
| P0 | `archive_query(source, since, until)` | 跨日期合并某 source 的 archive 文件，返回扁平 items | "近 30 天 weixin 全量"、"appstore 2024 全年评论" |
| P0 | `discord_archive_query(channel_id, since, until)` | 按 channel_id 后缀定位 hash 桶，跨日期合并 jsonl | 频道级长窗口分析 |
| P1 | `cross_platform_search(keyword, sources, since, until)` | 在多个 archive 目录中按关键词扫描 | "本月所有平台关于 V2.5.0 的提及" |
| P1 | `gap_summary(source)` | 调用 `gap_report.json` + 实际目录差集，输出补全建议 | 数据完整性审计 |
| P2 | `archive_to_pandas(source, since, until)` | 同 P0 但返回 DataFrame | 数据科学场景 |
| P2 | `discord_activity_trend(channel_ids, window_days)` | 基于 `activity_daily/*.json` 拉趋势 | 社区健康趋势图 |

---

## 六、副产物（Code-news 后续修复队列）

落档建议：本审计未直接落 `memory/news-archiver-issues-*.md`，但发现以下问题归 Code-news 后续：

1. **`steam_review` 未走统一 archiver**（aggregator + backfill 直接写入），架构不一致
2. **Discord `channels/` 468 目录 vs `channel_index.json` 146 频道不一致**，可能是离线/重命名频道，需 archiver 增加 reconcile
3. **`debug_taptap_*.html` 临时调试遗留**（约 9 KB × 2），建议清理
4. **`gap_report.json` 总缺口 5173**（appstore 占大头从 2023-12 起每日缺），需大规模 backfill 或接受
5. **`weixin/2016-02-03.json` 来源未知**（10 年历史种子？搜狗历史检索？需复核数据真实性）

---

## 七、自验收（对照 §五 验收标准）

| # | 标准 | 状态 |
|---|------|------|
| 1 | `memory/data-layer-audit.md` 落档 | ✅ 本文件 |
| 2 | `data/platforms/` 下每个目录都有完整字段表 | ✅ §2.1 16 行 + 10 行未产出注册项 |
| 3 | Discord 部分覆盖 `data/discord/` 全部子结构 + 复核 BIAV-SC.md 准确性 | ✅ §2.2 + §3.1 |
| 4 | §四索引补丁可直接 copy 入 BIAV-SC.md | ✅ §4.1 markdown 已格式化 |
| 5 | 不触碰 §四禁区 | ✅ 仅写 `memory/data-layer-audit.md` 一文件 |
| 6 | 不阻塞 C 任务 | ✅ 本审计与 C 任务并行无依赖 |
