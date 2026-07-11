# Morimens 客户端数据提取（wiki 侧独占残件）

> 提取日期：2026-04-07
> 提取方式：运行时内存扫描 + AssetBundle 解密
> 游戏版本：忘却前夜 (Tuanjie Engine 2022.3.61t8)
>
> **⚠ 去重改指（2026-07-11 仓库精简裁定项 4，乙案）**：原存于本目录的
> `lua_tables/`（24 个还原 Lua 配置表）与 `categorized/` 主体（12 个分类 txt）
> 与 `Public-Info-Pool/Reference/Game-Unpacked/` 内容完全重复（同哈希，仅文件名不同），
> 已删除本侧副本；**唯一本体**在 `Public-Info-Pool/Reference/Game-Unpacked/`
>（`Lua表还原/` 同名对应 lua_tables，`全部游戏数据/` 中文名对应 categorized，
> 对照如 `character_data.txt` = `角色数据_AwakerConfig.txt`、
> `collection_story.txt` = `收藏馆_CollectionHall.txt`）。
> 顶层 `scripts/parse_*.py` 与 `scripts/build_story_layer.py` 已改指本体路径。
> 本目录只保留 Game-Unpacked 没有的 wiki 侧独占件（见下）。

## 数据来源

游戏使用 **LuaT0** 自定义字节码格式（Lua 5.4 变体，format byte 0x30），配合 Themida 加壳保护解密算法。
由于字节码加密无法静态破解，数据通过以下方式提取：

1. **UnityCN AssetBundle AES-128 解密** — 提取 `.ab` 包中的 LuaT0 字节码文件
2. **运行时内存扫描** — 从 Lua VM 字符串表中提取已解密的字符串数据
3. **结构化重建** — 根据 `TableName_ID_Field|Value` 模式还原 Lua 表结构

## 本目录现存内容（独占件）

- `art_assets/` — 美术资产清单与 manifest（`scripts/parse_cg_gallery.py` 消费）
- `categorized/numeric_config.txt` — 数值配置（66,517 行，Game-Unpacked 无对应件）
- `categorized/asset_references.txt` — 资源引用路径（Game-Unpacked 无对应件）

## 已迁本体的原内容速查（在 Game-Unpacked 找）

- 24 个还原 Lua 配置表（AwakerConfig / Item / Stage / Task / Voice / CollectionHall /
  UpdateNotices 等，共 113,337 条目）→ `Public-Info-Pool/Reference/Game-Unpacked/Lua表还原/`
- 12 个分类文本（角色 / 道具 / 关卡任务 / 语音 / 抽卡 / 收藏剧情 / 配置 / 键值 / UI /
  更新公告 / 技能战斗 / 未分类中文）→ `Public-Info-Pool/Reference/Game-Unpacked/全部游戏数据/`

## 已知限制

- **纯数值数据缺失**：整数/浮点数值（HP、ATK、伤害倍率等）存储在 Lua 字节码的常量表中，不在字符串表内，因此未被内存字符串扫描捕获
- **字段名推断**：Lua 表的字段名基于 `TableName_ID_Field|Value` 命名模式推断，可能存在个别不准确
- **LuaT0 加密未破解**：字节码体的加密算法受 Themida 保护，无法进行完整的字节码反编译
