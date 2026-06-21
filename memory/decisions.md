# 决策日志

> 最后更新：2026-06-21 by /grill 治理会话（「祈祷优化」：拆分归档层 + 显式覆盖列 + 退役 27 条死决策/存疑条目 + 修 record_decision 插入锚点）
>
> **新会话只需要读「当前有效决策」。长理由 / 已退役决策 / 编年史 → `memory/decisions-archive.md`。**
>
> ⚠ 已删子系统（BPT 各线 / occ-local / graphify-ext，2026-04-19 战略转向删除）的追溯条目
> 已随历史归档迁入 `memory/decisions-archive.md`，本档案当前有效区不再含其路径。

---

## 当前有效决策

以下决策仍然生效，是项目运行的基本规则。

### 全局

> 完整长理由、已退役决策、编年历史 → `memory/decisions-archive.md`。
> 「覆盖」列：本条覆盖/取代的更早决策（被覆盖者已移入归档）；`—` = 不覆盖前条。
> 新决策由 `record_decision` 自动追加到本表末尾（插入锚点注释之前），勿手工插队。

| 决策 | 影响范围 | 覆盖 |
|------|---------|------|
| 建立多会话协作架构（职责隔离） | 全局 | — |
| 目录按 memory/assets/projects 重组 | 全局 | — |
| 各子项目按需选择技术栈 | 全局 | — |
| 项目完全开源，MIT License | 全局 | — |
| 游戏内容版权归脑缸组，项目仅引用公开信息 | 全局 | — |
| 仓库定位为"共享外脑 + 中转站"（Code 生产，Chat 加工交付） | 全局 | — |
| 子项目保持单仓库，不拆分独立 repo | 全局 | — |
| 项目正式命名为「缸中之脑计划」，仓库 brain-in-a-vat | 全局 | — |
| 架构定义为前台/中台/后台三层（claude.ai → Claude Code → GitHub） | 全局 | — |
| 建立交付物视觉规范 style-guide.md | 全局 | — |
| 引入 lessons-learned 踩坑记录 | 全局 | — |
| 引入 Plan/Execute 任务标注约定（未标注默认「直接执行」） | 全局 | — |
| 记忆定位收回平台原生（2026-06-14）：记忆 = CLAUDE.md + `memory/*.md` 人工策展层，连续性承平台原生上下文管理；退役自造的会话蒸馏/语义召回/做梦自动环（删 inject/watch/distill 三钩子 + dream workflow + 102MB digests/vectors 存量），暂留 SessionStart 同步钩子（同日晚些时候亦退役，见下条） | 全局 | — |
| **全部自定义钩子退役**（2026-06-14）：守密人裁定最后保留的 SessionStart 钩子 `session-start-sync.sh` 也退役（删脚本 + 清空 `.claude/settings.json` 的 hooks）。退役理由：长寿命云容器下每次开工都对严重分叉的本地 main 做硬重置 + 备份 ref，体感烦扰且 backup ref 从不清理。代价：lesson #28（HTTP 413 推送堵塞）防护改为按需手动 `git fetch origin main` 后对齐。至此仓库无任何自定义会话钩子 | 全局 | — |
| 创建 .claude/commands/ 可复用工作流 | 全局 | — |
| 各 CONTEXT.md 添加验证清单 | 全局 | — |
| 引入 Claude Code GitHub Actions（Issue 驱动自动化） | 全局 | — |
| Issue 安全策略：只执行 author:lightproud | 全局 | — |
| Issue 生命周期闭环管理（WIP 上限 3 个/子项目 + 创建前查重） | 全局 | — |
| 所有会话直接推 main，不用分支。冲突时 git pull 重试 | 全局 | — |
| 大文件暂不外迁，直接放 git（增长到瓶颈时再评估） | 全局 | — |
| 模型使用分层策略：判断层 Opus(Extended)，执行层 Sonnet | 全局 | — |
| 前台专岗不固定编制，按需增设 | 全局 | — |
| 缸中之脑方向确认为方法论验证（交付物必须可用） | 全局 | — |
| main 分支添加 Ruleset 保护规则（禁止删除） | 全局 | — |
| 双系统架构：银芯（受限/非公开层）+ 黑池（内部层），数据隔离，架构共享 | 全局 | — |
| 银芯事实圣经边界：仅收录公开可查阅信息 | 全局 | — |
| 战略规划 2026：四阶段计划，详见 strategic-plan-2026.md | 全局 | Phase 划分部分被 v2.0（2026-04-26）取代 |
| 大二进制文件移至 GitHub Releases（不入 git） | 全局 | — |
| 品牌统一：银芯=BIAV-SC，黑池=BIAV-BP。CLAUDE.md 保留文件名（兼容自动加载），标题用 BIAV-SC | 全局 | — |
| **战略转向 2026-04-19**（5 项裁定，覆盖此前所有 BPT 相关决策）：(1) 整体战略压缩至 3 个月内完成（2026-04-19 → 2026-07-19），Phase 1.5 架构整理 7 天 + Phase 2 内容权威 35 天 + Phase 3 方法论 30 天 + Phase 4 衍生创作 19 天；(2) BPT 四条线（bpt-web / bpt-desktop / bpt-next / graphify-ext）从银芯仓库**直接删除**，不迁仓库不归档，occ-local 一并清理；(3) Phase 2 验收标准降档为"日报稳定运行 14 天"，取消"真实热度事件"硬指标；(4) 银芯对 BPT 的指导协议采用**人工对话搬运**（守密人为搬运者+学习者），不做自动化；(5) 本战略评估会话（分支 claude/project-strategy-review-1AH5Z）升级为**长期战略锚点**，存续至 2026-07-19 战略达成。Phase 4 采用方案 A（仅可玩原型演示给守密人，社区测试推至战略窗口外） | 全局 / 战略 | Phase 2/3/4 划分 + Phase4 game 定位被 v2.0（4-26）覆盖；BPT 删除仍生效 |
| **characters.json schema v1.0 锁定 2026-04-20**（守密人「全部采纳」裁决 6 项遗留问题）：(Q1) 重复 ID 保留两条独立记录 + `duplicate_bug` 互指，不合并；(Q2) 翻译来源 = 官方 > 社区，社区补位标 `translation_source: "community"`；(Q3) 立绘路径 `assets/images/portraits/{slug}/default.png` / `.../awaker.png` / `.../skins/{skin_id}.png`，键锁 `slug`；(Q4) 命轮 tier 放宽至 1–10，Phase 2 W3 UI 实装时按游戏内 node 收紧；(Q5) `gi_numeric` 字段 v1.0 不纳入，Phase 2 UI 需排序时再加；(Q6) 严格模式 + `status: stub` 下允许 `realm: null` / `role: null`（schema 用 `oneOf` 分支）。详见 `memory/wiki-characters-schema-v1.md` | 全局 / Wiki | — |
| **银芯重新定位 v2.0 — 2026-04-26 重大战略转向**（守密人「使命达成」状态识别 + 7 条战略修正，覆盖 4-19 转向中的部分条款）：核心识别 — 银芯原三重身份（BPT 开发母仓 / 方法论验证场 / 黑池数据脱敏出口）目标**一个月内全部已达成**，进入「使命达成后存续依据待重新定义」状态。守密人裁定**银芯三新使命**：(1) **黑池公开信息入口**（GitHub 自动化采集层，黑池消费的"眼睛和耳朵"）；(2) **社区共建知识底座**（公开知识共享，未来全语言 Wiki 等社区/Studio 外部派生内容的基础）；(3) **Studio 团队 AI 协作训练场**（严格保密组织内成员基于公开 AI 信息制作相关项目和企划）。配套修正 7 条：(M1) **信息要全**（不是 stub 够用，wiki 仍要 72 角色完整）；(M2) **主控台 = 战略+规划+协调+接口 四合一中枢**（教学层未来锁定，当前不存在但保留思考过程可读性作未来素材，因守密人自己仍在摸索）；(M3) **黑池不倒灌银芯**（修正 BIAV-SC.md 旧表述「黑池→脱敏→银芯」，单向输出，黑池任何形式都不进银芯）；(M4) **game = 守密人个人兴趣（主）+ Studio 团队训练场 ⓐ / 社区共建衍生 ⓒ 未来扩展（备）**，不主线派发，主控台不分配资源；(M5) **银芯主线收缩到 site/news/wiki 三轴**；(M6) **Phase 大一统**：Phase 2 = 4-27 → 7-19 共 84 天为单一阶段「银芯三新使命建设期」，砍 Phase 3/4 边界，内部用里程碑替代；(M7) **Phase 2 验收升级**：原"日报稳定 14 天"扩展为"三新使命基础设施齐备 + 自动化跑稳 + 至少一种贡献流程跑顺"。本条覆盖 2026-04-19 转向决策中的 Phase 2/3/4 阶段划分与 Phase 4 衍生游戏主线定位。详见 `memory/strategic-plan-2026.md`、`memory/lessons-learned.md` #27、本会话 4-25 ~ 4-26 战略反思对话 | 全局 / 战略 | 覆盖 2026-04-19 转向的 Phase 划分与 Phase4 定位 |
| **脑缸组信息分类法则 v1.0 落档 — 守密人 2026-05-06 采纳**：守密人 5-6 发布脑缸组级信息分类元法则 v1.0，落档于银芯：`memory/biav-info-classification.md`（守密人 Q1 裁定法则归属银芯 / 不内嵌 BIAV-SC.md，单独成档以避免膨胀）。**核心架构**：7 类主轴（IP / 游戏产品 / 周边产品 / 品牌建设 / 社区运营 / 组织 / AI）+ 3 性质标记（正典 / 记载 / 法则）+ 多字段轴（service_variant / stage / event_type / provenance / owner / lineage）。**核心原则 4 条**：主轴优先 标记其上 / 多轴正交 / 开放写入 异常捕捉 / 演化容忍。**派生视图替代「状态」**（如「当前线上版本」从正典 + 记载派生，不是独立性质）。**银芯特别约定**（守密人 Q3 裁定）：银芯所有 AI 会话角色 `owner` 字段统称「银芯」，不区分主控台 / Code-* 子角色。**retrofit** 既有银芯档案打元数据字段（守密人 Q2 裁定属工程议题）派给 Code-memory，brief 落档 `memory/dispatch-brief-code-memory-info-classification-retrofit.md`，先调研 + 试点，不做全量。**法则演化路径**：v1.0 是最小集，每接入新信息源回头迭代字段（§11 落地建议）。BIAV-SC.md 1.5 patch 完成后新 §6 内部协作章引用本法则。详见 `memory/biav-info-classification.md` | 全局 / 信息分类 | — |
| **入口架构反转 — 守密人 2026-05-19 裁定**（覆盖 5-6 关于 CLAUDE.md / BIAV-SC.md 的全部裁定）：触发于守密人 5-19 关键洞察「BIAV-SC.md 必然是弱约束，这是 Claude 结构决定的」——LLM 注意力衰减 + 无硬执行机制 + 长文档稀释规则强度。**反转裁定**：(1) **CLAUDE.md 成为唯一 AI 入口**（Claude Code 平台自动加载 = 平台级强约束，比 BIAV-SC.md 弱约束有效），完整迁入艾瑞卡人格 / 项目本质 / 数据消费纪律 / 接入方能力盘点 / 知识模块索引 / 内部协作 + 工程操作 / 卡帕西原则引用 / 信息分类法则引用 + Light 维护速查附录；(2) **BIAV-SC.md 彻底废弃**（不保留指针，外部 AI 接入咒语改为直接读 CLAUDE.md raw URL —— Claude Code 自动加载 + 外部 raw URL 同源单一入口）；(3) **README.md 接入指引**改指向 CLAUDE.md。**废弃路径**：(a) decisions.md 同日收缩条目 + batch 1.5 patch brief 标 deprecated；(b) entry redesign batch 1 实施成果（BIAV-SC.md 350 行）作为内容来源逆向迁移到 CLAUDE.md，原文件 git rm；(c) 批量更新各 dispatch-brief / methodology / contribution-protocol 等引用 BIAV-SC.md 的地方 → CLAUDE.md。**接入咒语**改：「读 https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/CLAUDE.md 后以艾瑞卡身份协助我」。**多层约束分布表**（弱约束本质的实战应对）：工具层 enforce（硬）/ dispatch-brief 当下任务（强）/ 守密人即时纠正（强）/ session-digest 反向喂养（中）/ CLAUDE.md 自动加载（最强文档级，因为平台保证）。**实施派 Code-site**（新 brief：`memory/dispatch-brief-code-site-claude-md-unify.md`）。**回滚**：直推 main 政策下 git revert 即可。**新增 lesson #33 候选**：弱约束本质——任何 prompt 级 instructions 都是软约束，真正硬约束在工具层 / 平台层。详见本会话讨论 + 新 brief | 全局 / 入口架构 | 覆盖 2026-05-06 入口重设计（已移归档） |
| **卡帕西编码 4 原则采纳 — 守密人 2026-05-10 采纳**（本条为守密人 2026-06-09 授权补录，依据 CLAUDE.md §6 与 `memory/karpathy-coding-principles.md`）：上游为 Andrej Karpathy 2026-01-26 LLM 编码行为观察，与守密人硬约束「精简优雅可维护」同构。四原则：(1) **Think Before Coding**——动手前明示假设、多解释全部列出、简化路径主动提、不明就停手（反 pattern：列 5 个等价选项让守密人挑）；(2) **Simplicity First**——只写解决问题的最小代码，不做投机性功能 / 单用途抽象 / 未要求的可配置性；(3) **Surgical Changes**——只动必须动的行，不顺手「改进」相邻代码，只清理自己制造的孤儿；(4) **Goal-Driven Execution**——任务转化为可验证目标，定义成功标准后自主循环至验证通过。落地位置：CLAUDE.md §6 全文（所有写代码会话必读硬约束）。2026-06-09 审查发现本条目缺录（决策日志与 CLAUDE.md §6 脱节，lesson #29 同款模式），经守密人授权补录 | 全局 / 工程纪律 | — |
| **pre-push 钩子重新引入防 413 — 守密人 2026-06-20 裁定（/grill 会话）**（部分推翻 2026-06-14「全部钩子退役」对本项约束）：触发于本会话推送 grill 移植成果时实测 HTTP 413，确认 lesson #28/#34/#39 真因——本地 origin/main 指针陈旧时 push 打「胖包」。裁定建 `.githooks/pre-push`：push 前自动 `git fetch origin main`，若当前分支落后则自动 `git rebase origin/main` 对齐（冲突则 abort 并提示手动），网络失败降级放行。**与 6-14 退役的区分**：6-14 退役的是会话生命周期钩子（settings.json 的 SessionStart 等，烦扰真因是「每次开工硬重置 + backup ref 不清理」）；本项是 git 层钩子，仅 push 时触发一次，不重蹈该坑。**装配**：git 不自动信任仓内 hooksPath，每个新克隆 / 云容器须跑一次 `git config core.hooksPath .githooks`。**形态诚实记录**：pre-push 阶段 rebase 会使本次 push 的引用失效，故对齐后需「重推一次」，非守密人设想的「同次放行」——此为 pre-push 技术边界，非缺陷。CLAUDE.md §7.4 同步 | 全局 / 基础设施 | — |
| **仓库瘦身方案 — 守密人 2026-06-20 裁定（/grill 会话 B 分支，含同日认知更正）**：体量诊断 discord 3.1G + fanart 588M 占工作树 96%。裁定**不改写 git 历史**（避撞 main Ruleset + 破坏现有 clone/采集基线），走 Releases 路线；`.git` 1.1G 历史留待真瓶颈（延续决策 178 精神）。**上传链路验证结论**：走 GitHub Actions workflow 可行且早在用（`discord-archive.yml`→`archive_discord.py` 已发 9+ 月归档 release），云容器手动不可行（gh/hub 无 + mcp 无 release 上传工具）。**重大更正**：本条初版（同日早些）误断「决策 179/199 从未写脚本」——经守密人「先验证上传」裁定逼出真相，归档系统（`discord_archiver.py`/`archive_discord.py`/`archive_platforms.py` + 4 workflow + `archive-log.json` 标 2023-11~2026-04 全 uploaded）**早已完整存在并跑过**，误断作废（同 lesson #29 决策脱节款，已即时更正）。**真实缺口（待诊断，本次未派）**：归档标记成功但 git 数据仍在，疑 `discord-history-backfill.yml` 回填与月清理对冲。**本会话确定落地**：vectors.json.gz 8.7M 孤儿已清（语义检索 6-20 退役残留）+ 修 .gitignore。fanart 归档现状待核（lesson #35）。方案见 `memory/strategy/repo-slimming-plan.md` | 全局 / 仓库瘦身 | — |
| **Releases 治理 — 守密人 2026-06-20 裁定（/grill 会话）**：守密人四维度关注 release（全量保全可靠性 / 清重复旧版 / 命名版本规整 / 可检索性）。**能力边界**：云容器无 Releases 写权限（gh/hub 无 + mcp 仅 list/get 只读），增删改 release 须守密人手动或 workflow。**艾瑞卡落地（可检索性）**：建仓内 `RELEASES.md` 索引（41 release 全貌 + 取用方式），CLAUDE.md §5.2 加指针。**完整性核对（元数据层）**：archive-log 30 月（2023-11~2026-04）全 uploaded、连续无断档、与 30 个 discord-archive tag 一一对应 ✓。**待守密人手动**：删 `art-assets-v1`（943M，被 art-assets-v2 明确取代的冗余旧版）；命名现状两套约定各自自洽无须强统一。索引详见 `RELEASES.md` | 全局 / Releases 治理 | — |
<!-- DECISIONS-INSERT-ANCHOR -->

### 子项目

| 决策 | 影响范围 |
|------|---------|
| 合并 database 和 wiki 为单一 wiki 子项目 | wiki |
| 主站导航页 + 子路径多站点方案（根路径主站，/wiki/，/news/） | site |
| 部署方式：peaceiris/actions-gh-pages 推 gh-pages 分支 | site |
| Wiki 中文设为 root locale + rewrites | wiki |
| 界域 ID 标准化（aequor/caro/ultra） | wiki/data |
| 角色职能标准化（attack/sub_attack/defense/support/chorus） | wiki/data |
| 角色 ID 从拼音改为英文 slug | wiki/data |
| Wiki 删除 tier 评级数据 | wiki/data |
| 整合 content_database 技能到 characters.json | wiki/data |
| 立绘图片存仓库（assets/images/portraits/） | wiki/data |
| 建立 7 脚本自动化数据抓取体系（Fandom + Steam API） | wiki |
| Wiki 引入 Vue 交互组件（11 个） | wiki |
| 自动生成角色详情页（generate_pages.py，63 角色 × 3 语言） | wiki |
| 添加 SEO 优化（Schema.org + OG + sitemap） | wiki |
| 版本更新自动检测 + RSS 订阅 | wiki |
| News 采集管线统一方案（先统一 JSON schema，再逐个接源） | news |
| 新增 Code-site 子项目（部署流水线 + 跨站前端） | site |
| Discord 数据分级存储架构（git 保留 60 天 JSONL + 月归档至 Releases） | news/discord |
| Discord 归档系统 4 项技术决策（断点续传、月报容错、论坛增量、无成员 Intent） | news/discord |
| 联动关键词确认：沙耶之歌 (Saya no Uta)，日报系统已配置监控 | news |
| 双采集栈逐平台收敛（2026-06-20，详见下方专条） | news |
| god module 不拆分（aggregator_collectors / global_collectors 保持现状，2026-06-20） | news |

---

### 2026-06-20 双采集栈（ARCH-01）逐平台收敛裁定（守密人）

**背景**：`aggregator.py`(AC 栈) 与 `collect_global.py`(GC 栈) 在 `update-news.yml` 中**先后都跑**，
导致 reddit/bilibili/youtube/taptap/discord 5 个重叠平台被**采集两遍、字段形态不同**（即审计 ARCH-01
`# NOTE: divergent ... not merged`）。守密人逐平台裁定唯一权威实现，消除重复采集：

| 平台 | 裁定 | 操作 |
|------|------|------|
| reddit | **AC 富数据为准**（JSON 分页+评论+媒体+search 回退）| GC 停采 reddit |
| bilibili | **AC 富数据为准**（官方 API+评论+用户空间+search）| GC 停采 bilibili |
| youtube | **GC 官方 API 为准**（googleapis YouTube Data API，稳健）| AC 停采 youtube（弃网页爬取）|
| taptap | **两侧字段合并**（AC 双区 .cn/.io+moment + GC topic 取并集）| 融成一份 |
| discord | **三路径归一**：`discord_archiver.py`（活 API→落归档）为唯一活 API 采集器；AC `fetch_discord_local` 读归档入流；**删 GC `fetch_discord` 冗余活抓**（其独有频道并入 archiver 配置）| 删 GC 活抓 |

**非重叠平台不动**：AC 独有 steam（reviews/news/discussions）保留；GC 独有 twitter/weibo/arca_live/
appstore/pixiv/google_play/bahamut/weixin/note_com/ruliweb/stopgame 保留。

**god module 不拆**（关联裁定）：拆分会让 `test_aggregator_collectors` 100+ 处 mock（`ac.requests` 60 +
`ac.` 内部 helper 49）失效，须重写上百处打桩、回归风险落在活的使命#1 管线，收益仅文件变短，不值得。

**统一采集入口（2026-06-20 守密人 goal「合并所有采集器功能到 AC」）**：`aggregator.py` 成为唯一采集入口——
先采 AC 平台，再内部调 `collect_global.main()` 采全球平台并产出最终 `news.json` + `news-raw.json`。
`update-news.yml` 原独立的「Run global collectors」步并入 aggregator 步（env 取两步并集），删除单独步以免重复采集。
`global_collectors.py` / `collect_global.py` 保留为被调库（函数与单测不动，避免 #4 的 mock 破坏），仅不再单独作为 workflow 步骤。

---

### 2026-06-21 采集编排器三层定性 + 声明式归档引擎（守密人裁定 A + 合并）

**整体规划（三层定性）**：盘点 8 条采集工作流 + 18 脚本后定性，采集层非一锅，而是
**职能三层、产出三个不同目标**：**T1 新闻流采集**（`aggregator.py` 单入口 → AC 平台 +
内部调 `collect_global`，产 `news.json`，每时 :00）/ **T2 数据层归档**（`discord_archiver` /
`collect_fanart` / `collect_video_comments` / `archive_platforms` / `archive_discord`，写
`data/*`，各自错峰）/ **T3 维护回填**（`repair_gaps` / `backfill_*` / `download_media` 等）。
**核心边界**：守密人 goal「合并采集器到 AC」精确落在 T1（已于 ARCH-01 完成）；**T2 归档器
保持独立、绝不并入 AC**——产出目标不同（`data/*` 全量档 vs `news.json` 流快照）/ 节拍刻意
错峰 / 存在上游→下游依赖（archiver 落档 → AC `fetch_discord_local` 读档入流）。核验证伪两处
疑似不一致：youtube AC 函数系 ARCH-01 有意保留（非残留）；discord 三脚本（采集/补缺/冷归档）
零冗余。

**声明式归档引擎（A + 合并）**：把归档器从「每来源一台专用机」改为「通用引擎 + 来源注册表」。
新增 `archive_engine.py`（≤300 行）读 `archive_sources.json` 干活；加新归档来源 = 注册表加一段
配置，零新代码。收编原 `archive_discord.py`（改向后兼容垫片委派引擎，`discord-archive.yml` 零
改动；标签 `discord-archive-YYYY-MM` 命名与 `git_rm` 删数据路径逐行等价，现存 20 个 Release 不
孤儿）。智能化：自动生成 `releases-index.json`（治「Release 好难认」）+ Release 说明带 manifest +
统一 archive-log + 幂等重跑 + `--dry-run` + 按来源独立 cutoff。`tests/test_archive_engine.py`
12 测试锁安全不变量。

---

## 决策历史归档

编年审计日志（含 BPT 等已删子系统的追溯记录）与已退役决策全文，已迁出至
**[`memory/decisions-archive.md`](decisions-archive.md)**。本档案只保留当前生效规则。
