# Silver Core Maestro SDK 状态叙述归档（截至 2026-08-08）

> **⚠ 归档层，不作运行时约束**（守密人 2026-08-08「撞上限即整理到 50%」裁定的首次执行）：
> 本档是 `memory/project-status.md`「## Silver Core Maestro SDK」节在 2026-08-08 之前累积的
> **逐版发布编年史 + 六战施工记录 + T56 五轮审计战报摘要**，原文逐字迁入，一行未改、一行未删。
>
> **为什么迁**：状态档是「每会话必读的状态权威」，本次撞上限时全档 47,084 字符，本节独占
> **11,018（23.4%）**——而**逐版发布叙述的唯一权威本就是**
> [`projects/silver-core-maestro-sdk/CHANGELOG.md`](../../projects/silver-core-maestro-sdk/CHANGELOG.md)，
> 迁出前状态档自己第 296 行就写着「逐版全文以本包 `CHANGELOG.md` 为唯一权威」。**迁出即执行它自己的原则。**
> 已核实：本节点名的 11 个版本（0.95.0 / 0.98.0 / 0.99.0 / 1.1.0 / 1.3.0 / 1.4.0 / 2.0.0 /
> 2.2.0 / 2.2.1 / 2.2.2 / 2.2.3）在该 CHANGELOG（1,169 行）中**逐个都在**——迁走的是副本，不是孤本。
> 同一段历史在三处各存一份（CHANGELOG / 包 CONTEXT / 状态档）只会三处分叉；agent SDK 一节已于
> 2026-07-27 同理下沉（`memory/archive/sdk-status-chronicle-20260727.md`）。
>
> **本档里有 CHANGELOG 没有的东西**，这也是「归档而非删除」的理由：六战施工的派发与验收口径
> （动态编排令的代理编制、对抗审查抓了几 major）、锁步裁定的当日语境、跨包判词统一那次的
> 排查经过（BPT 报「goal 没效果」→ 定位两包同名不同形），以及每轮的实测复核数字。
>
> 追溯用；**运行时状态一律以 `memory/project-status.md` 与该包 CHANGELOG 为准**。

---

- **v2.2.3（2026-07-29）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 2.2.3（观察项批收口）前进。
- **v2.2.2（2026-07-29）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 2.2.2（工具调用参数健壮性七修）前进。
- **v2.2.1（2026-07-29）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 2.2.1（输入形状诊断）前进。
- **v2.2.0（2026-07-29）**：**设计第三轮落地（四原语装配，agent 侧纯锁步）**——设计档 `Public-Info-Pool/Resource/repo-engineering/maestro-sdk-agent-assembly-design-20260729.md`（裁1–裁5 + D2–D8 十一项当日交互裁定）当日实现：第七族 `assembly/agent-executor.ts`（**注入式** `createAgentExecutor` + `extractPlainAgent`/`extractGoalRound`/`extractWorkflowNode`——宿主递 query 函数进驱动器执行座位，本包对 agent SDK 维持零 import 零依赖、P1 不重开；fail-loud 无请求即响亮落错；abort 桥接 interrupt→宽限→close；重试=重跑，恢复=宿主 reopen+payload.resume，D6）+ 第八族 `routine/manager.ts`（`RoutineManager` 值班例程管理面：命名/停启/triggerNow/lastFireAt·nextFireAt·lastSession 反查；停启表纯内存+宿主持久化 D4；手动触发幂等键 `manual:{id}:{firedAt}` **独立段永不污染 Scheduler 恢复足迹**）+ 足迹解析抽出 `schedule/footprint.ts` 单一共享纯核（Scheduler 恢复行为逐字节不变）+ `WorkflowNode.manualClaim` 确认门节点（`runAt:null` 派发停在 pending+manualClaim，Cowork awaiting_confirm 投影**零新状态**，裁3；拒绝=cancelSession fail-fast、修订=reopen 链）+ `QueryRecord.costUsd` 成本入账（D2：executor 转录引擎估算，驱动器转发，Σ listQueries 即会话累计）+ `docs/ASSEMBLY.md` 四原语接线谱 + 例程五号 `agent-loop.mjs`（无钥可跑的注入式活体证明；**不建 LoopRunner，组合即 loop**，D3；宪章 §3 已补 D8 覆盖注）。测试 429→479（+50）。两新族按两级标尺标实验面并**随档指定首消费方**（设计档 §10——memory-tidy 生产化 / BPT Cowork / testbed·store-patrol 例程面改造），防 P2 判词重演。
- **v2.0.0（2026-07-29）**：**锁步对齐（家族首个 major，本包零运行时改动）**——随 agent SDK 2.0.0（T75：cards 退役 BREAKING + frontmatter + 选择性附着）前进；本包面无破坏，agent 侧 cards 消费者先迁移再 pin。
- **v1.4.0（2026-07-28）**：**审计第十七波（本包份额）**——两处**只被测试替身的宽容挡住**的真缺陷：①`claimDue` 把 `limit`（即 `LedgerDriver.maxConcurrent` 的批量上限）套在存储**恰好**返回的顺序上，而 `LedgerStore` 契约**根本不规定顺序**（随包契约套件比对前一律先排序 id，即顺序刻意在契约外）。全部测试替身都是 Map 支撑、列举序恰好等于派发序也就等于到期序，于是这条从来没被测过：对一个**完全合规**、按最新在前列举的存储，`maxConcurrent: 1` + 三个恒到期会话，实测 30 个 tick 里同一个会话占满槽位、另两个**一次没跑**；即便在内存存储上，5000/1000/100ms 三个到期点也会认领**最不逾期**的那个。现按 `nextRunAt` → `createdAt` 排序，完全并列者靠稳定排序保留存储序 · ②**32 位定时器溢出把每个毫秒旋钮顶部反转**：`systemClock.setTimeout` 把延时直接交给全局定时器，而超过 2^31-1 ms 后 Node 不是睡更久、是**溢出成 1 ms**。30 天的 `queryTimeoutMs` 通过了构造期的有限/正数校验，然后在执行器第一个 `await` 恢复之前就中止了每一次尝试、落 `retrying` + `lastError: 'timeout'`——**没有任何一次尝试可能完成**；同一反转把刻意设稀的 `pollIntervalMs`（驱动器与调度器皆然）变成对宿主存储的 1 ms 锤击。仅在交给全局的那一步封顶，注入钟与 NaN/Infinity 不动。
- **v1.3.0（2026-07-28）**：**审计第十五 + 十六波（本包份额，非空转）**——①`LedgerDriver` 在 try/catch **之外**解引用宿主执行器的返回值，执行器少写一个 `return` 即产生无人处理的拒绝、Node 宿主以 `ERR_UNHANDLED_REJECTION` 死掉、会话搁浅在 `running`，与「驱动器绝不因执行器失败而崩溃」的明文承诺相悖 · ②`GoalChaser` 从不校验评审器返回的判词形状（agent 侧对**同一个** 0.83.0 统一形状是校验的）：仍说旧 `{achieved, feedback}` 的评审器在 agent 侧会被响亮抓住，在本包却当「未达成」放过——第 1 轮就报成功的追逐实跑了 5 轮驱动器执行、最后落 `exhausted` · ③工作流加载器围栏扫描器把长围栏内的三反引号行读作闭合，**文档示例图顶替真图**被加载派发，而寻常的包裹写法反被判为「没有图」· ④UTF-8 BOM 被格式嗅探当无意义（`trimStart` 吃掉它）、又被 `JSON.parse` 当有意义，Notepad / PowerShell 存的合法图被静默跳过 · ⑤`nextFireAt` 的 `dailyAt` 分支撞上 `Date.UTC` 的两位年份重映射（0–99 → 1900+year，而 `getUTCFullYear()` 报真年），一世纪时间戳的触发点偏出约 1900 年、`firesBetween` 静默丢掉全部到期点（70 万随机元组证明改法在该窗口外与 `Date.UTC` 逐位相同）。另订正台账：破坏性的 `GoalVerdict` 统一被记在 0.85.0，而它真正发布的 0.83.0 被写成「本包零改动」——消费方据此把 0.83.0 当免费重 pin。
- **v1.1.0（2026-07-28）**：**审计第十三波**——**存储契约套件会给坏存储发合格证**（它是交付给宿主验证自家实现的东西，误判通过是此处最坏的缺陷）：`dueBefore` 检查名为 `<=` 却只测过 `500 <= 1000`，用严格小于过滤的存储照样 13/13 通过、却永久扣留每个恰在轮询时刻到期的会话；「按 id 创建或替换」从不断言一 id 一行，追加式存储照样通过而 `listSessions` 一直把旧世代交给调用方；`assertDeepEq` 比 `JSON.stringify` 输出，把**键序**写进了契约，字段全对但按列重建行的存储反而不合格。另修 goal 追逐器：中止落在宿主评审器决策期间仍会多买一轮，循环已派发第 N+1 轮且驱动器执行之后 `#awaitTerminal` 才拒绝（`WorkflowRun.run()` 早有对称守卫）。
- **v0.99.0（2026-07-28）**：**审计第十波（本包份额）**——`docs/ONBOARDING.md` 称契约套件有「16 项」，实为 13 项基础 + 2 项可选缝检查，宿主按 `report.total === 16` 断言会误判三项静默未跑；另本包 `terminal-vocabulary` 守卫射程注明「仅 src」，testbed 的基线导出器与浸泡演练都在射程外重复了被禁写法（已在 testbed 侧修正，规则归属本包故并记）。
- **v0.98.0（2026-07-28）**：**审计第九波（本包份额，全在从未审计面）**——变异棘轮守卫两处静默退出 0（与 agent 侧孪生同款）· **`examples/store-patrol.mjs`（每日在产 CI）五处**：损坏的 committed `ledger.json` 令巡检在构造期永久停摆、截断的 `latest.json` 基线令该店面此后每次尝试都抛、快照非原子写（中途被杀即发布半截文件而工作流照样提交）、`cancelled` 会话被读作在飞而烧光 120 秒排水超时并丢弃健康成果、失败过滤只认 `'failed'` 故未巡检的目标也报「全部巡检完毕」并退出 0 · `examples/memory-tidy.mjs` 把目录项喂给 `readFileSync`（`fragments/` 下一个嵌套目录即 EISDIR，整理此后再不运行）· 三个示例重复了 `terminal-vocabulary` 测试在 `src/` 禁止、而其射程注明「仅 src」的 `done || failed` 写法。
- **v0.95.0（2026-07-28）**：**台账两处缺陷 + 驱动器并发上限竞态修正**（家族审计波及本包，非空转）——`reopenSession` 并发 CAS 落败永久丢溯源链接、`recordOutcome` 回填路径写入词表外 outcome、`stop()`+`start()` 交错令两代 tick 各自认领满额致并发翻倍。

> **一句话**：银芯编排 SDK——持有分子（钟 / 跨会话状态 / 会话装配），把「活得比一次调用久」的
> agent 脏活做成可复用零件交宿主装配；与代理 SDK 分界 = 代理持原子（一次结构化调用）、编排持分子。
> 需求裁定书 `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`。
>
> **进度**（2026-07-18）：第零战 monorepo 迁移完成（仓库转 npm workspace 双包、silver-core-sdk
> npm 名经 `@biav/agent-sdk`（0.66.0）定为 `silver-core-agent-sdk`（0.67.0，守密人同日定名）、依赖方向守卫 CI 执法（maestro→agent 单向，双向违规红证实测））；
> 第一战任务台账 + 驱动器完成（0.2.0）：封闭状态机（pending/running/retrying/failed/done，定稿回填
> 需求档 §4）+ `LedgerStore` 宿主注入缝 + `TaskLedger` + `LedgerDriver` 持钟活组件 + 例程一最小 loop
> （消费代理侧 R2 预算事件流，e2e 对本地仿真器真跑）；纯核 state.ts **变异分 100%**（83/83，
> 棘轮地板 100 入 `sdk-mutation-ratchet.yml` 周检）；第二战商店巡检真实场景接入完成
> （2026-07-18 守密人点火）：`examples/store-patrol.mjs` 生产循环任务长在台账 + 驱动器上——
> Morimens Steam 双端点每日指纹比对，快照 + 变更日志落 `Public-Info-Pool/Record/store-patrol/`，
> CI `store-patrol.yml` 每日北京 15:15 自动跑，e2e 四场景 + 首次生产真跑绿；第三至六战
> （0.4.0，2026-07-18 动态编排令：4 实现代理 + 2 对抗审查 + 单脑整合）完成——schedule（例程二：
> 定点触发/错过补偿/跨重启恢复）+ workflow 图执行器（例程三：图即数据、fail-fast、幂等键断点续跑）
> + goal 追逐器（跨 query 重发起、轮=会话）+ 送达契约（审计先行）；审查抓 4 major + 1 minor 全修全锁
> （类型化 DuplicateSessionError / claimSession 单会话认领 / 四处 id 冒号封禁 / goal 排水超时）；
> 变异靶四处（ledger-state 100 / schedule-spec 100 / workflow-graph 97.14 / goal-decision 100）；测试 171。
> **未做**：周报 loop 生产切换（机制已备，待 T37 推送形态裁定）。
> **版本钟**：2026-07-18 守密人裁定两包**锁步同版**（覆盖需求档 §2 双钟制），0.68.0 起同号、
> CI 守卫相等；此后本节版本号即家族版本号。
>
> **第七战（0.69.0，2026-07-18 守密人待办批 4/5 项）**：workflow 声明式加载
> （`parseWorkflowGraphSource` / `loadWorkflowGraphFile`，json / md fence、坏文件永不抛降级跳过，
> 变异分 100）+ 例程四「综合整理任务」（`examples/memory-tidy.mjs`：定时派发→读健康面
> `assessMemoryStoreHealth`→归并写卡→删碎片→台账收口，黑池做梦例程原型，假钟 e2e）+
> schedule 错过补偿核对（已实现有测试，免补）+ 质量切换：棘轮五族全靶（新增 delivery-channel 100 /
> workflow-load 100，CI 矩阵六靶）、四份 e2e 全部假钟化（三连稳、秒级降毫秒级）；测试 171→180。
>
> **v0.92.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.92.0（Workflow 改真异步启动）前进。

> **v0.90.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.90.0（checkpoint blob 上限，T74 甲案）前进。
> **v0.89.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.89.0（类型面漂移检测工具化，首跑挖出四条「发货了却没声明」的类型缺陷）前进。
> **v0.86.1（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.87.1（嵌套路径普查：timedOutAfterMs 移回基类）前进。
> **v0.86.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.86.0（主循环提示词补回开篇句 + 输出类型普查续：ReadMcpResource 错误字段 + WebSearch 结构化结果）前进。
> **v0.84.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.84.0（记忆索引纪律 + 整理规程）前进。
> **v0.85.0（2026-07-27，goal 判词家族统一）**：**BREAKING（实验面）**——`GoalVerdict` 迁移为与 agent SDK 逐字同形的 `{status: 'achieved'|'not_achieved'|'impossible', reason?}`（原 `{achieved, feedback, impossible?}`）。起因：BPT 接入后报「goal 没效果、模型照样停」，排查定位两包**同名不同形**判词——评审器误用另一包形状时引擎按设计 fail-open 把 malformed verdict 放行为允许停止，goal 无声失效。守密人裁「统一判词类型」：agent 侧 `{status}` 为正典（BPT 实接层不动），Maestro goal 族（零调用点实验面）赶在 GoalChaser 首次接线前迁移；声明式重复不跨包 import（硬性质 §1.2），一个宿主评审器经结构类型同时服务两缝；`GoalRoundPayload.feedback` 字段名保留、改承载 `reason`。迁移映射见 CHANGELOG 0.85.0。
> **v0.85.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.85.0（工具产出结构化结果 + MCP 接受列表扩容）前进。
>
> **v0.82.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.82.0（Read 通读 >256KB 拒绝）前进。
>
> **v0.81.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.81.0（Read 截断页脚补齐官方三件套）前进。
>
> **v0.80.2（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.80.2（对齐 2.1.216 快照基准）前进。
>
> **v0.80.1（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.80.1（两条提示词溯源 slug 改锚 + 刷新 cron 补自检）前进。
>
> **v0.80.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.80.0（工具输出上限对齐 Claude Code 2.1.141：WebFetch 100_000 → Read 的 50_000、Grep `head_limit` 三模式统一默认 250、Bash 输出截断改保尾去头）前进。
>
> **v0.79.1（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.79.1（transport / MCP 内部去重）前进。
>
> **v0.79.0（2026-07-26）**：**重开语义（T67 甲案）+ 三项余项推进**（守密人「按你建议推进」）——`TaskLedger.reopenSession`/`reopenChain`（新会话 + `reopenOf`/`attemptRound` 链，**封闭状态机未动**：终态不可变是 CAS 围栏/幂等派发/重启不复活的共同立足点，缺的从来不是边而是链接；前驱须终态、`cancelled` 默认拒绝、后继 id 从链根派生、payload 可覆盖）· **T68** `docs/CONCURRENCY.md`（本包第二份文档）· **T69** 棘轮 `cadence` 分档（三个零消费靶降月检，加字段不删腿，cadence 自身三条治理断言）· **T70** 空转措辞钉死 + `scripts/sdk_substantive_versions.py`（守卫首跑抓到两条真漂移）。测试 404 → **421**。
> **v0.78.1（2026-07-26）**：**产品审视四项裁定**（审视档 `Public-Info-Pool/Resource/repo-engineering/maestro-sdk-product-review-20260726.md`，同日第二轮，问「作为产品是否成立/有效」）——**P1** 删除无代码支撑的 peerDependency（src 对代理零 import，npm 7+ 自动装 peer 与硬性质①冲突）· **P2** 六族两级成熟度标注（`ledger`/`driver`/`scheduler` **已验证**：两个互不相干真实消费方；`workflow`/`goal`/`delivery` **实验面零调用点**）+ 需求档 §6 补「已验证」标尺（须有非为演示它而写的消费方）· **P3** 首份 `docs/ONBOARDING.md`（store 可复制样板，实测两消费方各自手写 43/38 行、相似度 86%；**测试从 markdown 提取样板真跑契约套件**）· **P5** 判别式补第三维「触发权」（delivery 归属正当、是判据漏维）。**运行时行为零变化**，测试 400 → **404**。
> **v0.78.0（2026-07-26）**：**设计审视四缝全修**（审视档 `Public-Info-Pool/Resource/repo-engineering/maestro-sdk-design-review-20260726.md`，守密人同日四裁均取推荐案）——F1 `cancelled` 终态穿透场景层（三处硬编码 `done || failed`，默认配置下用户取消致工作流/目标追逐**永久挂死**；`graphStatus` 判 fail-fast、`GoalChaser` 新 action `'cancelled'`，新增 `isTerminal`/`isUnsuccessfulTerminal` + **禁字面量终态对的治理守卫**）· F2 驱动器 `maxConcurrent`（实测 200 到期→峰值 200）+ `claimDue(now,{limit})` · F3 可选存储缝 `deleteSession?` + 网关 `purgeSession`（契约套件 +4 检查）· F4 两长跑组件收 `AbortSignal`。测试 362 → **400**，三机制逐条回退负控实证。**未纳入**：Scheduler 全表扫、F5「重开」语义（挂待裁）。
> **v0.77.0（2026-07-26）**：锁步对齐 agent 侧 Windows 正确性清扫，本包零代码改动。
> 值得记一笔——同轮 Windows 探路中 agent SDK 15 个测试档失败，**maestro 362/362 全绿且无需任何改动**，
> 编排层不含宿主路径与 shell 假设。
>
> **当前版本 v0.76.0（2026-07-22）· 0.70.0→0.76.0 合并摘要（2026-07-26 哨兵首跑抓出补写）**：
> 本节此前停在 0.69.0，与 agent 侧同款漂移，由新建的跨档对账哨兵
> `tests/test_status_doc_facts.py` 首跑当场抓出。逐版全文以本包 `CHANGELOG.md` 为唯一权威。
> **T56「500 缺陷战役」五轮审计是本段主线**：0.70.0 轮一（17 finder 代理 + 对抗验证，确认 29 项真
> 缺陷全修带 fail-on-old 锁）· 0.72.0 轮二（6 换镜 finder，16 项含 3 个 P1，含 memory-tidy 经
> `store.view` 归并的数据丢失）· 0.73.0 轮四（4 路故障注入镜，11 项——台账并发大修：attempt 围栏 +
> 每会话互斥 + `putSessionIf` CAS 缝 + settle-then-append 提交序 + 恶意输入硬化）· 0.74.0 轮五
> （6 项：回填分支围栏 / 读面序列化 / 送达通道租约竞态 / 驱动器搁浅信号 / 分数 fireAt 恢复）；
> 战报 `Public-Info-Pool/Resource/repo-engineering/silver-core-maestro-sdk-bug-audit-r4-20260718.md`。
> **0.71.0** testbed 漏缝 G1–G3 采纳（`runLedgerStoreContractSuite` 12 检查 + `claimLeaseMs` 认领租约 +
> `scheduleSessionId()` / `seedFirstRun` 短命宿主收口）；**0.71.3** 打包三修（`files` 带 `src` /
> `prepublishOnly` / `exports` 子路径，与 agent 同缺陷同治）；**0.70.1 / 0.71.1 / 0.71.2 / 0.75.0**
> 为锁步对齐（本包零改动，跟随 agent 侧 deny 绕过修复、r3 批 N+P、批 R+S+T、R7 可观测性）；
> **0.76.0** `cancelled` 封闭终局（BPT P0-D1：用户主动取消升为一等终态，台账可与 `failed` 区分、
> 永不自动重跑；`TaskLedger.cancelSession()` 幂等 + CAS，取消与在飞尝试双向竞态均已钉死，
> 驱动器静默吞掉取消导致的迟到 `InvalidTransitionError`——用户取消不得读作驱动器故障）。
> **实测复核（2026-07-26 本地现跑）**：vitest **362 通过 / 29 文件**（冷态经新 `pretest` 自举）·
> 锁步 agent = maestro = 0.76.0 · dep-direction 守卫 OK。
