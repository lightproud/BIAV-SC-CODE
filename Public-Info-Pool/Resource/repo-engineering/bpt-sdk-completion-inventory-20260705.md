# BPT Agent SDK 功能完成度盘点——三账合一（2026-07-05）

> **r2 修订（2026-07-05，守密人「全面实现」裁定执行完毕）**：本档 §2 台账全线开工并落地，
> 分支 `claude/bpt-sdk-completion-inventory-nj51sk`（PR #480），实建结果见文末 **§6 执行结账**。
> 一句话：T0 撞车四项 + T1 六项 + T2 形状对齐全批 + T3 错误面 + T4 缺席工具（含 Workflow 大件）
> 全部落地，工具面 15→20/24；版本升 0.7.0；唯一未做 = `settingSources` 默认反转（行为级、需升钉，挂账待裁）。

## 0. 这是哪三张账

| 账 | 产出方 | 粒度 | 档案 |
|---|---|---|---|
| ① 完成度审计（07-03） | 银芯 | **特征级**（功能有没有），146 行矩阵，对象是 v0.1 | `bpt-agent-sdk-completion-audit-20260703.md` + 矩阵 JSON |
| ② 接口审计（07-05 本日） | 银芯（本会话） | **字段级**（每个字段名/判别式/默认值/导出名对不对），对象是 v0.6 | `bpt-sdk-official-docs-interface-audit-20260705.md` |
| ③ 引擎工单 r3（07-05 隔壁会话） | 银芯（一致性套件线）→ 引擎侧领工 | **线缆级**（请求体逐接口对官方参考目标差分）+ L5 真跑解剖 + 错误面审计 | `bpt-sdk-engine-alignment-handoff-20260705-r3.md` |

比喻：①查「家里电器齐不齐」，②查「每个插头针脚形状对不对」，③把电表箱打开看「进户线接法跟官方图纸差在哪」。三张验收单本次并成一张总表。

## 1. 完成度总览（v0.6 + E1–E5 后实况）

### 1.1 大盘

- ①账（07-03，v0.1）时点：P0+P1 加权完成率 **68.3%**，41 行 MISSING。
- 之后 v0.2–v0.6 + 引擎对齐批 E1–E5 落地，①账列的 16 个未建模子系统中 **13 个已建成**
  （压缩 / 观测消息流 / 提示缓存 / 子代理运行时 / 结构化输出 / 后台任务(Bash 族) / 工具搜索 /
  文件检查点 / 外部会话存储 / 沙箱 / 权限扩展(auto·ask·defer) / 用户输入面(AskUserQuestion·elicitation) /
  设置源子集(settingSources 指令文件)）；仍未建：**设置引擎全量 / OTel / 第三方供应商**（三者均 N/A-by-design 口径）。
- 现况硬指标：**1049 单测全绿**；一致性 L1–L4 无钥零费常跑全绿（棘轮门禁）；L5 乙门禁首次正向 **+13.0pp**
  （E1 验收轮 run 28741914245，chat-03 0/3→3/3）；vs-official 裸对比 **成本省 ~3.6× / 速度 2.8× / 正确性 11 vs 10**。

### 1.2 分面完成度（②账逐条对账的量化横切，对官方 live 文档全面）

| 面 | 完成度 | 残差要点 |
|---|---|---|
| 入口函数（10 个） | 8/10 实现（2 个 N/A-by-design：startup/resolveSettings） | tool() 第 5 参形态；会话函数 rename/tag 往返断裂 |
| Options（61 官方字段） | 39 typed（其中大部分 FULL）+ 22 runtime-ACCEPTED 未进类型面 | 22 字段的 TS excess-property 拦截；另有 9 个 BPT 扩展字段 |
| Query 方法（19 个） | 17/19 实现（2 个 N/A：reinitialize/applyFlagSettings） | setMcpServers/rewindFiles 返回形状与官方零共同字段 |
| 消息流（32 变体） | 32/32 有对应类型；13 个真发射 | 8 变体判别式反向（6 个真发射）；4 个导出名拼写差；payload 字段大面积偏离 |
| Hook（20 事件） | 14/20 typed，12 个真触发 | 缺 6 个 NEW-IN-DOCS 新事件；MessageDisplay 增量协议 0/5 字段 |
| 内建工具（官方文档 24 个） | 15 个在册（12 官方名 + BashOutput/KillShell/ToolSearch 自有面） | 缺 9 个：Task 四件套/Monitor/Workflow/ExitPlanMode/EnterWorktree/NotebookEdit(有意) |
| 工具输入/输出类型（27+22 个） | **0 导出** | drop-in 类型消费整章缺失（P0 头名） |
| 权限类型 | 6 变体 typed、5 个真生效 | removeDirectories 静默忽略；destination 仅 session 生效；缺 cliArg |
| 沙箱 | bwrap 后端全线可用、权限门收口 | 官方 SandboxSettings 形状差（域名单代理/Seatbelt 未做，已声明） |
| 请求体线缆（③账 5 场景） | 大面对齐（L1 流语法 3/3 MATCH） | E7 三条：thinking 自适应 / 工具 schema 补参 / 工具块缓存断点策略 |

## 2. 合并工单台账（三账去重后的全部在办/待办）

去重原则：同一实底只记一条，标注「撞车」= ②账与③账**独立方法得出同一缺口**（互为交叉验证，置信最高，优先做）。

### T0 —— 撞车项（两账同指，置信最高）

| # | 项 | ②账出处 | ③账出处 | 归属 | 量级 |
|---|---|---|---|---|---|
| T0-1 | **Agent 工具输入补参**：isolation / model（+官方必填集 description,prompt 对齐；我方多要 subagent_type） | §6.D Agent 缺 6/10 字段 | E7-02 | 引擎侧 | M（语义要跟上，isolation 依赖 worktree 能力需先裁定射程） |
| T0-2 | **Read 补 `pages`**（PDF 页范围，schema+实现） | §6.D Read 缺 pages | E7-02 | 引擎侧 | S-M |
| T0-3 | **Bash `dangerouslyDisableSandbox` 恒入 schema**（官方恒有；我方仅沙箱激活+allowEscape 才出现） | §6.D Bash 条件性 schema | E7-02 | 引擎侧 | S（注意与「不描述未发货能力」红线的相容措辞） |
| T0-4 | **thinking 默认改自适应** `{type:"adaptive"}`（官方线缆实读；可能顺带解 L5 code-01 残余） | §6.A thinking 行（adaptive typed 未作默认） | E7-01 | 引擎侧 | S-M；落地后并入下轮真 L5 验收 |

### T1 —— ②账独有 P0（drop-in 编译失败/静默丢数据，多为 S 量级）

| # | 项 | 量级 |
|---|---|---|
| T1-1 | 导出 `ToolInputSchemas`/`ToolOutputSchemas` 及成员类型（先落已有 12 工具） | M |
| T1-2 | `tool()` 第 5 参双形态兼容（官方 `extras:{annotations}` 包装 + 我方裸形态都认） | S |
| T1-3 | 4 个类型名官方别名（SDKControlInitializeResponse / SDKFilesPersistedEvent / SDKRateLimitEvent / SDKAPIRetryMessage） | S |
| T1-4 | `deferred_tool_use` 补官方字段名 `id/name/input`（双轨过渡） | S |
| T1-5 | Grep 输入补 `context` 别名；`CanUseTool.options.requestId` 必填化 | S |
| T1-6 | rename/tag 往返修通（store.load 解析 meta_update；SDKSessionInfo 补 tag/gitBranch/customTitle 接线） | M |

### T2 —— ②账独有 P1（形状/行为对齐，部分破坏性）

| # | 项 | 备注 |
|---|---|---|
| T2-1 | 观测臂对齐 live 文档：8 变体判别式换 system+subtype、payload 逐字段对齐 | **破坏性**；须与 Desktop UI 对接表、MIGRATION 联动 |
| T2-2 | McpSetServersResult / RewindFilesResult 形状对齐 | 破坏性 |
| T2-3 | 22 个官方 Options 字段进 TS 类型面（保持 runtime ACCEPTED 语义） | S-M |
| T2-4 | SDKResultMessage.stop_reason 两臂补齐；ModelUsage 补 contextWindow/maxOutputTokens | S |
| T2-5 | TodoWrite→Task 四件套路线（官方 0.3.142 起默认弃 TodoWrite） | **守密人裁定**：发货四件套 or 声明停留旧轨 |
| T2-6 | 传输韧性默认：maxRetries 4→10?、流看门狗 120s→300s?、后台 stall 看门狗补位? | 守密人裁定（涉成本手感） |
| T2-7 | McpServerStatus.tools 对象数组化；removeDirectories 真实现；suppressOutput 接线或除名 | S |

### T3 —— ③账独有（引擎侧残余）

| # | 项 | 备注 |
|---|---|---|
| T3-1 | E6a MCP 错误归类（12 处裸 Error 入类型体系） | 体系收口，不阻塞换装 |
| T3-2 | E6c 稳定错误码 `code` 枚举 | 供 Desktop i18n/分流 |
| T3-3 | E6d 层间抛错白名单静态守护测试 | S |
| T3-4 | E7-03 工具块缓存断点策略（官方 0 vs 我方 1） | **先实测收益**再定对齐或登记 KD |

（E6b Malformed SSE 已由银芯落地；E1–E5 已全部落地——E1 验收轮已跑正向，勿重做。）

### T4 —— 缺席工具/子系统（P2，XL）与裁定点

| # | 项 | 备注 |
|---|---|---|
| T4-1 | Monitor / Workflow / ExitPlanMode / EnterWorktree 工具（Task 四件套见 T2-5） | 依赖裁定（Workflow=编排 DSL 大件；EnterWorktree 与 T0-1 isolation 同底座） |
| T4-2 | MessageDisplay 增量协议 | 与 Desktop 渲染方式联动 |
| T4-3 | **升钉 0.3.201 + NEW-IN-DOCS 挂账跟进**（settingSources 默认反转为唯一行为级反转；六新 hook；SDKMessageOrigin；claudeai-proxy 等） | **纯守密人裁定**；漂移哨兵同源；升钉后 `run-wire.mjs --update-reference` 刷参考目标 |

## 3. 交叉验证注记（为什么两账撞车是好消息）

②账（读官方文档→对我方类型/实现）与③账（读官方请求体线缆→对我方请求体）**方法完全独立**，却在
Read.pages / Bash.dangerouslyDisableSandbox / Agent.isolation+model / thinking 形态四处得出同一结论——
说明两套方法都在真实工作，且这四处缺口是官方**文档与线上行为一致**的硬缺口（不是文档漂移的假信号），
优先修最划算。反过来，②账在类型导出/判别式/字段名层抓到的 20+ 处是线缆差分**结构上看不到**的
（请求体里不含 TS 类型面与输出消息形状），两账互补而非重复。

比喻：一位验收员照说明书查，另一位拆开电表箱查，两人各自独立在同四个位置画了圈——那四个圈基本不会是误报。

## 4. 建议的开工顺序（待守密人裁定）

1. **T0 撞车四项**（置信最高、多为 S-M；T0-4 落地后并入下轮真 L5 看 code-01）；
2. **T1 六项**（drop-in 硬伤、全 S-M，一批可清）；
3. **T2-5 / T2-6 / T4-3 三个裁定点**先要方向（Task 路线 / 韧性默认 / 升钉），它们决定 T2/T4 的排期；
4. **T2-1/T2-2 破坏性对齐**单独起版本（v0.7 候选，MIGRATION 联动）；
5. T3 引擎错误面收口与 E7-03 实测穿插在空档。

## 5. 指针

- ①账：`bpt-agent-sdk-completion-audit-20260703.md`（+矩阵 JSON）
- ②账：`bpt-sdk-official-docs-interface-audit-20260705.md`（§2 破坏级 15 项 / §4 NEW-IN-DOCS / §5 backlog）
- ③账：`bpt-sdk-engine-alignment-handoff-20260705-r3.md`（E6/E7 细则、验收方式、WIRE_ALIGNMENT_GAPS 棘轮联动）
- 官方文档快照：`Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md`
- 兼容矩阵（随②账修订后）：`projects/bpt-agent-sdk/docs/COMPAT.md`

## 6. 执行结账（r2，2026-07-05「全面实现」落地实况）

分支 `claude/bpt-sdk-completion-inventory-nj51sk`（PR #480），已含 main 全部提交（合并 #482/#483/#484）。

### 6.1 台账逐项销账

| 台账项 | 结果 | 落点 |
|---|---|---|
| T0-1 Agent isolation/model + 必填集 | 落地 | `src/subagents/agent-tool.ts` `runtime.ts`；官方 6 线缆参数全齐 |
| T0-2 Read pages | 落地（诚实子集：schema+校验齐，PDF 无切片依赖故明报不支持而非静默整本） | `src/tools/read.ts` |
| T0-3 Bash dangerouslyDisableSandbox 恒入 schema | 落地（门控未松，无沙箱 no-op、逃逸仍需独立 ask） | `src/tools/bash.ts` |
| T0-4 thinking 默认自适应 | 落地 | `src/query.ts` `src/engine/loop.ts` |
| T1-1…T1-6 drop-in 六项 | 全落 | 类型导出/别名/deferred 双轨/context 别名/requestId/tool() 双形态/rename-tag 往返 |
| T2-1 观测判别式迁移 + E8 | 落地（破坏性，10 变体转 system+subtype，KD-L35-02 退役） | `src/types.ts` `loop.ts` `runtime.ts` `hooks/runner.ts`；MIGRATION 5f |
| T2-2/4/7 结果形状/计量/工具对象化 | 全落 | setMcpServers/rewindFiles 官方形、stop_reason 双臂、ModelUsage 计量、McpServerStatus 对象数组、removeDirectories/suppressOutput 生效；MIGRATION 5g–5l |
| T2-3 22 Options 字段进类型面 | 落地（诚实标 ACCEPTED-IGNORED / N-A） | `src/types.ts` |
| T2-5 Task 四件套 | 落地（默认轨，TodoWrite 默认关，env 回退） | `src/tools/task.ts` |
| T2-6 传输韧性默认 | 落地（maxRetries 10 / 看门狗 300s / 后台 stall 看门狗接线） | `src/transport/*` `src/subagents/runtime.ts` |
| T3 E6a/c/d 错误面 | 全落 | McpError 体系 / 18 错误码 `docs/ERRORS.md` / 抛错守护测试 |
| T3 E7-03 缓存断点 | 定 KD（实测删断点零收益、分叉场景丢 8.5k token） | `src/engine/cache-control.ts` 注记 |
| T4-1 缺席工具 | 全落（ExitPlanMode 真切换 / EnterWorktree / Monitor 诚实子集 / Workflow 受限 vm 引擎） | `src/tools/{exitplanmode,enterworktree,monitor,workflow}.ts` |
| T4-2 MessageDisplay 增量协议 | 落地（5 字段真触发，每消息一次故 final 恒 true） | `src/engine/loop.ts` |
| T4-3 升钉 0.3.201 | 已由 #478 完成；六新 hook typed 加性、纯类型新增落地 | `src/types.ts`；NEW-IN-DOCS 加性面 |

### 6.2 唯一未做（挂账待守密人裁定）

- **`settingSources` 默认语义反转**（省略=全加载 vs 钉版省略=不加载）：唯一行为级反转，翻转会与一致性套件
  钉版官方臂（0.3.199）分歧、拖红 L2 差分，须与**升钉**一并处理。已在 `src/types.ts` JSDoc 挂账，行为一根手指未碰。
- 六新 hook 的运行时**填充**（本轮仅 typed 加性，无自然钩点者诚实标 typed-not-fired）、其余 NEW-IN-DOCS
  typed-not-populated 字段的真填，同属升钉后跟进。
- `McpClaudeAIProxyServerConfig`：上游官方 union 自身未落定，跳过。

### 6.3 硬指标

- **工具面 15 → 20 / 24**（Task 四件套 + ExitPlanMode + EnterWorktree + Monitor + Workflow 本轮入列；
  未做 = NotebookEdit 有意 + 3 个 CLI-host 专属无 headless 源）。
- **1315 单测全绿**（起点 1049）；tsc 零错；一致性 L1–L4 + 棘轮全绿（钉版可观测面零回归）。
- 版本 **0.6.2 → 0.7.0**（CHANGELOG 总条目 + MIGRATION 5f–5l）。
- 兼容矩阵 `docs/COMPAT.md` 加 v0.7 收官章节 + 逐行更新。
