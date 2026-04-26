# Wiki characters.json Schema v1.0.1

> 最后更新：2026-04-20 by 主控台（艾瑞卡会话，批 1 自举管线验证暴露两处工程缺陷，v1.0.1 热修复）
>
> 状态：**正式锁定**。Phase 2 W1 自举会话以此版本为输入。
>
> 版本沿革：
> - v0.1（2026-04-20）：主控台 P2W1D1/P2W1D1-retry 子代理两次 Write timeout 后由主控台直接起草
> - v1.0（2026-04-20）：守密人裁决 6 项遗留问题，全部采纳艾瑞卡建议。详见第五节「裁决记录」
> - v1.0.1（2026-04-20）：批 1（24 角色）管线验证暴露 JSON Schema 语法问题，热修复三处（不改变守密人裁决精神）：(a) id pattern 从 `^15[0-9]{3}$` 放宽至 `^[0-9]{5,6}$` 覆盖 CoC/彩蛋/联动 ID；(b) `realm`/`role` 外层 type/enum 补 null，非 stub 收紧约束下沉至 `allOf.else.properties`；(c) `background_story` 从 `oneOf` 改 `anyOf`，修正 `"pending"` string 与 type:string 的重叠互斥问题
>
> 上游依据：
> - `memory/wiki-phase-2-gap-inventory.md`（B3 权威清单：72 角色、29/29 命轮全缺、立绘/背景故事/技能引导缺口）
> - `memory/decisions.md`（界域/职能/slug 标准化历史决策 + 2026-04-20 v1.0 锁定条目）
> - `projects/wiki/data/extracted/categorized/character_data.txt`（运行时内存扫描 + AssetBundle 解密产物；Tuanjie Engine 2022.3.61t8；LuaT0 字节码）

---

## 一、设计目标

1. 覆盖 72 角色全部可预见字段，并为 B3 揭露的四类缺口留有表达位：技能引导、背景故事、命轮、立绘
2. 为「暂缺」状态提供明确的 null / `"pending"` 规约，避免 Phase 2 中期因数据未到位而无法表达记录
3. 为数据 bug（詹金 15578 vs 15593 / 黑猫 x2）预留 `duplicate_bug` 标记字段
4. 字段命名遵循已有约定：英文 slug、`lowercase_snake_case`
5. Schema 为 draft-07，可直接落盘 `projects/wiki/data/db/characters.schema.json` ⚠（目标路径，Phase 2 W1 自举时建立），供 CI validate-data.yml 校验

## 二、JSON Schema（draft-07）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Morimens Characters Database",
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": false,
    "allOf": [
      {
        "description": "Q6 裁决：严格模式 + stub 放宽 realm/role 为 null",
        "if": { "properties": { "status": { "const": "stub" } }, "required": ["status"] },
        "then": {
          "required": ["id", "slug", "name_zh", "status", "source", "last_verified"],
          "properties": {
            "realm": { "type": ["string", "null"], "enum": ["aequor", "caro", "ultra", null] },
            "role": { "type": ["string", "null"], "enum": ["attack", "sub_attack", "defense", "support", "chorus", null] }
          }
        },
        "else": {
          "required": ["id", "slug", "name_zh", "realm", "role", "status", "source", "last_verified"],
          "properties": {
            "realm": { "type": "string", "enum": ["aequor", "caro", "ultra"] },
            "role": { "type": "string", "enum": ["attack", "sub_attack", "defense", "support", "chorus"] }
          }
        }
      }
    ],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[0-9]{5,6}$",
        "description": "游戏内 AwakerConfig ID（字符串形态，5-6 位）。实际范围：主干 15560-15604 / CoC 54116-54117 + 77911-77928 / 彩蛋 78754/78840/78841 / 联动皮肤 94450-130901（含 6 位）"
      },
      "slug": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_]*$",
        "description": "英文 lowercase_snake_case，跨语 URL 稳定键"
      },
      "name_zh": { "type": "string", "minLength": 1 },
      "name_en": { "type": ["string", "null"] },
      "name_en_source": {
        "type": ["string", "null"],
        "enum": ["official", "community", null],
        "description": "Q2 裁决：官方 > 社区；无官方时社区补位并标此字段"
      },
      "name_ja": { "type": ["string", "null"] },
      "name_ja_source": {
        "type": ["string", "null"],
        "enum": ["official", "community", null],
        "description": "Q2 裁决：官方 > 社区"
      },
      "title_zh": { "type": ["string", "null"] },
      "realm": {
        "type": ["string", "null"],
        "enum": ["aequor", "caro", "ultra", null],
        "description": "界域 ID 标准化（决策 2026-03）。外层放宽至可接受 null；非 stub 状态下由顶层 allOf.else 分支收紧为必填且不可 null。"
      },
      "role": {
        "type": ["string", "null"],
        "enum": ["attack", "sub_attack", "defense", "support", "chorus", null],
        "description": "职能标准化（决策 2026-03）"
      },
      "gender": {
        "type": "string",
        "enum": ["male", "female", "other", "unknown"]
      },
      "age": { "type": ["string", "null"], "description": "游戏内是生日格式，如『4月15日』，保留原始字符串" },
      "height": { "type": ["string", "null"], "description": "英制原始字符串，如『5'2''』" },
      "weight": { "type": ["string", "null"] },
      "gi": { "type": ["string", "null"], "description": "GI 数值或原始文本，如『23.67』/『？』" },
      "voice_actor": { "type": ["string", "null"] },
      "painter": { "type": ["string", "null"] },
      "introduction": { "type": ["string", "null"], "description": "角色短介" },
      "awaker_introduction": { "type": ["string", "null"], "description": "觉者态短介" },
      "characteristic": {
        "type": "array",
        "items": { "type": "string" },
        "description": "特性标签，原数据由全角空格分隔，入库时拆分为数组"
      },
      "summon_slogan": { "type": ["string", "null"] },
      "skills": {
        "oneOf": [
          { "type": "null" },
          { "const": "pending" },
          {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["slot", "name"],
              "properties": {
                "slot": { "type": "string", "enum": ["normal", "special", "ultimate", "passive"] },
                "name": { "type": "string" },
                "description": { "type": ["string", "null"] },
                "keywords": { "type": "array", "items": { "type": "string" } }
              }
            }
          }
        ],
        "description": "技能引导缺口：Phase 2 W2-W3 填充"
      },
      "trinkets": {
        "oneOf": [
          { "type": "null" },
          { "const": "pending" },
          {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name"],
              "properties": {
                "id": { "type": "string" },
                "name": { "type": "string" },
                "description": { "type": ["string", "null"] }
              }
            }
          }
        ]
      },
      "commune": {
        "oneOf": [
          { "type": "null" },
          { "const": "pending" },
          {
            "type": "object",
            "required": ["nodes"],
            "properties": {
              "nodes": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["tier", "name"],
                  "properties": {
                    "tier": { "type": "integer", "minimum": 1, "maximum": 10, "description": "Q4 裁决：自举阶段放宽 1–10；Phase 2 W3 UI 实装时按游戏内 node 层数回收上限" },
                    "name": { "type": "string" },
                    "effect": { "type": ["string", "null"] }
                  }
                }
              }
            }
          }
        ],
        "description": "命轮缺口：B3 揭露 29/29 全缺，Phase 2 W3-W4 填充"
      },
      "background_story": {
        "anyOf": [
          { "type": "null" },
          { "const": "pending" },
          { "type": "string" }
        ],
        "description": "背景故事缺口：Phase 2 W3 填充。anyOf 而非 oneOf，因 `pending` string 字面与 `type: string` 会重叠违反 oneOf 互斥性。"
      },
      "portraits": {
        "type": "object",
        "additionalProperties": false,
        "description": "Q3 裁决：路径键锁 slug，约定 assets/images/portraits/{slug}/default.png / .../awaker.png / .../skins/{skin_id}.png",
        "properties": {
          "default": { "type": ["string", "null"], "pattern": "^assets/images/portraits/[a-z][a-z0-9_]*/default\\.(png|jpg|webp)$|^$", "description": "约定格式 assets/images/portraits/{slug}/default.{ext}" },
          "awaker": { "type": ["string", "null"], "pattern": "^assets/images/portraits/[a-z][a-z0-9_]*/awaker\\.(png|jpg|webp)$|^$" },
          "skins": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "path"],
              "properties": {
                "id": { "type": "string" },
                "name": { "type": ["string", "null"] },
                "path": { "type": "string", "pattern": "^assets/images/portraits/[a-z][a-z0-9_]*/skins/[a-z0-9_]+\\.(png|jpg|webp)$" }
              }
            }
          }
        }
      },
      "duplicate_bug": {
        "oneOf": [
          { "type": "null" },
          {
            "type": "object",
            "required": ["duplicate_of", "note"],
            "properties": {
              "duplicate_of": { "type": "string", "pattern": "^[0-9]{5,6}$" },
              "note": { "type": "string" },
              "ruled_by": { "type": "string", "description": "裁定人 + 日期" }
            }
          }
        ],
        "description": "数据 bug 标记：詹金 15578 vs 15593 / 黑猫 x2 等"
      },
      "source": {
        "type": "object",
        "required": ["extracted_from", "extracted_at"],
        "properties": {
          "extracted_from": { "type": "string", "description": "如『AwakerConfig.lua』" },
          "extracted_at": { "type": "string", "format": "date" },
          "game_version": { "type": ["string", "null"] }
        }
      },
      "last_verified": { "type": "string", "format": "date" },
      "status": {
        "type": "string",
        "enum": ["complete", "partial", "stub"],
        "description": "complete=全字段齐全；partial=基础字段齐全但缺口字段 pending；stub=仅 ID+slug+name 骨架"
      }
    }
  }
}
```

**required 字段清单（8 项）**：`id` / `slug` / `name_zh` / `realm` / `role` / `status` / `source` / `last_verified`

**字段总数**：25 个 properties（含嵌套对象）

**暂缺表达三态**：
- `null` — 标量字段无值（如 `height: null`）
- `"pending"` — 复合对象待补（`skills: "pending"` / `commune: "pending"`）
- `{ "status": "pending", ... }` — 对象内标记（`status` 字段取 `partial` / `stub`）

## 三、示例角色（3 条）

### 3.1 阿格里帕（数据齐全型 / ID 15600）

```json
{
  "id": "15600",
  "slug": "agrippa",
  "name_zh": "阿格里帕",
  "name_en": null,
  "name_ja": null,
  "title_zh": "阿格里帕",
  "realm": "caro",
  "role": "defense",
  "gender": "female",
  "age": "4月15日",
  "height": "5'2''",
  "weight": "90lbs",
  "gi": "？",
  "voice_actor": "石川明日菜",
  "painter": "巴拉巴拉",
  "introduction": "提供大量胚胎融合的同时，对敌人注入毒素来破坏其神志。",
  "awaker_introduction": "·拥有强大的防护和施加<IntoxicationIconKeywords:中毒>的能力，触发吞噬可获得永久攻防成长的能力。",
  "characteristic": ["戒备成长", "中毒连击"],
  "summon_slogan": "在她构筑的迷宫中，迷失的可不止是方向。",
  "skills": "pending",
  "trinkets": "pending",
  "commune": "pending",
  "background_story": "pending",
  "portraits": {
    "default": null,
    "awaker": null,
    "skins": []
  },
  "duplicate_bug": null,
  "source": {
    "extracted_from": "AwakerConfig.lua",
    "extracted_at": "2026-04-07",
    "game_version": "Tuanjie Engine 2022.3.61t8"
  },
  "last_verified": "2026-04-20",
  "status": "partial"
}
```

**字段填充率**：13/12 原始字段全覆盖；基础档案完整；skills/trinkets/commune/background_story/portraits 五类缺口明示 pending。

### 3.2 本源汀克特（数据缺失型 / ID 15561）

```json
{
  "id": "15561",
  "slug": "source_tincture",
  "name_zh": "本源汀克特",
  "name_en": null,
  "name_ja": null,
  "title_zh": "本源汀克特",
  "realm": "ultra",
  "role": "attack",
  "gender": "female",
  "age": "3月7日",
  "height": "5'4''",
  "weight": "110lbs",
  "gi": "23.67",
  "voice_actor": "冈本美歌",
  "painter": "巴拉巴拉",
  "introduction": null,
  "awaker_introduction": null,
  "characteristic": ["卡牌强化", "力量夺取"],
  "summon_slogan": null,
  "skills": "pending",
  "trinkets": "pending",
  "commune": "pending",
  "background_story": "pending",
  "portraits": {
    "default": null,
    "awaker": null,
    "skins": []
  },
  "duplicate_bug": null,
  "source": {
    "extracted_from": "AwakerConfig.lua",
    "extracted_at": "2026-04-07",
    "game_version": "Tuanjie Engine 2022.3.61t8"
  },
  "last_verified": "2026-04-20",
  "status": "partial"
}
```

**字段填充率**：10/12 原始字段；introduction / awaker_introduction / summon_slogan 三字段原始数据即缺，置 null 非 pending（区分"数据源缺"vs"暂未导入"）。

### 3.3 詹金（ID 重复 bug 型 / ID 15578）

```json
{
  "id": "15578",
  "slug": "jenkin",
  "name_zh": "詹金",
  "name_en": null,
  "name_ja": null,
  "title_zh": "詹金",
  "realm": "caro",
  "role": "attack",
  "gender": "female",
  "age": "1月1日",
  "height": "4'4.4''",
  "weight": "67lbs",
  "gi": "21.43",
  "voice_actor": "山田真瑠奈",
  "painter": "巴拉巴拉",
  "introduction": "有着高额的暴击率和暴击伤害，布朗和鼠群会成为他对抗多名敌人的关键助力。",
  "awaker_introduction": null,
  "characteristic": ["多次伤害", "暴击"],
  "summon_slogan": null,
  "skills": "pending",
  "trinkets": "pending",
  "commune": "pending",
  "background_story": "pending",
  "portraits": {
    "default": null,
    "awaker": null,
    "skins": []
  },
  "duplicate_bug": {
    "duplicate_of": "15593",
    "note": "15578 与 15593 在数据源中均命名『詹金』，守密人 2026-04-20 裁定为游戏客户端数据 bug；保留两条独立记录，下游 UI 以 duplicate_bug 字段提示。",
    "ruled_by": "守密人 Light @ 2026-04-20"
  },
  "source": {
    "extracted_from": "AwakerConfig.lua",
    "extracted_at": "2026-04-07",
    "game_version": "Tuanjie Engine 2022.3.61t8"
  },
  "last_verified": "2026-04-20",
  "status": "partial"
}
```

**字段填充率**：11/12 原始字段；`duplicate_bug` 字段首次实际填充，展示如何跨记录引用。

## 四、字段设计说明

### 为什么 `id` 用字符串而非整型？
游戏内 ID 前缀恒为 `15`，且未来可能出现非数字形态（联动角色 ID）；字符串便于 URL 与 JSON key 用作外键。

### 为什么 `characteristic` 是数组？
原始数据是两个中文短语以**全角空格**分隔（示例：`戒备成长    中毒连击`），批量自举时需拆分为数组，避免下游搜索/过滤再次分词。

### 为什么 `skills` / `trinkets` / `commune` 用 `"pending"` 而非空数组？
区分"该角色确认无此类数据"vs"尚未补全"。空数组=确认无；`"pending"`=暂缺；`null`=标量的对等暂缺表达。配合 `status: "partial"` 可机读筛选待办。

### 为什么 `duplicate_bug` 不对称引用？
只有"副本"一方填写 `duplicate_of`，避免维护双向一致性负担。下游需要反向查询时通过 JSON Path 扫描一次性构建。

### 为什么 `source` 独立为对象？
Phase 2 之后数据源会扩展（官方公告 / 社区贡献 / 制作人采访），需保留提取路径；当前仅一条 `AwakerConfig.lua`，但 schema 已预留扩展。

### 为什么不下沉 i18n 到独立文件？
权衡后选择**同文件 `name_en` / `name_ja` 字段**路线：
- 优点：单次 fetch 即得多语，VitePress 多语路由按 locale 取字段简单
- 缺点：翻译工作流耦合主数据；Phase 2 可能需要专人翻译，届时再评估是否分离

## 五、守密人裁决记录（2026-04-20，v1.0 锁定依据）

守密人对 v0.1 第五节 6 项遗留问题批示「全部采纳」。艾瑞卡建议即为 v1.0 锁定方案。

| # | 议题 | 裁决 | Schema 落地位置 |
|---|------|------|---------------|
| Q1 | 重复 ID（詹金 15578/15593、黑猫 78840/78841）处理 | **方案 A**：保留两条独立记录，`duplicate_bug` 字段互指；保真游戏数据，便于未来修复后无损拆分 | `duplicate_bug` 对象（已存在） |
| Q2 | `name_en` / `name_ja` 翻译来源 | **官方 > 社区**；无官方时社区补位并标 `translation_source: "community"` | 新增 `name_en_source` / `name_ja_source` 字段，enum = `official` / `community` / null |
| Q3 | 立绘文件路径规范 | **键锁 `slug`**：`assets/images/portraits/{slug}/default.{ext}` / `.../awaker.{ext}` / `.../skins/{skin_id}.{ext}`；ID 改动不触发批量重命名 | `portraits` 对象新增 `pattern` 正则强约束 |
| Q4 | 命轮 `tier` 上限 | **放宽至 1–10**；Phase 2 W3 UI 实装时根据游戏内真实 node 层数回收上限 | `commune.nodes.items.tier.maximum` 从 6 → 10 |
| Q5 | `gi` 字段是否额外 `gi_numeric` 供排序 | **v1.0 不纳入**；Phase 2 UI 实装需排序时再加，避免过早引入增加自举会话校验负担 | 无（保持原 `gi` string 字段） |
| Q6 | `status: stub` 严格模式放宽 | **v1.0 保持严格模式 + stub 状态下允许 `realm: null` / `role: null`** | 顶层 `allOf` 条件约束：if `status=stub` then 6 项 required（去掉 realm/role），`realm`/`role` enum 追加 null |

### 5.1 裁决对 v0.1 → v1.0 的增量

- 新增 2 个 properties：`name_en_source` / `name_ja_source`
- 修改 `commune.tier.maximum`：6 → 10
- 加强 `portraits.*.path` 的 pattern 约束（slug 锁定）
- 新增顶层 `allOf` 条件分支（stub 放宽）
- 字段总数：25 → **27**
- required 项仍为 8 项（非 stub 时）；stub 时降为 6 项

## 六、下一步（v1.0 锁定后）

1. **已完成**（2026-04-20）：
   - ✓ 主控台审阅通过
   - ✓ 守密人「全部采纳」裁决
   - ✓ schema 升级至 v1.0（本文件）
   - ✓ 裁决写入 `memory/decisions.md`

2. **Phase 2 W1 自举会话派发**（窗口 2026-04-27 → 05-03）：
   - 输入：本 schema v1.0 + `projects/wiki/data/extracted/categorized/character_data.txt`（72 条原始数据）
   - 产出：`projects/wiki/data/db/characters.json` ⚠（72 条 `status: partial` 记录骨架）
   - 工作量预估：**4–6 小时子代理会话**（含 Lua 源二次交叉校验 + 72 条 slug 命名 + 3 条 bug 标记 + CI schema 校验通过）
   - **拆分策略**：3 批 × 24 角色（规避单次 Write timeout，结合 P2W1D1 两次 timeout 教训，见 `lessons-learned.md` #26）
   - **3 批建议分组**（按界域平衡工作量）：
     - 批 1（24 角色）：Aequor 主干 + 跨界 1 期
     - 批 2（24 角色）：Caro 主干 + 跨界 2 期
     - 批 3（24 角色）：Ultra 主干 + 皮肤/联动/彩蛋残余
   - **每批验收**：子代理产出后本会话校验 schema + 去重 ID → 通过后合并到 characters.json

3. **Phase 2 W2（05-04 → 05-10）**：填充 11 个易补角色的技能 / 背景故事，评估 `projects/wiki/data/extracted/` 中 localization 文件（Q2 承接）

4. **Phase 2 W3（05-11 → 05-17）**：UI 实装时回收 `commune.tier` 上限（Q4 承接）

---

> v1.0 为 Phase 2 W1 自举会话的权威输入。v0.1 历史版本见本文件版本沿革节。
