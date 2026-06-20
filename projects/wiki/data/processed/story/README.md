# 故事数据结构层（story/）

> 本目录把解包出的**故事/叙事相关数据**整理成清晰结构，便于 wiki「剧情」板块与跨档案检索使用。
> **原始文本零改动**：所有正文（`desc`）与解锁文案（`lock_tip`）均从原始解包文件**逐字拷贝**，含 `<Title:>`/`<Bold:>` 等游戏内标记，未做任何改写、清洗或润色。

---

## 一、组织枢纽：剧情单元

所有故事数据以**剧情单元**为枢纽组织，共 26 个：

| 类型 | 数量 | 说明 |
|------|------|------|
| `prologue` 序章 | 1 | 游戏开篇 |
| `main_chapter` 调查行动主线 | 8 | 第 1-8 章（东区秘事 … 终末交响曲）|
| `mind_dive` 意识潜游 | 17 | 支线 / 活动剧情 |

单元目录与元数据见 [`story_units.json`](./story_units.json)。

---

## 二、本层文件

| 文件 | 内容 | 条目数 |
|------|------|--------|
| [`story_units.json`](./story_units.json) | 剧情单元脊柱（类型 / 章号 / 顺序 / 各单元 lore 数 / **关卡组 id**）| 26 单元 |
| [`lore_entries.json`](./lore_entries.json) | 全量 lore 结构化记录（**找回正文** + 章节关联 + 分类）| 1026 条（798 含正文）|
| [`lore_by_unit.json`](./lore_by_unit.json) | 剧情单元 → 该单元解锁的 lore id 列表（导航索引）| 覆盖 184 条 |
| [`stages_by_unit.json`](./stages_by_unit.json) | 剧情单元 → 关卡组（StageGroup）映射 | 58 组 / 24 单元 |
| [`character_story_links.json`](./character_story_links.json) | 角色 → 故事链路（小传解锁条件 + 类型 + 所属单元）| 55 角色 |
| [`index.json`](./index.json) | **故事主索引**：每单元聚合 lore / 关卡组 / 登场角色 | 26 单元 |
| [`STORY_TIMELINE.md`](./STORY_TIMELINE.md) | 人类可读剧情时间线浏览页（由 index 自动生成）| 26 单元 |

### `lore_entries.json` 字段

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | CollectionHall | 条目 id |
| `title` | world_lore.json | 标题 |
| `desc` | **collection_story.txt（原始，逐字）** | 叙事正文；无正文为 `""` |
| `lock_tip` | world_lore.json（原始） | 解锁文案，逐字 |
| `story_unit` | 解析自 `lock_tip` | 所属剧情单元；无章节线索为 `null` |
| `category` | world_lore + story_character_map | `character_bio`/`locations`/`creatures`/`concepts`/`uncategorized` |
| `has_description` | 计算 | 是否有正文 |

> **关键修复**：旧 `world_lore.json` 的 `all_entries` 当初丢失了正文（仅存 id/title/lock_tip）。本层从原始 `collection_story.txt` 逐字找回 798 条正文，使 lore 记录首次完整。

---

## 三、关联的既有故事数据（本层只引用、不复制）

为避免重复，以下既有派生文件保持原位，本层通过 id 交叉引用：

| 数据 | 文件（在上级 `processed/`） | 与本层的连接 |
|------|------|------|
| 角色小传 | `story_character_map.json`（55）| id ↔ `lore_entries`（`category=character_bio`）|
| 角色语音 + 关系/八卦 | `voice_character_map.json`（45 角色）、`voice_lines.json` | 角色名 ↔ 角色库 |
| 道具背景故事 | `item_stories.json`（375）| 独立叙事层，道具 id |
| 关卡（含章节名）| `stages.json`（5709 关 / groups）| 章节名 ↔ `story_units` |
| CG 图鉴 | `cg_gallery.json` | 角色 / 剧情 |
| 角色库 | `characters.json`（72，已分类）| 角色 id |

---

## 四、数据血缘（原始 → 派生）

```
原始解包层（只读，不动）
  extracted/categorized/collection_story.txt   ──┐ desc 正文
  extracted/lua_tables/CollectionHall.lua        │
  extracted/categorized/voice_data.txt           │
        │                                         │
        ▼                                         ▼
  world_lore.json (title/lock_tip)  ──►  story/lore_entries.json（合并 + 找回正文）
                                              │
                                              ├─► story/story_units.json（章节脊柱 + 关卡组）
                                              └─► story/lore_by_unit.json（导航索引）

  StageGroup.lua / stages.json  ────────►  story/stages_by_unit.json（章节 → 关卡组）
```

> **关卡关联边界**：`Stage.lua` 与 `StageGroup.lua` 解包数据间**无外键**，单个关卡无法归组，故关卡仅关联到**关卡组**层级（按组名归一化后精确匹配章节短名，已规避「一步之遥」类子串歧义）。序章与「一步之遥：似雨之泪」无匹配关卡组（24/26 单元有关卡组）。

---

## 五、已知边界（诚实标注）

- **184/1026** 条 lore 能从 `lock_tip` 挂到具体剧情单元；其余 842 条无章节解锁线索（`story_unit=null`），多为道具/概念类常驻 lore。
- `mind_dive` 单元的 `order` 按首条 lore id **近似**排列，**非确切剧情时序**。
- `category` 沿用 world_lore 原始自动分类（character_bio 除外，后者经 story_character_map 校验）；分类完善需后续人工核对，本层不臆断。
- 语音行 → 剧情单元**不可自动关联**（语音按角色获取/启灵等级解锁，不带章节信息）。

> 生成日期：2026-06-17。原始文本来源文件均未修改。
