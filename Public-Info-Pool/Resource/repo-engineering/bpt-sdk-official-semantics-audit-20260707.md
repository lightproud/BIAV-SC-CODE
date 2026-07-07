# bpt-agent-sdk 官方语义对齐审计（潜伏偏差全扫）

- **日期**：2026-07-07
- **触发**：守密人指出「thinking-signature 400 是一个案例,不是孤例」——之前「已对齐」的结论只覆盖了**类型/API 表面**,没覆盖**运行时语义**。本审计专找同类:代码看着对、happy-path 全过,只在特定运行条件下违反官方契约。
- **方法**：6 个只读审计子代理并行,各用官方契约当标尺扫一个语义域;返回后逐条对代码复核(file:line 均已验证),滤掉幻觉与已知 KEPT-DIVERGENCE。
- **审计对象版本**：main 0.14.0

---

## 0. 先说一个事故（审计副产品,已修复）

审计过程中,3 个子代理独立发现 **thinking-signature 修复的源码不在 main**——只剩编译出的 `.d.ts`,`src/engine/thinking-provenance.ts` 缺失、loop 逐字重放。追查:**PR #505 因 pre-push 钩子 rebase 与复用分支的交互,推送的分支不含实际提交 → 合并了空 diff**;#506 随后只把版本号刷成 0.14.0,使 main **标称 0.14.0 却无修复代码**。已从 reflog 恢复完整提交、经 PR #507 重新落地,并**验证 main 源码现确含该文件 + loop 已接线**。教训:squash 合并后必须验证 main 真有代码,不能只信「merged」回执。

> 小学生比喻:快递单显示「已签收」,但箱子是空的——中转站把货漏了、单子照打。得开箱验货,不能只看签收短信。

---

## 1. 确认级发现（CONFIRMED,file:line 已复核）

| # | 发现 | 位置 | 官方契约 | 偏差后果 | 严重度 |
|---|------|------|----------|----------|--------|
| C1 | **1h 缓存写按 5m 价计** | `engine/pricing.ts:19,26-28,37` | 缓存写 5m=1.25×、**1h=2×** | `cacheWrite` 硬编码 5m 价、`estimateCostUsd` 不收 ttl → 1h 写**少算 ~37.5%**;该估值又驱动 `maxBudgetUsd`(loop.ts:1111)→ **可冲破预算上限** | 高 |
| C2 | **`cache_creation` 1h/5m 明细被丢** | `types.ts` `Usage` / `pricing.ts:57` `normalizeUsage` | API 返回 `cache_creation:{ephemeral_1h/5m_input_tokens}` | 只留扁平字段,明细在 normalize 时丢弃 → 即使补价表也无从按 ttl 计(C1 的根因) | 高 |
| C3 | **`fable` 别名解析成 Sonnet 5** | `subagents/agents.ts:193` `fable:'claude-sonnet-5'` | fable 应解析到 Fable 家族(`claude-fable-5`) | 任何 `model:'fable'` 的子代理**静默跑在 Sonnet 5** 上——错模型、错价、错能力,无 400 | 高 |
| C4 | **`pause_turn` 被当完成丢弃** | `engine/loop.ts:1082-1085`(无 pause_turn 分支,全文 0 处) | `pause_turn`=长回合被暂停,须把部分内容回传**续跑** | 非 tool_use 即落自然结束臂 → 只把**部分内容**当 `success` 返回并终止,剩余工作静默丢失 | 高 |
| C5 | **`refusal` 被当正常 success** | `engine/loop.ts:1039,1375`(无 refusal 分支) | Fable5/新模型安全拒答返 200 + `stop_reason:refusal`,须先判 stop_reason 再读内容 | 拒答被当 `is_error:false` 的正常答案;结构化输出模式下更会把空拒答当 schema 失败**反复重试烧预算** | 高 |
| C6 | **`max_tokens` 中途截断 tool_use → 落库不配对** | `loop.ts:1082-1085` vs `:1392` `pushAssistant` | 每个 tool_use 须有配对 tool_result,否则 400 | stop_reason=max_tokens 但含完整 tool_use 时,不执行也不配对却入库 → **同会话下一轮请求 400**(resume 有 repairPairing 兜、活跃续写无) | 高 |
| C7 | **压缩 API 摘要跨模型带 thinking → 静默永不生效** | `engine/compaction.ts:482,487` | 同 thinking 跨模型规则 | `summaryModel` 是不同模型(设计如此,如 Haiku),prefix 含本模型签的 thinking → 摘要请求 400 被 catch 吞掉、每次静默退回确定性折叠 → `useApiSummary` 配了不同模型时**从不工作**。**注:本条我的 thinking 修复盖不到**(compaction 另建请求,不走 loop choke point) | 中高 |
| C8 | **resume 修复制造角色交替 400** | `sessions/store.ts:96-124` | 角色须严格交替,连续两个 user 报 400 | `repairPairing` pass1 丢掉中段未配对 assistant 后不重整交替 → `[user,user]`,治好孤儿 tool_use 又造出交替 400 | 中 |
| C9 | **结构化输出从不上 `output_config` 线** | `engine/structured-output.ts` 全模块 / `query.ts:718` | 现行 `output_config:{format}` + `messages.parse()` 服务端保证 | 改用系统提示注入 + 本地宽松校验,线上无 schema 保证;**且 COMPAT.md:273 标 FULL = 过度声称** | 中 |
| C10 | **`tool_choice`/`disable_parallel_tool_use` 无线支持** | `internal/contracts.ts:54`(StreamRequest 无)、全 src 0 命中 | 请求可带 tool_choice{auto/any/tool/none} 等 | 无法强制/禁止工具调用;能力缺口(非 400) | 中 |

## 2. 疑似级发现（SUSPECTED,需触发条件或数据相关）

| # | 发现 | 位置 | 说明 |
|---|------|------|------|
| S1 | 非规范 model id 成本算 $0 → 预算上限静默失效 | `pricing.ts:38-46` | Bedrock/Vertex(`us.anthropic.…`)/3.x id 不匹配三前缀 → 全程成本 0、`maxBudgetUsd` 永不触发。取决于平台是否回显规范 id |
| S2 | `citations_delta` 被静默丢弃 | `accumulator.ts:89-114`(无 default) | 带引用的文本组装丢 citations;text 类型也无 citations 字段可落 |
| S3 | `partial_json += undefined` 污染工具输入 | `accumulator.ts:112` | 非规范网关发空 `input_json_delta` 帧 → 追加字面 `"undefined"` → 解析抛错。窄 |
| S4 | repairPairing pass2 / 空 text assistant 跳过 → 连续两 assistant / 两 user | `store.ts:154`、`loop.ts:1289+` | 特定 orphan 形状 / thinking-off 空回合下的交替破坏 |
| S5 | 上下文窗/价表按前缀「代盲」 | `context-window.ts:16`、`pricing.ts:25` | 一律 200k、Opus 各代同价、Fable 无价(算 0);估值用,偏保守但对新模型陈旧 |

## 3. 已解决 / 已核实正确（不必动）

- **thinking 跨模型重放**（setModel / fallback 两条路径）:已由本会话 0.14.0 修复覆盖(strip 每轮按目标模型跑)。**唯 C7 压缩路径未覆盖**。
- **thinking 请求参数门控**（adaptive on 4.6+、budget_tokens 仅 pre-4.6):`thinking-model.ts` **正确且当前**。
- **SSE 组装**（input_json_delta 延迟解析、signature_delta 按索引挂、message_delta 用量替换非累加、中途错误/ping/截断 salvage 丢未闭合块):accumulator **五轴皆稳**。
- **缓存线语义**（≤4 断点不越界、易变 `<env>` 排除出缓存前缀、5m 标记字节等同、缓存命中不双算):**sound**。
- **tool_result 配对/顺序/占位、空结果、fork seed 防连续 user、prefill 于 no-prefill 模型(从不 prefill)**:正确。

---

## 4. 建议（按「杠杆 = 影响×便宜」排序,待守密人示下）

**先修（便宜且高影响）**：
- **C3** `fable` 别名(1 行,改成 `claude-fable-5`)——静默换错模型,零成本修。
- **C4 + C5** `pause_turn`/`refusal` 分支——同一处 loop 停止原因判定加两个分支(pause_turn 续跑、refusal 走专门 result 而非 success)。用户可见故障。
- **C1 + C2** 1h 缓存计价——需给 `Usage` 补 `cache_creation` 明细 + `estimateCostUsd` 收 ttl。中等,但直接关乎钱与预算闸。

**次修**：C6(max_tokens 截断 tool_use 落库前先剥/占位)、C7(压缩 prefix 复用 stripStaleThinking)、C8(repairPairing 补交替重整)。

**评估后定**：C9/C10(结构化输出上 output_config、tool_choice 上线)属能力补齐,先把 COMPAT.md:273 的 FULL 过度声称改诚实标注;S1-S5 按触发面决定。

> 小学生比喻:这次不是「墙上没裂缝」,是「之前只检查了正面外墙,没看承重结构」。6 个工程师各查一个系统,查出 10 条确认裂缝——有的是刷层漆就好(fable 别名),有的是钱算错了(1h 缓存少收费),有的是特定天气才漏(refusal/pause_turn)。全列在图上,守密人点哪条先补。

## 附:复核锚点

pricing.ts:19/26-28/37-54 · types.ts Usage · subagents/agents.ts:193 · loop.ts:1082-1085/1039/1375/1392 · compaction.ts:480-502 · sessions/store.ts:96-163 · accumulator.ts:89-114 · structured-output.ts · internal/contracts.ts:54 · context-window.ts:16 · COMPAT.md:273
