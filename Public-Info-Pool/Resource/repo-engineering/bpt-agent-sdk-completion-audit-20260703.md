# BPT Agent SDK 完成度审计——对照最新官方 Claude Agent SDK（2026-07-03）

## 0. 方法与锚点

| 项 | 值 |
|---|---|
| 官方锚点 | `@anthropic-ai/claude-agent-sdk` npm 最新 **0.3.199**；官方文档 30 页（code.claude.com/docs/en/agent-sdk/* 全量 + changelog + migration-guide）2026-07-03 当日抓取 |
| 我方对象 | `projects/bpt-agent-sdk` v0.1.0（净室实现，直连 Messages API，无 CLI 子进程） |
| 方法 | ultracode 工作流：10 个读取代理分片吞下全部文档 → 918 条特征项 → 1 个综合代理**对照实际 src 代码**（非仅对照我方自述文档）逐条判定 |
| 判定五档 | FULL（语义齐全）/ PARTIAL（子集）/ ACCEPTED（只收不做）/ MISSING（全无）/ N-A-BY-DESIGN（架构上刻意移除，如子进程相关） |
| 数据层 | 完整矩阵 146 行见同目录 `bpt-agent-sdk-completion-matrix-20260703.json`（本报告为策展层，机器可读层以 JSON 为准） |

小学生比喻：拿着对方最新出厂说明书逐页清点自家仿制机——「有」「有一半」「只留了接口没通电」「压根没有」「本来就故意不装」五种贴纸逐个零件贴。

## 1. 总分

**P0+P1 加权完成率：68.3%**（权重 FULL=1 / PARTIAL=0.6 / ACCEPTED=0.15 / MISSING=0，排除 N-A-BY-DESIGN）。

| 档位 | 行数 | 占比 |
|---|---|---|
| FULL | 30 | 20.5% |
| PARTIAL | 43 | 29.5% |
| ACCEPTED | 24 | 16.4% |
| MISSING | 41 | 28.1% |
| N-A-BY-DESIGN | 8 | 5.5% |
| 合计 | 146 | 100% |

优先级交叉（对 BPT 桌面端换装最关键的两级）：

| | FULL | PARTIAL | ACCEPTED | MISSING |
|---|---|---|---|---|
| **P0**（换装阻断级） | 14 | 11 | 0 | 0 |
| **P1**（重要） | 11 | 14 | 2 | 7 |

**关键结论：P0 级零 MISSING**——BPT 换装所需的每一件东西至少已存在子集实现；11 条 P0 PARTIAL 中 7 条为 S 工作量（半天内）。核心环（query/流式/工具环/权限/hooks/MCP/会话）骨架完整且 271 测试全绿。

比喻：房子已经能住——水电煤气全通（P0 无缺件），但有 11 个插座是两孔的还没换三孔（PARTIAL），另有一批「智能家居」根本没装（P1/P2 MISSING）。

## 2. 最新官方架构拼图——我方未建模的子系统

官方 0.3.x 架构在我方 v0.1 设计图之外还有以下大块（按对 BPT 的影响排序）：

| # | 官方子系统 | 内容 | 我方状态 | 对 BPT 影响 |
|---|---|---|---|---|
| 1 | **上下文压缩** | 自动 compact / microcompaction / compact_boundary 消息 / PreCompact 钩子 | 无压缩引擎，history 涨到 API 拒绝为止 | **长对话必撞墙**（P1/L） |
| 2 | **消息流 33 变体** | tool_progress / permission_denied / rate_limit_event / task_* / hook 生命周期等 | 我方 7 变体 | 桌面 UI 少一批可展示信号（P1/L） |
| 3 | **自动提示缓存** | cache_control 断点自动放置 | 每轮全价重发输入 | **直接成本**（P1/M） |
| 4 | **子代理运行时** | Agent 工具 / AgentDefinition 执行 / 后台子代理 / 5 层嵌套 | 类型收下、零执行 | 高级功能缺位（P1/XL） |
| 5 | **结构化输出** | outputFormat json_schema + 校验重试环 + structured_output 结果字段 | 收下告警 | 表单类场景缺位（P1/M） |
| 6 | **后台任务框架** | run_in_background Bash / Monitor / TaskOutput / 停滞看门狗 | 无 | P2 |
| 7 | **工具搜索** | 延迟加载 MCP schema，超大工具集省上下文 | 每轮全量发 schema | 大 MCP 场景成本（P2） |
| 8 | **文件检查点** | enableFileCheckpointing / rewindFiles / dryRun | 无 | P2（桌面「撤销」体验） |
| 9 | **外部会话存储** | SessionStore 适配器（S3/Redis）双写 / 冲刷模式 | 仅本地 JSONL | P2 |
| 10 | **设置引擎** | settingSources / CLAUDE.md / 设置文件 hooks / skills / plugins / 斜杠命令 / 输出风格 | 无（ACCEPTED） | P2-P3（BPT 是应用不是 CLI 宿主） |
| 11 | **沙箱** | bubblewrap 网络/文件白名单、Bash AST 级规则解析 | 普通 spawn + 前缀规则 | P2（安全纵深） |
| 12 | **OTel 可观测性** | spans / TRACEPARENT / 指标 | 无 | P2 |
| 13 | **第三方供应商** | Bedrock / Vertex / Foundry 开关 | 仅直连 Anthropic（+ 自有 provider 扩展） | P3 |
| 14 | **权限扩展** | 'auto' 分类器模式 / ask 规则一等公民 / defer 延后决策流 | 无 auto、ask 规则收而不判、无 defer | 见 §3 P0 项 |
| 15 | 用户输入面 | AskUserQuestion 工具 / MCP elicitation | 无 | P1（聊天 UI 结构化追问） |
| 16 | V2 会话 API | 已于官方 0.3.142 **移除**（createSession send/stream） | 无需实现 | 仅需在 COMPAT 注明防换装疑问 |
| 17 | 预热生命周期 | startup()/WarmQuery/reinitialize | N-A-BY-DESIGN（无子进程可预热） | 可加空壳保类型兼容 |
| 18 | 会话互操作 | 官方 ~/.claude/projects 磁盘布局 | 我方 ~/.bpt-agent 自有布局 | 设计取舍需成文 |

比喻：我们照说明书造出了整台发动机和底盘（能开），但对方最新款还带自动挡（压缩）、油耗优化（缓存）、全套仪表盘（33 种消息灯）和自动泊车（子代理）——这些在我们的图纸上还是空白页。

## 3. P0 缺口全列（11 条 PARTIAL，零 MISSING）

| # | 特征 | 差距 | 工作量 | 处置 |
|---|---|---|---|---|
| 1 | allowedTools | 允许规则在权限模式**之前**判定：plan 模式下 allow 规则会放行写工具（官方：plan 下文件编辑绝不自动放行） | S | **即修**（判定序调整） |
| 2 | disallowedTools | 裸名 deny 未从模型请求里**摘除工具定义**（模型仍看得见、会尝试调用）；deny 位 `*`/`mcp__*` 通配缺 | S | **即修** |
| 3 | canUseTool | suggestions/requestId 未传；返回 null 被当 deny（官方语义：null=应用已自行响应，跳过） | M | v0.2 |
| 4 | permissionMode | 缺 'auto'（模型分类器）；plan 对写工具直接 deny 而非转 canUseTool；acceptEdits 未限定 cwd 范围 | M | v0.2（plan 转发部分即修） |
| 5 | 权限判定序 | 官方为 6 步序（含 ask 规则一等公民、defer）；我方 9 步序在复合态有偏差 | M | v0.2 重排 |
| 6 | systemPrompt | preset 'claude_code' 映射为**自有净室提示词**（刻意，净室纪律）；excludeDynamicSections 缺 | S | 保持（成文即可） |
| 7 | includePartialMessages | 事件透传齐全；ttft_ms 缺 | S | v0.2 |
| 8 | mcpServers | stdio/http/sdk 全通；legacy sse 未实现；.mcp.json 文件源不读 | S | v0.2 |
| 9 | Read 工具 | 纯文本；图像/PDF/notebook 不渲染 | M | v0.2 |
| 10 | Bash 工具 | 单发 bash -c（无持久 shell、无 run_in_background、无沙箱、前缀级规则非 AST 级） | L | v0.2+ |
| 11 | result 消息 | 核心字段全对；官方新增 extras（ttft/structured_output/errors[] 等）缺；**error_max_budget 应更名 error_max_budget_usd（官方真名，非我方扩展——命名踩碰）** | M | 更名**即修**，extras v0.2 |

## 4. P1 缺口摘要（23 条非 FULL）

- **S 工作量、可立即收割**：tool() 第 5 参 annotations；thinking 字段名 budgetTokens（现为 budget_tokens，类型级断裂）；continue 未按 cwd 过滤；init 消息缺 4 字段；PreToolUse/PostToolUse 入参缺 tool_use_id/duration_ms；UserPromptSubmit block 在流式模式下应保活会话而非终局；mcpServerStatus 缺 config/scope/tools；reconnect/toggle 未上浮到 Query；CallToolResult 缺 audio/resource_link。
- **M 工作量**：WebFetch/WebSearch 工具；AskUserQuestion 工具；自动提示缓存；setMcpServers()；结构化输出。
- **L/XL**：上下文压缩；33 变体消息流；子代理运行时。

## 5. COMPAT.md 修正清单（17 处，均已核对实际代码）

自述兼容矩阵有 17 处与代码事实不符（多为高估半档），最重要五处：

1. `error_max_budget` 标成「BPT 扩展」是**误标**——官方存在真子类型 `error_max_budget_usd`，我方撞名走样，换装方按官方名 switch 会**静默漏接**预算停机。→ 代码更名。
2. hooks 表 `Notification | PARTIAL`：实际**零触发路径**（grep 证实仅类型存在）→ 应为 ACCEPTED。
3. hooks `defer | 视为 deny`：实际 runner 无 defer 分支，未识别值**掉空**后可能仍被规则放行——比文档写的**更宽松**，方向性错误。→ 代码补 deny 分支。
4. 四个官方 Options 字段（agent / settings / permissionPromptToolName / extraArgs）完全没进类型也没进告警清单，违反自述「ACCEPTED 键各告警一次」契约。→ 补入。
5. allowedTools/disallowedTools/canUseTool/PostToolBatch/MessageDisplay/init/result/tool()/thinking/mcpServerStatus 等 10 处 FULL → 应降 PARTIAL（差距见 §3/§4）。

比喻：自家体检表有 17 格勾得太大方——不是病没查出来，是把「基本正常」写成了「完全正常」；这次全部改回实话，其中两格（1、3）不是改表格，得回手术台补一刀。

## 6. v0.2 路线图建议（按性价比排序）

| 批次 | 内容 | 合计工作量 |
|---|---|---|
| **v0.1.1 即修**（随本审计落地） | P0 #1 #2 判定序 + 工具摘除；error_max_budget_usd 更名；defer→deny 分支；4 个 ACCEPTED 键补告警；COMPAT.md 全量对账 | ~1 天 |
| v0.2 第一批（S 项收割） | §4 S 清单全量 + P0 #7 #8 | ~3 天 |
| v0.2 第二批（BPT 体验关键） | 自动提示缓存（省钱）、上下文压缩（长对话）、AskUserQuestion、WebFetch/WebSearch、结构化输出、canUseTool 全语义 | ~2 周 |
| v0.3 | 子代理运行时、消息流扩容、文件检查点、外部会话存储 | 数周 |

## 7. 分区完整矩阵

（146 行全量，五档判定 + 工作量 + BPT 优先级；机器可读版见 JSON 文件）

### functions（5 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| query() entry point (string + AsyncIterable prompt) | query({prompt, options}): Query async generator; primary entry point | FULL | Both prompt modes implemented; unified input queue; direct Messages API engine instead of CLI subprocess | S | P0 |
| tool() | tool(name, desc, zodShape, handler, extras?: {annotations: ToolAnnotations}); Zod 3 and 4 | PARTIAL | No 5th extras param — ToolAnnotations typed on SdkMcpToolDefinition but never attachable/populated; zod v4 onl | S | P1 |
| createSdkMcpServer() | {name, version?, tools?} -> McpSdkServerConfigWithInstance in-process server | FULL | In-process dispatch, zod-validated handlers, Map semantics for dup names | S | P1 |
| startup() / WarmQuery | Pre-warm CLI subprocess before prompt exists; AsyncDisposable handle | N/A-BY-DESIGN | No subprocess spawn/init cost exists in direct-API design; first request is already cheap. A no-op shim could  | S | P3 |
| extractFromBunfs() | Extract embedded native binary from bun-compiled executable | N/A-BY-DESIGN | No bundled native binary; pure-JS package works inside bun compile directly | S | P3 |

### sessions（7 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| listSessions() | ({dir?, limit?, includeWorktrees?}) over ~/.claude store, sorted lastModified desc | PARTIAL | Reads own JSONL store only; option bag is {sessionDir} not {dir, limit, includeWorktrees}; no worktree awarene | S | P2 |
| getSessionInfo() | Returns SDKSessionInfo / undefined | PARTIAL | Returns null instead of undefined; own store only; SDKSessionInfo lacks tag/gitBranch | S | P2 |
| getSessionMessages() | (sessionId, {dir?, limit?, offset?}) -> SessionMessage[] | MISSING | Not exported; transcript is readable via internal store.load() but no public message-level API | S | P2 |
| renameSession() / tagSession() | Append custom-title/tag entries, latest wins | MISSING | Absent; SDKSessionInfo.customTitle typed but nothing writes it | S | P3 |
| deleteSession()/forkSession()/listSubagents()/getSubagentMessages() standalone fns | Session-storage page: standalone functions accepting sessionStore option | MISSING | None exported; fork exists only as query option | M | P3 |
| Claude Code session-store interop (~/.claude/projects/<encoded-cwd>/*.jsonl, CLAUDE_CONFIG_DIR, cleanupPeriodDays) | Shared on-disk transcript layout resumable by CLI and SDK | MISSING | Own ~/.bpt-agent/sessions layout and schema; cannot read or resume existing Claude Code sessions; no cwd encod | M | P2 |
| Session metadata richness (summary generation, tag, gitBranch) | summary = title/auto-summary/first prompt; tag; gitBranch | PARTIAL | summary = firstPrompt only; no tag/gitBranch capture | S | P3 |

### settings（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| resolveSettings() / ResolvedSettings | Alpha: resolve effective settings with CLI merge engine, provenance, sources | MISSING | No settings engine at all | L | P3 |

### deployment（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| npm bundled native binary + platform packages + bun compile flow | Optional-dep platform binaries; pathToClaudeCodeExecutable fallback | N/A-BY-DESIGN | The removal of the binary is the product thesis; nothing to bundle | S | P3 |

### options（54 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| abortController | AbortController for cancelling operations | FULL | Outer signal wired through queue, transport, tools, hooks | S | P0 |
| additionalDirectories | Extra directories Claude can access | FULL | Enforced via resolveWithin containment in fs tools (no symlink-escape handling, documented) | S | P1 |
| agent (main-thread agent name) | Agent for main thread; must exist in agents or settings | MISSING | Not typed, not in ACCEPTED warn list — silently ignored with no warning | M | P2 |
| agents (programmatic subagent definitions) | Record<string, AgentDefinition>; drives Agent tool | ACCEPTED | Typed subset (missing mcpServers/skills/initialPrompt/background/memory/effort/criticalSystemReminder fields); | XL | P1 |
| agentProgressSummaries / forwardSubagentText | Subagent progress summaries; forward subagent text blocks | ACCEPTED | Warned + ignored; meaningless until subagents exist | M | P3 |
| allowDangerouslySkipPermissions | Required gate for permissionMode bypassPermissions | ACCEPTED | bypassPermissions works WITHOUT this flag — the official safety interlock is absent | S | P2 |
| allowedTools | Auto-approve list; does not restrict availability; glob restrictions on MCP allow rules | PARTIAL | Rule matching incl. Tool(spec) prefix + mcp__srv__* works, but rules evaluate BEFORE permission mode: in plan  | S | P0 |
| disallowedTools | Bare name removes tool from context; scoped rule denies matching calls in every mode; * /  | PARTIAL | Scoped deny works in all modes incl. bypass; but bare name does NOT remove the tool definition from the model  | S | P0 |
| betas | SdkBeta[] enable beta features | FULL | string[] forwarded/merged into anthropic-beta header (looser type than SdkBeta[]) | S | P2 |
| canUseTool | (toolName, input, {signal, suggestions?, blockedPath?, decisionReason?, toolUseID, agentID | PARTIAL | Invoked only on prompt-fallthrough (correct), updatedInput/updatedPermissions honored; but suggestions and req | M | P0 |
| continue | Continue most recent conversation in cwd | PARTIAL | Resumes latest session from own store, not scoped by cwd, cannot see Claude Code CLI sessions | S | P1 |
| cwd | Working directory | FULL | Wired to tools, containment, session meta | S | P0 |
| debug / debugFile | Debug mode; debugFile implies debug | PARTIAL | debug -> stderr callback works; debugFile accepted + ignored | S | P3 |
| effort | 'low'..'max' response effort | ACCEPTED | Warned + ignored; no mapping to API effort/thinking | M | P2 |
| enableFileCheckpointing + Query.rewindFiles() + RewindFilesResult | Track Write/Edit/NotebookEdit changes; rewind to user-message UUID with dryRun | MISSING | Option warn-ignored; rewindFiles absent from Query type entirely; no checkpoint store | L | P2 |
| env | Replaces subprocess environment when set | FULL | Replace semantics preserved for transport + Bash tool env | S | P1 |
| executable / executableArgs / pathToClaudeCodeExecutable / spawnClaudeCodeProcess (+ SpawnedProcess/SpawnOptions) | CLI runtime + custom process spawner | N/A-BY-DESIGN | No subprocess exists; all four accepted + warn-ignored per COMPAT engine-difference section | S | P3 |
| extraArgs | Extra CLI flags (e.g. replay-user-messages) | N/A-BY-DESIGN | No CLI to pass flags to; note: user-message uuids are always populated here, so the replay-user-messages use c | S | P3 |
| fallbackModel | Fallback on failure; CLI chains up to 3 fallback models | PARTIAL | Single fallback model, one retry per turn on 429/5xx/529, then permanently switched for the run | S | P2 |
| forkSession | Fork resumed session to new ID, original untouched | FULL | Transcript copied under new UUID in own store | S | P2 |
| hooks option (registration, matchers, timeout, parallel aggregate) | Partial<Record<HookEvent, HookCallbackMatcher[]>>; parallel exec, most-restrictive wins, t | FULL | Parallel Promise.allSettled, deny>ask>allow aggregation, per-matcher timeout default 60s — matches docs (per-e | S | P1 |
| includeHookEvents | Emit SDKHookStarted/Progress/Response messages | ACCEPTED | Warned + ignored; no hook lifecycle messages exist in stream | M | P3 |
| includePartialMessages / stream_event | Yield SDKPartialAssistantMessage wrapping BetaRawMessageStreamEvent; ttft_ms on message_st | PARTIAL | Raw SSE events forwarded with uuid/session_id/parent_tool_use_id; ttft_ms field absent | S | P0 |
| loadTimeoutMs / sessionStoreFlush | Alpha sessionStore knobs | ACCEPTED | Warned + ignored (sessionStore itself absent) | S | P3 |
| managedSettings | Policy-tier settings from embedding host, restrictive-only filter | ACCEPTED | Warned + ignored; no policy tier | L | P3 |
| maxBudgetUsd | Stop at estimated USD; result subtype error_max_budget_usd | PARTIAL | Enforced against estimate, but emits subtype 'error_max_budget' — official consumers switching on 'error_max_b | S | P2 |
| maxThinkingTokens (deprecated) | Max thinking tokens; superseded by thinking | PARTIAL | Only used as budget fallback when thinking.type==='enabled'; set alone it never enables thinking | S | P3 |
| maxTurns | Cap tool-use round trips; error_max_turns | FULL | Enforced in engine loop with matching subtype | S | P1 |
| mcpServers | stdio / sse / http / sdk config union | PARTIAL | stdio/http/sdk connect + tools/call work; sse legacy transport throws NotImplementedError (status failed); no  | S | P0 |
| model | Model alias or full name; default from CLI | FULL | options.model > ANTHROPIC_MODEL env > claude-sonnet-4-5 default (default is dated vs official sonnet-5) | S | P0 |
| onElicitation | MCP elicitation callback; unhandled -> auto-declined | ACCEPTED | Warned + ignored; server-initiated requests answered -32601 at protocol level, callback never reachable | M | P2 |
| outputFormat (structured outputs) | {type:'json_schema', schema}; validate final output, retry loop, structured_output on resu | ACCEPTED | Warned + ignored; no schema validation, no structured_output field on result type | M | P1 |
| permissionMode | default / acceptEdits / bypassPermissions / plan / dontAsk / auto | PARTIAL | 5 of 6 modes ('auto' absent from type); plan mode denies writes outright instead of routing them to canUseTool | M | P0 |
| permissionPromptToolName | MCP tool name for permission prompts | MISSING | Not typed, not warn-listed, silently ignored | M | P3 |
| persistSession | Default true; false disables disk persistence | FULL | Gates all JSONL writes | S | P1 |
| planModeInstructions | Replace plan-mode workflow body | ACCEPTED | Warned + ignored; no plan-mode prompt scaffolding exists at all | S | P3 |
| plugins (SdkPluginConfig) | Local plugins: skills/agents/hooks/MCP; skipMcpDiscovery | ACCEPTED | Warned + ignored; no plugin loader | XL | P2 |
| promptSuggestions (+ SDKPromptSuggestionMessage) | Predicted next prompt after each turn | ACCEPTED | Warned + ignored; message variant absent | M | P3 |
| resume / sessionId | Resume by ID; pin session UUID | FULL | Full within own store; unknown resume id starts fresh under that id (debug-logged). Cross-store interop tracke | S | P0 |
| resumeSessionAt | Resume at specific message UUID | ACCEPTED | Warned + ignored | S | P2 |
| sandbox (SandboxSettings + network/filesystem configs + startup-failure semantics) | Sandboxed Bash via bubblewrap/socat, domain allowlists, dangerouslyDisableSandbox fallback | ACCEPTED | Warned + ignored; Bash runs unsandboxed always | XL | P2 |
| sessionStore (interface, InMemorySessionStore, mirror retry/mirror_error, conformance suite) | External transcript mirroring: append/load required, listSessions/delete/listSubkeys optio | MISSING | Option warn-ignored; no adapter interface, no InMemorySessionStore export, no mirror_error message | L | P2 |
| settings (inline settings object / flag-settings layer) | string / Settings populating flag-settings precedence layer | MISSING | Not typed, not warn-listed, silently ignored | M | P2 |
| settingSources (user/project/local loading: CLAUDE.md, settings.json rules+hooks, .mcp.json, skills discovery, output styles, precedence) | Omitted = all sources like CLI; [] disables; project loads CLAUDE.md/rules/skills/hooks | ACCEPTED | Warned + loads nothing; zero filesystem config in v0.1 (equivalent to a permanent settingSources: []) | L | P2 |
| skills option + Skill tool + SKILL.md lifecycle | 'all' / names; auto-adds Skill tool; context filter not sandbox | ACCEPTED | Warned + ignored; no Skill tool, no discovery | XL | P2 |
| stderr callback | Subprocess stderr output | PARTIAL | Receives this SDK's debug lines instead (no subprocess stderr exists) | S | P3 |
| strictMcpConfig | Only option-passed servers; ignore .mcp.json/settings/plugins/connectors | FULL | Trivially true — options servers are the only source that exists | S | P2 |
| systemPrompt | string / {preset:'claude_code', append?, excludeDynamicSections?}; preset = actual Claude  | PARTIAL | String + preset + append work, but preset maps to this SDK's own clean-room harness prompt (NOT Claude Code's) | S | P0 |
| taskBudget | Alpha API-side token budget | ACCEPTED | Warned + ignored | M | P3 |
| thinking (ThinkingConfig) | {type:'adaptive'/'enabled'/'disabled'; budgetTokens?; display?} | PARTIAL | enabled/disabled mapped to API; adaptive silently omitted (API default); fields named budget_tokens/budget ins | S | P1 |
| title | Display title for session | ACCEPTED | Warned + ignored; renameSession also absent | S | P3 |
| toolAliases | Map built-in names to MCP implementations | ACCEPTED | Warned + ignored | S | P2 |
| toolConfig (askUserQuestion.previewFormat) | Opt into AskUserQuestion previews | ACCEPTED | Warned + ignored; AskUserQuestion tool itself absent | S | P3 |
| tools option | string[] / {preset:'claude_code'} over ~30 built-ins | PARTIAL | Array filters our 6 built-ins; unknown names debug-ignored; preset/undefined = all 6 (official preset = full C | S | P1 |

### env-vars（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Runtime env knobs (API_TIMEOUT_MS, CLAUDE_CODE_MAX_RETRIES, CLAUDE_CODE_RETRY_WATCHDOG, stream watchdog vars, CLAUDE_AGENT_SDK_CLIENT_APP) | Env-var configured timeout/retry/watchdog behavior | MISSING | None of these env vars are read; equivalent knobs only via BPT provider extension (timeoutMs/maxRetries); no s | S | P2 |

### query-methods（17 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| interrupt() | Streaming-input mode only | FULL | Aborts current turn; superset — also usable in string mode (ends run) | S | P0 |
| setPermissionMode() | Change mode mid-session (streaming) | FULL | Effective immediately for subsequent tool calls | S | P1 |
| setModel() | Change model (streaming) | FULL | Takes effect next assistant turn; undefined restores initial | S | P1 |
| setMaxThinkingTokens() | Deprecated; change thinking budget | PARTIAL | Mutates config but only effective when thinking.type==='enabled', from next user turn | S | P3 |
| applyFlagSettings() | Runtime merge into flag-settings layer (model/permissions/hooks/agent...) | MISSING | Absent from Query type; no settings layer to merge into | M | P2 |
| initializationResult() | SDKControlInitializeResponse {commands, agents, output_style(s), models, account, fast_mod | PARTIAL | Own SDKInitializationResult shape without fast_mode_state; static/empty data (no CLI to introspect) | S | P1 |
| reinitialize() + pending_permission_requests redelivery | Re-send initialize after transport gap; redeliver pending canUseTool requests | N/A-BY-DESIGN | In-process engine has no detachable transport; permission callbacks cannot be orphaned by disconnects | S | P3 |
| supportedCommands() | SlashCommand[] snapshot | PARTIAL | Always []; SlashCommand type lacks argumentHint/aliases | M | P3 |
| supportedModels() | ModelInfo[] {value, resolvedModel?, displayName, description, supportsEffort...} | PARTIAL | Static 4-entry list; ModelInfo shape is {id, displayName?} — official field is 'value', consumers reading .val | S | P2 |
| supportedAgents() | AgentInfo[] {name, description, model?} | PARTIAL | Always []; AgentInfo lacks model field | S | P3 |
| mcpServerStatus() | McpServerStatus[] incl. config/scope/tools listing | PARTIAL | name/status/serverInfo/error only; no config, scope, or per-server tools[] (BPT UI showing server tool lists m | S | P1 |
| accountInfo() | {email?, organization?, subscriptionType?, tokenSource?, apiKeySource?} | PARTIAL | apiKeySource only; ApiKeySource enum deviates ('none' instead of 'oauth') | S | P2 |
| reconnectMcpServer() / toggleMcpServer() | Reconnect / enable-disable server by name | PARTIAL | Registry implements reconnect()/setEnabled() but neither is surfaced on the Query interface | S | P1 |
| setMcpServers() | Replace server set at runtime -> {added, removed, errors} | MISSING | Absent from Query and registry; McpSetServersResult type absent | M | P1 |
| streamInput() | Push additional SDKUserMessage stream (streaming mode) | FULL | Pumps into shared queue; throws in string mode / after close per docs spirit | S | P0 |
| stopTask() | Stop background task by ID (also teammates/agents v2.1.198) | MISSING | No background task framework at all | L | P2 |
| close() | Terminate and clean up all resources | FULL | Aborts turn + queue + outer signal, fires SessionEnd, closes MCP | S | P0 |

### subagents（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Agent tool + AgentDefinition execution (foreground/background, nesting, resolvedModel, parent_tool_use_id wiring, resume) | Full subagent runtime: Agent tool input schema, background-by-default (v2.1.198), 5-level  | MISSING | No Agent tool registered; agents option accepted-ignored; parent_tool_use_id always null in stream | XL | P1 |

### permissions（4 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Permission evaluation order + ask rules | Hooks -> deny rules -> ask rules -> mode -> allow rules -> canUseTool; ask rules force pro | PARTIAL | Order deviates: allow rules evaluated before mode (step 4 vs official step 5); ask rules stored via applyUpdat | M | P0 |
| PermissionMode 'auto' (model classifier) | Classifier approves/denies each call; TS-only | MISSING | Absent from PermissionMode union entirely | L | P2 |
| PermissionUpdate destinations + persistence | userSettings/projectSettings/localSettings/session/cliArg; localSettings writes .claude/se | PARTIAL | Only destination 'session' honored (others debug-warned); 'cliArg' missing from type; removeDirectories ignore | M | P2 |
| CLAUDE_SDK_CAN_USE_TOOL_SHADOWED warning | process warning when canUseTool unreachable | MISSING | No shadowing detection | S | P3 |

### hooks（17 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| PreToolUse hook | Input {tool_name, tool_input, tool_use_id}; allow/deny/ask/defer + updatedInput + addition | PARTIAL | allow/deny/ask + updatedInput work with correct precedence; input object lacks tool_use_id field (only 2nd cal | S | P1 |
| PostToolUse hook | Input {tool_name, tool_input, tool_response, tool_use_id, duration_ms?}; additionalContext | PARTIAL | additionalContext + updatedToolOutput both honored; input lacks tool_use_id and duration_ms fields; deprecated | S | P1 |
| PostToolUseFailure hook | Fires on tool execution failure with error string | FULL | Fires on thrown tool errors (isError payloads correctly go to PostToolUse); is_interrupt/duration_ms optional  | S | P2 |
| PostToolBatch hook | Input {tool_calls: [{tool_name, tool_input, tool_use_id, tool_response?}]} once per batch | PARTIAL | Fires once per batch but input is {tool_names: string[]} — no inputs/ids/responses | S | P2 |
| UserPromptSubmit hook | Block prevents the prompt; session continues; additionalContext injected | PARTIAL | additionalContext appended to prompt; but a block ENDS the entire query with error_during_execution — even in  | S | P1 |
| MessageDisplay hook | Input {turn_id, message_id, index, final, delta} per text delta/message | PARTIAL | Fires once per completed assistant message with {message_text}; no delta/turn/message identifiers | S | P2 |
| Stop / SessionStart / SessionEnd hooks | Stop at run end (ignores matchers); SessionStart source startup/resume/clear/compact; Sess | FULL | All three fire at documented points; SessionStart source limited to startup/resume (no clear/compact events ex | S | P1 |
| Notification hook | Fires on permission_prompt/idle_prompt/auth/elicitation notification types | ACCEPTED | Type exists but NO code path fires it anywhere (COMPAT's 'fired for permission denials' claim is false) | S | P2 |
| SubagentStart / SubagentStop hooks | Fire around subagent lifecycle with agent_id/transcript | ACCEPTED | Typed, never fire (no subagents) | S | P2 |
| PreCompact hook | Fires before compaction with trigger + custom_instructions | ACCEPTED | Typed, never fires (no compaction) | S | P2 |
| PermissionRequest hook | Fires when a permission dialog would display; can decide allow/deny | ACCEPTED | Typed, never fires; decision-shaped hookSpecificOutput variant absent | S | P2 |
| Setup / TeammateIdle / TaskCompleted / ConfigChange / WorktreeCreate / WorktreeRemove events | 20-event HookEvent union | MISSING | 6 of 20 events absent from HookEvent type (ours has 14) | M | P3 |
| Matcher semantics (exact-set vs regex, | and , alternatives, * wildcard) | Exact-string charset incl. hyphens; else unanchored regex; invalid regex safe | FULL | Implements documented v2.1.195+ rules incl. hyphen exact-match | S | P1 |
| Async hook outputs ({async: true, asyncTimeout}) | Fire-and-forget, cannot block/modify | FULL | Detached, neutral aggregate | S | P2 |
| BaseHookInput completeness (prompt_id, permission_mode, effort, transcript_path) | Shared fields incl. prompt_id (v2.1.196+) | PARTIAL | session_id/cwd present; transcript_path typed but never populated; prompt_id/permission_mode/effort absent | S | P3 |
| Settings-file shell hooks (command/http/mcp_tool/prompt/agent handlers) | Filesystem hooks from settings.json run alongside callbacks | MISSING | Callback hooks only; no settings loading | L | P3 |
| permissionDecision 'defer' | Ends query for later resume; deferred_tool_use on result; priority deny > defer > ask > al | MISSING | Not in HookPermissionDecision type; runner silently ignores unknown decisions — a defer-returning hook contrib | M | P2 |

### mcp（8 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| stdio transport | {command, args?, env?}; JSON-RPC over stdio; 2025-06-18 handshake | FULL | Spawn + initialize + tools/list pagination + tools/call + SIGTERM/SIGKILL close | S | P0 |
| HTTP (streamable) transport | {type:'http', url, headers?}; SSE responses; Mcp-Session-Id | FULL | POST JSON-RPC, JSON or SSE response bodies, session id echo | S | P0 |
| SSE legacy transport | {type:'sse', url, headers?} | MISSING | Constructor throws NotImplementedError; registry reports status failed | S | P2 |
| SDK in-process server dispatch | type:'sdk' instance servers, mcp__{name}__{tool} naming, permission integration | FULL | In-process Map dispatch, zod validation, isError on handler throw | S | P0 |
| claudeai-proxy connector transport | {type:'claudeai-proxy'} in status union; claude.ai connectors | N/A-BY-DESIGN | Connectors ride claude.ai subscription auth inside the CLI; direct API-key design has no such channel (officia | M | P3 |
| CallToolResult content coverage | text / image / audio / resource / resource_link + structuredContent | PARTIAL | text/image/resource mapped; audio and resource_link absent from type; structuredContent dropped | S | P1 |
| ToolAnnotations behavioral wiring (readOnlyHint -> parallel/auto-approve) | readOnlyHint enables parallel exec and read-only concurrency for MCP tools | MISSING | tool() cannot attach annotations; registry ignores server-reported annotations; MCP tools always treated readO | S | P2 |
| MCP tool search / deferred schema loading (ENABLE_TOOL_SEARCH) | Definitions deferred, discovered on demand; auto:N thresholds | MISSING | All tool schemas sent on every request | L | P2 |

### tools（17 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Read tool | Text + images + PDFs (pages) + notebooks; offset/limit | PARTIAL | Text with cat -n framing, offset/limit, binary detection only; no image/PDF/notebook rendering, no pages param | M | P0 |
| Write tool | {file_path, content}; overwrite semantics | FULL | mkdir -p, created-vs-overwritten reporting, containment enforced | S | P0 |
| Edit tool | {file_path, old_string, new_string, replace_all?} | FULL | Uniqueness/ambiguity errors per docs, containment enforced | S | P0 |
| Bash tool | Persistent shell session, timeout, run_in_background, dangerouslyDisableSandbox, AST permi | PARTIAL | One-shot bash -c per call (no persistent state), timeout+kill; no run_in_background, no sandbox flag, no AST-b | L | P0 |
| Glob tool | {pattern, path?} mtime-sorted | FULL | fast-glob, mtime desc, 100-path cap with truncation note | S | P1 |
| Grep tool | ripgrep engine; output_mode, -i/-n/-A/-B/-C, type, glob, head_limit, offset, multiline | PARTIAL | Pure-JS RegExp (perf caveat on large repos); no offset param; type map covers 10 languages; ripgrep flag -o ab | M | P1 |
| WebFetch / WebSearch tools | URL fetch + AI processing; domain-filtered search | MISSING | Not registered; no server_tool_use accounting | M | P1 |
| AskUserQuestion tool | 1-4 questions, 2-4 options, canUseTool interception, preview support | MISSING | Absent — a chat UI cannot receive structured clarifying questions | M | P1 |
| Task tools (TaskCreate/TaskGet/TaskUpdate/TaskList, TaskOutput, TaskStop) + TodoWrite + CLAUDE_CODE_ENABLE_TASKS | Task tracking default since 0.3.142; TodoWrite legacy | MISSING | No task/todo tools registered | L | P2 |
| NotebookEdit tool | Jupyter cell edits | MISSING | Not registered | M | P3 |
| Monitor tool | Background event source (command lines / WebSocket frames) | MISSING | Needs background task framework first | L | P3 |
| Workflow tool | Script-orchestrated multi-agent workflows (v0.3.149+) | MISSING | Absent; depends on subagents + background tasks | XL | P3 |
| ExitPlanMode tool | {allowedPrompts?}; plan approval protocol | MISSING | Plan mode exists as a permission filter only; no plan/exit protocol tool | M | P2 |
| EnterWorktree tool | Temporary git worktree isolation | MISSING | Absent | M | P3 |
| ListMcpResourcesTool / ReadMcpResourceTool | MCP resource listing/reading tools | MISSING | Registry speaks tools/* only; resources/* unimplemented | S | P2 |
| ToolInputSchemas / ToolOutputSchemas type exports | 29-member input union + 23-member output union exported | MISSING | No per-tool input/output type exports; consumers narrowing tool_use blocks by these types break | M | P2 |
| Parallel read-only tool execution | Read-only tools (incl. readOnlyHint MCP/custom) run concurrently; mutating tools sequentia | MISSING | All tool_use blocks execute strictly sequentially in content order | M | P2 |

### messages（6 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| system/init message | apiKeySource, claude_code_version, tools, mcp_servers, model, permissionMode, slash_comman | PARTIAL | Core fields present; claude_code_version/betas/skills/plugins fields absent; slash_commands always [] | S | P1 |
| assistant / user echo / user replay messages | SDKAssistantMessage wrapping API message; SDKUserMessage; SDKUserMessageReplay isReplay:tr | FULL | uuid/session_id/parent_tool_use_id populated; replay type exported | S | P0 |
| SDKUserMessage extensions (shouldQuery, isSynthetic, tool_use_result, origin/SDKMessageOrigin) | shouldQuery:false appends without triggering a turn; origin provenance | MISSING | Fields absent from type; every queued user message triggers a turn | M | P2 |
| result message (success + error arms) | success: result, stop_reason, ttft_ms/ttft_stream_ms, api_error_status, structured_output, | PARTIAL | Core fields (durations, usage, modelUsage, permission_denials, num_turns, total_cost_usd) correct; missing all | M | P0 |
| Context compaction (auto + /compact + compact_boundary emission + PreCompact firing + CLAUDE.md compactor guidance) | Summarize old history near context limit; emit compact_boundary | MISSING | SDKCompactBoundaryMessage type exported but never emitted; no compaction engine — long BPT chat sessions will  | L | P1 |
| Observability/status message variants (status, tool_progress, task_started/progress/updated/notification, hook_started/progress/response, auth_status, rate_limit_event, files_persisted, local_command_output, commands_changed, tool_use_summary, informational, permission_denied, worker_shutting_down, plugin_install, mirror_error, prompt_suggestion, api_retry, memory_recall, elicitation_complete, session_state_changed, notification) | 33-variant SDKMessage union | MISSING | Our union has 7 variants; 26 absent — notably SDKPermissionDeniedMessage and tool_progress that a desktop chat | L | P1 |

### types（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Usage / NonNullableUsage / ModelUsage field completeness | Usage incl. cache_creation detail, server_tool_use, service_tier, speed, inference_geo, it | PARTIAL | Token+cache fields only; server_tool_use/service_tier/speed/iterations absent; ModelUsage lacks contextWindow/ | S | P2 |

### context（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Automatic prompt caching (cache_control breakpoints, excludeDynamicSections cache reuse) | Stable prefixes automatically cached | MISSING | Engine sends no cache_control blocks; every turn pays full input token cost — direct cost impact for a chat ap | M | P1 |

### slash-commands（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Slash command dispatch (/compact, /clear, custom .claude/commands, plugin/skill commands, $ARGUMENTS) | Commands sent as prompt strings; listed in init slash_commands | MISSING | slash_commands always []; command-looking prompts pass to the model verbatim | L | P2 |

### usage-cost（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Cost tracking (total_cost_usd, per-model modelUsage/costUSD) | Client-side estimate from bundled price table; per-model breakdown | PARTIAL | Estimate from static 3-family table; unknown models cost $0; parallel same-id dedupe N/A (sequential) | S | P1 |

### auth（2 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| Third-party providers (Bedrock / Vertex / Foundry / Claude Platform on AWS env switches) | CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY + creds | MISSING | Direct Anthropic API only (apiKey/authToken/baseUrl); gateway routing via baseUrl is the sole workaround | L | P2 |
| claude.ai subscription login | Prohibited for third parties without approval; CLI-only OAuth | N/A-BY-DESIGN | API-key/bearer auth is the sanctioned third-party path; nothing to implement | S | P3 |

### observability（1 项）

| 特征 | 官方语义 | 银芯状态 | 差距 | 工作量 | BPT 优先级 |
|---|---|---|---|---|---|
| OTel telemetry (CLAUDE_CODE_ENABLE_TELEMETRY, exporters, spans, trace-context propagation, sensitive-content opt-ins) | CLI-embedded OTel instrumentation configured via env | MISSING | No telemetry emission of any kind; would need first-party reimplementation in the engine | XL | P3 |
