# Morimens 客户端数据提取

> 提取日期：2026-04-07
> 提取方式：运行时内存扫描 + AssetBundle 解密
> 游戏版本：忘却前夜 (Tuanjie Engine 2022.3.61t8)

## 数据来源

游戏使用 **LuaT0** 自定义字节码格式（Lua 5.4 变体，format byte 0x30），配合 Themida 加壳保护解密算法。
由于字节码加密无法静态破解，数据通过以下方式提取：

1. **UnityCN AssetBundle AES-128 解密** — 提取 `.ab` 包中的 LuaT0 字节码文件
2. **运行时内存扫描** — 从 Lua VM 字符串表中提取已解密的字符串数据
3. **结构化重建** — 根据 `TableName_ID_Field|Value` 模式还原 Lua 表结构

## 目录结构

### `lua_tables/` — 还原的 Lua 配置表（24 个文件，113,337 条目）

从内存提取的字符串数据中，根据命名模式还原的游戏配置表：

| 文件 | 条目数 | 内容 |
|------|--------|------|
| AwakerConfig.lua | 72 | 角色基础数据（姓名、年龄、身高、体重、性别、画师、声优） |
| AwakerPotency.lua | 1,035 | 角色潜能/技能描述（含数值嵌入文本） |
| Item.lua | 3,774 | 道具（名称、描述、剧情描述） |
| Stage.lua | 5,709 | 关卡（名称、描述） |
| Task.lua | 6,317 | 任务（名称、描述、完成条件） |
| Summon.lua | 366 | 召唤/抽卡（概率、描述） |
| Voice.lua | 2,562 | 语音（台词内容、解锁描述） |
| CollectionHall.lua | 1,026 | 收藏馆 |
| GameConfig_References.lua | 33,334 | 游戏配置引用（`Category@Detail` 格式） |
| UpdateNotices.lua | 2,697 | 更新公告 |
| 其他14个表 | — | Lead, Lottery, PVPRank, PanelText, SchoolConfig 等 |

### `categorized/` — 分类文本数据（14 个文件）

从全量内存提取中按类别整理的原始数据：

| 文件 | 行数 | 内容 |
|------|------|------|
| character_data.txt | 2,188 | 角色相关数据 |
| item_data.txt | 8,532 | 道具数据 |
| stage_quest.txt | 22,503 | 关卡与任务 |
| voice_data.txt | 5,882 | 语音数据 |
| summon_gacha.txt | 2,712 | 抽卡系统 |
| collection_story.txt | 2,598 | 收藏/剧情 |
| game_config_at.txt | 39,541 | 游戏配置（@引用格式） |
| game_kv.txt | 13,501 | 键值对配置 |
| ui_text.txt | 6,969 | UI 文本 |
| update_notices.txt | 2,697 | 更新公告 |
| skill_battle.txt | — | 技能/战斗相关 |
| numeric_config.txt | 66,517 | 数值配置 |
| asset_references.txt | — | 资源引用路径 |
| other_chinese.txt | 30,415 | 未分类中文文本 |

## 已知限制

- **纯数值数据缺失**：整数/浮点数值（HP、ATK、伤害倍率等）存储在 Lua 字节码的常量表中，不在字符串表内，因此未被内存字符串扫描捕获
- **字段名推断**：Lua 表的字段名基于 `TableName_ID_Field|Value` 命名模式推断，可能存在个别不准确
- **LuaT0 加密未破解**：字节码体的加密算法受 Themida 保护，无法进行完整的字节码反编译

## 后续计划

- [ ] 运行时 Lua table 遍历（DLL 注入方式获取完整数值数据）
- [ ] 美术资产提取（15,557 个 AB 文件，6.4GB）
- [ ] 与现有 `db/*.json` 数据库交叉验证和合并
