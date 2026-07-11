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
| T13 | 动态自调步（ScheduleWakeup 同构的壳层唤醒原语，方案三期 P2 单独立项；开工前先测 BPT 自身缓存分层） | 黑池输入 | `.../bpt-desktop-command-impl-plan-20260710.md` §2 M4 + §4 | 开 |
| T14 | D/E 类注册源（插件 / MCP prompts）需求档——待黑池侧壳层插件面设计定稿后另立 | 黑池输入 | `.../bpt-desktop-command-framework-requirements-20260710.md` §6.3 | 开 |
| T15 | SubagentStop 阻断语义（子代理级门控续跑）：现为 runtime 级 fire-and-log，黑池对子代理门控有真需求再评估 | 观察 | SDK `docs/COMPAT.md` hooks 表 Stop 行「ROOT LOOP ONLY」注 | 开 |
| T21 | BPT 侧消费 v0.45.0+ 网络层三小项：① 升级依赖至 `silver-core-sdk-0.45.0.tgz` 及以上即自动获内建保活（零改码）；② 若走企业代理：两内建客户端均不认 `HTTPS_PROXY`，需按 `docs/PERFORMANCE.md` 配方注入 `provider.fetch`；③ `preconnect` 旋钮是否在 BPT 默认开启，真机浸泡后由黑池侧定 | 黑池输入 | `memory/decisions.md` 2026-07-11 网络层默认客户端条 + `projects/silver-core-sdk/docs/PERFORMANCE.md` | 开 |
| T22 | 方案乙（HTTP/2）重估时机：undici `allowH2` 实测（2026-07-11）一请求一会话（零复用）或单会话流串行化（8 并发 SSE 223ms→1262ms），判死搁置；待 undici 上游实现真并发多路复用（多流并行同会话）再重估——收益面为 SessionManager 多会话并发场景 | 观察 | `memory/decisions.md` 2026-07-11 网络层默认客户端条④ + `projects/silver-core-sdk/docs/PERFORMANCE.md`「Why not HTTP/2」节 | 开 |
| T23 | fanart 直传 release 新链路首次全真实跑验证：PR #587 把 collect-fanart / recover-fanart 改「取月桶合并 → `--force-group` 重传」（修每日 gitignore exit 1），下一次定时跑（每日 02:00 UTC）或手动 dispatch 需核 Actions 日志——月桶下载 / 合并 / 重传三步全绿即销 | 观察 | PR [#587](https://github.com/lightproud/brain-in-a-vat/pull/587) + `RELEASES.md` §2.2 | 开 |
| T24 | fanart 月桶「日日下载整月重传」带宽站岗：随月内天数线性涨（历史 ~150MB/月，月末单次两三百 MB），当前可接受；若未来体量失控再议按日资产分桶（代价 = 回到「资产散乱」老问题，2026-06-21 整理前形态），无异常不动 | 观察 | PR [#587](https://github.com/lightproud/brain-in-a-vat/pull/587) 合并总结体余项 2 + `.github/workflows/collect-fanart.yml` 上传步 | 开 |

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
| T3 | CI required `test` 检查是否重启 | **终版定谳（2026-07-11）：部分采纳**——required `test` 已由守密人亲手勾选生效（Ruleset 18506085 实测，机器推送无误伤）；「Require branches to be up to date」明文不开（自动归档直推流量与 strict 策略撞车）。覆盖 07-10「维持自查自合」定谳；`decisions.md` 2026-07-11「CI 硬门禁部分采纳定案」条 |
| T11 | 版本守卫三方对账升级：`check-version-bump.mjs` 加 CHANGELOG 最新条目号对账，堵「双源一致地错」盲区 | `projects/silver-core-sdk/scripts/check-version-bump.mjs` 三方对账（version.ts + package.json + CHANGELOG 最新 `## X.Y.Z`）+ 测试 `tests/version-guard-changelog.test.ts`（含 lesson #45 负控）；PR #575 |
| T10 | B 类首批骨架命令文本自写（review / simplify 结构再现版 + loop 固定模式命令卡） | 三张命令卡 + 零官方句子实跑自查落 `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-builtin-commands-batch1-20260711.md`（2026-07-11 艾瑞卡会话）；`project-status.md` Silver Core SDK 节同日条 |
| T16 | run-l35 双臂封印（原表述「KD-L35-02 待封印、本地脚本需真钥」） | **两前提均查实过时**（2026-07-11）：① `run-l35.mjs` 打 content-blind 仿真器 + DUMMY_KEY，**零真钥零真金**（头注明载）；② KD-L35-02 编码差已于 v0.7 对齐时 lockstep 退役（COMPAT.md「KD-L35-02 retired」，MIGRATION 5f）。实做两件：本地双臂实跑一轮——词汇差分仅余已知项（bpt 多 `task_progress`=documented superset、官方多前台 `task_notification`=KD-L35-01/E8b 裁定项，**无新分歧**）；CI 接线——`silver-core-sdk.yml` conformance 作业加 L3.5 步（report-only 永不门禁）+ artifact 登记，随每轮 L1-L4 零边际成本常驻 |
| T18 | BPT 侧接线 provider.fetch 长 keep-alive（v0.44.0 注入缝的消费方兑现项） | **性质变更销案**：守密人 2026-07-11「做」裁定丁转正——保活客户端改为 SDK **内建默认**（v0.45.0 node:http(s) 适配器），消费方零接线即兑现，「黑池输入」前提消失；`decisions.md` 2026-07-11 网络层默认客户端条 |
| T17 | code-01 残余真 L5 复验（$1.5 帽轮预算中止后三条路待裁；选项一 $5 全量轮遭另一会话基于 T4 陈旧镜像撞车执行，经呈报保留运行） | **守密人 2026-07-11「T17 追认」定谳**：以撞车执行轮 run [29135224871](https://github.com/lightproud/brain-in-a-vat/actions/runs/29135224871) 读数销案——180/180 跑满、实花 $2.1284（$5 帽内）、**Gate B PASS**（bpt 87/90=96.7% vs 官方 73/90=81.1%，delta +15.6pp）、**code-01 复验到手：bpt 2/5 vs 官方 3/5**（残余仍在但已判读：历史 0/3→3/5→2/5，官方本轮亦跌出 5/5，题面对 haiku 本身不稳，非我方独有缺陷）；详报 `Public-Info-Pool/Resource/data-diagnostics/silver-core-sdk-l5-round-20260711.md` + artifact `conformance-l5-report`。随本销案，r5 结算「剩余验收项清完则一致性线收官」条件齐备（code-01 复验 + run-l35 封印 T16 均清） |
| T19 | CI 硬门禁 Ruleset 勾选操作：只勾 required `test`（2026-07-11 裁定，修正 0710 原案的 up-to-date 第二项） | **守密人 2026-07-11 告知勾选完成**（GitHub Settings 侧手动操作，会话无 Ruleset 读权限，以告知为销案依据）；实证挂在下一单 PR 合并流程——`test` 检查应显示为必需项，若实测不符另行呈报。自此合并纪律由「自查自合」切换为 **CI 硬门禁**（合并前等 required `test` 绿），CLAUDE.md §7.6 已同步 |
| T12 | 命令行为观测续册：A 类 P0 组（/loop 动态自调步 + /compact + /help + /resume + /clear） | **全组闭环（2026-07-11）**：收官件 /clear 守密人触发 + 截图 / 引擎座席双视角合璧（OBS-015）——A 类三件套 wrapper 空 stdout、上下文全弃零蒸馏（与 /compact 三分重建成对照）、容器 uptime 跨越清除时刻实证工作区 / 会话身份 / Git-PR 态全存续（清对话不清会话）；前四笔 OBS-011/012/013/014。P1 / P2 尾巴留观测档待观测清单随缘续记，不另挂账；档案 `Public-Info-Pool/Resource/repo-engineering/cc-command-behavior-observations-20260710.md` |
| T4 | dispatch 一轮真 L5（验 code-01 残余，$ 帽内）；不派则一致性线判定收官 | **点火已执行**（预算账 = 点火，已裁已花即销）：守密人 2026-07-10 已裁点火，本会话 dispatch run [29134399453](https://github.com/lightproud/brain-in-a-vat/actions/runs/29134399453)（v0.43.0，$1.5 帽，两臂各 100%、gate B `INCONCLUSIVE-PARTIAL` 非破线、实花 $0.59）；报告 `Public-Info-Pool/Resource/data-diagnostics/silver-core-sdk-l5-round-20260711.md`。**注**：主目标 code-01 **未触达**（$1.5 帽在 repeat=5 下 79/180 预算中止于 document-01 前）→ code-01 复验挪新账 **T17**、run-l35 KD-L35-02 挪新账 **T16**（不糊在一起） |
| T20 | conformance 记忆轴官方臂差分采集 | 守密人 2026-07-11 授权艾瑞卡全程办：采集脚本 `capture-official-memory-wire.mjs` + live-smoke 采集步落分支后 dispatch run [29148114257](https://github.com/lightproud/brain-in-a-vat/actions/runs/29148114257)（双臂 GA/runner 请求体截获,live-smoke 三阶段全 PASS 含真 API 记忆写入）；fixture `tests/conformance/official-memory-wire.json` + 差分 4 例解封 skip 槽位（官方类型条目恰 {type,name} 两键、我方逐字节相等、顺序=调用方顺序、anthropic-version 齐平）；随 T19 销案 PR 合并 |

---

*建档：2026-07-10 全仓扫描清点（`rg "待守密人|待裁|挂账"` + 逐条溯源实证），艾瑞卡会话。*
