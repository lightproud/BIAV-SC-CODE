# News 聚合器 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。
> 最后更新：2026-04-11 by Code-news

## 当前状态：收缩夯实阶段

## 本周任务（2026-04-01 ~ 04-07）

> 来源：战略中心 Phase 0 行动方案。优先级从高到低。

1. **桥接 Discord 归档数据到聚合器**：让 `aggregator.py` 读取 `projects/news/data/discord/` 当日 JSONL 数据，提取摘要进入 `news.json`。这样日报能覆盖 Discord 平台
2. **实现 Discord 归档月度清理**：按 `memory/decisions.md` 2026-03-29 决策，每月 1 日将上月数据打包推 GitHub Releases，从 git 删除。当前归档已 299MB，必须尽快
3. **验证日报质量**：Steam 数据标准化 bug 已修复（split_output.py），下次 workflow 运行后确认日报正确显示 Steam + Bilibili + Discord 三个数据源

### 注意事项
- update-news.yml 已从每小时降到每日 2 次（06:00/16:00 UTC）
- discord-archive.yml 已从每小时降到每日 1 次（18:00 UTC）

## 已完成
- [x] aggregator.py 基础架构（Reddit/Bilibili/Twitter/NGA/TapTap/Steam）
- [x] index.html 前端页面（深色主题，平台筛选）
- [x] GitHub Actions 自动抓取
- [x] B站 + Steam 数据源接通
- [x] Discord 全量归档系统（537 频道）
- [x] split_output.py Steam 数据标准化修复

## 多平台按日归档
- **已完成**：`archive_platforms.py` — 将 *-latest.json 按日期存入 `data/platforms/{platform}/YYYY-MM-DD.json`
- 覆盖平台：Steam / Bilibili / Official / Reddit / Twitter / YouTube / NGA / TapTap
- Discord 已有独立归档器（`discord_archiver.py`），不重复
- 已集成到 `update-news.yml` workflow，每次聚合后自动归档
- 支持去重合并、指定日期归档、统计报表
- 运行方式：`python scripts/archive_platforms.py [--date YYYY-MM-DD] [--stats]`

## 后续待做（非本周）
- Reddit 子版块名需确认（r/Morimens 是否存在）
- Twitter/NGA/TapTap 需配置密钥
- YouTube 需 API Key（代码已就绪）

## 文件说明
- `index.html` — 前端展示页面（纯 HTML/CSS/JS，深色主题）
- `scripts/aggregator.py` — 主采集管线（每小时自动运行）
- `scripts/global_collectors.py` — 全球 29 个平台零成本采集器集合（被 `collect_global.py` 和 `backfill_platforms.py` 引用）
- `scripts/taptap_collector.py` — TapTap Playwright 采集器（`global_collectors.py` 的依赖）
- `scripts/collect_global.py` — 全球采集桥接脚本，合并 aggregator 输出
- `scripts/backfill_platforms.py` — 多平台历史回溯采集
- `scripts/generate_daily.py` — 日报生成（写入 `data/archive/daily-reports/` 和 `output/daily-latest.md`）
- `scripts/split_output.py` / `archive_platforms.py` / `download_media.py` — 后处理管线
- `requirements.txt` — Python 依赖
- `.env.example` — 环境变量配置模板

## 验证清单
- [ ] aggregator.py 运行后 news.json 条目数 > 0
- [ ] 所有条目有 title、url、source、time 字段
- [ ] 无重复条目

## 给 Code 会话的指令
- 工作目录：`projects/news/`
- 聚合输出写入：`projects/news/output/news.json`
- 中间产出放：`projects/news/output/`
- 不要修改其他子项目的文件

## 启动验证清单

新会话启动时，请逐项检查：

- [ ] 阅读根目录 `CLAUDE.md` 了解全局上下文
- [ ] 阅读 `memory/project-status.md` 确认 news 子项目当前状态
- [ ] 检查 `projects/news/output/news.json` 最新更新时间，确认聚合器是否正常运行
- [ ] 检查 GitHub Actions 最近一次 `news-aggregator` 工作流是否成功
- [ ] 确认你要修改的文件不属于其他子项目
- [ ] 完成任务后更新本文件"当前状态"和"待解决"部分
