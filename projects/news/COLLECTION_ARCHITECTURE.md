# 新闻采集系统架构

> 最后更新：2026-07-02 by 艾瑞卡会话（档案漂移全面修复：删除不存在的 `collect.py` / `generate_daily.py` 引用、执行链与输出清单对齐 `update-news.yml` 实况、Playwright 覆盖面对齐实际采集器。上次 2026-06-28 同步「统一采集入口」裁定）
>
> 本文档说明采集系统的分工和使用方式。**2026-08-22 守密人裁定「采集 → 直接入湖」**：新闻流编排
> （`aggregator.py` 全家）与输出层拆分（`split_output.py`）整体退役，采集唯一入口为 `collect_global.py`，
> 采到的条目经校验直接交归档步落全量档案层。原 2026-06-20「aggregator 单入口」表述作废。

## 系统概览

本仓库包含两套社区数据采集系统：

| 系统 | 入口 | 数据源数 | 运行方式 | 用途 |
|------|------|----------|----------|------|
| **采集入口** | `scripts/collect_global.py`（内部调 `scripts/global_collectors.py`，Playwright 回退见 `playwright_collectors.py`） | 全部平台（含 2026-08-22 自 AC 栈迁入的 steam 三源） | GitHub Actions 每 3 小时 | 全量档案层入湖 |
| **独立采集器** | `scripts/discord_archiver.py` · `scripts/collect_video_comments.py` | discord 三区服 / youtube 评论 | 各自 workflow（错峰） | 直连各平台 API，直落数据湖，不经采集入口 |

由 `.github/workflows/update-news.yml` 每 3 小时触发：`collect_global.py` 为**唯一采集入口**——并行跑全部平台采集器、校验清洗、产运行期 `news.json` + `news-raw.json`（工作根 `archive_layout.news_run_root()`，不进 git），随后 `download_media.py` → `archive_platforms.py` → `repair_gaps.py` → `silent_sources_audit.py --write`。多数平台需 API Key 或 Playwright runtime。

## 采集入口（collect_global.py）

### 数据源

| 平台 | 采集方式 | 状态 | 备注 |
|------|----------|------|------|
| Reddit | JSON API + RSS 回退 | ✅ | r/Morimens, r/MorimensGame（浏览器 UA + old.reddit.com）|
| Bilibili | Space API + Search API | ✅ | 创作者追踪 + 关键词搜索（space 412 时静默回退 search）|
| Steam Reviews | curl + API | ✅ | 近 48h 评论 |
| Steam News | 官方 API | ✅ | 官方公告，默认 30 天窗口（OFFICIAL_HOURS_LOOKBACK）|
| Steam Discussions | HTML 抓取 | ⚠️ | 需要登录态 |
| Discord | 本地 JSONL | ✅ | 依赖 archiver 先运行 |
| YouTube | GC 官方 API | ✅ | ARCH-01 收敛：权威实现在 GC 栈（googleapis），AC 不再网页爬取 |
| Twitter | API v2（GC 侧） | ❌ | 需付费 Token |
| TapTap | Playwright 回退 | ⚠️ | API 已废弃 |
| 微博 | Playwright | ✅ | |
| Arca / Ruliweb / 巴哈姆特 | Playwright | ✅ | `playwright_collectors.py`（NGA / 小红书采集器已移除，无对应实现） |

> Wiki 类数据源（Fandom / Miraheze / Gamerch / GameKee / 灰机 Wiki）已全部废弃，不再采集。

### 运行方式

```bash
# 本地运行（唯一入口）
cd projects/news
python scripts/collect_global.py
```

### GitHub Actions

- **频率**: 每小时（`cron: '0 * * * *'`）
- **Workflow**: `.github/workflows/update-news.yml`
- **执行链**: `collect_global.py`（唯一入口）→ `download_media.py` → `archive_platforms.py` → `repair_gaps.py` → `silent_sources_audit.py --write`（2026-08-22 起 aggregator 全家与 split_output 退役；日报生成早已停用、无 generate_daily 环节）
- **输出**: 运行期工作根（`archive_layout.news_run_root()`，默认 `projects/news/run/`，不进 git）下的 `news.json` + 各平台独立文件；**落地面是全量档案层** `Record/Community/`

## 扩展采集（collect_global.py / global_collectors.py）

### 数据源

覆盖 29 个平台，包括：

- **中文**: 微博、小红书、抖音、百度贴吧、知乎、巴哈姆特
- **同人**: Pixiv、Lofter
- **周边**: 闲鱼、淘宝
- **全球**: Facebook、TikTok、Telegram、Twitch、Instagram
- **韩国**: Naver Cafe、DCInside、Arca.live
- **日本**: 5ch
- **商店**: App Store、Google Play、QooApp、Epic

### 运行方式

```bash
# 本地运行（report-system/ 子目录 2026-04-11 已下线，采集器迁至 projects/news/scripts/）
python projects/news/scripts/collect_global.py
```

### 注意事项

- 部分平台需要浏览器环境（Playwright）；GH Actions 已在 workflow 中 `playwright install chromium`
- 部分平台需要认证（API Key / Cookie），通过 GitHub Secrets 注入
- 本地复现需手动执行 `python projects/news/scripts/collect_global.py`，且多数 API-Key 平台会返 0

## 数据质量增强

新增 `scripts/data_quality.py` 模块，提供：

1. **Engagement 归一化** — 统一不同平台的互动数口径
2. **沉默平台追踪** — 自动降级长期无数据的平台
3. **健康报告生成** — 监控各数据源状态

```bash
# 查看健康报告
python scripts/data_quality.py --report
```

## 统一入口

统一入口即 `scripts/collect_global.py`（2026-08-22 守密人裁定；2026-06-20 的 aggregator 单入口已退役。此前设想的独立
`collect.py` 包装脚本从未落盘，相关引用已于 2026-07-02 清理）：

```bash
# 生产管线 + 扩展采集（单入口一次跑全）
python projects/news/scripts/collect_global.py

# 仅扩展采集（调试用）
python projects/news/scripts/collect_global.py
```

## 输出文件

```
<运行期工作根>/   # archive_layout.news_run_root()，默认 projects/news/run/，不进 git
├── news.json              # 主聚合输出（输出展示层，过滤选样）
├── news-raw.json          # 全量层（本轮采集未过滤）
├── all-latest.json        # 全平台合并
├── {source}-latest.json   # 按源切分（bilibili / steam / discord / youtube /
│                          #   reddit / weibo / pixiv / appstore / google_play /
│                          #   taptap / taptap_post / taptap_review / official /
│                          #   ruliweb / stopgame / weixin / arca_live / bahamut /
│                          #   note_com / twitter / steam_discussion 等，以 ls 为准）
└── source-health.json     # 数据源健康状态（data_quality.py 产出）
```

> 日报文件（daily-latest.md）与 extended-latest.json 已随日报定时停用 / 单入口
> 合并而不再产出；报告改在会话内生成（见 `memory/project-status.md`）。
>
> `feed.xml`（RSS）与 `news.jsonl` 同属停产化石：管线里早已无生成方，仓内两份快照
> 停在 2026-03-29，却仍自称「24h 热点」。守密人 2026-08-21 裁定连同 OKF `news-output-feed`
> 指针一并删除。`index.html` 前端展示页同日下线（见 CONTEXT.md）。

## 新增功能（2026-04-11，历史记录；现状以 2026-07-02 订正为准）

1. **Playwright 采集器** — 当时支持 TapTap、NGA、微博、小红书；**现行覆盖为
   微博 / TapTap / Arca / Ruliweb / 巴哈姆特**（NGA / 小红书采集器已移除）
2. **数据质量追踪** — 自动监控平台健康状态（仍在用，`data_quality.py`）
3. ~~**统一入口** — `collect.py` 整合两套系统~~ 该包装脚本从未落盘；统一入口
   现为 `collect_global.py`（2026-08-22 裁定；2026-06-20 的 aggregator 已退役）
4. **平台降级** — 连续 7 天沉默降级，30 天休眠（仍在用）
