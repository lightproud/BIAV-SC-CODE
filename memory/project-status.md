# 项目状态一览

> 最后更新：2026-03-28

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| news（新闻聚合） | 运行中 | Code-news | 接入更多数据源 |
| database（官方数据库） | 开发中 | Code-database | 确定数据结构 |
| game（衍生游戏） | 规划中 | 待创建 | 确定游戏类型 |

## News 聚合器

- **已完成**：前端页面、B站抓取、GitHub Actions 自动化
- **进行中**：无
- **阻塞**：Twitter/NGA/TapTap 需配置密钥
- **数据源状态**：
  - [x] Bilibili — 正常运行
  - [x] Reddit — 代码就绪
  - [ ] Twitter/X — 需 TWITTER_BEARER_TOKEN
  - [ ] NGA — 需 NGA_FORUM_ID
  - [ ] TapTap — 需 TAPTAP_APP_ID
  - [ ] Discord — 未实现
  - [ ] YouTube — 未实现

## Database 官方数据库

- **已完成**：无
- **进行中**：规划数据结构
- **待决策**：存储格式（JSON / SQLite / YAML）

## Game 衍生游戏

- **已完成**：无
- **待决策**：游戏类型、技术选型、美术方向
