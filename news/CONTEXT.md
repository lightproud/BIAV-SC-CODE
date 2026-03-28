# 新闻收集器 — 子项目上下文

> 本文件供"新闻收集器"会话使用，启动时请先阅读根目录 `CLAUDE.md` 了解全局。

## 职责

自动聚合忘却前夜（Morimens）多平台社区热点，展示在静态页面上。

## 文件说明

- `index.html` — 前端展示页面（纯 HTML/CSS/JS，深色主题）
- `scripts/aggregator.py` — Python 数据抓取脚本，支持 Reddit/B站/Twitter/NGA/TapTap
- `data/news.json` — 聚合输出数据
- `requirements.txt` — Python 依赖（仅 requests）
- `.env.example` — 环境变量配置模板

## 当前状态

- B站抓取正常运行
- Reddit 代码就绪
- Twitter/NGA/TapTap 需配置密钥
- Discord/YouTube 未实现
- GitHub Actions 每小时自动运行

## 待办

- [ ] 接入 Discord Bot
- [ ] 接入 YouTube Data API
- [ ] 添加搜索功能
- [ ] 多语言支持
