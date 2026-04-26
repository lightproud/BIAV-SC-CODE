# 决策日志

> 最后更新：2026-04-26 by 主控台（艾瑞卡会话，写入 2026-04-26「银芯重新定位 v2.0」战略转向）
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
| 引入 occ-local 子项目：基于 ruvnet/open-claude-code (MIT) 的本地 Claude Code CLI，供脱离 Anthropic 账号的研究/内部场景使用；仅拷贝 v2/ 核心 547K，排除 archive/assets/submodule；定制以 patch 形式管理不污染上游骨架 | 全局 / occ-local |
| BPT 新一代基于 occ-local 重建：采用路径 B（平行新建 projects/bpt-next/）+ Electron + React UI（继承 bpt/bpt-desktop）+ 最终收敛为单一 BPT（bpt / bpt-web / bpt-desktop 归档 archive/）；occ-local 通过相对路径 import 不 fork 不 copy；设计蓝图见 memory/bpt-next-design.md；Phase 0-5 路线图 | 全局 / bpt-next |
| **改道决策**（2026-04-14 当日作废上一条）：深入核实 claw-code（instructkr/claw-code）后发现其本地模型 + 多 provider 能力超 occ-local（Ollama 开箱即用 / 5 层配置链 / 模型前缀路由 / proxy 原生 / xAI+DashScope+OpenRouter），故 bpt-next 改基于 claw-code 打造（Rust 48K 行）。**守密人明示接受版权风险**：上游无 LICENSE 文件，默认 All Rights Reserved；仅限 BIAV 内部使用，禁止外部推广。occ-local 保留作为 MIT 合规备选。旧设计文档 memory/bpt-next-design.md 已加封存头注。引入实施见 projects/bpt-next/NOTICE 与 CONTEXT.md | 全局 / bpt-next |
| **许可证评估修正**（2026-04-14 当日修正上一条的"无 LICENSE"假设）：构建验证时核查发现 rust/Cargo.toml `[workspace.package] license = "MIT"`，9 crate 全部 `license.workspace = true` 继承，rust/README 有 License 节。Rust 生态共识：Cargo.toml SPDX license 字段是法律认可的授权声明（crates.io / cargo-about / cargo-deny 均依赖此字段）。**主运行时 claw CLI = 明确 MIT 授权**。src/（Python 镜像）上游已声明"非主运行时"，无独立 LICENSE 但不影响 claw 主使用。风险等级从"致命"下调为"低"。建议上游加 LICENSE 文件仍作为友好建议。NOTICE 与 CONTEXT 已同步修正 | 全局 / bpt-next |
| **构建与诊断验证**（2026-04-14）：`cargo build --workspace` 成功，耗时 51.71 秒，产物 claw CLI 148M。`claw doctor` 5 OK / 1 Warn (auth 未设 key) / 0 Fail；sandbox workspace-only + 无网络；自动识别 BIAV 3 个 skill（daily-news / sync-memory / validate-data）表明 claw ↔ Claude Code skill 发现机制兼容。E2E 网络调用受容器 sandbox 限制未跑通（不影响守密人本地）。完整报告见 memory/bpt-next-build-verification.md | 全局 / bpt-next |
| **occ-local 降级为研究归档**（2026-04-14）：守密人原话"occ 这件事就忘了吧，我们现在基于 claw-codes"。bpt-next（claw-code）是唯一主线；occ-local 保留源码但不再作为"MIT 合规备选"维护，仅作架构参考。废弃之前的 biav-occ wrapper 方案（~120 行 plan 已清理） | 全局 / occ-local |
| **Phase B 4 答案锁死**（2026-04-14）：(1) 无账号用户识别 = 与 SVN 账号名一致，可支持外显名；(2) SVN 仓库 = 基于本地 SVN 工作副本；(3) 事实边界 = memory/decisions.md 全部入 wiki 不做审核筛选；(4) 能力共享粒度 = BIAV Studio 团队内 | 全局 / 黑池建设 |
| **双系统亚哈格分**（2026-04-14）：银芯 = 孵化器 + 开源子项目 + 公开资料；黑池（内网 SVN）= 五大需求的数据与代码主体。解除"能力团队内共享"与"银芯公开层"的潜在矛盾——能力放黑池内网，银芯只保留接口声明与可公开能力。详见 memory/blackpool-architecture.md 第零节 | 全局 / 双系统分工 |
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
