# 忘却前夜 Morimens — 情报收集与衍生游戏计划

> 收集忘却前夜（忘卻前夜 / Morimens）全方位情报、数据与资产，最终制作衍生同人游戏。

---

## 项目结构

本项目由多个子项目组成，采用 Claude Code 多会话协作模式开发：

| 子项目 | 目录 | 说明 | 状态 |
|--------|------|------|------|
| 社区新闻聚合 | `news/` | 多平台热点自动抓取与展示 | 运行中 |
| 官方数据库 | `database/` | 游戏数据系统性整理 | 开发中 |
| 衍生游戏 | `game/` | 同人游戏开发 | 规划中 |

## 社区新闻聚合 (`news/`)

自动聚合 B站、Reddit、Twitter/X、NGA、TapTap 等平台的忘却前夜社区热点。

- **前端**：纯 HTML/CSS/JS 深色主题页面，支持平台筛选和热门标记
- **后端**：Python 抓取脚本，支持 AI 生成每日总结
- **自动化**：GitHub Actions 每小时抓取，前端每 5 分钟刷新
- **部署**：GitHub Pages，零成本运行

### 快速开始

```bash
# 本地运行抓取
pip install -r news/requirements.txt
python news/scripts/aggregator.py

# 预览页面
open news/index.html
```

## 官方数据库 (`database/`)

整理角色、技能、装备、关卡等官方游戏数据，为衍生游戏提供数据基础。

## 衍生游戏 (`game/`)

基于收集的情报和数据，开发一款衍生同人游戏。

---

## 技术栈

- **前端**: 纯 HTML + CSS + JavaScript
- **后端**: Python 3.11+
- **部署**: GitHub Pages + GitHub Actions
- **协作**: Claude Code 多会话架构
