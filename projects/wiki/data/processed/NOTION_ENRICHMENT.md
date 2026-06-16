# Notion 角色库富化记录（语音字段）

对接 Notion 数据库 **「Morimens 角色配置(解包真实数据 · 72)」**
（database `dc29b0f7-f41c-40ed-b0f2-970196f6b504` / data source `40d3b7f4-c44b-42c3-89e2-fe92c1a28b12`）。

## 背景

该 Notion 库的 72 角色页此前（2026-06-14）已填入与 wiki 网站
（`docs/characters.md`）一致的基础字段：称号 / 性别 / 生日 / 身高 / 体重 /
GI / CV / 画师 / 特性 / 简介 / 玩法简介 / 召唤台词 / ID。本次按守密人指令
「扩展更丰富字段」做增量富化。

## 数据纪律（重要）

`projects/wiki/data/db/characters.json` 的 skills / trinkets / commune /
background_story / portraits 字段在源数据中**仍为 `pending` 占位**（仅潘狄娅
skills 为显式 `fixture` 合成示例）。该库标题为「解包真实数据」，故**不向其写入任何
占位或合成数据**（遵守 CLAUDE.md §4 数据纪律）。

唯一真实、按角色名映射、可安全写入的丰富来源是**角色闲话语音**
（`voice_character_map.json`，Voice.lua + AwakerConfig.lua 文本匹配）。

## 本次落盘内容

1. 数据库新增列 **`语音条数`**（number）。
2. 45 个有语音的角色页：
   - 写入 `语音条数` 属性；
   - 正文追加 **「角色语音 · 闲话（Voice.lua 解包真实数据）」** 段落，逐条列出
     标题 / voice_id / 关系（他人评述·羁绊解锁）/ 台词原文 / 解锁条件。
   - 共 154 条语音；「詹金」在库中有两条重复页，均已写入。

## 复现

```bash
cd projects/wiki
python3 scripts/build_notion_voice_enrichment.py
# 产出 data/processed/notion_voice_enrichment.json
# 其中 characters[name].notion_body 为可直接插入 Notion 的 Markdown，
# notion_page_ids 为对应页面 ID。
```

写入 Notion 经 MCP `notion-update-page`（环境无 NOTION_TOKEN，未走脚本直连 API）。
若后续配置 token，可据该 JSON 编写幂等 upsert 脚本自动同步。
