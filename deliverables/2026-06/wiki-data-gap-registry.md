# Wiki 角色数据缺口登记（2026-06-02）

## 用途

本文件登记 wiki 角色数据库（`projects/wiki/data/db/characters.json`）从客户端解包源
填充时的**字段可行性边界**：哪些字段解包即得、哪些受阻于数据缺口。它是 72 角色规模化
填充的诚实基线——明确告知后续工作「哪些能可靠填、哪些不能在不违反数据纪律的前提下填」。

结论由一次 5-8 角色填充试点勘察得出：试点未产出数据填充，因为玩法/故事字段在当前解包
源中**无法可靠映射回角色 ID**，强行填充将违反数据纪律「绝不推断、映射不确定保持 pending」。

## 字段映射可行性表

| schema 字段 | 解包源 | 可靠映射 | 现状 |
|------|------|------|------|
| name_zh / title_zh / age / height / weight / gi / gender / voice_actor / painter | `AwakerConfig.lua [awakerId]` 直键 | 是（ID 直接对齐） | 现有 23 条已全填 |
| characteristic | `AwakerConfig.lua` Characteristic（空格分隔） | 是 | 已全填 |
| introduction / awaker_introduction / summon_slogan | `AwakerConfig.lua` | 是（缺失项为源本身即空） | 已全填 |
| skills / commune / talent | `AwakerPotency.lua` | 否 | Potency 用独立 ID（13xxx/79xxx/122xxx），无 PotencyId→AwakerId 关联表 |
| background_story | `collection_story.txt` / `CollectionHall.lua` | 否 | CollectionHall 用独立 ID，无 AwakerId 字段 |
| trinkets / trinkets_recommended | `TrinketSuitEffect.lua` | 否 | 神器套效果表，无角色绑定 |
| ascension_materials / bond_rewards / stat_growth_curve / affinities | 无源 | 否 | schema 自述 Mooncell-target，解包无此数据 |
| voice_line_refs | `Voice.lua` / `voice_data.txt` | 部分 | 需逐条核 ID，本试点未展开 |

## 根因：解包源缺「关联键」

`AwakerConfig.lua` 用角色 ID（如 `[15560]`）直接作表键，因此角色元数据天然可靠映射。
但 `AwakerPotency.lua`（技能/共鸣）与 `CollectionHall.lua`（背景故事）**各自使用独立业务
ID**，解包产物里**不存在把它们桥接回角色 ID 的字段**。

唯一能把 Potency 文本关联到角色的途径是「PotencyDesc 文本里偶现的角色名」——这属于推断
映射，会污染公开知识层，违反数据纪律，**不予采用**。

勘察范围：5 个候选解包源 + 全 `extracted` 目录（22 个 lua 表 + 16 个 categorized 文本），
结论稳固。

## 可填 vs 受阻字段清单

- **解包即得（已全部填入现有 23 条 partial 记录）**：全部角色元数据字段。
- **受阻于缺关联键（正确保持 pending，非待修缺陷）**：skills / commune / talent /
  background_story / trinkets / trinkets_recommended。
- **解包无此数据（Mooncell-target，需外部权威源）**：ascension_materials / bond_rewards /
  stat_growth_curve / affinities。
- **部分可行（需逐条核 ID）**：voice_line_refs。

## 对 72 角色规模化的指引

1. 元数据字段可对全部 72 角色批量填充（status 升至 partial），路径已验证可靠。
2. 玩法/故事字段在获得 Potency↔Awaker、CollectionHall↔Awaker 的**公开解包关联表**
   （非黑池数据，遵守 §1.1）之前，对全部角色保持 pending 是正确状态。
3. fixture 假数据（pandia）的替换是独立任务，需 status=complete 的真实数据到位后处理，
   不应在关联表缺失期间强行替换。

## 试点结论

现有 23 条 partial 记录的 pending 玩法字段是**正确状态，不是待修缺陷**。在解包关联表到位
前，wiki 数据填充的瓶颈是数据缺口而非工程能力。本登记表即规模化的核心导航资产。
