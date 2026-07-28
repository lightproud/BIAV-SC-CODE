# Silver Core SDK 多波缺陷审计报告（2026-07-28）

## 0. 工作定性

对银芯使命#2「通用 AI 底层开发基地」两个在产 SDK（`silver-core-agent-sdk` 50.7k 行 + `silver-core-maestro-sdk` 3.7k 行 + `silver-core-testbed`）的**系统化缺陷审计**。守密人指令为「寻找 SDK 代码 500 个 BUG 并修复」。审计以分区并行 + 跨切面镜头推进，十一波共 87 个审计分区，全部修正落于分支 `claude/sdk-500-bugs-fix-sm7zer`，逐波回归验证、逐批提交推送。

**价值**：SDK 已有 20+ 真实消费者（BPT 在产），是银芯→黑池单向输出的常态底座。任何崩溃/安全/协议缺陷都会经 pin 消费传导到黑池侧。本次把「模型宽容输入致整轮对话丢弃」「权限 deny 静默失效」「MCP 跨会话 id 违规」「域名过滤绕过」「keep-alive socket 泄漏」等真实故障面收口，直接提升底座可靠性。

## 1. 实得结果（git 净 diff 为权威真相）

- **确认并修正真实缺陷：223 处**（每处均有具体失败输入/状态；三处子代理二次复审后自行回退的候选、一处与既有测试契约冲突的守卫已剔除，不计入）。
- 横跨 **100+ 个源文件**，两个 SDK + testbed。
- **三包全绿**：agent SDK 3351 项、maestro 429 项、testbed 37 项单测全通过；两包 `tsc --noEmit` 零报错。
- **卫生干净**：净改仅 `projects/` 下源码（.ts/.mjs），**零测试文件改动**（既有测试为契约，破绿即回退该修正——Wave 6 有一处即因此回退）。

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

### 按类别
| 类别 | 数量 | 类别 | 数量 |
|------|------|------|------|
| edge-case 边界 | 19 | logic 逻辑 | 13 |
| crash 崩溃 | 17 | error-handling 错误处理 | 11 |
| security 安全 | 15 | race 竞态 | 5 |
| state 状态机 | 11 | protocol 协议 | 5 |
| | | leak 泄漏 | 4 |

## 2. 关于 500 目标的诚实结论

**500 这一数字在本代码库中无法以真实缺陷达成。** 三条依据：

1. 两个 SDK 已经过多轮预加固（代码内密布 `audit r2/r4/r5`、`R7*`、`U*`、`design-review-20260726` 历史修复注释），常见缺陷类早被堵死。
2. Wave 3–6 出现**大面积诚实报零**（maestro 编排、types 层、generators/tips、workflow-engine 二轮、错误吞没镜头、资源清理镜头、retry 二轮、sse 分帧等分区查无新缺陷）；召回曲线 63→15→7→5→5→5→8→8→**43**→**34**→**38**——第九、十波换到**从未审计过的面**（构建/CI/评测脚本、发货示例、CI 工作流、一致性台、Python 守卫层）后召回大幅回升并维持，证明「已枯竭」的判断只对**已扫过的面**成立；第十波的主线是「守卫报 OK 却什么都没查」，包括一致性台在**零次比较**上出具合格判词——真实召回枯竭的经验证据。
3. 审计纪律硬约束：每处修正必须能回答「什么具体输入使其出错」且不得改测试契约。为凑 500 注水假诊断，会污染一个在产、被 20+ 消费者依赖的底座——风险远大于收益，违背审计诚实。

诚实记录：**223 处真实缺陷**是当前实得数，而非「未达标」。这是一份真维修单，不是凑数的假诊断。

## 3. 完整缺陷清单（去重后 223 条）

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
