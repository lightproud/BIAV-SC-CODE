# Notion 镜像索引 — 忘却前夜解包数据结构化

银芯解包数据 → Notion 结构化镜像的对接索引，供后续 AI 系统调用与增量同步。
本档只记录「写到 Notion 的什么」与「源在仓库的哪里」，不复刻数据本体。

## 数据库一览

| Notion 数据库 | database_id | data_source_id | 条目 | 仓库数据源 |
|---|---|---|---|---|
| Morimens 角色配置(解包真实数据 · 72) | `dc29b0f7-f41c-40ed-b0f2-970196f6b504` | `40d3b7f4-c44b-42c3-89e2-fe92c1a28b12` | 72 唤醒体 | `projects/wiki/data/processed/characters.json` |
| Morimens 界域配置(解包真实数据 · 4) | `b14af361-9953-4ebd-a387-a236e5a533c6` | `6037ffd8-d0fb-4238-969f-c990f3c2a13b` | 4 界域 | `projects/wiki/data/db/realms.json` |

## 角色库本次增补（2026-06-14）

角色库此前已含 72 人基础档案（ID/画师/CV/体重/性别/身高/GI/特性/生日）。
本次为全部 72 页回填以下 4 个结构化字段（源自 processed/characters.json）：

- `称号`（title）
- `简介`（introduction）
- `玩法简介`（gameplay_intro）
- `召唤台词`（summon_slogan）

部分页面对应字段在解包源中本就缺失（如本源系列、部分敌方单位），故留空。

角色名 ↔ Notion page_id 映射见 `notion_character_page_map.json`（按解包 ID 键控，
已对同名页「詹金」15578/15593、「熟悉的黑猫」78840/78841 经 ID 属性消歧）。

## 界域库字段采信

`界域ID / 界域 / 英文名 / 主题色 / 核心机制 / 纯色共鸣` 为公开可查阅事实
（来源 `memory/morimens-context.md` 界域系统）；`难度(fixture)` 与部分纯色共鸣
细节为 fixture 占位，页内已标注，不得当正典引用（遵 realms.json 同款约定）。

## 已知遗留（非本次范围）

角色库部分页面的 `特性` 字段仍为先前会话留下的占位（如「临时文本」），
本次未触碰。如需以 processed/characters.json 的 characteristic 修正，另行派发。
