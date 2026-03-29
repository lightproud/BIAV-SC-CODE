# 术语库校准变更记录

校准日期：2026-03-29
校准执行：Claude Code（Issue #44）
来源优先级：游戏内英文文本 > 项目内英文 Wiki 文档 (`projects/wiki/docs/en/`)

---

## terminology.json 变更

| 中文 | 旧英文 | 新英文 | 来源 |
|------|--------|--------|------|
| 唤醒体 | Awakened One | Awakener | 游戏内文本（Issue #44 确认） |
| 守密人 | Secret Keeper | Keeper | 游戏内文本（Issue #44 确认） |
| 命轮 | Constellation / Eidolon | Wheel of Destiny | 游戏内文本（Issue #44 确认）；本地 wiki `wheels/index.md` 亦确认 |
| 专造 | Signature Weapon | Enlighten | 游戏内文本（Issue #44 确认） |
| 灵知制剂 | Gnosis Reagent | Gnosis Primer | 游戏内文本（Issue #44 确认） |
| 流明之芯 | Lumen Core | Luminous Core | 游戏内文本（Issue #44 确认）；本地 wiki `items/currency.md` 亦确认 |
| 融灾 | Meltdown | Dissolution | 游戏内文本（Issue #44 确认） |
| 融蚀 | Erosion | Dissolution | 游戏内文本（Issue #44 确认，官方亦用 "Melt and Erosion"） |
| 狂气 | Fury | Madness | 游戏内文本（Issue #44 确认）；本地 wiki `modes/combat.md` 亦确认 |
| 狂气爆发 | Fury Burst | Madness Burst | 游戏内文本（Issue #44 确认）；本地 wiki `modes/combat.md` 亦确认 |
| 相位 | Phase | Traphase | 游戏内文本（Issue #44 确认） |
| 银芯 | Silver Core | Silver | 游戏内文本（Issue #44 确认）；本地 wiki `items/currency.md` 亦确认 |
| 弥萨格大学 | Miskatonic University | Mythag University | 游戏内文本（Issue #44 确认） |
| 幻梦深潜 | Dream Dive | Psyche Deepdive | 游戏内文本（Issue #44 确认） |
| 密契 | Bond / Covenant | Sacred Covenant | 游戏内文本（Issue #44 确认） |
| 超限爆发 | Transcendence Burst | Reproduction Frenzy | 游戏内文本（Issue #44 确认） |
| 算力 | Computing Power | Computation | 游戏内文本（Issue #44 确认）；注：本地 wiki 使用 "Arithmetica"，以游戏文本为准 |
| 钥令 | Key Command | Key Order | 本地 wiki `key-orders/index.md`（`Key Orders (钥令)` 明确标注） |
| 刻印 | Engrave / Imprint | Engravings | 本地 wiki `engravings/index.md`（`Engravings (刻印)` 明确标注） |
| 灵啡肽 | Spirit Caffeine | Menophine | 本地 wiki `items/currency.md`（`Menophine \| Stamina/action resource` 明确标注） |

## 无变更条目（已正确）

| 中文 | 英文 | 备注 |
|------|------|------|
| 无垢之芯 | Pure Core | Issue #44 确认正确 |
| 灵之觉醒牌 | Spirit Awakening Card | 本地 wiki `modes/combat.md` 确认正确 |

## 标注为 unconfirmed 的条目

以下条目未能从游戏内文本或可靠来源找到确认的官方英文翻译，保留现有翻译并在 JSON 中添加 `"en_status": "unconfirmed"` 标记：

| 中文 | 当前英文（保留） | 说明 |
|------|-----------------|------|
| 灵知深化 | Gnosis Enhancement | 未找到官方来源确认 |
| 造物 | Artifact / Relic | 未找到官方来源确认；本地 wiki `items/creations.md` 中 "Creations" 指锻造房产物，疑为不同系统 |

---

## realms.json 变更

| 界域（中文） | 旧 name_en | 新 name_en | 来源 |
|-------------|-----------|-----------|------|
| 深海 | Deep Sea | Aequor | 本地 wiki `realms/index.md`（`Aequor (深海)` 明确标注） |
| 血肉 | Flesh | Caro | 本地 wiki `realms/index.md`（`Caro (血肉)` 明确标注） |
| 超维 | Hyperdimension | Ultra | 本地 wiki `realms/index.md`（`Ultra (超维)` 明确标注） |
| 混沌 | Chaos | Chaos | 无变更，已正确 |

---

## characters.json 检查结果

对照本地 wiki `awakeners/list.md` 逐一核查角色英文名，未发现需要修正的条目。已确认的角色名（部分）：Alva、Doll、Ogier、Lotan、Ramona、Ramona: Timeworn、Pandya、Nodera、Galen、Nymphia、Lily、Danmo、Miryam、Tulu、Divine King Tulu、Celeste、Goliath、Shan、Aurita、Caecus、Faros、Uvhash、Rhea 等均与本地 wiki 一致。

> **注意**：由于无法访问 Fandom Wiki，角色名核查以项目内本地英文 Wiki 文档为参考来源，未经游戏内文本直接确认。

---

## 备注

- Fandom Wiki（https://forget-last-night-morimens.fandom.com）在本次任务执行环境中无法访问，退而以项目内 `projects/wiki/docs/en/` 作为次级来源
- `算力` 存在争议：游戏内英文文本为 "Computation"（Issue #44），而本地 wiki 使用 "Arithmetica"；以游戏内文本为准
- `融灾黑潮` 的英文 "Erosion Black Tide" 未列入本次校准范围，建议后续复核（因 `融蚀` 和 `融灾` 的英文均已更新为 Dissolution）
