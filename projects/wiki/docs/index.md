---
layout: home
hero:
  name: 忘却前夜 Wiki
  text: 唤醒体 · 玩法 · 世界观
  tagline: 克苏鲁题材 Roguelite 卡牌的一手资料站——客户端解包数据 + 社区玩法考据，由银芯知识层维护
  actions:
    - theme: brand
      text: 唤醒体图鉴
      link: /characters
    - theme: alt
      text: 玩法图鉴
      link: /playstyle
    - theme: alt
      text: 战斗机制
      link: /battle-system
    - theme: alt
      text: 剧情考据
      link: /lore-research
features:
  - title: 58 位可玩唤醒体
    details: 按混沌 / 深海 / 血肉 / 超维四界域分组，每位独立详情页（档案 + 界域定位 + 玩法 + 召唤台词）。分类经逐一确认，未上线与彩蛋单独标注。
    link: /characters
    linkText: 进入图鉴
  - title: 玩法图鉴
    details: 每位唤醒体的界域 / 定位 / 核心循环 / 招牌技能 / 狂气爆发 / 启灵关键 / 配队，社区攻略考据汇编。
    link: /playstyle
    linkText: 看怎么玩
  - title: 战斗机制总览
    details: 指令卡 + 灵知觉醒、算力、狂气与超限爆发、四界域体系、命轮——新手到进阶的系统说明。
    link: /battle-system
    linkText: 读机制
  - title: 剧情与世界观
    details: 忘却篇 + 星辰篇剧情时间线、终章真相、克苏鲁神话原型对照、深度考据综述（带置信标签与来源）。
    link: /lore-research
    linkText: 入坑世界观
  - title: 收藏馆百科
    details: 1,026 条收藏馆词条，涵盖世界观设定、生物图鉴、组织机构。
    link: /collection-hall
    linkText: 翻百科
  - title: CG 画廊 · 立绘
    details: 404 张 CG 插图按主线章节分组 + 478 张角色立绘（7 种规格）。
    link: /cg-gallery
    linkText: 看画
  - title: 语音台词
    details: 2,543 条角色语音，含台词全文与解锁条件。
    link: /voice-lines
    linkText: 听台词
  - title: 唤醒系统
    details: 366 个卡池记录，含 SSR / SR / R 概率与保底机制。
    link: /summon
    linkText: 查卡池
---

## 四界域

唤醒体按界域划分玩法体系，混沌可与任意界域混编：

<p class="realm-legend">
<span class="realm-badge realm-chaos">混沌</span> 可与任意界域混编 · 反击 / 打击 / 过牌<br>
<span class="realm-badge realm-aequor">深海</span> 触腕体系 · 深渊号令<br>
<span class="realm-badge realm-caro">血肉</span> 日服译「狂魔」· 胚胎 / 中毒 / 卖血<br>
<span class="realm-badge realm-ultra">超维</span> 超维空间 · 额外回合 / 斩杀
</p>

## 数据来源

本站为忘却前夜 (Morimens) **非官方**资料站，由银芯知识层维护，数据分两类血缘：

| 类别 | 来源 | 说明 |
|------|------|------|
| 解包一手数据 | 客户端 Lua 运行时内存扫描 + UnityPy 资产解密 | 角色档案 / 语音 / CG / 立绘 / 收藏馆 / 关卡，提取自客户端 v2.4.0 |
| 社区玩法考据 | GameKee / 灰机wiki / 巴哈姆特 / 九游 等社区攻略 | 技能玩法卡、界域归属、配队——**非解包**，数值随版本浮动，采信前核当前版本 |

::: tip 为什么玩法是社区源
角色技能的结构化数据（`skill_battle`）在客户端里是空壳，是已知的解包缺口。所以「怎么玩」只能依据社区攻略考据，并与解包档案交叉印证。两类数据在页面上分别标注，不混用。
:::
