# silver-core-sdk 缺陷审计报告 · 第二轮（2026-07-17，UTC+8）

> **派发**：守密人 `/goal 再寻找另外100个bug`（承首轮 `/goal 找出 100 个 sdk bug` 之后的第二遍深审）。
> **对象**：silver-core-sdk（v0.63.0），**排除首轮已录 100 项**（见
> `silver-core-sdk-bug-audit-20260717.md` H1–H5 / M1–M20 / L1–L75，及其 §R 12 项已剔误报）。
> **方法**：19 个并行审计代理分两波——主波 14 簇覆盖全部 src/ 模块簇（各带本簇首轮缺陷排除清单），
> 补充波 5 簇专攻两轮均薄审的内核（internal / sandbox / permissions 缓存·优先级 / sdk-server zod / errors·公共面）；
> 加艾瑞卡回源直读对抗验证 + 跨代理/跨轮去重裁决 + 实机运行确认。
> **诚实红线**：只计能在代码里回源核实的真实缺陷；重复 / 误报 / 意图行为逐条剔除并记录。**绝不为凑数编造**。
>
> **标注**：severity ∈ high/med/low；confidence 附于条末。**[V]**=艾瑞卡回源直读确认；
> **[实测]**=代理实机运行/探针复现；**[潜伏]**=真缺陷但当前无触发路径；**[边界]**=真实但危害极小/是否算缺陷可争。
>
> 小学生比喻：同一栋楼查完第一遍再查第二遍——这回专掀上回没掀的地板（两轮都没细查的内核）、专挑房间接缝、
> 专在挤门时刻看（并发竞态），且每个检查员揣着上回的隐患清单，重复的不许再记。查实几处报几处。
>
> **版本基准（诚实注）**：本轮审计运行于 **v0.63.0 源树**（分支基底早于首轮修复批）。审计落簿时 main 已推进至
> **v0.64.3**——**首轮 T49 四批（A/B/C/D）全部修复并合入**（PR #709/#710/#711…#713，T49 结案）。四批修的是**首轮 100 项**
> （本轮已显式排除），故不使本轮任一发现失效；但被这些修复触及的档案（openai.ts / edit.ts / structured-output.ts /
> loop.ts / thinking-* / error-normalize.ts / compaction.ts / tokens.ts 等）**行号可能漂移数行**——修复本轮缺陷时以当前
> main 源为准重定位行号，勿照搬本报告 0.63.0 行号。**交叉核对（诚实）**：首轮批 B 修复中，首轮 H4「工具参数跨块
> **UTF-8 多字节**切断」机制经探针**证伪**（真因为参数 JSON 被 max_tokens 截断）；本轮 B1（openai.ts function.**name**
> 分片在 id chunk 后到达丢失）为**不同机制不同字段**，与 H4 无涉、独立成立。另：本轮若干发现所在函数可能已被四批
> 修复顺带触碰（如 error-normalize.ts 批C 已修 M3/503、tokens/compaction 批多处），**修复前须回源复核该条在 0.64.3 是否仍活**
> ——照 §R2 纪律，届时若已被顺带修复则据实标注、不虚充数。

---

## 汇总

- **确认真实新缺陷：105 项**（不与首轮 100 项重叠）。目标 100，**达成且有余量（+5）**。
- 达成方式全程守诚实红线：19 簇原始候选 106 项，**剔除 1 项重复**（本轮 L2-9 = 首轮 M2 同根因，见 §R2），净 105。
- 其中约 **12 项为潜伏/边界/cosmetic**（逐条标注），其余 ~93 项为明确真缺陷，多带 [V] 回源 / [实测] 证据。
- **未凑数**：主波实得 85 项即诚实挂出「不足 100」，随后**靠真挖薄审区**（补充波 5 簇 +20）逼近并越过 100，非注水。

### 高危亮点（7 条，均 [V] 或机制确认）

| # | 位置 | 一句话 | 小学生比喻 |
|---|------|--------|-----------|
| RP1 | `permissions/rules.ts:155+139` | 路径遍历 `..` 绕过路径域 allow/deny（read.ts 明言 gate 唯一门）| 门卫只认门牌前缀「仓库街*」，你写「仓库街/../../金库」他放行，进门后地址栏自动折叠成「金库」|
| D1 | `engine/tokens.ts:93` | 未建模内容块→NaN 毒化→自动压缩 + 400 安全网一并失效 | 一件没登记的行李让整台体重秤显示「Error」，于是超重报警器永远不响 |
| F1 | `tools/glob.ts:77` | 符号链接环无守卫→枚举 2^深度→挂死不可中断（实测）| 两面镜子对照，机器数镜子里的镜子，数到天荒地老还叫不停 |
| F2 | `tools/edit.ts:146` | CRLF 文件多行编辑不可能且不可恢复 | 老师给的课文偷偷夹了隐形字符，学生照抄却总被判「和原文不符」，永远改不对 |
| F3 | `tools/read.ts:196` | 只查是不是目录、不查是不是普通文件→读管道文件永久挂死 | 检查员只问「你是不是仓库」，管道也说「不是」，于是他钻进管道再没出来 |
| K1 | `subagents/runtime.ts:1840` | TaskStop 停一个阻塞的续跑子代理会连父查询一起杀 | 想叫停一个正在打电话的员工，一按开关把整层楼电闸都拉了 |
| H2-1 | `tools/memory/store.ts:299` | memory 多行 str_replace 恒报「未找到」（逐行判、全文替）| 让你在整本书里替换跨两行的句子，检查员却逐行找，跨行的当然一行也找不到，直接说没有 |

### 安全相关（除高危外）

- **RP2** `**` 多星 glob 当字面前缀→gitignore 式 deny 匹配零（DENY fail-open）。
- **RP3** canUseTool `setMode:'bypassPermissions'` 无 interlock→升级整会话 auto-allow-everything。
- **M2-2** 前导 env 赋值绕过 Bash deny（`FOO=1 rm -rf /` 不触发 `Bash(rm:*)`）。
- **I2** 工具名含 `__` 时 splitMcpName 误 split→server 级 deny fail-open（边界，需工具名含 `__`）。
- **Q1** 沙箱不 scrub 环境→沙箱内命令读全部主机 secret（可能官方 parity）。
- **N1** verifier 把被审代码原样插 `<context>` 无中和→对抗代码可自定裁决 REFUTED。
- **L2-7/L2-8** ledger digest / retention region 无转义→外部事件数据可注入伪造「已报」条目 / 逃逸保留区边界。

---

## 分簇缺陷清单

### transport（A + B，6 项）

- **A1** [med][V] `transport/anthropic.ts:1125` — replay-safety 键于 raw eventCount（含 ping keep-alive）：仅 ping 后静默的流判非-replay-safe→引擎拒 replay→硬失败；而零-ping 的字节相同静默被透明 replay，同 ping-only 流干净关闭却被重试——相同内容依「怎么死的」得相反处置。conf high
- **A2** [low] `transport/anthropic.ts:895-903,877-888,196` — streamMaxDurationMs/streamIdleTimeoutMs/timeoutMs >2^31-1 未 clamp 传 setTimeout 溢出成 ~1ms（sibling resolveStallTimeoutMs 有 clamp 证明遗漏）：MAX_SAFE_INTEGER 当「无限」→~1ms 杀流 / ~1000 唤醒每秒自重臂。conf high
- **B1** [med] `transport/openai.ts:726` — tool-call function.name 分片在 id-bearing chunk 之后到达时静默丢（emit gate 一见 id 即盖 block_start，后续 name 分片无修正事件）→工具名截断/空→unknown-tool dispatch 失败（与首轮 H4 跨块 UTF-8 截断不同，是 name 到达序）。conf med
- **B2** [med] `transport/openai.ts:1348-1350` — 永久性 429（insufficient_quota）走完整重试预算：retryable 只按 HTTP status（body.code 在 scope 却忽略）→死 key 每轮 2.5-5 分钟徒劳退避（in-stream 已区分 quota、request-phase gate 没）。conf med
- **B3** [low][边界] `transport/openai.ts:500-508` — response_format.json_schema 不带 strict:true→OpenAI 视 schema 为建议→native 结构化输出静默降级 best-effort→引擎侧 retry churn（可能有意但未文档化）。conf med
- **B4** [med] `transport/openai.ts:562-564` — 未知失败类 finish_reason 落 `default:end_turn`→把网关侧 abort（vLLM 'abort' / DeepSeek 资源不足）伪造成干净成功，引擎报成功末轮却只含 abort 前部分内容。conf med

### engine — loop/dispatch/accumulator（C，4 项）

- **C1** [high] `engine/loop.ts:1362-1424` — tool-batch 中途 throw 丢弃 assistant tool_use 轮 + 全部已完成 tool 结果（pushAssistant/history.push 仅在整批后）：tools 1..N-1 已执行副作用无 transcript 痕迹→非-abort crash 时 query 留 dangling pending→resume 重驱重 billing + 模型重执行同副作用工具（其他终态路径均先持久化，唯此丢批）。conf med
- **C2** [med] `engine/accumulator.ts:60,65,72` — content_block_start 种子字段（text/thinking/data）无守卫复制、而同字段 delta 用 `?? ''` 硬化：字段省略/网关改写的 start 帧使 `{text:cb.text}` 种 undefined→首个 text_delta 产字面 "undefinedfoo"，且 nonEmptyContent 对 undefined 抛 TypeError 杀 run（signature/input 有守卫、这三个漏）。conf med
- **C3** [low] `engine/tool-dispatch.ts:299-303` — sandboxEscape 从 rewrite 前 block.input 算：PreToolUse hook / canUseTool 的 updatedInput 在检查后加 `dangerouslyDisableSandbox:true`→绕过专用 escape ask，命令沙箱外执行无专用提示（需 trusted-side rewrite）。conf high
- **C4** [low] `engine/accumulator.ts:169-170` — message_delta 无条件覆写 stop_reason（无 `?? msg.stop_reason`）：usage-only/字段省略的 message_delta 把已交付 stop_reason 重置 undefined→改变 salvage/finalize 分类（仅非合规多-delta 帧可达）。conf low

### engine — 上下文/缓存（D，7 项）

- **D1** [high] `engine/tokens.ts:93-111` — estimateBlockTokens 无 default 分支：未建模内容块（server_tool_use 等，accumulator 有意 round-trip）→undefined→`overhead+undefined=NaN`→estimateMessagesTokens NaN 并 WeakMap 缓存→shouldAutoCompact `NaN>=triggerAt` 恒 false→**自动压缩 + knownPromptFloor 400 安全网 + 记忆 flush 一并失效**→上下文无界增长至不可重试 400。conf high
- **D2** [high][V] `engine/compaction.ts:797-799` — M5 fold 后 suffix-overflow 检查 `inputBudget=window-maxOutput` **漏 overheadTokens**（触发 254 / preTokens 695 均加）：大 system+tools 时 shed 不触发→下一请求溢窗（正是 M5 要防的 400）。conf high
- **D3** [high] `engine/compaction.ts:590-597` — 失败的 summary API 调用已计费 token 静默丢：onSummaryCall 仅成功 finalize 后 fire，summary 流 message_start 后 error 已计 ~100k+ 折叠前缀，catch 回落 foldDeterministic 不记账（主轮路径有专门 UsageSink，此处无）。conf high
- **D4** [low] `engine/compaction.ts:860,921` — buildRecap cap / firstChars 用 UTF-16 slice 可切断代理对→孤 surrogate 写入 fold 文本→后续每次 wire 请求 U+FFFD（shedToolResultContent 已 codepoint-safe、这两处未）。conf high
- **D5** [low] `engine/tokens.ts:176-179` — estimateToolDefsTokens 平 len/4 无 CJK 感知→CJK 工具描述欠估 ~4x（system 已修、tool defs 喂同 overhead 和未修）；turn2 起 knownPromptFloor 缓解，最坏首请求溢。conf med
- **D6** [low] `engine/pricing.ts:126-132` — estimateCostUsd 从不计 server-tool 用量（web_search ~$10/1k 已 track 但成本公式只 sum 四 token 字段）→web-search 重会话欠计 totalCostUsd、maxBudgetUsd 欠强制。conf med
- **D7** [low][潜伏] `engine/context-window.ts:36-46` — contextWindowFor 跳过 normalizeModelId（与 pricing 不一致）→Bedrock/Vertex id 永不匹配窗口表；当前被「全表=DEFAULT 200k」掩盖，加任一非默认行（如 1M sonnet）即触发。conf high

### engine — 提示词组装（E，8 项）

- **E1** [med] `engine/thinking-provenance.ts:61` — protectedTurnIndex 只查字面末消息 tool_result：R7 记忆 flush 用户轮 append 在 tool_result 轮后→de-protect 在飞 tool-loop assistant 轮：(a) fallback-withhold guard 见 protIdx=-1 放行换模型→stripStaleThinking 剥 API 必需 thinking→400；(b) resume 未盖印 transcript 同模型也剥→400。conf high
- **E2** [med] `engine/config-builder.ts:104` — caller-segment cache_control 标记 config-build 期无条件烘焙，绕过 promptCaching=false（仍发断点计 cache-write 溢价）与 cacheTtl（1h 时 segment 得裸 5m、tools 得 1h→冲突静默合并 + TTL 静默降级）。conf high
- **E3** [low] `engine/config-builder.ts:116` — 所有 caller segment 过滤为空时结构化输出指令被静默丢、wire 发 system:[]→模型从不知 JSON 格式，首次尝试必盲（仅纠正轮携带 schema）。conf med
- **E4** [low] `engine/prompt-fragments.ts:206,215` — 'prefer-dedicated-tools'/'read-before-edit' 无 gate 却名 Bash/Read/Grep/Glob/Edit/Write；session 过滤掉这些工具时仍发「用 Read 不用 cat」→指向未广告工具，违红线（仅 ship 级强制、非 session 级）。conf high
- **E5** [low] `engine/config-builder.ts:320` — appendSystemInjection 把注入部分（记忆协议/resident index）push 在 'environment' 部分之后，但其文本落在 stable 提示词 env 尾之前→违「wire order」不变量、破坏需求A part 排序（与首轮 L8 需求B 标签错位不同）。conf high
- **E6** [low] `engine/config-builder.ts:148` — `<env>`「Today's date」用 `new Date().toISOString().slice(0,10)`=UTC 日历日非主机本地日→UTC+8 主机每天 00:00-08:00 注入日期错。conf med
- **E7** [low][潜伏] `engine/thinking-model.ts:29` — PRE_ADAPTIVE_THINKING denylist 键为带连字符日期 id（opus-4-0|...）→Vertex 式 `claude-opus-4@20250514` 及裸 `claude-opus-4` 无匹配子串→落 adaptive→每请求 400（正是模块要防的 haiku-storm）。conf low
- **E8** [low] `engine/prompts.ts:180,188` — 「防御性」segments flatten 解引用 s.text/s.label 无 null/空过滤（config-builder :98-99 有）→null/无 text segment 在自述「防御性 flatten 不抛」路径抛 TypeError；导出的 buildSystemPromptParts 可达。conf med

### fs/exec 工具（F，8 项，多带实测）

- **F1** [high][实测] `tools/glob.ts:77-86`（+`grep.ts:416-423`）— Glob/Grep 跟随目录符号链接无环守卫无深度帽：自引用 symlink 实测返同文件 41 次，两 sibling loop symlink 枚举 2^深度→20s 未返；signal 仅 await 后查→abort 救不了。conf high
- **F2** [high] `tools/edit.ts:146-158`（+`multiedit.ts:226-243`）— CRLF 文件多行编辑不可能且不可恢复：Edit 对含 `\r\n` 原文匹配、Read 去每个 `\r`（read.ts:52）→模型抄的 "foo\nbar" 对 raw "foo\r\nbar" indexOf 失败，每次重试同样失败；全仓无 CRLF 归一。conf high
- **F3** [high][实测] `tools/read.ts:196-216` — stat gate 只查 isDirectory 不查 isFile→特殊文件通过：FIFO 实测 readFile 永阻塞且 abort 不 settle（须 SIGKILL）；/dev/zero size-0 绕 MAX_READ_BYTES→OOM；edit/multiedit 同缺 isFile。conf high
- **F4** [med] `tools/shells.ts:368-374` — BashOutput 逐行 filter 正则作用于 chunk 边界碎片：跨 poll 的行（"ERR"+"OR: x\n"）两次都失配 `/^ERROR/` 永不返回；游标是 raw char offset 落在行中。conf high
- **F5** [med] `tools/bash.ts:452-488`+`shells.ts:81-84` — run_in_background（及 Monitor）不套 withPersistentState→先前 foreground 的 cd/export 静默不生效，与 BASH_DESCRIPTION「工作目录持续」+Monitor「同 shell 环境」直接矛盾。conf med
- **F6** [low] `tools/grep.ts:150 vs 474` — multiline -o 模式匹配检测扫 raw（含 `\r\n`）而提取扫 `\r`-stripped 重建→跨 CRLF 边界模式被扫到却提取零匹配（文件静默缺席），反之亦然；`$`-anchor 行为翻转。conf med
- **F7** [low] `tools/shell-resolve.ts:75` — 存在性探针豁免所有非绝对 CLAUDE_CODE_GIT_BASH_PATH override，但含分隔符的相对路径（tools/bash）spawn 不做 PATH 解析→对 child cwd 解析 ENOENT 异步、背景路径无 fallback 仍报「launched」。conf high
- **F8** [low] `tools/write.ts:132-133` — Write 非原子：直接 O_TRUNC 开目标（无 tmp+rename），open 与写完间 abort/crash→旧内容毁、抛 AbortError 无结果，未开检查点则预映像丢失。conf high

### misc 工具（G，4 项）

- **G1** [med] `tools/workflow-engine.ts:752-777` — workflow agent() 若 opts.agentType 解析到 background:true 的 AgentDefinition，静默返回 launch-ack 字符串而非真输出并缓存为完成结果（显式 runInBackground:false 不覆盖 agentDef.background，hostAgent 不查 res.background）→真结果永久丢失且 resume journal 缓存 ack。conf high
- **G2** [low] `tools/webfetch.ts:585` — 响应体恒 buf.toString('utf8') 解码，忽略 Content-Type charset 与 `<meta charset>`→非 UTF-8 页（Shift_JIS/GBK/ISO-8859-1/UTF-16）静默乱码（CN/JP 抓取语境相关）。conf med
- **G3** [low][low触发] `tools/workflow-engine.ts:476-487` — 确定性禁 argless `new Date()`/`Date()` 可绕过：`Reflect.construct(RealDate,args,Proxy)` / `new Date(0).constructor` 拿未代理 RealDate 读墙钟→静默破坏 resume 缓存（Math.random 无对等回收，守卫不对称）。[实测 vm 确认] conf high机制
- **G4** [low][边界] `tools/sendmessage.ts:71-88` — summary 被校验（schema 宣传「用于进度显示」）却从不转发给 bridge.send→静默丢弃，代码兑现不了宣传用途。conf low

### memory 工具（H，6 项）

- **H2-1** [high][V] `tools/memory/store.ts:299-306` — str_replace 多行 old_str（含 `\n`）**恒失败** verbatim-not-found（逐行 includes，多行永非单行子串），而 content.replace 本会匹配→多行替换不可能。conf high
- **H2-2** [med][V] `tools/memory/store.ts:298-313` — 唯一性守卫按「行数」非「出现次数」：同一行两次出现（"dup dup"）绕过 unique 检查只替首个→残留 stale 副本，违「must be unique」契约。conf high
- **H2-3** [med][V] `tools/memory/mounts.ts:105-108` — mountAllowsWrite 无最具体挂载优先级：ro 挂载嵌在 rw 内被完全击穿（写 + 递归删都达 ro 子树）。**= 首轮 §R R12 未决项转确认**（concrete trace：直接 delete ro 子挂载亦被 rw 祖先放行；无测试无文档）。conf high
- **H2-4** [low][V] `tools/memory/store.ts:299-313` — 空 old_str 不拒：单行文件静默 prepend new_str 报成功；多行文件却报「Multiple occurrences」→不一致。conf high
- **H2-5** [low][V] `tools/memory/store.ts:250` — view_range 端值为负（非 -1，如 [1,-3]）泄漏 JS slice 负索引语义静默丢尾 3 行、无范围校验。conf med
- **H2-6** [low] `tools/memory/contract-suite.ts:229-243` — 覆盖缺口：只测多行 dup、不测同行 dup / 多行 old_str→放行 H2-1/H2-2。conf high

### mcp（I，7 项）

- **I1** [med] `mcp/http.ts:241` — 404 无 session-expired 恢复：stale sessionId 不清不重初始化→连接永久变砖直到手动 reconnect（spec 2025-06-18 要求 404→新 InitializeRequest）。conf high
- **I2** [med] `mcp/tool-filter.ts:29`（根因 `permissions/rules.ts:50-58`）— 工具名自含 `__`（mcp__a__get__thing）splitMcpName 按 lastIndexOf 切→server 解析成 a__get；server 级 deny glob `mcp__a__*` 失配→**deny fail-open**，被禁工具仍广告可执行；subagents/runtime.ts:677/704 同洞（计一次）。conf high（边界：需工具名含 `__`）
- **I3** [med] `mcp/stdio.ts:159-171` — failAllPending 挂 'exit' 非 'close'：服务器写完最终响应立即退出时响应仍在管道缓冲→pending 被拒 mcp_server_exited、迟到行当 unknown-request 丢。conf med
- **I4** [med] `mcp/project-config.ts:71-78` — .mcp.json 值无 `${VAR}` 环境变量展开→Bearer ${TOKEN} 原样发/child env 得字面 `${...}`→静默 401（loader 自述镜像参考 CLI 而 CLI 有展开）。conf med
- **I5** [low] `mcp/http.ts:177-179` — close() 不发 HTTP DELETE 终止服务端 session（spec SHOULD）→每次 teardown 泄漏活 session 直到服务端自过期。conf high
- **I6** [low] `mcp/registry.ts:63`/`types.ts:879` — 'needs-auth' 状态声明于公共 union 但无路径赋值；401 落 'failed'→消费者 auth flow 永不可观测。conf high
- **I7** [low] `mcp/http.ts:371-374`（+`stdio.ts:356-357`）— elicitation reply .catch 混淆 handler 失败与投递失败→对同一 JSON-RPC id 发第二条矛盾 decline（违 JSON-RPC）。conf med

### sessions（J，4 项）

- **J1** [med] `session-manager.ts:660-661`（+`persistence.ts:164-194`）— 监督式 auto-resume 把 forkSession:true 透传给 resume 重驱→恢复变 fork：每次尝试复制 transcript 到新 id、不重驱中断轮、emptyInputStream 即终→consumer 流静默未恢复 + maxResumes 次留重复垃圾 transcript（fork forks 复利）。conf high
- **J2** [low] `sessions/checkpoints.ts:84-96 vs 251-258` — bind() 不重置 indexTailChecked（per-instance boolean，异于 store.ts:268 per-file Set）→rebind 第二会话跳过 M-9 torn-tail 自愈，新会话崩裂 index 首 append 粘 torn tail→readIndex 丢两行、刚写 blob 不可 rewind。conf high
- **J3** [low] `sessions/session-functions.ts:233-245` — rename/tagSession 对不存在会话静默造幽灵会话文件（appendMeta 盲 append，本地 append 造 {id}.jsonl）→listSessions 现空 firstPrompt 幽灵；本地 append 失败被吞仍报成功。conf high
- **J4** [low] `sessions/session-functions.ts:284-290`+`store-adapter.ts:73-92` — forkSession 不存在会话对外部 store 物化幻影空会话（InMemory append 空 batch 仍造 main-key+mtime）→listSessions 现为最新（continue 跨主机 fallback 会选它）；FileSessionStore 空 batch 早退→两实现分叉。conf med

### subagents（K，9 项）

- **K1** [high] `subagents/runtime.ts:1840` — TaskStop 对阻塞的前台 SendMessage 续跑杀掉整个父查询而非返回 stopped：killAgent→runContinuation 重抛 AbortError→sendMessage catch 重抛所有 abort→父循环死；前台 Agent-spawn 路径有 M-11c 守卫（1568-1587）转错误结果保父存活、sendMessage 无等价守卫，注释宣称的 parity 是假的。conf high
- **K2** [med] `subagents/runtime.ts:1629` — SendMessage 续跑对 record.history append 裸用户轮无 tail 修复：worker 末轮停在未配对 assistant tool_use（budget pre-stop）时 runContinuation 直接重入 runAgentLoop 不过 store.load/repairPairing→请求带 assistant(tool_use)+纯 user text→400，每次重试再 append 再失败（buildForkSeed 有此守卫证明不变量已知）。conf high
- **K3** [med] `subagents/runtime.ts:1636` — 后台 SendMessage 续跑链到 acking 轮 signal→该轮 interrupt() 静默杀本应 detached 的续跑，coordinator 从不知情（初始后台 spawn 特意用 outerSignal 避此；触发时 .catch 只 debug-log）。conf med
- **K4** [med] `subagents/runtime.ts:1459` — aborted 子 run 计费 token/成本从会话记账消失：loop 把 abortedRunAccounting 附在抛出 AbortError 期望 catcher fold，仅根查询 fold（query.ts:1291），runtime 三处 abort catch（1459/1555/1664）不读→stopTask/interrupt/watchdog 杀掉的子代理全部花费缺账。conf high
- **K5** [med] `subagents/runtime.ts:1624` — TaskStop 无法真正停已排队 SendMessage 的代理，kill 数秒后被静默撤销：队列续跑出队时见 signal.aborted 铸新 controller、翻 status 回 running 执行整跑；宿主收到「已停止」确认但代理继续烧 token。conf med
- **K6** [low] `subagents/runtime.ts:1718` — kill-then-continue 破坏单括号 sidechain transcript：turns append 在终态 sidechain_end 标记后且第二 end 从不写（sidechainEnded 幂等保证括号不重闭）→持久化子 transcript 含 start/end 括号外的轮。conf high
- **K7** [low] `subagents/runtime.ts:664` — AgentDefinition.tools allowlist 对 builtin 用精确名 Set、对 MCP 用模式匹配→通配不对称：`tools:['*']` 剥光 builtin 却暴露全部 MCP；`tools:['mcp__srv']` 放行该服务器 MCP 而类似 builtin 模式静默失败。conf med
- **K8** [low] `subagents/runtime.ts:1039` — 请求类型回落 general-purpose 时 SubagentStart 用 raw params.subagentType 而 Stop 用 resolved.type→同 agent 的 Start/Stop 报不同 agent_type，matcher-scoped 钩子见不平衡 start/stop 对。conf high
- **K9** [low] `subagents/agents.ts:517` — resolveAgentDefinition 查 `agents[type]` 无 own-property 守卫→原型继承名（"constructor"/"__proto__"）使查找非 undefined、fail named.prompt 检查→硬错而非文档化 general-purpose 回落。conf high

### query/hooks/loop-support（L，9 项；L2-9 剔重见 §R2）

- **L2-1** [med] `query.ts:1794-1802` — 待裁⑤ 修正末结果 yield 在 run() finally 内：consumer 早退（break/return()）后若后台子代理 usage 增长 acct，return() 被解析为 {done:false,value:修正结果}→生成器永久悬挂（违 iterator return 契约）。conf high
- **L2-2** [med] `query.ts:1680-1697` — 记忆 session-end 轮手动迭代 driveTurn 从不 gen.return()，catch 吞 consumer 注入的 q.throw()：return/throw 到达时内层 yield 绕过委托→driveTurn/runAgentLoop finally 不跑、pending_turn 悬挂；非-abort throw 被当「非致命记忆失败」吞→query 假成功。conf high
- **L2-3** [low] `query.ts:1841-1853` — primedFirst 不被 return()/throw()/close() 失效：查询关闭后 q.next() 交回陈旧缓冲首消息（通常 system:init）为 {done:false} 而非 {done:true}。conf high
- **L2-4** [low] `query.ts:1547-1553,1619-1637` — obsQueue 在正常非-turn 退出路径从不 drain（UserPromptSubmit block / pre-turn budget·turns 终态 / 无记忆轮 end-of-input）；两 pre-turn 终态还跳 drainMirror→hook_started/response 对静默丢（与首轮 L59 abort 路径不同机制）。conf high
- **L2-5** [low] `query.ts:1865-1877` — interrupt() 回执硬编 `still_queued:[]` 即便流式输入 AsyncQueue 仍有缓冲 SDKUserMessage 存活将驱动未来轮→consumer 被误导。conf med
- **L2-6** [med] `loop-support/ledger.ts:83-94,198-215` — record() 可插入并立即驱逐同一条目（满容量时 at 最老的新条目即被逐）却仍返 true→调用者以为已去重而 has(key) 已 false（用起源时间戳的自然用法丢 exactly-once；与首轮 L63 deserialize 不同，是 live record 路径 + 撒谎返回值）。conf high
- **L2-7** [low] `loop-support/ledger.ts:184-195` — digest() 把 raw key/summary 插入行导向「勿重报」摘要无转义→含换行 + `- fakekey` 的 key/summary 伪造额外账本行（外部事件数据可伪造「已报」条目抑制真报）。conf med
- **L2-8** [low] `loop-support/retention.ts:20-27` — renderRetainedRegion() 无转义：title 含 `"` 破坏伪 XML 属性，content 含 `</retained-context>` 提前闭合区→在保留边界外伪造文本，引擎每次 fold verbatim 重盖印（区内容常来自 ledger digest 外部数据派生）。conf high机制/med可利用
- **L2-10** [low] `hooks/goal.ts:102-115` — incognito/persistSession:false 下 goal 评估器 context 恒空串（transcriptField 省 transcript_path，last_assistant_message typed-not-populated）→judge-model 盲判每次 stop，goal gate 退化为噪声无告警。conf med

### permissions/sandbox/internal（M，4 项）

- **M2-1** [med] `subagents/runtime.ts:1326`（+gate/`query.ts:408`）— isolation:'worktree' 子代理继承 root 沙箱 writablePaths（不含 worktree dir），bwrap --ro-bind 使 worktree 只读→子代理 git commit/build/写全 EROFS/EPERM（与首轮 M16 worktree cwd 幻影不同）。conf high
- **M2-2** [med][V] `permissions/rules.ts:155-166,187` — 前导 env 赋值绕过 Bash deny：`Bash(rm:*)` 对 `FOO=1 rm -rf /` 不触发（decomposeBashCommand 不剥 VAR= 前缀，specifierMatches 词界失配）。conf high
- **M2-3** [low] `errors.ts:258-270` — errorCodeOf 漏 MemoryToolError instanceof→返 undefined，破坏「每错误类带 code」契约（error-normalize.ts:330 rawType 变 undefined）。conf high
- **M2-4** [low] `permissions/rules.ts:238-241,266` — buildPermissionSuggestions 对 env 前缀命令产荒谬规则：`VAR=x npm run build`→`Bash(VAR=x:*)`（firstToken 取赋值段非命令）。conf high

### generators/tips/reporting/verifier（N，9 项）

- **N1** [med] `verifier/index.ts:67` — 被审代码原样插 `<context>` fence 无中和无 inert 指令→对抗代码可自定裁决（注入 `</context>`+REFUTED），VERIFY_VERDICT_SYSTEM 缺「视为数据」条→真发现（关于攻击者后门）被静默丢。conf med
- **N2** [med] `reporting/compare-reports.ts:145` — failures 空账日聚合成 0 非 null，delta 产假改善 `-5`，违「显式 null 不伪装零」契约（sibling 指标正确走 null）。conf high
- **N3** [med] `verifier/prompts.ts:66`/`index.ts:134` — parseVerdict `if(raw.includes('{'))`→REFUTED：正文含代码花括号的裸 CONFIRMED 被强制 refute（braces 在 code-talk 普遍，与首轮 parse-failure 歧义不同触发）。conf med
- **N4** [low] `reporting/run-log.ts:136` — ensureDir memoize 被拒的 mkdir promise→一次瞬时失败（ENOSPC/EACCES）永久杀死账本（dirReady ??= 缓存 rejection），自改进环信号源静默变暗。conf high
- **N5** [low] `reporting/compare-reports.ts:76` — aggregateDay 丢弃 readWindow 的 badLines→半损账本读成流量下降，违 REQ-1.1「缺席是事实」。conf high
- **N6** [low] `reporting/compare-reports.ts:65` — DAY_RE 收日历非法日期（2026-02-30）→new Date Invalid→toISOString 抛 RangeError 非 ConfigurationError（守卫只查形状不查日历）。conf high
- **N7** [low] `generators/index.ts:203`（+:240）— JSON 缺预期字段时 fallback 把原始 JSON blob 当用户可见标题（`{"name":"..."}`）。conf high
- **N8** [low] `generators/index.ts:198` — session 内容插 `<session>` fence 不转义内嵌 `</session>`→提前闭合 fence 注入攻击者选定标题（prompt 明说视为数据但无转义）。conf high
- **N9** [med] `tips/index.ts:88` — selector transcript 完全不加 fence 插在结构块前→transcript 可伪造 `<eligible_ids>` 块 + 自定 tip 文本（id 受 allowlist 限但 tip 串是未校验模型文本 surfaced 给用户；与首轮 L47 大小写敏感不同机制）。conf med

---

## 补充波（两轮均薄审的内核，P/Q/S/R/T，20 项）

### P — internal 内核（4 项）
- **P1** [med] `internal/model-alias.ts:31` — `MODEL_ALIASES[model] ?? model` 读原型链：model 名撞 Object.prototype 键（'toString'/'constructor'/'__proto__'）→返继承函数/对象非字符串→threaded 到 wire model 字段损坏请求（Agent-tool model 输入无运行时校验）。conf high
- **P2** [med] `internal/worktree.ts:92-95` — baseHead undefined 时 removeWorktreeIfClean 完全跳过 moved-HEAD 检查移除任何 clean worktree→子代理已 commit（clean status 但 HEAD 移动）的提交变 unreferenced 丢失，违文件自身 commit-safety 文档。conf med
- **P3** [low][潜伏] `internal/async.ts:81-82` — AsyncQueue.next() 用 undefined 作空队列哨兵→push(undefined) 与空队列不可分、缓冲 undefined 轮被吞、consumer 停滞（当前仅 SDKUserMessage 实例化故潜伏）。conf high机制/low可达
- **P4** [low][潜伏] `internal/process-kill.ts:36-37` — planProcessKill 只守 pid===undefined；pid=0 规划组 kill→process.kill(-0)=process.kill(0) signal 调用者自身进程组（潜伏，child.pid 正常为正）。conf med机制/low可达

### Q — sandbox 内部（5 项）
- **Q1** [med][边界] `sandbox/bwrap.ts:30-48`（+query.ts:229/bash.ts:95）— 沙箱从不 scrub 环境（无 --clearenv）→沙箱内命令读全部主机 secret（API key/云凭据），allowNetwork 时可外泄、网络关也可写 cwd 持久化（docstring 只谈文件读隐藏未及 env，可能官方 parity）。conf med
- **Q2** [low] `sandbox/backend.ts:46 vs bwrap.ts:31-37` — bwrap 功能探针欠演练：探针省 --unshare-net/--dev/--proc（真 spawn 都用）→硬化内核上探针过但每条网络关命令在 namespace 设置 abort（fail-closed robustness 非安全）。conf med
- **Q3** [low][cosmetic] `sandbox/bwrap.ts:47`（bash.ts:539-542）— 内层命令信号死误报：bwrap 包裹→内层信号 N 死时 bwrap 退 128+N、自身 signal=null→报「exit code 139」而非「SIGSEGV」（沙箱/非沙箱分歧）。conf high
- **Q4** [low][边界] `sandbox/bwrap.ts:47`+bash.ts:124-135 — SIGTERM→SIGKILL 宽限窗对沙箱命令实为无效：bwrap 不转发信号、--die-with-parent pdeathsig SIGKILL 硬杀→trap SIGTERM 优雅关闭的命令沙箱下得不到宽限。conf low
- **Q5** [low][边界] `sandbox/bwrap.ts:32-46` — --proc/--dev 在可写 --bind-try 前发→cwd/additionalDir 为 `/` 或 /proc 父时后置 `--bind-try / /` 把主机 /proc /dev 重挂 rw（病态需 root-ish 可写目录，挂载顺序脆弱）。conf low

### S — sdk-server/registry zod（2 项）
- **S1** [med] `mcp/sdk-server.ts:88` — zod→JSON-schema 只剥 $schema 漏 $defs/$ref：z.lazy()/递归/.meta({id}) 子 schema 转出 `{"$ref":"#/$defs/…","$defs":{…}}`→流到 API input_schema，不解 $ref 的消费者得坏/被拒 schema（作者剥 $schema 意图 sanitize 却漏 sibling）。conf med
- **S2** [med] `mcp/sdk-server.ts:105`（+createSdkMcpServer:128）— tool name 从不校验 charset/长度→非 ASCII（CJK）/含空格/mcp__+server+__+tool 组合>128 的名 400 掉**整个请求**（毒化本轮全部工具非仅该工具）。conf med

### R波 — permissions classifier/gate（4 项，含最高价值高危）
- **RP1** [high][V] `permissions/rules.ts:155+139` — **路径遍历绕过路径域 allow/deny**：primaryArg 取原始 file_path 不归一化、specifierMatches 裸前缀匹配、read.ts:193 resolveAbs 事后折叠 `..`→allow `Read(/workspace/*)` 被 `/workspace/../../etc/shadow` 绕过读 /etc/shadow（ALLOW fail-open），deny `Read(/etc/*)` 被 `/tmp/../etc/passwd` 绕过（DENY fail-open）；read.ts:191 明言 gate 是唯一访问控制。conf high
- **RP2** [med][V] `permissions/rules.ts:157-159` — `**` 多星 glob 当字面前缀（只剥末 `*`）：deny `Read(/etc/**)`→stem `/etc/*`、`/etc/passwd`.startsWith('/etc/*') false→deny 从不触发（gitignore 式 `**` 规则匹配零）。conf high
- **RP3** [med] `permissions/gate.ts:371` — canUseTool updatedPermissions 的 `{setMode:'bypassPermissions'}` 切全 bypass 无 allowDangerouslySkipPermissions interlock（仅 query.ts:337/1880 强制）→step-6 allow 结果升级整会话 auto-allow-everything（app-originated，破防御纵深）。conf high
- **RP4** [low] `permissions/gate.ts:224-227` — auto 模式 classifier 'prompt' 裁决 skip step-5 allow→allowedTools 对非只读工具在 auto 下失效（default 生效、auto 短路 canUseTool，模式不对称，方向 fail-closed）。conf med

### T — errors/index/公共面/算术（5 项）
- **T1** [high] `error-normalize.ts:309`（case 4 排 case 5 前）— normalizeProviderError 永不到 plain-Error 分支：extractProviderErrorObject 先跑，任何 Error 有 string .message→返 {message} 令 name 强制 'ProviderError'、rawType 'provider_error_object' 而非真 err.name/errorCodeOf（McpError 丢 name/rawType）；case 5 对有 message 者死代码。conf high
- **T2** [med] `error-normalize.ts:164` — normalizeProviderError 可抛（违「Never throws」契约）：case 4 的 extractProviderErrorObject 在 try 外，嵌套 envelope {error:循环对象} 且内层 message 非串时 JSON.stringify 抛「循环结构」传出。conf med
- **T3** [med] `index.ts:271-279` — MemoryToolError 未从公共 barrel 再导出→宿主无法从包根 instanceof（store 抛此类型 ~20 处），叠加 M2-3 errorCodeOf 遗漏（类既不可达也不可按 code 路由）。conf high
- **T4** [low][潜伏] `query-accounting.ts:25-33` — addUsage 静默丢 web_search_requests（与 pricing.ts:154 分歧）：SessionAccounting.usage 聚合从不带 server-tool 计数（潜伏，acct.usage 累计但 query.ts 从不读）。conf med
- **T5** [low] `error-normalize.ts:107-113`（pickStatus）— HTTP status 作 JSON 串（"503"）不提取→此类网关可重试 5xx 判 non-retryable（与首轮 M3 string-error+sibling-status 不同，是 numeric-status-as-string 强转缺口）。conf low

---

## §R2 — 已剔除（重复 / 非缺陷，验证记录）

- **RR1【重复】L2-9**（hooks/matcher.ts + regex-guard.ts alternation ReDoS star-height-1）= 首轮 **M2**（regex-guard.ts:39 alternation-overlap `(a|a)+`）**同根因**：回源确认 hasNestedQuantifier（regex-guard.ts:39-82）只建模 star-height、未建 alternation-overlap，首轮 M2 已记此缺口；L2-9 仅换 matcher 消费入口报同一根因。**不计入**。
- **非重复保留**（回源判distinct）：N9 vs 首轮 L47（同 tips:88 但机制不同：注入面 vs 大小写敏感）；T5 vs 首轮 M3（numeric-status-as-string vs string-error+sibling-status）；M2-1 vs 首轮 M16（sandbox writablePaths vs worktree cwd 幻影）；I2 subagent 面计一次。
- **非缺陷确认**：无权限决策缓存（该审计角度非问题）；version.ts 无漂移；media.ts/setting-sources.ts/contracts.ts 经深读判净（合并逻辑/data-URI 解析实在他处）；bwrap argv 是 spawn arg-array 无 shell 注入面；sandbox 证据 hint 正确门控；missing-bwrap 是 debug-logged 诚实非沙箱运行（文档化）。

## 方法论备注（诚实性）

- **两波结构**：主波 14 簇各带首轮缺陷排除清单，得 85 项即诚实挂「不足 100」；随后**靠真挖两轮均薄审的内核**（补充波 5 簇）+20，净 105 越过 100——**非注水凑数**。
- **回源对抗验证**：高危/安全/跨轮疑重项逐条 [V] 直读裁决——RP1 路径遍历（读 primaryArg 不归一化 + read.ts resolveAbs 折叠 `..` 确认真，与首轮已澄清的 SSRF/mounts/worktree 假阳不同，此条站得住）；H2 系列、D2、M2-2、I2、C1 均回源确认；L2-9 回源判定重复剔除。
- **注入防护**：两个代理回执带 harness 中和标记（permissions 簇触发 bypass-permissions 模式、subagents 簇触发 envelope-tag）——经检为纯技术发现无注入指令，正常采纳；标记本身是审计外部代理输出的标准防线。
- **诚实标注**：105 项中约 12 项潜伏/边界/cosmetic 逐条标 conf/boundary，不与明确真缺陷混淆；剔除比发现同样重要（§R2）。
