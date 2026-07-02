# 新闻采集系统架构

> 最后更新：2026-07-02 by 艾瑞卡会话（档案漂移全面修复：删除不存在的 `collect.py` / `generate_daily.py` 引用、执行链与输出清单对齐 `update-news.yml` 实况、Playwright 覆盖面对齐实际采集器。上次 2026-06-28 同步「统一采集入口」裁定）
>
> 本文档说明采集系统的分工和使用方式。生产管线与扩展采集现由 `aggregator.py` 单入口统一调度（2026-06-20 起）。

## 系统概览

本仓库包含两套社区数据采集系统：

| 系统 | 入口 | 数据源数 | 运行方式 | 用途 |
|------|------|----------|----------|------|
| **生产管线** | `scripts/aggregator.py` | AC 核心平台 + 微博/TapTap/Arca/Ruliweb/巴哈姆特 Playwright 回退（`playwright_collectors.py`） | GitHub Actions 自动（每小时） | 日报、实时监控 |
| **扩展采集** | `scripts/collect_global.py`（内部调 `scripts/global_collectors.py`；2026-06-20 起由 `aggregator.py` 单入口内部调用，不再独立 workflow 步）| 29 | GitHub Actions 自动（aggregator 内置） | 覆盖全球社区、同人、商店 |

由 `.github/workflows/update-news.yml` 每小时触发：`aggregator.py` 为**唯一采集入口**——先采 AC 平台，内部调 `collect_global.main()` 采全球平台并产出 `news.json` + `news-raw.json`（2026-06-20 起原独立的「Run global collectors」步已并入 aggregator 步以免重复采集），随后 `split_output.py` → `download_media.py` → `archive_platforms.py` → `repair_gaps.py` → `silent_sources_audit.py --write`。本地复现扩展采集仍可手动 `python projects/news/scripts/collect_global.py`，且多数平台需 API Key 或 Playwright runtime。

## 生产管线（aggregator.py）

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
# 本地运行（aggregator 即唯一入口，末尾自动调 collect_global）
cd projects/news
python scripts/aggregator.py
```

### GitHub Actions

- **频率**: 每小时（`cron: '0 * * * *'`）
- **Workflow**: `.github/workflows/update-news.yml`
- **执行链**: `aggregator.py`（单入口，内部调 `collect_global.main()`）→ `split_output.py` → `download_media.py` → `archive_platforms.py` → `repair_gaps.py` → `silent_sources_audit.py --write`（2026-06-20 起 collect_global 不再为独立 workflow 步；日报生成已停用、无 generate_daily 环节）
- **输出**: `projects/news/output/news.json` + 各平台独立文件

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

统一入口即 `scripts/aggregator.py`（2026-06-20 守密人裁定；此前设想的独立
`collect.py` 包装脚本从未落盘，相关引用已于 2026-07-02 清理）：

```bash
# 生产管线 + 扩展采集（单入口一次跑全）
python projects/news/scripts/aggregator.py

# 仅扩展采集（调试用）
python projects/news/scripts/collect_global.py
```

## 输出文件

```
projects/news/output/
├── news.json              # 主聚合输出（输出展示层，过滤选样）
├── news-raw.json          # 全量层（本轮采集未过滤）
├── all-latest.json        # 全平台合并
├── {source}-latest.json   # 按源切分（bilibili / steam / discord / youtube /
│                          #   reddit / weibo / pixiv / appstore / google_play /
│                          #   taptap / taptap_post / taptap_review / official /
│                          #   ruliweb / stopgame / weixin / arca_live / bahamut /
│                          #   note_com / twitter / steam_discussion 等，以 ls 为准）
├── source-health.json     # 数据源健康状态（data_quality.py 产出）
└── feed.xml               # RSS 输出
```

> 日报文件（daily-latest.md）与 extended-latest.json 已随日报定时停用 / 单入口
> 合并而不再产出；报告改在会话内生成（见 `memory/project-status.md`）。

## 新增功能（2026-04-11，历史记录；现状以 2026-07-02 订正为准）

1. **Playwright 采集器** — 当时支持 TapTap、NGA、微博、小红书；**现行覆盖为
   微博 / TapTap / Arca / Ruliweb / 巴哈姆特**（NGA / 小红书采集器已移除）
2. **数据质量追踪** — 自动监控平台健康状态（仍在用，`data_quality.py`）
3. ~~**统一入口** — `collect.py` 整合两套系统~~ 该包装脚本从未落盘；统一入口
   现为 `aggregator.py`（2026-06-20 裁定）
4. **平台降级** — 连续 7 天沉默降级，30 天休眠（仍在用）
