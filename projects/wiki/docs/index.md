---
layout: home
hero:
  name: 忘却前夜 Wiki
  text: 客户端数据提取资料站
  tagline: 基于 LuaT0 运行时内存扫描 + UnityPy AssetBundle 解密，从游戏客户端直接提取的一手数据
  actions:
    - theme: brand
      text: CG 画廊
      link: /cg-gallery
    - theme: alt
      text: 角色立绘
      link: /portraits
    - theme: alt
      text: 语音台词
      link: /voice-lines
    - theme: alt
      text: 收藏馆百科
      link: /collection-hall
features:
  - title: CG 画廊
    details: 404 张 CG 插图，按主线章节分组 + 20 张场景背景 + Q版 SD CG
  - title: 角色立绘
    details: 478 张角色立绘，7 种规格（全身/半身/圆形头像/迷你头像等）
  - title: 战斗单位
    details: 317 张战斗单位贴图，含唤醒体、守护者、怪物
  - title: UI 资源
    details: 521 张 UI 大图，含卡面立绘、召唤、活动、章节背景等
  - title: 语音台词
    details: 2,543 条角色语音，含台词全文与解锁条件
  - title: 收藏馆百科
    details: 1,026 条收藏馆词条，涵盖世界观设定、生物图鉴、组织机构
  - title: 图标
    details: 169 个图标（职业/副本/表情/道具/命轮等）
  - title: 道具背景故事
    details: 375 条命轮、密契、钥令等道具的叙事文本
---

## 数据来源

所有数据均从忘却前夜客户端 v2.4.0 直接提取，不依赖第三方 Wiki 或社区整理。

| 来源 | 方法 | 数据量 |
|------|------|--------|
| Lua 配置表 | 运行时内存字符串扫描 | 24 表 / 113,337 条目 |
| 美术资产 | UnityPy + UnityCN AES-128 解密 | 18,795 张图片 / 5 GB |

提取日期：2026-04-07
