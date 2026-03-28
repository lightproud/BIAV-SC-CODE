# 决策日志

> 所有重要的架构、技术、方向决策记录在此。新会话请先阅读。

| 日期 | 决策 | 原因 | 影响范围 |
|------|------|------|---------|
| 2026-03-28 | 建立多会话协作架构 | 职责隔离，避免上下文混乱 | 全局 |
| 2026-03-28 | 目录按 memory/assets/projects 重组 | 区分记忆、资产、代码，支持 Chat 对接 | 全局 |
| 2026-03-28 | ~~前端不使用框架~~ **已废除** | 原因：项目扩展后一刀切不合适 | ~~news, game~~ |
| 2026-03-28 | 各子项目按需选择技术栈 | 取代旧的"不使用框架"原则。news 维持纯 HTML/JS；wiki 用 VitePress；database/game 视需求选型 | 全局 |
| 2026-03-28 | 项目完全开源，MIT License | 方法论吸引技术圈，数据吸引玩家社区 | 全局 |
| 2026-03-28 | 游戏内容版权归脑缸组 | 项目仅引用公开信息 | 全局 |
| 2026-03-28 | 仓库定位为"共享外脑 + 中转站" | Code 生产，Chat 加工交付，仓库是中间层 | 全局 |
| 2026-03-28 | 子项目保持单仓库，不拆分独立 repo | 所有会话需共享 memory/assets，分支隔离已够用，体量轻量无性能压力；仅当 game 资源膨胀时再考虑 submodule 拆分 | 全局 |
| 2026-03-28 | 确立分支管理策略（见下方详细说明） | main 作为稳定基线，子项目分支从 main 拉取，功能稳定后由主控台 PR 合并回 main | 全局 |
| 2026-03-28 | 合并 database 和 wiki 为单一 wiki 子项目 | 数据集是 wiki 的后端，站点是 wiki 的前端，分开容易混淆 | wiki |

## 分支管理策略

### 分支结构
- **main**：稳定基线，所有子项目的共同起点
- **claude/\<功能描述\>-\<ID\>**：子项目开发分支，由各会话独立维护

### 工作流程
1. 新会话启动时，从最新 main 创建分支
2. 各子项目在自己的分支上独立开发
3. 功能稳定后，由主控制台创建 PR 合并回 main
4. 合并后，其他活跃分支应 rebase 到新 main 以获取共享文件更新

### 废弃分支清理
- 已合并或被继承的分支应及时删除
- 已清理：`claude/create-main-control-dialog-s0GuV`、`claude/initial-setup-2rzjz`
- 待清理（重构后）：`claude/community-news-aggregator-1TRtx`、`claude/new-session-7Plu3`、`claude/create-content-database-fhrVq`、`claude/morimens-wiki-site-12fyA`

### 当前活跃分支
| 分支 | 子项目 | 说明 |
|------|--------|------|
| `claude/main-control-console-ObGQw` | 主控制台 | 项目规划与协调 |

> 其他重构分支已合并到 main。新的子项目会话启动时从 main 拉新分支。
