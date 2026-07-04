# 决策日志

> 最后更新：2026-07-04 by 拷问对齐会话（新增 1 条：BPT 定位三层裁定——本体定位档建档 / 指导协议 v0.3 / SDK 定位三处修订，守密人授权代写）
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
| 双系统架构：银芯（公开信息层）+ 黑池（内部层），数据隔离，架构共享 | 全局 | 定位以 2026-06-21「翻回公开信息层」裁定为准（见本表末同日「银芯定位翻回公开信息层」条）|
| 银芯事实圣经边界：仅收录公开可查阅信息 | 全局 | — |
| 战略规划 2026：四阶段计划，详见 strategic-plan-2026.md | 全局 | Phase 划分部分被 v2.0（2026-04-26）取代 |
| 大二进制文件移至 GitHub Releases（不入 git） | 全局 | — |
| 品牌统一：银芯=BIAV-SC，黑池=BIAV-BP。CLAUDE.md 保留文件名（兼容自动加载），标题用 BIAV-SC | 全局 | — |
| **战略转向 2026-04-19**（5 项裁定，覆盖此前所有 BPT 相关决策）：(1) 整体战略压缩至 3 个月内完成（2026-04-19 → 2026-07-19），Phase 1.5 架构整理 7 天 + Phase 2 内容权威 35 天 + Phase 3 方法论 30 天 + Phase 4 衍生创作 19 天；(2) BPT 四条线（bpt-web / bpt-desktop / bpt-next / graphify-ext）从银芯仓库**直接删除**，不迁仓库不归档，occ-local 一并清理；(3) Phase 2 验收标准降档为"日报稳定运行 14 天"，取消"真实热度事件"硬指标；(4) 银芯对 BPT 的指导协议采用**人工对话搬运**（守密人为搬运者+学习者），不做自动化；(5) 本战略评估会话（分支 claude/project-strategy-review-1AH5Z）升级为**长期战略锚点**，存续至 2026-07-19 战略达成。Phase 4 采用方案 A（仅可玩原型演示给守密人，社区测试推至战略窗口外） | 全局 / 战略 | Phase 2/3/4 划分 + Phase4 game 定位被 v2.0（4-26）覆盖；BPT 删除仍生效 |
| **characters.json schema v1.0 锁定 2026-04-20**（守密人「全部采纳」裁决 6 项遗留问题）：(Q1) 重复 ID 保留两条独立记录 + `duplicate_bug` 互指，不合并；(Q2) 翻译来源 = 官方 > 社区，社区补位标 `translation_source: "community"`；(Q3) 立绘路径 `assets/images/portraits/{slug}/default.png` / `.../awaker.png` / `.../skins/{skin_id}.png`，键锁 `slug`；(Q4) 命轮 tier 放宽至 1–10，Phase 2 W3 UI 实装时按游戏内 node 收紧；(Q5) `gi_numeric` 字段 v1.0 不纳入，Phase 2 UI 需排序时再加；(Q6) 严格模式 + `status: stub` 下允许 `realm: null` / `role: null`（schema 用 `oneOf` 分支）。详见 `memory/wiki-characters-schema-v1.md` | 全局 / Wiki | — |
| **银芯重新定位 v2.0 — 2026-04-26 重大战略转向**（守密人「使命达成」状态识别 + 7 条战略修正，覆盖 4-19 转向中的部分条款）：核心识别 — 银芯原三重身份（BPT 开发母仓 / 方法论验证场 / 黑池数据脱敏出口）目标**一个月内全部已达成**，进入「使命达成后存续依据待重新定义」状态。守密人裁定**银芯三新使命**：(1) **黑池公开信息入口**（GitHub 自动化采集层，黑池消费的"眼睛和耳朵"）；(2) **社区共建知识底座**（公开知识共享，未来全语言 Wiki 等社区/Studio 外部派生内容的基础）；(3) **Studio 团队 AI 协作训练场**（严格保密组织内成员基于公开 AI 信息制作相关项目和企划）。配套修正 7 条：(M1) **信息要全**（不是 stub 够用，wiki 仍要 72 角色完整）；(M2) **主控台 = 战略+规划+协调+接口 四合一中枢**（教学层未来锁定，当前不存在但保留思考过程可读性作未来素材，因守密人自己仍在摸索）；(M3) **黑池不倒灌银芯**（修正 BIAV-SC.md 旧表述「黑池→脱敏→银芯」，单向输出，黑池任何形式都不进银芯）；(M4) **game = 守密人个人兴趣（主）+ Studio 团队训练场 ⓐ / 社区共建衍生 ⓒ 未来扩展（备）**，不主线派发，主控台不分配资源；(M5) **银芯主线收缩到 site/news/wiki 三轴**；(M6) **Phase 大一统**：Phase 2 = 4-27 → 7-19 共 84 天为单一阶段「银芯三新使命建设期」，砍 Phase 3/4 边界，内部用里程碑替代；(M7) **Phase 2 验收升级**：原"日报稳定 14 天"扩展为"三新使命基础设施齐备 + 自动化跑稳 + 至少一种贡献流程跑顺"。本条覆盖 2026-04-19 转向决策中的 Phase 2/3/4 阶段划分与 Phase 4 衍生游戏主线定位。详见 `memory/strategic-plan-2026.md`、`memory/lessons-learned.md` #27、本会话 4-25 ~ 4-26 战略反思对话 | 全局 / 战略 | 覆盖 2026-04-19 转向的 Phase 划分与 Phase4 定位 |
| **脑缸组信息分类法则 v1.0 落档 — 守密人 2026-05-06 采纳**：守密人 5-6 发布脑缸组级信息分类元法则 v1.0，落档于银芯：`memory/biav-info-classification.md`（守密人 Q1 裁定法则归属银芯 / 不内嵌 BIAV-SC.md，单独成档以避免膨胀）。**核心架构**：7 类主轴（IP / 游戏产品 / 周边产品 / 品牌建设 / 社区运营 / 组织 / AI）+ 3 性质标记（正典 / 记载 / 法则）+ 多字段轴（service_variant / stage / event_type / provenance / owner / lineage）。**核心原则 4 条**：主轴优先 标记其上 / 多轴正交 / 开放写入 异常捕捉 / 演化容忍。**派生视图替代「状态」**（如「当前线上版本」从正典 + 记载派生，不是独立性质）。**银芯特别约定**（守密人 Q3 裁定）：银芯所有 AI 会话角色 `owner` 字段统称「银芯」，不区分主控台 / Code-* 子角色。**retrofit** 既有银芯档案打元数据字段（守密人 Q2 裁定属工程议题）派给 Code-memory（实施 brief 随多会话架构 2026-06 退役删除），先调研 + 试点，不做全量。**法则演化路径**：v1.0 是最小集，每接入新信息源回头迭代字段（§11 落地建议）。详见 `memory/biav-info-classification.md` | 全局 / 信息分类 | — |
| **入口架构反转 — 守密人 2026-05-19 裁定**（覆盖 5-6 关于 CLAUDE.md / BIAV-SC.md 的全部裁定）：触发于守密人 5-19 关键洞察「BIAV-SC.md 必然是弱约束，这是 Claude 结构决定的」——LLM 注意力衰减 + 无硬执行机制 + 长文档稀释规则强度。**反转裁定**：(1) **CLAUDE.md 成为唯一 AI 入口**（Claude Code 平台自动加载 = 平台级强约束，比 BIAV-SC.md 弱约束有效），完整迁入艾瑞卡人格 / 项目本质 / 数据消费纪律 / 接入方能力盘点 / 知识模块索引 / 内部协作 + 工程操作 / 卡帕西原则引用 / 信息分类法则引用 + Light 维护速查附录；(2) **BIAV-SC.md 彻底废弃**（不保留指针，外部 AI 接入咒语改为直接读 CLAUDE.md raw URL —— Claude Code 自动加载 + 外部 raw URL 同源单一入口）；(3) **README.md 接入指引**改指向 CLAUDE.md。**废弃路径**：(a) decisions.md 同日收缩条目 + batch 1.5 patch brief 标 deprecated；(b) entry redesign batch 1 实施成果（BIAV-SC.md 350 行）作为内容来源逆向迁移到 CLAUDE.md，原文件 git rm；(c) 批量更新各 dispatch-brief / methodology / contribution-protocol 等引用 BIAV-SC.md 的地方 → CLAUDE.md。**接入咒语**改：「读 https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/CLAUDE.md 后以艾瑞卡身份协助我」。**多层约束分布表**（弱约束本质的实战应对）：工具层 enforce（硬）/ dispatch-brief 当下任务（强）/ 守密人即时纠正（强）/ session-digest 反向喂养（中）/ CLAUDE.md 自动加载（最强文档级，因为平台保证）。**实施派 Code-site**（实施 brief 随多会话架构 2026-06 退役删除）。**回滚**：直推 main 政策下 git revert 即可。**新增 lesson #33 候选**：弱约束本质——任何 prompt 级 instructions 都是软约束，真正硬约束在工具层 / 平台层 | 全局 / 入口架构 | 覆盖 2026-05-06 入口重设计（已移归档） |
| **卡帕西编码 4 原则采纳 — 守密人 2026-05-10 采纳**（本条为守密人 2026-06-09 授权补录，依据 CLAUDE.md §6 与 `memory/karpathy-coding-principles.md`）：上游为 Andrej Karpathy 2026-01-26 LLM 编码行为观察，与守密人硬约束「精简优雅可维护」同构。四原则：(1) **Think Before Coding**——动手前明示假设、多解释全部列出、简化路径主动提、不明就停手（反 pattern：列 5 个等价选项让守密人挑）；(2) **Simplicity First**——只写解决问题的最小代码，不做投机性功能 / 单用途抽象 / 未要求的可配置性；(3) **Surgical Changes**——只动必须动的行，不顺手「改进」相邻代码，只清理自己制造的孤儿；(4) **Goal-Driven Execution**——任务转化为可验证目标，定义成功标准后自主循环至验证通过。落地位置：CLAUDE.md §6 全文（所有写代码会话必读硬约束）。2026-06-09 审查发现本条目缺录（决策日志与 CLAUDE.md §6 脱节，lesson #29 同款模式），经守密人授权补录 | 全局 / 工程纪律 | — |
| **pre-push 钩子重新引入防 413 — 守密人 2026-06-20 裁定（/grill 会话）**（部分推翻 2026-06-14「全部钩子退役」对本项约束）：触发于本会话推送 grill 移植成果时实测 HTTP 413，确认 lesson #28/#34/#39 真因——本地 origin/main 指针陈旧时 push 打「胖包」。裁定建 `.githooks/pre-push`：push 前自动 `git fetch origin main`，若当前分支落后则自动 `git rebase origin/main` 对齐（冲突则 abort 并提示手动），网络失败降级放行。**与 6-14 退役的区分**：6-14 退役的是会话生命周期钩子（settings.json 的 SessionStart 等，烦扰真因是「每次开工硬重置 + backup ref 不清理」）；本项是 git 层钩子，仅 push 时触发一次，不重蹈该坑。**装配**：git 不自动信任仓内 hooksPath，每个新克隆 / 云容器须跑一次 `git config core.hooksPath .githooks`。**形态诚实记录**：pre-push 阶段 rebase 会使本次 push 的引用失效，故对齐后需「重推一次」，非守密人设想的「同次放行」——此为 pre-push 技术边界，非缺陷。CLAUDE.md §7.4 同步 | 全局 / 基础设施 | — |
| **仓库瘦身方案 — 守密人 2026-06-20 裁定（/grill 会话 B 分支，含同日认知更正）**：体量诊断 discord 3.1G + fanart 588M 占工作树 96%。裁定**不改写 git 历史**（避撞 main Ruleset + 破坏现有 clone/采集基线），走 Releases 路线；`.git` 1.1G 历史留待真瓶颈（延续决策 178 精神）。**上传链路验证结论**：走 GitHub Actions workflow 可行且早在用（`discord-archive.yml`→`archive_discord.py` 已发 9+ 月归档 release），云容器手动不可行（gh/hub 无 + mcp 无 release 上传工具）。**重大更正**：本条初版（同日早些）误断「决策 179/199 从未写脚本」——经守密人「先验证上传」裁定逼出真相，归档系统（`discord_archiver.py`/`archive_discord.py`/`archive_platforms.py` + 4 workflow + `archive-log.json` 标 2023-11~2026-04 全 uploaded）**早已完整存在并跑过**，误断作废（同 lesson #29 决策脱节款，已即时更正）。**真实缺口（待诊断，本次未派）**：归档标记成功但 git 数据仍在，疑 `discord-history-backfill.yml` 回填与月清理对冲。**本会话确定落地**：vectors.json.gz 8.7M 孤儿已清（语义检索 6-20 退役残留）+ 修 .gitignore。fanart 归档现状待核（lesson #35）。方案见 `memory/strategy/repo-slimming-plan.md` | 全局 / 仓库瘦身 | — |
| **Releases 治理 — 守密人 2026-06-20 裁定（/grill 会话）**：守密人四维度关注 release（全量保全可靠性 / 清重复旧版 / 命名版本规整 / 可检索性）。**能力边界**：云容器无 Releases 写权限（gh/hub 无 + mcp 仅 list/get 只读），增删改 release 须守密人手动或 workflow。**艾瑞卡落地（可检索性）**：建仓内 `RELEASES.md` 索引（41 release 全貌 + 取用方式），CLAUDE.md §5.2 加指针。**完整性核对（元数据层）**：archive-log 30 月（2023-11~2026-04）全 uploaded、连续无断档、与 30 个 discord-archive tag 一一对应 ✓。**待守密人手动**：删 `art-assets-v1`（943M，被 art-assets-v2 明确取代的冗余旧版）；命名现状两套约定各自自洽无须强统一。索引详见 `RELEASES.md` | 全局 / Releases 治理 | — |
| **银芯 Public-Info-Pool 数据本体总纲 — 守密人 2026-06-21 裁定（/grill 规划社区数据存放和目录，授权艾瑞卡代写）**：采「按性质分流」为唯一总纲——可检索 text→git，二进制→Releases（text 进 Releases 自废 grep/diff/AI 分析；二进制零访问损失，本会话建社区索引被迫写 `restore_release_data.py` 下 301MB 即铁证）。git 内套 **BPT v2.0 4R 本体**（Root/Resource/Record/Reference）组织 `Public-Info-Pool/`：社区归档→`Record/Community/`（discord + 16 平台摊平对齐）、解包 text→`Reference/Game-Unpacked/`。BPT 4R 定性为**银芯↔黑池接口协议**（借结构模板 + 知识格式约定，非引入黑池数据，不破「黑池不进银芯」）。原始时序数据免逐文件 frontmatter，目录归位 + `index.md` 即合规。方案见 `memory/strategy/repo-slimming-plan.md` §8 | 全局 / 数据架构 | 反转决策 86（discord 60 天分级）+「大二进制移 Releases」的 text 部分 + 2026-06-20 仓库瘦身/Releases 治理路线 |
| **Release 收敛为 2 + discord 全量 de-tier — 守密人 2026-06-21 裁定（/grill，授权艾瑞卡代写）**：Release 最终只留 **解包**（unpacked-assets + unpacked-data 二进制残余合并，config 重打包剥 text）+ **社区二创**（community-assets：fanart/media）；`community-data` 退役删除（discord 全量入 git）。discord 转「全量永驻 git、退役月度 git_rm 瘦身」，拆 `discord_archiver.py` 月度清理 + 防重拉对冲守卫（前提消失）。fanart/media `git rm` 出工作树（**不改 git 历史**，历史压缩守密人未来另议）、采集链改直传 release。执行**一次到位**、经 CI workflow（容器无 Release 写权限/大推 413，决策 2026-06-20 执行约束不变）。方案见 `memory/strategy/repo-slimming-plan.md` §8 | 全局 / 仓库瘦身 | 反转 2026-06-20 Releases 治理的分级路线 |
| **wiki 结构化层整层清空 — 守密人 2026-06-15 裁定**（2026-06-21 守密人授权艾瑞卡补录，由 B 裁定日期哨兵 `tests/test_claude_md_dates.py` 抓出「CLAUDE.md/project-status 有载、决策台账缺录」的跨档漂移，lesson #29 同款脱节）：原 `projects/wiki/data/db/` 结构化层（`characters.json` 全 6 JSON + 24 个生成角色详情页）整层清空。理由：原 24/72 全为 partial/fixture 占位、game_version 全 None，长期误导引用。数据桥 `characters.ts` 改导出空数组（保留类型/组件脚手架），VitePress 构建验证通过（BUILD_OK）。W2 重建基线必须以 `projects/wiki/data/extracted/` 一手解包字段为唯一源，**禁用合成占位**。实时进度以 `memory/project-status.md` 为准 | 全局 / Wiki | 搁置 characters.json schema v1.0 锁定（characters.json 已删，待 W2 重建时重订） |
| **产物落点强约定 + 路径生成器 — 守密人 2026-06-21 裁定（/grill 「产物每次路径都不一样」会话，授权艾瑞卡代写）**：根因=无「任何会话都能机械推导同一路径」的规则，每会话临场编→分隔符/日期格式/版本后缀三轴漂移（实测 `deliverables/` 同日报出现 `_v2`/`_full`/裸名四写）。裁定把**弱约定（文档）升级为强约束（脚本）**：落点 `Public-Info-Pool/Resource/{主题类型}/{主题}-{YYYYMMDD}[-rN].{ext}`（**填入第 63 条 4R 本体的 Resource 桶**，与 `Resource/projection/` 索引并列）；月目录废除（时间维度落文件名）；类型走**开放注册表** `Public-Info-Pool/types.json`——形式定死(kebab-case)、清单可增、新类型显式登记，脚本 `scripts/deliverable_path.py` 挡同义分裂与形式漂移（path/register/promote/rename-type）。C 类即兴草稿→ `Public-Info-Pool/Rough/`（**4R 之外第 5 个 R-sibling**，`.gitignore` 默认不进 git，人工 promote 进 Resource）。存量旧 `deliverables/`（40+ 文件 4 月）**全量迁移**、月目录清空；dateless 历史文件用月目录作月精度日期(YYYYMM，非捏造)。改 `report_render.py`/`biav-report.md` 落点 + CLAUDE.md §6.2/README 同步 | 全局 / 数据架构 | 取代 `deliverables/{YYYY-MM}/` 月桶约定；建于第 63 条 4R 本体之上 |
| **银芯定位翻回「公开信息层」— 守密人 2026-06-21 裁定（宽解，/grill 会话，授权艾瑞卡代写 §0）**：本会话拷问「Public-Info-Pool 是否触及定位」时，守密人裁定取宽解——银芯**整层**定位由「受限/非公开层」翻回**公开信息层**，自身工程产物（仓库审计等）亦属公开信息。**覆盖** 2026-06-11「受限/非公开层」裁定。**两条射程外硬约束明确不动**：(1) 公开**不解除**第三方平台 ToS 采集约束；(2) **§1.1-HC 黑池防火墙维持永久关闭**——黑池→银芯不开口子，且银芯越公开防火墙越关键（漏入即即时公开泄漏，重于受限层时）；「银芯公开」≠「黑池可进银芯」。CLAUDE.md §0 已同步改写（独立 commit，便于守密人单独复核/回退） | 全局 / 定位 | **覆盖 2026-06-11「受限/非公开层」定位裁定（翻回公开）** |
| **采集源命名与归档结构规范 — 守密人 2026-06-21 裁定（/grill 拷问对齐，授权艾瑞卡代写）**：① 数据根 `Public-Info-Pool/Record/Community/`（无 platforms 中间层）、层级 `平台/区服/类型/日期`（区服上、类型下、维度按需展开）；② source 标识 = 归档相对路径（`steam/jp/review`、`taptap/cn/post`、`discord/global`、`weibo`）；③ **区服准则**：不同 appid / 独立运营 → 拆区服目录，同 appid 多国 → 留 `platform_region` 字段；④ **日本版 = AltPlus Inc. 独立发行**各平台拆 `jp/`（Steam global 3052450/jp 4226130；AppStore 6447354150/6743462069；GooglePlay `com.qookkagames.z1.gp.hk`/`jp.co.altplus.boukyakuzenya`；X @MorimensOfcl/@bokyakuzenya；YouTube @morimensofficial/日本公式）；⑤ 单子类裸名、多子类显式、父子衍生（youtube 视频↔评论）收编不拆；⑥ taptap 364992 = 国服预约（非港台），cn 合并预约 + 测试服 374995（`app_id` 字段分），评论采全（440→1163）+ 补 post/strategy（Playwright）；⑦ `official`→`steam/global/news`、`youtube_comments`→`youtube/*/comments`、废弃重复 taptap 评论栈（aggregator `fetch_taptap` 仅 4 条）。配置单一真相源落 `sources.py`（REGION_APPS/TAPTAP_CN_APPS/DISCORD_GUILDS），规范详文 `projects/news/CONTEXT.md`。实施分阶段（配置→采集器→archive 分层→历史迁移） | news 采集层 | 旧 taptap/official/youtube/steam 裸名语义 + 扁平 `data/platforms` 布局 |
| **Discord 记录紧凑 schema 精简 — 守密人 2026-06-22 裁定（「这个方案很好，怎么推进」授权艾瑞卡执行）**：实测全量 721 万条 discord JSONL 中 **91.8% 字节是元数据 + 重复 JSON key，content 正文仅 8.2%**；`pinned`/`has_thread` 100%、`flags` 99.9%、`author_bot` 99.7%、`thread_id` 99.6%、`embeds` 98.8%、`edited_timestamp` 97.7% 恒为默认值。裁定采**紧凑 schema（变体 A）**：「缺字段=默认值」为契约，恒删恒定/空值字段（type=0/author_bot=false/pinned/flags=0/has_thread/thread_id=null/空 embeds/空 mentions·reactions·attachments/reply_to=null/edited=null），恒留 id·channel_id·author_id·author_name·content·timestamp，非空才留可选容器。**保留 channel_id（不取变体 B 丢 channel_id 省额外 250MB）**——纯文本档案核心价值是「grep 命中即自足、不寄生 channel_index.json」。**timestamp 全保留**（时序分析地基，非水分）。落地：单一权威定义 `projects/news/scripts/discord_compact.py`（归档器写盘 + 存量重写共用）；归档器写盘点改写紧凑（前向）；存量一次性 `scripts/compact_discord_archive.py` 重写 16,023 文件（幂等/原子写/可 dry-run）；只读测量器 `scripts/measure_discord_compaction.py` 出账。**效果**：discord 工作树 3.4G→2.0G（省 1381.5MB / 41.2%）。**验证**：60 文件 16,122 条同源 A/B（vs git HEAD）索引输入三元组（id/正文/日期/反应数）逐条无损；community_index 重建记录数不降反增（新采数据）；全量 pytest 绿。**代价**：.git 实际瘦身仍需历史压缩（守密人 §9 本地任务，本会话不改写历史）；丢弃的默认字段可由契约还原（`expand_record`），但「该消息曾被显式置默认」与「默认」不再可分（分析无关）。方案见 `memory/strategy/repo-slimming-plan.md` | 全局 / 仓库瘦身 | 建于 2026-06-21 数据本体总纲之上（text→git 后的体积优化） |
| **Discord 进一步瘦身止步 41% — 守密人 2026-06-22 裁定（「丢 timestamp 每次查时间还要从 id 还原 方便吗」一问点破）**：承上条紧凑 schema 后，auto-research 10 法择优（档案 `Public-Info-Pool/Resource/data-diagnostics/discord-compaction-further-savings-20260622.md`）。守密人裁定**到此为止，不丢 timestamp、不转 TSV**。核心识别——**信息无损 ≠ 使用无损**：今日 41% 删的是 `pinned`/`flags`/`embeds` 等恒默认、查询零价值的纯水分（零便利损失）；再往下省的 timestamp 是肉眼可读、grep/jq 可直接过滤的有用信息，丢了临时精确时间查须现解 snowflake，违「text 进 git 保 clone 即查便利」初衷。**41% 是「省体积」与「保便利」最优停点**。叠加硬事实：`.git` 在 §9 历史压缩前不缩，丢 timestamp 现省 355MB 连磁盘都落不了地。**唯一无便利代价的下一步 = 守密人本地 §9 历史压缩 + `git gc --aggressive`**（动 .git 2.1G、不碰字段）。#1 TSV/#2 丢 timestamp 归档为「已评估、因损便利/自描述不取」，除非未来体积压力远超便利诉求再翻案 | 全局 / 仓库瘦身 | 收束 2026-06-22 紧凑 schema 的「再往下省」议题（划定止点）|
| **使命#3「Studio 团队 AI 协作训练场」退役 — 守密人 2026-06-28 裁定**：全仓 md 矛盾审计（C6）揭示使命#3「主对接子项目」映射长期不一致（CLAUDE.md §1.2 写 `site / 全局`，v2.0 决策 M4 + `strategic-plan-2026.md` + `mission-v2.0-three-pillars.md` 写 `game（备扩展位）/ 全局`）。守密人裁定**取消使命#3**（非在 site / game 间择一）。银芯使命由「三新使命」收敛为**二核心使命**：#1 **黑池信息入口**（news 核心）+ #2 **社区共建知识底座**（wiki 核心）。「AI 协作训练场」不再作为银芯正式使命与 Phase 2 验收项；game 仍为守密人个人兴趣（不主线派发、不分配资源）。同步更新 CLAUDE.md §1.2/§1.3/§1.4/§6、README、`strategic-plan-2026.md`、`mission-v2.0-three-pillars.md`、`project-status.md`、`projects/game/CONTEXT.md`、贡献协议。 | 全局 / 战略 | 覆盖 2026-04-26 v2.0「银芯三新使命」之使命#3 及 M4 ⓐ「Studio 团队训练场」未来扩展定位（保留 game 为个人兴趣）|
| **measure_discord_compaction.py 退役删除 — 守密人 2026-07-02 裁定（「全部按你建议推行」，采纳覆盖率分析报告 P3 优先项）**：只读测量器历史使命已完成（2026-06-22 紧凑 schema 裁定的出账数字已固化于决策台账与 repo-slimming-plan），且其内嵌一份与 `discord_compact.py` 单一权威定义平行的精简规则副本，长期存在静默漂移风险、自身 0% 测试覆盖。裁定按报告建议退役删除（分析报告 `Public-Info-Pool/Resource/repo-engineering/test-coverage-analysis-20260702.md`）。历史文档中对该脚本的既往提及保留不改（史实记录） | 全局 / 仓库瘦身 | — |
| **死代码清理 + ARCH-01「保留休眠」反转 — 守密人 2026-07-02 裁定（动态编排死代码审计，PR #373 已合并）**：全仓动态编排审计（6 并行猎手扇出 + 对抗式核验）叠加 ruff/AST 静态分析，两轮清理未使用代码。**第一轮·安全档**（无争议、直接删）：30 未用 import + 4 未用局部变量 + 8 死模块常量（`_CJK_CHAR`/`mcp_server.REPO`/`ROUGH`/`extract_client_data.DB_DIR`/`generate_rss.META_PATH`+`FEED_TITLE_ZH`/`aggregator_base.SEARCH_KEYWORDS`+`ALL_KEYWORDS`/`split_output.OFFICIAL_SOURCES`）+ `build_okf_bundle` 死循环/write-only 变量 + `build_story_layer.make_parser` 废弃参数。**第二轮·守密人裁定档**（覆盖既有「保留」决定）：(a) **ARCH-01 休眠 youtube 采集器删除**——`aggregator_collectors` 的 `fetch_youtube`/`_fetch_youtube_web_search`/`_parse_yt_relative_time` + 单测 + test-collectors.yml AC-stack 导入，**反转** 2026-06-20 ARCH-01「AC youtube 函数与单测保留」及 2026-06-21 三层定性「youtube AC 函数系有意保留（非残留）」两处裁定；youtube 权威实现仍独归 GC 栈（`global_collectors.fetch_youtube` 未动）；(b) **discord 月度归档路径删除**——`discord_archiver.run_monthly_archive` + `--archive-monthly` 参数/分支/docstring + 死 `tarfile`/`subprocess` import + `TestMonthlyArchive` 测试，收束 2026-06-21「discord 全量 de-tier、退役月度 git_rm 瘦身」的代码残留清理；(c) **`build_banner_character_index.py` 整文件删除**——完全依赖 2026-06-15 清空的角色层，如 W2 需卡池↔角色索引须从一手解包字段重建。**保留**：`sources.py` SSOT 常量 `TAPTAP_CN_APPS`/`DISCORD_GUILDS`（守密人裁定留）。验证：pytest 1926 passed / 7 skipped / 14 subtests；能力目录活脚本 57→56、孤儿仍 0。分析溯源 `Public-Info-Pool/Resource/repo-engineering/test-coverage-analysis-20260702.md` | 全局 / 工程纪律 | 反转 2026-06-20 ARCH-01「AC youtube 函数与单测保留」+ 2026-06-21 采集器三层定性「youtube AC 有意保留（非残留）」；收束 2026-06-21 discord de-tier 的月度归档代码残留 |
| **知识库运行时动态导航 — 守密人 2026-07-04 裁定（「动态编排根据 OKF 和 LLMwiki 的思想实现银芯知识库」派发，会话内经 AskUserQuestion 确认核心形态）**：把静态 OKF bundle（§6.1）升级为**艾瑞卡运行时可动态导航的知识库**。守密人两点裁定：(1) 核心交付形态 = **MCP 运行时导航层**（在唯一运行时动态平面 MCP 上加知识库导航工具，而非仅离线索引或 llms.txt 门面）；(2) **LLMwiki** 指代 = **LLM 可动态导航的知识库**（wiki 结构化到 LLM 能顺关系图逐跳导航、按需取概念）。落地：① `scripts/build_kb_index.py` 从 bundle（concept 元数据 + 正文 + `graph.json`）造静态导航索引 `okf/kb_index.json`（倒排表 + 邻接表，复用 `silver_tokenizer` 词典法分词，**确定性零 ML 零常驻**，与 community/story 索引同家族）；② `scripts/mcp_server.py` 增 `kb_search`/`kb_get`/`kb_neighbors`/`kb_overview` 四工具（4→8），后端 `scripts/kb_navigator.py`（import-only 库）；③ 索引随 `build_okf_bundle.py` 末尾自动重生成、随 `--tarball` 单向输出物一起走。**放指针不放本体**：导航层只返回元信息 + `resource` 指针，本体原地不动（呼应三条铁律）。验证：`test_kb_index.py`（索引完整性 + 导航四原语 + MCP 工具）全绿；能力目录 MCP 工具 4→8、顶层活脚本 +2、孤儿仍 0。CLAUDE.md §1.4 第 5 条 / §6.1 同步 | 全局 / 知识库 · 动态编排 | 建于 §6.1 OKF bundle 之上（静态层→运行时动态导航层） |
| **全仓知识组织进 OKF 知识库 — 守密人 2026-07-04 裁定（「使用 ultracode 组织整个仓库所有知识，包括归档的社区数据」派发，多代理编排落地）**：承接同日「知识库运行时动态导航」，把 OKF bundle 从 4 层扩到**覆盖全仓知识域**。经 ultracode 编排（`organize-repo-knowledge` 工作流：9 域并行测绘 + 合成统一规格 + 完备性批判；`verify-repo-knowledge-org` 工作流：5 维对抗式核验）产出规格并实现。落地：① 新库 `scripts/okf_pointer_layers.py`（import-only，声明式 per-layer builder）+ `build_okf_bundle.py` 扩展 `build_memory`/`build_story` 至全层 + 跨层 graph 模式边；② bundle 现 **12 层 / ~293 概念**：原生 characters(72)/sources(17)/memory(45,扩)/story(11,扩) + 新增 assets(12)/wiki-data(26)/**community(19,归档社区全量档案分析镜头)**/news-output(23)/unpacked(13)/extracted(4)/resource(34)/projects(17,含 CLAUDE.md/README 入口 + 子项目 CONTEXT + 藏宝图 + 设计文档)；③ kb_index 随之覆盖 294 概念，`kb_*` 运行时导航跨全仓。**三条铁律守恒**：除 characters 唯一本体层外全 pointer（归档社区 2.1G / 解包 44M 绝不复刻进概念，概念文件 <4KB）；data_layer 标层（community/unpacked/extracted→full_archive、news-output→output、其余→curated，防 lesson #30）；黑池防火墙同向（全为银芯自有公开知识，无 BIAV-BP 数据）。community/news-output 归档路径共用 `archive_layout` 单一真相源防漂移。经 `verify-repo-knowledge-org` 5 维对抗式核验（三铁律零缺陷）闭合 must_fix（补 CLAUDE.md/README 入口概念、订正 luac 描述、补 schemas/site-design/bpt-docs）。验证：全量 pytest 2467 passed / 10 skipped；能力目录活脚本 60、孤儿 0；bundle 零 discipline flag（指针无落空）。CLAUDE.md §6.1 同步 | 全局 / 知识库 · 知识组织 | 建于同日「运行时动态导航」与 §6.1 OKF bundle 之上（4 层→12 层全仓覆盖） |
| **银芯知识层定位锚定「神经符号白盒骨架」— 守密人 2026-07-04 会话结晶（承 #386 运行时导航 / #396 全仓知识组织之后的定位对齐）**：把知识层的**存在理由**钉死——**OKF = 有结构的概念网络，承载白盒结构化知识；区别于神经网络承载的黑盒知识**。三器官分工：白盒概念网络（骨架：可枚举/可审计/可测试/可程序操作）+ 搜索（结缔组织：钻血肉）+ LLM 神经（肌肉：推理泛化、会脑补）。**三条工程命令**：(1) 白盒只花在骨架上（放指针不放本体的更深形态=白/黑盒边界，扁平孤立指针=付了白盒代价没买到白盒好处）；(2) 把不变量测起来（白盒=唯一能写测试/程序操作的知识，可审计→可治理）；(3) 死守覆盖哨兵（白盒招牌死法=假完备，覆盖哨兵是唯一守卫）。**两条神经系统教益**：符号底座+神经式动态（扩散激活检索=杀手级消费）、像脑地剪枝（价值不在边多在每条边是否携带别处得不到的信号，#393 删画师边=突触修剪）。**现状基线**：约 200/293 概念度数=0（孤立指针群岛），扩散激活在群岛上会死→「连成真网络」是地基。北极星全文 `memory/knowledge-layer-design.md`（含改造路线 A 连网络→B 治理不变量→C 覆盖哨兵→D 扩散激活→E 减易变）。落地进度以 project-status 为准 | 全局 / 知识库 · 定位 | 锚定知识层北极星，统辖后续 KB 投资方向；承 #386/#396 |
| **知识层 Pillar A 边策略「选 1」+ 两层结构落地 — 守密人 2026-07-04 裁定**：承北极星（`memory/knowledge-layer-design.md`），Pillar A「连成真网络」有边策略分叉（孤立参考层 memory/resource/assets/extracted：①只连真结构留 search-tier / ②补策展边 / ③模糊自动连）。守密人裁定**选 1**（只连真机器可 derive 结构，参考层坦诚 search-tier）。**实测收束**：勘查证明除现有 variant/lore/cross 外几无可加的干净高信号边（character_story_links 14 角各属不同章节=零同簇可连；wiki-data→角色=大容器成员噪声星，思想反对）。故 A 从「加边」转为「**显式声明两层结构**」：skeleton（characters/sources/community/news-output，实测连通 76%）vs search（其余参考层，有意孤立、kb_search 可达）。落地：`build_kb_index.SKELETON_LAYERS`+`tier_of` → 概念/graph 节点带 `tier` 字段、kb_index `by_tier` 统计、kb_navigator overview 报告两层；绊线 `test_skeleton_is_actually_connected`（骨架连通率≥60%）把「200/293 孤立」从缺陷锁成设计属性。教益：诚实分类 > 强行连接（命令一「白盒只花骨架」的兑现）。北极星 §七/§八 同步 | 全局 / 知识库 | 承北极星锚定；Pillar A 完成，下一步 D 扩散激活检索 |
| **BPT 定位三层裁定 — 守密人 2026-07-04 裁定（/grilling 拷问对齐会话逐问裁定，授权艾瑞卡代写）**：**（甲·本体）**建现行定位档 `memory/bpt-positioning.md`（取代 2026-04-12 冻结命题）：① 服务对象团队级**已兑现**（团队已在用，BPT 为在产工具）；② 官方 Claude Code 从未办公环境大规模可用，BPT 系旧内核基于 claude agent sdk 被 2026-07-03 禁令**波及**（非对标物）；格局 = Qoder 部分人不可用 + 黑池最强最懂项目（聊天/社区/工程/任务/文档/知识全打通），护城河 = 打通广度、头号软肋 = 记忆管理与知识结构混乱（同源两面）；③ 双主词 = **元工具层 + 元知识层**并列一等公民（守密人命名）；④ 工具层**自持为主权要求**（地缘/数据主权/集团路线摇摆/公司可交易性，「依赖外部工具」即定位级风险，禁令只是引爆点）；⑤ **模型可替换性入定位硬承诺**（多 provider 含国产；可替换≠等效；以 Claude 体验为范式参考但不限定）。**（丙·双系统角色）**指导协议升级 **v0.3**：黑池 fetch 银芯仓库为主消费通道（方向合规：公开层被动被拉取，防火墙无涉；银芯档案/代码质量即接口质量）；对话搬运收窄为「战略裁定 + 回流过滤」双职能；守密人角色改写为「唯一裁定者 + 回流过滤器」（黑池现实只能经守密人亲述认可回流）；对痛点「元知识层混乱」采 **A+B 双输出**（方法论：OKF/4R/放指针不放本体/索引家族/踩坑 + 工程产物：bpt-agent-sdk 先例/kb 工具族），均经 fetch 交付。**（乙·SDK 复核）**POSITIONING.md 核心条款（钉基线 0.3.199/选择性追踪/四效率齿轮/测量强制令）**零推翻**，三处修订：主权叙事升格（净室引擎系元工具层主权必然而非应急）/ 行为保真参照系精确化为「禁令时点旧内核体验」（移动靶→**固定靶**，钉基线获第二重依据，A/B 对照基线定义为旧内核行为）/ provider 可替换性由特性升格为定位硬承诺 | 全局 / BPT · 双系统 | 取代 2026-04-12 冻结版 BPT 核心命题（作现行答案，冻结档不动）；升级 bpt-guidance-protocol v0.2→v0.3（Code-BPT 专岗设定随多会话架构退役一并收束）；2026-04-19「BPT 战线移出银芯」仍生效 |
| **知识层 Pillar D 扩散激活检索落地 — 守密人 2026-07-04「再 D」派发**：承北极星（`memory/knowledge-layer-design.md` §五），在骨架层上实现「概念网络 ≠ 搜索」的杀手级消费——`kb_activate`（MCP 第 9 工具，后端 `kb_navigator.activate`）：从种子（概念 id 或检索词）沿带类型的边**多跳带衰减扩散**、**按边类型加权**（variant 1.0/lore 0.9/cross 0.7/link 0.5/cv 0.15——「剪枝即加权」，高信号传得远、弱信号近乎不传），返回被点亮子图=联想召回。确定性零 ML（纯查表+算术）。为此 `build_kb_index` 的 neighbors 携带 `rel_type`（供加权）。实证：`activate("discord")` 从 sources/discord **跨层点亮**其全量档案镜头（同平台）+ 输出层抽样（抽样自）+ 分析索引（聚合于）——三者内容零重叠、搜索永远连不到，图顺结构走到。`沙耶` 仅 CV 弱边→激活微弱（诚实反映权重）。守护 `tests/test_kb_index.py`（扩散/加权/确定性/兜底）+ MCP 9 工具断言。CLAUDE.md §1.4 / 北极星 §七 同步 | 全局 / 知识库 | 承 Pillar A/B；北极星改造路线余 C 覆盖哨兵、E 减易变 |
| **知识层 Pillar C 覆盖哨兵 + E 减易变落地（北极星改造路线收尾）— 守密人 2026-07-04「再做 CE」派发**：承北极星（`memory/knowledge-layer-design.md`）命令三与减易变。**C 覆盖哨兵**（守白盒招牌死法「假完备」）：`tests/test_kb_coverage_sentinel.py` 扫全仓知识文件（KNOWLEDGE_GLOBS），断言每个被某概念 `resource` 覆盖（直指或目录指针涵盖），未覆盖即报错，逼建层/补指针/显式豁免（ALLOWLIST 附理由）——自动化 ultracode 批判员当初人工活；实测仅 `projects/wiki/data/processed/README.md`（层索引 meta）一处豁免、余全覆盖。**E 减易变**（锐化白/黑盒边界）：`okf_pointer_layers._magnitude()` 把 community 每时增长的精确条数（7,565,639）→ 量级桶「百万级（精确值见指针本体）」，保「大 vs 小」信号、杀每时 churn、活数字推回指针后；聚焦 community（唯一每时源），unpacked/extracted 罕变留精确。**至此北极星五支柱全落地**：A 两层结构 / B 治理不变量 / D 扩散激活 / C 覆盖哨兵 / E 减易变。守护 `test_kb_coverage_sentinel.py`（覆盖+allowlist 防腐）。北极星 §七/§八 + project-status 同步 | 全局 / 知识库 | 承 Pillar A/B/D；北极星改造路线收尾完成 |
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

> **2026-07-02 反转**：上述「youtube AC 函数有意保留」已被守密人裁定推翻——`aggregator_collectors`
> 的 `fetch_youtube` 及子树连同单测已随死代码清理删除（见当前有效决策表「死代码清理 + ARCH-01
> 保留休眠反转」条）。youtube 权威实现仍独归 GC 栈。

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
