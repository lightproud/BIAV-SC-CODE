# BPT Agent SDK × 官方 TypeScript 文档逐条接口对账（2026-07-05）

## 0. 方法与锚点

| 项 | 值 |
|---|---|
| 官方锚点 | code.claude.com/docs/en/agent-sdk/typescript **live 文档**（2026-07-05 取回，`.md` 直取原文 3550 行）；仓内快照 `Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md` |
| 我方对象 | `projects/bpt-agent-sdk` v0.6（E1–E5 引擎对齐后，1049 单测全绿） |
| 钉版基线 | 一致性套件钉 `agent-sdk 0.3.199` + `claude-code 2.1.201`（`tests/conformance/pins.json`）；live 文档已含钉版之后的新增面——凡疑似新增一律标 **NEW-IN-DOCS** 挂账，不计我方缺陷 |
| 前作 | `bpt-agent-sdk-completion-audit-20260703.md`（+ 机器矩阵 `bpt-agent-sdk-completion-matrix-20260703.json`，146 行）——那是 **v0.1 时代**的特征级完成度审计；其 41 行 MISSING 大多已在 v0.2–v0.6 毕业。本档为其**接口/字段级续篇**：粒度从「特征有没有」下钻到「每个类型每个字段名对不对」 |
| 方法 | 官方文档五区段（A 函数+Options / B Query+配置类型 / C 消息流+Hook / D 工具输入输出 / E 权限+其他类型+沙箱）五路并行代理逐条比对，对照 `src/types.ts`、`src/index.ts`、实现文件与 `docs/COMPAT.md`，逐条给证据行号 |
| 判定档 | MATCH / PARTIAL / ACCEPTED-IGNORED / TYPED-NOT-EMITTED / MISSING-FROM-TYPES / TOOL-ABSENT / BPT-EXTENSION / NEW-IN-DOCS |

小学生比喻：上次（07-03）是清点「家里每样电器有没有」，这次是拿着说明书核对「每个插头的针脚形状对不对」——电器基本都添齐了，这次专挑针脚不合的。

## 1. 总判

- 官方 Options 表 **61 字段**：我方类型面 48 字段 = 39 官方同名 + 9 BPT 扩展；**22 个官方字段缺席 TS 类型面**（运行时 ACCEPTED 白名单兜底，但 TS 对象字面量传参会被 excess-property 检查拦下）。
- 官方 SDKMessage union **32 变体**：我方 32 格全有对应，但 **3 个导出名拼写不同**、**8 个观测臂变体判别式反向**（官方 `system`+subtype vs 我方顶层 type），其中 **6 个是实际发射的**。
- 官方 HookEvent **20 个**：我方 14 个；缺的 6 个（Setup/TeammateIdle/TaskCompleted/ConfigChange/WorktreeCreate/WorktreeRemove）全部 NEW-IN-DOCS 倾向。
- 官方 Tool Input/Output Schemas **两章（27+22 个类型）我方零导出**；工具本体缺 9 个（Task 四件套 / Monitor / Workflow / ExitPlanMode / EnterWorktree / NotebookEdit），其中仅 NotebookEdit 在 COMPAT 有正式判定。
- `docs/COMPAT.md` 发现 **15+ 处陈旧行**（多为「代码已实现、表还标 UNSUPPORTED/ACCEPTED」的自相矛盾）——本次已随本档同步修订。

## 2. Drop-in 破坏级差异总榜（跨段合并，按严重度）

「drop-in 破坏级」= 按官方文档写代码的消费方在我方包上**编译失败或静默丢数据**。

| # | 差异 | 段 | 后果 | 比喻 |
|---|---|---|---|---|
| 1 | `ToolInputSchemas` / `ToolOutputSchemas` 两章 27+22 个类型零导出 | D | `import { BashInput }` 直接编译失败；COMPAT 整章无行 | 说明书承诺每个零件附规格卡，零件能用但一张卡都没印 |
| 2 | 观测臂 8 变体判别式反向 + payload 字段大面积不匹配（6 个实际 EMITTED：task_started/progress/updated/notification、hook_started/hook_response） | E | 按官方形状 `switch(msg.type)` 整臂落空 | 约好地址写信封正面，我们写在背面，邮差看不到 |
| 3 | `tool()` 第 5 参形态不兼容：官方 `extras?: { annotations }` 包装对象 vs 我方裸 `annotations` | A | 按官方写法传注解**静默丢失**（连带 readOnlyHint 自动放行/并行分组失效） | 快递要求纸条装信封递，我们只收裸纸条，装信封的当空白 |
| 4 | `deferred_tool_use` 三字段名全错位：官方 `{id,name,input}` vs 我方 `{tool_use_id,tool_name,tool_input}` | C | defer 恢复回路读 `.id` 得 undefined，直接断 | 表格三栏内容都对，栏名全写错，按栏名取数取到空 |
| 5 | 4 个类型导出名与官方不同：`SDKControlInitializeResponse`（我方 `SDKInitializationResult`）、`SDKFilesPersistedEvent`（我方 …Message）、`SDKRateLimitEvent`（我方 …EventMessage）、`SDKAPIRetryMessage`（我方 SDKApiRetryMessage） | B/C | 按名 import 编译失败；加别名即可低成本修复 | 门牌号对、门牌字写错，按地址找人扑空 |
| 6 | `RewindFilesResult` / `McpSetServersResult` 完全形状不匹配（零共同字段） | E | 两个 Query 方法的返回值消费方全部读空 | 点的是分格便当，端来一锅烩 |
| 7 | Task 工具面整组缺席 + 默认轨反向：官方 0.3.142 起 TodoWrite 默认禁用、TaskCreate/Update/Get/List 为正轨；我方默认注册 TodoWrite、四件套全无（钉版面内，非 NEW-IN-DOCS） | D | todo 追踪消费方两头对不上 | 官方换了新记事本，我们还在发旧款 |
| 8 | Grep 缺官方 `context` 参数（`-C` 长别名）——传 `context: 3` 被**静默丢弃** | D | 悄悄给错结果的输入面 bug 级差异 | 点菜说「微辣」没人听见，端上来原味还以为你没说 |
| 9 | Agent 工具输入缺 6/10 字段（model/resume/max_turns/name/mode/isolation） | D | 子代理模型指派/恢复/worktree 隔离不可表达 | 遥控器少了六个键 |
| 10 | `CanUseTool.options`：官方 `requestId` 必填我方可选；`blockedPath`/`agentID` typed-but-never-populated | B | 依赖 agentID 路由审批 UI 的宿主失明 | 来电显示装了，号码从来不传 |
| 11 | `renameSession`/`tagSession` 写后永不可读回（store.load 不解析 meta_update；`SDKSessionInfo` 缺 gitBranch/tag、customTitle 永不填充） | A | 改名/打标签功能是「只写不读」的假动作 | 往存钱罐里投币，罐子没有开口取钱 |
| 12 | `SDKResultMessage`：error 臂缺必填 `stop_reason`；success 臂 stop_reason 可选且值域窄（官方以 `stop_reason:"tool_deferred"` 判定 defer，两套判定协议不重合） | C | 官方式 defer 判定在我方失效 | 两家用不同暗号对同一件事 |
| 13 | `ModelUsage` 缺必填 `contextWindow`/`maxOutputTokens`；`Usage` 缺 cache_creation 分桶等 | E | 计量消费方读 undefined | 账单少印两栏 |
| 14 | `MessageDisplay` hook 输入 0/5 字段命中（官方增量协议 turn_id/message_id/index/final/delta vs 我方 message_text） | C | 增量渲染宿主无法接 | 直播改成了每集完结才寄光盘 |
| 15 | 传输韧性默认差：maxRetries 4 vs 官方 10；流 idle 看门狗 120s vs 官方 300s 下限；后台子代理 stall 看门狗（600s）缺位 | A | 弱网/长任务下行为手感不同 | 我们的闹钟比官方响得早、备用电池少一半 |

## 3. COMPAT.md 陈旧行清单（本次已修订）

| 位置（修订前） | 陈旧内容 | 实况 |
|---|---|---|
| Query methods 末行 | rewindFiles/setMcpServers/reconnectMcpServer/toggleMcpServer/stopTask 标「UNSUPPORTED in types v0.1」 | 五个全部已实现（query.ts:1557–1591），与同文件 v0.2 段自相矛盾；仅 applyFlagSettings/reinitialize 仍属实 |
| `permissionMode` 行 | 「`auto` (classifier) not offered」 | `'auto'` 已在 types.ts:273 + classifier.ts 实现（启发式；官方语义为模型分类器，仍 PARTIAL） |
| `thinking` 行尾注 | 「fields are budget_tokens/budget, not the official budgetTokens」 | types.ts:797 已含官方名 `budgetTokens?`（与同文件 v0.2 段「budgetTokens alias」自相矛盾） |
| ACCEPTED 大杂烩行 | `outputFormat`/`onElicitation`/`sessionStore*`/`enableFileCheckpointing`/`loadTimeoutMs` 列为 ACCEPTED | 五项均已实现（v0.2）；与 COMPAT 自己的 v0.2 毕业段矛盾 |
| `system/init` 行 | 「claude_code_version/betas/skills/plugins absent」 | 四字段均已发射（query.ts:1144–1147）；plugins 元素形状 `string[]` vs 官方 `{name,path}[]` 是真差异 |
| `stream_event` 行 | SDKPartialAssistantMessage 标 FULL | 缺官方 `ttft_ms?` 字段 |
| Hooks 表 PreToolUse/PostToolUse | 「input lacks tool_use_id (/duration_ms)」 | loop.ts:648/787-788 早已带上 |
| Hooks 表 SubagentStart/Stop | 「never fire (no subagents yet)」 | v0.2 起真触发（runtime.ts:395/431）；SubagentStop 发射时缺官方必填 agent_transcript_path 是真差异 |
| Hooks 表 PreCompact | 「never fires (no compaction yet)」 | v0.2 起真触发（compaction.ts:629） |
| Hooks 表 defer | 「UNSUPPORTED，fails closed as deny」 | defer 端到端生效（runner.ts:326-332），与 COMPAT v0.2 段自相矛盾 |
| 观测臂设计注记 | 「官方对这些变体的字段形状未文档化，我方自洽重建」 | live 文档已完整给出全部 payload 与判别式（11 个 system+subtype、5 个顶层 type）——前提失效，我方 8 变体判别式反向 + payload 偏离成为已知差异 |
| `tool()` 行 | 「optional 5th annotations forwarded」 | 第 5 参形态与官方 `extras` 包装对象不兼容 |
| `listSessions` 行 | 只记 includeWorkspace 不生效 | 官方字段名实为 `includeWorktrees`（名字都不同） |
| 会话三函数行 | 只记「own store, no interop」 | rename/tag 往返断裂、getSessionMessages 缺 dir/limit/offset 全部选项 |
| `mcpServerStatus` 行 | 「per-server tools[]」 | 官方 tools 为含 annotations 的对象数组，我方 `string[]` |

## 4. NEW-IN-DOCS 挂账（钉版 0.3.199 / CLI 2.1.201 之后的新增面，非我方缺陷；待守密人裁定是否升钉跟进）

- **`settingSources` 默认语义反转**：live 文档明言「省略 = 加载 user+project+local 全部（同 CLI）」；钉版口径（我方沿用）为「省略 = 什么都不加载」。**这是挂账里唯一的行为级反转**，升钉时必须处理。
- `McpClaudeAIProxyServerConfig`（claude.ai 托管代理传输；官方文档自身的 union 也尚未并入它——上游未落定）。
- `SDKAssistantMessage.error`（10 值枚举）、`SDKResultMessage.terminal_reason`（12 值）/`fast_mode_state`、`SDKControlInitializeResponse.fast_mode_state`、`SDKMessageOrigin`（6 kind）与 `origin?` 信封字段。
- 六个新 hook 事件及其输入类型：Setup / TeammateIdle / TaskCompleted / ConfigChange / WorktreeCreate / WorktreeRemove；`BaseHookInput.prompt_id`（2.1.196+）/`effort`；Stop/SubagentStop 的 `background_tasks`/`session_crons`。
- `Usage.speed` / `inference_geo` / `iterations`；`ThinkingConfig.display`（'summarized'|'omitted'）与 `ThinkingDisplay`。
- `systemPrompt` preset 的 `excludeDynamicSections`；`ApiKeySource` 的 `'oauth'`；`SdkBeta` 具名类型。
- Tool union 里的 `McpInput`、`Subscribe/UnsubscribeMcpResourceInput`、`Subscribe/UnsubscribePollingInput`（官方自己未给字段正文）；Monitor 的 `ws` 源（2.1.195+，钉内边缘）；TaskStop 的 agent-by-name（2.1.198+，钉内边缘）；Agent 的 `model:"fable"` 枚举值。
- `CLAUDE_CODE_RETRY_WATCHDOG`（2.1.199 起重试策略变 300/去上限）；`extractFromBunfs` 相关说明已从 live Options 表消失。
- 漂移哨兵（conformance-drift.yml）首跑已报官方 0.3.201 发布待裁定——与本挂账同一个裁定点。

## 5. 修复 backlog 建议（供守密人裁定，本档不动代码）

**P0（drop-in 编译失败 / 静默丢数据，多为 S 工作量）**
1. 导出 `ToolInputSchemas`/`ToolOutputSchemas` 及成员类型（对我方已有工具先落 12 个，缺席工具类型可后补）。
2. `tool()` 第 5 参双形态兼容：识别 `{ annotations: … }` 包装对象与裸形态。
3. 四个类型名官方别名：`SDKControlInitializeResponse` / `SDKFilesPersistedEvent` / `SDKRateLimitEvent` / `SDKAPIRetryMessage`。
4. `deferred_tool_use` 补官方字段名（`id/name/input`，可双轨过渡）。
5. Grep 输入补 `context` 别名（一行）；`CanUseTool.options.requestId` 必填化（实现本就恒传）。
6. rename/tag 往返修通：store.load 解析 meta_update，`SDKSessionInfo` 补 `tag`/`gitBranch`、customTitle 接线 + summary 三级优先级。

**P1（形状/行为对齐，部分破坏性需 MIGRATION 条目）**
7. 观测臂对齐 live 文档：8 变体判别式换 `system`+subtype、payload 逐字段对齐（**破坏性**，Desktop UI 对接表同步改）。
8. `McpSetServersResult`/`RewindFilesResult` 形状对齐（破坏性）。
9. 22 个官方 Options 字段进 TS 类型面（保持 runtime ACCEPTED 语义，消 excess-property 拦截）。
10. Agent 工具输入补 model/max_turns/name（resume/mode/isolation 依赖缺席子系统，挂账）。
11. `SDKResultMessage.stop_reason` 两臂补齐（error 臂必填、success 臂值域放宽）；`ModelUsage` 补 contextWindow/maxOutputTokens。
12. TodoWrite→Task 四件套路线裁定（发货四件套 or 声明停留旧轨）。
13. 传输韧性默认对齐裁定：maxRetries 4→10?、流看门狗 120s→300s?、后台 stall 看门狗补位?
14. `McpServerStatus.tools` 对象数组化；`PermissionUpdate.removeDirectories` 真实现（现静默忽略）；`suppressOutput` 聚合器接线或除名。

**P2（缺席子系统/工具，XL 级）**
15. Monitor / Workflow / ExitPlanMode / EnterWorktree 工具；Read `pages`；MessageDisplay 增量协议;
16. 升钉裁定后跟进全部 NEW-IN-DOCS 面。

---

## 6. 逐条对账明细

以下五节为逐条明细（官方文档每个函数/字段/变体一行不跳），证据行号缩写见各节首。判定基于 2026-07-05 的 `src/` 实况与修订**前**的 COMPAT.md（「COMPAT 判定」列描述的陈旧问题本次已修订，见 §3）。

### 6.A 函数 + Options（官方行 51–485）

#### Functions

| 官方条目 | 官方要点 | 本 SDK 状态 | 证据 | COMPAT.md 判定（修订前） |
|---|---|---|---|---|
| `query()` | `{prompt: string\|AsyncIterable<SDKUserMessage>, options?}` → `Query`(扩展 AsyncGenerator) | MATCH | query.ts:327-330；types.ts:1648 | 准确 |
| `startup()` | 预热 CLI 子进程，`initializeTimeoutMs` 默认 60000，返回 `Promise<WarmQuery>` | ACCEPTED-IGNORED（未导出；无子进程可预热，N/A-by-design） | index.ts 无导出 | 准确（UNSUPPORTED + 理由） |
| `tool()` | 第 5 参为 **`extras?: { annotations?: ToolAnnotations }`** 包装对象 | **PARTIAL——第 5 参形态不兼容**：我方是裸 `annotations`；按官方写法传 `{ annotations: {...} }` 时注解**静默丢失** | sdk-server.ts:28-34,71 | 陈旧：未标包装对象形态差 |
| `ToolAnnotations` | 5 字段全可选，自 MCP SDK 再导出 | MATCH（字段面 5/5；我方本地定义非再导出） | types.ts:634-640 | 可接受 |
| `createSdkMcpServer()` | `{name, version?, tools?}` → `McpSdkServerConfigWithInstance` | MATCH（重名工具后写胜出） | sdk-server.ts:79-97 | 准确 |
| `listSessions()` | 选项 `dir`/`limit`/**`includeWorktrees`(默认 true)** | PARTIAL：dir+limit 有；我方字段名 **`includeWorkspace`**（与官方不同名）且不生效；仅读自有 JSONL 库 | store.ts:352-361,389-410 | 部分陈旧：未标字段名不一致 |
| `SDKSessionInfo` | 10 字段；summary 优先级 customTitle > 自动摘要 > firstPrompt | PARTIAL：8 字段，**缺 gitBranch、tag**；customTitle typed 永不填充；summary 只取 firstPrompt 首行 | types.ts:1689-1698；store.ts:371-386 | 未记录 |
| `getSessionMessages()` | 选项 `dir`/`limit`/`offset` | PARTIAL：**三个官方选项全缺**；返回全量 | session-functions.ts:27-36,92-109 | 记录不完整 |
| `SessionMessage` | 5 字段 | MATCH | types.ts:1580-1586 | 已覆盖 |
| `getSessionInfo()` | 返回 `SDKSessionInfo \| undefined`；选项 `dir` | PARTIAL：返回 **null** 非 undefined；dir 别名有 | store.ts:413-427 | 基本准确 |
| `renameSession()` | title 去空白须非空；最新标题胜出 | PARTIAL：写 meta_update 但 (1) 无 dir 别名 (2) 无 title 非空校验 (3) **写后无人回读**（store.load 不解析 meta_update，customTitle 永不出现）——往返断裂 | session-functions.ts:112-141 | 陈旧：未记断裂 |
| `tagSession()` | `(sessionId, tag\|null, options?.dir)` | PARTIAL：同上；`tag` 连 SDKSessionInfo 类型都没有，**永不可读回** | session-functions.ts:121-127 | 同上 |
| `resolveSettings()` | alpha；设置合并引擎 | ACCEPTED-IGNORED（未导出，N/A-by-design；ResolvedSettings 类型亦无） | index.ts 无 | 准确 |
| `deleteSession()`/`forkSession()`（我方导出） | 官方本节无 | BPT-EXTENSION | index.ts:16-17 | 已记录 |

#### Options 全 61 字段

| # | 官方字段 | 官方类型/默认 | 本 SDK 状态 | 证据 | COMPAT 判定（修订前） |
|---|---|---|---|---|---|
| 1 | `abortController` | 默认 new AbortController() | MATCH | types.ts:825 | 准确 |
| 2 | `additionalDirectories` | string[] 默认 [] | MATCH | types.ts:826 | 准确 |
| 3 | `agent` | 主线程 agent 名 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:103 | 未区分类型面/运行时两层 |
| 4 | `agents` | Record<string, AgentDefinition> | PARTIAL（已执行；工具名 Agent vs 官方 Task） | types.ts:828 | 准确 |
| 5 | `agentProgressSummaries` | boolean 默认 false | MISSING-FROM-TYPES；runtime ACCEPTED；task_progress.summary typed 无生成源 | query.ts:119 | ACCEPTED |
| 6 | `allowDangerouslySkipPermissions` | 默认 false | PARTIAL（更严：硬 throw；官方实测不拦） | types.ts:855 | 准确详尽 |
| 7 | `allowedTools` | string[] 默认 [] | MATCH | types.ts:829 | 准确 |
| 8 | `betas` | SdkBeta[] 默认 [] | PARTIAL（我方 string[]，无 SdkBeta 命名类型） | types.ts:904 | 类型名差未记（轻微） |
| 9 | `canUseTool` | 仅 prompt-fallthrough 调用 | MATCH（字段缺口见 §6.B CanUseTool） | types.ts:337-349 | 准确 |
| 10 | `continue` | 默认 false | PARTIAL（仅自有库） | types.ts:833 | 准确 |
| 11 | `cwd` | 默认 process.cwd() | MATCH | types.ts:834 | 准确 |
| 12 | `debug` | 默认 false | PARTIAL（stderr 回调日志） | types.ts:906 | 准确 |
| 13 | `debugFile` | 写调试日志到文件 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:123 | 未标不在类型面 |
| 14 | `disallowedTools` | 裸名移除/规则拦截 | MATCH | types.ts:830 | 准确 |
| 15 | `effort` | 'low'…'max' | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:110 | ACCEPTED |
| 16 | `enableFileCheckpointing` | 默认 false | MATCH（v0.2 实现 + rewindFiles） | types.ts:927 | **陈旧**：仍列 ACCEPTED |
| 17 | `env` | 默认 process.env | PARTIAL（无子进程；传输 + Bash 用） | types.ts:835 | 准确 |
| 18 | `executable` | 'bun'\|'deno'\|'node' | MISSING-FROM-TYPES；N/A-by-design | query.ts:125 | 已记录 |
| 19 | `executableArgs` | string[] | 同上 | query.ts:126 | 已记录 |
| 20 | `extraArgs` | Record<string,string\|null> | MISSING-FROM-TYPES；N/A-by-design（无 CLI argv） | query.ts:106 | ACCEPTED |
| 21 | `fallbackModel` | 主模型失败切换 | PARTIAL（每回合一次 429/5xx 切换） | types.ts:836 | 准确 |
| 22 | `forkSession` | 默认 false | MATCH | types.ts:837 | 准确 |
| 23 | `forwardSubagentText` | 默认 false | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:120 | ACCEPTED |
| 24 | `hooks` | Partial<Record<HookEvent, HookCallbackMatcher[]>> | PARTIAL（见 Hook 节；BPT condition 扩展） | types.ts:838 | 准确 |
| 25 | `includeHookEvents` | 默认 false | MATCH | types.ts:841 | 准确 |
| 26 | `includePartialMessages` | 默认 false | MATCH | types.ts:842 | 准确 |
| 27 | `loadTimeoutMs` | Alpha，默认 60000 | MATCH（默认一致） | types.ts:925 | **陈旧**：仍列 ACCEPTED |
| 28 | `managedSettings` | 政策层设置 | MISSING-FROM-TYPES；N/A-by-design | query.ts:115 | ACCEPTED |
| 29 | `maxBudgetUsd` | 估算达值即停 | PARTIAL（静态价目表；停止顺序已对齐 E5） | types.ts:843 | 准确 |
| 30 | `maxThinkingTokens` | **官方已标 Deprecated** | MATCH-typed（未标 @deprecated） | types.ts:844 | 主体准确 |
| 31 | `maxTurns` | 最大回合 | MATCH | types.ts:845 | 准确 |
| 32 | `mcpServers` | Record<string, McpServerConfig> | PARTIAL（sse 不支持） | types.ts:846 | 准确 |
| 33 | `model` | 默认取自 CLI | MATCH（默认源 ANTHROPIC_MODEL env / claude-sonnet-4-5） | types.ts:847 | 准确 |
| 34 | `onElicitation` | 未提供自动拒绝 | MATCH（v0.2 接线） | types.ts:917,1548-1551 | **陈旧**：仍列 ACCEPTED |
| 35 | `outputFormat` | {type:'json_schema', schema} | MATCH（校验+重询+structured_output） | types.ts:911,1445-1448 | **陈旧**：仍列 ACCEPTED |
| 36 | `outputStyle` | 官方自注「非 Options 字段」 | MATCH（双方皆无） | — | 无需记录 |
| 37 | `pathToClaudeCodeExecutable` | bundled binary 解析 | MISSING-FROM-TYPES；N/A-by-design（`extractFromBunfs` 已从 live Options 表消失） | query.ts:124 | 已记录 |
| 38 | `permissionMode` | 默认 'default' | PARTIAL + `'auto'` 已实现（启发式 vs 官方模型分类器） | types.ts:260-273；classifier.ts | **陈旧自相矛盾**：称 not offered |
| 39 | `permissionPromptToolName` | MCP 权限提示工具 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:105 | ACCEPTED |
| 40 | `persistSession` | 默认 true | MATCH | types.ts:857 | 准确 |
| 41 | `planModeInstructions` | 替换 plan 工作流体 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:117 | ACCEPTED |
| 42 | `plugins` | SdkPluginConfig[] 默认 [] | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:111 | ACCEPTED |
| 43 | `promptSuggestions` | 默认 false | MISSING-FROM-TYPES；消息变体 typed-not-emitted | query.ts:118 | 一致 |
| 44 | `resume` | 会话 ID 恢复 | MATCH | types.ts:872 | 准确 |
| 45 | `resumeSessionAt` | 恢复到指定 UUID | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:122 | ACCEPTED |
| 46 | `sandbox` | SandboxSettings | PARTIAL（我方 boolean\|SandboxOptions，BPT 形态；见 §6.E） | types.ts:870,734-755 | 准确详尽 |
| 47 | `sessionId` | 指定 UUID | MATCH | types.ts:874 | 准确 |
| 48 | `sessionStore` | SessionStore 接口 | MATCH（接口形状一致） | types.ts:921,1571-1577 | **陈旧**：仍列 ACCEPTED |
| 49 | `sessionStoreFlush` | Alpha，'batched'\|'eager' 默认 batched | MATCH | types.ts:923 | 同上陈旧 |
| 50 | `settings` | string \| Settings（flag-settings 层） | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:104 | ACCEPTED |
| 51 | `settingSources` | live 默认「全部来源」 | PARTIAL：类型一致；**默认语义 live 已反转**（NEW-IN-DOCS 挂账，见 §4）；skills/plugins 不加载 | types.ts:804,878-884 | 按钉版准确；live 变化未记 |
| 52 | `skills` | string[] \| 'all' | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:112 | ACCEPTED |
| 53 | `spawnClaudeCodeProcess` | 自定义进程 spawn | MISSING-FROM-TYPES；N/A-by-design | query.ts:127 | 已记录 |
| 54 | `stderr` | (data:string)=>void | PARTIAL（调试日志行） | types.ts:893 | 准确 |
| 55 | `strictMcpConfig` | 默认 false | ACCEPTED-IGNORED（typed 无消费点） | types.ts:895 | 准确（自标 stale 理由） |
| 56 | `systemPrompt` | string \| preset（+`excludeDynamicSections`） | PARTIAL：preset 缺 excludeDynamicSections（NEW-IN-DOCS 倾向）；BPT segments 扩展 | types.ts:896-899 | 未记 excludeDynamicSections |
| 57 | `taskBudget` | Alpha，{total} token 预算 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:116 | ACCEPTED |
| 58 | `thinking` | ThinkingConfig，模型默认 adaptive | PARTIAL：三形态齐；**官方名 budgetTokens 已支持**（+别名）；默认预算 4096 我方自选；`display` 缺（NEW-IN-DOCS） | types.ts:795-798 | **尾注陈旧** |
| 59 | `title` | 会话显示标题 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:121 | ACCEPTED |
| 60 | `toolAliases` | 内建名→MCP 名映射 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:113 | ACCEPTED |
| 61 | `toolConfig` | 内建工具行为配置 | MISSING-FROM-TYPES；runtime ACCEPTED | query.ts:114 | ACCEPTED |
| 62 | `tools` | string[] \| preset | PARTIAL（数组过滤内建；preset=全部内建） | types.ts:902 | 准确 |

计数：官方 61 真实字段；我方 48 = 39 同名 + 9 BPT 独有（`provider`/`sessionDir`/`includeEnvironmentContext`/`compaction`/`webSearch`/`onUserQuestion`/`allowPrivateWebFetch`/`toolSearch`/`harnessPromptVariant`；另有形态级扩展 sandbox 对象/systemPrompt segments/permissionMode 'auto'/hooks[].condition）。官方独有 22 个全在 runtime ACCEPTED 白名单（query.ts:97-128），其中 5 个属无子进程 N/A-by-design。

#### 「Handle slow or stalled API responses」小节

| 官方项 | 官方要点 | 本 SDK 状态 | 证据 |
|---|---|---|---|
| `API_TIMEOUT_MS` | 单请求超时默认 600000 | PARTIAL-类比：`provider.timeoutMs` 默认一致，不读 env var | transport/anthropic.ts:27,107 |
| `CLAUDE_CODE_MAX_RETRIES` | 默认 10、上限 15（2.1.199 起 watchdog 300/去上限） | PARTIAL：`provider.maxRetries` **默认 4**；无 retry watchdog | transport/anthropic.ts:30,108 |
| `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | 后台子代理 stall 看门狗默认 600000 | MISSING（仅回合/预算封顶） | src/subagents/ 无命中 |
| `CLAUDE_ENABLE_STREAM_WATCHDOG` + `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | 默认开；idle 默认 300000 且下限钳 300000 | PARTIAL-类比：`streamIdleTimeoutMs` 默认 **120000**（低于官方下限），0 关闭；同走重试 | types.ts:722；transport/anthropic.ts:29,130 |

### 6.B Query object 与配置类型（官方行 486–950）

#### Query 方法

| 官方条目 | 官方要点 | 本 SDK 状态 | 证据 | COMPAT 判定（修订前） |
|---|---|---|---|---|
| `interrupt()` | 仅 streaming 模式 | MATCH（超集：string 模式亦可） | query.ts:1497-1507 | 准确 |
| `rewindFiles(userMessageId, options?)` | 需 enableFileCheckpointing，dryRun 预览 | MATCH（签名/前置条件同；**返回形状不同**见 §6.E RewindFilesResult） | query.ts:1574-1588 | **陈旧**（标 UNSUPPORTED） |
| `setPermissionMode(mode)` | streaming 模式 | MATCH（+BPT interlock 更严） | query.ts:1508-1511 | 准确 |
| `setModel(model?)` | 可选参回退默认 | MATCH | query.ts:1512-1514 | 准确 |
| `setMaxThinkingTokens(n\|null)` | **官方已 Deprecated** | MATCH（更细；未标 deprecated） | query.ts:1515-1536 | 未记 deprecated |
| `applyFlagSettings(settings)` | 运行时合并 flag-settings；浅合并；null 清键 | MISSING-FROM-TYPES（无 settings 引擎，N/A） | Query 接口无 | 准确但混在陈旧行 |
| `initializationResult()` | 返回 `SDKControlInitializeResponse` | PARTIAL（自有名 `SDKInitializationResult`，缺 fast_mode_state；**类型名失配**） | types.ts:1639-1646 | 准确 |
| `reinitialize()` | 2.1.195+；重发 initialize、重派发 pending 权限请求 | MISSING-FROM-TYPES（无 control_request 线协议，N/A） | Query 接口无 | 准确但混行 |
| `supportedCommands()` | slash 命令表 | PARTIAL（恒 []） | query.ts:1540-1542 | 准确 |
| `supportedModels()` | 模型表 | PARTIAL（静态 4 模型硬编码） | query.ts:83-89,1543-1545 | 准确 |
| `supportedAgents()` | AgentInfo[] | MATCH（general-purpose 不列出——官方行为未知） | query.ts:1546-1550 | 准确 |
| `mcpServerStatus()` | MCP 状态 | MATCH（+config 回显+tools[]；scope 不追踪；tools 形状差见 §6.E） | query.ts:1551-1553 | 准确 |
| `accountInfo()` | 账户信息 | PARTIAL（仅 apiKeySource） | query.ts:1554-1556 | 准确 |
| `reconnectMcpServer(name)` | 按名重连 | MATCH | query.ts:1557-1559 | **陈旧**（标 UNSUPPORTED） |
| `toggleMcpServer(name, enabled)` | 按名启停 | MATCH（enable 自动补 reconnect） | query.ts:1560-1568 | **陈旧** |
| `setMcpServers(servers)` | 返回 added/removed/errors | PARTIAL（已实现；返回 `{servers}` 无分桶） | query.ts:1569-1573 | **陈旧** |
| `streamInput(stream)` | 多轮流式输入 | MATCH | query.ts:1592-1604 | 准确 |
| `stopTask(taskId)` | 停后台任务 | MATCH（unknown id = no-op + warn） | query.ts:1589-1591 | **陈旧** |
| `close()` | 关闭并终止进程 | MATCH（等价语义） | query.ts:1605-1632 | 准确 |

#### 配置类型

| 官方条目 | 官方要点 | 本 SDK 状态 | 证据 | COMPAT 判定 |
|---|---|---|---|---|
| `WarmQuery`/`startup()` | 预热子进程句柄 | MISSING-FROM-TYPES（N/A-by-design） | index.ts 无 | 准确 |
| `SDKControlInitializeResponse` | 6 字段 + fast_mode_state? | PARTIAL：字段全同但类型名 `SDKInitializationResult`；fast_mode_state 缺（NEW-IN-DOCS） | types.ts:1639-1646 | 未记录 |
| — pending_permission_requests 包装 | control_response 重投递 | MISSING（无线协议，N/A） | — | 未记录 |
| `AgentDefinition.description` | 必填 | MATCH | types.ts:663 | 准确 |
| `.tools` | 省略=继承父 | MATCH | types.ts:665 | 准确 |
| `.disallowedTools` | 含 mcp 服务器级模式 | MATCH（v0.4 globs） | types.ts:666 | 准确 |
| `.prompt` | 必填 | MATCH（空报错） | agents.ts:162-166 | 准确 |
| `.model` | 别名 fable/opus/sonnet/haiku/inherit 或完整 id | MATCH | agents.ts:189-208 | 准确 |
| `.mcpServers` | `AgentMcpServerSpec[]`（字符串或内联配置） | PARTIAL：我方 `string[]` 且 no-op；内联记录不可表达 | types.ts:686 | 未记录 |
| `.skills` | 预载技能 | ACCEPTED-IGNORED | types.ts:684 | 准确 |
| `.initialPrompt` | 首轮自动提交 | MATCH | types.ts:688 | 未记录 |
| `.maxTurns` | 轮数上限 | MATCH（默认 20 兜底） | agents.ts:33 | 准确 |
| `.background` | 后台任务 | MATCH | types.ts:671 | 准确 |
| `.memory` | user/project/local | ACCEPTED-IGNORED | types.ts:690 | 准确 |
| `.effort` | 档位或整数 | ACCEPTED-IGNORED | types.ts:692 | 准确 |
| `.permissionMode` | 子代理权限模式 | MATCH | types.ts:669 | 准确 |
| `.criticalSystemReminder_EXPERIMENTAL` | 实验性 | MISSING-FROM-TYPES（全仓零命中） | — | 未记录 |
| `.fork`（我方独有） | — | BPT-EXTENSION | types.ts:673-682 | 准确 |
| `AgentMcpServerSpec` | string \| Record<…> | MISSING-FROM-TYPES | — | 未记录 |
| `SettingSource` | 三值 + 路径映射 | MATCH（只加载指令文件，不加载 settings.json） | types.ts:804,877-884 | 准确 |
| — Default behavior | live：省略=全加载 | NEW-IN-DOCS 行为反转（见 §4） | types.ts:880-882 | 按钉版准确 |
| — Settings precedence | local>project>user；managed 最高 | MISSING（无多源合并引擎） | — | 准确（N/A） |
| `PermissionMode` | 6 值；auto=「model classifier」 | PARTIAL：6 值全在；auto 为启发式非模型分类器 | types.ts:260-273；gate.ts:8-23 | **陈旧自相矛盾** |
| `CanUseTool` | options 含 signal/suggestions/blockedPath/decisionReason/toolUseID/agentID/**requestId 必填**；null=外部通道应答 | PARTIAL：requestId 我方**可选**（实现恒传）；**blockedPath/agentID typed 永不填充** | types.ts:337-349；gate.ts:265-278 | 部分陈旧：恒缺字段未披露 |
| `PermissionResult` | allow/deny 两臂全字段 | MATCH（interrupt 落地；rewrite 复查 deny） | types.ts:323-335；gate.ts:292-309 | 准确 |
| `ToolConfig` | askUserQuestion.previewFormat | MISSING-FROM-TYPES + ACCEPTED-IGNORED | query.ts:114 | 准确 |
| `McpStdioServerConfig` | type?/command/args/env | MATCH + BPT `cwd?` 扩展 | types.ts:549-555 | cwd 扩展未记 |
| `McpSSEServerConfig` | type:'sse'/url/headers | PARTIAL：typed；构造抛 NotImplementedError→'failed'（优雅降级） | http.ts:78-81 | 基本准确 |
| `McpHttpServerConfig` | type:'http'/url/headers | MATCH | types.ts:563-567 | 准确 |
| `McpSdkServerConfigWithInstance` | instance: McpServer | PARTIAL（自有 SdkMcpServerInstance 形状，in-process） | types.ts:570-574 | 准确 |
| `McpClaudeAIProxyServerConfig` | claudeai-proxy/url/id | NEW-IN-DOCS（官方 union 自身也未并入——上游未落定） | 全仓零命中 | 合理未记 |
| `SdkPluginConfig` | local/path/skipMcpDiscovery? | MISSING-FROM-TYPES + ACCEPTED-IGNORED | query.ts:111 | 准确 |

### 6.C 消息流 + Hook（官方行 951–1733）

证据缩写：T=types.ts，L=engine/loop.ts，Q=query.ts，R=hooks/runner.ts，RT=subagents/runtime.ts，CP=engine/compaction.ts。

#### SDKMessage union（官方 32 变体 vs 我方 32 变体全对应；关键差异行）

| 官方变体 | 本 SDK 状态 | 关键差异 | 证据 |
|---|---|---|---|
| SDKAssistantMessage | PARTIAL | 缺 `error?: SDKAssistantMessageError`（10 值枚举整缺，NEW-IN-DOCS 倾向） | T:963-969 |
| SDKUserMessage | PARTIAL | session_id 我方必填（官方可选）；缺 isSynthetic?/**shouldQuery?**（功能性：追加不触发回合）/tool_use_result?/origin? | T:946-952 |
| SDKUserMessageReplay | TYPED-NOT-EMITTED | 核心 6 字段同；resume 路径不重放 isReplay 消息 | T:954-961；Q:857-897 |
| SDKResultMessage success 臂 | PARTIAL | stop_reason 官方必填 string\|null（含 "tool_deferred"），我方可选 StopReason 枚举；`deferred_tool_use` **字段名 id/name/input vs 我方 tool_use_id/tool_name/tool_input**；缺 terminal_reason?/fast_mode_state?/origin?（NEW-IN-DOCS 倾向）；BPT 加 metrics | T:1016-1072；L:305-343 |
| SDKResultMessage error 臂 | PARTIAL | **完全没有 stop_reason 字段**（官方必填）；errors 我方可选（发射恒给）；BPT 加 errorMessage/ttft/metrics | T:1047-1072；L:339 |
| SDKSystemMessage(init) | PARTIAL | claude_code_version/betas/skills/plugins **均已发射**（COMPAT 旧说法「absent」错）；plugins 元素 `string[]` vs 官方 `{name,path}[]`；skills/claude_code_version typing 松 | T:1074-1092；Q:1127-1147 |
| SDKPartialAssistantMessage | PARTIAL | 缺 ttft_ms? | T:971-977 |
| SDKCompactBoundaryMessage | MATCH（EMITTED） | — | CP:682 |
| SDKPermissionDeniedMessage | PARTIAL（EMITTED） | 判别式顶层 vs 官方 system+subtype；官方 message→我方 reason；缺 agent_id?/decision_reason?；decision_reason_type 值集不同（我方 blocker）；官方注「PreToolUse deny 不经此事件」我方 hook-deny 同样发射 | T:1129-1139；L:702-710 |
| SDKPermissionDenial | MATCH | 三字段逐字同 | T:351-355 |
| SDKMessageOrigin | MISSING-FROM-TYPES | 6 kind 整缺（NEW-IN-DOCS 倾向，连带 origin? 信封字段） | — |
| SDKInformationalMessage | PARTIAL（TYPED） | 判别式+全部载荷字段名不同（官方 content/level 4 值/prevent_continuation? vs 我方 message/level 含 debug/details?） | T:1320-1327 |
| SDKWorkerShuttingDownMessage | PARTIAL（TYPED） | 官方 system+subtype、reason 必填；我方顶层、graceful 自造、reason 可选 | T:1359-1365 |
| SDKPluginInstallMessage | PARTIAL（TYPED） | status 首值 started vs 我方 installing；name vs plugin_name | T:1368-1375 |
| SDKFilesPersistedEvent | 导出名差（我方 …Message）；TYPED | files 元素 {filename,file_id} vs 我方 {path,operation,size?}；缺 failed[]/processed_at | T:1247-1256 |
| SDKRateLimitEvent | 导出名差（我方 …EventMessage）；EMITTED | 官方 rate_limit_info 封套（配额状态事件）vs 我方扁平 429 重试通知——形状/语义/触发时机三重偏差（KD-12：官方 429 实发 api_retry） | T:1278-1285 |
| SDKAPIRetryMessage | 导出名差（我方 SDKApiRetryMessage）；EMITTED | — | T:1289-1297 |
| SDKMirrorErrorMessage | MATCH（EMITTED） | — | T:1597-1603 |
| 其余 TYPED-NOT-EMITTED 变体（status/tool_progress/tool_use_summary/auth_status/local_command_output/commands_changed/notification/memory_recall/elicitation_complete/session_state_changed/prompt_suggestion） | TYPED | 判别式/payload 差异逐条见 §6.E 观测臂表 | T:1142-1394 |

#### HookEvent（官方 20 vs 我方 14）

| 官方事件 | 我方 | 实际触发 | 备注 |
|---|---|---|---|
| PreToolUse | 有 | 是（带 tool_use_id，L:648） | COMPAT「lacks tool_use_id」**陈旧** |
| PostToolUse | 有 | 是（带 tool_use_id+duration_ms，L:787-788） | COMPAT 同上陈旧 |
| PostToolUseFailure | 有 | 是 | 缺官方 is_interrupt? |
| PostToolBatch | 有 | 是 | 官方 tool_calls[] vs 我方 tool_names[]（已记录） |
| Notification | 有 | 否 | 官方 notification_type 必填我方可选 |
| UserPromptSubmit | 有 | 是 | MATCH |
| SessionStart | 有 | 是 | 缺官方 model? |
| SessionEnd | 有 | 是 | reason 松类型（官方 ExitReason 枚举） |
| Stop | 有 | 是（恒 stop_hook_active:false） | 缺 last_assistant_message?/background_tasks?/session_crons? |
| SubagentStart | 有 | **是**（RT:395-407） | COMPAT「never fire」**陈旧** |
| SubagentStop | 有 | **是**（RT:431-444） | 同上；官方必填 agent_transcript_path 我方发射不带 |
| PreCompact | 有 | **是**（CP:629） | COMPAT「never fires」**陈旧**；字段 MATCH |
| PermissionRequest | 有 | 否 | 缺 permission_suggestions?；BPT 加 tool_use_id? |
| MessageDisplay | 有 | 是（每完成消息一次） | **官方 5 字段增量协议（turn_id/message_id/index/final/delta）0/5 命中**（我方 message_text） |
| Setup / TeammateIdle / TaskCompleted / ConfigChange / WorktreeCreate / WorktreeRemove | 无 | — | NEW-IN-DOCS（六事件 + 输入类型全缺） |

#### Hook 结构类型

| 官方条目 | 本 SDK 状态 | 差异 | 证据 |
|---|---|---|---|
| HookCallback | MATCH+宽松 | 返回允许 void（中性） | T:516-520 |
| HookCallbackMatcher.matcher | MATCH+加固 | ReDoS 守卫（fail-closed） | matcher.ts:27-79 |
| HookCallbackMatcher.timeout | PARTIAL | 官方「matcher 内全部 hooks 共享秒数」；我方每 callback 独享 | R:130-138,216 |
| HookCallbackMatcher.condition（我方独有） | BPT-EXTENSION | 自然语言条件门（v0.6，fail-closed） | T:539；R:168-205 |
| BaseHookInput | PARTIAL | transcript_path 官方必填、我方可选**且运行时从不填**（L:284-287）；缺 permission_mode?/effort?（后者 NEW-IN-DOCS）；prompt_id? NEW-IN-DOCS | T:377-384 |
| HookJSONOutput async 臂 | PARTIAL（typing）/行为 MATCH | 折叠为 async?: boolean 非判别 union；fire-and-forget 正确 | T:489-514；R:251-256 |
| continue/stopReason/decision/reason | MATCH | legacy approve/block 映射正确 | R:286-319 |
| `suppressOutput` | **TYPED-NOT-HONORED** | 聚合器从不读取 | R:267-391 |
| `systemMessage` | PARTIAL | 仅进 debug 日志，不进流 | L:654,794 |
| hookSpecificOutput | PARTIAL | 单一扁平形状，无 per-event 窄化；PreToolUse.permissionDecision 含 **defer 端到端生效**（COMPAT「defer UNSUPPORTED」**陈旧**）；updatedToolOutput last-wins；缺 updatedMCPToolOutput（官方已弃用）与 PermissionRequest.decision 子形状 | T:487；R:307-374 |

### 6.D 工具输入/输出（官方行 1734–2709）

#### 类型导出（本段地基）

- `ToolInputSchemas`（27 成员）/ `ToolOutputSchemas`（22 成员）：**我方零导出，全部成员名（AgentInput/BashInput/FileEditInput…）全仓零定义**。COMPAT 无此章任何行。
- union 内无正文的成员（McpInput、Subscribe/UnsubscribeMcpResourceInput、Subscribe/UnsubscribePollingInput）：NEW-IN-DOCS（官方自身未给字段）。

#### 输入 schema 逐工具

| 官方工具（输入字段） | 本 SDK 状态 | 字段级差异 | 证据 |
|---|---|---|---|
| Agent（10 字段） | PARTIAL | 有 4/10；缺 model/resume/max_turns/name/mode/isolation；多 BPT `fork` | agent-tool.ts:42-76 |
| AskUserQuestion | PARTIAL | 官方 option.description 必选、preview? 支持、multiSelect 必选；我方接受裸字符串、无 preview、multiSelect 可选（向下兼容、向上不保证） | askuserquestion.ts:68-157 |
| Bash（5 字段） | PARTIAL | 4 字段 MATCH（timeout 默认 120000/上限 600000 同）；dangerouslyDisableSandbox **条件性入 schema**（官方恒有） | bash.ts:22-23,269-343 |
| Monitor（command/ws/description/timeout_ms/persistent） | TOOL-ABSENT | 主体钉定面内；ws 源 2.1.195+ 边缘 | descriptions.ts:14 |
| TaskOutput（task_id/block/timeout 均必选） | TOOL-ABSENT | 我方旧名 BashOutput(bash_id,filter?) 覆盖 shell 子集，无通用 task 面 | shells.ts:212-267 |
| Edit（4 字段） | MATCH | — | edit.ts:56-79 |
| Read（file_path/offset/limit/pages） | PARTIAL | **缺 pages**（PDF 整本 base64，无分页）；limit 默认 2000 同 | read.ts:76-94,183-198 |
| Write（2 字段） | MATCH | — | write.ts:30-43 |
| Glob（2 字段） | MATCH | — | glob.ts:25-40 |
| Grep（14 参数） | PARTIAL | 13/14 有；**缺 `context`（-C 长别名）——传入被静默丢弃**；多 `-o`（官方 D 段 schema 未列） | grep.ts:199-319 |
| TaskStop（task_id?/shell_id? deprecated） | TOOL-ABSENT | 我方旧名 KillShell(shell_id)；agent-by-name（2.1.198+）无对应 | shells.ts:269-306 |
| NotebookEdit | TOOL-ABSENT | 唯一有正式 UNSUPPORTED 判定的缺席工具 | COMPAT L170 |
| WebFetch（url/prompt） | MATCH（输入面） | prompt 不驱动 AI 摘要（返回转换全文）——行为差在输出节 | webfetch.ts:262-272 |
| WebSearch（3 字段） | MATCH | 后端为 host 回调（行为差 schema 同） | websearch.ts:84-100 |
| Workflow（5 字段） | TOOL-ABSENT | 0.3.149 引入 < 钉定 0.3.199，钉定面内缺失 | — |
| TodoWrite | MATCH（schema） | 但官方 0.3.142 起**默认禁用**改推 Task 四件套；我方默认注册——**默认轨反向** | todo.ts:35-60 |
| TaskCreate/TaskUpdate/TaskGet/TaskList | TOOL-ABSENT（整组） | 0.3.142 引入，钉定面内；依赖图/owner 概念无对应 | — |
| ExitPlanMode（allowedPrompts?） | TOOL-ABSENT | 我方有 plan 模式但无退出工具 | — |
| ListMcpResourcesTool（server?） | MATCH | 工具名/字段全同 | resources.ts:20-35 |
| ReadMcpResourceTool（server/uri） | MATCH | — | resources.ts:53-66 |
| EnterWorktree（name?/path? 互斥） | TOOL-ABSENT | worktree 隔离整线缺席 | — |
| （我方独有）BashOutput/KillShell/ToolSearch | BPT-EXTENSION | ToolSearch 为 deferred-MCP 自建工具 | shells.ts；toolsearch.ts |

#### 输出 schema 总判

我方全部工具输出为 `ToolResultPayload`（纯文本/内容块），**官方 22 个结构化输出 schema 无一对应**。关键差异：

| 官方输出 | 我方实际 | 证据 |
|---|---|---|
| AgentOutput（三臂 union：completed 带 usage 全套/async_launched 带 outputFile/sub_agent_entered） | 子代理最终文本透传；生命周期走自建 task_* 流消息 | agent-tool.ts:112-125 |
| BashOutput（stdout/stderr 分离 + interrupted/isImage/backgroundTaskId 等 12 字段） | 单一文本（`[stderr]` 段拼接）；后台返回句子非字段 | bash.ts:224-229,403-434 |
| FileEditOutput / FileWriteOutput（structuredPatch/gitDiff/userModified） | 文本确认 + snippet；无 patch/diff 结构 | edit.ts:175-180；write.ts:148-152 |
| FileReadOutput（text/image/notebook/pdf/parts 五臂） | text→cat-n 字符串；image/pdf→API 内容块；notebook/parts 无 | read.ts:166-233 |
| GlobOutput / GrepOutput（durationMs/numFiles/counts） | 纯文本清单；无计数字段 | glob.ts:97-104；grep.ts:455-464 |
| WebFetchOutput（bytes/code/result…） | 转换后原文（10 万字符截断）；**语义差：官方 result 是 prompt 驱动的 AI 处理结果** | webfetch.ts:376-393 |
| WebSearchOutput / TodoWriteOutput（oldTodos 缺）/ ListMcpResources/ReadMcpResource（JSON 字符串装文本） | 文本化 | 各工具文件 |
| Monitor/TaskStop/NotebookEdit/Workflow/Task 四件套/ExitPlanMode/EnterWorktree 输出 | TOOL-ABSENT | — |

### 6.E 权限 / 其他类型 / 沙箱（官方行 2710–3550）

#### Permission Types

| 官方条目 | 本 SDK 状态 | 差异 | 证据 |
|---|---|---|---|
| PermissionUpdate/addRules·replaceRules·removeRules·setMode·addDirectories | MATCH（类型+运行时） | — | T:289-316；gate.ts:331-358 |
| PermissionUpdate/**removeDirectories** | **PARTIAL：类型有、运行时静默忽略**（default 分支 debug-warn） | 六变体类型承诺 vs 五变体实现 | gate.ts:359-363 |
| destination 运行时语义 | PARTIAL | 仅 'session' 生效，其余 debug-ignore | gate.ts:323-328 |
| PermissionBehavior | MATCH | — | T:275 |
| PermissionUpdateDestination | PARTIAL | 缺 **'cliArg'**（官方 5 值我方 4 值） | T:277-281 |
| PermissionRuleValue | MATCH | — | T:283-286 |

#### Other Types（差异行；MATCH 行略）

| 官方条目 | 本 SDK 状态 | 差异 | 证据 |
|---|---|---|---|
| ApiKeySource | PARTIAL | 缺 'oauth'（疑 NEW-IN-DOCS）；多自造 'none' | T:944 |
| SdkBeta | MISSING-FROM-TYPES | 无具名类型，string[] 宽松 | T:904 |
| SlashCommand | PARTIAL | description 松；缺 argumentHint（官方必填）/aliases? | T:1618-1621 |
| ModelInfo | PARTIAL | 缺 supportedEffortLevels/supportsAdaptiveThinking/supportsFastMode/supportsAutoMode；displayName/description 松 | T:1610-1615 |
| AgentInfo | PARTIAL | 缺 model?；description 松 | T:1624-1625 |
| McpServerStatus.tools | PARTIAL | **官方为含 annotations{readOnly/destructive/openWorld} 的对象数组，我方 string[]** | T:590 |
| McpServerStatusConfig | MISSING-FROM-TYPES | 无此名；ClaudeAIProxy 变体缺（NEW-IN-DOCS） | — |
| AccountInfo.apiKeySource | PARTIAL | 官方可选 string，我方必填枚举（含自造 'none'） | T:1629 |
| ModelUsage | PARTIAL | **缺必填 contextWindow/maxOutputTokens**（loop 构造不产出） | T:42-49；L:350-357 |
| ConfigScope | MISSING-FROM-TYPES | 近似物 SettingSource 同值域不同名 | T:804 |
| NonNullableUsage | PARTIAL | 手写 4 字段版，非官方对全量 Usage 的 mapped type | T:35-40 |
| Usage | PARTIAL | 缺 cache_creation{5m/1h 分桶}；server_tool_use 子集；service_tier 松；speed/inference_geo/iterations 缺（NEW-IN-DOCS） | T:23-32 |
| CallToolResult | MATCH | structuredContent 我方更宽松 | T:614-631 |
| ThinkingConfig | PARTIAL | 我方名 ThinkingConfigParam；budgetTokens 已支持；display?/ThinkingDisplay 缺（NEW-IN-DOCS） | T:795-798 |
| SpawnedProcess/SpawnOptions | MISSING-FROM-TYPES | N/A-by-design（无子进程） | — |
| McpSetServersResult | PARTIAL | **官方 {added,removed,errors} vs 我方 {servers}——零共同字段** | T:1554-1556 |
| RewindFilesResult | PARTIAL | **官方 {canRewind,error?,filesChanged?,insertions?,deletions?} vs 我方 {checkpointId,restoredFiles,deletedFiles,dryRun}——零共同字段** | T:1589-1594 |
| AbortError | MATCH（超集） | — | errors.ts:6-11 |

#### 观测臂消息（live 文档判别式实测核对）

**关键实测**：live 文档判别式已完全指定、并非「内部不一致」——`system`+subtype 用于 status/task_notification/hook_started/hook_progress/hook_response/task_started/task_progress/task_updated/files_persisted/local_command_output/commands_changed（11 个）；顶层 `type` 用于 tool_use_summary/tool_progress/auth_status/rate_limit_event/prompt_suggestion（5 个）。我方除 status 外全用顶层 type，**8 个变体判别式反向**。

| 官方类型 | 判别式 | 我方偏差（EMITTED 者加粗） | 证据 |
|---|---|---|---|
| SDKStatusMessage | system/status | 判别式同；缺 permissionMode?；status 松 | T:1387-1394 |
| **SDKTaskNotificationMessage** | **system**/task_notification | 判别式反；status→event 改名；缺 tool_use_id/output_file/usage；summary→message | T:1203-1210 |
| SDKToolUseSummaryMessage | 顶层 | 判别式同；官方 summary/preceding_tool_use_ids 全缺（自造 4 字段） | T:1153-1161 |
| **SDKHookStartedMessage** | **system**/hook_started | 判别式反；缺 hook_name | T:1214-1220 |
| SDKHookProgressMessage | **system**/hook_progress | 判别式反；缺 hook_name/stdout/stderr/output（回调钩子无 stdout 源，TYPED 理由成立） | T:1224-1232 |
| **SDKHookResponseMessage** | **system**/hook_response | 判别式反；缺 hook_name/output/stdout/stderr/exit_code/outcome | T:1236-1244 |
| SDKToolProgressMessage | 顶层 | 判别式同；缺 tool_name/parent_tool_use_id/elapsed_time_seconds/task_id | T:1142-1150 |
| SDKAuthStatusMessage | 顶层 | 判别式同；官方 isAuthenticating/output[] 全缺 | T:1300-1306 |
| **SDKTaskStartedMessage** | **system**/task_started | 判别式反；description→task_name；缺 tool_use_id/task_type | T:1165-1172 |
| **SDKTaskProgressMessage** | **system**/task_progress | 判别式反；缺 description/subagent_type/usage（官方必填）/last_tool_name | T:1177-1186 |
| **SDKTaskUpdatedMessage** | **system**/task_updated | 判别式反；无 patch 封套；status 值集不同（我方含 cancelled 缺 killed） | T:1191-1199 |
| SDKFilesPersistedEvent | **system**/files_persisted | 类型名+判别式+files 元素形状全不同；缺 failed/processed_at | T:1247-1256 |
| **SDKRateLimitEvent** | 顶层 | 判别式同；**无 rate_limit_info 封套**，语义错位（官方=配额状态；我方=429 重试通知；KD-12：官方 429 实发 api_retry） | T:1278-1285 |
| SDKLocalCommandOutputMessage | **system**/local_command_output | 判别式反；缺 content | T:1259-1266 |
| SDKCommandsChangedMessage | **system**/commands_changed | 判别式反；commands→available_commands | T:1269-1274 |
| SDKPromptSuggestionMessage | 顶层 | **观测臂唯一近乎全对齐**（reasoning? 为 BPT 扩展） | T:1340-1346 |

#### Sandbox Configuration（官方 SandboxSettings vs 我方 SandboxOptions）

| 官方字段（默认） | 本 SDK 状态 | 证据 |
|---|---|---|
| enabled（false） | PARTIAL：**默认反向**（后端可解析时默认 ON；COMPAT 已明记） | backend.ts:4-6 |
| failIfUnavailable（true，起不来→error_during_execution） | MISSING：我方恒优雅降级（等效恒 false）+debug | backend.ts:55-58 |
| autoAllowBashIfSandboxed（true）/ excludedCommands（[]）/ ignoreViolations / enableWeakerNestedSandbox / ripgrep | MISSING-FROM-TYPES（5 字段） | — |
| allowUnsandboxedCommands（true） | PARTIAL-改名：≈我方 allowEscape（false=mandatory 同义） | T:745-749 |
| network.*（allowedDomains/deniedDomains/allowManagedDomainsOnly/allowLocalBinding/allowUnixSockets/allowAllUnixSockets/httpProxyPort/socksProxyPort） | MISSING：我方 allowNetwork 布尔二元（--unshare-net）；COMPAT 已明记域名单代理未实现 | bwrap.ts:37 |
| filesystem.allowWrite | PARTIAL-改名：≈顶层 writablePaths（+自动 rw 挂载） | T:740-744 |
| filesystem.denyWrite / denyRead | MISSING（v1 明确不做读隐藏） | backend.ts 注释 |
| （我方独有）backend 注入 | BPT-EXTENSION | T:750-754 |
| Permissions Fallback（dangerouslyDisableSandbox→权限系统） | MATCH（走 gate 作 ask；bypass/allow 规则外不自动放行） | COMPAT sandbox 行 |

沙箱一节为 COMPAT 最诚实部分：形状差已声明「BPT-shaped」、未实现项逐条列出；仅上述 7 个字段级缺口未逐条记录。

---

## 7. 与 07-03 前作的关系

- 前作（v0.1 时代）判 MISSING 的 41 行中，压缩/结构化输出/子代理/缓存/检查点/外部会话存储/工具搜索/沙箱等大块已在 v0.2–v0.6 毕业——本档不再重复特征级判定。
- 本档新增的粒度：**字段名/判别式/默认值/导出名**级别的 drop-in 兼容性——这是一致性套件（L1–L5 行为差分）与 COMPAT.md（特征级）之间此前无人覆盖的缝隙。
- 机器可读矩阵未随本档重做（五段表本身即索引）；若守密人需要 JSON 层，可从本档表格派生。

## 8. 残余盲区

- live 文档无版本号标注，「NEW-IN-DOCS」判定基于特征旁的 min-version 注记与钉版类型面比对，个别项（如 SDKAssistantMessage.error）无法精确断代——升钉 0.3.201+ 时以官方包 d.ts 复核。
- 官方**运行时实际行为**与其文档偶有出入（一致性套件已实测多处，如 KD-12 rate_limit_event、KD-L3-19 BashOutput）——本档只对「文档接口说明」负责，行为层以 conformance 套件为准。
