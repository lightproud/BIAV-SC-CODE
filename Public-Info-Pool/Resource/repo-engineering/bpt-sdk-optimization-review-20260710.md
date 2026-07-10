# BPT Agent SDK 代码与功能设计审查 — 优化建议（2026-07-10）

- 审查对象：`projects/bpt-agent-sdk/` @ v0.35.0（src 29,680 行 / 68 测试文件 1,548 用例）
- 方法：4 个并行只读审查代理分维度深查（架构与模块设计 / 正确性与健壮性 / 公开 API 面与 DX / 性能与测试架构），全部发现要求 file:line 实证、禁止臆测；本档为合并去重后的分级汇总。
- 行号基准：main @ `0bfc1543`（v0.35.0 合并后）。
- 判级：P0 = 真缺陷（有具体失败场景）；P1 = 高价值优化 / 静默失效；P2 = 结构性债与文档漂移。CONFIRMED = 代理完整追踪过代码路径；PLAUSIBLE = 推理成立、需复现确认。

## 总评

引擎主干的取消链、tool_use/tool_result 配对守恒、fail-closed 意识明显高于平均水准（负面清单见 §6）；接缝方法论（契约先行、Transport 单切换点）已被 OpenAI 传输零引擎改动落地所验证。当前主要债务不是「设计错」，而是三类：**① 少数真缺陷集中在新翻译层与两条冷门引擎路径；② 文档与守卫没跟上代码生长速度**（import 契约 13 处越界无守卫、三份文档对同一默认行为口径相反、旗舰示例已随 v0.7 事件改版失效）；**③ 刻意保守（字节锁）付出的重复尚未配防漂移护栏**。

---

## 1. P0 — 真缺陷（建议立即修）

### P0-1 [CONFIRMED] OpenAI 流翻译器：交错 tool_calls 产出损坏的 tool_use 块

`src/transport/openai.ts:423-439`（feed 的 tool_calls 分支）+ `:471-495`（openBlock/closeOpen）。翻译器只维护一个打开块（`openKey`）；vLLM 等后端在两个并行 tool call 间交错发增量时：先开 `tool:0` → 见 `tool:1` 即关 0（input 落为 `{}`）→ `tool:0` 的参数再来时另开幽灵块（id 合成 `call_N`、name 空）。结果两态：**静默错误执行**（真实工具拿到空输入 + 幽灵块报 No such tool）或整轮 `error_during_execution`（半截 JSON 使 accumulator `parseToolInput` 抛错）。

- 修复：按 `tc.index` 维护多块并行累积（Anthropic 协议本身允许多 index 同开），accumulator 无需改动。工作量 S。
- 比喻：收发室只有一张桌子，两个包裹的零件交替送来——桌上的拼一半就被封箱，后到的零件塞进贴错名字的新箱子。

### P0-2 [CONFIRMED] 两条路径把带孤儿 tool_use 的 assistant 轮推进 requestView，砖化整个进行中会话

`src/engine/loop.ts:1405`（结构化输出重试）与 `:1453`（自然结束 + 后台子代理结果 drain）缺少 `:1488` 已有的 C6 孤儿过滤。失败场景：`outputFormat` 开启 + 回复在 `max_tokens` 截断且带未执行 tool_use → 校验失败重试路径把孤儿轮入库 → 下一请求 400 "tool_use ids without tool_result"，且**本查询内每个后续轮持续 400**，只有落盘 resume 经 `repairPairing`（`src/sessions/store.ts:91-191`）才自愈。

- 修复：两处补同一行过滤。工作量 S。
- 比喻：账本记了「已下单」却永远没有「已收货」行，之后每次对账都被打回。

### P0-3 [CONFIRMED] TaskOutput 阻塞轮询无视 abort：interrupt()/close() 延迟无上界

`src/tools/shells.ts:419-433`：`block:true` 轮询不检查 `ctx.signal.aborted`，且 `timeout` 取模型给的任意正数无钳制。模型一句 `TaskOutput{block:true, timeout:86400000}` 盯安静后台 shell，`close()` 的资源回收（`src/query.ts:1752-1808`：shells.dispose / subagent abortAll / MCP closeAll）被拖最长一天。

- 修复：轮询每拍查 signal 抛 AbortError + timeout 硬上限。工作量 S。
- 比喻：下班铃响了，仓库管理员戴着耳机数货，全楼等他数完才能锁门。

### P0-4 旗舰 Electron 示例的消息泵已随 v0.7 失效（静默）

`examples/electron-host.mjs:107-108` 仍写 `case 'task_started': msg.task_name`；v0.7 起该事件已改 `{type:'system', subtype:'task_started'}` 且字段改名 `description`（`src/types.ts:1751-1760`、`docs/MIGRATION.md:120-135` 5f 自己要求消费方改写）。照抄示例的宿主永远收不到子代理生命周期事件、无任何报错。修复 + 给示例加编译/mock 冒烟测试。工作量 S。

- 比喻：说明书教人换了新门牌号，示范房却还挂着旧门牌。

### P0-5 settingSources：三处文档口径互相矛盾 + 运行时诊断说谎

代码真相：省略 = 加载 user+project+local 的 CLAUDE.md/AGENTS.md + 项目 `.mcp.json`（`src/query.ts:748`、`:546-557`）。矛盾现役文档：`docs/MIGRATION.md:82-84`（说只加载 .mcp.json，与同文件 218-227 行自相矛盾）、`README.md:79-81`（说完全不读）、`docs/COMPAT.md:226-227`（说 omit 什么都不加载，与同文件 269 行冲突）。另外 `src/query.ts:115-117` 仍把 `settingSources` 列在 ACCEPTED「无效果」警告名单——它明明有效。这是「会不会把磁盘上的 CLAUDE.md 注入 system prompt」级别的默认行为，宿主按错误口径规划会直接产生提示词与成本意外。统一口径 + 摘除误报。工作量 S。

- 比喻：三份说明书两份说「大门默认锁着」，实际是敞开的。

---

## 2. P1 — 高价值优化与静默失效

### P1-1 压缩触发器 O(n²) CPU + 「超窗 400 杀死 run」精度风险（一石二鸟项）

- CPU：`src/engine/loop.ts:1032` 每子回合调 `shouldAutoCompact` → `src/engine/tokens.ts:61-75` 逐码点重扫**全部历史**（`tokens.ts:102` 还对每个 tool_use 重复 JSON.stringify）。150K token 历史单扫 5-10ms，百子回合会话累计 0.3-0.6s 且平方增长。
- 精度：token 估算是上下文窗口的**唯一防线**；低估 → 压缩触发过晚 → API 400 `prompt too long`，而 fallback 只认 429/5xx（`loop.ts:80-82`），**该 400 直接终结整个 run**。
- 修复（可叠加）：① `WeakMap` 按消息身份缓存估值、只算增量（注意 `loop.ts:1370-1376` drainSubagentResults 会就地变异末条 user 轮，需失效处理）；② 用每回合 `message_start` 已带的**精确** input/cache token 地面真值校准估算基线——零额外调用，同时消 O(n²) 与漂移。工作量 S。
- 比喻：每写一页新日记都把整本从头数一遍字数；其实装修师傅（API）每次都给过整面墙的精确尺寸，只要量新砌的那截。

### P1-2 OpenAI 传输加固三件（与 P0-1 同批做）

1. **[PLAUSIBLE] 无 [DONE] 无 finish_reason 的干净断流被捏造成 end_turn 成功**（`openai.ts:341-354` + `:444-469`）：半截答案被当完整答案。修复：finishReason 为 null 视为截断、抛带 `midStreamTruncation` 的错误对齐 E3 语义。
2. **request-id 已漂移**：Anthropic 臂捕获 `request-id` 注入 APIStatusError（`anthropic.ts:159/312/332`），OpenAI 臂从不读 `x-request-id`（`openai.ts:698`）——错误可关联性不对称。
3. **流故障测试象限空白**：`tests/transport-openai.test.ts` 对 860 行实现缺 8 个具名用例——中途断连 midStreamTruncation 两臂、空闲看门狗映射（`openai.ts:575-586/812-819`）、整体超时、流中 abort、`delta.reasoning` 网关别名（`:402`）、tool_call 缺 id 回退（`:427`）、text→tool→text 交替重开序列、retry-after 60s 封顶（`:794`）。

工作量合计 S-M。比喻：广播讲到一半停电，转播员自己补了句「以上就是全文」；考卷专门没考「下雨天」那几道。

### P1-3 transport 双胞胎防漂移护栏

`openai.ts` 与 `anthropic.ts` 约 210 行（24%）近逐字重复（requestWithRetries `anthropic.ts:263-334`↔`openai.ts:633-700`、mapStreamError、backoff/sleep/parseRetryAfterMs 等），P1-2(2) 的 request-id 即第一道裂缝。分两步：**先加零风险的双胞胎防漂移测试**（归一化替换表后断言 token 级一致，新漂移即红灯，S）；下次触碰 transport 时再抽 `transport/http-retry.ts`（注入 debugLabel/readErrorInfo/requestIdHeader，字节等价护航，M）。

- 比喻：两台一样的闹钟各自上发条，今天已差一分钟——先立一块「每天对表」的规矩，再考虑合成一台。

### P1-4 OpenAI 协议的真实网关缺口（立项级）

1. **`provider.modelMap`（最大缺口）**：Claude 默认模型 id 散布四处——`generators/runtime.ts:26`（haiku 默认）、`verifier/index.ts:35`、`subagents/agents.ts:189-194`（别名表）、`query.ts:85-95`；网关用户漏覆盖一处就是运行期 404。建议 `provider.modelMap?: Record<string,string>` 在 `resolveModelAlias` 与 utility 默认解析处统一套用。工作量 M。
2. **三条静默失效改显式警告**（S）：`maxBudgetUsd` 命中零价目（`pricing.ts:27-33`，预算闸门永不触发）、`thinking` 配置被剥除（`openai.ts:177`，preset 默认注入 thinking 意图的宿主以为开了推理）、`betas`/`apiVersion` 被忽略——三者均建议发一次性 `informational` 消息（该类型 `types.ts:2009-2016` 已定义、从未启用，正好用上）。
3. **Azure 类网关不可达**（M，按需）：仅支持 Bearer（`openai.ts:735-741`），无 `api-key` 头 / query 参数能力；建议 `openai.authHeaderName` + `extraQueryParams`。
4. `provider.pricing` 注入使预算闸门跨网关可用（M，可后置）。

- 比喻：换了外国插座，主插头配了转换头，屋里还有五个小家电插头没配。

### P1-5 [CONFIRMED] 钩子层 fail-open（策略裁定项）

`src/hooks/runner.ts:277-288`：会 deny 的 PreToolUse 钩子超时（默认 60s）或抛错后视为中立，工具照常执行。权限门本身处处 fail-closed（`gate.ts:171-177/283-287/301-303` 双重复查），唯钩子层例外——对以钩子实施安全策略的宿主是真实旁路。属设计取舍（回调永不搞崩主循环），建议加 `hookFailureMode: 'open'|'closed'` 旋钮或至少文档醒目声明。工作量 S。

- 比喻：金库的锁还在，但走廊上那道人肉关卡睡着了就等于没有。

### P1-6 [CONFIRMED-BY-TRACE] pending_turn 重驱绕过预算帽 / 重放拒绝轮

`src/query.ts:1442-1447/1476-1478/1607-1621`：任何 `is_error:true` 终局（`error_max_budget_usd`、`refusal`）都让 pending_turn 悬空；resume 时新进程 sessionCost 归零、redrive 又在预算重臂**之前**——被预算掐停的会话 resume 后自动再烧一轮。修复：turn 以终局结果收尾时 settle pending_turn（区分「请求段崩溃」与「轮已终局」）。工作量 S-M。

- 比喻：家长说「零花钱花完了停」，孩子记成「上次没买完」，重启游戏机自动又下一单。

### P1-7 会话存储两处 I/O 账单

1. `list()` 对每个 `.jsonl` 全文件解析三遍配对修复只为出目录摘要（`store.ts:425-440`）——重度用户 O(全目录字节)；改流式只读 meta/meta_update 行（`latestSessionId` `:442-462` 已是正确范例）。S-M。
2. 内部 JSONL 每条 `mkdirSync + appendFileSync`（`store.ts:274-275`），每回合 4-5 次同步写在流式热路径上阻塞事件循环；外部 `FileSessionStore` 已是异步批写（`file-store.ts:198-210`），两套纪律不一致。M。

- 比喻：想看书架上每本书的书名，却把每本书从头读一遍；寄每封信都先跑去确认邮局还在。

### P1-8 [CONFIRMED] 后台收尾两件

1. `abortAll()` 只发信号不等收尾（`query.ts:1765`、`runtime.ts:1120-1125`）：迟到的 `sidechain_end` 落在 `store.flushAll()`（`query.ts:1782-1792`）之后，注入 MirroringSessionStore 时镜像永久缺尾（`store-adapter.ts:323-330` unref 定时器）。修复：finally 中带短超时 `Promise.allSettled` 后再 flush。S。
2. detached 后台 shell 在宿主硬崩溃 / Query 拿到后从未迭代也未 close 时成真僵尸（`shells.ts:76-81/164`）——固有残余风险，文档化 + 考虑兜底。S（文档）。

- 比喻：放学铃一响老师锁抽屉走人，还在写作业的学生把作业交到抽屉缝外面。

---

## 3. P2 — 结构性债与纪律

### P2-1 import 契约失效 + engine↔subagents 包级环（架构头号债）

契约（`src/internal/contracts.ts:1-7`、`docs/ARCHITECTURE.md:20-22`）规定模块只可 import types/errors/contracts；实测叶子模块 **13 处越界**（清单：`subagents/runtime.ts:68-78` 8 处、`generators/runtime.ts:19-21`、`hooks/{condition,runner}.ts`、`engine/compaction.ts:40`、`tools/{bash,shells,enterworktree,workflow}.ts`、`mcp/project-config.ts`、`engine/runtime-context.ts`、`tips/index.ts`、`verifier/index.ts`）。其中 `engine/compaction.ts:40 → subagents/agents` 与 `subagents/runtime.ts:69 → engine/loop` 构成包级环。错误纪律有机械守卫（`tests/error-discipline.test.ts` 解析文档执行），import 纪律零守卫。

- 修复三步：① `resolveModelAlias` 移中立处断环（S）；② ARCHITECTURE.md 模块地图更新至实况、册封 internal/sandbox/generators 为共享内核层（S）；③ 仿 error-discipline 加 import-discipline 测试、白名单从文档解析（M）。
- 比喻：校规写着「不许跨班借东西」，全校已互相借了半年、老师没点过名——再不改校规或真查一次，规矩等于没有。

### P2-2 prompt 装配是横跨两文件的「分布式算法」（下一个最该有 Transport 式接缝的位置）

系统提示四元组 `systemPrompt/Suffix/BaseLen/systemBlocks` 在 `query.ts:677-785` 组装、`loop.ts:581-666` 二次解释（三态 + 断点落位），靠「structured-output 指令必须追加在 base 之后才不破坏字符偏移」这类脆弱不变量耦合（`query.ts:758-769`、`loop.ts:599-601` 防御兜底）；`SystemComposition`（contracts.ts:444-456）第三套表达并存。建议把 parts 形态升为引擎契约 `systemParts: {role,label,text,cache?}[]`，loop 内单点推导 wire blocks 与断点。M-L，与 P2-3 的 config 组装抽取同批。

- 比喻：甲写信、乙贴邮票并规定「邮票必须盖住第 120 个字」——该改成信纸自带贴票框。

### P2-3 query.ts（2,008 行）与 loop.ts（1,519 行）的值得/不值得拆分清单

- query.ts 值得抽三块：会话记账 → `query-accounting.ts`（顺手合并 `:1220-1240` 与 `:1251-1271` 两段逐字近同的 ModelUsage fold，S）；持久化/WAL/会话解析（`:994-1151`）→ `sessions/` 旁（M）；EngineConfig/prompt/thinking 组装（`:670-866`）→ `engine/config-builder.ts`（M）。driveTurn/run() 编排**不拆**（生成器状态与 interrupt/close 时序高耦合，拆开只会把闭包变参数雨）。
- loop.ts 唯一自洽可出走的是工具派发管线 `executeToolUse` 全链 + 专属 helper（`:760-976` + `:104-216`，约 280 行）→ `engine/tool-dispatch.ts`（M）。其余（fallback/打捞/预算停/并发分组/structured-output 门）是「一个 agent 环」叙事本体，不拆。
- 顺带死代码：`loop.ts:534-535` 外层 `overheadTokens` 算完从未用（启动时白做一次全 schema stringify + 同名遮蔽隐患）。微。
- 比喻：主厨同时管买菜记账洗碗掌勺——掌勺是本职，账本和洗碗池早该搬出灶台。

### P2-4 ToolContext 滑向 god-object + 两条契约外暗道

`contracts.ts:100-157` 已 5 必填 + 11 可选；更要紧的是：① duck-typed `permissionGate`（`tools/exitplanmode.ts:46-47` 定义、`query.ts:1390` 挂载）绕开契约；② worktree 会话状态以 `readFilePaths` 这个 Set 的**对象身份**为 WeakMap 键（`tools/enterworktree.ts:35/71`），`query.ts:1361-1362` 甚至造半个假 context 去查——谁若重建该 Set（如压缩后换新），worktree 会话静默丢失。建议：阶段一（S）契约内加显式 `sessionKey`、`permissionGate` 收编正式字段；阶段二（M）字段归组 session/capabilities。

- 比喻：全家把钥匙饭卡门禁都串在图书借阅证上——哪天补办借阅证，全家进不了门。

### P2-5 杂项（各 S 或微）

- `workflow-engine.ts`（955 行）非死重、集成良好，唯户口错置：单消费者私产放在 `src/internal/` 共享层，给了越界口实——移 `src/tools/`。
- KillShell SIGKILL 升级定时器不随进程退出取消（`shells.ts:181`，2 秒窗口 PGID 复用理论误杀）——exit 里 clearTimeout。
- 重试可观测消息在全部重试耗尽时丢失（`loop.ts:696`，最需要日志的场景恰好看不见）。
- `minRecentTurns:0` 显式配置时压缩可折叠刚提交的用户提示（`compaction.ts:293`）。
- 并行钩子 last-wins 完成序非确定（`runner.ts:19-23/392-405`）。
- ACCEPTED 档 21 个选项默认完全静默空转（`query.ts:402-408` 仅 debug 可见）——建议无条件发一次性 `informational`。
- `src/tools/bash.ts:512` 全仓唯一裸 `Error`。

### P2-6 文档漂移清账（全部 S）

| 位置 | 现文 | 代码真相 |
|---|---|---|
| `docs/MIGRATION.md:108-109` | thinking budget 默认 4096 | `DEFAULT_THINKING_BUDGET = 10_000`（`loop.ts:69`），4.6+ 走 adaptive |
| `README.md:144-150` | 内建工具 6 个 | 默认注册 22 个（`tools/index.ts:68-89`）|
| `README.md:88-96` | 环境变量 5 个 | 实际消费约 12 个（含 OPENAI_* 两个新增）|
| `docs/MIGRATION.md:7-8` | pin 0.3.199 | COMPAT 已 chase 0.3.201 |
| `errors.ts:36-41` + `docs/ERRORS.md:27-28` | 两错误码「wiring pending」 | 早已接线且被 session-manager 消费 |
| `anthropic.ts:38`/`openai.ts:67`/`query.ts:87` | USER_AGENT/版本硬编码 `0.1.0` | package.json 0.35.0——建议构建期注入 |
| `types.ts:1264-1270` | settingSources 仅 preset 路径 | `.mcp.json` 所有路径都加载 |
| preset-vs-省略 systemPrompt | 文档称等价 | thinking 默认只在 preset 拼写下开启（`query.ts:803-818`）——成本与流内容不同，至少 JSDoc 写明 |

- 比喻：地图整体是准的，但好几处路牌还是搬家前印的。

### P2-7 测试与 CI 补强

- 具名缺失用例：workflow 执行中 abort（引擎 `workflow-engine.ts:657/719` 有检查、无用例）；session-manager `close()` 打断在途 query；P1-2(3) 的 openai 流故障象限。
- 一致性套件并非 manual-only（`bpt-agent-sdk.yml:130-176` 每次 push/PR 跑 L1-L4 + ratchet 硬门禁，零 API 费）；真正的盲区是**真实 API 服务端行为漂移**只有手动 dispatch 的 L5（~$1.5/轮）能抓——建议给 L5 设月度/双周小预算定时。
- 测试组织健康：helpers 仅 2 件、mock transport 被 24 文件复用、无夹具复刻。
- 比喻：家里的烟雾报警器很灵，但闻的是模型房子的烟；真房子每周只有人路过看一眼门牌。

### P2-8 备案（不建议现在动）

- `subagents/runtime.ts`（1,127 行）是事实上的第二装配根，与 query.ts 平行演化（根路径修复不自动惠及 sidechain）——两侧真实差异大，强行抽公共 turn-driver 会造参数沼泽；下次触碰时只抽真正同构的小件（规则过滤、usage fold）。
- accumulator 的 `+=` 字符串拼接经核实无 O(n²) 风险（V8 rope），**不要动**。
- `history` 与 `requestView` 共享消息对象引用、无冗余拷贝；各缓冲上限（后台 shell 每流 500,000 字符硬顶等）核实存在且被强制。

---

## 4. 已验证无恙的关键点（负面清单，防止误修）

abort 链路主干（监听器具名、finally/close 双点移除）；RequestSemaphore release 幂等；并行只读工具组的孤儿收敛与配对占位；E3 打捞与 OpenAI 翻译器交互（解析错误不带 midStreamTruncation、不会误打捞；OpenAI 路径打捞方向偏保守=安全）；权限门对原始/改写输入双重 deny 复查 + sandboxEscape 强制 ask + 未识别决策 fail-closed；fork 快照共享安全；compaction 无并发写竞态、切点守恒配对；会话存储 id 防穿越 + 三趟配对修复 + 撕裂行跳过。

## 5. 建议落项顺序（供守密人裁定）

| 批 | 内容 | 性质 | 工作量 |
|---|---|---|---|
| 1 | P0-1/2/3 三个真缺陷 + P1-2 OpenAI 加固三件（同文件同批） | 修缺陷 | S×5 |
| 2 | P0-4/5 示例与 settingSources 文档统一 + P2-6 文档漂移清账 | 纠文档 | S 批量 |
| 3 | P1-1 压缩估算增量化/真值校准 + P2-3 死代码 | 性能+精度 | S |
| 4 | P1-3 双胞胎防漂移测试 + P2-1 断环/地图/import 守卫 + P2-7 具名用例 | 护栏 | S-M |
| 5 | P1-4 modelMap + 静默失效警告（OpenAI 协议可用性） | 功能 | S+M |
| 6 | P1-5/6/7/8 策略与 I/O 项（各需小裁定） | 加固 | S-M |
| 7 | P2-2/3/4 结构抽取（趁下次自然触碰各文件时做） | 重构 | M-L |

原则：先补护栏与真缺陷（全 S 级），M/L 级抽取不单独立项、挂在下次触碰对应文件的任务上顺路做，扰动最小。
