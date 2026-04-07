# Morimens 美术资产提取（完整版）

> 提取日期：2026-04-07
> 提取方式：UnityPy + UnityCN AES-128 解密 (key: `d111859c344a467e`)
> **本次为全量重提取**：覆盖 StreamingAssets（基础包）+ DownLoad（热更包）

## 概览

从 **19,170 个 AssetBundle** 文件中提取出 **18,795 张唯一图片**（5.00 GB），零错误。

数据来源：
- `Morimens_Data/StreamingAssets/artres/` — 基础游戏资产（15,557 AB，6.4 GB）
- `_game_data_/DownLoad/artres/` — 热更新增量包（3,613 AB，1.6 GB）

## 资产分类

| 类别 | 数量 | 大小 | 说明 |
|------|------|------|------|
| **portraits** | **4,153** | **1029 MB** | 角色立绘（全身/半身/头像7种规格） |
| **uiresources** | **3,029** | **1308 MB** | UI 大图资源 |
| **icon** | **2,690** | **352 MB** | 图标（职业/副本/表情/道具等30+子类） |
| **effects** | **6,091** | **338 MB** | 特效贴图 |
| **scenebg** | **242** | **573 MB** | 场景背景 |
| **bscene** | **519** | **238 MB** | 战斗场景 |
| **bunit** | **318** | **169 MB** | 战斗单位 |
| **mscene** | **75** | **138 MB** | 主场景 |
| **portrait** | **332** | **105 MB** | 卡面立绘 |
| **cg** | **404** | **701 MB** | CG 插图 |
| **ascene** | **117** | **40 MB** | A 类场景 |
| **spineportraits** | **16** | **43 MB** | Spine 动态立绘贴图 |
| **sprite2textures** | **116** | **34 MB** | 精灵图集 |
| 其他 | 477 | 47 MB | UI、munit、langres、scenecommon 等 |
| **合计** | **18,795** | **5.00 GB** | |

## 立绘子分类 (portraits/)

| 子目录 | 数量 | 说明 |
|--------|------|------|
| circularhead | ~700 | 圆形头像 |
| full | ~600 | 全身立绘 |
| fullhead | ~600 | 全身+头像 |
| middle | ~700 | 半身立绘 |
| middleface | ~600 | 半身面部 |
| minihead | ~500 | 迷你头像 |
| miniface | ~450 | 迷你面部 |

## 文件说明

- `manifest.json` (2.6 MB) — 完整资产清单（18,795 条），包含每张图的路径、名称、文件大小
- `../../../scripts/extract_art.py` — 提取脚本（需要 UnityPy + Pillow）

## 已知限制

- ✅ **客户端美术资产已 100% 提取**（19,170 个 AB 全部成功，零错误）
- ❌ **角色 ID ↔ 立绘文件名映射缺失**：游戏内通过 `IconResource` 字段引用立绘，但该字段在 LuaT0 字节码常量表中以索引形式存储，运行时字符串扫描丢失了引用关系。需要 DLL 注入运行时遍历 Lua 表才能恢复
- ❌ Spine 动态立绘的动画数据（.skel.bytes）未提取，仅有静态贴图
- 图片为 PNG 格式，保留原始透明通道

## 复现方法

```bash
pip install UnityPy Pillow
python scripts/extract_art.py
```

资产体积过大（5 GB）不放在 git 仓库中，本仓库只保留 manifest 和提取脚本。原始 PNG 文件存储在制作人本地 `Morimens_Extracted/art_assets/` 目录。
