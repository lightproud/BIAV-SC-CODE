# Morimens 美术资产提取

> 提取日期：2026-04-07
> 提取方式：UnityPy + UnityCN AES-128 解密 (key: `d111859c344a467e`)

## 概览

从游戏安装目录 `_game_data_/DownLoad/artres/` 的 3,613 个 AssetBundle 文件中提取出 **5,218 张唯一图片**（943 MB），零错误。

## 资产分类

| 类别 | 数量 | 大小 | 说明 |
|------|------|------|------|
| portraits | 478 | 133 MB | 角色立绘（全身/半身/头像/圆头像等7种规格） |
| portrait/card | 30 | 10 MB | 卡面立绘 |
| cg | 38 | 73 MB | CG 插图（第203-205章 + SD） |
| scenebg | 20 | 56 MB | 场景背景 |
| bunit | 317 | 169 MB | 战斗单位（觉醒者/守护者/怪物） |
| uiresources | 491 | 240 MB | UI 大图资源 |
| icon | 169 | 29 MB | 图标（职业/副本/表情/道具等30+子类） |
| effects | 3,340 | 196 MB | 特效贴图 |
| ui | 209 | 3 MB | UI 精灵图集 |
| spineportraits | 3 | 9 MB | Spine 动态立绘 |
| 其他 | 123 | 25 MB | 场景、时间轴、语言包等 |

## 立绘子分类 (portraits/)

| 子目录 | 说明 |
|--------|------|
| full | 全身立绘 |
| middle | 半身立绘 |
| fullhead | 全身+头部 |
| middleface | 半身面部 |
| circularhead | 圆形头像 |
| minihead | 迷你头像 |
| miniface | 迷你面部 |

## 文件说明

- `manifest.json` — 完整资产清单（5,218 条），包含每张图的路径、名称、文件大小
- `../../scripts/extract_art.py` — 提取脚本（需要 UnityPy + Pillow）

## 已知限制

- 仅提取了客户端**已下载**的资产（非全量，全量需 15,557 个 AB 约 6.4 GB）
- CG 仅包含最近更新的章节（c203-c205 + SD），早期章节 CG 需重新下载
- Spine 动态立绘仅提取了静态贴图，动画数据（.skel.bytes）未提取
- 图片为 PNG 格式，保留原始透明通道

## 复现方法

```bash
pip install UnityPy Pillow
python scripts/extract_art.py
```
