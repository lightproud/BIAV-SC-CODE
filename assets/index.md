# 资产索引

> claude.ai 和 Code 会话生产/使用资产时，先查这个文件确认有什么可用。
>
> 最后更新：2026-04-20 by 主控台（艾瑞卡会话，sync-memory 重写数据库章节，修正 B3 调研揭露的 20 JSON / 63 角色幻觉）

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
| `projects/news/output/{source}-latest.json` | 各源选样（13 个 source 文件，热度阈值 + 时窗过滤） | 每小时 | Code-news |

## Wiki 数据（projects/wiki/data/）

> **基线状态（2026-04-20 B3 调研修正）**：
> `projects/wiki/data/db/` ⚠ 目录在 git 历史中**从未存在**，Phase 2 首要任务是自举 `characters.json` ⚠（72 角色基线）。
> 完整缺口清单见 `memory/wiki-phase-2-gap-inventory.md`，schema v1.0 见 `memory/wiki-characters-schema-v1.md`（2026-04-20 守密人裁决锁定）。
>
> **真实角色总数为 72**（含皮肤/联动/彩蛋），不是 63。

### 现有可用数据

| 路径 | 说明 | 来源 |
|------|------|------|
| `projects/wiki/data/extracted/categorized/character_data.txt` | 72 角色原始字段数据（AwakerConfig 解包） | 客户端逆向（2026-04-07） |
| `projects/wiki/data/extracted/lua_tables/AwakerConfig.lua` | 角色配置 Lua 源 | 客户端解包 |
| `projects/wiki/data/extracted/art_assets/manifest.json` | 美术资源清单 | 客户端解包 |
| `projects/wiki/data/processed/cg_gallery.json` | CG 画廊已加工数据 | Code-wiki |
| `projects/wiki/data/processed/item_stories.json` | 物品故事已加工数据 | Code-wiki |
| `projects/wiki/data/processed/voice_lines.json` | 语音台词已加工数据 | Code-wiki |
| `projects/wiki/data/processed/world_lore.json` | 世界观设定已加工数据 | Code-wiki |
| `projects/wiki/data/schemas/characters.schema.json` | 角色数据 schema（历史版本） | Code-wiki |
| `projects/wiki/data/schemas/meta.schema.json` | 元数据 schema | Code-wiki |
| `projects/wiki/data/schemas/realms.schema.json` | 界域数据 schema | Code-wiki |

### 角色数据源

| 文件 | 状态 | 说明 |
|------|------|------|
| `projects/wiki/data/processed/characters.json` | 已建立（72 解包真实数据） | wiki 数据层唯一源；原 `db/characters.json`（24 条草稿）已于 2026-06-14 退役 |

详细任务路线见 `projects/wiki/CONTEXT.md` Phase 2 权威路线图章节。

## 图片

| 目录 | 内容 | 状态 |
|------|------|------|
| `images/portraits/` | 角色立绘（47 张 PNG，约 65% 覆盖，对 72 角色仍缺约 25 个） | 可用 |
| `images/ui/` | 游戏 UI 截图 | 目录未创建，待收集 |

---

> **维护说明**：新增资产后必须更新此索引。
