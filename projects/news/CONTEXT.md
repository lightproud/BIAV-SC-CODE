# News 聚合器 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。

## 当前状态：MVP 运行中

## 做了什么
- [x] aggregator.py 基础架构（Reddit/Bilibili/Twitter/NGA/TapTap）
- [x] index.html 前端页面（深色主题，平台筛选）
- [x] GitHub Actions 每小时自动抓取
- [x] B站数据源接通验证

## 待解决
- Reddit 子版块名需确认（r/Morimens 是否存在）
- Twitter/NGA/TapTap 需配置密钥
- Discord/YouTube 抓取未实现
- 搜索功能未实现

## 文件说明
- `index.html` — 前端展示页面（纯 HTML/CSS/JS，深色主题）
- `scripts/aggregator.py` — Python 数据抓取脚本
- `requirements.txt` — Python 依赖（仅 requests）
- `.env.example` — 环境变量配置模板

## report-system 模块
从 `claude/new-session-7Plu3` 分支整合的全球情报报告系统，位于 `report-system/` 子目录。

功能：全球 29 个平台数据采集 → 私人 Claude 分析（带长期记忆）→ 报告生成（JSON/HTML/RSS）→ 多渠道推送通知。

主要文件：
- `report-system/scripts/collector.py` — 全球多平台数据采集器
- `report-system/scripts/analyst.py` — 私人 Claude 分析师（带记忆系统）
- `report-system/scripts/reporter.py` — 报告生成器（JSON + HTML + RSS）
- `report-system/scripts/notifier.py` — 多渠道通知推送（Email/Discord/Telegram/Bark/Webhook）
- `report-system/scripts/run_all.py` — 一键运行全流程
- `report-system/scripts/scheduler.py` — 本地定时任务
- `report-system/index.html` — 交互式仪表盘
- `report-system/data/user_preferences.yaml` — 用户偏好配置
- `report-system/requirements.txt` — Python 依赖
- `report-system/.env.example` — 环境变量模板

GitHub Actions 工作流 `.github/workflows/generate-report.yml` 每天 UTC+8 00:00 自动运行。

## 验证清单
- [ ] aggregator.py 运行后 news.json 条目数 > 0
- [ ] 所有条目有 title、url、source、time 字段
- [ ] 无重复条目

## 给 Code 会话的指令
- 工作目录：`projects/news/`
- 聚合输出写入：`assets/data/news.json`
- 中间产出放：`projects/news/output/`
- 不要修改其他子项目的文件
