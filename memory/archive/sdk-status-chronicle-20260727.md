# Silver Core SDK 状态叙述归档（截至 2026-07-27）

> **⚠ 归档层，不作运行时约束**（守密人 2026-07-27「治理精简」裁定，全套案）：本档是
> `memory/project-status.md`「## Silver Core SDK」节在 2026-07-27 之前累积的**发布编年史 +
> 验收轮记录**，原文逐字迁入，一行未改、一行未删。
>
> **为什么迁**：状态档是「每会话必读的状态权威」，当时 1,123 行、比 CLAUDE.md 长一倍，
> 其中本节独占 **685 行（61%）**——而**逐版发布叙述的唯一权威本就是**
> [`projects/silver-core-sdk/CHANGELOG.md`](../../projects/silver-core-sdk/CHANGELOG.md)
> （它自己开篇即声明是 consumer-facing build ledger，且有 `check-version-bump.mjs` 守着）。
> 同一段历史在三处各存一份（CHANGELOG / 包 CONTEXT / 状态档）只会三处分叉——包 CONTEXT
> 已于 2026-07-26 同理瘦身（472 → 141 行）。
>
> **本档里有 CHANGELOG 没有的东西**，这也是「归档而非删除」的理由：真 L5 验收轮的
> run id / 预算实耗 / gate B 差值、双臂差分与 KD 三角化收官、中文 i18n 成本调查等
> **验证史**——它们不是发布说明，无处可归，故整体留存于此供审计追溯。
>
> **要查什么去哪里**：某一版做了什么 → CHANGELOG；现在能不能动手 → 状态档 +
> `projects/silver-core-sdk/CONTEXT.md`；为什么这么设计 → 该包 `docs/`；
> **某轮验收当时实测多少** → 本档。

---

- **当前版本 v0.76.0（2026-07-22）· 0.70.0→0.76.0 合并摘要（2026-07-26 审视回写，守密人裁定
  「补顶部摘要 + 实测数字」）**：本节此前停在 v0.69.0，其后 **12 个发布未回写**，现合并补齐一条；
  逐版全文以 `projects/silver-core-sdk/CHANGELOG.md` 为唯一发布权威（不在此复刻）。
  **0.70.0 / 0.72.0 / 0.73.0 / 0.74.0 / 0.76.0 = 锁步对齐**（agent 侧零代码，跟随 maestro 的 T56
  审计 1/2/4/5 轮 + `cancelled` 终态）；**0.70.1** 权限 deny 绕过修复（裸子 shell `(rm -rf x)` /
  花括号组曾 DENY fail-open，新增 `stripGroupWrappers`，只放宽 deny/ask 位、allow 分支仍严格）；
  **0.71.0** testbed 漏缝 G4 采纳（`MemoryStore.read?(path)` 原样读回，模型面六命令字节不变）；
  **0.71.1/0.71.2/0.71.3** T51 审计 r3 三批（批 N+P / R+S+T / O+Q，合计 39 条 STILL-LIVE 修复带
  回归锁；含发货打包三修与版本/评估/变异三守卫加固）；**0.72.1** WV2-4 收口（OpenAI 臂仅在端点
  **声明**为推理端点时才丢 `temperature != 1`）；**0.75.0** R7 会话末回写可观测性
  （`SDKMemoryHealth.sessionEndUpdate` 九态 + `Query.memoryHealthSnapshot()`）+ 上游 corpus
  重同步 ccVersion 2.1.213。
  **实测复核（2026-07-26 本地现跑）**：三处版本常量一致 · `tsc --noEmit` 零错误 · vitest
  **3215 通过 + 6 skipped / 196 文件**（原记 3017，**+198**）（**同日复测订正 2026-07-26**：本会话再跑得 **3216 通过 + 5 skipped / 197 文件**，总数同为 3221——差异 = 一条**条件跳过**的用例在两次环境下归属不同 + 文件计数口径（顶层 glob 196 vs 递归 197，vitest 报 197）。两处均为**手抄实测数**，正是`memory/project-status.md` 机器生成事实块要消灭的那一类：静态口径以块内为准，实测通过数留在正文但须带日期。）· tarball 1640 KB / 解包 5.85 MB ·
  `npm audit` 0 漏洞 · 家族锁步 agent = maestro = 0.76.0 · maestro 362 绿 / testbed 33 绿 ·
  依赖方向守卫 + 版本纪律守卫均 OK。
- **v0.69.0（2026-07-18，守密人待办批 SDK 侧 1–3 项）**：① 迁移文档刷新
  `docs/MIGRATION-0.3x-to-0.68.md`（取代 0.52 版：斜杠退役 0.63 / MultiEdit 生命弧 /
  npm 两连改名 / 锁步制 + 13 步黑池升级检查单——黑池升级咽喉铺平）；② 记忆便签三件套
  （COMPAT 上游核对记录：官方 SDK 0.112.3 仅 memory_20250818 对齐无欠账；契约套件并发节：
  单命令原子性 + last-write-wins 两条可执行检查、不加版本令牌；`assessMemoryStoreHealth`
  健康深扫：目录水位软 48 / 腐烂度 mtime 诚实标注 / 容量余量 / supersede 链 / 读写比——
  黑池做梦触发面，黑池侧已确认消费）；③ `provider.capabilities` 端点能力声明（按声明降级
  逐条报告，画像机制维持不立项）+ `options.continuationPrompt` 续跑片段（openai-chat 默认开 /
  anthropic 默认关，双协议假端点 e2e 验证注入）。3017 单测全绿 + 2 skipped（+19）。
- **v0.63.1（2026-07-17，T49 批B · P0 存量高危+安全 6 项修复）**：H1 Edit/MultiEdit 非 UTF-8
  拒改守卫（`isUtf8`，防未编辑字节全文变 U+FFFD，顺带钝化 L15 Edit 侧）；H2 thinking 线型改按
  实发模型（`computeThinking(useModel)`，跨世代 fallback 不再必 400）；H3 openai 臂
  finish_reason 后网关挂尾巴——尾窗连接层错误按完成收束、不再丢弃完整轮（include_usage 尾块
  可能丢失，诚实记录的可接受降级）；H4 工具参数 JSON 跨 delta 块截断（max_tokens 常规切）由
  「accumulator 抛错灭整轮」降级为「input:{} + 不可枚举截断戳」——max_tokens 轮照常成功收尾
  （C6 滤孤儿）、tool_use 轮带新 `error_code: 'tool_input_truncated'` 可诊断失败且**绝不执行**
  截断参数；审计所述「UTF-8 多字节被块边界切断」机制经探针**证伪**（流式 TextDecoder 本就跨块
  重组）并锁进测试；H5 结构化输出提取改 schema-aware（逐候选验证取首个有效跨度，前导「合法但错」
  JSON 不再抢占），验证器下沉 `internal/structured-output.ts`（引擎门面转发），workflow
  `agent()` opts.schema 由「顶层 required 浅检」换装同一真验证器；M17 跨协议子代理 transport
  记忆键补齐**租户身份**（协议+派生配置+凭据 env 链+函数按引用），多租户共享 resolver 不再串号。
  回归锁 `tests/t49-batch-b.test.ts` 21 测；全量 vitest 2476 绿 + tsc 干净。
- **v0.60.0（2026-07-14，`/goal` 会话目标原语，守密人「把 goal 命令也给实现了吧」派单）**：
  与 /loop 同类表面缺口——引擎 Stop-hook block 语义（v0.39）与 stop 变体条件评估器（v0.6）早已
  发货，`/goal` 却无人解析。新模块 `src/hooks/session-goal.ts`（BPT-EXTENSION）：`parseGoalCommand`
  （set / clear）+ `createSessionGoal`（Stop matcher：未达成 block 停止并回喂理由续跑、达成自动
  撤防、impossible 逃生口撤防；`handleCommand` 一调用桥接、`onEvent` 通知、`maxBlocks` 帽、
  transcript 尾部有界上下文）。失败方向与通用条件门**刻意反向**：坏裁判（评估器故障 / 乱码 /
  零上下文）一律放行停止、目标保持布防，绝不困死 agent；零上下文不盲判。+20 测试。
- **v0.59.0（2026-07-14，BPT `/loop` 缺口收口，守密人同日裁定「SDK 侧加循环原语」）**：
  BPT 调查确认 `/loop 10m <任务>` 未被任何层解释、原样透传为一次性 prompt（GUI 未注册 /loop、
  SDK 斜杠层仅 /compact 内建 + markdown 展开、周期语义静默丢失）。新公开模块 `src/prompt-loop.ts`
  （BPT-EXTENSION）：`parseLoopCommand` 语法唯一真相源（`/loop [<interval>] <task>`，s/m/h + 别名 +
  小数，缺省 10m，三态返回、数字开头非法区间 fail-closed、界 [1s, 2^31-1ms] 防 setTimeout 溢出）+
  `createPromptLoop` 固定延迟控制器（立即首跑、结清后再计时绝不重叠、maxIterations / AbortSignal /
  onError 策略、done 摘要永不 reject）+ `LOOP_SLASH_COMMAND` 菜单元数据（刻意不进引擎内建，守诚实
  红线）。BPT 侧只余十行桥接（README 附范本）。+24 测试，全量 **2384 绿 + 2 skipped**；
  「循环/调度」自 v0.5 推迟清单转正落地。
- **v0.53.3（2026-07-13，BPT 稳定性《keep-alive 空闲 socket TTL》）**：修复黑池升 pin 后
  「回合卡住无输出、并发对话越多越易发」——0.45.0 默认 node HTTP 客户端把池化 socket 握到
  「服务端来关」为止，但 azure/* 等网关中间设备**静默丢弃**空闲连接（不发 FIN/RST），池内积累
  僵尸 socket；写上去的请求要等满请求阶段超时（默认 600 秒），重试还可能摸到下一条僵尸；
  0.45 之前 undici 约 4 秒回收空闲连接、掩盖了整类问题。修复：空闲 socket 55 秒 TTL 主动销毁
  （`FREE_SOCKET_TTL_MS`，压在常见 60 秒中间设备空闲底线之下；计时器 unref、复用即清零重计），
  过期只花一次 TCP+TLS 重握手（约 100–300 毫秒，TLS 会话恢复不受影响）；Agent 显式钉
  `scheduling:'lifo'`。逃生口不变（`provider.httpClient:'fetch'` / `BPT_HTTP_CLIENT=fetch`）。
  +2 测试，全量 **2145 绿 + 3 skipped**（多出的 1 个 skip 为 `replay-backoff-process-exit`
  在云容器的环境性跳过，非本改动引起）；tarball `silver-core-sdk-0.53.3.tgz`（809,430 B，
  sha1 `d5dc13c03a7b43daaa21d72285faebce8cb9150e`）已干净目录装机 + 导入冒烟。
  **消费侧速判三则**（黑池工具快照对不上源码登记 ≠ 版本不同步）：`memory` 工具仅在传
  `options.memory` 时才广告（`query.ts`）、`ToolSearch` 仅在 `toolSearch:true` 或工具总数
  >50 自动激活时出现（`toolsearch.ts` `shouldActivate`）、`SendMessage` 自 0.42.0 起默认在列
  ——宿主权限表须显式登记（迁移文档 §1.5 已预警）。
- **v0.53.2（2026-07-13，BPT P0《工具 Schema 边界校验与协议安全》，PR #665）**：修复 azure/*（OpenAI
  Chat Completions 兼容）网关整请求被拒（`tools.N.custom.input_schema: Field required`——单个缺失/非法
  `input_schema` 的工具条目令整段对话无法开始）。三层收口：① 组装层（`engine/loop.ts`）内置/MCP
  非对象 Schema（缺失/null/数组/原始值）归一化为 `{type:'object',properties:{}}` + 带工具名 debug 诊断；
  ② `serverTools` 中 `type:'custom'`（或空 type）条目记诊断跳过、不再抑制同名内置工具，Anthropic 原生
  typed 条目（`memory_20250818`）直通不变；③ OpenAI 传输层 `encodeOpenAIRequest()` 末道过滤只放行
  非数组对象 Schema。+10 测试，全量 **2144 绿 + 2 skipped**；tarball `silver-core-sdk-0.53.2.tgz`
  （807,371 B，sha1 `223aaf8242b020572954d0810e82d45e86a8bc86`）已干净目录装机 + 导入冒烟。
  版本 0.53.1→0.53.2（0.53.1 已被同日 #667 提示词对齐批占用，按台账纪律重编号）。
- **0.3x→0.52 消费方迁移战役（2026-07-12 通宵批，为黑池次日 pin 升级预趟坑；docs/tests/scripts-only 零 src 改动）**：
  编译器级冻结双端点旧消费面（fixture `tests/fixtures/legacy-0-3x-surface.json`：0.30.0/0.39.0 全导出 + Options 字段）——
  结论 **0.39.0 pin 零缺失、0.30.0 pin 仅缺 `harnessPromptVariant`（0.33.0 移除）**，导出面纯增量；
  迁移文档 `docs/MIGRATION-0.3x-to-0.52.md`（收益/选入/破坏点三节，破坏点=更名 0.41 / drain-note XML 0.42 /
  变体旋钮 0.33 / Stop-hook block 0.39 + 五项默认语义迁移）+ legacy-consumer 常驻测试 11 条进 `npm test` +
  day-one 金丝雀 `scripts/canary-day-one.mjs`（零钥四查全绿，`--live` 可打真 API）；
  **同日追加批（守密人补充实 pin=0.37.1）**：第三端点入 fixture（对 0.52.0 零缺失）、迁移文档增实 pin
  专属清单 §0-pre + 0.37.1/0.38.0 同名双胞胎构建鉴别法（版本常量事故遗产，导出面核实全等）
- **环三首轮自改循环收官（2026-07-12，守密人「循环自改、合并自断」授权，6 单全并）**：
  self-improve **#1–#6** 当日走完六个完整「定位→修复→分支 LIVE 验证→合并」周期——
  #1 tok-06 接线修复（PR #622，管线验收单）/ #2 判卷校验闸（#624）/ #3 确定性切流
  `cutAfterTextDeltas`（#625）/ #4 judge 预算 4096+重试（#627）/ #5 runlog 追加序列化
  （#630，**v0.51.2** 发货修复：台账顺序=到达顺序 + `flush()`）/ #6 判卷证据瘦身
  `trimEvidence`（#631）。判卷成功率 15/20 → 18-19/20，四轮门禁全 PASS，末轮
  （run [29194232519](https://github.com/lightproud/brain-in-a-vat/actions/runs/29194232519)）
  9 作业全绿、维度均分 memory **5.00** / token 4.57 / disconnect 3.80。**停机判定**（授权终点）：
  基础设施四层无已知可修缺陷；残余三类——① **dc-03 语义冲突待守密人裁**（引擎「半截话作答」
  忠实复刻官方 E3 vs rubric 期待续写，两轮稳定 1 分，改 rubric=基线重置专权）；② mem-03/dc-05
  顽固无分对子转观察（3 轮 5 次 judge 结构化输出失败）；③ judge 方差（mem-01 零改动 2→5 实证）
  与 estBytes 等收益递减项不再专门烧轮。判卷侧当日约 $15（$30/月帽内）。裁定全文
  `memory/decisions.md` 同日「自改循环授权 + 首轮循环收官」条。
- **self-improve #7：判卷 HTTP 错误分类（2026-07-12，判卷无关硬化，收官后补一单）**：
  收官后点火的确诊轮（run [29196113106](https://github.com/lightproud/brain-in-a-vat/actions/runs/29196113106)）
  20 题全 judge HTTP 400——完整报文是 **`invalid_request_error: Your credit balance is too low`**
  （API 账户余额耗尽，非代码缺陷，与 2026-07-07 v0.14.0 余额耗尽轮同类「无效不可采信」）。
  基础设施**正确降级**（20 题全记 ERROR、维度均值空、REQ-2.2 只发 advisory 警告不误报假回归——
  self-improve #2 均值防毒化在判卷全线中断下按设计工作的铁证）。但暴露两个判卷无关缺陷：① 账单/鉴权
  类 400 被当瞬时错误盲目重试一次（注定失败、白烧已耗尽余额）；② 报告 90 字备注格被 JSON 信封前缀
  `…"message":"` 占满，真因得钻原始 CI 日志才见。**修复**：`classifyJudgeError()`（`scripts/eval-scoring.mjs`
  纯函数）按状态码 + 报文分诊——billing/auth/permission/其他 4xx 为终态 `retryable:false`（judge() 不再
  空重试），429/5xx/529 仍为瞬时可重试；备注前置 `[kind]` + API 原文，截断格也读得出「billing: Your
  credit balance is too low」。+4 测试（`tests/eval-scoring.test.ts`，**1905 全绿 + 2 skipped**）。
  仅改 scripts/ + tests/（非 shipped `src/**`），版本升号守卫豁免、无需升版。**判卷侧证分待守密人为
  API 账户充值后重跑**（dc-03 续写旗分数复核 + mem-03/dc-05 深挖一单 judgeDiag 收集均阻塞于此）。
- **无钥替代：dc-05 双桶台账确定性断言（2026-07-12，充值阻塞下的免费推进）**：守密人 API 暂无法充值，
  遂把被判卷阻塞的机械内核转成无钥断言（`tests/eval-harness-faults.test.ts` 本地 SSE 模拟器驱真引擎，
  零 API 零成本）。**结论**：① **dc-03 续写旗机械核早已无钥覆盖**（`engine.test.ts:2279`
  断言 `salvageMode:'continue'`→`turnsSalvaged:0,turnReplays:1`），不真阻塞；② **dc-05「只记一个桶」被
  证伪**——新增混合故障断言（网络错 POST#1 + 流中切断 POST#2 同处一轮）实测 `networkRetries≥1` **且**
  drop/recovery 桶 `≥1` **同时成立**，引擎台账双桶各记一笔、并未漏记；judge 那句 2 分说的是喂它的证据只
  浮现一个桶（呈现/rubric 层面），**非引擎缺陷**。价值 = 免费永久 CI 双桶回归锁 + 无需判卷即判明 dc-05
  工程无罪。**判卷侧真剩项**（确须付费判卷、无钥不可复现）：mem-03/dc-05 judge 结构化输出偶发失败的
  深挖，属判卷官模型行为、待充值后收 judgeDiag。**1906 全绿 + 2 skipped**（+1 混合故障断言）、仅改 tests/。
- **首份全量 LIVE 评估基线（2026-07-12，run [29178972282](https://github.com/lightproud/brain-in-a-vat/actions/runs/29178972282)，v0.51.1）**：
  20 题全执行（8 题 Phase 2 harness 首次真跑真判），**19 判卷成功 / 1 judge 解析错误（tok-02，偶发）**；
  维度均分 memory_recall **4.86** / disconnect_recovery **4.00** / token_efficiency **4.33**，
  已播种 `projects/silver-core-sdk/evals-baseline.json`（REQ-2.2 回归门禁自此有基可比）。
  **三项真发现 = 环三首批改进候选**：① tok-06 得 1 分——`allowedTools:['Read']` 时系统提示词仍
  装配全 22 工具描述（token 效率真缺口）；② dc-05 得 2 分——混合故障中流中切断的台账归因不全
  （transportHealth 只记到一个事件桶）；③ dc-03 得 3 分——截断抢救的计数器归因与预期不符。
  低分不修不遮：正是评估轮的产出物，按压缩后节拍进环三处理。**基线轮点火史**：首次点火
  run 29178257816 以 exit 13 失败、当场揪出并修掉引擎回放退避 unref 缺陷（v0.51.1 + 踩坑 #50），
  重点火即绿——评估环第一天就抓到一个发货级缺陷，闭环价值自证。
- **阶段时间压缩裁定（2026-07-12，守密人「压缩到最短」口谕）**：SCS-REQ-002 日历等待全压——
  Phase 0 观察并行不阻塞、**Phase 3（环三改进执行）即日启动**（先提示词类，首 PR 合并即放开
  代码类）、「夜间」改按需触发、Phase 4 复盘改「累计 5 个自改 PR」触发；首轮 LIVE 基线轮
  同日点火（$30/月判卷帽内），分数播种 `evals-baseline.json` 后 REQ-2.2 门禁上岗。
  裁定全文 `memory/decisions.md` 同日条 + 需求书归档注。
- **自我改进闭环推进批（v0.51.0，2026-07-12，守密人「全面推进剩余的工作」派发）**：四件一 PR 收口。
  ① **REQ-1.2 报告归档与趋势**——`compareReports(dateA, dateB, {logDir})` 按 UTC 日重聚合台账、
  出关键指标 b-a 差值（记录/会话/传输故障总量+按因/未恢复/失败/输入输出 token/缓存命中 pp/成本/
  工具调用与失败率 pp）+ agent 可读 Markdown 表，无数据日显式 null / 无数据（绝不伪装零）；
  `generateRuntimeReport` 报告文件 30 天滚动剪除（`retentionDays` 默认 30、0 关），原始台账**默认永不剪**
  （`ledgerRetentionDays` 显式选入才剪）。② **Phase 2 故障注入 harness**——`scripts/eval-harnesses.mjs`
  注册表按题 id 键控，8 题 `driver:"manual"` 全部解锁（dc-01/02/03/05/06 = provider.fetch 缝故障注入，
  SSE 字节级精确切流；dc-04 = 硬杀+会话 resume；mem-03/tok-04 = 压缩压力 + R7 落盘证据），
  **题库字节零改动**（治理边界：harness 在受保护 evals/ 目录之外）；run-evals.mjs 接注册表，
  STUB 轮实测 pending-harness 8→0。③ **REQ-2.2 评估回归门禁**——`scripts/check-eval-regression.mjs`
  维度均分对基线降幅 >0.5 出 `::warning::`（报警不阻断，无基线显式 SKIP、`--write-baseline` 从 LIVE
  轮播种基线），挂 run-evals-live 作业。④ **Batches 五折判卷通道**——`--judge-batches` 走 Message
  Batches API（判卷参数与行内逐字节同源），dispatch 输入 `run_evals` 升三态 choice
  false/inline/batches（GitHub 10 输入上限，不加新 flag）。evals/README.md 陈旧 PENDING 段同步更新
  + 清单重签（题面/判卷提示词零字节改动，非基线重置）。+17 测试（**1885 全绿 + 2 skipped**）、
  tsc + build exit 0、仓库级 pytest 2792 绿。
- **loop-1 信号侧 v0.50.0（2026-07-12，PR #612，REQ-1.1）**：`options.runLog` 把每条消费方可见
  result 镜像为一行 facts-only JSONL（`runlog-{date}.jsonl`：subtype/计数器/usage/缓存比/成本/
  transportHealth 台账/逐工具调用与错误/模型 id，零对话内容；无痕记录保传输/token 统计、
  去身份/标签/错误文本，spec §6.4；fire-and-forget 追加绝不破坏运行）+
  `generateRuntimeReport()` 将滚动窗口（默认 24h）折成 `runtime-report-{date}.md` 四节
  （传输健康+未恢复清单 / token 按场景 / 工具×失败率 / 失败会话仅事实），缺信号显式「无数据」、
  列表带帽、日志目录缺失优雅降级。新档 `docs/REPORTING.md`；+8 测试。
- **自我改进闭环 Phase 0 + Phase 1 实装（v0.49.0，2026-07-11，承同日四裁定，守密人「推进剩余项目」派发）**：
  **Phase 0（REQ-3.2 踩坑记录）**——`options.memory.pitfalls` 选入式注入 sdk-original 踩坑记录协议
  （非显因失败落 `/memories/pitfalls/`，逐坑一文件：现象/根因/修法/规避；剥离规则「仅技术事实、
  不评价个人」；双装配模式均生效、无痕会话强制关闭），两周 ≥10 条有效记录为环三 go/no-go 先导信号。
  **Phase 1（REQ-2.1 评估基准）**——`evals/` 题库 20 草题（提炼 14 + 构造 6；memory_recall 7 /
  disconnect_recovery 6 / token_efficiency 7；**r0 draft，定稿权守密人，挂账 #T32**）+ 固定判分
  提示词（judge 钉 `claude-sonnet-5`）+ 防篡改清单（`MANIFEST.sha256` + 治理测试，「改考题」即红）
  + 双层运行器 `scripts/run-evals.mjs`（底线层全量 vitest + 行为层 12 题 prompt-session 可驱动 /
  8 题 PENDING_HARNESS 显式记账待 Phase 2 故障注入 harness；无 key STUB 验管线）。
  +11 测试（全量 1848 绿 + 2 skip）。Batches 五折夜跑接线与故障注入 harness 留 Phase 2。
- **自我改进闭环需求书 SCS-REQ-002 草案归档 + 阻塞项四裁定（2026-07-11，守密人手书、艾瑞卡落档；
  同日裁定销案 T25/T26）**：四环闭环（环一信号采集与聚合 → 环二评估基准 → 环三改进执行 → 环四
  人工把关）需求明细 + Phase 0–4 分阶段落地路线，归档 `memory/active/self-improvement-requirements.md`。
  硬序：环二先于环三——无评估基准之前不启动任何 agent 自主改代码任务；Phase 0（REQ-3.2 踩坑记录
  先行）为零代码改动先行通道。**阻塞项已全裁**（`memory/decisions.md` 2026-07-11「SCS-REQ-002
  阻塞项四裁定」条）：评分模型 = Claude Sonnet 5、判卷预算帽 $30/月、20 题来源 = 提炼为主 + 人工补、
  环三沙箱 = 独立 checkout 目录——**Phase 1（维护者出题 + runEvals()）阻塞解除、即日可启动**。
  前置文档 SCS-REQ-001 = 记忆系统需求书（`projects/silver-core-sdk/docs/MEMORY.md`，M1/M2 已落地，
  见下方两条）。
- **记忆治理 P0 组落地（v0.48.0，2026-07-11，spec S1–S4，守密人 0711 需求书派发）**：需求书
  《记忆系统、隐私治理与会议记录支持》SDK 侧收口（归档 `projects/silver-core-sdk/docs/MEMORY-GOVERNANCE.md`）。
  S1 作用域路由（`options.memory.mounts` 按 query 声明子树 read-only/read-write，工具层在 R4 之上
  强制：只读拒写 / 挂载外拒读写 / 祖先目录列目录按挂载可见性过滤 / rename 双端 / R6 索引挂载可读才注入）；
  S2 无痕原语（`options.incognito` 零持久化：转录不落盘、memory 只读降级 view 可用、R7 两写回合关断、
  S3 记录抑制；泄漏测试清单落集成测试，标记词全盘 grep 零残留）；S3 结构化工具调用日志（每次派发
  一条 `tool_call` JSONL 记录：名/截断参数/时间戳/序号/成败/耗时/摘要，子代理带 parent_tool_use_id，
  `getSessionToolCalls` 读回）；S4 声明核验（`auditToolClaims` 检出「嘴上说调了、日志无记录」，
  漏报优先压低）。S5 由按 query 组合满足（team-ro 会话与 team-rw synthesis 同 store 并存入测试）、
  S6 预留由 S3 记录携 session_id 兑现。+32 测试（全量 1812 绿）。挂账：`memory/todo.md`
  #T27（无痕 memory 读权限待拍板，现默认保留）、#T28（BPT 侧多用户隔离 / 计费归属回填）。
- **记忆系统 M2 落地（v0.47.0，2026-07-11，spec R7–R9，随 M1 同日；spec r1 全量收口）**：R7 压缩前
  落盘回合（auto 触发将至先注入一次写入机会、PreCompact 可 deny、每折叠周期恰一次）+ 会话正常终结
  进度卡回合（abort/错误不触发；回合 result 被吸收，任务自身 result 仍为流内最后一个）；R8 治理限额
  （64KB/文件、64 文件/目录、view 16k 截断带 view_range 提示，引擎 + 工具层双层）+ `metrics.memoryHealth`
  （次数/读写字节/索引注入 token）；R9 `schema:'cards'` 记忆卡（结论/依据/过期条件，结构化可重试错误）。
  live-smoke 第 3 阶段（真 API 原生模式）+ conformance 记忆轴 mock 线缆锁（官方臂差分槽位挂 todo #T20）。
  +31 测试（全量 1782 绿）。六项余项裁定见 `memory/decisions.md` 2026-07-11 记忆系统条（CI 门禁改口径挂 #T19）。
- **记忆系统 M1 落地（v0.46.0，2026-07-11，spec r1 R1–R6 全量，PR #585 已合并）**：`options.memory`
  六命令 memory 工具（memory_20250818 协议等价、参考返回字符串逐字节 golden 锁）+ 双模式装配
  （native 直通官方类型条目 / custom 自带 schema + 官方逐字协议提示，双模式存储产物 diff 为空）
  + `MemoryStore` 契约（黑池注入点）与 `MemoryFileOps` 原语层（`createMemoryStore` 参考格式单点
  收口）+ 本地默认 store + 可独立交付黑池的契约测试套件 `runMemoryStoreContractSuite` + R4 穿越
  攻击集 23 变体（发版门禁）+ `/memories/MEMORY.md` 索引常驻（200 行 / 25KB 双帽）。M2（R7 钩子
  联动 / R8 治理限额 / R9 记忆卡）待建；需求书 r1 归档 `projects/silver-core-sdk/docs/MEMORY.md`。
  +80 测试（全量 1755 绿）；新增典型错误类 `MemoryToolError`。
- **B 类首批骨架命令文本 batch 1（2026-07-11，销 todo #T10，已落）**：三张命令卡
  （`/review` low/medium/high + `/simplify` low/high 结构再现、`/loop` 固定模式）落
  `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-builtin-commands-batch1-20260711.md`——
  结构照 OBS-005/007 编排思想（档位闸门 / 相位编排 / 回执三件套），文本自写、零官方句子
  自查实跑（559 快照反查 10 抽查句：9 句 0 命中、1 处撞词 `adversarial verify` 改写
  `refutation pass` 后复归 0 命中），品牌按 2026-07-08 去牌裁定用 BPT。方案二期 M3
  内建源前置件就位；动态自调步文本留 #T13、其余重型件走逐命令例外通道。另注：同会话
  基于 T4 陈旧镜像撞车点火 run 29135224871（$5 帽全量轮 = T17 选项一），处置与呈报
  见 `memory/todo.md` #T17 撞车注记。
- **网络层默认客户端裁定落地（v0.45.0，2026-07-11，守密人「做」裁定，已落）**：承 v0.44.0 评估
  四方案实测定谳（裁定全文 `memory/decisions.md` 同日条）。①**丁转正**：内建零依赖 node:http(s)
  长保活适配器 `src/transport/node-http.ts` 为默认 HTTP 客户端（TLS 会话缓存 + 空闲 socket unref
  防进程挂死 + 显式 content-length 防网关拒 chunked），经 provider.fetch 缝后灌入、传输层与孪生
  纪律零改动；每回合 ~100-300ms 重握手税就地消除、消费方零接线（T18 销案）。回退：
  `provider.httpClient:'fetch'` / `BPT_HTTP_CLIENT=fetch`。②**丙并入**：`provider.preconnect`
  构造期预热旋钮（默认关）。③甲（undici 依赖）不做、乙（HTTP/2）实测判死搁置（allowH2 零复用或
  流串行化 223ms→1262ms）。证据：本地 TLS 对照（4 秒断崖实锤 / 丁 21 请求单连接 / isSessionReused /
  0.86 vs 2.62ms）+ 真 SDK e2e 三关。ARCHITECTURE 错误白名单补 transport TypeError（fetch 形状
  忠实）。+9 测（适配器保真 / 复用 / 中止 / unref / 判序 / node 客户端仿真器 e2e），存量测试以
  BPT_HTTP_CLIENT=fetch 钉扎其全局 fetch 桩语义，**1675 全绿 + 2 skipped（80 文件）**、tsc + build
  exit 0、版本三方对账过（0.45.0）。
- **响应时间优化过审（v0.44.0，2026-07-11，守密人「审视 silver core sdk 优化响应时间」派单，已落）**：
  先测后改——新增零密钥仿真器延迟探针 `tests/integration/perf-overhead.mjs`（30 回合工具环 +
  8000 事件流两场景，中位数计量）确认引擎本体开销仅 ~1ms/回合，真正大头在网络层。四项落地：
  ① **`provider.fetch` 注入缝（BPT-EXTENSION，双传输孪生同享）**——Node 内建 fetch 连接池默认
  ~4 秒空闲即断，工具执行超 4 秒的回合每回合重付 TCP+TLS 握手（约 100-300ms）；消费方注入长
  keep-alive undici Agent 即消除，配方见新档 `docs/PERFORMANCE.md`（未注入时调用期晚绑定回退全局
  fetch，测试桩 / setGlobalDispatcher 均照常生效）；② **空闲看门狗惰性重臂**——每 SSE 事件成本从
  clearTimeout+setTimeout 一对降为一次时间戳写入，单计时器按剩余间隙自重臂、超时语义不变；
  ③ **工具定义每回合单次构建**——压缩估算与该回合全部流尝试（重放 / fallback 含）共享一次
  `buildToolDefs()`，全 schema stringify 估算按工具名集缓存；④ **SSE 解析器偏移扫描**——每 chunk
  仅重切一次缓冲（原先逐行重拷贝，行数二次方）。探针中位数（repeat=9 同机）：30 回合引擎记账
  29.7ms→18.0ms（-39%）、8000 事件流 CPU 53.3ms→46.3ms。+3 测（注入缝双传输 + 重试路径），
  **1666 全绿 + 2 skipped（79 文件）**、tsc + build exit 0；孪生纪律测试保持绿。
  消费方接线挂账 T18 已随 v0.45.0 丁转正销案（保活改 SDK 内建默认，见下条）。
- **断线韧性全量落地（v0.43.0，2026-07-10，守密人「全量」裁定，已落）**：承「实际使用时不时断线」
  痛点，落四层兜底模型（设计档 `projects/silver-core-sdk/docs/RESILIENCE.md`，裁定见 decisions.md 同日条）：
  ① **P0-1 有界回合重放**——零采信流失败（零事件 / 零事件卡死 / 打捞落空的废弃残片）回合级重放 2 次
  （`TURN_REPLAY_LIMIT`），`api_retry` reason `turn_replay:*` 全程可见；② **P0-2 断因计账**——
  `metrics.transportHealth` 八计数器（BPT-EXTENSION），修哪层看账本；③ **P1 响应体治理权改判**——
  `timeoutMs` 只管请求期，活流归 idle 看门狗 + 可选 `streamMaxDurationMs` 硬上限（新错误码
  `stream_max_duration`），超时/硬上限截断纳入 E3 打捞，双治理器全关回退 timeoutMs 保永不无界；
  ④ **P2 消费方配方**——RESILIENCE.md §5 会话级自动续接循环（`resume` + `error_code` 分类）。
  双传输线经孪生纪律同享；引擎新增 4 测 + 传输层新增/改写 4 测。
- **O-B2 收官：SendMessage 本体 + 子代理续接 + coordinator 预设（v0.42.0，2026-07-10，守密人「全部开工」，已落）**：
  体验设计档四缝最后一条焊完。① **续接注册表**（`src/subagents/runtime.ts`）：每个子代理连
  live 转录数组 + deps/config 留存至 query 生命周期尾，SendMessage 按 agentId 定址续跑——
  上下文完整保留、同代理消息串行、**已停止（killed）工人可复活续接**（官方语义，控制器换新）；
  ② **SendMessage 工具**（`src/tools/sendmessage.ts`，描述改编自语料 2.1.199）：前台子代理阻塞
  返回回复、后台子代理 ack + 回复走后续 drain 轮；**根环专属**（隔离子代理不见 schema、fork
  子代理保 schema 维持缓存字节对齐但诚实报错）；③ **drain 格式对齐官方**：后台完成注入从自造
  `[background subagent …]` 前缀改为官方 `<task-notification>` XML（task-id/status/summary/
  result/usage，语料逐字锚点）——**破坏性**，消费方需改配（CHANGELOG 0.42.0）；④ **TaskStop
  扩容**：`task_id` 兼认子代理 agentId（官方 v2.1.198），先查子代理注册表再落 shell；⑤
  **coordinator 预设**（红线随本体落地解锁）：`COORDINATOR_MODE_PROMPT`（改编复现 @2.1.199，
  去牌 + 工具名代入 + 缺席工具子句 gate + 两处引擎诚实注记）+ `COORDINATOR_WORKER_AGENT`
  （忠实复现 @2.1.182，maxTurns 200），包根导出，红线守卫扩挂两文。**+17 测**
  （`tests/sendmessage.test.ts`：续接上下文 / 串行化 / 复活 / XML 格式 / TaskStop 桥 /
  语料锚点），**1651 全绿 + 2 skipped（77 文件）**、`tsc` + `build` exit 0。
- **SDK 命令框架消费手册（2026-07-10，守密人「银芯需要派一个说明书给黑池消费方」派单，已落）**：
  黑池开发者向接线手册 `Public-Info-Pool/Resource/repo-engineering/silver-core-sdk-command-consumer-manual-20260710.md`
  ——五模块各接哪个 SDK 口的总图 + 六节配方（透传纪律 / 控制面直连与通报注入 / 面板双数据源与
  装载三语义 / resume 重入双闸 / **goal 门控完整配方**（condition 反写实现零状态自动清除、
  stop_hook_active 收敛提示、per-query 重注册生命周期）/ 反模式五条）。代码形状核实于 v0.39 源码、
  经 0.40（纯追官方类型面）/ 0.41（纯更名）CHANGELOG 确认无涉（含诚实边界：官方 `shouldQuery`
  本 SDK 未实现，给 UserPromptSubmit additionalContext 等价配方）。至此闭环五件套：
  需求 → 观测 → 方案 → SDK → **消费手册**。
- **命令自体试用观测 + 落成方案（2026-07-10，守密人 /goal「你自己试一下所有命令，
  然后分析命令的实现，落成方案」，已落）**：艾瑞卡自触 8 组命令/工具族（Skill 族
  validate-data/keybindings-help/loop/code-review-low + 调度双平面 Cron 三连与服务端
  Routine 三连 + 注册表联邦枚举）+ 守密人触发 2 组（/model、/goal×2），观测台账扩至
  **OBS-001~010**。核心定论：命令实现为**四层架构**（客户端本地 / 技能注入 / harness
  工具 / 引擎），B/C/D/E 四类实为**一套技能注入机制的四个联邦注册源**；调度双平面
  （会话级内存 cron vs 服务端持久 Routine）；/loop 现有快照未收录的「动态自调步」模式。
  落成方案 `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-command-impl-plan-20260710.md`
  （五模块 M1-M5 / 三期实施 / 验收 V9 新增 / 观测契约逐项移植）。
- **Stop 钩子阻断语义 = /goal 门控积木（v0.39.0，2026-07-10，守密人三项裁定「①结构再现②工作模式观测③/goal 派单没问题」，已落）**：
  引擎按官方语义处理 Stop 钩子 block——reason 注入用户回合续跑、`stop_hook_active` 真值防死循环、
  `continue:false` 强停优先、**仅主循环生效**（子代理归 SubagentStop，目标门不误伤 fan-out）、
  maxTurns/maxBudgetUsd 兜底（`tests/stop-hook-block.test.ts` 5 测）。与既有钩子 condition 模型评估器合体 =
  完整 /goal 引擎侧等价物（零提示词再现）。**同工单落档**：①两条裁定入 `memory/decisions.md`（B 类骨架提示词
  「结构再现+文本自写」默认 + 行为观测法入方法论）；②行为观测台账
  `Public-Info-Pool/Resource/repo-engineering/cc-command-behavior-observations-20260710.md`（OBS-001 /model、
  OBS-002 /goal 首批）；③需求说明书 v1.1 补 R5 目标门控 + 验收 V8；④踩坑 #45（rebase --ours/--theirs 反转
  致 v0.38 版本常量带 0.37.1 上线，v0.39 重对齐 + 三层防线）。
- **自定义 slash 命令（v0.38.0，2026-07-10，守密人 /goal「全面实现建议」目标令，已落）**：
  官方 `.claude/commands` 自定义命令面的 SDK 侧子集再现（`src/engine/slash-commands.ts`）：
  按 settingSources 装载 project+user 命令 md（':' 子目录命名空间 / project 胜出 / 内建名保留 / I/O 失败优雅降级）、
  纯文本 `/name args` 回合入线前展开（`$ARGUMENTS`+`$1..$9`；hook 与 firstPrompt 见原文、history/resume 载展开文）、
  `system/init.slash_commands` 与 `supportedCommands()` 返真（内建 compact + 自定义，官方 SlashCommand 四字段型对齐）。
  `!bash`/`@file`/`allowed-tools`/`model` frontmatter 声明不支持（COMPAT.md「Custom slash commands」节）。
  **1620 单测全绿（+21）**、`tsc`+`build` exit 0。产物三件：五类命令全景盘点
  `Public-Info-Pool/Resource/repo-engineering/cc-engine-external-commands-20260710.md`、
  黑池需求说明书（壳层 A 类命令面板 + 调度平面归壳 + 验收 V1-V7）
  `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-command-framework-requirements-20260710.md`。
  挂账两条：B 类官方骨架提示词再现（须过 G8 同款「公开信息再现」裁定）、`/goal` 机制（快照未捕获，挂每周参照刷新观察）。
- **审计债务清偿（v0.37.0，2026-07-10，守密人「将所有审计的技术债务还完」目标令，已落）**：
  四维审计（`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-optimization-review-20260710.md`）P0/P1/P2 全量落地：
  3 P0 真缺陷修复（交错 tool_calls / 孤儿 tool_use 入库 / TaskOutput 阻塞无视 abort）、P1 加固
  （压缩触发 O(n²)+真值地板 / hookFailureMode fail-safe / pending_turn 终局 settle / 存储 I/O /
  OpenAI 网关 modelMap+Azure+pricing+informational 警告）、P2 结构（import 纪律守卫+断环 / 双胞胎防漂移 /
  五件大文件抽取 query 2008→约1530 行、loop 1519→约1160 行 / system 场契约测试 / version 单源 / 文档矛盾清账 /
  L5 月度定时）。1600+ 单测全绿。
- **OpenAI 协议支持（v0.35.0，2026-07-09，守密人「可以想办法支持 OpenAI 协议么」派单，已落）**：
  `provider.protocol: 'openai-chat'` 经翻译传输层 `src/transport/openai.ts` 直驱任意 OpenAI 兼容
  Chat Completions 端点（api.openai.com / DeepSeek / vLLM / one-api 网关）——引擎全程仍说 Messages API
  形状、翻译只在线缆边界（请求编码 + 流事件合成，DeepSeek `reasoning_content`→thinking 块、usage 含缓存
  token 拆分）；三处传输构造点统一走工厂 `src/transport/factory.ts`，默认 'anthropic' 零行为变化。
  诚实边界（thinking 配置不上线缆 / cache_control 剥除 / 非 Claude 模型成本估算 0）见
  `projects/silver-core-sdk/docs/OPENAI-PROTOCOL.md`。**1548 单测全绿（+21）**、`tsc` + `build` exit 0。
- **当前状态（2026-07-04 实测）**：**v0.2 + v0.3 已合并 main**（本体 PR #380 @ `8bd4a54`；v0.3 收尾
  #384 观测流 / #387 Read 图像 / #388 类型面尾批 / #391 桶1 三项）。**v0.3 两待办 #16 + #17 +
  「桶1」（PDF document 块 / 重试流桥接 / 只读工具并行）均已收口。**
  **v0.4 已合并 main（PR #397）**：观测臂生命周期真发射——subagent 任务生命周期
  task_started/progress/updated/notification + hook 生命周期 hook_started/hook_response
  （`includeHookEvents` 门控）经共享观测队列在消息边界真发射；error 结果臂补官方 `errors: string[]`；
  权限规则 `*` / `mcp__*` glob；COMPAT.md 陈旧行对账（会话三函数与 canUseTool suggestions 实为 v0.2 已落地）。
  **v0.5 三线并进（守密人 2026-07-04 裁定：换装就绪包为主线 + background Bash 一族 + A/B 测量收尾）**：
  ① Bash `run_in_background` + BashOutput/KillShell + 前台 cwd/env 状态档持久（ShellManager 每 query 一个，
  子代理共享，query 结束清场）；② 换装就绪包 `docs/MIGRATION.md` + `examples/electron-host.mjs` +
  `npm pack` tarball 干净目录实测装通；③ A/B 七任务基准 `tests/integration/ab-benchmark.mjs`
  （含中文两项，offender 排序，POSITIONING §7 测量强制令）挂 `silver-core-sdk.yml` `ab_benchmark`
  dispatch 输入。`pytest` 无涉、Node 侧 **`npx vitest run` 715 单测全绿（21 文件）**；`tsc` + `build` exit 0
- **提示词线（2026-07-04 起，2026-07-05 v5 提为默认）**：系统提示词五变体 v1–v5（公开信息再现，`src/engine/prompts.ts`，`harnessPromptVariant` 开关）。
  v2=v1 补真实行为纪律；v3=v2 补公开最佳实践四技法；v4=忠实再现官方主循环核心；**v5=全面忠实再现官方主循环**（Doing tasks/Tool use/
  Executing actions with care/Communicating 四节，工具引用适配本 SDK、不引未提供工具，~3774 tok）。**v5 已提为 claude_code preset 默认**
  （守密人 2026-07-05「2 模拟行为」+「目标是跟官方提示词一致」裁定）；v1–v4 保留为显式变体（要极简可 `harnessPromptVariant:'v1'`）。
  - **⚠ A/B 测量 bug 翻案（2026-07-05，踩坑 #44）**：早前判「v2/v3/v4 无可测收益」**作废**——A/B harness 选 variant 却没设 `systemPrompt` preset，
    variant 只在 preset 路径生效被静默忽略，两臂实际都跑极简默认。修复后 v1-vs-v5 真对照：**v5 ~3× 便宜**（$0.0089 vs $0.0272）、同正确（2/2）、略快，
    真因缓存（v5 95% 命中 vs v1 0%）。**反直觉正解：更大更忠实的提示词跨过缓存门槛反而更省**。
  - **缓存根因定论（受控探针实证）**：Haiku **有效**缓存门槛远高于名义 2048；~3.5k 精简前缀落「过名义门槛却小到不被真正归档」的**死区**（写≈0/读=0），
    v5 ~3.7k / --big ~8k 舒服落**可靠缓存区**（每轮+跨 request 命中 6000-8800 tok，同官方 99% 同构）。**非代码 bug**（wire 落位正确/跨轮累加无误/大前缀同路径完美缓存）。灌水非解、真实大而共享前缀（org 分层）才是。
  - A/B 基准 `tests/integration/ab-benchmark.mjs` 加**会真失败的硬任务** id 10/11（`verify(dir)` 动态 import 跑产物代码）；受控缓存探针 `tests/integration/cache-probe.mjs`（背靠背 N 次，per-turn 写/读，`--big` 隔离尺寸死区）。
  提示词架构综述见 `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-prompt-cache-milestone-20260704.md`；对照实证见 `Public-Info-Pool/Resource/data-diagnostics/bpt-sdk-comparison-baseline-20260705.md`（§4 翻案 + §5 对齐重跑）
  - **vs-official 对齐重跑（run 28726339967，我方 v5 默认 vs 官方，提示词轴对齐）**：我方缓存从旧的 0%(短)/45%(长) **跳到 95-98%**、与官方 96-99% **打平**；成本差从旧的 ~8% **拉大到 ~3.6×**（$0.0533 vs $0.1918，我方省 72%，因官方每轮重读巨大缓存上下文 967,958 tok + 我方轮数更少 39 vs 55）；速度 **2.8× 保持**（40.6s vs 112.8s）；正确性 **11/11 vs 10/11**（官方 #11 反硬编码 33%，极可能无头 CLI 噪声、不宣「更准」）。守密人「跟官方一致」在行为层兑现：既模拟官方提示词与缓存经济学、又保住自研引擎结构性省钱提速
- **G 系列收官 + G8 决策落档（2026-07-05）**：G1 压缩前置层 / G2 Haiku 摘要 / G3 双缓存断点 / G4 子代理 Fork（对抗审查揪出 blocker、守密人「先修完整」后修好合入）/ G7 定位反转扫尾均已落（PR #435）；**G8 两条裁定入 `decisions.md`**（守密人 2026-07-05 授权代写）：定位反转 clean-room→公开信息再现、提示词装配层 Track B + v5 默认。
- **v0.6 起步 —— 生成器/分类器产品功能（守密人 2026-07-05「V0.6 加这些产品功能吧，这就是我们看到的黑盒」反转裁定，已落）**：把主循环**之外**的辅助 utility 模型调用作为真实公开 SDK 功能发货（`src/generators/`）——用户在 Claude Code 观测到的「黑盒」。五件：`detectCommandPrefix`（命令前缀/注入判定→权限白名单，**fail-closed** 空回复判 injection）/ `classifyBackgroundState`（后台运行状态→手机通知门，**fail-safe** 不伪造 blocked，接 v0.5 后台 Bash）/ `generateSessionTitle` / `generateTitleAndBranch`（分支强规整 kebab）/ `generateSessionName`。每件 = 忠实复现提示词（5 面 provenance + corpus-sync 守护）+ 一次性运行时（默认 Haiku、temp 0、注入式 transport 离线单测）+ 健壮解析（`extractJsonObject` 认字符串内花括号/转义）。红线满足（能力与提示词一并发货、有真实调用方）。**`npx vitest run` 838 单测全绿（+46）**、`tsc --noEmit` exit 0。原 G6「未发货不复现」判定被此裁定反转。
- **v0.6 剩余 Batch 1（守密人 2026-07-05「ultracode 推进 V0.6 剩余」裁定，已落）**：ultracode 8 代理工作流（6 设计 + 综合 + 红线批判 ADJUST）产执行路线图 `Public-Info-Pool/Resource/proposal/bpt-sdk-v06-remaining-execution-roadmap-20260705.md`（Tier 1 残项 + Tier 2/3 依赖排序、逐项过红线）；首批实现 ① **G-VERIFY**（`src/verifier/`）三态验证器 CONFIRMED/PLAUSIBLE/REFUTED + recall-biased 忠实复现（3 面 provenance + corpus-sync）+ `adversarialVerify` 公开 API + `parseVerdict` **fail-closed**（乱码/歧义/空→REFUTED、绝不 keep 未验证发现）+ 默认 haiku（批判揪出 sonnet 未测赌注、改齐）；② **G-SUMMARY** compaction 摘要器 no-tools 守卫 + verbatim 安全保全条（SUMMARIZER_SYSTEM 字节不变、旧金标保绿）+ `extractSummaryFromReply`（`<analysis>/<summary>` 契约、旧行为严格超集）+ `generateAwaySummary`（第 6 面生成器）。**`npx vitest run` 881 全绿（+43）**、`tsc` exit 0。G-HOOKCOND/G-SANDBOX 与编排/DSL/沙箱/技能留后续批（依赖排序见路线图档）。
- **v0.6 剩余 Batch 2 —— 补 hook 分类器子系统（守密人「这意味着我们内部没有实现对应的功能，补！」裁定，已落）**：反转原「3 hook 分类器降级 design-only」——降级唯一原因是「无消费子系统」，故建子系统、让分类器像 v0.6 生成器一样「功能与提示词一并发货」。① **上下文提示**（`src/tips/`）：情境目录注册表（复现 manual-polling/persistent-memory 两情境、可扩展）+ `selectContextTip`（复现 context-tip-selector，**fail-safe** 默认 no-tip、只返 eligible∩catalog 内 id、幻觉丢弃）+ `evaluateTipReception`（复现 reception-evaluator）；② **记忆文件选择**（生成器族第 7 面）`selectMemoryFilesToAttach`（复现 determine-which-memory-files-to-attach，接 settingSources/记忆加载，**≤5、只返可用集内文件名、幻觉丢弃、fail-safe 空表**、无文件零调用短路）。5 条新复现字节级与归档一致（reverse-diff）。**930 全绿（+55）**。云端 slug 仍 reference-only（本地引擎不造云面），本地形态归 Track 2/3。
- **v0.6 剩余 Batch 2 续 —— G-HOOKCOND + O-B0（守密人「继续」，已落）**：① `HookCallbackMatcher.condition` 条件门控（忠实复现 hook-condition 评估器 base+stop 双变体，**fail-closed**：不满足/乱码/出错跳过回调；无 condition 零调用、存量行为不变）；② worker-fork preset（忠实复现 framing + `buildWorkerForkPrompt` + `WORKER_FORK_AGENT`，挂 G4 fork 机制零 runtime 改动；coordinator 留 O-B2 先建 SendMessage 本体）。3 条新复现字节级一致。**952 全绿（+22）**。
- **v0.6 剩余 Batch 3 —— G-SANDBOX + 卫生批（守密人「G-SANDBOX 推荐 / 网络默认断网」裁定，已落）**：默认开启的 Bash 沙箱、可插拔后端（`src/sandbox/`）：`resolveSandboxBackend`（Linux+bwrap→BwrapBackend，否则 null 优雅降级；注入式后端接缝）+ `BwrapBackend`（纯 argv ro-root + writablePath rw-bind + `--unshare-net` 默认断网 + `$TMPDIR`，只做归档描述的限制、不发明读隐藏/seccomp）+ 证据检测（沙箱致败→`[sandbox]` 提示）。双 spawn 位经 `planShellSpawn` 同接缝、持久 cwd/env 沙箱内仍工作；escape 走权限门 ask（Bash 非只读天然不自动放行）、mandatory 政策拒绝。**描述/schema 门控红线**（未激活字节不变、无 param、不含 "sandbox"；激活加 17 忠实指引片段 corpus-sync 字节对齐 + param；断网默认才装网络证据片段）。**Windows/macOS 无后端如实降级、不假装隔离**。卫生批：红线常驻守卫 `tests/red-line-tool-names.test.ts` + plan 注释订正 + 任务#17（G-cmp 一致性套件 M1-M4 早封顶）对账 completed；conformance/emulator 钉 `sandbox:false` 保确定性。**1026 全绿 + 2 skipped（真 bwrap 测试）**、`tsc`+`build` exit 0。**v0.6 Tier-1 ship-now 批至此全部收官**（PR #455 已合并）。
- **引擎对齐批 E1–E5（2026-07-05，隔壁 L5 会话交接档 `bpt-sdk-engine-alignment-handoff-20260705.md` 派单，已落）**：五条引擎侧官方对齐，关键行全部对**真官方臂**双臂实测收敛——① **E1** `claude_code` preset 默认开思考（官方 54/54 留痕实证默认开；预算 4096 为**我方选定值**、官方预算不可观测、COMPAT 登记 KD；`maxThinkingTokens:0` / `thinking disabled` 显式关闭口；非 preset 路径零变化；预算经 maxThinkingTokens 注入使 live `setMaxThinkingTokens(0)` 也能关）；② **E4** Write 读前写门（官方语义 L5 活体钉死：新建放行/未读已存在拦/读后放行，错误文案**逐字**官方；`readFilePaths` 每 query 一份、子代理同引用穿线；Read/Write/Edit 成功自注册防 create-then-revise 自锁；**L3-WRITE-02 对官方臂 CONTENT_MATCH、KD-L3-06 退役**）；③ **E5** maxBudgetUsd 执行前截停（超限时请求中的工具组零执行、不发 tool_result 用户轮、终态 error_max_budget_usd，对齐官方公开流形态；自然收尾轮不作废语义保留；**L2 s12 DIVERGENT→MATCH、engineFinding 退役**）；④ **E3** 截断轮优雅降级（transport 标记 `midStreamTruncation` + accumulator `salvageTruncated` 只留整块：text 部分产出成 success 答案、完整 tool_use **照常执行 + 续轮送 tool_result**（无论 stop_reason 是否送达）、未闭合 tool_use 绝不执行；连接错误作非致命注记入 `result.errors`；**L4 三条保红行 engineFinding 全清、KD-L4-04 全退役、KD-L4-02 收窄至 errorPresent 单 facet**；官方 spike-S4「result 后迭代器抛错」怪癖刻意不复刻）；⑤ **E2** result 口径对齐（`num_turns`/`usage` 改逐 result、`total_cost_usd`/`duration_api_ms` 会话累计；**破坏性**：存量把末 result 的 num_turns/usage 当会话总量的消费方须改跨 result 求和，见 MIGRATION 5e；内部会话级 maxTurns/maxBudgetUsd 强制执行不动；联动 run-l5 `perResultArm` 按臂聚合分支合并单规则、**KD-L5-04 退役**、KD-L5-03 标注 RESOLVED-by-E1 待下轮真 L5 确认）。**1049 全绿 + 2 skipped**、`tsc`+`build` exit 0、棘轮基线三次升级（全为 improvement 方向）。E1 最终验收 = 守密人派发一轮真 L5（`conformance_l5` dispatch，$1.5 帽内）。
- **官方文档逐条接口对账（2026-07-05，守密人「逐条比对官方文档的接口说明」派发，已落）**：live 官方 TypeScript
  参考全文（3550 行，`.md` 直取）快照入 `Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md`；
  五区段并行代理逐条比对（函数/Options 61 字段/Query/消息流 32 变体/Hook 20 事件/工具输入输出 27+22 型/权限/沙箱），
  审计档 `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-docs-interface-audit-20260705.md`
  （07-03 完成度审计 146 行矩阵的字段级续篇）。**三层产出**：① drop-in 破坏级差异 15 项总榜（头部：
  ToolInput/OutputSchemas 两章零导出 / 观测臂 8 变体判别式反向其中 6 个真发射 / tool() 第 5 参 extras 包装形态不兼容 /
  deferred_tool_use 三字段名错位 / 4 个类型导出名拼写差 / RewindFilesResult·McpSetServersResult 零共同字段 /
  Task 四件套缺席且 TodoWrite 默认轨反向 / Grep `context` 静默丢参）；② **COMPAT.md 15 处陈旧行已同步修订**
  （五 Query 方法假 UNSUPPORTED、permissionMode auto 自相矛盾、hooks 表 5 行、init 四字段假 absent、
  ACCEPTED 大杂烩行 5 项已毕业等）；③ NEW-IN-DOCS 挂账（settingSources 默认语义 live 反转为唯一行为级反转、
  六新 hook 事件、SDKMessageOrigin、claudeai-proxy 等，与漂移哨兵 0.3.201 同一升钉裁定点）。
  修复 backlog P0/P1/P2 建议在审计档 §5，待守密人裁定后开工（本轮纯文档、零代码改动）。
  **三账合一完成度盘点（同日续，守密人「结合隔壁工单一起盘点」派发）**：
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-completion-inventory-20260705.md`——
  ①07-03 特征级审计 + ②本接口审计 + ③引擎工单 r3（E6/E7）去重合并成单一台账：**T0 撞车四项**
  （Agent 补参 isolation·model / Read pages / Bash 沙箱参恒入 schema / thinking 自适应默认——②③两账
  独立方法同指、互为交叉验证、建议最先修）、T1 六项 drop-in P0、T2 形状对齐批（含 **TodoWrite→Task
  路线 / 传输韧性默认 / 升钉 0.3.201 三个守密人裁定点**）、T3 引擎错误面残余（E6a/c/d + E7-03）、
  T4 缺席工具（Monitor/Workflow/ExitPlanMode/EnterWorktree）。①账 16 个未建模子系统现 13 个已建成，
  开工顺序建议见盘点档 §4。
- **Desktop UI 参考线（2026-07-04，07-05 r2 修订 + 路线草案收口）**：BPT Desktop 前端参考情报档
  （守密人转交 GPT-5.5 搜索梗概 + AnySearch 许可证逐项实锤 + UI 组件↔`SDKMessage` 流对接表）落
  `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-reference-20260704-r2.md`——
  绿区（MIT/Apache 可借码：assistant-ui / AI Elements / Goose / LibreChat 等）/ 黄区（Open WebUI 品牌条款、
  LobeChat 社区许可证）/ 红区（Cherry Studio AGPL 双许可、Chatbox GPLv3 只看不抄）三级红绿灯 +
  净室边界（Claude Desktop 逆向产物零复制）。**第二弹（同日）**：Claude Desktop 本体全结构黑箱观察规格
  `Public-Info-Pool/Resource/repo-engineering/claude-desktop-ui-structure-20260704-r2.md`（三标签 Chat/Cowork/Code
  逐节结构；Code 标签为官方文档全文取证最高置信——会话/worktree 模型、权限五档、八 pane、diff 行评、
  CI 状态条、computer use 三档 app 权限、快捷键全表；附证据分级与残余盲区；同日修订融入
  **Claude Design** 节——Labs 视觉工作区双平面布局 / 画布编辑 / Export 交接 / 桌面集成反模式教训）
  + 配套单文件线框图 `claude-desktop-ui-wireframe-20260704.html`（四线框：Chat/Cowork/Code/Design）。
  **07-05 自洽审视后 r2**：两档 git mv 升 `-r2`（对接表补 TodoWrite/AskUserQuestion/compact_boundary/
  thinking/斜杠命令五行、权限模式清单补全并标注 Desktop auto 档 SDK 不提供、底座三层辨析
  ——引擎底座 bpt-agent-sdk / UI 组件底座 assistant-ui·AI Elements / Vercel AI SDK 不需引入仅涉 adapter）；
  **第四弹落地路线草案** `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-roadmap-20260705.md`
  （M0 引擎接线与 IPC 契约 → M1 最小可信对话环 → M2 agent 透明化 → M3 工程面 → M4 演进留位，
  每 M 带行为级验收；待守密人回填 BPT 现状后升 r2 校准）
- **一致性测试套件（2026-07-05 拷问定稿开工，设计蓝图
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-conformance-suite-design-20260705-r2.md`）**：
  五层金字塔（L1 流语法 / L2 选项语义 / L3 工具差分 / L4 故障注入 / L5 端到端统计带，L6 行为指纹后置留痕）；
  硬约束「净室观测边界」已录 decisions.md（对照物白名单 / 内容盲纪律 / 泄漏衍生禁引 claw-code 系）。
  **spike 三断点全通**（官方臂无头 + localhost 仿真器 + 协议面极窄，$0，剖面档
  `bpt-sdk-official-arm-protocol-profile-20260705.md`）→ 活体差分架构成立。
  **M1 已落地**：`tests/conformance/`（内容盲仿真器正式版 + L1 差分 `run-l1.mjs` + 双包同钉 pins.json）
  + CI `conformance-l1` 无钥零费常跑 + vitest 流语法回归锁；**首份矩阵 3/3 MATCH_WITH_KNOWN_DIFFS、
  零未解释分歧**，KD-01~05 已知差异登记（KD-05 消息粒度 = 官方逐块/逐 tool_result 拆消息 vs 本 SDK 按轮合批，
  引擎对齐候选）。708 单测全绿（+6）。
  **M2 已落地（2026-07-05，ultracode 编排：8 代理 / 测绘-实现-集成-对抗审查四阶段）**：L2 选项语义差分
  15 场景（`run-l2.mjs`，12 已知差异内全等 + 2 条**有意保红引擎发现**：s6 bypass 互锁为 BPT 独有严格性
  ——官方 0.3.199/2.1.201 实测不执行互锁；s12 maxBudgetUsd 我方在途工具执行后才截停、官方执行前截停
  ——对齐候选）+ L2 单臂语义锁 16 条（`conformance-l2-locks.test.ts`）+ L3 工具行为差分 20 用例
  （`run-l3.mjs`，tool_result 内容级，0 未解释分歧，KD-L3-01~21 登记；**Write 缺读前写门**为加固候选
  ——官方拒绝覆写未读文件、我方直接覆写）。流 KD 表扩至 KD-01~11（含作用域限定机制防允许表泛化遮蔽）。
  CI `conformance` 作业 L1-L3 三连无钥常跑。对抗审查 2 major + 4 minor 全部修复（s2/s3 空转改承重设计、
  s14 会话继承污染清洗 + 存储级连续性证明、KD-10 归因模式校验、crossCompare 无 KD 豁免洞封死）。
  **770 单测全绿（28 文件）**。
  **M3+M4 已落地（2026-07-05，第二轮 ultracode：9 代理零错误）**：L4 故障注入差分 9 用例
  （429/风暴/500/400/截断×3/悬挂+abort/脚本耗尽，POST 计数硬判重试语义；KD-12 + KD-L4-01~04 登记；
  **3 条有意保红引擎发现**：截断轮官方优雅降级续跑、我方丢轮丢工具执行——加固候选）+ **记分牌棘轮升格
  CI 门禁**（`baseline.json` 51 行入库，绿灯只增不减、判劣/覆盖丢失/新 KD/新引擎发现全红，`--update`
  显式升基线带 RED-LOCK 警告）+ **漂移哨兵**（周 cron 只报不追；**首跑即抓到真漂移：官方 agent-sdk
  0.3.199→0.3.201 已发布，待守密人裁定是否追**）+ **L5 五维任务库 18 任务**（中文变体贯穿 + 跨轮记忆
  长会话；`run-l5.mjs` 真 API 双臂 + 乙门禁 ≤5pp + $1.5 预算护栏 + L6 官方臂公开流留痕 + `--smoke`
  无钥自证；CI `conformance_l5` dispatch 输入就绪）。对抗审查 1 major + 7 minor 全修（截断场景故障
  显形锁 + cutMarker 响亮失败 + 棋轮零条目拒收/RED-LOCK + L5 预算盲区/trace 容错/分片门禁确认旗）。
  **799 单测全绿（29 文件）**；一致性验证体系 M1-M4 全部封顶，**首轮真 L5 已收官（run 28736460533，repeat=3，108/108 跑完，$1.12 < $1.5 帽）：
  乙门禁 PASS——聚合通过率两臂完全打平 48/54 (88.9%) vs 48/54 (88.9%)，差值 0.0pp（容忍 -5pp）**；
  效率轴（只记分）本 SDK 几乎每任务更便宜更快（如 code-04：$0.0103 vs $0.0292、4 轮 vs 12 轮）；
  双臂缓存均 scenario a（首轮官方臂 scenario b 系单跑冷启动假象）；L6 官方臂留痕 54 份入 artifact。
  任务级线索（非门禁项，可选跟进）：本 SDK 稳定挂 chat-03/code-01、官方稳定挂 longconv-02(中文跨轮记忆)+code-03。
  **L5 失败点解剖已收官（2026-07-05，挂账 A 完成）**：四点解剖档
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-l5-failure-dissection-20260705.md`——收敛到三系统变量 + 一度量伪影：
  **S1 思考不对称**（官方 CLI 默认开 thinking，54/54 留痕含 thinking_tokens 事件计 1161 次；我方引擎默认关）= 我方 chat-03（逆字母序
  8-token 抢答答成正序）与 code-01（只排序不处理偶数长度；官方带思考也仅 2/3）的共同真因；**S2 /tmp 锚定 + 跨 repeat 污染**（官方
  Write 强制绝对路径→Haiku 猜 /tmp/<文件名>，r1 遗留物经读前写门把 r2/r3 引进死胡同）= 官方 code-03 r2/r3 + longconv-02 r3 真因，
  无污染反事实官方 code-03 ≈ 3/3；**S3 官方安全姿态过敏**（把良性中文「记住 X 只需确认」判为注入拒绝）= 官方 longconv-02 r1/r2；
  **M1 度量伪影**：官方臂流式多轮每轮各发 result、runOne 取 lastResult → 报表 turns=1，「提前终局」系误读（上下文实际跨轮保留）。
  修复方案：Fix-1 claude_code preset 默认开 thinking（budget 4096 起步，管线 computeThinking 已就绪；预算值不可知——读官方请求体越
  内容盲边界，登记 KD）/ Fix-2 L5 双臂 maxThinkingTokens 显式同参拆变量；退出标准 chat-03 ≥2/3、code-01 ≥官方−1、乙门禁保 PASS。
  顺手实锤 B②规格：官方 Write 读前写门仅拦已存在文件、新建不拦。
  **L5 测试用例层加固已落（2026-07-05，解剖挂账三项 + 附带新 KD）**：① S2 污染面封堵——任务库 11 个带档案产物任务加 `strays`
  声明（任务自有文件名白名单），runner 每 run 前后在 tmpdir 根定点清扫（pre 恢复 ENOENT 自救信号 / post 把「本 run 写歪了」升为
  行级观测字段 `strayArtifacts`，判分语义零变动）；② M1 度量修正——双臂流式多轮均逐轮发 result，按臂聚合（官方 num_turns/usage
  逐 result 求和、cost/apiMs 取累计末值；我方全字段累计取末值、apiMs 逐 run 求和）；③ KD 表 `L5_KNOWN_DIFFERENCES` 落任务库并
  透传报告 per-task 汇总（KD-L5-01 官方 /tmp 锚定 / KD-L5-02 官方注入误判方差 / KD-L5-03 思考不对称）。**附带发现 KD-L5-04**：
  两引擎 result 累计口径本身分歧（官方 num_turns/usage 逐 result vs 我方 finding #33 全字段会话累计）——drop-in 面引擎对齐候选。
  `--smoke` 3/3 绿 + 预置散落物清扫实测 + `npx vitest run` 981 全绿。
  **净室 r3 内容盲解除 + 请求体线缆差分已落（2026-07-05，守密人「放弃净室规定」裁定，范围问答定为「仅解除内容盲(②)」）**：
  decisions.md r3 修订——一致性观测中官方臂请求体现允许读取对照（内容按 #421 已属公开、读之不泄新信息），①对照物白名单/③泄漏禁引/
  §1.1-HC 防火墙三者不变永久保留。工程：`emulator.mjs` 请求体从无缓冲丢弃升级为**可选捕获**（`{captureBodies}`，默认仍丢弃、
  既有 L1-L5 逐字节不变），`assertContentBlind` 降级为产物体积卫生检查（既有报告仍无请求体故仍 PASS）；新增结构指纹
  `wire-fingerprint.mjs`（系统分段/缓存断点/工具集/thinking 配置）+ 双臂差分 `run-wire.mjs`（keyless，两臂各驱一轮、
  对比请求体结构）+ 机制自证 `tests/conformance-wire.test.ts`（6 用例，无需官方臂）。**首跑真发现（本地官方臂 0.3.199/2.1.201）**：
  官方 thinking **`{type:"adaptive"}` 无固定预算**——推翻解剖「预算不可观测、只能猜 4096」的判断（内容盲解除后直接读到），
  引擎对齐候选=claude_code 默认改自适应思考（可能顺带移动 code-01 残余，比固定 --thinking 探针更干净）；另官方工具 cache_control
  断点 0 vs 我方 1（缓存策略差）。工具集 34 vs 13 归「预期表面差」（CLI 自带 Cron*/Task*/Workflow/Skills 等产品工具、SDK 不发）。
  `tsc` + `npx vitest run` **1085 全绿**。
  **逐接口全覆盖 + 参考目标固化（2026-07-05 续，守密人「对着接口全部测试一轮、作为参考目标」裁定）**：run-wire 扩为
  **场景矩阵**（`scenarios-wire.mjs` 5 场景：default / thinking-off / thinking-4096 / cache-off / mcp-added）+ **逐工具
  input_schema 差分**（`diffToolSchemas`，比对两臂共有工具的参数/必填集——「每个接口」的真信号）。官方结构指纹固化为
  **参考目标** `tests/conformance/wire-reference.json`（`--update-reference` 刷新，纯结构无提示词正文）；our-arm 回归锁
  升级为**参考目标棘轮**（`conformance-wire.test.ts` 12 用例：实际缺口须精确等于登记缺口，新漂移即红 / 缺口修复须删条目）。
  **全覆盖新发现——我方工具 schema 落后官方当前参数**（引擎对齐候选，交引擎团队）：Agent 缺 `isolation`/`model` 且必填集不同、
  Bash 缺 `dangerouslyDisableSandbox`、Read 缺 `pages`（PDF 页范围）——五场景一致稳定。连同 thinking 自适应 + 工具缓存断点，
  构成引擎侧「对齐官方线缆」清单。cache-off 系统分段差属 bpt-only 选项非对称（官方忽略 promptCaching:false）已标注不追。
  `tsc` + `npx vitest run` **1091 全绿（+6）**。
  **已补为正式工单 E7 系列（2026-07-05，守密人「补工单」裁定）**：交接档升 r3 `bpt-sdk-engine-alignment-handoff-20260705-r3.md`——
  E7-01 thinking 默认改自适应（承接 E1、修正「4096 不可观测」为实读官方 adaptive、可能顺带解 code-01 残余）/ E7-02 工具 schema 补参
  （Read `pages` / Bash `dangerouslyDisableSandbox` / Agent `isolation`+`model`+必填集，drop-in 硬伤、建议优先）/ E7-03 工具缓存断点策略
  （需实测收益、优先级最低）。每条附代码锚点 + 参考目标棘轮联动（修好须删 `WIRE_ALIGNMENT_GAPS` 条目否则报红）。优先级行更新为
  E1 > E7-02 ≈ E4 ≈ E5 > E7-01 > E3 > E2 > E7-03 > E6a/c/d。
  **测试侧「全面实现」五缺口清零（2026-07-05，守密人「全面实现以上所有」裁定，四批合并）**：
  **A1 系统分段**——指纹加 `systemSegments`（逐块 cache_control 位置），抓到断点位置差（我方 block0 稳定前缀 vs 官方 last，归 E7-03）；
  **A2 多轮轨迹**——新 `tool-loop` 场景抓整条逐 POST 轨迹，检缓存前缀跨轮字节稳定（我方稳定、不变式成立，keyless 锁）；
  **B1 MCP 差分二批**——L3-MCP-05 多工具路由双臂 CONTENT_MATCH + L3-SA-MCP-ZOD 单臂 zod 校验锁（跨包 zod 不兼容故不做差分，诚实单臂）；
  stdio/http 传输 + readOnly annotation 自动放行记 tranche 3（需子进程 harness）；
  **B2 白盒 batch 2**——7 接口真驱动补齐（includeEnvironmentContext/toolSearch/streamInput/sessionStoreFlush/setMcpServers/toggleMcpServer/reconnectMcpServer），
  从覆盖守卫白名单删除，仅剩 onElicitation（需服务器发起 elicitation 的更重 fixture）；
  **B3 L3.5 子代理/hook 差分**——我方生命周期本已 e2e 覆盖（observability-v04），真缺口是双臂差分；因两臂 POST 数不等（我方 3、官方 4+）
  做成**报告制** `run-l35.mjs`（比生命周期事件词汇集非计数，规避脆弱）+ 我方 keyless 锁；**两真发现**：KD-L35-01 前台词汇差
  （我方发 task_progress、官方发 task_notification）、KD-L35-02 编码差（task_started/updated：我方顶层 type、官方 system 子类型，类同 KD-05 粒度，drop-in 引擎对齐候选）。
  棘轮 +2 L3 行；`tsc` + `npx vitest run` **1107 全绿（41 文件）**。测试侧挂账仅余：onElicitation、L3.5 双臂升门禁（版本稳定后）、MCP tranche 3 传输层。
  **KD-L35-02 已并入引擎工单 E8（2026-07-05，守密人「并入」裁定）**：交接档升 r4——子代理生命周期事件编码对齐
  （顶层 type → system 子类型，E2 同族破坏性、MIGRATION 5f；`conformance-l35.test.ts` 旧编码锁为设计好的销账提醒，
  引擎改完必须同步翻转）；KD-L35-01 词汇差列 E8b 裁定项（task_progress 保留超集、前台 notification 随 Desktop 真实需求定）。
  优先级 E8 排 E7-01 后、E3 前。
  **测试侧挂账再清二（2026-07-05，守密人「测试剩余挂账能继续完成嘛」→ 能，即做）**：① **onElicitation 补齐**——新 fixture
  `tests/fixtures/mcp-elicit-server.mjs`（真 stdio 服务器工具调用中途发起 elicitation/create），全 query() 链路测 accept 回填与
  无 handler 自动 decline；**顺手修一处引擎真缺陷**：stdio/http 调用点 `&& this.elicitation` 守卫使文档承诺的自动 decline 成死代码、
  实际回 -32601——去守卫让 resolveElicitation 兜底（mcp.test.ts 37 测保绿）。覆盖守卫白名单**清零**（新接口无测试即红、无豁免口）。
  ② **MCP tranche 3 stdio 传输差分**——L3-MCP-06 真子进程 stdio 服务器过双臂传输管线，**CONTENT_MATCH**；棘轮 +1 行。
  ③ L3.5 双臂升硬门禁为**等待条件**（官方生命周期跨版本稳定后触发），非工作量，挂漂移哨兵联动。
  `tsc` + `npx vitest run` **1109 全绿（42 文件）**。
  **官方 0.3.201 追版已收官（2026-07-05，守密人裁定「追」）**：pins agent-sdk 0.3.199→0.3.201（claude-code 2.1.201 已是最新不动），
  全差分栈对新版重跑——**L1-L4 记分牌与基线逐行一致（零新漂移、零新 KD）**、wire 缺口逐面一致（参考目标已按新钉刷新）、
  L3.5 两 KD 在 0.3.201 复现（**硬门禁等待条件的第一枚稳定性数据点：两版一致**）。COMPAT/CONTEXT 基线表述同步 0.3.201；
  KD-01 等历史注补「0.3.201 复验不变」。`npx vitest run` 1109 全绿。漂移哨兵挂账清零。
  **Windows shell 解析已修（2026-07-05，BPT Windows 试点故障 #2 闭环）**：BPT 实测 Bash 工具全不可用
  （`spawn sh ENOENT`——旧链按名裸猜 bash→sh，Windows 上两者皆无）。修 `src/tools/shell-resolve.ts`：
  `CLAUDE_CODE_GIT_BASH_PATH`（官方同款旋钮）优先 → Git for Windows 标准安装位探测（Program Files ×3 + 每用户
  LocalAppData）→ 全миss 时报可行动指引（装 Git Bash / 设旋钮）而非裸 ENOENT；**刻意不试裸名 bash**（System32 bash.exe
  是 WSL、文件系统视图静默漂移，宁可响亮失败）。前台/后台链同修；非 Windows 行为不变（bash→sh 原链）。
  6 条注入式单测（platform/probe 可注入，Linux 上全覆盖 win32 路径）；MIGRATION 5b-2 + COMPAT Bash 行同步。
  `npx vitest run` **1115 全绿（43 文件）**。BPT 侧装新 build 后 Bash 应可用（前提装了 Git for Windows）。
  **KillShell Windows 失效 + 谎报状态已修（2026-07-05，BPT 试点故障 #3，源码行级证据）**：两处真缺陷——① `kill()` 一调用即
  强置 `status='killed'`、不等信号，exit 处理器因状态已非 running 不再纠正 → 进程跑完退出 0 仍永久标 killed；② 杀进程用
  POSIX 专属 `process.kill(-pid)`（进程组），Windows 无效且被空 catch 静默吞。修：新 `src/tools/kill-plan.ts` 两纯函数——
  `planProcessKill`（POSIX 进程组 / **Windows `taskkill /PID <pid> /T /F`** 杀树强制 / 无 pid 回退 child.kill）+ `terminalStatus`
  （退出处理器据实定状态：kill 请求且非 0 退出→killed、退出 0→completed 即便请求过 kill、崩溃→failed）；`kill()` 只记
  `killRequested` 意图不再强改状态；空 catch 改 debug 记录（Windows 失败不再隐身）。10 条注入式单测（Linux 上覆盖 win32 分支
  + 6 条状态诚实矩阵 + 迟到 kill 不改写 completed 的集成回归）。版本 bump **0.6.3** + CHANGELOG。`npx vitest run` **1125 全绿**。
  **BPT #2 权限口子已裁定并落地（2026-07-05，守密人裁定「Read/Write/Edit 过度保守、放宽」）**：移除 Read/Write/Edit 的
  BPT 自有硬围栏（`fsutil.resolveWithin`→`resolveAbs` 只解析不设栏），向官方权限门模型看齐——路径访问由 permissionMode 门控、
  非第二道文件系统栅栏（该围栏 Grep/Glob/Bash 本就没有、Bash 在场时更非硬边界，是安全错觉）。`additionalDirectories` 保留真实
  作用（sandbox writablePaths）。**顺带消除一个 KD**：L3-READ-03 现双臂都读到仓外文件 → CONTENT_MATCH、**KD-L3-04 退役**（残余
  只剩既有 Read 尾换行 KD-L3-18）；两条单臂围栏锁 L3-SA-READ-CONTAIN/ADDDIR 退役；5 条 fs 单测改为「无栏、官方对齐」正向断言。
  版本 bump **0.6.4** + CHANGELOG + COMPAT additionalDirectories 行更新。棘轮基线 --update 锁入。`npx vitest run` **1125 全绿**。
  **Windows 环境保真守卫已立 + 揪出第四潜伏 bug（2026-07-05，守密人「提示词按环境编排?」诊断问答）**：诊断结论——三起 Windows 故障
  根因是**引擎代码 POSIX-first**（工具接口之下：负 PID 进程组 / 裸 spawn shell 名 / 硬编码 tmp），**非提示词编排**（`<env>` 本就注入
  `Platform:`、工具指导本就引向平台中立内建工具）；提示词能改的余地为零，模型工具调用本身是对的。预防落为**静态守卫**
  `tests/posix-hazard-guard.test.ts`：扫 src/ 的 POSIX-only 危险写法（`process.kill(-`/`spawn('bash'|'sh')`/`'/tmp'`），未标 `win-ok:`
  即红。**守卫未建先还债**：揪出 `bash.ts` 前台 Bash 超时/abort 的 killGroup 是与 KillShell 同款未分支 `process.kill(-pid)`+空 catch
  （Windows 前台命令杀不掉、错误被吞）——已复用 planProcessKill 修（win32→taskkill）。合法平台分支两处标 win-ok。版本 bump **0.6.5**
  + CHANGELOG。`npx vitest run` **1128 全绿（45 文件）**。机器守卫累计四件：接口覆盖 / 参考目标棘轮 / 版本 bump / POSIX 危险。
  **版本纪律已立（2026-07-05，黑池「三拨构建同名 0.6.0」诉求）**：版本 bump 至 **0.6.2**（0.6.1/0.6.2 为对已发货
  三拨构建的追溯标号，台账见新增 `CHANGELOG.md`——随 npm pack tarball 发货，黑池箱内可读）；纪律 = 改发货运行时必 bump
  （修复 patch / 新能力 minor）+ CHANGELOG 一行；**CI 守卫** `scripts/check-version-bump.mjs`（silver-core-sdk.yml test job，
  fetch-depth 2 diff HEAD~1）：改 src/依赖不 bump 版本即红——同名不同货从此进不了 main。tarball 名随版本唯一
  （`bpt-agent-sdk-0.6.2.tgz`），黑池可精确 pin/回退/对账。
  **SSE 网关方言容错已落（2026-07-05，BPT 产线故障闭环）**：BPT 实测「Malformed SSE payload for event "(none)"」
  经双侧协作定型——BPT `curl -N` 抓原始字节实锤 idealab 网关 `/api/anthropic` 端点带 OpenAI 方言遗留
  （流尾追加 `data: [DONE]`、错误帧无 event 行）；官方客户端 message_stop 即收工不碰尾卡、我方读到流关闭才撞上。
  修复（`src/transport/anthropic.ts`）：① message_stop 即收工（官方同款生命周期，尾部废卡不进解析器）
  ② stop 前无 event 名非 JSON 帧跳过（debug 留片段）③ 有 event 名坏帧照抛且带现场（前 120 字符 + 已解析帧数
  ——交接单 **E6b 就地落地**，交接档 r2 已注记引擎侧勿重做）。5 条回归测试；`npx vitest run` **1030 全绿（35 文件）**、
  `tsc` + build exit 0。BPT 侧只需装新 build 验证。
  **测试用例完备性全面推进已落（2026-07-05，守密人「全面推进」裁定，四缺口一批清）**：
  ① **环境保真轴建轴**——仿真器加 `sse-gateway` 脚本类（`[DONE]` 尾卡 / 无 event 名帧，复刻 idealab 原始字节形状），
  L4 新增 3 场景双臂差分：`[DONE]` 尾卡（文本轮 + 工具链轮）**双臂全绿**（#461 修复差分成立）；无名错误帧抓到**真发现
  KD-L4-05**（两轮稳定）：官方 2.1.201 不认无名错误帧、当「空/畸形响应」**重试一次**并把失败编码成 assistant 文本 +
  result/success——对 BPT 产线的实义：官方客户端在 idealab 后面会重试并 success 化 API 错误、我方快速失败带真错误类型；
  ② **MCP 差分首批（L3 扩容）**——arm.mjs `buildOptions` 加每臂 SDK 句柄（各臂用自家 `tool()`/`createSdkMcpServer`
  建进程内服务器），4 场景：ping/软失败 isError **双臂 CONTENT_MATCH**（结果编码逐字一致），抛异常/未注册工具措辞差
  两轮稳定入 KD-L3-22/23（zod schema 语义留第二批）；③ **Fix-2 落地**——run-l5 `--thinking=N` 双臂同预算钉死
  （拆引擎差 vs 思考差），workflow 加 `l5_thinking` dispatch 输入；④ **聚合自证**——runner 度量规则抽成
  `l5-aggregate.mjs`，vitest 喂 run 28736460533 真实官方 result 序列锁定（多 result 求和/取末值、空跑、缺字段防 NaN）。
  棘轮基线 +7 行全改进项锁入；L1-L4 双臂全跑收敛（L4 12/12、L3 零发散、零未分诊候选）；`npx vitest run` **1060 全绿**。
  剩余挂账：MCP 差分第二批（schema 语义/annotations/stdio-http 传输）、子代理/hook 差分（L3.5，大活）。
  **白盒接口覆盖计划已立（2026-07-05，守密人「针对每个接口白盒测试」裁定）**：现状厘清——黑盒差分（L1-L5）是官方臂
  内容盲边界下的必然形态，我方自身侧本就有千余条白盒单测，但**测试随功能长、没人逐接口对过账**。对账结果：公开面
  66 导出 + 48 Options 字段 + 17 Query 方法中，**15 个接口点全测试树零覆盖**。处置：① 7 个导出缺口当批补齐
  （`tests/api-surface-gaps.test.ts`：NotImplementedError / COMMAND_INJECTION_TOKEN 哨兵契约 / DEFAULT_UTILITY_MODEL /
  resolveUtilityTransport 注入席位 / runVerification fail-closed / renderCatalog / buildSelectorUserTurn）；
  ② **永久性覆盖守卫**（`tests/api-surface-coverage.test.ts`）：枚举导出+Options+Query 三面对账全测试树，
  新接口不带测试即红、白名单只减不增（陈旧条目自动红）——覆盖率地板制度化；③ 剩余 8 点挂守卫白名单可见化
  （4 Options 字段 includeEnvironmentContext/onElicitation/sessionStoreFlush/toolSearch + 4 Query 方法
  reconnectMcpServer/toggleMcpServer/setMcpServers/streamInput，各标欠账原因）= **白盒补齐 batch 2**。
  `npx vitest run` **1079 全绿（37 文件，+19）**。
  **E1 后验收轮真 L5 已收官（2026-07-05，run 28741914245，repeat=3，108/108，$1.156 < $1.5 帽，双引擎各自默认）**：
  **乙门禁 PASS 且首次正向拉开——我方 50/54（92.6%）vs 官方 43/54（79.6%），差值 +13.0pp**（首轮为 88.9% 打平）。
  退出标准三过一未过：**chat-03 0/3→3/3 兑现**（E1 思考直接修复，KD-L5-03 的答前计算半边正式 RESOLVED）；econ 轴我方
  总开销 $0.355 vs 官方 $0.801（省 2.25×）✓；门禁 PASS ✓；**code-01 仍 0/3 未过**（三跑仍只排序不处理偶数长度；官方 2/3
  且花 ~3× token——残余是 diligence 概率而非思考开关位，KD-L5-03 注记已改「chat 半边 RESOLVED / code-01 残余保留」，
  候选隔离手段 Fix-2 同预算轮；**反 Goodhart：不为过题往 v5 塞私货条款**）。官方本轮大跌的主因是 **KD-L5-01 /tmp 锚定
  在散落物清扫恢复逐跑独立后原形毕露**：54 跑中 11 次 stray 实录（longconv-01 三跑全歪 0/3、code-03 1/3、code-05 1/3、
  longconv-02 1/3、code-02 2/3）——首轮官方 88.9% 部分靠污染假象撑起；KD-L5-02 注入拒绝本轮零发作（方差实锤）。
  **新观测**：思考开启后我方 chat-01 r3 出现 202 output tokens 但可见文本为空的「纯思考回复」边缘（1/54），
  已记 KD-L5-03 注记尾，引擎跟进候选。
  （首轮 run 28735894053 因预算护栏冷启动外推误停 2/180，护栏已修 #447）。**一致性验证体系 M1-M4 全部封顶**
- **完成度（表面等价）**：对官方 SDK **0.3.199 基线**约 **89.5%**（v0.1 基线 68.3% → v0.2+v0.3 补齐后重算）。
  审计矩阵与逐行台账落 `Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-completion-audit-20260703.md`
  + 同名 `-matrix-20260703.json`（146 行）
- **两轴保真模型（关键认知，勿混淆两轴）**：
  - **表面完整度（SURFACE）**：可收敛，约 90%+——接口、类型、消息变体、工具/MCP/hooks 面照抄公开契约即可补齐
  - **行为保真度（BEHAVIORAL）**：**可逼近、残余主要由模型选择决定**（2026-07-04 定位反转）——放弃 clean-room 后，
    官方提示词结构可经公开还原研读、按自有工具适配，此前「因拒看专有而永补不平」的结构性封顶**解除**；残余行为差的主导项
    是 BPT 主权模型选择（换模型换手感），非提示词。追平官方逐版行为仍非北极星（体验主权在 BPT 自己）
- **v0.3 头号交付**：**per-run 预算/效率仪表**（`result.metrics` = `SDKRunMetrics`：perTurn / perTool /
  cacheHitRatio / 模型用量 / 成本 / API 耗时）。回应守密人「整体效率低下会累积成巨大差别」之忧——
  把「效率」从不可见变成每轮可量。A/B 演示 harness：`examples/ab-metrics.mjs`（缓存开/关对照表）
- **默认配置决策**：**提示词缓存默认开**（`provider.promptCaching !== false`，v0.3 翻转，多轮对话省 input 账单）
- **公开信息再现纪律（2026-07-04 守密人裁定，覆盖原「干净室硬约束」）**：定位从 clean-room 反转为**公开信息再现、明确署名**。
  四条腿构建：公开文档 + 提示词还原（Piebald 等，公开 GitHub/MIT/逆向自公开分发 CLI）+ 自研引擎 + 参考其他开源 CC 还原项目。
  **不变**：§1.1-HC 黑池防火墙、拒绝真正的内部未授权泄漏、不逐字大段克隆（工程卫生 + 版权 + 他们提示词是给他们工具调的、照抄反劣化）。
  裁定见 `memory/decisions.md`；架构推断成果见 `Public-Info-Pool/Resource/repo-engineering/official-cc-prompt-architecture-inference-20260704.md`
- **定位/战略**：`docs/POSITIONING.md`（兼容表面 / 独立引擎 / 钉死基线 0.3.199 / 选择性追踪 +
  四档效率齿轮；含可粘贴进 `decisions.md` 的决策条）
- **文档索引**：`CONTEXT.md`（上下文）/ `docs/POSITIONING.md`（战略）/ `docs/COMPAT.md`（兼容面 + 毕业清单）/
  `docs/ARCHITECTURE.md`（架构）/ `README.md`（总览）
- **CI**：`.github/workflows/silver-core-sdk.yml`（Node 单测无钥常跑 + live-smoke 手动 dispatch 用 `secrets.ANTHROPIC_API_KEY`）
- **v0.3 收尾已完成**：
  - **task #16 观测消息流扩容**（#384）：`SDKMessage` union 补齐观测臂 25 变体（`SDKObservabilityMessage`），
    `permission_denied` 真发射（gate deny 时 yield，与 `result.permission_denials` 台账一致），余类型化待驱动源（COMPAT.md 记发射 vs 类型化）
  - **task #17 P1/P2 长尾**：Read 图像（#387，PNG/JPEG/GIF/WebP magic-byte 嗅探→image 块）+ tool() ToolAnnotations 转发 /
    mcpServerStatus 富化（config·tools[]） / listSessions option（dir 别名·limit） / Usage 字段（server_tool_use·service_tier）（#388）
- **桶1 已收口（守密人「都先全面实现」，#391）**：① Read PDF→base64 `document` 块（claude-code-guide
  核实官方文档：document 块可入 tool_result）；② `rate_limit_event`/`api_retry` 真发射（transport `onRetry`
  桥接进流）；③ 连续≥2 只读内建工具**并行执行**（Promise.all，结果保序，stop/defer 覆盖同组后续为
  「Not executed」，interrupt 语义保绿）。**668 单测全绿。**
- **遗留两项已清（守密人「清遗留」，#394）**：① **MCP `readOnlyHint` 注解链**——`listTools` 经
  sdk/stdio/http 把注解捕获到 `McpToolEntry.annotations`，loop `isReadOnlyTool` 统一 builtin.readOnly +
  MCP readOnlyHint，喂进 gate（default/plan/acceptEdits 只读自动放行）+ 并行分组；真 gate 端到端测试证明
  只读 MCP 工具自动放行、非只读被拒。② **PDF base64 源 live-API 确认**——`tests/integration/live-real-api.mjs`
  加阶段2（生成合法最小 PDF→模型 Read→成功即 API 接受 document 块），随 live-smoke workflow 手动
  dispatch 用 `secrets.ANTHROPIC_API_KEY` 跑。（同期并发合并 #385 surface-alignment：MCP resources /
  Grep offset·-o / bypass 联锁 / ModelInfo.value。）
- **沙箱**：**再现且默认开启**（守密人 2026-07-04「全做、一样默认开启」裁定，**更新** 2026-07-03「N/A-by-design」旧裁定）。
  即 `bash-sandbox-*` 能力本体照官方再现、BPT 默认启用，与全做其余项一致
- **v0.7.0 全面实现 + Windows 换装批已合并 main（2026-07-05）**：`#480`（`9260261e`，v0.6.2→**v0.7.0**）
  「completion-inventory 全面实现」——内建工具面 15→20/24（Task 四件 / ExitPlanMode / EnterWorktree / Monitor /
  Workflow）、观测编码迁官方 system+subtype（E8）、线缆对齐（thinking adaptive=E7-01 / Read pages·Bash sandbox flag·
  Agent isolation+model=E7-02 主体）、result/type 形对齐、McpError 分类 + 稳定错误码 + 抛错纪律守卫（E6a/c/d）、
  韧性默认（maxRetries 10 + watchdog=E3 域）；自验 vitest 1315 / pytest 2620 / tsc 净 / 棘轮全绿。另 Windows 换装线
  `#479`（shell 解析）/ `#481`（版本纪律 + CI bump 守卫）/ `#482`（KillShell Windows 终止 + 诚实终态）/
  `#483`（Read/Write/Edit 撤围栏对齐官方权限门）/ `#484`（前台 Bash kill 孪生修复 + posix-hazard 静态守卫）均已合并。
- **引擎工单账目结算 r5（2026-07-05）**：隔壁引擎的状态基于交接档 **r4**（成文于 #480 之前）把 E1–E8 列为待领工单，
  与 main 实况错位。逐工单核对（§4.2 R3 验代码非验 commit message）结论：**E1–E8 在 main 已全部落地**
  （E1 于 #480 前验收轮 run 28741914245；其余随 #480/v0.7.0），两项非缺陷保留（E7-03 缓存策略差 KD、settingSources
  默认反转需升钉裁定），E7-02 留一条 `Agent:params` 必填集残余。**隔壁无待领引擎工单**；结算档
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-engine-alignment-handoff-20260705-r5.md`（退役 r4 待办视图）。
  **代码侧无挂账**；剩余三项纯花预算 / 需裁定的验收（真 L5 验 code-01 残余 / run-l35 双臂封印 KD-L35-02 / 升钉+参考目标刷新+settingSources 反转），
  待守密人「dispatch 真 L5」或「升钉」信号，否则本线判定收官。
- **升钉裁定落地 —— settingSources 默认反转（守密人「确定升钉了」，2026-07-05，v0.7.1→v0.8.0）**：唯一行为级
  NEW-IN-DOCS 反转已做。**省略 `settingSources` 现默认加载 user+project+local**（CLAUDE.md / AGENTS.md + 项目
  `.mcp.json`），对齐官方 Claude Code / live docs；**显式 `[]` = 显式退出（不加载）**、显式子集照旧。单一真相源
  `src/internal/setting-sources.ts` `resolveSettingSources`（注入式纯函数，仿 shell-resolve/kill-plan）；两消费点
  （`runtime-context.ts loadProjectInstructions` / `project-config.ts loadProjectMcpServers`）统一经其解析。破坏性——
  靠「省略=不加载」旧默认的调用方须显式传 `[]`（MIGRATION 5m）。L2 锁 `conformance-l2-locks` 翻转追 live 语义
  （AHEAD of 钉版臂，属升钉预期）；wire 指纹不受影响（测试目录无 CLAUDE.md）、pin 已 0.3.201 故参考目标无需刷新。
  自验 tsc 净 / vitest **1321 全绿**。CHANGELOG 0.8.0 + COMPAT settingSources 行转 IMPLEMENTED。
- **真 L5 已 dispatch（守密人「dispatch 真 L5」，2026-07-05，run 28753349435）——暴露 v0.7 确凿回归**：本轮跑在 haiku-4.5，
  **我方臂 40/40 全 `error_during_execution`、turns=0、cost=$0**（gate B INCONCLUSIVE-PARTIAL，官方臂同 key 40/40 ok）。
  根因：**E7-01 让 preset 默认无条件发 `thinking:{type:"adaptive"}`，但 adaptive 仅 4.6+ 代合法；haiku-4.5 等 pre-4.6 模型 400 拒**
  （两向都 400：budget_tokens 在 4.7+ 也 400）。keyless 单测 stub 传输故照不到。**未查成 code-01——我方臂在 haiku 一题没真跑起来。**
- **thinking 模型感知 fork 修复（v0.8.0→v0.8.1，2026-07-05）**：`computeThinking`（逐轮读 live model）按能力分叉线form——
  4.6+ 发 adaptive、pre-4.6 发 `{type:"enabled",budget_tokens}`，覆盖 preset 默认 / 显式配置 / mid-run setModel 全路径。
  单一真相源 `src/engine/thinking-model.ts supportsAdaptiveThinking`（pre-adaptive 家族 denylist、新模型默认 adaptive、denylist 有单测锁）。
  wire 棘轮 thinking facet 升为全场景 KD（我方按模型对、官方结构参考恒 adaptive——我方更正确，非回归）。自验 tsc 净 / vitest **1326 全绿**
  （新增 thinking-model 单测 + conformance-l2 逐 tier 线form 锁 + haiku preset 降级锁）。
- **修复实证 + 全量真 L5 收官（2026-07-05）**：修复轮（run 28754264349，haiku）我方臂 40/40 恢复运行（vs 坏轮 0/40），gate B bpt 40/40==官方 39/39 delta 0.0pp——**回归修复实证**。
  随后为触达 code-01 给 L5 workflow 加 `l5_budget` 输入（透传 `--budget-usd`，默认 1.5；PR #490）、打一轮 **$5 全量轮**（run 28759190419，180/180 跑满、花 $2.21、不再中途截断）：
  **Gate B bpt 88/90 (97.8%) vs 官方 76/90 (84.4%)，delta +13.3pp → PASS**（全量轮首次正向大胜）。
  **code-01：bpt 3/5 vs 官方 5/5——守密人最初问题有答案：残余从历史 0/3 移动到 3/5**（思考开+更大预算把 code-01 从全败推到多数通过，未全解）。
  官方本轮被 KD-L5-01（/tmp 散落物，官方 CLI 自身怪癖）拉低：longconv-01 官方 1/5、code-03 官方 0/5；bpt 对应 5/5、5/5。
  econ：bpt 多数题更省（code-01 $0.0108 vs 官方 $0.0266、retrieval-01 $0.0058 vs $0.0291）。**BPT SDK 换装线本阶段收官**：v0.8.1 在 main、真 L5 全量 gate B 正向、code-01 残余部分移动已判定。
- **v0.10.0 回归验收(2026-07-06)**：0.9.0(SessionManager 共享协调 + 监督式 resume + 文件 session store)、0.10.0(Read 总输出上限 50000、行边界截断)两批新功能后,先 keyless 全绿(tsc 净 / vitest **1405 passed / 2 skipped / 61 files**),再全量真 L5(run 28770219412,main=0.10.0,haiku,$5 帽,180/180 跑满 $2.13):
  **Gate B bpt 86/90 (95.6%) vs 官方 74/90 (82.2%),delta +13.3pp → PASS——与 0.8.1 轮同 delta,gate B 零回归**。chat/retrieval/document 全 11 题 + code-03/04/05 + longconv-01/02 我方全 5/5(与 0.8.1 一致);官方仍被 KD-L5-01(/tmp 散落物)拉低。
  **唯一变动：code-01 我方 1/5(0.8.1 为 3/5)**——code-01 是已知的 diligence 概率残余(非思考开关位),两轮独立采样 3/5 与 1/5 皆 >0(off 历史 0/3);0.10.0 的 Read 上限(50000 字符)不触及 code-01 的小输入,故极不可能是 Read 截断致因,判为**残余噪声**而非回归(单轮无法区分噪声与微小真移)。结论:**0.9.0/0.10.0 未回归 gate B**;code-01 残余仍在 0↔多数通过间浮动。
- **v0.14.0 回归轮 —— API 余额耗尽,本轮无效不可采信(2026-07-07,run 28880617614,head=`db94cbc9`=#505 合并即 #504 五项优化+#505 跨模型 thinking signature 剥离,haiku,$5 帽)**:
  **判定 INVALID/inconclusive——非 bpt 回归,是基础设施故障(账户余额跑空)**。180 run 只有前 ~14 题(chat×3/retrieval×4/document×4 + code-01/02/03)在有效额度内真跑,**尾部 4 题(code-04/code-05/longconv-01/longconv-02)双臂全 0/5、turns=0、cost=$0.0000**,官方臂逐行明写 `Credit balance is too low`(bpt 臂同账户→同耗尽,surfaced 为 error_during_execution)。
  Gate B **名义** bpt 63/90(70.0%)vs 官方 64/90(71.1%),delta -1.1pp,名义 PASS——**但此数字建立在被腰斩的降级轮上,绝不可与 0.8.1/0.10.0 的干净 +13.3pp 轮相提并论,不作回归结论依据**(§4.2:两臂尾部被同等清零 40 run,绝对通过率被拉低)。
  **能采信的部分**:真跑的 14 题**无回归信号**——chat/retrieval/document 全 11 题 bpt 5/5==官方 5/5(与前两轮一致);code-02 bpt 5/5、code-03 bpt 3/5(官方 0/5)。**code-01 本轮 bpt 0/5**(官方 5/5)——仍是那条已知 diligence 概率残余(历轮 3/5→1/5→0/5,off 历史 0/3,0/5 在其已知区间内),非 v0.14 引入的新退化。
  **结论:本轮不能确认 #504/#505 未回归 gate B**(尾部 4 题从未在有额度账户上跑,而前两轮它们 bpt 全 5/5)。**需在有额度账户上重跑一轮全量 L5 才能真验收**。版本号差异(#505 声明 v0.14 但 package.json 曾滞留 0.13.0)已由 #506 修复,与本轮无涉。
- **v0.18.2 重跑真验收 —— 未回归 gate B,守密人最初问题有真答案(2026-07-07,run 28888199011,head=`b2f7f862`=v0.18.2,haiku,$5 帽,账户已充值)**:承 v0.14.0 无效轮的「需在有额度账户上重跑」挂账,守密人「真 API 全量 L5 revalidation」派单重跑。**这次账户有额度**(同 run `live-smoke` 真 API 冒烟 success,非上轮耗尽),**180/180 跑满、花 $2.1920 < $5 帽**,两臂缓存均 scenario a(设计点)。**Gate B bpt 88/90 (97.8%) vs 官方 77/90 (85.6%),delta +12.2pp → PASS**——与 0.8.1/0.10.0 干净轮(+13.3pp、bpt 88/86)同量级,**gate B 零回归实锤**。本轮覆盖自上次干净轮 v0.10.0 以来全部代码变更(#504 v0.13 五优化 / #505+#507 v0.14 thinking-signature / #509 v0.15 stop-reason / #512 v0.16 计价流式 / #515 v0.18 C9 结构化输出 / #516 v0.18.1 Windows bash / #519 v0.18.2 SubagentStop),**均未回归**。bpt 除 code-01 外**全题 5/5**;**code-01 bpt 3/5**(官方 4/5)——回到 0.8.1 轮的 3/5(已知 diligence 概率残余,历轮 3/5→1/5→0/5→**3/5**,在已知区间高端,非新退化)。官方本轮仍被 KD-L5-01(/tmp 散落物)拉低:code-03 官方 0/5、longconv-01/02 官方各 2/5(bpt 对应 5/5/5/5)。同 run `conformance` 作业(L1-L4 差分 + 棘轮 GATE)亦 success,印证新登记的 KD-L4-06/07/08 + baseline 在 CI 真实双臂下门禁全绿。**BPT SDK 换装线 L5 revalidation 收官:最新 v0.18.2 在 main、真 L5 全量 gate B 正向零回归。**报告 artifact `conformance-l5-report`(run 28888199011)。
- **代码里程碑回填 v0.11–v0.16（2026-07-07，交接缺口补全）**：上方回归验收线聚焦 L5 门禁轮，代码能力叙述在 v0.10.0（Read 上限）后断档；此处补全 v0.11–v0.16 各版**发货了什么**，**权威账本以 `projects/silver-core-sdk/CHANGELOG.md` 为准**（0.6.2 起「改 src 必升版 + CI `check-version-bump.mjs` 守卫」纪律，本节只做指针式速览、不复刻逐条）：
  - **v0.11.0（黑池 ContextRing 请求 2026-07-06）**：新导出 `enumerateBuiltinToolMetadata(cfg?)`——内建工具面只读投影 `{name,description,inputJsonSchema}[]`，零副作用（不 execute / 不连 MCP / 不碰 fs·网络），让宿主用与 MCP 工具同一条 token 估算路径给内建工具块定尺（把 ~60K「残值」估算拆成逐工具明细）；纯新增读面、零行为改动。
  - **v0.12.0（#501）**：P2 PARTIAL-closure——逐行重审 COMPAT.md 每条 PARTIAL、陈旧行对齐回 FULL（代码多已随 v0.7 达标）+ 落 8 个可实现 REAL-GAP：Edit 补读前写门（**破坏性**，同 Write / 官方 Edit）/ `stream_event` 带官方 `ttft_ms` / `PostToolBatch` 带官方 `tool_calls[]`（旧 `tool_names` 双轨弃用）/ `SubagentStop` 补 `agent_transcript_path` / `thinking.display` 上线 / `debugFile` 真落盘 / `mcpServerStatus().scope` 溯源 / `maxThinkingTokens` 挂 `@deprecated`。+13 单测（1427 绿）。
  - **v0.13.0（#504）**：五项守密人指派优化——Grep `count`/`files_with_matches` 默认返完整结果（旧 250 平帽会静默报错数 / 漏文件）+ 全模式截断响亮页脚 / Grep 全扫遥测行 / `runConcurrent(mgr,tasks,opts)` 并行驱动多会话（默认 8 并发、逐任务失败隔离，闭合「串行拉链」脚枪）/ `provider.maxConcurrentRequests` FIFO 计数信号量护速率 / MCP 并发加固（50 并发 callTool 单连接无串扰）。1447 绿。
  - **v0.14.0（#505 空并 → #507 re-land）**：跨模型 thinking-signature 400 根因修复——按签名模型（non-enumerable Symbol 戳、不上线）在出站装配唯一收窄点剥离「签名≠目标模型」的 CLOSED 历史轮 thinking，镜像官方 replay 契约（同模型字节不变、cache-safe）；覆盖 in-run fallback 切换 + resume 换模型；mid-tool-loop 切换硬边扣留 fallback、干净 `error_during_execution` 不进 400 循环。**#505 首合为空并（修复丢失）→ #506 版本工件对齐 0.14.0 → #507 重新落地**（空并卫生隐患，见下）。+13 单测（1460 绿）。
  - **官方语义潜伏分歧审计（#508，纯文档）**：`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-semantics-audit-20260707.md`——10 确认 + 5 疑似分歧，喂 #509/#510(#512) 两批修复。
  - **v0.15.0（#509，审计批 1）**：stop-reason 语义 + 模型别名——`fable` 别名修回 `claude-fable-5`（曾误解析为 `claude-sonnet-5`，价档 / 能力皆错，C3）/ `pause_turn` 不再当成功截断、改重新流续（C4）/ `refusal`（HTTP 200 + `stop_reason:refusal`）改专用 ERROR 结果、不再当空文本成功并对拒绝模型死重试（**破坏性**，C5）/ `max_tokens` 中断 tool_use 时落孤儿 `tool_use` 已修（防下轮 400，C6）。+4 引擎单测。
  - **v0.16.0（#510 空并 → #512 re-land，审计批 2）**：计价 + 流式 + replay 修复——1h 缓存写按 input×2 计价（曾按 5min 1.25x 少算 ~37.5% 成本、放行超 `maxBudgetUsd`，C1）/ 云 provider 模型 id（Bedrock `us.anthropic.*` / Vertex `*@vertex`）不再计 $0（`normalizeModelId` 剥前后缀，S1）/ `claude-fable-*` 补价条目（S5）/ `citations_delta` 不再静默丢（收上 `TextBlock.citations`，S2）/ `partial_json` 缺片不再毒化工具入参（`?? ''` 护栏，S3）/ API-summary 压缩到异模型不再静默 400（剥 thinking 前缀，C7）/ `repairPairing` 补 pass 3 合并连续同角色轮、防 role-alternation 400（C8/S4）。+8 单测（1469 绿）。**#510 与 #505 同为空并（diffstat 零 src 改动）、真落地在 #512**。
  - **附带账目——「空并」隐患登记**：#505 / #510 两次审计修复 PR **squash 合并后 diffstat 为空**（源码改动丢失），各由 #507 / #512 重新落地。两次同型，属值得盯的合并卫生隐患（疑 merge-base / squash 时机导致空并）；本回填据 `git show --stat` 实证（非 commit message 外推，§4.2 R2）。
- **官方语义偏差「回归锁→行为边界」升格（2026-07-07，守密人「加进测试用例、测行为边界不只测解决问题」裁定，纯测试改动零 src、不升版）**：#508 审计挖出的 15 条偏差（C1-C10 + S1-S5）此前已在**引擎/存储级单测**逐条 fix-lock（C1-C8/S1-S5 全覆盖、maxBudgetUsd 强制亦测），但**未进一致性套件的差分/棘轮/KD 网**——审计本身是人工 6 代理读源码扫出、非套件抓到，即行为边界的网在此有洞。本轮把 stop-reason 三条契约升进 **L4 差分层**（`tests/conformance/scenarios-l4.mjs` 新增 `l4-stop-refusal`(C5)/`l4-stop-pause-turn`(C4)/`l4-max-tokens-orphan-tool`(C6)，仿真器脚本化 stop_reason、跑 localhost 零真金；我方臂 invariants+bptOnly 本地 `run-l4 --arm=bpt` 全过，官方臂差分作 CI 发现三角化，KD 遵「双臂 2 轮观测才登记」纪律不预设；棘轮安全——新场景=improvement 不红）；补 **C1 强制边界**引擎测试（1h 计价 2x 改变 `maxBudgetUsd` 强制结果，证强制非仅算价）；**§三 refusal 排除精炼翻案**（守密人授权）——原「拒绝类不进门禁」一刀切收窄为：引擎 refusal-**帧**契约（C5，确定性、与专有提示无关）进 L4 钉死，仅真 API 拒答**倾向**半边（专有提示混淆，KD-L5-02）仍观察-only。自验 tsc 净 / vitest **1470 绿 + 2 skipped**（+1 C1 强制边界）。**决策已落 `decisions.md`**（2026-07-07，守密人授权代写：官方语义偏差进行为边界网 + §三 refusal 精炼翻案 + KD-L4-06/07/08 登记）。
- **「测试最新 SDK」双臂差分 + KD 三角化收官（2026-07-07，守密人「测试最新的 SDK」，续上条）**：main 升到 **v0.18.1**（#515 C9 结构化输出 output_config + #516 Windows bash state-dir forward-slash 修复），全量 keyless 验证程序全绿（tsc 净 / vitest **1484 绿 + 2 skipped** / run-l4 我方臂 15 场景 `bpt fails: 0`）。**瞬装官方臂**（pinned agent-sdk 0.3.201 + claude-code 2.1.201，`--no-save` 零真金跑 localhost 仿真器）跑 **L4 双臂差分**，把上条新增的 3 场景从「发现脚手架」正式三角化——**跨 2 轮稳定**观测到官方臂行为、登记 KD-L4-06/07/08 并烘焙进棘轮 baseline（`ratchet --update`，纯增 3 条、既有 12 条字节不变；kdCandidates 归零）：**KD-L4-06** refusal——官方发 `system/model_refusal_no_fallback` → success 编码 + 迭代器抛错（KD-L4-01/KD-10 quirk 族），我方 C5 干净 error 结果（更正确）；**KD-L4-07** pause_turn——官方**不续流**（postCount 1、部分当完成、静默截断），我方 C4 续流（postCount 2，更正确）；**KD-L4-08** max_tokens 孤儿——官方**执行**截断 tool_use（2nd POST 派发、遇队列耗尽 400），我方 C6 丢弃（postCount 1、避下游 400，更保守正确）。三条我方均为更正确/更保守侧。自验 tsc 净 / vitest **1484 绿 + 2 skipped** / run-l4 双臂 3 场景全 FAULT_KNOWN_DIFF、ratchet compare PASS 零回归。纯测试改动零 src、不升版。
- **中文 i18n 成本调查收官（2026-07-08，守密人「测试最新 haiku L5」→ 追查 +50% 成本）**：main 升到 **v0.28.0**（#523–#533 Chinese i18n 战役,工具描述 + 系统提示 + 分类器提示全译中文）。v0.28.0 Haiku L5：**gate B bpt 87/90 (96.7%) vs 官方 70/90 (77.8%),+18.9pp PASS,未回归**（bpt 仅 code-01 3/5→2/5,已知残余）;但**花 $3.28 vs v0.18.2 $2.19(+50%)**。两个 `count_tokens` 探针($0)+ L5 per-run 缓存明细追查,**两次假设翻掉**:①「Haiku 旧分词器、换新模型省」**证伪**(跨模型探针:Haiku 中文 1.75 tok/字反比新分词器 1.89 更省);②「中文提示大 → 前缀翻 3 倍」**证伪**(逐文件 count_tokens:8 译文文件全 1.2–1.45×,缓存前缀合计**仅 1.41×**)。**定位**:1.41× 内容膨胀解释不了 3.2× 缓存读——差值在**每轮重读的对话上下文**(document-01 同任务同轮数、ZH 历史读量 ~6× EN),**主嫌=中文思考/输出累积**(preset 默认开思考、中文 token 越滚越厚)。**优化方向**(待裁定 + L5 复验):内部系统提示可留英文(模型照懂、用户输出仍中文),砍思考累积大头。诊断报告 [`bpt-sdk-i18n-cost-investigation-20260708.md`](https://github.com/lightproud/brain-in-a-vat/blob/main/Public-Info-Pool/Resource/data-diagnostics/bpt-sdk-i18n-cost-investigation-20260708.md);探针 `tests/integration/token-probe{,-perfile}.mjs`(#535/#536)。纯测试+诊断,零 src。
- **T4 点火：真 L5 一轮（2026-07-11，守密人 2026-07-10 已裁点火，艾瑞卡会话执行；run [29134399453](https://github.com/lightproud/brain-in-a-vat/actions/runs/29134399453)，head `1783b0dc`=v0.43.0，haiku，`$1.5` 帽，`conformance_l5=true` 余默认）**：作业全绿、净室自审 PASS，但**主目标 code-01 复验未达成**。预算守卫按投影（$0.59 实花→投影 $1.56 > $1.5）在 **79/180 runs** 干净中止，停在 document-01 之后——**code/longconv 整段未触达**（`aborted=true`）。**Gate B `INCONCLUSIVE-PARTIAL`**（预算停，明示**非破线**、exit 0）：跑到的 8 任务（chat×3+retrieval×4+document-01）**bpt 40/40 (100%) == 官方 39/39 (100%)、delta 0.0pp**，即前排在 0.28→0.43 全部变更后**零回归**；两臂缓存均 scenario a；L6 官方迹 39/我方 0（设计如此）；效率旁证 bpt 检索/文档更省 token+更少 turns（reported-only 非门禁）。**根因非基建非行为、是预算射程不足**：`$1.5`+`repeat=5` 结构上到不了 code 维度（历史触达 code-01 的全量干净轮用 `$5` 帽、花 $2.19–3.28 跑满 180）。**红行不遮蔽**：未把 8 任务全过粉饰为轮次通过、未把 code-01 未触达写成已复验、未动任何基线。code-01 复验 → 新账 **T17**（$5 全量轮 / 降 repeat / 加 `l5_tasks` shard 输入，均待守密人裁）；run-l35 KD-L35-02 无 CI 入口 → 新账 **T16**。诊断报告 [`silver-core-sdk-l5-round-20260711.md`](https://github.com/lightproud/brain-in-a-vat/blob/main/Public-Info-Pool/Resource/data-diagnostics/silver-core-sdk-l5-round-20260711.md)。


## 追加归档（2026-07-28，为 project-status.md 行数上限腾位；原文逐字保留）

- **v0.91.0（2026-07-27）**：**四个工具补上结构化产出 + 零产出面立台账**（守密人「全补」+「整体记档并入白名单」两裁）——**暴露的是 type-parity 的射程边界**：它比**声明的形状**、不问**有没有人产出**，首跑遂一本正经报 `AgentOutput` 差 20 个字段——实情是本 SDK **从没有代码填过 `AgentOutput`**，等于精确地量一个空盒子。顺线做工具层普查又揪出**四个「声明了官方形状、一行没填」**的类型，事实全都只能靠解析人话字符串拿到：**Write**（`type`/`filePath`/`content`/`bytes` + 有 checkpoint 时的 `originalFile`；`bytes` **早就算好了**、拼进句子扔掉，全批最刺眼）· **Edit**（含 `replacedCount`，前像不额外花钱）· **TodoWrite**（`oldTodos`/`newTodos` 完整，为此把上一版单子存进 session-key WeakMap，调用方才看得到**迁移**）· **EnterWorktree**（三字段完整）。`structuredPatch`/`gitDiff` 不填——无差分引擎与 git 管线，空数组会被读成「没有改动」。**缺就报缺**：Write 的 `originalFile` 没抓到前像时**省略**而非 `null`（`null` 已表示「原本没这个文件」，把「不知道」塌缩成「不存在」是主动误导）。**立台账不立规矩**：`tests/structured-output-census.test.ts` 钉住刻意不产出的名单+理由，新工具静默上线红、陈条也红——「所有工具都必须产出」是错规矩（会再造 typed-not-populated），真正出事的是**静默增长**。**18 条并入白名单**，漂移报告归零。**Workflow 仍开着**（必填 `status:'async_launched'` 与同步执行冲突，守密人已裁改行为对齐，另轮跟进）。
- **v0.90.0（2026-07-27）**：checkpoint blob 上限（T74 甲案）——超 10MB 前像不存字节、标 `oversized`（刻意不复用 `blob: null`——那意味「新建」，rewind 会删档；`readIndex()` 往返保留标记，丢即致命）；rewind 对超限档原样不动、点名不可恢复并整体报 `canRewind: false`。销 T74。
- **v0.87.0（2026-07-27）**：截断纪律全家对齐——任何上限砍内容须答三问（丢多少/为何/怎么拿回）、流式保尾。后台 shell 流永久失聪缺陷修复（保尾保留窗 + 丢弃计数 + gap 标记）；Bash/WebFetch/Glob/workflow 标记补齐；注册表测试逼新截断点登记；cards 校验两层豁免索引档（修 0.84.0 自种 P4 矛盾）。另修哨兵两档制 + test.yml push 盲区 + 门禁 hooksPath 警告（仓侧）。
- **v0.89.0（2026-07-27）**：**类型面漂移检测工具化——只报「新的」**（守密人「按你建议继续」）——同日三轮普查全是跑完即弃的手搓脚本，「上次扫到哪、哪些已裁过」全靠人记，这正是漂移反复回来的原因（第三轮挖到的恰是第二轮当天引入的）。收成 `projects/silver-core-sdk/scripts/type-parity.mjs`：**价值不在重跑比对，在于自动扣除已裁定项、只把新长出来的摆上台**（`RULED` 白名单，一条裁定吸收整棵子树）——每次都吐同样四十条已知差异的报告，人第二次就不看了。恒 exit 0（尺子不是门禁：红线纪律禁止声明未发货能力，机械拉平等于逼类型面承诺做不到的事）。**首跑挖出四条真缺陷，三条同一种「发货了却没声明」**：`GrepInput` 未声明 `-o`（实现早在，前几轮漏因不匹配带引号键）· `WorkflowInput` 未声明 `title`/`description`（都在发货 schema 里）· `GlobOutput` 空着 `totalMatches`/`countIsComplete`（本引擎先枚举全集再切片，数得准）。**声明面少报代码实际接受的东西 = typed-not-populated 的镜像**。解析器出的是**假发现**不是响亮失败，故 `tests/type-parity.test.ts` 钉住历次真踩过的坑（单行 `{}` 吞下一块、纯别名伸进邻居花括号、带引号短横线键、索引签名造幽灵字段、官方 `@minItems` 元组展开挂错父节点）。**三项待守密人裁**：`AgentOutput` 官方遥测/worktree 字段 · `AgentInput.team_name` · `FileReadOutput.source`（缺的是整条 `file_unchanged` 分支）——**故意不自行并入白名单**。
- **v0.84.0（2026-07-27）**：记忆索引纪律 + 整理规程——修的是「SDK 给了常驻索引机制却没规定索引条目该长什么样，且会话收尾提示词命令模型把进度卡写进索引档」这个自伤缺口（守密人 BPT 现场反馈：开工要好几回工具调用才找得到东西）。进度卡改落 `/memories/progress/`、索引只留指针；新增索引纪律片段（两模式注入、前提不成立即跳过）；写侧超限反压（读写共用同一度量，明说尾部已不可见）；`buildConsolidationPrompt()` + 四阶段整理规程，由 `assessMemoryStoreHealth()` 结果渲染待办。**层界守住**：只给「该不该整理 / 怎么整理」，不给调度（N1 未破，零新进程）。新增测试 28。
- **v0.86.0（2026-07-27）**：**主循环提示词补回开篇句 + 输出类型普查（续）**（守密人「1 对齐官方 4 续」）——① 补回官方「Text you write between tool calls may not be shown to the user.」——银芯只搬了结论没搬**理由**，缺前提的规则是模型最先绕过的那条；字节金样有意重生成、差异经核实只有这一句（四个工具集各一处）。**官方 `# Focus mode` 整块刻意不复刻**（为进不去的 UI 模式发指令 = 描述未发货能力）。② **15 个 `*Output` 逐字段比完：9 个完全一致**（FileEdit / Task 五件 / EnterWorktree / TodoWrite / Monitor）；6 个有官方独有字段，守密人裁「逐条再看」，**这一类并不齐整**——`ReadMcpResourceOutput.error` **加了并真产出**（非 UI 绑定，调用方此前分不清「读失败」与「读到空」）；`WebSearchOutput` **整体补产出**（原议题 `searchCount` 是伪命题、恒为 1，真缺口是它根本没有结构化结果；报**过滤后**命中免得与文本对不上）；其余四条**只登记不声明**（Workflow 的真障碍不在可选字段，而在必填判别式 `status:'async_launched'`——本 SDK 同步跑工作流，填它等于断言一次没发生的启动）。**射程边界**：本次为**顶层字段**比对，嵌套差异首轮漏看（`contents[].blobSavedTo` 靠人工复读才发现）。测试 3,295 → **3,297**。
- **v0.80.1（2026-07-27）**：**两条提示词溯源 slug 改锚 + 给刷新 cron 补自检**（守密人 2026-07-27 交互裁「一并修 + 给 cron 补自检」）——上游快照 2.1.173 → 2.1.216（今日 cron 76fe5e6 带 `[skip ci]` 直推 main）改名 24 档 / 删 5 档，SDK 侧两条 slug 指空、两条 corpus-sync 守卫在 main 上报红。① `COORDINATOR_WORKER_PROVENANCE.slug` → `agent-prompt-coordinator-worker-instructions`（纯改名，守卫抽出的 15 个锚点句逐字仍在）· ② `MAIN_LOOP_INTRO.slug` → `system-prompt-harness-instructions`（上游把三个 intro 小档合并进它，原句未变、现居开篇模板的「无 output style」分支；`faithful` 仍成立，注释写明 faithful 于**分支**非整档）。**零 shipped 提示词文本改动**。同批给 `refresh-claude-code-prompts.yml` 补自检：刷新后、提交前跑这两条守卫，**红则不提交不直推**，第二道网是 dead-man-switch 按「最近一次成功超时」抓持续失败。
- **v0.80.0（2026-07-27）**：**工具输出上限对齐 Claude Code 2.1.141**（守密人交付单三处独立改动，常量取自 `claude.exe` 内含明文 JS）——① WebFetch 上限 **100_000 → 复用 Read 的 50_000**（官方那个数管的是「喂摘要小模型的输入」、主上下文只收摘要；本 SDK 直连无摘要层，同一个数字变成「原文直灌主上下文」，反让 WebFetch 独享两倍 Read 额度，而它拉的是最不可控的外部网页；改为引用`MAX_READ_OUTPUT_CHARS` 常量防两闸门再漂移）· ② Grep `head_limit` **三种 output_mode 统一默认 250**（原 count / files_with_matches 默认无限；OPT-1 担忧的「截断的 count 是错的 count」已由同批的「每种模式都追加截断提示」解决，要可证完整仍显式传 `head_limit=0`）· ③ Bash 输出截断**改保尾去头**、标记移到开头（长命令的结论在末尾：构建成败 / 测试汇总 / 最终报错；新增 `sliceTailSurrogateSafe`镜像 helper，尾切丢的是开头低位代理）。**刻意不改** Read 的字符计量（对齐 token 需引入 tokenizer运行时依赖，且字符计量在中文场景反更宽）。测试新增 5 条（上限对齐三处各自钉死 + 尾切代理边界），本容器实测 **3,247 条**（3,239 通过 / 6 跳过 / **2 失败**——两条均为 2026-07-27 上游提示词快照刷新 76fe5e6 导致的档案锚点漂移治理测试，**HEAD 上同样红**，与本次改动无关）。
- **v0.81.0（2026-07-27）**：**Read 截断页脚补齐官方三件套 + 数值基准获独立佐证**——守密人报「一次 Read 后模型连发六轮自动翻页、上下文推到 300K+ 字符」，旧页脚只给一句「Use offset=N to continue reading.」别无他物。**交付单诊断对了一半**：它认为官方从不给具体值，实测**官方 2.1.220 也给值**，且同时给 **Grep 替代路径**与**「不要单凭本页作答」告诫**——差别从不在那个值，在银芯只给了三件套的第一件。守密人裁定取官方口径，两处截断分支均补齐；大档 Grep 提示改为**只看体积**（原还要求有超 2000 字符长行，普通源码没有那种行，故几乎从未触发、且零测试覆盖）。**同批订正 0.80.2 的错误结论**——「数值基准须在装有 Claude Code 的机器上才能提取」是错的：官方二进制是**公开 npm 发行物**（平台 optionalDependency），本仓一致性作业本就装它作对照臂。已提取 2.1.220：Read **25000 token** / Bash **30000 默认 · 150000 上限** / Grep **「Defaults to 250」逐字**，与 2.1.141 三项全部一致（79 版未变）。
- **v0.80.2（2026-07-27）**：**对齐 2.1.216 快照基准**（守密人裁「3 也直接对齐基准」）——① 手工挖出**第三条指空 slug**（`SendMessage` 引用被快照改名），真因是**缺档检查搭在锚点检查里、而锚点检查跳过 adapted 条目**，现拆为独立测试 faithful/adapted 一视同仁；② 新增 `projects/silver-core-sdk/scripts/description-coverage.mjs`——把「散文基准漂没漂」变成一条命令，**报告体恒 exit 0**（吻合度本就不该满分：红线纪律禁止描述未发货能力）。实测 30 档 18 档 100%，低分端全是已登记改编。**射程边界**：0.80.0 那批**数值上限对不了**（重建档把数字模板化、grep 档无参数级文档），仍只靠一次 2.1.141 二进制提取支撑，重新核验须在装有 Claude Code 的机器上再提取。
- **v0.85.0（2026-07-27）**：**工具真正产出结构化结果 + MCP 接受列表扩容**（偏离普查轴一/轴四裁定）——**先订正普查自己的结论**：首轮只 grep `outputSchema` 就报「银芯零输出面」是**错的**，`types/tools.ts` 里官方形状的输出类型**早已齐备**，缺的是**从来没人产出**（typed-not-populated）；故改为**复用既有类型**、只补真缺的两三个。`ToolResultPayload.structuredOutput` + 引擎 **WeakMap 侧信道**（不往 Anthropic 线格式上加字段）+ `query()` 发 `toolUseResult`（**tool_use_id 为键的 record**，因本引擎一轮批处理、官方一消息一结果）。Read/Glob/Grep/Bash/WebFetch 每条终态分支均产出。MCP 接受列表加 `2024-10-07`；**提议版本仍留 `2025-06-18`**——官方的 `2025-11-25` 新增异步任务面（`tasks/*`）本包未实现，宣告它等于描述未发货能力。测试 3,254 → **3,267**。
- **v0.82.0（2026-07-27）**：**Read 通读 >256KB 改为拒绝 + 首次对官方二进制做偏离普查**（守密人问「还能查到有哪些我们与官方不一致」）——第一次拿**官方发行物本体**（npm 平台包 + `sdk-tools.d.ts`）而非第三方重建档做四轴对照。**工具集**：官方 18 个工具银芯没有（多为绑定 Anthropic 云侧服务）。**输入 schema**：Bash/Read/Write/Edit/Glob/**Grep 15 字段**/WebFetch/WebSearch/Task 五件/Workflow/两个 PlanMode/EnterWorktree **全部一致**；真差异仅 `AskUserQuestion` 缺三个**回程字段**（守密人裁「只登记不改」——它们服务官方权限组件 UI，本 SDK 无那套组件）。**数值**：Read 25000 token / Bash 30000·150000 / **Glob 100** / Grep 250 均一致，唯一缺口 = 官方 `maxSizeBytes`=262144 拒通读，银芯此前只有 50MB OOM 守卫（松 200 倍）——**已按守密人裁定补上**，只拦通读、带 offset/limit 放行。**两条经复核是假象、如实记档**（`EnterPlanModeInput` 官方就是 `{}`；Grep 短横线键与 `TaskListInput` 亦一致）。未扫轴照实标注：官方 `*Output` 37 个 / 主循环提示词 / 权限钩子层 / MCP 协议层 / WebFetch 的 100000。
- **v0.88.0（2026-07-27）**：处方卡型（A1）+ sessions 体检面（P1-S1）——cards 模式增处方卡（意图/步骤/结果/适用边界，按字段集判型、混用按名拒绝；进度卡映射处方型，解 P1-3）；`assessSessionStoreHealth()` 照 memory 体检成例补 sessions 域「机制无规程」缺口（会话数/字节/腐化/孤儿 checkpoint，外部店报 unavailable）；blob 上限挂 T74 待裁。审计报告补 sessions 节。
- **v0.85.0（2026-07-27）**：**GoalVerdict 家族统一（本包零行为改动）**——本包 `{status, reason?}` 判词升格家族**正典**，maestro 0.85.0 将 GoalChaser 评审判词迁为同形，一个宿主评审器同时服务引擎 `options.goal` Stop 门与跨 query 追逐两缝。留档背景：两形并存期产出真实消费者陷阱——maestro 形判词喂进 `options.goal` 被引擎判 malformed、fail-open 放行停止（防评审器坏死锁死代理的既定失败方向），症状即 BPT 2026-07-27 所报「接了 goal 模型照样停」。`options.goal` 语义与评审器契约未动，仅 `GoalVerdict` 注释补正典地位声明。

## 2026-07-28 迁入（审计十五/十六波扩写腾行）

> 状态档有 520 行硬上限（`tests/test_claude_md_size.py`），审计波次的叙述条目逐波增长。
> 按「不抬上限、把历史挪进归档层」的既定处置，以下条目逐字迁入，一字未改。

### Silver Core SDK

- **v0.77.0（2026-07-26，Windows 正确性清扫——家族史上首次非 Linux CI 实跑 + 守密人现场反馈

### Silver Core Maestro SDK

- **v0.94.0（2026-07-28）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 0.94.0（BREAKING：包内模型兜底默认值全数移除，缺 model 即抛错）前进。

## 2026-07-28 迁入（审计十七波扩写腾行，第二批）

> 同前批：520 行硬上限不抬，历史条目逐字迁入。

### Silver Core SDK

- **v0.79.1（2026-07-27）**：内部去重，零表面/行为变化——重试退避与 JSON-RPC 两族重复实现分别收敛为 `transport/http-retry.ts` / `mcp/protocol.ts`，六档净 −288 行。随 #835 合并时漏 bump 致版本门禁在 main 红约一小时，本版为补票（详见 CHANGELOG）。

### Silver Core Maestro SDK

- **v0.95.0（2026-07-28）**：**台账两处缺陷 + 驱动器并发上限竞态修正**（家族审计波及本包，非空转）——`reopenSession` 并发 CAS 落败永久丢溯源链接、`recordOutcome` 回填路径写入词表外 outcome、`stop()`+`start()` 交错令两代 tick 各自认领满额致并发翻倍。

