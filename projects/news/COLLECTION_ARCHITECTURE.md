# 新闻采集系统架构

> 最后更新：2026-04-11 by Code-主控台
>
> 本文档说明两套采集系统的分工和使用方式。

## 系统概览

本仓库包含两套社区数据采集系统：

| 系统 | 文件 | 数据源数 | 运行方式 | 用途 |
|------|------|----------|----------|------|
| **生产管线** | `scripts/aggregator.py` | 11+ | GitHub Actions 自动 | 日报、实时监控 |
| **扩展采集** | `report-system/scripts/collector.py` | 29 | 手动/按需 | 周报、月报、深度分析 |

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

- **频率**: 每日 2 次（06:00/16:00 UTC）
- **Workflow**: `.github/workflows/update-news.yml`
- **输出**: `projects/news/output/news.json` + 各平台独立文件

## 扩展采集（collector.py）

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
# 本地运行
cd projects/news/report-system
python scripts/collector.py

# 统一入口
python scripts/collect.py --extended
```

### 注意事项

- 部分平台需要浏览器环境（Playwright）
- 部分平台需要认证（API Key）
- 建议本地运行或定时任务

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
