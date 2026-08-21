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

## 运营数据（全量档案层 Record/Community/）

社区聚合数据在全量档案层 `Record/Community/`（BIAV-SC-DATA，经 `BIAV_SC_DATA_ROOT`），不再存放于 assets 目录。原输出展示层 `projects/news/output/*-latest.json` 已于 2026-08-21 守密人裁定整层删除。

| 文件 | 说明 | 更新频率 | 来源 |
|------|------|----------|------|
| `Record/Community/{platform}/{date}.json` | 社区全量档案（唯一取数面，经 `BIAV_SC_DATA_ROOT`） | 每 3 小时（Actions） | Code-news |
| `projects/news/data/source-health.json` | 采集健康跨轮状态（沉默降级 / 休眠判定） | 每 3 小时 | Code-news |
| 运行期 news.json / *-latest.json | 管线中间态，单轮内产生消费、不进 git | 每 3 小时 | Code-news |

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

### Phase 2 待自举

| 目标文件 | 状态 | 预计建立时间 |
|---------|------|-------------|
| `projects/wiki/data/db/characters.json` | ⚠ 尚未建立，Phase 2 W1 首要任务 | 2026-04-27 ~ 05-03 |

详细任务路线见 `projects/wiki/CONTEXT.md` Phase 2 权威路线图章节。

## 图片

| 目录 | 内容 | 状态 |
|------|------|------|
| `images/portraits/` | 角色立绘（47 张 PNG，约 65% 覆盖，对 72 角色仍缺约 25 个） | 可用 |
| `images/ui/` | 游戏 UI 截图 | 目录未创建，待收集 |

---

> **维护说明**：新增资产后必须更新此索引。
