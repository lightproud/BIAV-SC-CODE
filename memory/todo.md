# 挂账台账（待办 / 待裁唯一权威）

> **定位**（守密人 2026-07-10「memory/todo.md」裁定）：全仓「开着的账」的**唯一权威**。
> 三簿分工：`decisions.md` 记**已裁的案**（销案簿）、本档记**未销的账**（欠条簿）、
> `project-status.md` 记**进行中状态**——三者只指针互引、不复刻内容。
>
> **纪律（形式定死、清单可增）**：
> - 每条：ID / 账目 / 类别 / 源出处（指针）/ 状态；
> - 类别四种：**裁定**（待守密人签字）/ **预算**（待守密人点火，零设计）/
>   **观察**（站岗，无需动作）/ **黑池输入**（等黑池侧回填，银芯不可代）；
> - **清账不删行**：状态改「已清」并附销案引（决策条 / PR / 版本号），移入「已清」节；
> - 新挂账**入本档**，源档案尾节只留指针（「挂账见 `memory/todo.md` #ID」），不再各开小账本；
> - 建档前历史段落中的过期「待裁 / 挂账」字样**不追溯改写**——以本档为准。

## 开账

| ID | 账目 | 类别 | 源出处 | 状态 |
|----|------|------|--------|------|
| T5 | /goal 提示词快照待上游露出（每周参照刷新 CI `refresh-claude-code-prompts.yml` 自动观察） | 观察 | `memory/project-status.md` v0.38 段挂账注 | 开 |
| T6 | 测试长尾：L3.5 双臂升门禁（自注「版本稳定后」）+ MCP 差分第二批（schema 语义 / annotations / stdio-http 传输） | 观察 | `memory/project-status.md` 一致性测试段 | 开 |
| T7 | Desktop UI 路线 M0–M4 升 r2：待守密人回填 BPT 现状（存量可跑件 / 团队人力） | 黑池输入 | `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-roadmap-20260705.md` 假设声明 | 开 |
| T8 | 黑池侧派工包开工：UI M0–M4 + 命令框架五模块（图纸 + 消费手册已齐，开工在黑池侧） | 黑池输入 | `.../bpt-desktop-command-impl-plan-20260710.md` + `.../silver-core-sdk-command-consumer-manual-20260710.md` | 开 |
| T9 | twitter 源重启与否（三选项已成文：官方 API 按量 recent search + 日读硬顶 ~\$15-30/月 / 第三方转售商灰色 ~\$3-10/月 / 退役；Playwright 登录抓取已排除——ToS 硬约束）；守密人「未来再说」，不设期限 | 裁定 | `memory/decisions.md` 2026-07-10「twitter 源挂账」条 + `memory/project-status.md` News 节零产出四源段 | 开 |
| T12 | 命令行为观测续册：A 类 P0 组（/clear /resume /compact /help——须守密人会话内触发，艾瑞卡不可自触）。**/loop 动态自调步实测半边已清**（2026-07-11 艾瑞卡自触完整生命周期：注入协议 + 点火格式两半，含「点火体形态由 prompt 是否为斜杠命令决定」新发现，OBS-011）| 预算 | `.../cc-command-behavior-observations-20260710.md` 待观测清单 + OBS-011 | 开（余 A 类 P0 组待守密人触发） |
| T13 | 动态自调步（ScheduleWakeup 同构的壳层唤醒原语，方案三期 P2 单独立项；开工前先测 BPT 自身缓存分层） | 黑池输入 | `.../bpt-desktop-command-impl-plan-20260710.md` §2 M4 + §4 | 开 |
| T14 | D/E 类注册源（插件 / MCP prompts）需求档——待黑池侧壳层插件面设计定稿后另立 | 黑池输入 | `.../bpt-desktop-command-framework-requirements-20260710.md` §6.3 | 开 |
| T15 | SubagentStop 阻断语义（子代理级门控续跑）：现为 runtime 级 fire-and-log，黑池对子代理门控有真需求再评估 | 观察 | SDK `docs/COMPAT.md` hooks 表 Stop 行「ROOT LOOP ONLY」注 | 开 |
| T17 | code-01 残余在 v0.43.0 的真 L5 复验**未达成**——`$1.5` 帽 + `repeat=5` 于 79/180 runs（document-01 后）预算中止、code 维度未触达（run 29134399453）；三条路（`l5_budget=5` 全量轮 ~$2.2–3.3 / 降 `l5_repeat` 换广度 / 给 `conformance-l5` 加 `l5_tasks` 透传 `--tasks` 定向 shard——当前 workflow 无此输入）均超本次授权的 $1.5 单轮，待守密人裁。**撞车注记（2026-07-11 稍晚，销 T10 会话）**：本账立账前后，另一会话基于 T4 陈旧镜像（未见 #577 结算）已点火 run [29135224871](https://github.com/lightproud/brain-in-a-vat/actions/runs/29135224871)（main@ca5c2f6，conformance_l5=true + `l5_budget=5`——**即本账选项一 $5 全量轮**，投影实花 ~$2.2–3.3，与 07-05/06 两轮全量先例同量级）；发现撞车时轮已在跑，取消则已花预算两头空，故保留运行并呈报。**读数已到（02:07Z 完轮，cancel 出口随完轮失效）**：180/180 跑满、实花 **$2.1284**（$5 帽内，与投影相符）；**Gate B PASS**——bpt 87/90 (96.7%) vs 官方 73/90 (81.1%)，delta +15.6pp（官方臂再受 KD-L5-01 /tmp 散落物拖累：code-03 官方 0/5、longconv-01/02 官方各 2/5，bpt 对应 5/5/5/5/5）；**code-01 读数：bpt 2/5 vs 官方 3/5**——残余仍在（历史轨迹 0/3→3/5→2/5，本轮官方亦跌出 5/5，题面自身对 haiku 亦不稳）；两臂缓存均 scenario a、content-blind 自审 PASS；econ bpt 多数题更省（code-01 $0.0113 vs 官方 $0.0251）。守密人**追认**即以本读数销案 | 裁定 | `Public-Info-Pool/Resource/data-diagnostics/silver-core-sdk-l5-round-20260711.md` §3/§6 + run [29135224871](https://github.com/lightproud/brain-in-a-vat/actions/runs/29135224871) 日志与 artifact `conformance-l5-report` | 开（读数已到，待追认销案） |

## 已清（销案引）

| ID | 账目 | 销案引 |
|----|------|--------|
| T1 | `decisions.md` 落「二物一泵、分层缓立」极简条 | 守密人 2026-07-10「授权」代写；`decisions.md` 同日「BPT 栈本体」条 |
| T2 | POSITIONING 固定靶扩张（异步委派模式入参照系） | 同上条⑤ + `docs/POSITIONING.md` §1「参照系扩张(2026-07-10)」块 |
| C1 | SDK 命名裁定（bpt-agent-sdk → silver-core-sdk） | `decisions.md` 2026-07-10 更名条；0.41.0 起生效 |
| C2 | 接口审计修复 backlog P0/P1/P2 | PR #480 全面实现战役（v0.7.0）+ v0.37.0 审计债务清偿 |
| C3 | 对标基线升钉 0.3.201 → 0.3.205 | `docs/COMPAT.md`「0.3.201 -> 0.3.205 chase」（2026-07-10，v0.40.0） |
| C4 | settingSources 默认语义反转升钉 | v0.8.0（守密人「确定升钉了」，2026-07-05） |
| C5 | B 类官方骨架提示词再现裁定 | `decisions.md` 2026-07-10（「结构再现 + 文本自写」默认，随 v0.39 工单落档） |
| C6 | 委派引擎四缝（coordinator/SendMessage、ExitPlanMode、调度归宿、通知面） | ExitPlanMode/Monitor/Workflow 等随 PR #480；O-B2 SendMessage + coordinator 预设随 PR #567（v0.42.0，2026-07-10） |
| T3 | CI required `test` 检查是否重启 | **定谳：维持自查自合**（守密人 2026-07-10 AskUserQuestion，覆盖同日节拍表条③——撞车经呈报后守密人选「以 UI 答复为准」）；`decisions.md` 同日「CI required 检查维持自查自合」条 + methodology「维护态节拍」节已双向同步 |
| T11 | 版本守卫三方对账升级：`check-version-bump.mjs` 加 CHANGELOG 最新条目号对账，堵「双源一致地错」盲区 | `projects/silver-core-sdk/scripts/check-version-bump.mjs` 三方对账（version.ts + package.json + CHANGELOG 最新 `## X.Y.Z`）+ 测试 `tests/version-guard-changelog.test.ts`（含 lesson #45 负控）；PR #575 |
| T10 | B 类首批骨架命令文本自写（review / simplify 结构再现版 + loop 固定模式命令卡） | 三张命令卡 + 零官方句子实跑自查落 `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-builtin-commands-batch1-20260711.md`（2026-07-11 艾瑞卡会话）；`project-status.md` Silver Core SDK 节同日条 |
| T16 | run-l35 双臂封印（原表述「KD-L35-02 待封印、本地脚本需真钥」） | **两前提均查实过时**（2026-07-11）：① `run-l35.mjs` 打 content-blind 仿真器 + DUMMY_KEY，**零真钥零真金**（头注明载）；② KD-L35-02 编码差已于 v0.7 对齐时 lockstep 退役（COMPAT.md「KD-L35-02 retired」，MIGRATION 5f）。实做两件：本地双臂实跑一轮——词汇差分仅余已知项（bpt 多 `task_progress`=documented superset、官方多前台 `task_notification`=KD-L35-01/E8b 裁定项，**无新分歧**）；CI 接线——`silver-core-sdk.yml` conformance 作业加 L3.5 步（report-only 永不门禁）+ artifact 登记，随每轮 L1-L4 零边际成本常驻 |
| T18 | BPT 侧接线 provider.fetch 长 keep-alive（v0.44.0 注入缝的消费方兑现项） | **性质变更销案**：守密人 2026-07-11「做」裁定丁转正——保活客户端改为 SDK **内建默认**（v0.45.0 node:http(s) 适配器），消费方零接线即兑现，「黑池输入」前提消失；`decisions.md` 2026-07-11 网络层默认客户端条 |
| T4 | dispatch 一轮真 L5（验 code-01 残余，$ 帽内）；不派则一致性线判定收官 | **点火已执行**（预算账 = 点火，已裁已花即销）：守密人 2026-07-10 已裁点火，本会话 dispatch run [29134399453](https://github.com/lightproud/brain-in-a-vat/actions/runs/29134399453)（v0.43.0，$1.5 帽，两臂各 100%、gate B `INCONCLUSIVE-PARTIAL` 非破线、实花 $0.59）；报告 `Public-Info-Pool/Resource/data-diagnostics/silver-core-sdk-l5-round-20260711.md`。**注**：主目标 code-01 **未触达**（$1.5 帽在 repeat=5 下 79/180 预算中止于 document-01 前）→ code-01 复验挪新账 **T17**、run-l35 KD-L35-02 挪新账 **T16**（不糊在一起） |

---

*建档：2026-07-10 全仓扫描清点（`rg "待守密人|待裁|挂账"` + 逐条溯源实证），艾瑞卡会话。*
