# 新闻采集系统架构

> 最后更新：2026-04-11 by Code-主控台
>
> 本文档说明采集管线的分工和使用方式。

## 系统概览

本仓库的社区数据采集由 `projects/news/scripts/` 下的几个模块协作完成：

| 模块 | 角色 | 运行方式 |
|------|------|----------|
| `aggregator.py` | 主采集管线（13+ 源，生产级） | `update-news.yml` 每小时自动 |
| `global_collectors.py` | 全球 29 平台采集器集合 | 由 `collect_global.py` / `backfill_platforms.py` 调用 |
| `taptap_collector.py` | TapTap Playwright 采集器 | `global_collectors.py` 内部依赖 |
| `collect_global.py` | 全球采集桥接 + 合并 | `update-news.yml` 每小时自动 |
| `backfill_platforms.py` | 多平台历史回溯 | `backfill-news.yml` 每小时自动 |
| `playwright_collectors.py` | 微博/小红书/NGA/TapTap 的 Playwright 回退 | 被 `aggregator.py` 调用 |
| `data_quality.py` | 健康追踪与沉默平台降级 | 被 `aggregator.py` 调用 |

## 主采集管线（aggregator.py）

### 数据源

| 平台 | 采集方式 | 状态 | 备注 |
|------|----------|------|------|
| Reddit | JSON API + RSS 回退 | OK | r/Morimens, r/MorimensGame |
| Bilibili | Space API + Search API | OK | 创作者追踪 + 关键词搜索 |
| Steam Reviews | curl + API | OK | 近 48h 评论 |
| Steam News | 官方 API | warn | 偶发超时 |
| Steam Discussions | HTML 抓取 | warn | 需要登录态 |
| Discord | 本地 JSONL | OK | 依赖 archiver 先运行 |
| Fandom Wiki | MediaWiki API | OK | 最近更改 |
| YouTube | API + RSS + 爬虫 | warn | 需配置 API Key |
| Twitter | API v2 | off | 需付费 Token |
| TapTap | Playwright 回退 | warn | API 已废弃 |
| NGA | Playwright 回退 | warn | Cloudflare 保护 |
| 微博 | Playwright | OK | 新增 |
| 小红书 | Playwright | OK | 新增 |

### 运行方式

```bash
cd projects/news
python scripts/aggregator.py
```

### GitHub Actions

- **主管线**：`update-news.yml` — 每小时运行 `aggregator.py` + `collect_global.py` + `split_output.py` + `generate_daily.py` + `download_media.py` + `archive_platforms.py`
- **历史回溯**：`backfill-news.yml` — 每小时一个平台跑 `backfill_platforms.py`
- **输出**：`projects/news/output/news.json` + 各平台 `*-latest.json`

## 全球采集（global_collectors.py）

覆盖 29 个零成本平台：

- **中文**: 微博、小红书、抖音、百度贴吧、知乎、巴哈姆特
- **同人**: Pixiv、Lofter
- **周边**: 闲鱼、淘宝
- **全球**: Reddit、YouTube、Discord（API）、Facebook、TikTok、Telegram、Twitch、Instagram
- **韩国**: Naver Cafe、DCInside、Arca.live、Ruliweb
- **日本**: 5ch、Note.com
- **俄语**: VK Play
- **商店**: App Store、Google Play、QooApp、Epic、Gamerch、Miraheze Wiki、GameKee、Huiji Wiki

### 注意事项

- 部分平台需要浏览器环境（Playwright）
- 部分平台需要认证（API Key，通过环境变量传入）
- 独立运行会写出 `projects/news/data/collected_raw.json`（已 gitignore）

## 数据质量增强

`scripts/data_quality.py` 模块提供：

1. **Engagement 归一化** — 统一不同平台的互动数口径
2. **沉默平台追踪** — 自动降级长期无数据的平台
3. **健康报告生成** — 监控各数据源状态

```bash
python scripts/data_quality.py --report
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
└── daily-latest.md        # 最新日报

projects/news/data/archive/daily-reports/
└── daily-report-YYYY-MM-DD.md   # 历史日报归档
```

## 新增功能（2026-04-11）

1. **Playwright 采集器** — 支持 TapTap、NGA、微博、小红书
2. **数据质量追踪** — 自动监控平台健康状态
3. **平台降级** — 连续 7 天沉默降级，30 天休眠
4. **架构清理** — 原 `report-system/` 子目录已下线，活脚本 (`collector.py` / `taptap_collector.py`) 迁入 `scripts/`，死代码 (analyst/reporter/notifier/scheduler) 已删除
