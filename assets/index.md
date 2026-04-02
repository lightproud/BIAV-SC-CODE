# 资产索引

> claude.ai 和 Code 会话生产/使用资产时，先查这个文件确认有什么可用。

## 事实圣经（assets/data/）

| 文件 | 说明 | 更新频率 | 来源 |
|------|------|----------|------|
| `data/interview-2026-04.json` | 53 问制作人深度采访结构化提取 | 一次性 | 战略参谋 |
| `data/narrative-structure.json` | 三部叙事结构、各章压缩细节、角色线 | 低频 | 战略参谋 |
| `data/design-decisions.json` | 设计哲学、被砍机制、平衡理念 | 低频 | 战略参谋 |
| `data/VERSION.md` | 事实圣经版本追踪 | 每次数据变更 | Code-wiki |
| `data/validate.py` | 事实圣经校验脚本 | 按需 | Code-wiki |

## 运营数据（projects/news/output/）

社区聚合数据已迁移至 `projects/news/output/`，不再存放于 assets 目录。

| 文件 | 说明 | 更新频率 | 来源 |
|------|------|----------|------|
| `projects/news/output/news.json` | 社区热点聚合数据 | 每小时（Actions） | Code-news |
| `projects/news/output/all-latest.json` | 全平台最新社区数据（合并） | 每小时 | Code-news |
| `projects/news/output/daily-latest.md` | 最新一期日报 | 每日 | Code-news |

## 数据库数据（projects/wiki/data/db/）

数据库的 20 个模块化 JSON 文件存放在 `projects/wiki/data/db/`，不在 assets 目录下（避免重复拷贝）。

| 文件 | 说明 | 来源 |
|------|------|------|
| `characters.json` | 63 个唤醒体（59 SSR + 4 SR）数据 | Code-wiki |
| `skills.json` | 技能与卡牌系统 | Code-wiki |
| `combat.json` | 战斗机制、状态效果 | Code-wiki |
| `equipment.json` | 命轮与圣契装备 | Code-wiki |
| `realms.json` | 四大界域体系 | Code-wiki |
| `gacha.json` | 抽卡系统与 banner 历史 | Code-wiki |
| `progression.json` | 养成与进阶系统 | Code-wiki |
| `lore.json` | 世界观设定 | Code-wiki |
| `maps.json` | 地图与关卡 | Code-wiki |
| `items.json` | 道具数据 | Code-wiki |
| `teams.json` | 编队与阵容 | Code-wiki |
| `versions.json` | 版本线与联动 | Code-wiki |
| `terminology.json` | 游戏专有术语 | Code-wiki |
| `art_assets.json` | 美术资源引用 | Code-wiki |
| `meta.json` | 元数据与 tier 信息 | Code-wiki |
| `key_commands.json` | 指令钥匙系统 | Code-wiki |
| `cards.json` | 卡牌数据 | Code-wiki |
| `stages.json` | 关卡数据 | Code-wiki |
| `translations.json` | 翻译数据 | Code-wiki |
| `voice_lines.json` | 语音台词 | Code-wiki |

详细说明见 `projects/wiki/CONTEXT.md`。

## 图片

| 目录 | 内容 | 状态 |
|------|------|------|
| `images/characters/` | 角色立绘 | 目录未创建，待收集 |
| `images/ui/` | 游戏 UI 截图 | 目录未创建，待收集 |

## 模板

| 文件 | 用途 | 状态 |
|------|------|------|
| `templates/report.html` | 分析报告模板 | 未创建，待开发 |

---

> **维护说明**：新增资产后必须更新此索引。
