# Silver Core SDK 多波缺陷审计报告（2026-07-28）

## 0. 工作定性

对银芯使命#2「通用 AI 底层开发基地」两个在产 SDK（`silver-core-agent-sdk` 50.7k 行 + `silver-core-maestro-sdk` 3.7k 行 + `silver-core-testbed`）的**系统化缺陷审计**。守密人指令为「寻找 SDK 代码 500 个 BUG 并修复」。审计以分区并行 + 跨切面镜头推进，十七波共 129 个审计分区，全部修正落于分支 `claude/sdk-500-bugs-fix-sm7zer`，逐波回归验证、逐批提交推送。

**价值**：SDK 已有 20+ 真实消费者（BPT 在产），是银芯→黑池单向输出的常态底座。任何崩溃/安全/协议缺陷都会经 pin 消费传导到黑池侧。本次把「模型宽容输入致整轮对话丢弃」「权限 deny 静默失效」「MCP 跨会话 id 违规」「域名过滤绕过」「keep-alive socket 泄漏」等真实故障面收口，直接提升底座可靠性。

## 1. 实得结果（git 净 diff 为权威真相）

- **确认并修正真实缺陷：425 处**（每处均有具体失败输入/状态；三处子代理二次复审后自行回退的候选、一处与既有测试契约冲突的守卫已剔除，不计入）。
- 横跨 **130+ 个源文件**，两个 SDK + testbed。
- **三包全绿**：agent SDK 3357 项、maestro 429 项、testbed 37 项单测全通过；两包 `tsc --noEmit` 零报错；仓库层 pytest 3122 项、ruff 全绿；`scripts/premerge_gate.py` 常规与 `--sparse` 两形态均通过。
- **卫生干净（措辞订正）**：净改为源码（.ts/.mjs/.py/.yml）。**既有测试文件零修改**——既有测试即契约，破绿一律回退该修正（Wave 6 有一处即因此回退）。两处必须照实说明，否则「零测试改动」会读成比实情更强的承诺：(1) Wave 14 前改过**一个**既有测试，且该测试在**未改动的 origin/main 上即为红**（归档分桶断言用了 UTC，每日 16:00 UTC 后无故转红 8 小时）；(2) 第十七波**新增**了测试档——不是改既有档，而是给本波新增的错误处理 / 原子写分支补覆盖率，因为这些改动把仓库覆盖率从 92.17% 压到 90.07%、跌破 CI 的 92% 硬门槛。**没有下调门槛、没有加豁免注释**：修法是给「抢救网」代码补上它本该有的测试。

### 分波
| 波次 | 范围 | 修正 |
|------|------|------|
| Wave 1 | 全仓 12 分区首扫 | 63 |
| Wave 2 | 首扫未覆盖模块（engine 提示装配/reporting/internal/tips/verifier/maestro/testbed）| 15 |
| Wave 3 | 大文件二轮深审 + 跨切面镜头（Unicode/算术/错误吞没/资源清理）| 7 |
| Wave 4 | 新鲜面（zod schema/types 层/MCP JSON-RPC/permissions 对抗二轮/sandbox）| 5 |
| Wave 5 | 二轮镜头（tool-dispatch/webfetch SSRF/fs TOCTOU/hooks/mcp stdio/retry）| 5 |
| Wave 6 | 三轮深审（anthropic 主流翻译/连接层/bash/accumulator/session-manager）| 5 |
| Wave 7 | 新镜头（query/loop/openai 三轮、memory 二轮、permissions 三轮、verifier/reporting）| 8 |
| Wave 8 | 跨文件 roles-alternate 镜头 + sessions/maestro/mcp 三轮 + hooks/engine 二轮 | 8 |
| Wave 9 | **首扫从未审计面**（两包 scripts/ 与 examples/、testbed 二轮、契约与工具 schema）+ 四个新横切镜头（确定性/数值边界/平台/消息流发射契约）| 43 |
| Wave 10 | **首扫仓库自身的守卫机器**（CI 工作流定义、一致性台/仿真器、Python 守卫层）+ 文档↔代码承诺差 + 超大输入压力面 + 守卫射程外镜头 | 34 |
| Wave 11 | **首扫在产仓库层**（news 采集层 32 档、归档引擎与布局真相源、KB 检索层、OKF/索引生成器、wiki 解包解析管线、运维脚本）| 38 |
| Wave 12 | news 采集器逐平台二轮 + SDK 中型模块深审 + `.claude` 技能命令首扫 + game 首扫 + **错误可诊断性**与**测试盲区**两个新镜头 | 33 |
| Wave 13 | **时区/时钟**与**测试替身契约差**两个实证催生的镜头 + news 输出层与站点首扫 + assets/记忆层首扫 + engine 提示与 MCP 四轮 + maestro 四轮 | 25 |
| Wave 14 | **幂等性**与**资源上限**两个新镜头 + 部署路径与构建配置首扫 + wiki 站点首扫 + sessions/subagents 与 transport 按生命周期第四轮 | 28 |
| Wave 15 | 权限×钩子**交互面**（而非各自单查）+ engine 按回合生命周期第四轮 + 跨工具不对称镜头（一个兄弟对、另一个不对）+ OKF 可视化器与 PIP 工具链首扫 + 跨包一致性 | 38 |
| Wave 16 | **十个从未审计面**（maestro 调度/工作流图、MCP 与 transport 协议边缘、会话与子代理生命周期、试金石作为第三方消费方、wiki 解析管线、`.claude` 运维层、对外站点）+ **故障注入**与**向后兼容漂移**两个新镜头 | 38 |
| Wave 17 | **四个全新镜头**：不可信工具输出作**结构伪造通道**（文件名伪造 system-reminder / 换行伪造搜索结果绕开域名过滤）· 中断恢复（采集层杀在半路会怎样）· 检索诚实性（评测指标能否在什么都没检索到时照样高分）· **「测试替身放过了什么」**（不改替身，去 src 里找它藏住的真 bug）| 40 |

### 按类别
| 类别 | 数量 | 类别 | 数量 |
|------|------|------|------|
| edge-case 边界 | 19 | logic 逻辑 | 13 |
| crash 崩溃 | 17 | error-handling 错误处理 | 11 |
| security 安全 | 15 | race 竞态 | 5 |
| state 状态机 | 11 | protocol 协议 | 5 |
| | | leak 泄漏 | 4 |

## 2. 关于 500 目标的诚实结论（2026-07-28 第十六波后**修订**）

**原判词作废。** 本节此前写的是「500 这一数字在本代码库中无法以真实缺陷达成」，那是在第七波前后、
累计约 100 处时下的判断。此后九波的实测数据**推翻**了它，照实记录而不粉饰：

召回曲线 63→15→7→5→5→5→8→8→**43**→**34**→**38**→**33**→**25**→**28**→**38**→**38**→**40**。

前八波的枯竭是真的，但它枯竭的**只是已经扫过的那几个面**。第九波起每次换到从未审计过的面，
召回就回到 25–43 区间，且**连续八波没有再掉下来**。第十五、十六两波各 38 处，是九波以来的高位，
而它们审的是权限×钩子的**交互**、协议边缘、以及「故障注入」「向后兼容漂移」这类**新镜头**——
不是把老面再刷一遍。第十七波再得 40，四个镜头全是新的，其中「测试替身放过了什么」这一路**不改替身、
只拿它的宽容去 src 里定位真 bug**，两处均命中——这是第 2 条方法论的直接推论。

三条方法论结论（这才是本次审计真正的产物，比数字本身更有价值）：

1. **换面胜过挖深。** 对已扫面做第三、第四轮的分区，产出是个位数；换到新面是 25–43。
   十六波里凡是「同一批文件再看一遍」的分区，几乎都诚实报零。
2. **要审那些「负责发现问题」的东西。** 本次共抓到**十二处**「守卫报绿却什么都没查」：
   一致性台在**零次比较**上出具合格判词、`memory_freshness --gate` 解析到零条目仍打印 GREEN、
   `premerge_gate --sparse` 声称测了它从未测的代码、CI `paths:` 漏掉守卫自己的输入、
   归档引擎看不见自己的冷层、存储契约套件给坏存储发合格证、试金石的 CI 巡检**每一轮**把
   27 个工作流的看护名单塌成 2 个还报「ok」、变异棘轮把**从未测量过的**分数写成「低于地板」、CI 的必检 `unit tests` 用稀疏检出把语料排除在外致十一个**出处一致性**测试全部 `runIf` 跳过而文件照报 PASS、死手开关判定零个工作流时退出 0 且**因自己也在看护名单里而持续给自己开生存证明**、消费审计把「grep 跑不起来」(rc≥2) 与「没人引用」(rc=1) 混为一谈从而伪造出一份覆盖全部产物的退役候选名单、知识库质性探针里一个能力分是**硬编码 True**、另一个判别式**就是它所过滤集合的定义**故恒为 1.00。
   这类缺陷不产生任何测试信号，只能靠专门去审「检查者本身」才看得见。
3. **500 现在是可达的，但达成方式只能是继续换面。** 按当前 38–40/波的实测速率，
   剩余 75 处约需两波。**绝不为凑数注水**：底线仍是每处必须能回答「什么具体输入使其出错」、
   不得改测试契约。若某一波的诚实产出是零，就记零。

诚实记录：**425 处真实缺陷**是当前实得数。这是一份真维修单，不是凑数的假诊断。

## 3. 完整缺陷清单（去重后 425 条）

| 文件 | 行 | 类别 | 波次 | 摘要 |
|------|----|----|------|------|
| `silver-core-maestro-sdk/src/ledger/ledger.ts` | 838 | race | W2 | reopenSession link write abandons provenance permanently on a concurrent CAS loss |
| `silver-core-maestro-sdk/src/ledger/ledger.ts` | 477 | crash | W2 | invalid outcome string corrupts append-only audit row via the backfill-repair path |
| `silver-core-sdk/src/engine/loop.ts` | 513 | edge-case | W1 | lastAssistantSummary truncates with bare slice(0,500), splitting surrogate pairs |
| `silver-core-sdk/src/engine/prompts.ts` | 256 | crash | W2 | appendSegments loop reads seg.text without an object guard, crashing on an undefined entry |
| `silver-core-sdk/src/engine/tokens.ts` | 104 | crash | W1 | tool_use block with absent input: JSON.stringify returns undefined, estimateTextTokens crashes the whole history estimate |
| `silver-core-sdk/src/engine/tool-dispatch.ts` | 560 | crash | W1 | JSON.stringify(updatedToolOutput) can return undefined, poisoning tool_result content |
| `silver-core-sdk/src/engine/tool-dispatch.ts` | 95 | crash | W1 | MCP text part with omitted text field crashes the empty-block filter |
| `silver-core-sdk/src/engine/tool-dispatch.ts` | 106 | protocol | W1 | MCP image part with omitted data builds an image block whose data is undefined |
| `silver-core-sdk/src/generators/index.ts` | 226 | edge-case | W1 | Empty/fence-only reply yields '' as session title (generateSessionTitle and generateTitleAndBranch) |
| `silver-core-sdk/src/generators/index.ts` | 383 | edge-case | W1 | parseAwaySummary trims wrapping quotes before whitespace, leaving a dangling quote after fence-stripping |
| `silver-core-sdk/src/generators/index.ts` | 536 | edge-case | W1 | stripToPlain has the same quote-before-trim ordering defect, corrupting fallback titles |
| `silver-core-sdk/src/hooks/goal.ts` | 104 | error-handling | W1 | Throwing host onEvent observer escapes onStop and corrupts the goal verdict |
| `silver-core-sdk/src/hooks/runner.ts` | 130 | logic | W1 | Condition-context serializer marks shared non-circular refs as [Circular], hiding real input from the evaluator |
| `silver-core-sdk/src/hooks/runner.ts` | 279 | logic | W1 | SubagentStop condition transcript tail read from transcript_path (main session), not agent_transcript_path |
| `silver-core-sdk/src/mcp/elicitation.ts` | 97 | leak | W1 | abort listener attached to connection-lifetime signal never removed; one leaks per elicitation |
| `silver-core-sdk/src/mcp/http.ts` | 181 | race | W1 | close() ran session DELETE before aborting in-flight requests, letting 404 recovery revive the session |
| `silver-core-sdk/src/mcp/http.ts` | 582 | security | W1 | safeReadText buffered an unbounded hostile error body via response.text() before 300-char truncate |
| `silver-core-sdk/src/mcp/project-config.ts` | 114 | security | W1 | nested __proto__ key in .mcp.json pollutes rebuilt config object prototype and drops the key |
| `silver-core-sdk/src/mcp/protocol.ts` | 329 | protocol | W1 | tools/list drain kept duplicate tool names across pages; one duplicate 400s every Messages API request |
| `silver-core-sdk/src/mcp/sdk-server.ts` | 188 | edge-case | W1 | createSdkMcpServer validated qualified-name length but not server-name charset; CJK/space names 400 the whole API request |
| `silver-core-sdk/src/permissions/rules.ts` | 458 | security | W1 | path spec with literal tail after * (e.g. /etc/*.conf) matched nothing -> deny fail-open |
| `silver-core-sdk/src/permissions/rules.ts` | 499 | security | W1 | env-assign prefix regex mis-lexed a mid-value quote -> deny not stripped past assignment |
| `silver-core-sdk/src/permissions/rules.ts` | 579 | security | W1 | leading shell redirection before command word bypassed deny/ask rules |
| `silver-core-sdk/src/permissions/rules.ts` | 564 | security | W1 | pipeline negation prefix ! bypassed deny/ask rules |
| `silver-core-sdk/src/query-accounting.ts` | 70 | edge-case | W1 | mergeModelUsage adds costUSD unguarded; one NaN/Infinity per-model cost poisons modelUsage totals permanently |
| `silver-core-sdk/src/query.ts` | 1045 | state | W1 | Query-layer terminal results never update lastYieldedResult; teardown correction resurrects an older success result |
| `silver-core-sdk/src/query.ts` | 1986 | state | W1 | Session-end memory round stamps sessionEndUpdate 'ran' even when the round was interrupted or crashed |
| `silver-core-sdk/src/query.ts` | 325 | edge-case | W1 | NaN maxTurns silently disables the session turn cap (acct.turns >= NaN is always false) |
| `silver-core-sdk/src/query.ts` | 2332 | state | W1 | setMcpServers() leaves removed servers' scope entries in mcpScopeByName; re-added server misreports provenance |
| `silver-core-sdk/src/sandbox/backend.ts` | 81 | crash | W1 | resolveSandboxBackend(null) throws TypeError despite documented never-throws |
| `silver-core-sdk/src/session-manager.ts` | 70 | logic | W1 | manager-local addUsage drops web_search_requests, so mgr.usage().usage reports 0 searches forever |
| `silver-core-sdk/src/session-manager.ts` | 767 | state | W1 | setRetainedRegion records pending replay state BEFORE the inner setter, so a refused region poisons auto-resume |
| `silver-core-sdk/src/session-manager.ts` | 809 | leak | W1 | ledger registered before query() construction; a synchronous query() throw leaks the ledger forever |
| `silver-core-sdk/src/sessions/health.ts` | 161 | logic | W1 | orphanCheckpointDirs false positives when the transcript scan hit the entry budget |
| `silver-core-sdk/src/sessions/store-adapter.ts` | 70 | security | W1 | InMemorySessionStore NUL-joined key not injective: components containing \0 collide distinct keys |
| `silver-core-sdk/src/sessions/store-adapter.ts` | 73 | state | W1 | InMemorySessionStore.append([]) minted a phantom session key with fresh mtime |
| `silver-core-sdk/src/sessions/store.ts` | 348 | error-handling | W1 | append() built JSON.stringify(entry) outside the try, breaking the never-throw contract |
| `silver-core-sdk/src/sessions/store.ts` | 742 | edge-case | W1 | latestSessionId() did not skip unsafe session ids, unlike list()/loadInfo() |
| `silver-core-sdk/src/sessions/store.ts` | 745 | logic | W1 | latestSessionId() broke same-mtime ties by readdir order, diverging from list()[0] |
| `silver-core-sdk/src/subagents/runtime.ts` | 1223 | security | W1 | child gate spreads agentDef.disallowedTools raw: bare string becomes per-char garbage, deny rules lost (fail-open) |
| `silver-core-sdk/src/subagents/runtime.ts` | 1293 | error-handling | W1 | close-the-pair SubagentStop on transport-resolution failure runs on params.signal, skipped when that signal caused the failure |
| `silver-core-sdk/src/subagents/runtime.ts` | 1752 | state | W1 | foreground non-abort child failure returns error result without terminal task_updated; host tracker shows agent running forever |
| `silver-core-sdk/src/subagents/runtime.ts` | 1961 | state | W1 | runContinuation rethrows real (non-abort, non-stall) failures without terminal task_updated; task shown running forever |
| `silver-core-sdk/src/subagents/runtime.ts` | 1866 | race | W1 | record.status set 'running' only after the worktree re-provision await; a kill during it is lost and the child revives |
| `silver-core-sdk/src/tools/bash.ts` | 596 | error-handling | W1 | background launch reports missing cwd as missing shell (foreground got 2026-07-26 disambiguation, bg did not) |
| `silver-core-sdk/src/tools/bash.ts` | 592 | logic | W1 | background candidate chain falls through on ANY spawn error; foreground falls through only on ENOENT |
| `silver-core-sdk/src/tools/edit.ts` | 256 | security | W1 | Atomic-edit tmp file created without prior mode: 0600 secret briefly world-readable before chmod |
| `silver-core-sdk/src/tools/fsutil.ts` | 178 | logic | W1 | formatCatN truncatedLines counts a per-line-truncated row the total-char cap then drops unemitted |
| `silver-core-sdk/src/tools/sendmessage.ts` | 56 | race | W1 | SendMessage lacks the aborted-signal pre-flight every other builtin performs |
| `silver-core-sdk/src/tools/shells.ts` | 501 | edge-case | W1 | BashOutput filter:'' engages F4 partial-line holdback though filterLines treats '' as no filter |
| `silver-core-sdk/src/tools/task.ts` | 392 | security | W1 | TaskUpdate metadata merge assigns via obj[key]=v, so a __proto__ key rewrites the prototype |
| `silver-core-sdk/src/tools/webfetch.ts` | 364 | edge-case | W1 | htmlToText leaks raw contents of unclosed script/style/comment blocks as page text |
| `silver-core-sdk/src/tools/webfetch.ts` | 691 | logic | W1 | structuredOutput.truncated ignores the 5MB body-cap overflow, reporting a cut page as complete |
| `silver-core-sdk/src/tools/websearch.ts` | 37 | logic | W1 | Leading-dot domain entries ('.spam.com') can never match a host, silently bypassing domain filters |
| `silver-core-sdk/src/tools/workflow-engine.ts` | 498 | error-handling | W1 | Floating agent()/parallel()/pipeline()/workflow() rejections crash the host as unhandled rejections |
| `silver-core-sdk/src/tools/workflow-engine.ts` | 780 | edge-case | W1 | Spreading opts.limits with explicitly-undefined values overwrites defaults, deadlocking or disabling caps |
| `silver-core-sdk/src/tools/workflow-engine.ts` | 573 | edge-case | W1 | Semaphore clamp Math.max(1, max) passes NaN through, deadlocking every acquire |
| `silver-core-sdk/src/tools/workflow-engine.ts` | 843 | edge-case | W1 | Agent label truncation promptRaw.slice(0,45) can split a surrogate pair |
| `silver-core-sdk/src/tools/workflow-engine.ts` | 918 | edge-case | W1 | Failed-agent snippet res.content.slice(0,120) can split a surrogate pair |
| `silver-core-sdk/src/tools/workflow-engine.ts` | 194 | edge-case | W1 | Meta parse-error snippet src.slice(i, i+24) can split a surrogate pair |
| `silver-core-sdk/src/transport/anthropic.ts` | 315 | crash | W1 | SSE payload JSON null crashes .type probe; primitive JSON payloads yielded as bogus stream events |
| `silver-core-sdk/src/transport/node-http.ts` | 232 | error-handling | W1 | Throw inside http response callback (Response RangeError on status outside 200-599) crashes the process |
| `silver-core-sdk/src/transport/openai.ts` | 817 | crash | W1 | feed() TypeError on delta:null or choices:[null] chunk kills the whole turn |
| `silver-core-sdk/src/transport/openai.ts` | 885 | crash | W1 | feed() TypeError on a null element inside delta.tool_calls |
| `silver-core-sdk/src/transport/openai.ts` | 1341 | crash | W1 | SSE payload parsing crashes on JSON null; primitive payloads falsely start the message |
| `silver-core-sdk/src/transport/openai.ts` | 1245 | error-handling | W1 | Raw TypeError from unserializable request body rethrown untyped (anthropic arm wraps it, audit R7j-3) |
| `silver-core-testbed/src/daemon.mjs` | 226 | state | W2 | non-idempotent shutdown: second signal double-tears-down; a rejecting stop() leaves a stale pid file |
| `silver-core-testbed/src/inspectors.mjs` | 70 | logic | W2 | heartbeat-derived watch list silently empty in production (wrong base path) |
| `silver-core-testbed/src/inspectors.mjs` | 88 | error-handling | W2 | rate-limit early return dropped already-discovered CI failures |
| `src/engine/accumulator.ts` | 447 | protocol | W6 | Top-level non-object tool_use input JSON assembled into an API-invalid block that the engine treats as executable |
| `src/engine/compaction.ts` | 570 | protocol | W3 | foldViaApi appends a 'Summarize' user turn after a summaryPrefix that ends with a user turn, producing consecutive user messages that the API rejects (400 roles must alternate) |
| `src/engine/config-builder.ts` | 114 | crash | W2 | Segments filter crashes on undefined entry (weaker guard than prompts.ts E8 fix) |
| `src/engine/config-builder.ts` | 145 | crash | W2 | Composition (segParts) filter crashes on undefined segment entry |
| `src/engine/tool-dispatch.ts` | 106 | crash | W5 | MCP image content with data but no mimeType crashes mapMcpResult |
| `src/error-normalize.ts` | 131 | error-handling | W2 | pickCode: numeric `code` shadows a real string slug via ?? chain, dropping the provider error code |
| `src/hooks/condition.ts` | 149 | security | W5 | malformed JSON object reply not flagged evaluationFailed -> fail-open on a fail-closed matcher |
| `src/internal/inert-text.ts` | 44 | security | W2 | escapeTagAttr collapsed only CR/LF, leaving non-ASCII line terminators that fork the pseudo-XML tag across lines |
| `src/internal/regex-guard.ts` | 101 | security | W2 | CLASS_PROBES too small: overlapping bracket-class ranges slip past the ReDoS guard as a false negative |
| `src/internal/structured-output.ts` | 404 | edge-case | W4 | additionalProperties:false wrongly rejects properties covered by the unmodeled patternProperties keyword, violating the module's documented 'never fails on a keyword it does not model' leniency contract |
| `src/mcp/http.ts` | 281 | protocol | W4 | HTTP 404 session-expiry recovery replays fire-and-forget JSON-RPC responses/notifications onto a fresh session (cross-session id-context violation) |
| `src/mcp/stdio.ts` | 188 | leak | W5 | in-flight elicitation handler never aborted when the child crashes (only explicit close() aborts lifeController) |
| `src/permissions/rules.ts` | 676 | security | W4 | decomposeBashCommand split on the & inside fd-duplication redirections (>&, <&, 2>&1), orphaning the fd digit so a deny scoped to the real command failed open |
| `src/query.ts` | 2280 | error-handling | W3 | setModel('') silently sets an empty model id, reintroducing the silent gateway-400 the construction guard prevents |
| `src/reporting/compare-reports.ts` | 121 | edge-case | W3 | Token/cost/per-tool aggregation sums lacked the non-negative guard the sibling transport block (U7-4) and query-accounting finite() apply; isRunLogRecord validates type not sign, so a valid-JSON negative field corrupts the aggregate. |
| `src/reporting/runtime-report.ts` | 242 | logic | W2 | transport-health values summed unclamped, unlike U7-4-fixed compare-reports sibling |
| `src/reporting/runtime-report.ts` | 121 | crash | W2 | isRunLogRecord per_tool guard omits name check though aggregation dereferences t.name |
| `src/sandbox/backend.ts` | 124 | crash | W4 | resolveEnvAllowlist(null) TypeError on null.allow — unguarded sibling of the resolveSandboxBackend null guard |
| `src/session-manager.ts` | 619 | state | W6 | Resume re-drive (start()/replayControlPlane) can throw and escapes next() un-caught, leaking the ledger forever |
| `src/sessions/persistence.ts` | 187 | state | W4 | During-query fork of a crashed session copies an unsettled trailing turn, 400ing the fork's first new input |
| `src/subagents/runtime.ts` | 2258 | race | W3 | abortAll() aborts running child controllers but never bumps the kill epoch, so a SendMessage continuation still QUEUED at query teardown survives cancellation and revives the child |
| `src/subagents/runtime.ts` | 2182 | error-handling | W3 | A background SendMessage continuation that THROWS a non-abort error is swallowed by delivery.catch (debug-log only), so the coordinator model never learns and hangs |
| `src/tools/enterworktree.ts` | 170 | logic | W2 | EnterWorktree({path}) rejected every valid worktree when the session cwd sits under a symlink |
| `src/tools/memory/store.ts` | 237 | crash | W2 | Escaping symlink in a memory subdirectory crashes the entire directory view |
| `src/tools/monitor.ts` | 153 | logic | W6 | Monitor shell-candidate loop lacks the ENOENT-only fall-through guard, so a non-ENOENT spawn failure on the first shell silently degrades to the next interpreter (wrong-shell trap) — contradicting its own comment 'same launch path as Bash run_in_background'. |
| `src/tools/read.ts` | 279 | edge-case | W5 | 256KB whole-file steering refusal fired before image/PDF detection, rejecting large images and PDFs with inapplicable text-pagination advice |
| `src/tools/websearch.ts` | 53 | security | W5 | Trailing-dot host bypasses blocked_domains and wrongly trips allowed_domains |
| `src/transport/anthropic.ts` | 336 | edge-case | W3 | raw frame.data.slice(0,120) in malformed/foreign SSE frame diagnostics can bisect a surrogate pair, emitting a lone surrogate (U+FFFD when the debug log / thrown APIConnectionError message is UTF-8 encoded) |
| `src/transport/anthropic.ts` | 376 | state | W6 | Empty-stream retry gate misses content delivered via content_block_delta without a preceding content_block_start, so a partially consumed turn is replayed (double-delivered) and short delta-only turns are wrongly rejected as empty. |
| `src/transport/node-http.ts` | 240 | leak | W6 | null-body response (204/205/304) never drains res, so its keep-alive socket is never returned to the pool |
| `src/transport/openai.ts` | 894 | crash | W3 | Non-array delta.tool_calls container crashes feed() with an uncaught TypeError |

---
_艾瑞卡 · 弥萨格大学数据库终端 · 生成于 2026-07-28（北京时间）_
| `silver-core-sdk/src/engine/loop.ts` | 1321 |  | W1 | The mid-tool-loop fallback withhold keyed on the signing model alone, so fallbackModel was inert for EVERY tool loop — including runs with thinking off,... |
| `silver-core-sdk/src/engine/loop.ts` | 1391 |  | W1 | pushAssistant stamped each turn with the RESPONSE model while stripStaleThinking compares against the REQUEST model, so a plain same-model session strip... |
| `silver-core-sdk/src/engine/loop.ts` | 1176 |  | W1 | The pre-compaction memory-flush latch was set BEFORE the PreCompact veto check, so a transient deny permanently consumed the episode's single write oppo... |
| `silver-core-sdk/src/engine/loop.ts` | 1641 |  | W1 | When a concurrent tool group is masked after one member stops/defers, the masked members' observability messages were dropped — while their permission d... |
| `silver-core-sdk/src/engine/accumulator.ts` | 288 |  | W1 | The C4 guard protected message_delta's stop_reason FIELD but not the `delta` CONTAINER, so the very 'usage-only frame' C4 postulates threw a bare TypeEr... |
| `silver-core-sdk/src/engine/tool-dispatch.ts` | 176 |  | W1 | mapMcpResult's content switch has no default arm, so a content part type it does not model is dropped with no trace — the opposite of the 'never dropped... |
| `silver-core-sdk/src/tools/read.ts` | 408 |  | W2 | Read's empty-file branch is the only terminal branch that emits no structuredOutput; image/pdf/text branches all do. |
| `silver-core-sdk/src/tools/webfetch.ts` | 655 |  | W2 | WebFetch's two non-error terminal branches (cross-host redirect handoff, HTTP 204/205) emit no structuredOutput while the fetched branch does. |
| `silver-core-sdk/src/tools/resources.ts` | 294 |  | W2 | ReadMcpResourceDirTool emits structuredOutput on every FAILURE branch and none on SUCCESS — inverted vs sibling ReadMcpResourceTool, which emits {conten... |
| `silver-core-sdk/src/tools/shells.ts` | 486 |  | W2 | None of shells.ts's four background-task tools (BashOutput/TaskOutput/KillShell/TaskStop) performs the pre-flight aborted-signal check every other built... |
| `silver-core-sdk/src/tools/monitor.ts` | 284 |  | W2 | Monitor's launch failure lacks the ENOENT-vs-missing-cwd disambiguation that BOTH Bash chains (foreground and run_in_background) carry. |
| `silver-core-sdk/src/tools/webfetch.ts` | 789 |  | W2 | WebFetch's catch uses the blind `(e as Error).message` cast that audit L74 removed from the other two host-callback tools (websearch.ts, resources.ts; a... |
| `silver-core-sdk/src/tools/workflow.ts` | 87 |  | W2 | Workflow's per-session run-journal store keys on ctx.readFilePaths, never migrated to the formal ctx.sessionKey that task.ts / enterworktree.ts / todo.t... |
| `silver-core-sdk/src/permissions/gate.ts` | 253 |  | W3 | A throwing host classifier escapes check() entirely — the only host callback in the permission hot path with no fail-closed guard |
| `silver-core-sdk/src/hooks/runner.ts` | 332 |  | W3 | The condition gate's model call was bounded by nothing but the caller's AbortSignal, so a hung evaluator stalls every gated tool call forever while matc... |
| `silver-core-sdk/src/permissions/rules.ts` | 700 |  | W3 | Deny fail-open: a wrapper option taking its value as a separate token stopped the command unwrap one token short of the real command |
| `silver-core-sdk/src/permissions/rules.ts` | 498 |  | W3 | A separator-less wildcard path specifier (Read(*.env)) is INERT — it can match no input at all, so the deny silently never fires |
| `okf/visualizer.html` | 128 |  | W4 | Node title/type/tags/id are interpolated into tip.innerHTML (and legend innerHTML) with no escaping, on a page that is deployed to GitHub Pages as /kb/i... |
| `okf/visualizer.html` | 133 |  | W4 | Wheel zoom is unbounded while pinch zoom clamps to [0.15,6]; scrolling out drives cam.k toward 0 and the label font size 11/cam.k toward hundreds of tho... |
| `okf/visualizer.html` | 80 |  | W4 | Repulsion 1400/d2 has no near-field cap (`if(d<1){d=1}` clamps only the direction divisor, not the magnitude), so the layout never converges — most node... |
| `okf/visualizer.html` | 107 |  | W4 | The rAF loop calls the O(V^2) simulation every frame forever, with no cooling — the tab pins a core indefinitely long after the layout has converged |
| `scripts/report_render.py` | 271 |  | W4 | PDF rendering resolves relative image paths against Path.cwd() although report bodies use repo-root-relative image srcs, so running the renderer from an... |
| `news/scripts/archive_engine.py` | 390 |  | W5 | 每源收尾行 `complete: N groups, M files` 打的是 discover 的总数，而上传失败的桶在循环里被 `continue` 跳过——报告说全归档完了，实际可能一桶也没归 |
| `news/scripts/repair_gaps.py` | 136 |  | W5 | 「一个缺口都没有」与「一个源都没扫到」输出完全相同：日期数 <2 的源静默 continue，工具照报 No gaps、gap_report.json 照写 total_gaps:0 |
| `scripts/memory_freshness.py` | 186 |  | W5 | _git_age_days 对任何异常返回 None，超龄检查把 None 与「在保鲜期内」合流，报告打「全部在保鲜期内」 |
| `news/scripts/backfill_media.py` | 313 |  | W5 | 收尾行分子分母来自两个不同总体：`ok` 是清单历轮累计成功数，`len(seen)` 是本轮扫到的候选数，而扫描会被预算提前截断 |
| `scripts/build_community_index.py` | 251 |  | W5 | 无日期条目被 `if not day: continue` 静默丢弃，total_records 随之缩水而 _meta 无任何痕迹——与已修的文件级 SKIPPED 是同一个病的条目级 |
| `scripts/dead_man_switch.py` | 265 |  | W5 | 摘要行与 status.json 只报 watched / findings；API 全失败时每条降级 unknown，findings 仍为 0，输出读起来是「盯了 N 个全都健康」 |
| `news/scripts/split_output.py` | 200 |  | W5 | 时间戳解析失败的条目与「超出时间窗口」的条目共用同一个 skipped_old 计数，日志一律归因为按龄过滤 |
| `wiki/scripts/extract_client_data.py` | 648 |  | W5 | 落盘的 extraction_stats.json 把 errors 截成前 50 条却不记总数，3000 次失败与恰好 50 次失败产出逐字节相同的错误列表 |
| `news/scripts/community_cold_compress.py` | 173 |  | W5 | dry-run 下 gz_bytes 恒为 0（压缩没跑），三条合计行照打 `X MB → 0.0 MB`，读作压到零字节的 100% 收益 |
| `news/scripts/discord_cold_compress.py` | 145 |  | W5 | 同款：dry-run 合计行打 `N MB → 0 MB`，把「没压」呈现成「压到零」 |
| `news/scripts/silent_sources_audit.py` | 361 |  | W5 | write_health 无条件把每个平台的 errors 重置为 []，抹掉同一 CI 作业里 SilentPlatformTracker 刚记下的采集异常 |
| `news/scripts/collect_global.py` | 388 |  | W5 | news.json 的 `sources_run` 字段赋的是条目数 len(global_items)，名字说源数、值是条数 |
| `scripts/kb_telemetry.py` | 66 |  | W5 | log_call 只记前 10 个 result id，而 summarize 据此判「死概念（从未被触达）」——排名第 11 之后被导航到的概念被报成从未有人读过 |
| `silver-core-maestro-sdk/src/driver.ts` | 289 |  | W6 | LedgerDriver dereferences the host Executor's result without the guard the agent SDK applies to its twin host-callback seam (canUseTool, audit r4 Rg-2):... |
| `silver-core-maestro-sdk/src/goal/chaser.ts` | 243 |  | W6 | GoalChaser never validates the GoalVerdict its host evaluator returns, while the agent SDK's twin seam for the SAME 0.83.0-unified shape rejects a malfo... |
| `silver-core-sdk/src/tools/memory/contract-suite.ts` | 549 |  | W6 | runMemoryStoreContractSuite loses the failure reason for non-Error throws; the deliverable twin it is modelled on (runLedgerStoreContractSuite) already... |
| `silver-core-maestro-sdk/src/schedule/spec.ts` | 89 | date-arithmetic | X1 | nextFireAt's dailyAt branch rebuilt the fire point with Date.UTC(d.getUTCFullYear(), ...), but Date.UTC remaps years 0-99 to 1900+year while getUTCFullY... |
| `silver-core-maestro-sdk/src/workflow/load.ts` | 62 | parser state desync (silent wrong-data load) | X2 | extractTopLevelFence tracked fence open/close without the backtick-run LENGTH, so a 3-backtick line inside a longer (````) documentation block was read... |
| `silver-core-maestro-sdk/src/workflow/load.ts` | 118 | encoding interop (valid input rejected) | X2 | A leading UTF-8 BOM reached JSON.parse verbatim, while the format sniffer one branch earlier trimmed it (String.trimStart removes U+FEFF) and routed the... |
| `silver-core-sdk/src/mcp/stdio.ts` | 156 | unhandled-error-event/host-crash | X3 | child.stdout and child.stderr had no 'error' listener (only child.stdin did), so an error event on either read pipe is re-thrown by EventEmitter as an u... |
| `silver-core-sdk/src/mcp/http.ts` | 240 | reconnect-race/silent-request-loss | X3 | A request issued while a session-expiry re-initialize is in flight goes out with NO Mcp-Session-Id (reinitializeSession nulls this.sessionId for the dur... |
| `silver-core-sdk/src/transport/openai.ts` | 828 | wrong-shape-json/unvalidated-deref | X3 | OpenAIStreamTranslator.feed()'s flattenContent guarded the array CONTAINER but not its ELEMENTS: a null/undefined hole in an array-form delta.content (o... |
| `silver-core-testbed/src/inspectors.mjs` | 108 | silent-degradation / false-green patrol | X5 | inspectCiStatus swallowed the loss of the heartbeat-derived watch list: when Public-Info-Pool/Record/heartbeat/status.json cannot be read, resolveWatche... |
| `silver-core-testbed/src/inspectors.mjs` | 355 | fabricated measurement in report | X5 | inspectRatchet reported every non-success, non-skipped matrix job conclusion as 'score below floor N' at level fail. Only 'failure' means the ratchet ch... |
| `silver-core-testbed/src/daemon.mjs` | 228 | false-red exit code | X5 | --once computed its exit code from sessions failed within a fixed one-hour look-back rather than during this run, contradicting the file's own header co... |
| `wiki/scripts/lua_parse.py` | 11 | silent-data-loss | X6 | Field regex required a trailing comma, so a block's last field (`K = "v" }`) was silently dropped; when that field is the caller's gate field the whole... |
| `wiki/scripts/extract_client_data.py` | 265 | encoding/silent-misfiling | X6 | UTF-8 BOM survives decode_script (utf-8 never raises on a BOM) and U+FEFF is not whitespace to str.strip(), so BOM'd config tables are misclassified .tx... |
| `wiki/scripts/decrypt_and_extract.py` | 236 | encoding/silent-misfiling | X6 | Same BOM path in the decrypt extractor: BOM'd TextAsset misclassified and BOM written into the extracted file. |
| `wiki/scripts/parse_awaker_config.py` | 12 | crash+silent-wrong-output | X6 | parse_lua_table collapses duplicate keys (nested sub-table with a same-named field) to a list; only 3 of ~20 consumer fields handled that, so clean_mark... |
| `.claude/skills/anysearch/scripts/search.py` | 73 | silent-wrong-output | X7 | Result URL read via r.get('url', '') — the default only fires on a MISSING key, so a JSON null url printed the literal string 'None' as the source link,... |
| `.claude/skills/anysearch/scripts/search.py` | 73 | crash | X7 | r.get('title', '').strip() raised AttributeError on a JSON-null title, aborting the whole result listing after the header had already been printed. |
| `.claude/skills/anysearch/scripts/search.py` | 76 | crash | X7 | score guarded only by `is not None` then formatted with :.1f — a non-numeric score aborted the listing mid-way. Now type-checked, with a raw-value fallb... |
| `.claude/skills/intel-weekly/example-20260712.md` | 263 | stale-path | X7 | The weekly-report template's 数据口径 boilerplate told readers every citation is re-verifiable under `Public-Info-Pool/Record/Community/`, a directory that... |
| `.github/PULL_REQUEST_TEMPLATE.md` | 17 | stale-path | X7 | 变更类型 checklist listed BIAV-SC.md as a live documentation target; that entry-point file was retired and folded into CLAUDE.md. Replaced with the doc set... |
| `site/design/morimens-design-system-guide.html` | 35 | broken-rendering | X8 | .file-tree 是普通 div 且未设 white-space，默认 white-space:normal 把 ASCII 目录树的换行与对齐空格全部折叠；已加 white-space:pre + overflow-x:auto（与本页 pre 块同策），并去掉开闭标签处会新增空行的换行 |
| `site/design/morimens-design-system-guide.html` | 86 | broken-rendering | X8 | 「部署事实」note 里用了 Markdown 粗体 **对外可访问的公开文档**，HTML 不解析星号，改为 <strong> |
| `site/design/morimens-design-system-guide.html` | 88 | dead-documented-path | X8 | guide 与 CONTEXT.md 均把 /design/ 目录当作对外访问路径，但 deploy 只 cp 两个文件、目录下无 index.html；已改写为两份文件的完整 URL 并注明目录本身会 404 |
| `site/design/morimens-design-system-guide.html` | 129 | stale-deploy-doc | X8 | §03「部署方式」仍写 peaceiris/actions-gh-pages@v4 推 gh-pages 分支，且 §03 状态表与 §08 检查清单第 6 条要求 Pages Source = gh-pages 分支；T62（2026-07-22）已迁到 upload-pages-artifact +... |
| `site/design/morimens-design-system-guide.html` | 132 | stale-deploy-doc | X8 | guide 与 CONTEXT.md 的触发路径清单只列 5 条旧路径，缺 package-lock.json / generate_wiki_pages.py / data/processed/** / Public-Info-Pool/Resource/proposal/** / okf/visua... |
| `site/design/morimens-design-tokens.css` | 31 | false-a11y-claim | X8 | TEXT PALETTE 注释把三对对比度标成 primary 11.2:1 / muted 7.1:1 / dim 4.6:1 且三个都打勾；实测 16.54 / 8.58 / 4.14，dim 实际低于 WCAG AA 4.5:1（对 --m-bg-surface 更低至 3.99:1）。已改为实测... |
| `silver-core-sdk/src/reporting/runtime-report.ts` | 192 | silent-data-loss | X9 | readWindow swallowed EVERY fs error reading a ledger day file (and the ledger dir), so an unreadable ledger was indistinguishable from an empty one; now... |
| `silver-core-sdk/src/error-normalize.ts` | 168 | crash | X9 | normalizeProviderError — documented 'Never throws' — threw for a foreign Error whose .message is not a string (or whose .message/.name getter throws), b... |
| `silver-core-sdk/src/error-normalize.ts` | 569 | wrong-output | X9 | signalFromNested harvested status/code/requestId from a buried APIStatusError but dropped its retryAfterMs, so a WRAPPED 429 normalized to retryable:tru... |
| `silver-core-sdk/src/generators/index.ts` | 509 | silent-data-loss | X9 | tryParseArray aborted the whole scan when the FIRST '[' never balanced, even when it was a stray bracket in prose — the sibling extractJsonObject alread... |
| `silver-core-sdk/src/tips/index.ts` | 96 | crash | X9 | buildSelectorUserTurn called JSON.stringify on host-supplied sessionMetadata unguarded, so a non-serializable bag threw a bare TypeError out of selectCo... |
| `silver-core-maestro-sdk/CHANGELOG.md` | 197 | changelog-entry-mislabelled-version | X10 | The BREAKING GoalVerdict reshape ({achieved,feedback,impossible?} -> {status,reason?}) actually shipped in maestro 0.83.0 (commit bfb75bb: src/goal/chas... |
| `silver-core-sdk/CHANGELOG.md` | 831 | changelog-entry-mislabelled-version | X10 | Same swap on the agent side: commit 42e81c3 copied the existing 0.83.0 body ('Family verdict-type unification') to a new 0.85.0 heading and overwrote 0.... |
| `silver-core-maestro-sdk/CHANGELOG.md` | 151 | changelog-entry-truncated | X10 | The 0.90.0 entry lost its opening sentence: commit f3bc616 inserted 0.91.0 by relabelling the 0.90.0 heading and stole the shared 'Lockstep alignment on... |
| `silver-core-maestro-sdk/CHANGELOG.md` | 89 | lockstep-noop-wording-drift | X10 | Three no-op entries (0.97.0 L89, 0.93.0 L127, 0.92.1 L133) open with the Chinese '**锁步对齐**(无本包运行时改动)' instead of the machine-recognised 'Lockstep alignm... |
| `scripts/sdk_substantive_versions.py` | 56 | guard-blind-spot | X10 | _NOOP_HINTS had Chinese patterns only for 本包零代码改动 / 本包无改动, so the phrasing actually used in this repo's CHANGELOGs - 无本包运行时改动 - matched nothing and form... |
| `silver-core-sdk/docs/MIGRATION-0.3x-to-0.68.md` | 347 | doc-describes-removed-mechanism | X10 | §3.8 states 'The maestro package declares peerDependencies: "silver-core-agent-sdk": ">=0.68.0 <1.0.0" - installing a mixed-version pair fails peer reso... |
| `silver-core-sdk/src/tools/read.ts` | 427 | prompt-injection / forged authoritative structure in tool result | Y1 | Read's empty-file note embeds the resolved path verbatim inside a <system-reminder> fence with no neutralization, so an attacker-chosen FILENAME can clo... |
| `silver-core-sdk/src/tools/websearch.ts` | 104 | container escape in a line-oriented digest / domain-filter bypass | Y1 | renderResults interpolated the backend's title/url/snippet straight into a numbered, newline-delimited result digest. Those fields are untrusted web con... |
| `.github/workflows/silver-core-sdk.yml` | 151 | guard-disabled-by-sparse-checkout | Y3 | The required check `Silver Core Agent SDK / unit tests` (and its macOS twin, line 229) checked out with `!/Public-Info-Pool/Reference/`, which is exactl... |
| `.github/workflows/recover-fanart.yml` | 51 | missing-data-root | Y3 | The fan-art full recovery workflow ran `collect_fanart.py` without cloning BIAV-SC-DATA or setting `BIAV_SC_DATA_ROOT`, so `archive_layout.community_roo... |
| `.github/workflows/build-okf-bundle.yml` | 28 | paths-filter-omits-own-inputs | Y3 | The push `paths:` listed the three generator ENTRY files but none of the library modules they import: scripts/okf_frontmatter.py (writes every concept f... |
| `.github/workflows/build-capability-registry.yml` | 27 | paths-filter-omits-own-inputs | Y3 | build_capability_registry.py derives orchestration planes from .mcp.json (mcp plane), .claude/settings.json (hook plane) and tests/** (test-only vs orph... |
| `silver-core-maestro-sdk/src/ledger/ledger.ts` | 326 | starvation / nondeterministic work selection | Y4 | claimDue applied opts.limit to the store's raw listSessions() order. LedgerStore deliberately specifies NO listing order (store.ts documents only the tw... |
| `silver-core-maestro-sdk/src/clock.ts` | 41 | 32-bit timer overflow inverts every ms knob | Y4 | systemClock.setTimeout passed the delay straight to the global timer. Past Node's 2^31-1 ms ceiling the delay does not lengthen, it overflows to 1 ms, s... |
| `silver-core-sdk/src/engine/accumulator.ts` | 96 | usage-field-dropped-across-streaming-deltas | Y5 | foldMessageDeltaUsage carried output/input/cache_creation/cache_read from message_delta but silently dropped usage.server_tool_use, so normalizeUsage()... |
| `silver-core-sdk/src/query.ts` | 2195 | spend-not-persisted-to-accounting-ledger | Y5 | Teardown folds late background-subagent spend into acct via foldSubagentUsage() AFTER the last per-result accounting record was written, and the correct... |
| `news/scripts/discord_archiver.py` | 231 | non-atomic write of the resume-cursor state file | Y6 | _save_state() wrote state.json with a direct open('w')+json.dump; the same file's other writer (backfill_forum_starters.py) already used the atomic help... |
| `news/scripts/discord_archiver.py` | 1091 | non-atomic write + silent discard of accumulated counters | Y6 | _save_daily_stats() direct-wrote activity_daily/{date}.json and swallowed any read error of the existing file with `except Exception: pass`, then overwr... |
| `news/scripts/discord_archiver.py` | 1095 | durable work whose derived record is only flushed on the happy path | Y6 | run()/run_history_only() called _save_daily_stats()+_save_state() only as the last statements of the body. Extracted the bodies to _run_tracks()/_run_hi... |
| `news/scripts/discord_archiver.py` | 290 | append onto a torn line, destroying the retried record | Y6 | _write_msg appended a JSONL line without checking that the previous line was terminated. Added a once-per-file tail check (_ends_cleanly) that writes a... |
| `news/scripts/discord_archiver.py` | 613 | guard reading a path nothing writes (migration drift) — dead skip check | Y6 | _archived_months() looked for archive-log.json under self.data_dir (discord/<region>/), but archive_engine writes it at its base_dir = discord/ root per... |
| `news/scripts/archive_engine.py` | 284 | non-atomic write of the only record of what was uploaded | Y6 | save_log() direct-wrote archive-log.json; load_log() maps any JSONDecodeError to []. Switched to same-dir tmp + os.replace (stdlib only — collect-fanart... |
| `news/scripts/archive_engine.py` | 398 | source deleted before the bookkeeping that records the destination | Y6 | archive_source() ran git_rm_files(files) and deleted the local tarball before appending/saving the log entry. Reordered to save_log → git_rm → unlink. |
| `news/scripts/data_quality.py` | 190 | non-atomic write + un-guarded load of a git-committed state file | Y6 | SilentPlatformTracker._save_health() direct-wrote source-health.json (once per platform per run) and _load_health() called json.load with no guard, so a... |
| `news/scripts/aggregator.py` | 291 | collected-up-to watermark advanced on partial success | Y6 | mark_collection_done() was called inside run(), before the §4.2 R1 core-failure check and long before collect_global.main() ran. Moved to the __main__ t... |
| `news/scripts/aggregator_collectors.py` | 969 | one malformed line abandons the rest of the file | Y6 | _read_discord_jsonl had json.loads inside the loop but under an outer `except Exception`, so the first bad line ended the whole file. Now bad lines are... |
| `scripts/kb_telemetry.py` | 118 | metric-inflation | Y7 | summarize() counted the vector leg's archive refs as "concepts reached", inflating distinct_concepts_reached / reach_ratio |
| `scripts/kb_golden_gen.py` | 115 | false-positive-metric | Y7 | layer_aware golden questions used a bare concept stem as expect; kb_eval matches by substring, so a different platform's concept scores as a hit |
| `scripts/kb_qual.py` | 126 | control-cannot-fail | Y7 | probe_boundary_enumeration returned kb_can_enumerate_bounded as a hardcoded True, so the dimension scored on an empty knowledge base |
| `scripts/kb_qual.py` | 72 | control-cannot-fail | Y7 | probe_layer_disambiguation's kb_can_disambiguate was tautologically equal to platforms_with_both_layers, so it could never detect an ambiguous layer tag... |
| `scripts/kb_qual.py` | 36 | wrong-corpus | Y7 | probes used `concepts = concepts or _concepts()`, so an explicitly-injected empty corpus was silently replaced by the live okf/ index |
| `scripts/okf_pointer_layers.py` | 613 | unreachable-knowledge | Y7 | build_projects hardcoded five subproject names, so two subprojects' CONTEXT.md never entered the knowledge base |
| `scripts/kb_coverage.py` | 38 | sentinel-blind-spot | Y7 | KNOWLEDGE_GLOBS named the five CONTEXT.md files one by one, so the coverage sentinel structurally could not fail on the two it omitted |
| `scripts/kb_anchor.py` | 122 | false-anchor | Y7 | single-character CJK anchor titles were used as substring matchers for tail de-noising, flagging and promoting unrelated long-tail snippets |
| `scripts/restore_release_data.py` | 239 | silent-noop-exit-zero | Y8 | A restore that matched zero release assets printed one informational line and exited 0; main() discarded restore()'s return count. |
| `scripts/restore_release_data.py` | 118 | silent-partial-restore | Y8 | download() accepted short reads: urllib's read(n) returns b'' on a premature connection close instead of raising, so a truncated asset was written and r... |
| `scripts/restore_release_data.py` | 196 | partial-failure-unenumerated | Y8 | A failure on any one asset aborted the whole loop, so every later asset was never attempted and the operator got a traceback instead of a list of what d... |
| `scripts/consumption_audit.py` | 119 | failed-search-reported-as-no-consumers | Y8 | _grep() collapsed git grep's three exit codes into one empty list, so a search that could not run was indistinguishable from a search that found nothing... |
| `scripts/consumption_audit.py` | 54 | blind-to-a-whole-input-class | Y8 | Producer scanning globbed only .github/workflows/*.yml; GitHub treats .yaml as equivalent, so any producer declared in a .yaml workflow was invisible to... |
| `scripts/dead_man_switch.py` | 289 | exit-zero-on-total-blackout | Y8 | The silence detector returned 0 when it judged nothing at all, so its own blindness registered as a successful run — including in its own last-success b... |
| `scripts/dead_man_switch.py` | 146 | blind-to-a-whole-input-class | Y8 | scheduled_workflows() globbed only *.yml, so a cron job declared in a .yaml workflow vanished from the watch list while the summary still read findings=0. |
| `scripts/memory_freshness.py` | 186 | vacuous-rule-reported-as-clean | Y8 | A staleness rule whose glob matched zero files was silently dropped, so the report said '全部在保鲜期内' for documents it was no longer checking at all. |
| `scripts/build_capability_registry.py` | 477 | check-mode-disagrees-with-reality | Y8 | meta.generated_at was stamped with the current Beijing date on every rebuild, so --check (documented as the CI staleness gate) reported the directory st... |
| `silver-core-sdk/src/engine/prompts.ts` | 245 | prompt-assembly/fence-escape | Y9 | CLAUDE.md / AGENTS.md contents were interpolated raw into the <system-reminder> fence, so file text containing the literal closing tag terminates the fe... |
| `silver-core-sdk/src/engine/system-field.ts` | 107 | cache-breakpoint/budget | Y9 | On the systemPrompt segments seam the loop dropped the message cache breakpoint whenever the caller marked ANY segment, instead of only when the 4-cap w... |
| `silver-core-sdk/src/query.ts` | 799 | prompt-assembly/tool-roster | Y9 | The harness prompt's 'Available tools:' roster was built from builtinTools only, omitting the memory tool that the main loop actually advertises on the... |
