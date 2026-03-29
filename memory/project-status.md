# 项目状态一览

> 最后更新：2026-03-29

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| news（新闻聚合 + 报告系统） | 运行中 | Code-news | 配置 API 密钥，启用更多数据源 |
| wiki（数据集 + Wiki 站点） | 已部署 | Code-wiki | 数据持续补全、角色详细数据抓取 |
| game（衍生游戏） | 规划中 | 待创建 | 确定游戏类型 |

## News 新闻聚合 + 报告系统

### 实时聚合器
- **已完成**：前端页面、B站抓取、GitHub Actions 自动化
- **阻塞**：Twitter/NGA/TapTap 需配置密钥
- **数据源状态**：
  - [x] Bilibili — 正常运行
  - [x] Reddit — 代码就绪
  - [ ] Twitter/X — 需 TWITTER_BEARER_TOKEN
  - [ ] NGA — 需 NGA_FORUM_ID
  - [ ] TapTap — 需 TAPTAP_APP_ID
  - [ ] Discord — 未实现
  - [ ] YouTube — 未实现

### 报告系统（新增，来自 new-session-7Plu3）
- **已完成**：29 平台采集器、AI 分析模块、报告生成、多渠道通知（Email/Discord/Telegram/Bark/Webhook）
- **待验证**：整合到新目录结构后的 GitHub Actions 流水线
- **待配置**：各平台 API 密钥

## Wiki 数据集 + 站点

### 游戏数据集（原 database）
- **已完成**：
  - 16 个 JSON 数据文件（`projects/wiki/data/db/`）
  - 56 个 SSR 唤醒体 + SR 角色数据
  - 命轮与圣契装备体系
  - 四大界域体系（Chaos、Aequor、Caro、Ultra）
  - 版本线（含联动记录）
  - 世界观设定（组织、关键角色、主线剧情）
  - 技能系统、战斗机制
  - 地图与关卡数据
  - Python 查询模块 content_db.py
- **已修复**：13+ 角色英文名、界域 ID 标准化（aequor/caro/ultra）、职能标准化（attack/sub_attack/defense/support/chorus）、ID 转英文 slug
- **待办**：角色详细字段扩展（目标 ~40 字段）、接入 Fandom/Gamerch wiki 自动更新、整合 content_database.json 技能数据
- **数据来源**：GameKee wiki、Fandom、Gamerch JP

### Wiki 站点
- **已完成**：VitePress 站点框架、三语言结构（EN/JA/ZH）、约 190 页 Markdown、50 页内容填充（ZH/EN/JA）、GitHub Actions 自动部署工作流
- **技术栈**：VitePress 1.6.3 + Vue 3.5.13
- **部署**：GitHub Pages（官方 Actions 方式，需 Settings→Pages→Source 设为 GitHub Actions）
- **部署状态**：已上线 ✓ https://lightproud.github.io/brain-in-a-vat/
- **根路径方案**：中文为 root locale + rewrites（`docs/zh/` → `/`），en/ja 保持 `/en/`、`/ja/`
- **待办**：角色详细数据（技能/卡牌/天赋/立绘）抓取、content_database.json 整合
- **待决策（主控台）**：单仓库多站点方案（子路径 vs 独立 repo vs 自定义域名）

## Game 衍生游戏

- **已完成**：无
- **待决策**：游戏类型、技术选型、美术方向
