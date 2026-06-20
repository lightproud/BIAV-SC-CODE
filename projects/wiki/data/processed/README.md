# 派生数据层（processed/）目录

> 解包原始数据（`../extracted/`）经脚本整理后的**派生 JSON 层**，供 wiki 站点与跨档案检索消费。
> 本目录文件均为派生产物；**原始文本权威在 `../extracted/`**，派生层不改动原始正文。

---

## 角色域

| 文件 | 内容 |
|------|------|
| [`characters.json`](./characters.json) | 72 唤醒体基线（已分类 playable/unreleased/easter_egg，带 `confirmed_by`）|
| [`character_index.json`](./character_index.json) | **统一角色索引**：每角色聚合 小传/故事解锁/卡池/被议论 的引用与存在性 |
| [`banners_by_character.json`](./banners_by_character.json) | 角色 ↔ 卡池（按角色 id；源仅 6 角色有数据）|
| [`potency.json`](./potency.json) | 命轮/潜能数值（AwakerPotency）|
| [`cg_gallery.json`](./cg_gallery.json) | CG 图鉴（按章节组织，15 章）|

## 故事域 → 见 [`story/`](./story/README.md) 子目录

剧情单元脊柱 + lore（含找回正文）+ 章节↔关卡组↔角色 索引 + 可读时间线，详见 `story/README.md`。

| 故事相关文件（本级） | 内容 |
|------|------|
| [`world_lore.json`](./world_lore.json) | CollectionHall 提取（title/lock_tip/分类；正文已在 story/lore_entries 找回）|
| [`story_character_map.json`](./story_character_map.json) | 55 角色小传（CollectionHall Title==角色名）|
| [`voice_character_map.json`](./voice_character_map.json) | 语音聚类 + 「关于X」八卦关系（**注：键为八卦对象，非说话者**）|
| [`voice_lines.json`](./voice_lines.json) | 全量语音行 |
| [`item_stories.json`](./item_stories.json) | 道具背景故事（375）|

## 玩法/系统域

| 文件 | 内容 |
|------|------|
| [`stages.json`](./stages.json) | 关卡（5709）+ 关卡组（985）|
| [`tasks.json`](./tasks.json) | 任务/成就目标（6317，多为挑战目标非叙事）|
| [`summon.json`](./summon.json) | 卡池规则（366）|
| [`feature_unlock.json`](./feature_unlock.json) | 功能解锁 |
| [`drops_by_item.json`](./drops_by_item.json) | 掉落（按道具）|

## 文本域

| 文件 | 内容 |
|------|------|
| [`language_config.json`](./language_config.json) | 多语言键 |
| [`panel_text.json`](./panel_text.json) | UI 面板文案 |
| [`update_notices.json`](./update_notices.json) | 更新公告全文 |

## 待清理（历史遗留）

| 文件 | 说明 |
|------|------|
| `notion_voice_enrichment.json` / `NOTION_ENRICHMENT.md` | 早期向 Notion 灌数据的本地副本；Notion 侧数据已删，这两份去留待守密人裁定 |

---

> 数据血缘原则：`extracted/`（原始，只读）→ `processed/*.json`（派生）。本层不修改原始正文；故事域逐字正文见 `story/lore_entries.json`。
