# News 聚合器 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。
> 最后更新：2026-04-01 by 战略中心

## 当前状态：收缩夯实阶段

## 本周任务（2026-04-01 ~ 04-07）

> 来源：战略中心 Phase 0 行动方案。优先级从高到低。

1. **桥接 Discord 归档数据到聚合器**：让 `aggregator.py` 读取 `projects/news/data/discord/` 当日 JSONL 数据，提取摘要进入 `news.json`。这样日报能覆盖 Discord 平台
2. **实现 Discord 归档月度清理**：按 `memory/decisions.md` 2026-03-29 决策，每月 1 日将上月数据打包推 GitHub Releases，从 git 删除。当前归档已 299MB，必须尽快
3. **验证日报质量**：Steam 数据标准化 bug 已修复（split_output.py），下次 workflow 运行后确认日报正确显示 Steam + Bilibili + Discord 三个数据源

### 注意事项
- update-news.yml 已从每小时降到每日 2 次（06:00/16:00 UTC）
- discord-archive.yml 已从每小时降到每日 1 次（18:00 UTC）
- generate-report.yml 定时触发已暂停（secrets 未配，手动触发仍可用）

## 已完成
- [x] aggregator.py 基础架构（Reddit/Bilibili/Twitter/NGA/TapTap/Steam）
- [x] index.html 前端页面（深色主题，平台筛选）
- [x] GitHub Actions 自动抓取
- [x] B站 + Steam 数据源接通
- [x] Discord 全量归档系统（537 频道）
- [x] split_output.py Steam 数据标准化修复

## 后续待做（非本周）
- Reddit 子版块名需确认（r/Morimens 是否存在）
- Twitter/NGA/TapTap 需配置密钥
- YouTube 需 API Key（代码已就绪）
- 两套采集系统（aggregator.py vs report-system）合并决策

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
