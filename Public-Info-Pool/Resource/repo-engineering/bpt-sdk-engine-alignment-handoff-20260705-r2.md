# BPT Agent SDK — 引擎侧修改交接清单（供引擎开发直接领工）

> **r2（2026-07-05）**：追加 E6「错误面收口」——由 BPT 侧实测故障
> `Malformed SSE payload for event "(none)"` 触发的错误体系审计产出（守密人裁定「追加」）。
> E1–E5 内容不变。

- 来源：L5 首轮真跑解剖（`bpt-sdk-l5-failure-dissection-20260705.md`，run 28736460533）
  + 一致性套件 M2/M3 既有引擎发现（L2 s12 / KD-L3-06 / KD-L4-02~04）+ 测试用例层加固时新发现（KD-L5-04）
  + 错误面审计（r2 新增，见 E6）。
- 范围：**只列引擎（`projects/bpt-agent-sdk/src/`）的活**。harness / 测试用例侧的活已由银芯完成
  （PR #453），不在此单。
- 证据合规：全部规格来自**官方臂公开消息流 + 文件系统副作用 + 终态答案**（净室观测边界 r2，
  decisions.md 2026-07-05）；官方请求体从未读取。凡「官方内部值不可观测」处均已明示，取值是我方选定。
- 验证总则：每项改完跑 `tests/conformance/` 的 run-l1~l4（无钥零费）+ 棘轮 `ratchet.mjs`；
  预期转绿的 KD/基线行用 `--update` 显式升基线（会带 RED-LOCK 警告，属预期）。E1 的最终验收要一轮
  真 API L5（`conformance_l5` dispatch，$1.5 帽内）。

优先级建议：**E1 > E4 ≈ E5 > E3 > E2 > E6a/c/d**（E1 修我方仅有的两个 L5 全败点；
E4/E5 规格已钉死、改动面小；E3 中等；E2 是接口面对齐、有破坏性注意事项；
E6a/c/d 是体系收口、不阻塞断供换装。**E6b 已由银芯落地**，见 E6 节，勿重做）。

---

## E1 — claude_code preset 默认开启 extended thinking（修 L5 我方两败点）

- **现象**：L5 首轮我方 chat-03 0/3（逆字母序题 8 token 抢答、答成正序）、code-01 0/3
  （中位数只排序、漏偶数长度取均值）。官方臂 54/54 份留痕全部含 `thinking_tokens` 事件
  （合计 1161 次）——官方 CLI 2.1.201 **默认开思考**；我方引擎默认关。
- **现状代码**：`src/engine/loop.ts:393` `computeThinking()` 仅在 `config.thinking?.type === 'enabled'`
  时向 Messages API 发 thinking 块（已支持 `budgetTokens`/`budget_tokens`/`budget`/`maxThinkingTokens`
  四种来源 + `budget_tokens < max_tokens` 护栏，loop.ts:403-410）。管线是通的，只差默认值接线。
- **改法**：`systemPrompt: {type:'preset', preset:'claude_code'}` 路径下，用户未显式设
  `thinking` / `maxThinkingTokens` 时，默认注入 `thinking: {type:'enabled', budget_tokens: 4096}`。
  接线点在 preset 解析处（`src/query.ts` options 组装，systemPrompt 处理在 query.ts:515 附近）。
- **硬约束**：
  1. 显式关闭必须可用：`maxThinkingTokens: 0` 或 `thinking: {type:'disabled'}` 走回零思考；
  2. **非 preset 路径行为不变**（裸 systemPrompt / 无 systemPrompt 的 drop-in 默认仍不发 thinking）；
  3. 预算护栏沿用现有 `budget_tokens < max_tokens` 检查；
  4. **4096 是我方选定值，不是官方对齐值**——官方具体预算要读其请求体才知道，越内容盲边界，不做；
     公开流只证明「官方开了思考」不证明「开多大」。此点在 COMPAT.md 登记为 KD。
- **可选加分项**：官方在公开流上发 `system/thinking_tokens` 进度事件（`estimated_tokens` +
  `estimated_tokens_delta`）；我方 `SDKObservabilityMessage` 体系可对应真发射。非本项验收条件。
- **验收**：下轮真 L5（repeat=3）chat-03 我方 ≥2/3、code-01 ≥官方同轮−1、乙门禁保 PASS、
  econ 轴我方中位成本仍低于官方（思考 token 计费，预估短任务成本升幅 <2×，仍应保持便宜优势）。
- 比喻：官方答题前默认打草稿，我们的默认口算抢答；这项改动就是给我们的考生也发一张草稿纸——
  纸张大小（4096）是我们自己定的，因为看不见官方发多大的纸。

## E2 — result 消息累计口径对齐官方（KD-L5-04，drop-in 面）

- **现象**：流式多轮输入下两引擎都逐用户轮发一个 `result`，但**字段口径分歧**。
  官方（run 28736460533 留痕实证）：`num_turns` 与 `usage` **逐 result**（本轮自己的量），
  `total_cost_usd` 与 `duration_api_ms` **会话累计**（严格递增，差值恰为逐轮量）。
  我方（`src/query.ts` finding #33 设计，`rewriteResult` 在 query.ts:956 附近）：
  `num_turns`/`usage`/`total_cost_usd` **每个 result 都报会话累计**，`duration_api_ms` 逐轮。
- **改法**：对齐官方——`num_turns`/`usage` 改报本轮量；`total_cost_usd` 保持累计（已一致）；
  `duration_api_ms` 改为会话累计。
- **硬约束**：
  1. **内部执行语义不动**：finding #33 的本意是 maxTurns / maxBudgetUsd 会话级强制执行，
     session 累计器（`sessionTurns`/`sessionCost`，query.ts:845-900）照留，只改**对外报告字段**；
  2. 排查存量消费方：`result.metrics`、ab-benchmark、vitest 中依赖累计口径的断言要同步；
  3. 改完通知银芯：`tests/conformance/run-l5.mjs` runOne 里的按臂聚合分支（`perResultArm`）
     可以合并成单一规则（两臂同口径），KD-L5-04 从 KD 表退役；
  4. COMPAT.md 对应行更新。
- **验收**：新增单测——3 轮流式输入，断言逐 result 的 num_turns/usage 为本轮量、cost 单调累计；
  run-l1 流语法差分维持 MATCH。
- 比喻：官方记分员每局报「本局得分」+ 底下一行累计总分；我们的记分员每局都只报累计总分。
  两张表并排看会打架，改成同一种记法。

## E3 — 截断轮优雅降级（KD-L4-02/04，M3 遗留加固候选）

- **现象**：L4 故障注入（`run-l4.mjs`）9 用例中 3 条**有意保红**：SSE 流中途截断的轮，
  官方能优雅降级、保住已有进展继续跑；我方丢整轮、连带丢掉该轮的工具执行。
- **改哪里**：`src/transport/`（SSE 解析截断路径）+ `src/engine/loop.ts` 轮级错误处理——
  截断时保留已完整接收的内容块（已闭合的 text/tool_use 块），把可挽救部分作为该轮产出继续，
  不可挽救才走重试/失败路径。具体对照行为以 run-l4 的三条红行为准（KD-L4-02/04 登记在
  `normalize.mjs`/基线）。
- **验收**：`node tests/conformance/run-l4.mjs` 对应 3 行从引擎发现转 MATCH；
  `ratchet.mjs --update` 升基线；新增单测锁截断恢复路径。
- 比喻：电话说到一半断线，官方把已经听清的半句记下来接着办事；我们现在是整句作废重来。

## E4 — Write 读前写门（KD-L3-06，官方语义已钉死）

- **现象**：M2 L3 差分发现官方 Write 拒绝覆写「本会话未 Read 过的已存在文件」，我方直接覆写。
  L5 留痕把官方语义**实锤到细节**（code-03 r1 vs r2 活体对照）：
  1. 目标文件**不存在** → 直接写，成功（**新建不拦**）；
  2. 目标文件**已存在且本会话未 Read** → 拒绝，tool_result 为
     `<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>`；
  3. Read 过之后 → 允许覆写。
- **改哪里**：`src/tools/write.ts`（现无任何读前检查）+ 每 query 一份「已读文件」状态
  （Edit 若已有类似追踪可共用；没有就在 query 级上下文加一个 read-path 集合，Read/Glob 不算，
  只有 Read 成功算）。错误文案建议逐字对齐官方（差分测试直接受益）。
- **注意**：这是行为收紧，存量「盲写已存在文件」的调用方会开始收到错误——这正是与官方对齐的
  预期行为（也是权限/安全语义：防未读盲覆写）。COMPAT.md 从 PARTIAL 转 IMPLEMENTED。
- **验收**：`run-l3.mjs` Write 用例从 KD 转 MATCH；棘轮升基线；单测覆盖三分支（新建放行 /
  未读已存在拦 / 读后放行）。
- 比喻：改别人桌上已有的文件前得先看一眼内容，官方有这条门禁我们没有；装上同款门禁，
  门上贴的告示（报错文案）也照抄。

## E5 — maxBudgetUsd 执行前截停（L2 s12，M2 有意保红）

- **现象**：L2 s12 差分：预算超限时，官方在**已请求但未执行**的工具调用**执行前**截停；
  我方把在途工具执行完才截停——多花一笔、且可能多一次副作用。
- **改哪里**：`src/engine/loop.ts` 预算检查位置（现有检查在 loop.ts:1083 与 :1118，
  loop.ts:914 有一条「此处故意不查」的注释——按官方语义把检查前移到工具执行分发**之前**：
  模型回复落地、进入工具执行前先查一次预算，超了则该组工具标记不执行、直接产
  `error_max_budget_usd` 终态）。
- **注意**：与既有「turn 已开始就让它收尾」的注释设计相抵触的部分，以官方语义为准改写；
  工具组内已并行启动的执行如何回收，参照 stop/defer 覆盖同组后续为「Not executed」的既有机制。
- **验收**：`run-l2.mjs` s12 从有意保红转 MATCH；棘轮升基线；单测：预算恰好在工具调用请求后
  超限 → 工具零执行、终态 error_max_budget_usd。
- 比喻：钱包见底时，官方在收银台**扫码前**喊停；我们现在是扫完这单才发现超支。

## E6 — 错误面收口（r2 追加，源自 BPT 实测故障 + 错误体系审计）

**背景事件**：BPT 产线 agent 报「流中断 原因：Malformed SSE payload for event "(none)"」。
该错误出自 `src/transport/anthropic.ts:153`，触发条件 =「一帧只有 `data:` 行、没有 `event:` 行，
且 data 不是合法 JSON」。原生 Anthropic 端点每帧必带 `event:` 行，所以 "(none)" 指纹几乎
断定是**端点格式或链路问题**：最可能是 OpenAI 风格网关（`data: [DONE]` 收尾、无 event 行——
`[DONE]` 非 JSON 一解析就抛此错）或集团代理拦截重组流（长 data 行被截断 / event 与 data 行间
被塞空行）。BPT 侧核实方向：查 baseUrl 指向、`curl -N` 抓原始帧、看死在第几帧。

**审计结论**：错误体系**有设计**（五类类型化错误 `src/errors.ts` / 三通道分层：传输抛异常、
工具错回 `tool_result is_error`、run 级终态走 result error 臂 / `mapStreamError` 五路分诊 /
流阶段不重试防重放），但完成度不均——全仓 80 个抛出点里 12 个裸 `throw new Error`（11 个
集中在 `src/mcp/`），且「错误现场携带」无统一标准。收口四件：

- **E6a MCP 子系统错误归类**：`src/mcp/http.ts`（6 处）/ `stdio.ts`（3 处）/ `registry.ts`
  （2 处）+ `src/tools/bash.ts`（1 处）的裸 `Error` 纳入类型体系——建议新增 `McpError`
  （带 serverLabel / transport 类型 / 阶段字段）或明确归入 `APIConnectionError` 族，二选一
  在 ARCHITECTURE.md 落笔为准。消费方（BPT Desktop）从此可 `instanceof` 分流。
- **E6b Malformed SSE 带现场 —— 已由银芯落地（2026-07-05，随 SSE 网关方言容错修复一并，勿重做）**：
  BPT 侧 `curl -N` 抓到原始字节铁证——idealab 网关的 `/api/anthropic` 端点在 Anthropic 事件流
  末尾追加 OpenAI 风格 `data: [DONE]`（且错误帧无 event 行）。银芯据此修 `anthropic.ts` 流消费：
  ① **message_stop 即收工**（官方客户端同款生命周期，尾部废卡根本不进解析器）；② message_stop
  之前的**无 event 名 + 非 JSON 帧跳过**（debug 记片段，典型 `[DONE]`）；③ **有 event 名的坏帧
  照抛**，且错误消息带出错帧前 120 字符 + 已解析帧数（原 E6b 诉求）。附 5 条回归测试。
  引擎团队只需知悉，无遗留工作。
- **E6c 稳定错误码**：错误对象加机器可读 `code` 枚举（如 `sse_malformed_frame` /
  `stream_idle_timeout` / `mcp_connection_failed`……），name + 英文 message 保持不变
  （drop-in 面只加不改）。供 Desktop 做 i18n 与「重试 / 换网关 / 报障」策略分流。
- **E6d 层间抛错白名单守护**：ARCHITECTURE.md 的「模块只许抛哪些错误类」目前只是文档纪律，
  加一条静态守护测试（扫 `src/` 各模块的 `throw new` 与错误类白名单对账），MCP 这类欠账
  从此进不来。
- **验收**：错误码表进 COMPAT.md 或 docs；E6a/c 各带单测；E6d 守护测试本身全绿；
  存量单测保绿（错误 message 文本若有断言需同步）。
- 比喻：消防系统本来有分级预案，但 MCP 那层楼贴的是手写便条、报警器响了不说着火点在哪；
  这次统一制式并给每台报警器装上「现场快照」。

---

## 不归引擎的（留在银芯侧，勿重复做）

- Fix-2：L5 harness 双臂显式同参 `maxThinkingTokens`（对照公平性，银芯在 E1 落地前后用它拆变量）；
- S2 散落物清扫 / M1 按臂聚合 / KD 表透传：已随 PR #453 合入；
- S3（官方臂把良性中文「记住 X」当注入拒绝）：官方模型姿态，双方都无代码可改，KD-L5-02 留档观测；
- 官方 agent-sdk 0.3.201 追否：漂移哨兵挂账，纯守密人裁定，不动代码。

## 完成后的联动

E1/E2/E4/E5 任一落地 → 银芯重跑 run-l1~l4 + 棘轮升基线；E1 落地 → 银芯申请一轮真 L5
（$1.5 帽内）验收退出标准；E2 落地 → 银芯同步简化 run-l5 聚合分支并退役 KD-L5-04；
E6b 落地 → BPT 侧把带现场的报错样本回传，即可对本次「Malformed SSE」故障直接判型收案。
