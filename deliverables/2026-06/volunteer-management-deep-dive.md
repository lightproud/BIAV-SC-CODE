# 忘却前夜翻译志愿者社区 · 志愿者管理深度洞察报告

> 数据底座：全量档案层 `projects/news/data/discord/guilds/1402537664619479100/`
> 9,628 条消息 / 71 名活跃作者 / 15 个有效频道 / 2025-08-06 至 2026-06-16
> 方法：动态编排 5 个并行分析 agent，各回原始 JSONL 深挖一个维度，引用逐字、日期可复核（遵 §4 数据纪律：全量层口径，reaction 数取自 `reactions[].count`，未外推）
> 用途：Studio 自有志愿者社区的内部管理；未触及黑池/内部数据（§3.1 合规）
> 身份对照：`morimens_15`/`ace_asteria_lan`=官方主管 Ace(Mia)；`omnichromia`=社区自封协调员 Mercy；`arkaether`=EN 核心 Lens；`lightproud`=制作人 Light

---

## 执行摘要

这是一支**高知自驱、靠「热爱 + 被看见」维系的精英翻译志愿军**，质量极高但结构极脆。一句话定性：**质量不缺，缺的是「让人能持续干活」的供给与冗余**——项目压在 3 个人身上（官方 Ace + 志愿者 omnichromia + arkaether），11 个语种里已有 5 个停摆、4 个衰退，而最大的士气杀手不是氛围，是「努力被系统性作废」。

四条贯穿全报告的主结论：

1. **巴士因子 ≈ 1–2，红灯刚闪过**：志愿者翻译「进游戏」的唯一通道是官方账号 Ace，她 9 个月内多次因健康停摆，2026-06-14 omnichromia 公开拉警报「失联近一月」，2026-06-16（今天）Ace 才回归。模式是结构性的。
2. **两次产能塌方都是「可做之事被抽走」造成的，不是社区闹情绪**：2025-09「校对≠精修」定义落差 + EN 主线锁 → 断崖；2025-12 玩法文本 hard lock → 2026-01/02 归零。志愿者热情仍在，是任务供给断流逼走了人。
3. **留存货币是 recognition，不是钱**：39 份自我介绍无一提报酬；reaction 峰值全部落在署名/头像框/礼物/Light 露面（普通公告的 3–5 倍）。2026-05-15 的署名争议证明：recognition 政策任何收缩都立刻转化为士气波动。
4. **结构性「白干」写进了系统规则**：CN 源文一改，代码即自动删除人工译文换回 MTL（官方 2026-05-20 自述）——版本漂移导致的作废从偶发事故升级为必然，是损耗规模最大、最伤士气的病灶。

---

## 全局风险地图

| 风险 | 等级 | 触发证据 | 一旦发生 |
|---|---|---|---|
| Ace（官方入库通道）再次停摆 | **P0 致命** | 9 个月 ≥5 次健康停摆；2026-06-14 失联警报 | 全部志愿者成果进不了游戏 |
| omnichromia（协调基建）离场 | **P0 致命** | 一人扛 repo/编译/权限/教学，协调三频道 50% 发言 | onboarding、编译、版本对齐三链同断 |
| arkaether（EN 质量+带新人）离场 | **P1 高** | 发言量第一，独家运维新人试译 | EN 自治层塌方，复刻 DE/PT |
| 5 语种已停摆 + 4 衰退 | **P1 高** | DE/PT/FR/ES/繁中 停摆；KR/JP/TH/VN-ID 衰退 | 多语种全球化目标空心化 |
| 版本漂移自动回退 | **P1 高（结构性）** | 代码设计：改 CN 即删人工译文 | 持续放血、士气最大隐患 |
| recognition 政策收缩 | **P2 中** | 2026-05-15 停止点名引发质疑 | 戳中核心留存动机 |

---

# Part 1 · 单点故障 / 巴士因子 / 冗余化方案

> 比喻：这座翻译工地靠两根柱子撑着——一根是官方派来开门收货的 Ace，一根是志愿者里自己跳出来当工头的 omnichromia。任何一根折了，工地塌一半。

## 1.1 omnichromia（Mercy）职能全清单——一人搭了套平行协调基建

| 职能 | 证据（原文+日期） | 量化 |
|---|---|---|
| 自建并独家运维协调 GitHub 仓 | 2025-09-18「I've officially opened up my coordination repo」；2025-11-06 亲手改 Public→**Private**「only confirmed Collaborators」 | 访问名单只在她一人手里 |
| 切分源表（5万+行拆成可认领小块） | 2025-08-27「help chunk down the entire Gameplay sheet so that people don't have to slog through the 50k+ rows」 | 持续到 2026-05-11「finally finished Wheels of Destiny」 |
| 编译合并（拒用 pull-merge，纯手工） | 2026-04-03「I don't do pull-and-merge so other volunteers' work doesn't get overwritten」 | 全档 **33 条** `compil*`，coordination-uploads 反复「Compiled!」 |
| 手动放行权限（准入门控） | 2025-12-11「DM me and I'll add you as a contributor」 | 全档 **15 条**邀请/权限发言 |
| 教 git/GitHub（写教程+答疑） | 自己 2025-08-26「I've never used git or GitHub before」，转头成全村老师 | how-to-contribute **9 条全是她（100%）**，全档 18 条教学 |

**协调中枢发言占比**：project-coordination 49%、coordination-uploads 43%、how-to-contribute 100%；协调三频道合计 **50%**，且 Ace 在这三频道发言为 **0**——协调层与官方层完全脱钩，全压她一人。

她自我定位（2025-09-13）：「position myself as an **unofficial project coordinator**, to help lift some weight off of Ace's shoulders」——本意替单点 Ace 分担，结果把自己变成了第二个单点。

## 1.2 Ace（morimens_15）职能全清单——官方侧六合一总开关

Ace 全档 **594 条**。六项权力集于一个账号：
- **A 官方公告唯一出口**：announce 30/36 条；全档 26 次 @everyone。
- **B 把译文真正灌进游戏（compile→import→上线）**——最致命单点：志愿者翻完只有她能让它进游戏。2025-12-30「The compiling got delayed because of my health issues」。
- **C NDA/文件安全**：NDA/Docusign 相关 70 条；Drive 审批 18 条。
- **D 源文件发布**：源表更新 39 条。
- **E 终审/裁决**：术语与改动尺度靠她拍板（2025-08-28「Ace has to sign off on major term changes」）。
- **F 奖励/署名**：17 条。
- **G devs↔志愿者唯一桥**：Light 2026-04-20 亲证「Ace has been handling all the work communication here」。

## 1.3 Ace 健康/缺勤/失联完整时间线

| 日期 | 事件原文摘录 |
|---|---|
| 2025-09-01 | **首次住院**「I'm currently in the hospital **again**. I overworked myself」 |
| 2025-09-05 | 病假直接拖累入库「i won't be able to finish compiling the list + upload all volunteer translation」 |
| 2025-09-13 | 缺勤酿事故：住院期间 MTL 补丁把 Kath 全卡面人工译文回退机翻 |
| 2025-12-30 | 「The compiling got delayed because of my health issues」 |
| 2026-01-26 | 第二内部译者 Mia 也病假 |
| **2026-06-14** | omnichromia 公开警报「Has anyone heard from Ace lately? It's been almost a month… I know she's had health issues」 |
| **2026-06-16** | **Ace 复现**（失联约一月后回归）「we'll fix!!! …giving the texts another general go」 |

判断：失联危机本轮暂解（Ace 已回归），但这是 9 个月内 ≥5 次因健康导致入库停摆，**模式高度重复、风险是结构性的**。

## 1.4 冗余化方案（P0/P1）

**P0（救命，消除「进不了游戏」的致命单点）**
- **P0-1 设官方备份对接人**：指派第二名官方成员（内部译者 Mia 是天然首选；或 omnichromia 2026-05-19 点名的 kada/lyra）持同等入库+Drive 审批权限。需 Light 授权 + 共享凭证。
- **P0-2 协调仓权限去单点**：把 `omnichromia/morimens-volunteer-coordination` 迁到 GitHub Org，设 2–3 名 Owner（候选 arkaether、__goz__）。需 omnichromia 配合转移（纯后台操作）。

**P1（自动化与委派，给 omnichromia 减负）**
- **P1-1 编译自动化**：omnichromia 自己 2026-03-17 已设想「automatically update all the files… auto-compile」。用 GitHub Actions 做「按语言列定向合并」（只动该语言列，根除覆盖担忧）。
- **P1-2 教学/onboarding 委派**：arkaether（2760 条全场最高、已是 Mod、独家运维新人试译）接新人引导；__goz__（最硬核 git 知识者）接技术疑难与脚本实现。
- **P1-3 进度可见性**：要求官方侧也在同一 Ledger 登记在译内容（omnichromia 2026-05-19 痛点「Ace & Mia don't use that system」，导致撞车/重复劳动）。

---

# Part 2 · Recognition 作为核心留存货币

> 比喻：这群人是自己买票还留下来帮剧院修舞台的资深戏迷——给的奖状比工钱更留得住人；奖状一停，人嘴上不说、心里记账。

## 2.1 Recognition 事件全时间线（reaction 量化社区反应）

| 日期 | 事件 | 原文摘录 | Reaction |
|---|---|---|---|
| 2025-09-05 | Ace 病假+承诺更新 special thanks | 「update the special thanks list」 | **20** |
| 2025-09-22 | **专属头像框**首次官宣 + 邀志愿者翻框名 | 「Exclusive Avatar Frame for volunteer translators」 | **28**（最高）|
| 2025-10-23 | 头像框成品预览图 | 「A sneak peak at the exclusive avatar frame」 | **17** |
| 2025-12-26 | **圣诞礼：银 + 银芯(Silver Prime)** | 「gift in the form of Silver & Silver Prime for all volunteers」 | **24** |
| 2026-04-15 | Patch Preview（抢先看+署名首发） | 「new characters launch with real translations instead of MTL」 | 11+11 |
| **2026-05-15** | **Light 亲自@everyone 回应署名争议** | 「your names are credited there [in-game]… That's the mark we want to leave long-term」 | **22** |
| 2026-05-19 | V2.5.0 游戏内 Special Thanks 逐人列贡献 | 「omnichromia (Mercy) — Rewriting & Finalization」 | 触发即时改名诉求 |

**量化结论**：reaction 峰值全部落在 recognition 类（头像框 28 / 圣诞礼 24 / Light 露面 22 / 病假关怀 20 / 预览 17），是普通技术公告（r=0–6）的 **3–5 倍**。掌声诚实地标出了大家真正在乎什么。

## 2.2 2026-05-15 署名争议完整重建

**位置修正**：Light 的回应在 **general-discussion** 频道（非 announcements）。

- **触发**：早期公告会逐个 @点名致谢（见 2025-09-15，r=14），后来 Ace 悄悄停掉、无人解释，志愿者私下问「为什么不再点我们名字了」。
- **Light 回应要点**：① 认责「This was my decision」；② 承认沟通失误「I gradually phased that out **without communicating the change to you beforehand**. That was something I should have handled better」；③ 重定义渠道（译者→游戏内署名+头像框；Mod/创作者/答疑者/报bug者→各自形式，**仍在设计中**）；④ 价值锚点「**It was never the reason any of you chose to join**… There is only one form of repayment that's truly meaningful: making Morimens better」。
- **闭环**：承诺→兑现仅 4 天（5-19 游戏内名单逐人更新）。
- **直接退意者：零**；但同期 arkaether 暴露更深的结构性士气问题「EN isn't very active… ace does all the heavy lifting solo… we're not in the loop for what the official staff translators are doing」——**真正的留存风险不是「没被点名」，而是「看不到自己的工作进了游戏 / 不知道官方在做什么」**。

## 2.3 新人动机证据库（self-introductions 全量 39 条，无一提报酬）

三类来源高度集中：**职业译者/出版业**（theriddleofcards 13 年桌游 EN→RU、strandiel 德国出版社、darkerkuro 出版社校对）、**开发/技术**（kainoxis/zier.0 Unity 开发者、__goz__ 软件工程师）、**文学/学术母语者**（disgustedingucci 文学BA+应用语言学MA、omnichromia MTG 裁判）。

动机原文（论证 recognition > reward）：
- arkaether「a **cardinal sin** for such an incredible game to go overlooked… spread the word」
- mame_shirogane「deliver the detailed and beautiful storyline to passionate Japanese users」
- ev_6185「I admire how well written the cn version is… **deserves a proper translation**」
- lislium「a **win-win**: help a game I love reach more people while honing my translation skills」

高频词：deserves / reach the audience / spread the word / a game I love / win-win。**物质给不动他们，但被看见、作品进游戏、技能被认可能留住他们。**

## 2.4 Recognition 政策建议
1. **双轨永久署名继续强化**：游戏内 Special Thanks 逐人列**具体贡献内容**（比纯名字有分量）；常设自助改名通道（署名形式自主权本身就是认可）。
2. **填补「分层认可」的坑**（Light 5-15 承诺但未兑现）：Mod/答疑/报bug 者的认可物（专属角色徽章/年度贡献框）是当前最大空白。
3. **政策变更必须前置沟通 + 由 Light 亲自出面**：稀缺的高层露面本身是顶级 recognition 货币（一次 r=22 胜过 Ace 十条公告），省着用在关键节点。
4. **低成本高感知手段**（按 reaction 实证）：Patch Preview 抢先看（零成本、满足「被信任进内圈」）；节日游戏内货币礼（单位成本极低、情感回报极高）；出问题时高层认责式道歉。

---

# Part 3 · 结构性「白干」与高摩擦点（最大士气杀手）

## 3.1 术语表「查不到 / 被锁 / 审批卡门 / 被破坏」（≥18 名志愿者受影响）

- **表头锁+筛选器盖全表**（2025-09-20 标杆案）：arkaether「Ace applied a filter to only show rows with suggested changes… since the headers are locked, **none of us can restore it back to the full terms list**」，ev_6185 当场卡死「that's why I can't see it」。
- **审批卡门**（2025-08-22 病根供词）：Ace「it was set to 'only approved users' initially, then because **I often couldn't approve edit applications in time**, it was changed to 'anyone with the link'」——审批积压→被迫放开→埋下匿名乱改。project-coordination 2026-03~05 又有 ≥7 人排队「Can I request access please?」。
- **内容被破坏**（2025-09-23）：WoD 描述被错误粘贴到战斗提示行「will completely break the tooltips」；2026-05-14 新术语「didn't included in the sheets」。

## 3.2 版本漂移「白干」全实例（≥10 起，涉 EN/TH/JP 三队）

| 日期 | 谁 | 白干了什么 | 根因 |
|---|---|---|---|
| 2025-09-08~13 | arkaether | 逐行重写 Arc 1 主线（ch5+半个ch6），官方引入专业重译后作废「most of that effort was wasted anyway」 | 官方推倒重译 |
| 2025-09-13 | arkaether | Kath 全卡面人工译文在 MTL 补丁中回退 | 负责人住院期上线 MTL |
| 2025-11-17 | darkerkuro | 泰语已定稿卡名/术语被大版本更新冲回机翻 | 版本更新回退人工层 |
| 2026-05-20 | risend/anicillia 等 | 日语命轮+SF文本+Embryo 批量回退 MTL | **代码设计** |

**最严重根因（官方 2026-05-20 自述）**：「our codes are designed so when a CN source text is changed, the current human translation is removed, and replaced with MTL」——版本漂移导致白干，从偶发事故变成**写进系统规则的必然**。比喻：只要原稿改一个字，系统就自动撕掉你的手抄页换成机器草稿。

## 3.3 玩法文本硬锁时间线（约 3 个月零 10 天）

- **2025-12-02 冻结**（Light 下令）：「hard lock on Gameplay-Related Text… Skill, Talents, Enlightens, Relics, Resonances, Wheel effects」，因 CN 描述重构，明令转翻剧情。
- **塌陷数据**（月度消息）：general-discussion 753(11月)→59(1月)→**0(2月)**→127(3月解冻)→562(4月)；coordination-uploads **连续两月(1-2月)零归档**。
- **2026-03-12 解冻**：仅限 EN 技能描述，且警告「frequently updated right up until the moment we ship」。

冻结期几乎只剩 omnichromia 一人靠攒小修+转剧情硬撑；01-08「this place feels kinda dead lately」、01-13「deadge」。

## 3.4 工具陷阱清单（事先无人告知的坑，全靠老人口耳相传）

| # | 陷阱 | 后果 |
|---|---|---|
| 1 | 真回车毁表（须用 `\n` 不能按 Enter） | 整行裂开 |
| 2 | CSV 丢 italics（须用 `<Italic:>` 标签或交 .xlsx） | 排版意图全失 |
| 3 | Args 不可省略（可重排但漏一个报错） | 游戏 bug |
| 4 | `[]` 括号须严格匹配 CN | 数值显示破损 |
| 5 | 改 CN 行=清空译文回退 MTL | 译文被整条擦除 |
| 6 | 同名文件覆盖（须唯一命名） | 静默覆盖他人成果 |
| 7 | Excel 自动把 `...` 改成 `…` | 文本被悄悄改坏 |
| 8 | 删旧 csv 是否丢译文（虚惊但卡 10 天等官方答复） | 不确定性致停工 |
| 9 | `\n` 前后多余空格致缩进错位 | 排版错位 |

## 3.5 摩擦根因 + 解法分级

**A. 官方侧零成本（权限/设置/文档）**——复发最频繁的日常放血点
1. 术语表/风格指南设「anyone with link can view」，停逐人审批。
2. 给术语表常驻「全量只读视图」，别锁表头到无人能还原。
3. 把上方 9 条工具陷阱写进一页 onboarding 文档置顶。

**B. 需流程/工程改造**——损耗规模最大
4. **版本漂移白干（最贵）**：建「唯一最新源表」单一真相源；上游改源文必须发变更通知；**改造自动回退机制**（保留人工层做 diff 而非直接覆盖 MTL）——这是写进代码的结构性白干，需工程投入。
5. **硬锁活跃度塌陷**：冻结合理，但 3 个月零沟通缓冲使人闲置流失；冻结期应给明确「可做清单」+ 定期进度播报。

---

# Part 4 · 产能曲线与贡献者流失（量化）

## 4.1 逐月精确表（全量层，已排除机器人）

| 月份 | 消息数 | 唯一活跃作者 | 新出现 | 消失 |
|------|-------:|------:|------:|------:|
| 2025-08 | **2,936** | 33 | 33 | 6 |
| 2025-09 | 2,805 | 31 | 8 | 9 |
| 2025-10 | 937 | 19 | 2 | 5 |
| 2025-11 | 833 | 16 | 1 | 3 |
| 2025-12 | 678 | 18 | 1 | 5 |
| 2026-01 | **121** | 13 | 0 | 2 |
| **2026-02** | **0** | **0** | 0 | 0 |
| 2026-03 | 234 | 30 | **21** | 11 |
| 2026-04 | 632 | 27 | 4 | 10 |
| 2026-05 | 424 | 20 | 1 | 11 |
| 2026-06 | 24 | 9 | 0 | （窗口未闭）|

形态：高开(2,936)→单月-68%断崖(9→10月)→缓泻→谷底(1月121)→2月整月真零→3月微复苏(21新血)→4月反弹即回落。当前体量约开服 1/5~1/7。

## 4.2 流失老兵名单（曾≥10条、2026-04 前消失，按贡献量）

| author_name | 总条数 | 活跃区间 | 主力频道 | 语种 |
|------|------:|------|------|------|
| sophiechoice | 392 | 08-20~11-17 | english-english | EN/PT lead |
| __goz__ | 286 | 08-18~09-21 | english/general | EN/FR |
| ev_6185 | 281 | 09-17~09-23 | english-english | 繁中 lead（6天爆发即走）|
| lykantos. | 152 | 09-06~11-05 | english-english | EN |
| notsoshrimpleofficial | 105 | 08-21~08-23 | english-english | EN（3天即走）|
| …（共 16 名，11/16 主力频道为 english-english）| | | | |

**EN 一线流失最重**：4 名 ≥100 条的 EN 头部主力（sophie 278/ev 140/goz 132/shrimple 102）**全部在 2025-11 前永久消失**；撑到最后的只剩协调层 arkaether/omnichromia/.dredge.——一线译者走光，留下的是管理层。

## 4.3 新血转化（2026-03 复苏 26 人）

留存率 ≈ **8/26 = 31%**（只看 3 月那波 21 人则 ≈19%）。真正站稳的主力**只有 anicillia 一人**（155 条，VN）。主要流失模式：「来要 GitHub 权限即蒸发」（cha.ryko/altsenti/mac2492 等一批）。复苏不是「人留住了」，是「人来过又走了」。

## 4.4 断崖与静默根因（精读原文）

- **断崖（9→10月）= 工作量定义崩塌 + EN 主线锁**，不是吵架。Light 经转述厘清「Proofreading simply means editing the existing MTL text」，omnichromia 顿悟「I've been trying to be an **editor in a room full of proofreaders**」；同时官方锁定 Arc1 主线重做。**热情型 EN 老兵的可做之事一夜蒸发**。
- **静默（12月~2月）= hard lock**：源文要被战斗策划改写，译了也丢→1月只剩零星授权请求，2月整月零，直到 3-12 解锁+招新才复苏。

## 4.5 english-english 衰减判定 = 人在流失，非任务收尾

作者数 17→5（10月即崩）、活跃天数同步塌（10月8天、12月5天）、4 名头部主力 11 月前全走。12 月 356 条回光是「Phantasmal Dive 多语种合作」临时拉动，1 月即归零(9条)。

---

# Part 5 · 自治层 / 多语种健康度 / 分层痛点 / Onboarding

## 5.1 自治层成员图谱（「没编制的参谋班」）

| author_name | 职能/语种 | 状态 |
|---|---|---|
| omnichromia (Mercy) | 事实总协调 + EN 主力 + repo 管理员（自封 unofficial coordinator） | **在岗·核心** |
| arkaether (Lens) | EN 翻译天花板 + 新人试译官 + 术语裁决（2760 条全场第一）| **在岗·核心** |
| morimens_15 (Ace) | 官方唯一对接 | **在岗·官方** |
| .dredge. | EN 校对 + 术语顾问（自建 EN wiki）| 在岗 |
| theriddleofcards | RU lead（职业桌游译者）| 在岗·低频 |
| nero_aliapoh | KR lead | 在岗 |
| __goz__ | FR lead + git 技术教练 | **已离场**（09-21）|
| shiio4870 | ID lead | 半离场 |
| strandiel | DE lead | **已离场**（2025-12）|
| sophiechoice | PT lead + EN 校对 | **已离场**（2025-11，PT 因此停摆）|

## 5.2 11 语种团队健康度

| 分类 | 语种 | 说明 |
|---|---|---|
| **健康（2）** | EN、RU | 有 lead + 正式 mod + aptitude test 制度化 |
| **衰退（4）** | KR、JP、TH、VN/ID | 单人或双人撑，无正式 mod；KR 官方已补编 in-house 译员 Jelly |
| **停摆（5）** | DE、PT、FR、ES、繁中 | lead 离场后无人接，权威真空塌方 |

官方 announce 自证：「We still need **1 moderator for each of: DE, FR, ES, PT, VN, ID, JP, KR, TH, and Traditional Chinese**」——除 EN/RU 外全部语种当时都缺正式 mod。

## 5.3 老手 vs 新人痛点对比

| | 老手（治理/权限/决策真空） | 新人（入门/流程/不知所措）|
|---|---|---|
| 典型 | omnichromia「I wish Ace would give me **moderator role like she said she would**」；dredge「can we just @ ace and **give us the hardline stance**」；omnichromia「don't know what is and isn't supposed to be in the NDA」（自我审查）| haps 一针见血「Some people just go silent, because they **actually don't understand something — what to do, how to do, what are guidelines, where to find anything**」；shiio「sources is jumbled up… confusing to find which is where」；myxxlight 卡在 NDA 名单 |
| 本质 | 会干想干，但钥匙在甲方手里，吵完没人拍板 | 进了大工厂找不到更衣室，干脆默默走人 |

## 5.4 孤帖（零回复）清单

questions-and-feedback：57 帖中 **8 个孤帖（14.0%，与已知吻合）**。其中 **4 个是真·技术问题/bug 上报**由小语种 lead 发出却无人接应：`Line feeds and \n`(__goz__)、`WoD names replaced by MTL`(darkerkuro)、`Args broken only in KR`(nero)、`Why "Awakener"?`(__goz__)。**真正「求助石沉大海」的孤帖集中在小语种技术/bug**，与「小语种被冷落」互证。

## 5.5 Onboarding 现状 + 改进

**现状链条**：进群→welcome 自助领语种角色→读 info 频道→申请 Drive 权限→填 NDA/邮箱→（可选）自我介绍→领活（官方 BIAVGit 提 PR 高门槛 / omnichromia 私 repo 9 步图文 SOP 事实主路 / 新人试译）。

**卡点**：入口分裂（官方 repo vs omnichromia 私 repo，后者还从 Public 改 Private 多一道闸）；工具门槛（git+Excel，小语种新人不会）；NDA/邮箱名单遗漏黑洞；9 语种无 mod 无人带活；真问题无人接（负反馈）。

**改进方案**：
1. **单一入口**：废二选一，welcome 置顶「5 步到首次贡献」流程图。
2. **给 omnichromia 正式 mod 权限**：解锁其建 guide/分配能力（他已实际承担却卡在无权限）。
3. **小语种「接应人」轮值**：9 个无 mod 语种各指定 1 名「30 秒必回应」的人，专治 bug 帖石沉大海。
4. **零 git 通道**：新人默认「Discord 传 .xlsx→协调者代提 PR」，github 仅给熟练工。
5. **NDA 自助核对 thread + 模板**，收口反复出现的「我不在名单」。
6. **采纳 haps 招募改进**：把 EN/RU 的 aptitude test 轻量版推广到衰退语种，先保质再保量。

---

# 综合建议优先级矩阵

| 优先级 | 行动 | 解决 | 成本 |
|---|---|---|---|
| **P0** | 给 Ace 配官方备份对接人（入库+Drive+终审权限），候选 Mia/kada/lyra | 致命单点（进不了游戏）| 官方授权 |
| **P0** | 协调仓迁 GitHub Org，2–3 名 Owner | omnichromia 单点 | 后台操作 |
| **P0** | recognition 政策变更必须前置沟通 + Light 亲自出面；填补分层认可空白 | 留存货币 | 零成本 |
| **P1** | 解锁并固化术语表（公开只读、去筛选器、恢复全表、停审批）| 最高频日常放血 + 头号劝退点 | **零成本** |
| **P1** | 工具陷阱清单 + 5步流程图 + 单一入口，welcome 置顶 | 新人摩擦、入口分裂 | 零成本文档 |
| **P1** | 编译自动化（按语言列定向合并）+ 教学/onboarding 委派 arkaether/__goz__ | omnichromia 减负 | 脚本 |
| **P1** | 改造版本漂移自动回退（保留人工层做 diff）+ 上游改源发变更通知 | 损耗最大的结构性白干 | **工程投入** |
| **P2** | 小语种接应人轮值 + aptitude test 推广到衰退语种 + 补 mod | 5 停摆/4 衰退语种 | 低 |
| **P2** | 冻结期配「可做清单」+ 进度播报；复盘 9月断崖/12月静默 | 产能塌方 | 低 |

---

## 数据纪律与合规说明（§4 / §3.1）

本报告基于**全量档案层**（非输出层抽样），适合完整性/情感/长尾分析；reaction 数字直取 `reactions[].count`，时间线/占比由脚本直接统计（R2：事实直接来自产出工具，未 grep 外推）。单频道采集上限 5000 条，志愿者无频道触顶（影响为零）。分析对象为 Studio 自有志愿者社区的公开 Discord 归档，未触及黑池/内部数据。一处事实修正：2026-05-15 Light 署名回应实际位于 general-discussion 频道（非 announcements），原文与 reaction(22) 已逐字核验。
