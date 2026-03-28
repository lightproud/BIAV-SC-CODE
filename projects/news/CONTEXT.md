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

## 给 Code 会话的指令
- 工作目录：`projects/news/`
- 聚合输出写入：`assets/data/news.json`
- 中间产出放：`projects/news/output/`
- 不要修改其他子项目的文件
