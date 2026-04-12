---
layout: home
hero:
  name: 忘却前夜 Wiki
  text: 客户端数据提取资料站
  tagline: 基于 LuaT0 运行时内存扫描 + UnityPy AssetBundle 解密，从游戏客户端直接提取的一手数据
  actions:
    - theme: brand
      text: 语音台词
      link: /voice-lines
    - theme: alt
      text: 收藏馆百科
      link: /collection-hall
    - theme: alt
      text: CG 画廊
      link: /cg-gallery
    - theme: alt
      text: 道具背景故事
      link: /item-stories
features:
  - title: 语音台词
    details: 2,543 条角色语音，含台词全文与解锁条件，覆盖闲话、战斗、触摸等场景
  - title: 收藏馆百科
    details: 1,026 条收藏馆词条，涵盖世界观设定、生物图鉴、组织机构、游戏概念
  - title: CG 画廊
    details: 404 张 CG 插图索引，按主线章节分组（第一部序章至第八章 + 第二部至第四章）
  - title: 道具背景故事
    details: 375 条命轮、密契、钥令等道具的叙事文本，来自 Item.lua 的 StoryDesc 字段
---

## 数据来源

所有数据均从忘却前夜客户端 v2.4.0 直接提取，不依赖第三方 Wiki 或社区整理。

| 来源 | 方法 | 数据量 |
|------|------|--------|
| Lua 配置表 | 运行时内存字符串扫描 | 24 表 / 113,337 条目 |
| 美术资产 | UnityPy + UnityCN AES-128 解密 | 18,795 张图片 / 5 GB |

提取日期：2026-04-07
