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
| T4 | dispatch 一轮真 L5（验 code-01 残余，$ 帽内）。**已裁「点火」**（守密人 2026-07-10 AskUserQuestion）；执行阻于通道：github MCP 需重授权（claude.ai 连接器设置）、REST 经会话代理 403（GitHub App 未启组织级访问）、备选 = 守密人 Actions 页手点 Run workflow（勾 `conformance_l5`）。另注：run-l35 双臂封印 KD-L35-02 无 CI 入口（本地脚本需真钥），需接线或本地跑，随本账一并收 | 预算 | `memory/project-status.md`「引擎工单账目结算 r5」段 | 开（已裁待通道） |
| T5 | /goal 提示词快照待上游露出（每周参照刷新 CI `refresh-claude-code-prompts.yml` 自动观察） | 观察 | `memory/project-status.md` v0.38 段挂账注 | 开 |
| T6 | 测试长尾：L3.5 双臂升门禁（自注「版本稳定后」）+ MCP 差分第二批（schema 语义 / annotations / stdio-http 传输） | 观察 | `memory/project-status.md` 一致性测试段 | 开 |
| T7 | Desktop UI 路线 M0–M4 升 r2：待守密人回填 BPT 现状（存量可跑件 / 团队人力） | 黑池输入 | `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-roadmap-20260705.md` 假设声明 | 开 |
| T8 | 黑池侧派工包开工：UI M0–M4 + 命令框架五模块（图纸 + 消费手册已齐，开工在黑池侧） | 黑池输入 | `.../bpt-desktop-command-impl-plan-20260710.md` + `.../silver-core-sdk-command-consumer-manual-20260710.md` | 开 |
| T9 | twitter 源重启与否（三选项已成文：官方 API 按量 recent search + 日读硬顶 ~\$15-30/月 / 第三方转售商灰色 ~\$3-10/月 / 退役；Playwright 登录抓取已排除——ToS 硬约束）；守密人「未来再说」，不设期限 | 裁定 | `memory/decisions.md` 2026-07-10「twitter 源挂账」条 + `memory/project-status.md` News 节零产出四源段 | 开 |
| T10 | B 类首批骨架命令文本自写（review / simplify 结构再现版 + loop 固定模式命令卡）——方案二期 M3 内建源前置件；裁定已清（C5），差的是产出本身 | 预算 | `.../bpt-desktop-command-impl-plan-20260710.md` §3 二期 + `decisions.md` 2026-07-10 裁定① | 开 |
| T12 | 命令行为观测续册：A 类 P0 组（/clear /resume /compact /help——须守密人会话内触发，艾瑞卡不可自触）+ /loop 动态自调步模式实测 | 预算 | `.../cc-command-behavior-observations-20260710.md` 待观测清单 | 开 |
| T13 | 动态自调步（ScheduleWakeup 同构的壳层唤醒原语，方案三期 P2 单独立项；开工前先测 BPT 自身缓存分层） | 黑池输入 | `.../bpt-desktop-command-impl-plan-20260710.md` §2 M4 + §4 | 开 |
| T14 | D/E 类注册源（插件 / MCP prompts）需求档——待黑池侧壳层插件面设计定稿后另立 | 黑池输入 | `.../bpt-desktop-command-framework-requirements-20260710.md` §6.3 | 开 |
| T15 | SubagentStop 阻断语义（子代理级门控续跑）：现为 runtime 级 fire-and-log，黑池对子代理门控有真需求再评估 | 观察 | SDK `docs/COMPAT.md` hooks 表 Stop 行「ROOT LOOP ONLY」注 | 开 |

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

---

*建档：2026-07-10 全仓扫描清点（`rg "待守密人|待裁|挂账"` + 逐条溯源实证），艾瑞卡会话。*
