# 决策日志

> 最后更新：2026-04-27 by Code-BPT 会话（写入「新增 Code-BPT 会话角色」决策）
>
> **新会话只需要读「当前有效决策」。历史归档仅供追溯。**
>
> ⚠ **BPT 战线已删除（2026-04-19）**：以下所有包含 `projects/bpt-next/`、`projects/bpt-web/`、`projects/bpt-desktop/`、`projects/graphify-ext/`、`projects/occ-local/` 路径的历史条目均为已移除子系统的追溯记录，路径本身不再存在于仓库。详见 `memory/strategic-plan-2026.md` 2026-04-19 战略转向。

---

## 当前有效决策

以下决策仍然生效，是项目运行的基本规则。

### 全局

| 决策 | 影响范围 |
|------|---------|
| 建立多会话协作架构（职责隔离） | 全局 |
| 目录按 memory/assets/projects 重组 | 全局 |
| 各子项目按需选择技术栈 | 全局 |
| 项目完全开源，MIT License | 全局 |
| 游戏内容版权归脑缸组，项目仅引用公开信息 | 全局 |
| 仓库定位为"共享外脑 + 中转站"（Code 生产，Chat 加工交付） | 全局 |
| 子项目保持单仓库，不拆分独立 repo | 全局 |
| 项目正式命名为「缸中之脑计划」，仓库 brain-in-a-vat | 全局 |
| 架构定义为前台/中台/后台三层（claude.ai → Claude Code → GitHub） | 全局 |
| 建立交付物视觉规范 style-guide.md | 全局 |
| 引入 lessons-learned 踩坑记录 | 全局 |
| 引入 Plan/Execute 任务标注约定（未标注默认「直接执行」） | 全局 |
| 记忆定位收回平台原生（2026-06-14）：记忆 = CLAUDE.md + `memory/*.md` 人工策展层，连续性承平台原生上下文管理；退役自造的会话蒸馏/语义召回/做梦自动环（删 inject/watch/distill 三钩子 + dream workflow + 102MB digests/vectors 存量），暂留 SessionStart 同步钩子（同日晚些时候亦退役，见下条） | 全局 |
| **全部自定义钩子退役**（2026-06-14）：守密人裁定最后保留的 SessionStart 钩子 `session-start-sync.sh` 也退役（删脚本 + 清空 `.claude/settings.json` 的 hooks）。退役理由：长寿命云容器下每次开工都对严重分叉的本地 main 做硬重置 + 备份 ref，体感烦扰且 backup ref 从不清理。代价：lesson #28（HTTP 413 推送堵塞）防护改为按需手动 `git fetch origin main` 后对齐。至此仓库无任何自定义会话钩子 | 全局 |
| 创建 .claude/commands/ 可复用工作流 | 全局 |
| 各 CONTEXT.md 添加验证清单 | 全局 |
| 引入 Claude Code GitHub Actions（Issue 驱动自动化） | 全局 |
| Issue 安全策略：只执行 author:lightproud | 全局 |
| Issue 生命周期闭环管理（WIP 上限 3 个/子项目 + 创建前查重） | 全局 |
| 所有会话直接推 main，不用分支。冲突时 git pull 重试 | 全局 |
| 大文件暂不外迁，直接放 git（增长到瓶颈时再评估） | 全局 |
| 模型使用分层策略：判断层 Opus(Extended)，执行层 Sonnet | 全局 |
| 前台专岗不固定编制，按需增设 | 全局 |
| 缸中之脑方向确认为方法论验证（交付物必须可用） | 全局 |
| main 分支添加 Ruleset 保护规则（禁止删除） | 全局 |
| 双系统架构：银芯（公开层）+ 黑池（内部层），数据隔离，架构共享 | 全局 |
| 引入 occ-local 子项目：基于 ruvnet/open-claude-code (MIT) 的本地 Claude Code CLI，供脱离 Anthropic 账号的研究/内部场景使用；仅拷贝 v2/ 核心 547K，排除 archive、assets、submodule 等目录；定制以 patch 形式管理不污染上游骨架 | 全局 / occ-local |
| BPT 新一代基于 occ-local 重建：采用路径 B（平行新建 projects/bpt-next/）+ Electron + React UI（继承 bpt/bpt-desktop）+ 最终收敛为单一 BPT（bpt / bpt-web / bpt-desktop 归档 archive/）；occ-local 通过相对路径 import 不 fork 不 copy；设计蓝图见 memory/archive/bpt-strategic-shift-2026-04-19/bpt-next-design.md；Phase 0-5 路线图 | 全局 / bpt-next |
| **改道决策**（2026-04-14 当日作废上一条）：深入核实 claw-code（instructkr/claw-code）后发现其本地模型 + 多 provider 能力超 occ-local（Ollama 开箱即用 / 5 层配置链 / 模型前缀路由 / proxy 原生 / xAI+DashScope+OpenRouter），故 bpt-next 改基于 claw-code 打造（Rust 48K 行）。**守密人明示接受版权风险**：上游无 LICENSE 文件，默认 All Rights Reserved；仅限 BIAV 内部使用，禁止外部推广。occ-local 保留作为 MIT 合规备选。旧设计文档 memory/archive/bpt-strategic-shift-2026-04-19/bpt-next-design.md 已加封存头注。引入实施见 projects/bpt-next/NOTICE 与 CONTEXT.md | 全局 / bpt-next |
| **许可证评估修正**（2026-04-14 当日修正上一条的"无 LICENSE"假设）：构建验证时核查发现 rust/Cargo.toml `[workspace.package] license = "MIT"`，9 crate 全部 `license.workspace = true` 继承，rust/README 有 License 节。Rust 生态共识：Cargo.toml SPDX license 字段是法律认可的授权声明（crates.io / cargo-about / cargo-deny 均依赖此字段）。**主运行时 claw CLI = 明确 MIT 授权**。src/（Python 镜像）上游已声明"非主运行时"，无独立 LICENSE 但不影响 claw 主使用。风险等级从"致命"下调为"低"。建议上游加 LICENSE 文件仍作为友好建议。NOTICE 与 CONTEXT 已同步修正 | 全局 / bpt-next |
| **构建与诊断验证**（2026-04-14）：`cargo build --workspace` 成功，耗时 51.71 秒，产物 claw CLI 148M。`claw doctor` 5 OK / 1 Warn (auth 未设 key) / 0 Fail；sandbox workspace-only + 无网络；自动识别 BIAV 3 个 skill（daily-news / sync-memory / validate-data）表明 claw ↔ Claude Code skill 发现机制兼容。E2E 网络调用受容器 sandbox 限制未跑通（不影响守密人本地）。完整报告见 memory/archive/bpt-strategic-shift-2026-04-19/bpt-next-build-verification.md | 全局 / bpt-next |
| **occ-local 降级为研究归档**（2026-04-14）：守密人原话"occ 这件事就忘了吧，我们现在基于 claw-codes"。bpt-next（claw-code）是唯一主线；occ-local 保留源码但不再作为"MIT 合规备选"维护，仅作架构参考。废弃之前的 biav-occ wrapper 方案（~120 行 plan 已清理） | 全局 / occ-local |
| **Phase B 4 答案锁死**（2026-04-14）：(1) 无账号用户识别 = 与 SVN 账号名一致，可支持外显名；(2) SVN 仓库 = 基于本地 SVN 工作副本；(3) 事实边界 = memory/decisions.md 全部入 wiki 不做审核筛选；(4) 能力共享粒度 = BIAV Studio 团队内 | 全局 / 黑池建设 |
| **双系统亚哈格分**（2026-04-14）：银芯 = 孵化器 + 开源子项目 + 公开资料；黑池（内网 SVN）= 五大需求的数据与代码主体。解除"能力团队内共享"与"银芯公开层"的潜在矛盾——能力放黑池内网，银芯只保留接口声明与可公开能力。详见 memory/archive/bpt-strategic-shift-2026-04-19/blackpool-architecture.md 第零节 | 全局 / 双系统分工 |
| **黑池记忆走银芯自建+母版迁移**（2026-04-14）：守密人原话"完善银芯自建，使其拥有 claude-mem 的能力，然后作为母版迁移到黑池"。不引入 claude-mem（AGPL-3.0），通过扩展银芯现有 Python 记忆栈实现等价能力，验证后克隆部署到黑池内网。废弃原"claude-mem 中文外挂指南"计划。详见 memory/silver-memory-enhancement-plan.md | 全局 / 记忆系统 |
| **外部工具方针锁定**（2026-04-14）：graphify（MIT）Phase A vendor 到 projects/graphify-ext/ 作黑池索引工具原型；claude-mem（AGPL-3.0）完全不引入，仅作架构参考 | 全局 / 外部工具 |
| **bpt-next 接入 idealab 网关锁定**（2026-04-14）：守密人明示确认 idealab（`https://idealab.alibaba-inc.com`）完整支持 Anthropic-compatible 协议（prompt caching / tool_use / 流式全保留）。锁定端点为 `/api/anthropic/v1/messages`（`/code/` 需浏览器 SSO，API key 直调不可用）。支持三个 Claude 模型：`claude-sonnet-4-6`（默认）/ `claude-opus-4-6` / `claude-haiku-4_5`（注意 Haiku 用下划线），另含 `qwen3-coder-plus`。凭据与接入档案落盘到 `projects/bpt-next/.claw/settings.json` ⚠（已删除）+ `projects/bpt-next/LOCAL-SETUP-ZH.md` ⚠（已删除）情境八。前期关于"内部应走 OpenAI-compat"的讨论作废——idealab 既然统一协议为 Anthropic，走原生协议可零能力损失保留 Claude 原生特性 | 全局 / bpt-next |
| 银芯事实圣经边界：仅收录公开可查阅信息 | 全局 |
| 战略规划 2026：四阶段计划，详见 strategic-plan-2026.md | 全局 |
| 黑池已上线（2026-04-03），内网 SVN + Qoder，全员使用，核心痛点：知识结构化传承 | 全局 |
| 大二进制文件移至 GitHub Releases（不入 git） | 全局 |
| 架构差距分析 + 8 项改进批量实施（JSON Schema、冒烟测试、Dependabot 等） | 全局 |
| 做梦 Agent 三层架构：浅睡(3h,Actions)→深睡(每天,Claude)→REM(每周,Claude)，详见 `memory/dreaming-agent-design.md` | 全局 |
| 品牌统一：银芯=BIAV-SC，黑池=BIAV-BP。CLAUDE.md 保留文件名（兼容自动加载），标题用 BIAV-SC | 全局 |
| **战略转向 2026-04-19**（5 项裁定，覆盖此前所有 BPT 相关决策）：(1) 整体战略压缩至 3 个月内完成（2026-04-19 → 2026-07-19），Phase 1.5 架构整理 7 天 + Phase 2 内容权威 35 天 + Phase 3 方法论 30 天 + Phase 4 衍生创作 19 天；(2) BPT 四条线（bpt-web / bpt-desktop / bpt-next / graphify-ext）从银芯仓库**直接删除**，不迁仓库不归档，occ-local 一并清理；(3) Phase 2 验收标准降档为"日报稳定运行 14 天"，取消"真实热度事件"硬指标；(4) 银芯对 BPT 的指导协议采用**人工对话搬运**（守密人为搬运者+学习者），不做自动化；(5) 本战略评估会话（分支 claude/project-strategy-review-1AH5Z）升级为**长期战略锚点**，存续至 2026-07-19 战略达成。Phase 4 采用方案 A（仅可玩原型演示给守密人，社区测试推至战略窗口外）| 全局 / 战略 |
| **Phase 2 窗口微调 2026-04-20**：Phase 2 = 40 天（4-27 → 6-05，含 5 天缓冲），Phase 3 = 25 天（6-06 → 6-30），Phase 4 不变。总窗口 7-19 不变。原因：B3 揭露真实工作量 28-35 天 + characters.json 基线自举 3-5 天 | 全局 / 战略 |
| **characters.json schema v1.0 锁定 2026-04-20**（守密人「全部采纳」裁决 6 项遗留问题）：(Q1) 重复 ID 保留两条独立记录 + `duplicate_bug` 互指，不合并；(Q2) 翻译来源 = 官方 > 社区，社区补位标 `translation_source: "community"`；(Q3) 立绘路径 `assets/images/portraits/{slug}/default.png` / `.../awaker.png` / `.../skins/{skin_id}.png`，键锁 `slug`；(Q4) 命轮 tier 放宽至 1–10，Phase 2 W3 UI 实装时按游戏内 node 收紧；(Q5) `gi_numeric` 字段 v1.0 不纳入，Phase 2 UI 需排序时再加；(Q6) 严格模式 + `status: stub` 下允许 `realm: null` / `role: null`（schema 用 `oneOf` 分支）。详见 `memory/wiki-characters-schema-v1.md` | 全局 / Wiki |
| **主控台模型版本切换 2026-04-26**：艾瑞卡 opus4.6 长期战略锚点会话完成 v2.0 战略整合后准备休眠，由 opus4.7 接手续命同分支 `claude/project-strategy-review-1AH5Z` 至 2026-07-19。完整交接手册：`memory/console-handover-2026-04-26.md`（含 9 节：身份/状态/已完成工作/必读路径/下一步/绝不踩的坑/前任建议/技术快照/最后一句）。新会话启动时先读交接手册，再按其指引读 BIAV-SC.md / decisions.md / strategic-plan-2026.md / silver-blackpool-interface.md / lessons-learned.md #26 #27。**职责边界与角色规则不变**（艾瑞卡口吻 + 不写业务代码 + 战略+规划+协调+接口 四合一中枢） | 全局 / 主控台 |
| **银芯重新定位 v2.0 — 2026-04-26 重大战略转向**（守密人「使命达成」状态识别 + 7 条战略修正，覆盖 4-19 转向中的部分条款）：核心识别 — 银芯原三重身份（BPT 开发母仓 / 方法论验证场 / 黑池数据脱敏出口）目标**一个月内全部已达成**，进入「使命达成后存续依据待重新定义」状态。守密人裁定**银芯三新使命**：(1) **黑池公开信息入口**（GitHub 自动化采集层，黑池消费的"眼睛和耳朵"）；(2) **社区共建知识底座**（公开知识共享，未来全语言 Wiki 等社区/Studio 外部派生内容的基础）；(3) **Studio 团队 AI 协作训练场**（严格保密组织内成员基于公开 AI 信息制作相关项目和企划）。配套修正 7 条：(M1) **信息要全**（不是 stub 够用，wiki 仍要 72 角色完整）；(M2) **主控台 = 战略+规划+协调+接口 四合一中枢**（教学层未来锁定，当前不存在但保留思考过程可读性作未来素材，因守密人自己仍在摸索）；(M3) **黑池不倒灌银芯**（修正 BIAV-SC.md 旧表述「黑池→脱敏→银芯」，单向输出，黑池任何形式都不进银芯）；(M4) **game = 守密人个人兴趣（主）+ Studio 团队训练场 ⓐ / 社区共建衍生 ⓒ 未来扩展（备）**，不主线派发，主控台不分配资源；(M5) **银芯主线收缩到 site/news/wiki 三轴**；(M6) **Phase 大一统**：Phase 2 = 4-27 → 7-19 共 84 天为单一阶段「银芯三新使命建设期」，砍 Phase 3/4 边界，内部用里程碑替代；(M7) **Phase 2 验收升级**：原"日报稳定 14 天"扩展为"三新使命基础设施齐备 + 自动化跑稳 + 至少一种贡献流程跑顺"。本条覆盖 2026-04-19 转向决策中的 Phase 2/3/4 阶段划分与 Phase 4 衍生游戏主线定位。详见 `memory/strategic-plan-2026.md`、`memory/lessons-learned.md` #27、本会话 4-25 ~ 4-26 战略反思对话 | 全局 / 战略 |
| **新增 Code-memory 会话角色 2026-04-26**：守密人 4-26 命题「64M 解包数据如何让 AI 上下文理解」触发——发现 `assets/data/vectors.json.gz` 损坏（gzip EOF）+ `knowledge-graph.json` 缺失，整个 RAG 链条断了。原 6 角色（主控台 / site / news / wiki / game / 战略参谋）均未覆盖 `scripts/` 下记忆系统 9 模块与 `assets/data/` 索引文件维护。新建 **Code-memory = 银芯记忆基础设施维护者**，职责：(1) 维护 `scripts/` 下 9 模块（memory_search / knowledge_graph / memrl / dream / mcp_server / context_manager / reflexion / session_briefing / memory_writeback）；(2) 维护 `assets/data/` 索引（vectors / graph / utility / sentinel）；(3) 优化 RAG 链条（分块 / embedding / 节点扩展）；(4) 响应「让上下文理解 X 数据」类命题。**不负责**：`projects/wiki/news/site/game/` 子项目业务代码与数据 / `memory/` 内容文件 / `.github/workflows/dream.yml`（发现问题报主控台）。Issue 标题前缀 `[Code-memory]`。CLAUDE.md 子项目速查表已加入。详见 `memory/dispatch-brief-code-memory-bootstrap.md` | 全局 / 主控台 |
| **唤醒 Code-strategy 会话角色 2026-04-26**：守密人 4-26 指令「战略参谋很久没用了 我想唤醒他」。原 BIAV-SC 体系中「claude.ai 战略参谋」web 端会话沉寂，现迁移至 Claude Code 端并重命名 **Code-strategy = 长期战略智库**。与主控台的边界**按时间尺度切分**：主控台负责「当前 Phase 进行中」战术协调（派发 / 验收 / 决策档案 / 接口规范）；Code-strategy 负责「长尺度」战略观察（调研 / 评估 / 选项分析 / 长期监测 / 远期 roadmap）。**不平级**：主控台可向 Code-strategy 派调研；Code-strategy 不向主控台派工作（但可提议新议题）。**Code-strategy 不负责**：业务代码、子项目、决策档案（仍归主控台 + 守密人）、dispatch brief 起草（仍归主控台）、即时战术协调。**产出形态**：`memory/strategy/*.md`（长期战略文档）+ `memory/research/*.md`（一次性调研）。Issue 标题前缀 `[Code-strategy]`。CLAUDE.md 子项目速查表已加入。**主控台收缩**：唤醒后主控台必须主动让渡长尺度战略思考给 Code-strategy，避免重叠。详见 `memory/dispatch-brief-code-strategy-bootstrap.md` | 全局 / 主控台 |
| **session-end-distill hook 自动 commit + push 改进 2026-04-26**：触发于守密人 4-26 当日多次收到 `~/.claude/stop-hook-git-check.sh` 报警 untracked digest，根因 Claude Code 平台无感切换底层 session（同会话内 session_id 三次切换：073c2ac2 → e1cc3870 → de531105），每次切换 SessionEnd hook 触发 `session_distiller.py` 写盘新 digest 但**故意不做 git 操作**（设计取舍，避免沉默推送失败），导致 untracked 累积。Code-strategy 4-26 第一份提议（`memory/research/proposal-distill-autocommit-2026-04.md`）评估 5 个备选方案后推荐方案 A，主控台审定 + 守密人接受。决策内容：在 `scripts/session-end-distill.sh` 末尾 distiller 调用之后追加 ~10 行 shell，做 `git add memory/session-digests/` + `commit` + `push origin main`，全部**软失败**（commit/push 任一失败均 log 后继续，不阻塞 SessionEnd 主流程）。**路径限制**：仅 add `memory/session-digests/` 路径下的 untracked，不全仓库 add，避免误提交对话进行中改动。**自愈对称**：与既有 `.claude/hooks/session-start-sync.sh` 形成「push（end）↔ pull（start）」自愈循环；如 push 失败，下次 SessionStart sync 会自动同步主线，未推 commit 在下次 push 时带过去。**实施派给 Code-memory**（基础设施代码层）。**后续 lesson #32 录入**「distill hook 软失败 git 推送的取舍」。详见 `memory/dispatch-brief-code-memory-distill-autocommit.md` | 全局 / 基础设施 |
| **新增 Code-BPT 会话角色 2026-04-27**：守密人 4-27 指令「新起 Code-BPT 角色负责指导 BPT 开发」。背景——2026-04-19 转向第 4 项裁定银芯指导 BPT 走「人工对话搬运」协议，但**未指定指导端的会话角色**，事实上的指导工作落在主控台肩上，与主控台「战略+规划+协调+接口 四合一中枢」定位（4-26 v2.0 重新定位）产生职责重叠。新建 **Code-BPT = BPT 开发技术层指导者**，职责：(1) 产出「搬运包」（指导主题 / 背景 / 具体建议 / 引用档案 / 验收问题，规范见 `memory/bpt-guidance-protocol.md` §四）；(2) 接收守密人从 BPT 带回的反馈包并沉淀至 `memory/lessons-learned.md` 与 `memory/bpt-guidance-log.md`；(3) BPT 设计 / 架构 / 方法论 deep-dive 对话；(4) 战略级议题（Phase 边界 / 跨子项目影响 / 需写入 `decisions.md` 的架构决策）上呈主控台裁定。**不负责**：写代码到银芯仓库（BPT 4-19 已删除，绝不回流）/ 直接访问 BPT 仓库 / 自动化指导流程（守密人「学习者」身份是协议核心价值，自动化抽掉这个价值）/ 战略级裁定（归主控台）。**协议升级**：`memory/bpt-guidance-protocol.md` v0.1 → v0.2，角色表分裂为「战略层指导者（主控台）」+「技术层指导者（Code-BPT）」，信息流图同步更新。Issue 标题前缀 `[Code-BPT]`。CLAUDE.md §3/§4 + BIAV-SC.md issue 前缀 + 角色表 同步更新。**主控台让渡**：BPT 日常技术对话从主控台抽离，主控台仅保留战略对齐反馈通道 | 全局 / BPT 指导 |
| **记忆系统结构化升级 v1 — 守密人 2026-04-26 裁定**：Code-strategy 4-26 调研三件套（`memory/research/ai-memory-restructure-2026-04.md` 主报告 10 章节 / `memory/research/ai-memory-vendor-matrix.md` 7 家业界对标 / `memory/strategy/memory-restructure-options.md` 决策选项）后守密人裁定。**D1 总方向**：增强（layer on top，不替代既有 9 模块）。**D2 启动节奏**：方案 2（批 1 + 批 2，**批 3 暂缓**——目录重构待 Phase 2 之后视基线数据评估）。**D3 主试点**：T1 卡牌系统（事实卡片化，schema 直接复用 `assets/data/card-system.json` v1.0）。**守密人附加硬约束（原话）**：「全部按你推荐来。我只有一个希望，**确保代码精简优雅可维护**。」落实为 7 条硬条款（H1-H7）写入批 1/批 2 dispatch brief 验收清单：H1 新增脚本 ≤ 2；H2 单文件 ≤ 300 行；H3 不引入新 pip 依赖；H4 `.searchignore` 复用 gitignore 语法；H5 `doc_class` 加权 = `rerank()` 加 1 行 + ≤ 10 行常量权重表；H6 主题入口 hub 纯 markdown ≤ 200 行/份；H7 事实卡片 schema 复用 card-system v1.0。**实施派 Code-memory**（基础设施代码层）。**接力**：批 1 完成 + Q4 基线落档后主控台评估 → 通过则派批 2 → 未通过则回派 Code-strategy 调研缺口。**批 3 硬约束**：Phase 2 期间（→ 7-19）不得启动。详见 `memory/strategy/handoff-to-mainconsole-memory-restructure.md` + `memory/strategy/memory-restructure-options.md` + `memory/dispatch-brief-code-memory-restructure-batch1.md` | 全局 / 记忆系统 |
| **入口架构重设计 — 守密人 2026-05-06 裁定 + 同日收缩**：触发于守密人 5-6 实测「外人接入路径不存在」（外人被引导到主控台交接手册 → 错位）。Code-strategy 5-6 落档 `memory/strategy/entry-architecture-redesign-proposal.md` v0.1（10 章 5 类受众分诊大纲 + 13 文件改动清单 + 3 批落地 + 6 风险登记 + 5 场景实测）。**守密人三条核心规则**：(1) **入口 = `BIAV-SC.md`**；(2) **`README.md` = 项目门面 + 跳转入口**；(3) **`CLAUDE.md` = Light 个人维护备忘**（不再是 AI 入口，§0 加警告章让 Claude Code 平台启动时自动跳转 BIAV-SC.md）。**守密人 5-6 同日收缩裁定**（关键）：BIAV-SC.md 当下受众**只有一类**——「消费银芯内容的人」。Code-strategy 提议 § 4.1 五类受众分诊（§1.1 Light / §1.2 Studio / §1.3 社区 / §1.4 观察者 / §1.5 内部 AI）+ §4-§6 受众分支资源章**全部废止**（属预编排，无真实多类受众）。BIAV-SC.md 简化为 8 章单一受众结构：§0 开场+人格核心 / §1 项目本质 / §2 艾瑞卡人格(完整) / §3 能力盘点 / §4 数据消费纪律 / §5 知识模块索引 / §6 内部协作+工程操作（渐进披露） / §7 变更记录。CLAUDE.md / README.md 设计不变。**接入咒语**精简为 2 行（无身份自陈）：「读 BIAV-SC.md 后以艾瑞卡身份协助我」。**守密人硬约束继承 4-26**：「精简优雅可维护」——BIAV-SC.md ≤ 300 行（v1.1 收缩） / CLAUDE.md ≤ 250 行 / 不引入新依赖 / 三文件总行数变化 ≤ +500 行。**3 批落地**：批 1 重写 BIAV-SC.md + CLAUDE.md（不动 README）→ 批 2 改 README + 间接引用更新 → 批 3 守密人对 Claude 试咒语 + 1 场景实测。**实施派 Code-site**。**回滚**：1 次 git revert 即可。详见 `memory/strategy/entry-architecture-redesign-proposal.md` + `memory/dispatch-brief-code-site-entry-redesign-batch1.md` v1.1 + `memory/dispatch-brief-code-site-entry-redesign-batch1.5-patch.md` | 全局 / 入口架构 |
| **脑缸组信息分类法则 v1.0 落档 — 守密人 2026-05-06 采纳**：守密人 5-6 发布脑缸组级信息分类元法则 v1.0，落档于银芯：`memory/biav-info-classification.md`（守密人 Q1 裁定法则归属银芯 / 不内嵌 BIAV-SC.md，单独成档以避免膨胀）。**核心架构**：7 类主轴（IP / 游戏产品 / 周边产品 / 品牌建设 / 社区运营 / 组织 / AI）+ 3 性质标记（正典 / 记载 / 法则）+ 多字段轴（service_variant / stage / event_type / provenance / owner / lineage）。**核心原则 4 条**：主轴优先 标记其上 / 多轴正交 / 开放写入 异常捕捉 / 演化容忍。**派生视图替代「状态」**（如「当前线上版本」从正典 + 记载派生，不是独立性质）。**银芯特别约定**（守密人 Q3 裁定）：银芯所有 AI 会话角色 `owner` 字段统称「银芯」，不区分主控台 / Code-* 子角色。**retrofit** 既有银芯档案打元数据字段（守密人 Q2 裁定属工程议题）派给 Code-memory，brief 落档 `memory/dispatch-brief-code-memory-info-classification-retrofit.md`，先调研 + 试点，不做全量。**法则演化路径**：v1.0 是最小集，每接入新信息源回头迭代字段（§11 落地建议）。BIAV-SC.md 1.5 patch 完成后新 §6 内部协作章引用本法则。详见 `memory/biav-info-classification.md` | 全局 / 信息分类 |
| **入口架构反转 — 守密人 2026-05-19 裁定**（覆盖 5-6 关于 CLAUDE.md / BIAV-SC.md 的全部裁定）：触发于守密人 5-19 关键洞察「BIAV-SC.md 必然是弱约束，这是 Claude 结构决定的」——LLM 注意力衰减 + 无硬执行机制 + 长文档稀释规则强度。**反转裁定**：(1) **CLAUDE.md 成为唯一 AI 入口**（Claude Code 平台自动加载 = 平台级强约束，比 BIAV-SC.md 弱约束有效），完整迁入艾瑞卡人格 / 项目本质 / 数据消费纪律 / 接入方能力盘点 / 知识模块索引 / 内部协作 + 工程操作 / 卡帕西原则引用 / 信息分类法则引用 + Light 维护速查附录；(2) **BIAV-SC.md 彻底废弃**（不保留指针，外部 AI 接入咒语改为直接读 CLAUDE.md raw URL —— Claude Code 自动加载 + 外部 raw URL 同源单一入口）；(3) **README.md 接入指引**改指向 CLAUDE.md。**废弃路径**：(a) decisions.md 同日收缩条目 + batch 1.5 patch brief 标 deprecated；(b) entry redesign batch 1 实施成果（BIAV-SC.md 350 行）作为内容来源逆向迁移到 CLAUDE.md，原文件 git rm；(c) 批量更新各 dispatch-brief / methodology / contribution-protocol 等引用 BIAV-SC.md 的地方 → CLAUDE.md。**接入咒语**改：「读 https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/CLAUDE.md 后以艾瑞卡身份协助我」。**多层约束分布表**（弱约束本质的实战应对）：工具层 enforce（硬）/ dispatch-brief 当下任务（强）/ 守密人即时纠正（强）/ session-digest 反向喂养（中）/ CLAUDE.md 自动加载（最强文档级，因为平台保证）。**实施派 Code-site**（新 brief：`memory/dispatch-brief-code-site-claude-md-unify.md`）。**回滚**：直推 main 政策下 git revert 即可。**新增 lesson #33 候选**：弱约束本质——任何 prompt 级 instructions 都是软约束，真正硬约束在工具层 / 平台层。详见本会话讨论 + 新 brief | 全局 / 入口架构 |
| **卡帕西编码 4 原则采纳 — 守密人 2026-05-10 采纳**（本条为守密人 2026-06-09 授权补录，依据 CLAUDE.md §6 与 `memory/karpathy-coding-principles.md`）：上游为 Andrej Karpathy 2026-01-26 LLM 编码行为观察，与守密人硬约束「精简优雅可维护」同构。四原则：(1) **Think Before Coding**——动手前明示假设、多解释全部列出、简化路径主动提、不明就停手（反 pattern：列 5 个等价选项让守密人挑）；(2) **Simplicity First**——只写解决问题的最小代码，不做投机性功能 / 单用途抽象 / 未要求的可配置性；(3) **Surgical Changes**——只动必须动的行，不顺手「改进」相邻代码，只清理自己制造的孤儿；(4) **Goal-Driven Execution**——任务转化为可验证目标，定义成功标准后自主循环至验证通过。落地位置：CLAUDE.md §6 全文（所有写代码会话必读硬约束）。2026-06-09 审查发现本条目缺录（决策日志与 CLAUDE.md §6 脱节，lesson #29 同款模式），经守密人授权补录 | 全局 / 工程纪律 |

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
| BPT 用 sql.js 替代 better-sqlite3（消除 Windows C++ 编译依赖） | bpt |
| BPT 自带独立 MCP Server（同构复刻银芯 11 工具，零 git 依赖，多格式解析） | bpt |
| BPT Server 变更检测用文件 mtime 扫描替代 git diff/log | bpt |
| BPT 不依赖 brain-in-a-vat 仓库，独立部署于内网 SVN | bpt |
| 银芯社区数据单向同步到 BPT（银芯 -> 脱敏 -> BPT），不反向 | bpt |
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

## 决策历史归档

以下为完整历史记录，按时间顺序保留，仅供审计追溯。

| 日期 | 决策 | 原因 | 影响范围 |
|------|------|------|---------|
| 2026-03-28 | 建立多会话协作架构 | 职责隔离，避免上下文混乱 | 全局 |
| 2026-03-28 | 目录按 memory/assets/projects 重组 | 区分记忆、资产、代码，支持 Chat 对接 | 全局 |
| 2026-03-28 | ~~前端不使用框架~~ **已废除** | 原因：项目扩展后一刀切不合适 | ~~news, game~~ |
| 2026-03-28 | 各子项目按需选择技术栈 | 取代旧的"不使用框架"原则。news 维持纯 HTML/JS；wiki 用 VitePress；database/game 视需求选型 | 全局 |
| 2026-03-28 | 项目完全开源，MIT License | 方法论吸引技术圈，数据吸引玩家社区 | 全局 |
| 2026-03-28 | 游戏内容版权归脑缸组 | 项目仅引用公开信息 | 全局 |
| 2026-03-28 | 仓库定位为"共享外脑 + 中转站" | Code 生产，Chat 加工交付，仓库是中间层 | 全局 |
| 2026-03-28 | 子项目保持单仓库，不拆分独立 repo | 所有会话需共享 memory/assets，分支隔离已够用，体量轻量无性能压力；仅当 game 资源膨胀时再考虑 submodule 拆分 | 全局 |
| 2026-03-28 | ~~确立分支管理策略~~ **已废弃** | ~~main 作为稳定基线，子项目分支从 main 拉取~~ → 见 2026-03-29 全部直接推 main | ~~全局~~ |
| 2026-03-28 | 合并 database 和 wiki 为单一 wiki 子项目 | 数据集是 wiki 的后端，站点是 wiki 的前端，分开容易混淆 | wiki |
| 2026-03-28 | 项目正式命名为「缸中之脑计划」| 仓库同步更名为 brain-in-a-vat | 全局 |
| 2026-03-28 | 架构定义为前台/中台/后台三层 | 前台(claude.ai)交付、中台(Claude Code)执行、后台(GitHub仓库)存储 | 全局 |
| 2026-03-28 | Wiki 部署 GitHub Pages + Actions 自动化 | 社区可直接访问，push to main 自动部署，无需手动操作 | wiki |
| 2026-03-28 | 界域 ID 标准化（aequor/caro/ultra） | 与游戏官方英文术语对齐，原 deep_sea/flesh/hyperdimension 保留为 legacy_id | wiki/data |
| 2026-03-28 | 角色职能标准化（attack/sub_attack/defense/support/chorus） | 统一数据规范，原 dps/sub_dps/tank 已全量替换 | wiki/data |
| 2026-03-28 | 角色 ID 从拼音改为英文 slug | 方便国际化 URL 和跨语言引用 | wiki/data |
| 2026-03-28 | 建立交付物视觉规范 style-guide.md | 深黑底+琥珀金调色板、Noto Serif/Sans CJK SC | 全局 |
| 2026-03-28 | 缸中之脑计划文档 v1.0 发布 | 36 页双语 PDF + HTML 归档至 deliverables/2026-03/ | 全局 |
| 2026-03-28 | 引入 lessons-learned 踩坑记录 | 记录犯过的错误避免重犯 | 全局 |
| 2026-03-28 | 引入 Plan/Execute 任务标注约定 | 前台派任务时标注「先出方案」或「直接执行」 | 全局 |
| 2026-03-28 | 创建 .claude/commands/ 可复用工作流 | daily-news / sync-memory / validate-data 封装为命令 | 全局 |
| 2026-03-28 | 各 CONTEXT.md 添加验证清单 | 每个子项目必须有可执行的验证步骤 | news, wiki, game |
| 2026-03-29 | 引入 Claude Code GitHub Actions | Issue 驱动自动化，减少人工中转 | 全局 |
| 2026-03-29 | Issue 安全策略：只执行 author:lightproud | 防止外部 Issue 被自动执行 | 全局 |
| 2026-03-29 | GitHub Pages 部署改用官方 Actions 方式 | deploy-pages@v4 官方推荐，无需额外分支，原子部署，权限更小 | wiki |
| 2026-03-29 | Wiki 中文设为 root locale + rewrites | 解决根路径 404。zh 内容通过 rewrites 映射到 `/`，en/ja 保持 `/en/`、`/ja/` | wiki |
| 2026-03-29 | 主站导航页 + 子路径多站点方案 | 根路径放主站导航，wiki 移到 /wiki/ 子路径，news 到 /news/，统一 deploy-site.yml 构建 | 全局 |
| 2026-03-29 | Issue 生命周期闭环管理 | WIP 上限 3 个/子项目 + 失败自动打 blocked 标签 + 创建前查重 | 全局 |
| 2026-03-29 | News 采集管线统一方案 | 先统一 JSON schema，再逐个接数据源，不建第三套系统 | news |
| 2026-03-29 | 新增 Code-site 子项目 | 部署流水线和跨站前端是跨子项目关注点，需要独立会话负责。deploy-wiki.yml 与 deploy-site.yml 冲突事件验证了这一判断。主控台不再写业务代码 | 全局 |
| 2026-03-29 | 删除 deploy-wiki.yml | 与 deploy-site.yml 功能重叠且架构冲突（wiki 部署到根路径 vs 子路径），统一由 deploy-site.yml 管理 | site |
| 2026-03-29 | ~~分支工作流~~ **废弃，改为全部直接推 main** | 项目无人工程序员，全 AI 协作追求效率。AI 解决 git 冲突高效，分支+合并流程反而增加不必要的中转。冲突时 `git pull` 重试即可 | 全局 |
| 2026-03-29 | 大文件暂不外迁，直接放 git | 当前规模不构成问题，等增长到瓶颈时再评估 LFS/R2/Releases 等方案 | 全局 |
| 2026-03-29 | Discord 数据分级存储架构 | 单频道历史消息可达76万条，纯 git 存储不可持续。方案：git 保留60天完整 JSONL（当月+上月作缓冲）；每月1日触发归档：将上个自然月数据打包推 GitHub Releases + 同步调用 Claude API 生成月报存入 monthly_reports/YYYY-MM.md + 删除 git 中该月 JSONL；每日纯统计摘要永久留 git | news/discord |
| 2026-03-29 | 部署方式改为 gh-pages 分支（peaceiris/actions-gh-pages） | Code-site 调试后发现 deploy-pages artifact 方式未跑通，改用推送 gh-pages 分支方式成功部署。GitHub Pages Source 需设为 branch: gh-pages | site |
| 2026-03-29 | Wiki 删除 tier 评级数据 | 攻略评级非项目关注点，减少主观数据维护负担 | wiki/data |
| 2026-03-29 | 整合 content_database 技能到 characters.json | 15 个角色获得技能字段，避免数据分散 | wiki/data |
| 2026-03-29 | 立绘图片存仓库（assets/images/portraits/） | 官方授权项目无版权问题，本地存储比外链更可靠 | wiki/data |
| 2026-03-29 | 建立 7 脚本自动化数据抓取体系 | Fandom API + Steam API 多源抓取，每周自动运行 | wiki |
| 2026-03-29 | Wiki 引入 Vue 交互组件（11 个） | 缩小与顶级 wiki 差距：筛选/对比/计算器/模拟器 | wiki |
| 2026-03-29 | 自动生成角色详情页（generate_pages.py） | 63 角色 × 3 语言 = 189 页自动生成，数据更新时重跑即可 | wiki |
| 2026-03-29 | 添加 SEO 优化（Schema.org + OG + sitemap） | 提高搜索引擎可发现性和社交分享效果 | wiki |
| 2026-03-29 | 版本更新自动检测 + RSS 订阅 | check-version.yml 每周检测 Steam API，自动创建 Issue | wiki |
| 2026-03-29 | 架构差距分析 + 8 项改进批量实施 | 对标业界最优实践，补齐数据验证(JSON Schema)、冒烟测试、Dependabot、共享CSS变量、404页面、爬虫降级保护、memory时间戳 | 全局 |
| 2026-03-29 | Discord 归档系统 4 项技术决策 | ①月内进度：A+B组合——每频道保存 last_historical_message_id 到 state.json（断点续传）+ JSONL 写入前按 message_id 去重（防御兜底）②月报失败：跳过不阻断归档，写 SKIPPED 标记，API 恢复后补生成 ③论坛历史：先跳过回溯，只做增量抓取新帖，历史帖子后续单独处理 ④Server Members Intent：暂不开启，成员数据非当前优先级。补充：workflow 加 concurrency 组防重叠；频道目录名只用 channel_id 后8位，emoji 名称存 channel_index.json | news/discord |
| 2026-03-29 | 模型使用分层策略 | 判断层用Opus(Extended)，执行层用Sonnet，避免MAX额度浪费 | 全局 |
| 2026-03-29 | 前台专岗不固定编制，"美术总监"不再作为固定岗位 | 按需增设更灵活 | 全局 |
| 2026-03-29 | 缸中之脑方向确认为方法论验证 | 不是纯产品工具，但交付物必须可用 | 全局 |
| 2026-03-29 | main 分支添加 Ruleset 保护规则（禁止删除） | 防止 agent 误删核心分支 | 全局 |
| 2026-04-01 | 明确双系统架构：银芯（公开层）+ 黑池（内部层） | 银芯 = 本仓库，仅用公开信息，开源；黑池 = 公司内部系统，处理内部数据。数据完全隔离，架构模式共享。银芯是方法论试验场，验证后黑池复用 | 全局 |
| 2026-04-01 | 银芯事实圣经边界：仅收录公开可查阅信息 | 采访、Steam 页面、社区讨论、官方公告等公开信息可录入。内部设计文档、未发布内容、商业数据属于黑池 | 全局 |
| 2026-04-01 | 战略规划 2026 发布 | 四阶段计划（止血→记忆宫殿→内容权威→方法论沉淀→衍生创作），详见 `memory/strategic-plan-2026.md` | 全局 |
| 2026-04-02 | 黑池定位为内网版本（非独立仓库） | 黑池不是 GitHub 私有仓库，是公司内网系统。银芯验证架构模式后黑池复用，数据物理隔离 | 全局 |
| 2026-04-02 | 大二进制文件移至 GitHub Releases | morimens_extract.zip (4.7MB) 等数据提取包不入 git，改存 Releases 并加入 .gitignore，防止仓库体积膨胀 | 全局 |
| 2026-04-02 | 联动关键词确认：沙耶之歌 (Saya no Uta) | 制作人确认采访中"经典宇宙恐怖作品单向联动"候选为沙耶之歌。日报系统 COLLAB_KEYWORDS 已配置监控 | news |
| 2026-04-02 | 做梦 Agent 三层架构 | 对标 AutoDream/Voyager/Reflexion/Sleep-Time Compute。浅睡（3h, Actions 脚本）感知异常；深睡（每天, claude-code-action）整理记忆+趋势分析；REM（每周, claude-code-action）经验提炼+状态同步+洞察积累。insights.json 作为可检索知识库。月成本~$7 | 全局 |
| 2026-04-19 | 战略总工期压缩至 3 个月（2026-04-19 → 2026-07-19） | 原 Phase 1→4 跨 8 个月时间表压缩比 2.67×，节奏前置 | 全局 / 战略 |
| 2026-04-19 | BPT 整条战线直接删除（bpt-web / bpt-desktop / bpt-next / graphify-ext / occ-local） | 守密人明示"BPT 不在银芯中开发"，删除比迁出更干净，不背技术债 | 全局 |
| 2026-04-19 | Phase 2 验收降档为"日报稳定运行 14 天" | 联动时间压力取消，验收口径从外部事件依赖改为内部稳定性指标 | 全局 / news |
| 2026-04-19 | 银芯指导 BPT 采用"人工对话搬运"协议 | 守密人从对话中学习概念，不做 harness 自动化，重点是认知传递而非代码交付 | 全局 / bpt 外部 |
| 2026-04-19 | 本战略评估会话（分支 claude/project-strategy-review-1AH5Z）升级为长期战略锚点 | 存续至 2026-07-19 战略达成，本会话不写业务代码仅派发与教学 | 全局 / 主控台 |
| 2026-04-19 | Phase 4 降档采用方案 A（仅可玩原型演示） | "10 社区玩家测试"不可压缩至 19 天内，社区测试推至战略窗口外 | 全局 / game |
| 2026-04-20 | Phase 2 窗口调整为 40 天，Phase 3 压缩至 25 天 | B3 揭露 Wiki 基线缺失与真实工作量 | 全局 / 战略 |
| 2026-04-20 | 角色 ID 重复"詹金 x2"与"黑猫 x2"确认为数据 bug | 守密人基于游戏知识判断，Phase 2 基线自举需加去重步骤 | wiki/data |
| 2026-04-20 | 档案诚信修复：72 角色真实值、characters.json 基线缺失 | B3 揭露档案与实际脱节，违反 lessons-learned #3 | 全局 / 档案 |
| 2026-04-26 | 直推 main 政策正式落地（PR #141 合并） | CLAUDE.md / claude.yml 全部对齐 2026-03-29 决策。删除 claude.yml 的 auto-merge step；新会话不再创建 feature 分支。详见 lessons-learned #29（决策档案脱节根因） | 全局 |
| 2026-04-26 | 装 SessionStart 同步 hook（`.claude/hooks/session-start-sync.sh`） | 每次会话启动自动 fetch + 同步 local main 至 origin/main，根治 Cloudflare HTTP 413 推送堵塞（lesson #28）。.gitignore 白名单 `.claude/hooks/` 进版本管理 | 全局 / 基础设施 |
| 2026-04-26 | 24 个未合并 claude/* 分支审计完成，全部决定删除 | A 组（8 BPT 废弃目录）+ B 组（3 BPT 文档，commit 历史保留）+ C 组（3 已被 main 覆盖）+ D 组（5 已通过别 PR 替代）+ E 组（5 小修复/早期文档）。守密人本地批量执行删除（艾瑞卡推送通道 403） | 全局 / 仓库整顿 |
| 2026-04-26 | dependabot PR 处理策略：batch dependency update 直推 main | 不走 dependabot 默认 5 PR 流程，改用 2 个 commit 直推：第一个含 3 个安全升级（requests/google-play-scraper/vue），第二个含 2 个 breaking change（playwright/anthropic）需本地测后合 | news / wiki |
| 2026-06-11 | 守密人声明：银芯定位由「公开层」调整为非公开 / 受限 | 守密人 2026-06-11 明示「银芯已经不是公开了」，取代 2026-04-01「银芯（公开层）」定位。**CLAUDE.md §0/§1/§4 仍写公开层，待守密人同步更新**；本行先记录定位变更事实。注意：定位变更不解除第三方平台 ToS 对采集行为的约束（见下条） | 全局 |
| 2026-06-11 | 上线 X/Twitter 官方号采集器（fetch_twitter，无 key） | 走 X 自家 syndication 嵌入时间线接口抓官方号（@MorimensOfcl 英 / @bokyakuzenya 日），解析 __NEXT_DATA__；只读、限速、仅公开推文、不绕登录墙、不做用户面操作。**局限**：该接口只回单账号时间线，无法关键词搜索（玩家提及面仍需官方 API v2 付费档；nitter 公开实例已全灭）。**合规风险（如实记录）**：自动化访问 X 端点受 X ToS 约束，与数据公开/内部无关；本采集为第一方监测自家官方号，风险由守密人知情承担 | news |
| 2026-06-20 | 自动记忆子系统整套退役删除（接续 2026-06-14 自动环退役裁定） | 守密人裁定全半径删除：23 个脚本（TF-IDF 检索 memory_search / 知识图谱 knowledge_graph / MemRL memrl / 事实库 fact_store / 虚拟上下文 context_manager / 写回 memory_writeback / 简报 session_briefing / reflexion / text_utils / 做梦系 dream*8 / 4 退役会话钩子 / 孤儿 extract_art / build_notion_voice_enrichment）+ 记忆数据（facts.json / dreams/ / session-digests/）。MCP 工具 16→4，仅留 character_persona / record_decision / record_lesson / current_continuity（平台原生记忆互补）。跨档案检索改 ripgrep。理由：自造记忆与 Claude 平台原生记忆定位冲突；保留手动 MCP 残面仍是同一冲突。CLAUDE.md §1.4/§5.3/§6/§7 同步 | 全局 / 记忆层 |
