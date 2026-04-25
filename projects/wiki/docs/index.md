---
layout: home
hero:
  name: 忘却前夜 Wiki
  text: 客户端数据提取资料站
  tagline: 基于 LuaT0 运行时内存扫描 + UnityPy AssetBundle 解密，从游戏客户端直接提取的一手数据
  actions:
    - theme: brand
      text: 唤醒体图鉴
      link: /characters
    - theme: alt
      text: CG 画廊
      link: /cg-gallery
    - theme: alt
      text: 唤醒系统
      link: /summon
    - theme: alt
      text: 收藏馆百科
      link: /collection-hall
features:
  - title: 唤醒体图鉴
    details: 72 位唤醒体完整资料（名称/声优/画师/生日/战斗特征/召唤台词）
  - title: 唤醒系统
    details: 366 个卡池记录，含 SSR/SR/R 概率与保底机制
  - title: 关卡导航
    details: 985 个关卡组 / 5,709 个关卡，按类型分类浏览
  - title: CG 画廊
    details: 404 张 CG 插图，按主线章节分组 + 20 张场景背景 + Q版 SD CG
  - title: 角色立绘
    details: 478 张角色立绘，7 种规格（全身/半身/圆形头像/迷你头像等）
  - title: 语音台词
    details: 2,543 条角色语音，含台词全文与解锁条件
  - title: 收藏馆百科
    details: 1,026 条收藏馆词条，涵盖世界观设定、生物图鉴、组织机构
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
