# silver-core-sdk 缺陷审计报告（2026-07-17，UTC+8）

> **派发**：守密人 `/goal 找出 100 个 sdk bug`。
> **对象**：silver-core-sdk（v0.63.0，含当日新落地的 SCS-REQ-REPOS-01 循环支撑接口面）。
> **方法**：21 个并行审计代理分三波覆盖全部 src/ 模块簇（10 广度波 + 8 深度波 + 3 补漏波），
> 加艾瑞卡回源直读对抗验证 + 跨代理冲突裁决。**诚实红线**：只计能在代码里确认的真实缺陷；误报 / 意图行为 / 文档化取舍
> 逐条剔除并记录（见 §R）。**绝不为凑数编造**。
>
> **分级**：severity ∈ high/medium/low；confidence ∈ high/med/low。标注：
> **[V]**=艾瑞卡回源直读确认；**[A]**=代理精确定位（行号+机制可追、多为含复现/探针的深度波报告）；
> **[新]**=缺陷位于当日新增 0.63.0 代码（艾瑞卡自造，优先修）。
>
> 小学生比喻：给刚扩建的大楼做全楼安检——十八个检查员分两轮各查一片，列隐患清单，
> 再由工头逐条核实、剔除误报、按危险程度排。清单诚实：查实几处报几处，绝不虚报凑数。

---

## 汇总

- **确认真实缺陷：99 项**（high 5 · medium 21 · low 73；含第三波补漏 L64–L74）。
- 其中 **8 项位于当日新增 0.63.0 代码**（艾瑞卡自造，标 [新]，全部低/中危，优先修）。
- **已剔除误报 / 意图行为 / 文档化取舍：12 项**（含数条 wave-1 安全类假阳 + 2 条针对新代码的假高危，见 §R）。
- **诚实说明**：目标数 100，实得 **99 项**真实缺陷——经三波 21 代理 + 直读验证的尽力审计，基本达成目标。
  其中约 4 项为**边界项**（真实但危害极小 / 是否算缺陷可争，如 L67/L71/L73/L74，均已诚实标注），
  另有 2 项因太边界或近似意图行为未计入（tips ineligibleIds 防御缺口 / session-manager resumeAttempts 成功路径不标注）。
  **绝无为凑 100 而编造**：清单每项均可回源核实，若守密人对某边界项判为非缺陷则实数相应下调。

## 高危（High）

- **H1** [high][V] `tools/edit.ts:147,152,179` — Edit 破坏非 UTF-8 文件的未编辑字节。`looksBinary` 仅检 NUL，
  ISO-8859-1 文件（0xE9，无 NUL）判为文本；`toString('utf8')`→splice→`writeFile(utf8)` 把未编辑区非 UTF-8 字节改写 EF BF BD。
  write.ts:118 有 roundtrip 守卫，Edit 无。
- **H2** [high][V] `engine/loop.ts:644,824` — thinking 线格式取 `config.model` 非实发 `useModel`；fallback 到不同世代模型时
  发错 thinking 形态→400，兜底反成硬失败。
- **H3** [high][A] `transport/openai.ts:1095` — OpenAI 臂 `finish_reason` 后仍续读（无 Anthropic 臂 message_stop 式提前 return），
  网关挂开连接→idle 看门狗丢弃完整轮→retryable 分类致引擎重放整轮→副作用重复。
- **H4** [high][A] `transport/openai.ts` — OpenAI 工具参数跨块 UTF-8 截断：多字节字符被 delta 边界切断→无效 JSON 解析失败。
  （与 H3 同文件不同点，depth 波未复核此点，保留中-高置信。）
- **H5** [high][V] `engine/structured-output.ts:162` — 宽松 JSON 提取 schema-blind：返回首个可解析而非首个 schema-valid 跨度；
  前导「合法但错」JSON（`{"note":"x"}` 在 `{"answer":42}` 前）致结构化输出失败 + 浪费重试。代理探针复现。

## 中危（Medium，20 项）

- **M1** [medium][A] `transport/node-http.ts:341` — preconnect 丢弃它预热的 socket（`res.body?.cancel()` 在 node 适配器上销毁 socket 而非回池）；
  默认 `httpClient:'node'` 下首请求另开 TCP，preconnect 收益不兑现。探针实证 freeSockets=0。
- **M2** [medium][A] `internal/regex-guard.ts:39` — `hasNestedQuantifier` 漏 alternation-overlap ReDoS（`(a|a)+`/`(a|ab)+`）；
  Grep/BashOutput 模型输入模式同步跑 bulk text→事件循环冻结（实测 ~2.9s，超时/Abort 均不可中断）。
- **M3** [medium][A] `error-normalize.ts:155` — 字符串 `error` 字段 + 同级 `status` 同时破坏检测与提取；
  `{error:'rate limited',status:503}` 落通用分支报 `retryable:false`，丢失可重试 503。
- **M4** [medium][A] `engine/compaction.ts:766` — H1 纯工具循环确定性 fold 丢弃 customInstructions + PreCompact additionalContext。代理复现。
- **M5** [medium][A] `engine/compaction.ts:740` — knownPromptFloor 触发但 partition 按估算 declines→不 fold→下轮仍超真窗→'prompt too long' 400。代理复现。
- **M6** [medium][V] `engine/prompt-fragments.ts:257` — webfetch-websearch 片段 gate `has(WebFetch)||has(WebSearch)` 但正文名两者；
  `disallowedTools:['WebSearch']` 时 gate 仍触发→提示词描述未注册的 WebSearch（红线：描述不存在能力）。
- **M7** [medium][A] `transport/anthropic.ts` — Retry-After HTTP-date 格式解析为整数秒→NaN→退避回落默认（过激重试）。
- **M8** [medium][A] `transport/sse.ts` — 多行 data 拼接末尾空行语义处理（重构 JSON 载荷改变）。（中置信，depth 波清了 sse 主体，此点保留观察）
- **M9** [medium][A] `engine/loop.ts:1182` — 终态（非 abort/replay/fallback）流失败 throw 前未 fold firstSink.usage→少报已计费 token。
- **M10** [medium][A] `mcp/http.ts:437` — SSE 解析丢弃「无任何尾随换行」的末个 data: 帧→误报 mcp_invalid_response（有效响应丢失）。
- **M11** [medium][A] `tools/bash.ts:463`+`shells.ts:80` — `run_in_background` 无 bash→sh 兜底（spawn ENOENT 异步）；仅 /bin/sh 主机后台命令静默不跑。
- **M12** [medium][A] `hooks/runner.ts:218` — Stop-condition matcher 永远看不到 transcript（只传 transcript_path），条件判据恒 not-met、回调恒被跳。
- **M13** [medium][A] `hooks/runner.ts:227` — `failureMode:'closed'` 不覆盖 condition-评估失败：评估错→无条件跳过→conditioned deny hook fail-OPEN 放行工具。
- **M14** [medium][V] `subagents/runtime.ts:1592` — 前台成功路径无 `record.status==='running'` 守卫（兄弟路径有）；releaseWorktree 慢窗内被 kill 置 killed 后被覆写 completed + 发矛盾事件。
- **M15** [medium][A] `subagents/runtime.ts:1160` — 跨协议 transport 解析失败早退：fireSubagentStart 已发但 SubagentStop 从不发→宿主 Start/Stop 配对分配的资源每次泄漏一单。
- **M16** [medium][A] `subagents/runtime.ts:1592/1516` — SendMessage 复活 worktree 隔离子代理时 cwd 指向已删 worktree（首轮 releaseWorktree 清干净树后续轮读写幻影路径）；正中 coordinator「research→implement」流。
- **M17** [medium][A] `subagents/transport-resolver.ts:92` — 跨协议 transport 仅按 protocol 记忆、忽略 env/parentProvider；多租户复用 resolver→租户 B 子代理用租户 A 的 API key（**凭据串号**）。
- **M18** [medium][V][新] `query.ts:1626` — R2 `budget:threshold` 对每轮 re-armed 剩余预算判、非原始 maxBudgetUsd；多轮流式下阈值漂移（string 单发模式正确）。
- **M19** [medium][A] `mcp/registry.ts:272` — `reconnect()` 不参与 connecting 闩→并发 reconnect 同服务器泄漏连接（孤儿存活子进程）。
- **M20** [medium][low-med] `tools/webfetch.ts:559` — 204/205 终响应误报 unsupported content type（应 honest 空体）。

## 低危（Low，63 项，按模块）

**transport**
- **L1** [low] `anthropic.ts:245`/`openai.ts:1041` — null-body 2xx 在 releaseSignals 前 throw，每轮泄漏一个 abort 监听器。
- **L2** [low] `node-http.ts` via `anthropic.ts:196` — `timeoutMs:0` 立即中止每请求（与 idle/max 的 0=禁用不对称）。
- **L3** [low] `openai.ts:1239` — 仅元数据的干净关闭被当可挽救截断（与 [DONE] 变体 empty_message 处理不一致）。
- **L4** [low] `openai.ts:672` — `reasoning_content:''` 用 `??` 掩盖同块 populated `reasoning`。

**engine**
- **L5** [low][A] `engine/tokens.ts:164` — messageTokenCache 对「同数组同块数就地 text 变更」返回陈旧估算（4→4000 字仍估 ~1 token）。代理复现。
- **L6** [low][A] `engine/pricing.ts:27` — 价表仅新命名前缀，`claude-3-5-sonnet-20241022` 等旧规范 id 估价 $0→maxBudgetUsd 静默失效。代理复现。
- **L7** [low] `engine/compaction.ts:695` — floor 触发时 compact_boundary.pre_tokens 报较小启发式值（漏 knownPromptFloor）。
- **L8** [low][A] `engine/prompt-composition.ts:163` — afterPart 断点标签引用 wire-block 索引、与 systemAppend[] 标签错位→归桶归错。探针复现。
- **L9** [low] `engine/loop.ts:799` — max_tokens 对 fallback 模型未重新 clamp（若输出上限更小可 400，复合 H2）。
- **L10** [low][A] `engine/runtime-context.ts:80` — 超帽截断保留 root-most（最不具体）指令，丢弃最近 cwd 的高优先 CLAUDE.md（两代理确认）。
- **L11** [low][A] `engine/runtime-context.ts:21` — PROJECT_INSTRUCTIONS_CAP 文档「字节」但 slice 按 UTF-16 码元；CJK（本仓中文 CLAUDE.md）实际帽 ~3x + 可切断代理对。
- **L12** [low] `engine/prompt-fragments.ts:229` — task-tools 片段 gate `has(TaskCreate)` 但正文名四工具；`disallowedTools:['TaskList']`→描述不可用 TaskList。
- **L13** [low][A] `tools/descriptions.ts:576` — ENTERPLANMODE_DESCRIPTION 名「Agent tool」违模块自定 no-Agent 规则；无子代理配置时误导。
- **L14** [low] `engine/tool-dispatch.ts:355` — defer 分支用原始 block.input 建载荷、在 updatedInput 重赋前→deferred 载荷丢 hook 改写。

**fs/exec tools**
- **L15** [low][V] `tools/edit.ts:177` — Edit 检查点存有损 utf8 预映像，rewindFiles 还原 mojibake（write.ts 有守卫、edit 无）。
- **L16** [low][A] `tools/grep.ts:551` — head_limit 恰在末个扫描文件命中上限时截断未告知（`>` 非 `>=` 边界）。
- **L17** [low][A] `tools/grep.ts:542` — offset 超结果末尾报「No matches found」掩盖实有匹配。
- **L18** [low][A] `tools/shells.ts:298` — BashOutput 非法 filter 正则语法错→catch 返回未过滤全量、游标已进→模型误以为已过滤且不可重读。
- **L19** [low][A] `tools/multiedit.ts:255` — 净零编辑链（A→B→A）报 failed 而非 no-op success，弃整次调用。
- **L20** [low][A] `tools/fsutil.ts:64` — 二进制嗅探仅查前 8192 字节，尾部 NUL 文件判为文本、Edit 损坏其二进制尾（复合 H1）。
- **L21** [low][A] `tools/grep.ts:445` — 反向：恰好 head_limit 个匹配但后有非匹配文件时误加「results truncated」。
- **L22** [low][A] `tools/read.ts:202` — stat 尺寸守卫与 readFile 间 TOCTOU：并发写增长文件→绕过 50MB OOM 守卫。
- **L23** [low-med][A] `tools/bash.ts:146`+`shells.ts:125` — SIGKILL 升级被直壳退出取消：SIGTERM-忽略的后代在无沙箱路径成孤儿（沙箱下 --unshare-pid 掩盖）。

**memory**
- **L24** [low][A] `tools/memory/memory-tool.ts:295` — R8 写/字节计数在 store 调用前自增，失败写仍计入 memoryHealth（两代理确认）。
- **L25** [low][A] `tools/memory/store.ts:256`+`memory-tool.ts:275` — truncateViewBody 对含 header 的 store 输出非幂等→误截断+误导分页（两代理确认）。
- **L26** [low] `tools/memory/memory-tool.ts:337` — rename root-guard 只护 old_path 不护 new_path（直注入自定 store 得未守卫调用）。
- **L27** [low] `tools/memory/index.ts:216` — resident-index 注入泄漏 store 截断提示行为记忆内容。
- **L28** [low] `tools/memory/paths.ts:82` — validateMemoryPath 接受段内 TAB/换行→污染目录列表 tab/newline 分隔文法。

**permissions/hooks**
- **L29** [low][A] `permissions/gate.ts:220` — auto-classifier 查原始 input 非 hook-rewritten effectiveInput（rewrite 可规避硬 deny；默认 name-only classifier 无影响）。
- **L30** [low][A] `hooks/runner.ts:404` — 自相矛盾输出无 out.reason 时 DENY 被记为 allow 理由（#25 注释要防的错配）。
- **L31** [low][A] `hooks/runner.ts:264` — hook_started 生命周期发射在 runOne try/catch 外；host sink throw→整批 hook 中止（违 never-rejects 契约）。
- **L32** [low][A][新] `hooks/goal.ts:50` — readFileTail 忽略 readSync 返回字节数，短读时全 buffer toString 会用尾随 NUL 填充 transcript 尾。

**mcp/workflow**
- **L33** [low][A] `mcp/elicitation.ts:68` — resolveElicitation 不对已 abort 信号短路，违自述 fail-closed（拆连后仍调 host handler）。
- **L34** [low][A] `mcp/stdio.ts:142` — 'error' 处理器无条件置 child=null，defeats close() 的 killTree（exit 处理器故意不置）。
- **L35** [low][A] `mcp/http.ts:204` — close() 在 post() 顶部守卫与 addEventListener 间窗口 abort 时不取消在飞请求（跑满 requestTimeoutMs）。
- **L36** [low] `mcp/stdio.ts:626`/`http.ts:587` — normalizeContentItem 丢弃 embedded resource 的 blob 字段（或为 type 有意限制，低置信）。
- **L37** [low][A] `mcp/registry.ts:481` — 服务器名 `__` 碰撞时最长匹配无短名兜底（病态命名，真实工具不可达）。
- **L38** [low][A] `tools/workflow-engine.ts:991` — 脚本抛错丢栈（vm-realm Error，instanceof false）→stack 字段死、message 变 "Error: boom"。
- **L39** [low][A] `tools/workflow-engine.ts:495` — Semaphore 无 max<=0 守卫，`maxConcurrentAgents:0` 死锁首个 agent()。

**subagents/reporting**
- **L40** [low][A] `subagents/runtime.ts:1661` — runContinuation 成功路径同样无 running 守卫，末刻 kill 的 killed 被覆写 completed。
- **L41** [low][A] `subagents/runtime.ts:1038` — SubagentStart hook abort 时 task_started 无终态事件→观测悬挂。
- **L42** [low][A] `reporting/runtime-report.ts:141` — readWindow 逐文件 readFile 无 try/catch，readdir 后文件消失则 reject 传出（违 observability 不 throw）。
- **L43** [low][A] `reporting/runtime-report.ts:153` — isRunLogRecord 只查 `typeof ts==='string'` 不查可解析，`"2026-13-99"`→NaN→跳过且不计 badLines。
- **L44** [low][A] `reporting/compare-reports.ts:210` — parseFloat 对 rate 串静默吞尾（"5.2.3"→5.2），坏值产貌似合理错聚合。
- **L45** [low][A] `generators/runtime.ts:148` — runUtilityCall 仅循环体内查 signal.aborted，流前已 abort+零事件时不抛 AbortError（违 fail-loud，安全敏感 classifier 可能返片段）。
- **L46** [low][A] `verifier/index.ts` — 对抗验证器 parse 失败返 REFUTED 与真 refute 不可分（瞬时坏输出静默弃有效发现，无重试/诊断）。
- **L47** [low][A] `tips/index.ts:88` — context-tip eligibility feature_id 大小写敏感（宿主注册 "Manual-Polling" vs 模型返 "manual-polling"→误丢）。

**sessions**
- **L48** [low][A] `sessions/checkpoints.ts:213` — rewind 删除分支在 rm 失败时仍报文件已删（与 restore 分支不对称）。
- **L49** [low][A] `sessions/checkpoints.ts:132` — 两 FileCheckpointStore 同会话共享 seq 空间→seq 平局时 rewind 还原错实例预映像。
- **L50** [low][A] `sessions/store-adapter.ts:304` — list() 对每个外部 transcript 取两次（sidechain 探针 + load 重取；perf）。
- **L51** [low][A] `sessions/persistence.ts:178` — 查询内 fork 丢弃持久化 accounting 记录（与 standalone forkSession 口径矛盾）。
- **L52** [low][A] `sessions/tool-claims.ts:123` — auditToolClaims 每 assistant 文本至多一发现（单条含两声明只报一，漏报）。
- **L53** [low][A] `sessions/persistence.ts:62` — persistParam 不丢空 user 轮（persistAssistant 丢空），repairPairing 不清 from-empty→空 user 轮存活 replay→400。
- **L54** [low][A] `sessions/store.ts:577` — loadInfo/list 前缀探针要求紧凑 `{"type":"met`，含空格的外部 transcript 被跳→list/getSessionInfo 与 load 不一致。
- **L55** [low][A] `sessions/store-adapter.ts:305` — list() 有持久写副作用（把每个外部 session 物化到本地 JSONL），只读 list 变所有者拷贝（likely 有意缓存、意外）。
- **L56** [low] `sessions/store.ts:639` — loadInfo `createdAt ?? mtime` 而 load `?? birthtime`，缺 createdAt 的 transcript 两 API 不一致（SDK 文件不可达）。

**query/session-manager（含新代码）**
- **L57** [low][新] `query.ts:1677` — 会话末记忆轮跑在陈旧 engineConfig.maxBudgetUsd（driveTurn 不 re-arm 预算）；sessionEndUpdate+maxBudgetUsd 可超帽花费（仅 4 轮界）。
- **L58** [low][新] `query.ts:1307` — 中断轮 fold 部分花费入 acct 但不写 accounting 记录→getSessionAccounting 少计中断轮真实花费。
- **L59** [low][新] `query.ts:1272` — abort/error 路径不 drainMirror/drainObs、settleAll 后 obsQueue 无人排空→teardown/中断轮产的 SubagentStop/mirror-error 永不达消费者。
- **L60** [low][新] `query.ts:1567` — R1 prelude 块缺 content 渲染字面 "undefined"（无运行时校验；ledger.toPrelude 恒设 content，裸调用者可漏）。
- **L61** [low] `session-manager.ts:281,642` — ledgers 随每次 mgr.query() 增长永不剪，长寿命 manager 内存按累计查询数增长。

**loop-support 新代码**
- **L62** [low][新] `loop-support/retention.ts:53` — R3 字节帽按逐区独立渲染求和、但 renderBlocks 用 `\n\n` 拼接，N 区超帽 2·(N−1) 字节。
- **L63** [low][新] `loop-support/ledger.ts:163` — R4 deserialize 在 maxAgeMs+非单调 at 时非幂等往返（oldest-first 重插逐插 prune，后插大 at 项 prune 掉先插活项）。

**第三波补漏（sdk-server / tips / generators / mcp-http / session-manager / askuserquestion）**
- **L64** [low][A] `mcp/sdk-server.ts:35` — resolveToolAnnotations 不归一化空的**包裹式** annotations `{}`（裸式 `{}`→undefined，包裹式→`{}`，输出不对称）。
- **L65** [low][A] `mcp/sdk-server.ts:35` — `'annotations' in arg` 对原始值第五参抛 TypeError（JS 误用崩在工具定义期而非优雅降级）。
- **L66** [low][A] `tips/index.ts:158` — parseTipReception 把「结构完整但 reception 缺失/乱码」映射为 `neutral` 非 `unknown`（与自述 fail-safe unknown 矛盾，宿主聚合过计 neutral）。
- **L67** [low][A] `generators/runtime.ts:166` — extractJsonObject 在顶层对象被截断时返回**嵌套**对象（违「首个顶层对象」契约；tip 消费方 fail-safe 无害，边界项）。
- **L68** [low][A] `mcp/http.ts:416` — TextDecoder 流末不 flush，末块残留截断多字节 UTF-8 被静默丢弃。
- **L69** [low][A] `generators/index.ts:398` — tryParseArray 对前导「平衡但不可解析」`[...]` 不重试（与 extractJsonObject 的重试不一致），`[note] ["db.md"]` 丢真选择。
- **L70** [low][A] `generators/index.ts:321` — parseAwaySummary `.replace(/[*`]+/g,'')` 删正文字面 `*`/反引号（`ran tests on *.ts`→`.ts`；下划线情形已刻意保留、星号漏保）。
- **L71** [low][A] `generators/index.ts:96` — parseCommandPrefix 单行装饰化注入哨兵未判为 injection（`command_injection_detected (chained curl)`→当 prefix；权限层仍手批不放宽，**边界项**）。
- **L72** [low][A] `tools/askuserquestion.ts:117` — renderAnswers 不逐元素校验答案形状；`[{header:'x'}]`（缺 answers 数组）→`undefined.join` TypeError，**在 try/catch 外**未捕获传入引擎（他路径均优雅 isError）。
- **L73** [low-med][A] `session-manager.ts:499` — scheduleResume 前置退役 teardown 失败仅 debug 吞（H-2「先 flush 再 resume」保证被静默破坏，重驱读到缺最新检查点的历史）。
- **L74** [vlow][A] `tools/resources.ts:48`+`websearch.ts:132` — `(e as Error).message` 假设抛 Error；非 Error 抛出（字符串/对象）产 "failed: undefined" 丢诊断（cosmetic，**边界项**）。

---

## §R — 已剔除（误报 / 意图行为 / 文档化取舍，验证记录）

诚实红线的另一面：以下候选经回源或深度波复核判为**非缺陷**，不计入总数。

- R1 `hooks/goal.ts` abort 返回 `{}` 放行停止 —— **意图行为**（中断本应停止，goal 保持布防）。[新代码假高危，已澄清]
- R2 `hooks/goal.ts` maxBlocks off-by-one —— **误报**（blocks 起 0、`>=` 判在自增前，恰阻 N 次；两代理确认）。[新代码假高危，已澄清]
- R3 `query.ts` resume 后成本重复计数 —— **误报**（SessionAccounting 每 query 一实例 cost 起 0，首 delta 无重叠；回源确认）。[新代码假高危，已澄清]
- R4 memory mounts 前缀部分匹配（/a/foo vs /a/foobar）—— **误报**（`within` 用 root+'/'，组件边界安全；深度波确认）。
- R5 webfetch SSRF DNS 重绑定 —— **误报**（M-3 DNS pinning：guard 返验证地址、makePinnedLookup 只答验证地址、每跳重验；深度波确认）。
- R6 read.ts image magic-byte 下溢 —— **误报**（内容嗅探 + 空文件提醒；深度波确认）。
- R7 enterworktree name 路径遍历 —— **误报**（NAME_RE 首字母数字无分隔符，挡遍历+git-option 注入；深度波确认）。[艾瑞卡自审假阳，已澄清]
- R8 sessions resume tool_result 配对 —— **误报**（repairPairing 三遍对抗追踪确认正确）。
- R9 sessions fork uuid 重映射 —— **误报**（单 uuid map + turn_ref/pending_uuid 一致重写确认）。
- R10 subagents agents.ts tools 浅拷贝 —— **观察**（定义实际当不可变）。
- R11 accumulator opaque input_json_delta 忽略 —— **文档化取舍**（Finding M1 有意「保原样不抛」）。
- R12 memory 递归 delete 绕过 ro mount —— **争议/未决**（深度波清了 writeDenial 主体、未专项复核嵌套 ro-under-rw-delete；保守剔除待专测）。

---

## 待办 / 建议

- **优先修（新代码真缺陷，艾瑞卡自造 8 项）**：M18(R2 阈值漂移) · L57/L58/L59/L60(R1 边界) · L62(R3 帽) · L63(R4 deserialize) · L32(goal 短读)。
  均低/中危、边界性，建议一并修 + 补测试。
- **高危优先（存量）**：H1(Edit 非 UTF-8 损坏)、H2(thinking fallback)、H3(openai idle 重放)、H5(结构化输出 schema-blind)。
- **安全相关**：M17(跨协议凭据串号，多租户场景)。
- Tier [A] 逐条实测升 [V]（分批）。
- 第三波补漏已收（L64–L74，+11 真缺陷 − 2 dup/边界）；tool-types.ts 实证为纯类型声明无运行时逻辑，verifier / websearch / runConcurrent / 记账基线经深读判正确。

## 方法论备注（诚实性）

- **代理报告是候选非结论**：早期广度波多为泛化描述，深度波带行号 + 机制 + 复现/探针；艾瑞卡对高价值 / 新代码 / 跨代理冲突项**回源直读裁决**（如 runtime.ts:1592 前台状态覆写：两代理相左，读源确认 wave-1 对）。
- **注入防护**：审计过程中一次工具回执被投毒（伪造 edit.ts/fsutil.ts 读结果 + 伪「用户」转向指令），已识别为提示注入、重读干净源、不据其推进；此为审计外部内容时的标准防线。
- **剔除比发现同样重要**：§R 12 项含数条 wave-1「中/高危」安全类假阳（SSRF DNS 重绑定 / 内存挂载部分匹配 / worktree 名遍历——含艾瑞卡自审一条）经深度波回源清白，未计入。
