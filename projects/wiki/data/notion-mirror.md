# Notion 镜像索引 — 忘却前夜解包数据结构化

银芯解包数据 → Notion 结构化镜像的对接索引，供后续 AI 系统调用与增量同步。
本档只记录「写到 Notion 的什么」与「源在仓库的哪里」，不复刻数据本体。

**数据纪律**：Notion 镜像只收录**客户端解包所得的真实数据**。衍生/占位（fixture）
数据不入 Notion（守密人 2026-06-14 裁定）。

## 数据库一览

| Notion 数据库 | database_id | data_source_id | 条目 | 仓库数据源 |
|---|---|---|---|---|
| Morimens 角色配置(解包真实数据 · 72) | `dc29b0f7-f41c-40ed-b0f2-970196f6b504` | `40d3b7f4-c44b-42c3-89e2-fe92c1a28b12` | 72 唤醒体 | `projects/wiki/data/processed/characters.json` |

数据源 `processed/characters.json` 为客户端 `AwakerConfig.lua` 运行时内存解包
（`_meta.total_characters = 72`，2026-04-25 生成），属真实解包数据。

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

## 已撤销项

- **界域库（4 界域）**：曾于本次建立，后经守密人裁定撤销并移入 Notion 回收站
  —— 其源 `realms.json` 多为 fixture 占位 + 衍生知识，非客户端解包真实数据，
  不符 Notion 镜像「只收解包真实数据」纪律。
- **`db/characters.json`（24 条草稿）**：已从仓库删除 —— 该文件为早期手工策展草稿
  （1 fixture + 23 partial，技能多 pending），既非完整也非解包源；权威角色源为
  `processed/characters.json`（72）。

## 已知遗留（非本次范围）

角色库部分页面的 `特性` 字段仍为先前会话留下的占位（如「临时文本」），
本次未触碰。如需以 processed/characters.json 的 characteristic 修正，另行派发。
