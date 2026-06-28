# 新闻采集系统架构

> 最后更新：2026-06-28 by 艾瑞卡会话（同步 2026-06-20「统一采集入口」裁定：collect_global 并入 aggregator 单入口；report-system/ 子目录 2026-04-11 已下线，采集器迁至 `projects/news/scripts/`。上次 2026-04-11 by Code-主控台）
>
> 本文档说明采集系统的分工和使用方式。生产管线与扩展采集现由 `aggregator.py` 单入口统一调度（2026-06-20 起）。

## 系统概览

本仓库包含两套社区数据采集系统：

| 系统 | 入口 | 数据源数 | 运行方式 | 用途 |
|------|------|----------|----------|------|
| **生产管线** | `scripts/aggregator.py` | 10 核心 + TapTap/NGA/微博/小红书 Playwright fallback | GitHub Actions 自动（每小时） | 日报、实时监控 |
| **扩展采集** | `scripts/collect_global.py`（内部调 `scripts/global_collectors.py`；2026-06-20 起由 `aggregator.py` 单入口内部调用，不再独立 workflow 步）| 29 | GitHub Actions 自动（aggregator 内置） | 覆盖全球社区、同人、商店 |

由 `.github/workflows/update-news.yml` 每小时触发：`aggregator.py` 为**唯一采集入口**——先采 AC 平台，内部调 `collect_global.main()` 采全球平台并产出 `news.json` + `news-raw.json`（2026-06-20 起原独立的「Run global collectors」步已并入 aggregator 步以免重复采集），随后 `split_output.py` → `generate_daily.py` → `archive_platforms.py`。本地复现扩展采集仍可手动 `python projects/news/scripts/collect_global.py`，且多数平台需 API Key 或 Playwright runtime。

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
| YouTube | API + RSS + 爬虫 | ⚠️ | 需配置 API Key |
| Twitter | API v2 | ❌ | 需付费 Token |
| TapTap | Playwright 回退 | ⚠️ | API 已废弃 |
| NGA | Playwright 回退 | ⚠️ | 需 NGA_COOKIE 环境变量，否则仅 Playwright fallback |
| 微博 | Playwright | ✅ | 新增 |
| 小红书 | Playwright | ✅ | 新增 |

> Wiki 类数据源（Fandom / Miraheze / Gamerch / GameKee / 灰机 Wiki）已全部废弃，不再采集。

### 运行方式

```bash
# 本地运行
cd projects/news
python scripts/aggregator.py

# 统一入口
python scripts/collect.py --production
```

### GitHub Actions

- **频率**: 每小时（`cron: '0 * * * *'`）
- **Workflow**: `.github/workflows/update-news.yml`
- **执行链**: `aggregator.py`（单入口，内部调 `collect_global.main()`）→ `split_output.py` → `generate_daily.py` → `download_media.py` → `archive_platforms.py`（2026-06-20 起 collect_global 不再为独立 workflow 步）
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

# 统一入口
python scripts/collect.py --extended
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

使用 `scripts/collect.py` 统一调用：

```bash
# 生产管线（推荐日常使用）
python scripts/collect.py --production

# 扩展采集（推荐周报/月报）
python scripts/collect.py --extended

# 全部运行
python scripts/collect.py --all

# 指定数据源
python scripts/collect.py --sources bilibili,reddit,weibo

# 列出所有数据源
python scripts/collect.py --list
```

## 输出文件

```
projects/news/output/
├── news.json              # 主聚合输出
├── all-latest.json        # 全平台合并
├── bilibili-latest.json   # B站
├── steam-latest.json      # Steam
├── discord-latest.json    # Discord
├── youtube-latest.json    # YouTube
├── reddit-latest.json     # Reddit
├── weibo-latest.json      # 微博
├── xiaohongshu-latest.json # 小红书
├── source-health.json     # 数据源健康状态
├── daily-latest.md        # 最新日报
└── extended-latest.json   # 扩展采集结果
```

## 新增功能（2026-04-11）

1. **Playwright 采集器** — 支持 TapTap、NGA、微博、小红书
2. **数据质量追踪** — 自动监控平台健康状态
3. **统一入口** — `collect.py` 整合两套系统
4. **平台降级** — 连续 7 天沉默降级，30 天休眠
