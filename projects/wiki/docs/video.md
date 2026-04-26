# 视频资产索引

> 数据来源：Morimens_Data/StreamingAssets/Video/ | 共 201 个 MP4 文件（975 MB）

## 概述

游戏内过场动画、CG 动画及特效视频均以 MP4 格式存储于客户端 `StreamingAssets/Video/` 目录。
本索引涵盖完整的 201 个视频文件。

## 视频分类

| 分类 | 文件名模式 | 说明 |
|------|-----------|------|
| 章节过场（Chapter Cutscenes） | `C00 - C09, C202 - C203` | 主线剧情各章节的过场动画，涵盖序章至第九章及特殊章节 C202、C203。 |
| CG_SD 动画 | `CG_SD_*` | SD（Super Deformed）风格角色动画片段。 |
| 战斗特效 | `Battle Effects` | 战斗系统中使用的视觉特效动画。 |
| 登录 PV | `Login PV` | 游戏启动及登录界面播放的宣传影片。 |
| Logo 动画 | `Logo` | 游戏 Logo 展示动画。 |
| GN_Switch 过渡 | `GN_Switch_*` | 场景或界面切换过渡动画。 |
| RD 场景 | `RD_*` | 研发/演出相关场景视频。 |
| Vx 视频 | `Vx_*` | 版本更新相关宣传或演示视频。 |
| AVG UI 过渡 | `AVG UI Transitions` | AVG（文字冒险）模式中界面过渡动画效果。 |

## 下载

全部 201 个 MP4 文件（总计 975 MB）发布于 [GitHub Releases `video-assets-v1`](https://github.com/lightproud/brain-in-a-vat/releases/tag/video-assets-v1)。

## 技术说明

- 格式：MP4（H.264 编码）
- 来源路径：`Morimens_Data/StreamingAssets/Video/`
- 文件为客户端原始资产，未经二次编码
- 文件名前缀对应游戏内调用标识，可与 Lua 脚本中的视频播放指令关联
