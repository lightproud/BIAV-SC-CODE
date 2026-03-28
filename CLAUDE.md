# 忘却前夜 Morimens — 项目总控制

## 项目架构

本项目采用 **主控制台 + 子项目** 的 Claude Code 多会话协作模式。
每个 Claude Code 对话会话负责一个独立的子项目，由主控制台统一协调。

## 会话分工

| 会话名称 | 角色 | 职责 | 状态 |
|---------|------|------|------|
| **主控制台** | 总控制 | 项目规划、架构决策、协调子项目、代码审查 | Active |
| **新闻收集器** | 子项目 | 社区热点聚合（aggregator.py + index.html + GitHub Actions） | In Progress |
| **官方数据库** | 子项目 | 游戏官方数据整理与维护 | In Progress |

## 当前项目组成

### 已完成模块
- `index.html` — 前端展示页面（纯静态，深色主题）
- `scripts/aggregator.py` — 多平台数据抓取（Reddit/B站/Twitter/NGA/TapTap）
- `.github/workflows/update-news.yml` — 每小时自动抓取 + 部署
- `data/news.json` — 聚合数据文件

### 数据源状态
- [x] Bilibili — 正常运行
- [x] Reddit — 代码就绪（需有内容才能抓到）
- [ ] Twitter/X — 需配置 TWITTER_BEARER_TOKEN
- [ ] NGA — 需配置 NGA_FORUM_ID
- [ ] TapTap — 需配置 TAPTAP_APP_ID
- [ ] Discord — 未实现
- [ ] YouTube — 未实现

### 待开发功能
- [ ] 官方数据库模块
- [ ] Discord Bot 集成
- [ ] YouTube Data API 集成
- [ ] 搜索功能
- [ ] 多语言支持（中/英/日）
- [ ] PWA 支持

## 子项目协作规范

1. **分支命名**：`claude/<功能描述>-<ID>`
2. **各子项目在自己的分支上开发**，由主控制台决定何时合并
3. **信息同步**：子项目的关键决策和进展记录在本文件中
4. **代码风格**：
   - 前端：纯 HTML/CSS/JS，无框架
   - 后端：Python 3.11+
   - 部署：GitHub Pages + GitHub Actions

## 变更日志

- 2026-03-28: 创建主控制台，建立项目协作架构
