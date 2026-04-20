# Wiki characters.json Schema 草案 v0.1

> 最后更新：2026-04-20 by 主控台（艾瑞卡会话，P2W1D1/P2W1D1-retry 子代理两次 Write timeout 后由主控台直接起草）
>
> 状态：**草案**，待主控台 + 守密人审核通过后方能派发正式 72 角色批量自举会话。
>
> 上游依据：
> - `memory/wiki-phase-2-gap-inventory.md`（B3 权威清单：72 角色、29/29 命轮全缺、立绘/背景故事/技能引导缺口）
> - `memory/decisions.md`（界域/职能/slug 标准化历史决策）
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
    "required": [
      "id", "slug", "name_zh", "realm", "role",
      "status", "source", "last_verified"
    ],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^15[0-9]{3}$",
        "description": "游戏内数字 ID（字符串形态，5 位数，前缀 15）"
      },
      "slug": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9_]*$",
        "description": "英文 lowercase_snake_case，跨语 URL 稳定键"
      },
      "name_zh": { "type": "string", "minLength": 1 },
      "name_en": { "type": ["string", "null"] },
      "name_ja": { "type": ["string", "null"] },
      "title_zh": { "type": ["string", "null"] },
      "realm": {
        "type": "string",
        "enum": ["aequor", "caro", "ultra"],
        "description": "界域 ID 标准化（决策 2026-03）"
      },
      "role": {
        "type": "string",
        "enum": ["attack", "sub_attack", "defense", "support", "chorus"],
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
                    "tier": { "type": "integer", "minimum": 1, "maximum": 6 },
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
        "oneOf": [
          { "type": "null" },
          { "const": "pending" },
          { "type": "string" }
        ],
        "description": "背景故事缺口：Phase 2 W3 填充"
      },
      "portraits": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "default": { "type": ["string", "null"], "description": "相对于 assets/images/portraits/ 的路径" },
          "awaker": { "type": ["string", "null"] },
          "skins": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "path"],
              "properties": {
                "id": { "type": "string" },
                "name": { "type": ["string", "null"] },
                "path": { "type": "string" }
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
              "duplicate_of": { "type": "string", "pattern": "^15[0-9]{3}$" },
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

## 五、遗留问题（交主控台 / 守密人决议）

1. **詹金 15578 vs 15593 的记录策略**：
   - 方案 A（已采用）：保留两条独立记录，用 `duplicate_bug` 互指
   - 方案 B：合并为一条，额外用 `alternate_ids: []` 字段
   - 建议：采用 A（保真于游戏数据，便于未来数据修复后拆分）

2. **`name_en` / `name_ja` 翻译来源**：
   - 官方 localization 文件是否可提取？（待 Phase 2 W2 评估 `projects/wiki/data/extracted/` 中的 text table 文件）
   - 社区译名 vs 官方译名的优先级

3. **立绘文件存储路径规范**：
   - 建议：`assets/images/portraits/{slug}/default.png` / `assets/images/portraits/{slug}/awaker.png` / `assets/images/portraits/{slug}/skins/{skin_id}.png`
   - 命名键与 `slug` 字段锁定，避免 ID 改动时整体重命名

4. **命轮（commune）的 tier 上限**：
   - 当前写的是 1–6；B3 清单未明确，需交叉游戏内实际 node 层数

5. **`gi` 字段的规整化**：
   - 原始数据混用 `"23.67"` / `"？"` / `"无法估测"` 等；是否需额外 `gi_numeric` 字段供排序？本版暂未纳入，Phase 2 UI 实装时再评估

6. **`status` 字段 stub 的使用场景**：
   - 当前三条示例均为 `partial`；新增角色（Phase 2 后期版本更新）可能仅有 ID + 名字，此时用 `stub`；需在 CI validator 中允许 stub 状态下跳过多个 required 字段吗？本版暂按严格模式（8 项 required 永远必填），stub 状态下其他字段填最低骨架（`realm: null` / `role: null` 需放宽 schema enum）——**此为遗留问题，v0.2 决议**

## 六、下一步

1. **主控台审阅**：本草案以覆盖 B3 全部缺口为目标，字段完整度优先于字段繁多
2. **守密人裁决**：对第五节 6 项遗留问题给出方向
3. **锁定 schema v1.0**：将裁决写入 `memory/decisions.md`，本文档更名为 `memory/wiki-characters-schema-v1.md` ⚠（待升级）或升级元数据
4. **派发 P2W1W1 正式批量自举会话**：
   - 输入：schema v1.0 + `character_data.txt`（72 条原始数据）
   - 产出：`projects/wiki/data/db/characters.json` ⚠（72 条 `status: partial` 记录骨架，Phase 2 W1 自举目标）
   - 工作量预估：**4–6 小时子代理会话**（含 Lua 源二次交叉校验 + 72 条 slug 命名 + 3 条 bug 标记 + CI schema 校验通过）
   - 建议拆分为 3 批（每批 24 角色），规避单次 Write timeout 风险（结合 P2W1D1 两次 timeout 教训）

---

> 本草案为 v0.1。Phase 2 Week 1 窗口内（2026-04-27 → 05-03）完成审核与 v1.0 锁定后启动正式批量自举。
