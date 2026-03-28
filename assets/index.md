# 资产索引

> claude.ai 和 Code 会话生产/使用资产时，先查这个文件确认有什么可用。

## 共享数据（assets/data/）

| 文件 | 说明 | 更新频率 | 来源 |
|------|------|----------|------|
| `data/news.json` | 社区热点聚合数据 | 每小时（Actions） | Code-news |

## 数据库数据（projects/database/data/db/）

数据库的 16 个模块化 JSON 文件存放在 `projects/database/data/db/`，不在 assets 目录下（避免重复拷贝）。

| 文件 | 说明 | 来源 |
|------|------|------|
| `characters.json` | 56 个唤醒体（角色）数据 | Code-database |
| `skills.json` | 技能与卡牌系统 | Code-database |
| `combat.json` | 战斗机制、状态效果 | Code-database |
| `equipment.json` | 命轮与圣契装备 | Code-database |
| `realms.json` | 四大界域体系 | Code-database |
| `gacha.json` | 抽卡系统与 banner 历史 | Code-database |
| `progression.json` | 养成与进阶系统 | Code-database |
| `lore.json` | 世界观设定 | Code-database |
| `maps.json` | 地图与关卡 | Code-database |
| `items.json` | 道具数据 | Code-database |
| `teams.json` | 编队与阵容 | Code-database |
| `versions.json` | 版本线与联动 | Code-database |
| `terminology.json` | 游戏专有术语 | Code-database |
| `art_assets.json` | 美术资源引用 | Code-database |
| `meta.json` | 元数据与 tier 信息 | Code-database |
| `key_commands.json` | 指令钥匙系统 | Code-database |

详细说明见 `projects/database/CONTEXT.md`。

## 图片

| 目录 | 内容 | 状态 |
|------|------|------|
| `images/characters/` | 角色立绘 | 待收集 |
| `images/ui/` | 游戏 UI 截图 | 待收集 |

## 模板

| 文件 | 用途 | 状态 |
|------|------|------|
| `templates/report.html` | 分析报告模板 | 待创建 |

---

> **维护说明**：新增资产后必须更新此索引。
