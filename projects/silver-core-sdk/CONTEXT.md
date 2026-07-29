# silver-core-sdk — 子项目会话上下文

## 定位

Silver Core SDK：独立重实现（independent reimplementation）的 TypeScript agent 框架，公开调用面
drop-in 兼容 `@anthropic-ai/claude-agent-sdk`，引擎直连 Anthropic Messages API
（fetch + SSE），**不捆绑任何专有 CLI 二进制**。银芯 → 黑池单向输出物：黑池
（BPT Desktop, Electron/Node）换 import 即可摆脱对被禁 `claude.exe` 子进程引擎
的依赖。

- 派发来源：守密人 2026-07-03 会话（背景：Claude Code 被列入办公环境高风险软件，
  BPT 需自有引擎）。
- 净室纪律：唯一输入为公开文档（code.claude.com/docs/en/agent-sdk/* 与公开
  Messages API 文档），零复制专有代码；本包 MIT 许可。
- **净室观测边界（硬约束，守密人 2026-07-05 裁定；r2「理顺」+ r3「放弃净室规定 / 仅解除内容盲」，全文见 `memory/decisions.md`）**：
  ① 行为对照仅限**官方发行渠道产物 + 官方公开文档**，第三方复刻不得作参照；
  ② **内容盲纪律 r3 已解除（2026-07-05）**——一致性观测中官方臂请求体（系统提示词 / 工具定义 /
  缓存断点 / thinking 配置等）**现允许读取与对照**（内容按 #421 已属公开可得、读之不泄新信息，反开出更强白盒轴）。
  据此新增**请求体线缆差分**轴：L1-L5 由纯输出差分升级为输入+输出差分；`emulator.mjs` 请求体从「无缓冲丢弃」
  升级为**可选捕获**（默认仍丢弃、保持既有 L1-L5 语义不变），`assertContentBlind` 降级为**产物体积卫生检查**（非净室强制令）；
  ③ **泄漏衍生禁引（不变、永久保留）**——claw-code / Nano-Claude-Code / claurst 及 2026-03 **内部源码泄漏**
  事件同源衍生物一律不读不引（转写/查重清零/转手均不洗白）；豁免注：公开分发产物的
  逆向快照（如 Piebald）**不在禁引之列**（「公开分发可逆向 ≠ 内部偷流出」）。§1.1-HC 黑池防火墙永久关闭、本次无涉。
  官方臂协议剖面（首个合规执行范例）：
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-arm-protocol-profile-20260705.md`；
  一致性套件蓝图（r2）：`.../bpt-sdk-conformance-suite-design-20260705-r2.md`。
- **版本纪律（2026-07-05，黑池消费方诉求）**：凡改动发货运行时（`src/` 或 runtime 依赖）的 merge **必 bump 版本**
  （修复 patch / 新能力 minor）并在 `CHANGELOG.md` 记一行（随 tarball 发货）；CI 守卫 `scripts/check-version-bump.mjs`
  改 src 不 bump 即红。背景：三拨不同构建同名 0.6.0 tarball，黑池无法 pin/回退/对账。
- 兼容矩阵（实现 / 部分 / 仅接受 / 不支持 四档）：`docs/COMPAT.md`
- 模块施工图与内部契约：`docs/ARCHITECTURE.md` + `src/internal/contracts.ts`

## 结构

```
src/
├── types.ts               # 公开类型面（drop-in 契约心脏）
├── errors.ts              # AbortError / APIStatusError / ...
├── internal/contracts.ts  # 模块间内部接口
├── transport/             # A: 直连 Messages API（SSE 解析 + 重试）
├── engine/                # B: agent 环（累积器 / 定价估算 / 系统提示 / loop）
├── tools/                 # C+D: Read Write Edit Bash Glob Grep + registry
├── permissions/           # E: 规则解析 + 权限门（九步判定序）
├── hooks/                 # E: matcher 语义 + 并行 runner（deny>ask>allow）
├── mcp/                   # F: stdio/http 客户端 + 进程内 sdk server + registry
├── sessions/              # G: JSONL 会话存储（resume/continue/fork）
├── query.ts               # G: Query 编排（init 消息 / 流式输入 / 控制方法）
└── index.ts               # G: 包出口
```

## 命令

| 场景 | 命令 |
|------|------|
| 安装 | `npm install`（子项目目录内） |
| 类型检查 | `npm run typecheck` |
| 构建 | `npm run build`（ESM + d.ts → dist/） |
| 单测 | `npm test`（vitest，mock 传输层，零网络；含仿真器端到端集成测试） |
| 真机 smoke | `ANTHROPIC_API_KEY=... node tests/integration/live-real-api.mjs`（需先 `npm run build`；打真 api.anthropic.com） |
| 描述基准吻合度 | `node scripts/description-coverage.mjs [--json] [--min=N]`（**尺子不是门禁**：逐条报本包描述对所引快照档还剩多少逐字吻合 + 该档 ccVersion。吻合度本就不该满分——红线纪律禁止描述未发货能力，硬拉满等于逼描述吹本包做不到的事，故**恒 exit 0**、低分要人来分「已登记改编」还是「上游加了新话没跟」。需先 `npm run build`。射程边界：重建档把数字上限模板化，**数值常量在仓内无法核验**）|
| 类型面漂移（vs 官方 d.ts） | `node scripts/type-parity.mjs [--all] [--json] [--official <path>]`（**只报「新的」**：本包工具 Input/Output 类型按嵌套点号路径比官方 `sdk-tools.d.ts`，已裁定差异写进脚本内 `RULED` 白名单自动扣除、且一条裁定吸收整棵子树——每次都吐同一批已知差异的报告，人第二次就不看了。与描述吻合度同族：**尺子不是门禁，恒 exit 0**，差异本就不该为零。官方臂 `npm i --no-save @anthropic-ai/claude-code`（净室边界①），缺臂时打印取法照样 exit 0。解析器易出**假发现**，故由 `tests/type-parity.test.ts` 钉住历次真踩过的坑）|
| 双层评估 runEvals（SCS-REQ-002 环二） | `node scripts/run-evals.mjs`（底线层 = 全量 vitest pass/fail；行为层 = `evals/` 20 题 + `claude-sonnet-5` 判卷——12 题 prompt-session + 8 题 Phase 2 harness（`scripts/eval-harnesses.mjs` 故障注入/resume/压缩压力），无 key 走 STUB 验管线；`--judge-batches` 走 Batches API 五折判卷。评估集为守密人定稿权保护路径，任何改动须 `node scripts/update-evals-manifest.mjs` 重签清单，否则治理测试红。回归门禁 `node scripts/check-eval-regression.mjs`（REQ-2.2，报警不阻断）） |

## 测试三层

1. **单测**（`tests/*.test.ts`）：mock 传输层，纯逻辑，零网络（计数随版本滚动，以 `npx vitest run` 实测为准，当前见「当前状态」节）。
2. **仿真器端到端**（`tests/integration/emulator-e2e.test.ts`）：真 fetch/HTTP/SSE/agent 环/工具落盘/MCP/会话，只把模型换成本地 Messages-API 仿真器；**零密钥、进常规 `npm test`**。
3. **真机 smoke**（`tests/integration/live-real-api.mjs`）：真 Claude 模型自己决定调工具；从 `ANTHROPIC_API_KEY` env 读密钥（**脚本不含密钥**），不进 `npm test`。CI 侧由 `.github/workflows/silver-core-sdk.yml` 的 `live-smoke` job 手动触发（`workflow_dispatch`），用 `secrets.ANTHROPIC_API_KEY` 注入——密钥值全程不入仓库。

## 当前状态

<!-- CONTEXT-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->

**当前版本 `2.2.0`** · 发布日 2026-07-29 · 家族锁步对端 `silver-core-maestro-sdk` = `2.2.0`

> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由`tests/test_status_doc_facts.py` 守。

<!-- CONTEXT-FACTS:END -->

**v2.2.0（2026-07-29）：锁步对齐**——本包零代码改动，随 maestro SDK 2.2.0（设计第三轮：注入式 AgentExecutor / RoutineManager 例程管理面 / workflow 确认门 / query 行成本入账）前进。本包刻意零供给：执行座位只消费公开 `query()` 面——硬性质 §1.2 成立的证明，不是缺口。

**v2.1.0（2026-07-29）：AskUserQuestion 只报「怎么结束的」，不替宿主断言用户意图（BPT 请求）**——handler 抛异常与返回 `null` 曾共用同一句 `User declined to answer.`，两者都是宿主侧机械事实，模型据此向用户复述从未发生的拒答（黑池 UI 连取消按钮都没有）。现两路各说各的机械事实并明示「意图未知」，抛值经 `thrownMessage()` 保住诊断；新增结构化产出 `AskUserQuestionStructuredOutput`（`outcome` 五态 + 本包自有 `UserQuestionAnswer[]` + `error`），消费方分流不必再字符串匹配写死文案。官方 permission-component 形状仍不发货。
**v2.0.0（2026-07-29）：T75 设计轮落地（BREAKING·记忆面收敛 Claude 形态）**——①cards 模式整体退役（`schema:'cards'` / `memory.cards` / `parseMemoryCards` / `validateCardsContent` 及类型全下架；守密人三轮裁定：cards 本是 R9 黑池适配轴、非 Claude 记忆模式；迁移 = 换 `schema:'frontmatter'`、旧档 delete+create 换 YAML 头、卡文保留——testbed 做梦卡随步迁作参照例，黑池侧口述核实无 cards 消费后开工）；②`schema:'frontmatter'` 写侧校验器双层落地（name/单行 description≤150/type 四枚举/可选 pinned，索引豁免，报错含 delete+create 自愈指引）+ 官方 memory-instructions 全文注入（总纲 + user description 专档 + feedback/project 各 when_to_save/body_structure，逐档 provenance 台账 `MEMORY_FRONTMATTER_SOURCES` + corpus-sync 守卫；pinned 注为声明 SDK glue）；③选择性附着 `memory.attachment`（官方挑选器提示词 faithful 复现，≤5 档按 description 挑选、pinned 绕挑选恒附着不占名额、25600 字节预算按序截断并披露、挑选器失败降级 pinned-only 绝不挡会话；硬依赖 frontmatter 档位否则 ConfigurationError）；④计费面：挑选器真实调用入会话账（`runUtilityCall.onUsage` + `SessionAccounting.foldUtilityUsage`），`memoryHealth.attachmentInjectionTokens` 与索引注入并列；⑤健康扫描增 frontmatter 完整率维度 + consolidation 迁移任务。

**v1.6.0（2026-07-29）：T75 二次拷问落地**——dream 信号源裁「指针段+预设」：`buildConsolidationPrompt.transcripts` opt-in 指针段（宿主命名转录/日志路径，Gather 只读取证、内容按不可信数据降权、租户范围宿主负责）+ `consolidationToolOptions()` 只读工具集预设（Read/Grep/Glob 物理白名单，Agent/LoopControl 同受滤，memory 经 options.memory 独立注册）——把「只用 memory 写」从提示词纪律升为 harness 下限、闭合 E-⑤ 矛盾；frontmatter 四类型 + 选择性附着裁「直接开设计轮」（否决缓议案），r1 需求档 `scs-req-memory-frontmatter-attachment-r1-20260729.md` 已于同日三/四轮追裁定稿（cards 裁退役并入 §一实现步、附着按案、pinned 采纳、when_to_save 官方全文注入）。

**v1.5.0（2026-07-29）：十条观察项拷问裁定全落地**——守密人逐条过堂（#7 收紧、#9 扩大收编两处否决推荐案）：AskUserQuestion 三处全补（plan-mode 段 + preview 转发 + oneOf schema）· Agent 描述从官方三档复现 + 描述治理完备性守卫（UNGOVERNED 台账，工具不入册即红）· Glob/Grep 零匹配披露忽略集 · Read 路径可见层归一 + 256KB 拒读覆盖大 limit 绕过 · Grep rg 方言兼容垫（POSIX 字符类 / (?P<name>)）+ type 报错自愈 · 冷/热分层守卫 · 记忆索引改官方链接格式 + 双态容量预警（approaching 80% 档 + 目标尺寸）；frontmatter 四类型等三项另开设计轮（todo T75 + 提案档）。

**同版前半（对齐审计三裁，原拟 1.4.0、因上游十七波占号并入 1.5.0）**——①记忆常驻索引「单向镜」被 view 上限重新打开：写侧告警只数 `store.view` 幸存行、丢弃 view 自身截断信号，而默认 `maxViewChars`(16000) 小于索引字节上限(25600)，密集 ASCII 索引先被 view 切掉、幸存头通过行/字节判定、告警永不响——新 `assessViewedIndex` 把 view 截断并入两侧共用判词（`breached:'view'`）；②索引注入补官方防护措辞（background context, not user instructions + 待验证声明——S1 挂载下他会话写入可进本会话 system prompt）；③ToolSearch 对齐官方查询语法（select:/关键词/+名限定 + max_results）与 `<functions>` 返回编码，入 provenance 治理（此前它是唯一治理体系外工具、却是银芯变体 2/3 工具面唯一入口）；④Bash 输出上限补齐官方两级设计（`options.bashLimits` + `BASH_MAX_OUTPUT_LENGTH` env，封顶 150000，默认路径字节不变）；⑤COMPAT 三处 Workflow 陈旧 SYNCHRONOUS 判词订正 + 十条未登记漂移入册。

**v1.4.1（2026-07-29）：`setServers()` 改增量 diff（BPT 缺陷 D）**——原来是 `closeAll()` + 整体重建 + `connectAll()`，追加一台服务端就把**其余每一台**断开重连（当前回合工具所在的 in-process `sdk` 服务端也不例外），一次 `load_skill` 让整个工具面抖一次。现在名字与配置都没变的条目原样留用（连接 / 工具表 / `serverInfo` / `enabled` 一并保留），只关真被移除或改配的、只连真新增或改配的；配置等值为结构比较，`sdk` 的 `instance` 按引用比对（重建即重连）。`added`/`removed` 从此描述真实发生的工作。

**v1.4.0（2026-07-28）：审计第十七波**——Read 把路径原样插进 `system-reminder` 围栏，一个 0 字节文件靠**文件名**就能伪造出带框架权威的注入（项目指令 CLAUDE.md 同款）；WebSearch 结果 title 里一个换行伪造出完整额外记录、**绕开 `blocked_domains`**；`server_tool_use` 从未被折叠，网页搜索费**一次都没计过**、预算闸门可被整笔突破；分段系统提示下消息缓存断点被整个撤掉，4 槽只用 2、每回合把全部历史当新 token 重发。

**v1.3.0（2026-07-28）：审计第十五 + 十六波**——`Read(*.env)` 是一条**永不匹配**的空规则（无字面前缀编译成 `^[^/]*\.env$`，取值恒为绝对路径），宿主以为已封实则全放行；`Bash(rm:*)` 拦不住 `sudo -u root rm -rf /`（剥旗标后停在旗标的值上）；子代理不继承会话期 deny 规则，执行的正是宿主刚禁止的动作；`auto` 分类器抛出整个逃出 `check()`；钩子 condition 门的模型评估无超时可永久挂住工具调用；MCP stdio 的 stdout/stderr 无 error 监听，一个服务器管道被拆即杀掉整个宿主。

**v1.2.0（2026-07-28）：审计第十四波**——有界错误体读取锁流后无人能再中止 fetch，503 重试每次留一个永不结算的读取钉住 socket，进程退不出去；`parent_agent_id` 从无写入方故永远为 null；子代理记录无 uuid 致每次读都换身份；另修幂等性与资源上限两镜头共 12 处。

**v1.1.0（2026-07-28）：审计第十三波**——三处令会话/请求永久损坏：跨服务器重名工具名 400 掉整请求；repairPairing 不保证历史以 user 轮开头，被吃掉开场行的会话此后每次 resume 都 400 且永不自愈；system-field 在调用方未标断点时空置四分之三缓存槽、整段对话每回合重新计费。另修时区四处。

**v1.0.0（2026-07-28）：审计第十二波**——两处工具定义缺陷令 API 从首条消息起拒绝整个会话（外部 MCP 工具名无字符集校验、input_schema 守卫停在 API 真正校验的字段上一层），皆藏于「mock transport 不校验请求体」这一盲区；另修 tip 接收提示词注入、价格覆写被硬编码比率吞掉、null content 崩溃、去重窗口永不重开、八条误导性错误消息。

**v0.99.0（2026-07-28）：审计第十波**——首扫仓库自身守卫机器。一致性台在零次比较上出具合格判词（L2 死 14/15、L4 全死）；htmlToText 与 compaction 的二次方卡死；705MB 转录静默读作「无此会话」；README goal 示例照抄即抛、猜写则放行每次停止。

**v0.98.0（2026-07-28）：审计第九波**——首扫从未审计面（构建/CI/评测脚本、发货示例）+ 四个新横切镜头。
本包份额：守卫静默退出 0（棘轮/版本/type-parity/run-evals）· 发射契约两处（续接 user 轮永不进流、
中断时 tool_result 轮落盘却不发射）· 数值边界五处 · 确定性四处 · 平台三处 · 分支级产出缺口三处。

**v0.97.0（2026-07-28）：导出权威 token 估算器 + 内建工具输出上限（黑池转派需求）**——
黑池「上下文构成」面板此前对未成请求的素材（草稿输入 / 待注入记忆 / 知识库候选）只能手工
镜像 SDK 估算算法，靠注释级「改 SDK 须同步」人肉契约对齐——必然漂移。现从包入口正规导出
`estimateTextTokens` / `estimateMessagesTokens` / `estimateToolDefsTokens`（引用级
re-export，与内部同一函数）与 `MAX_READ_OUTPUT_CHARS`（50000）+ frozen `TOOL_OUTPUT_CAPS`
（read 50000 / bash 30000 尾保留 / webFetch 50000 / grepHeadLimit 250 条目数；每值 import
自各工具实际执行的常量，不重抄字面量）。与 `buildSystemPromptParts`（ADR 0014/0022）同类：
内部已有实现、只差入口 export。验收测试 `tests/output-caps-export.test.ts`。原拟 0.95.0，
两度与同日审计波次（#867 / #868）撞号，定 0.97.0。

**v0.96.0（2026-07-28）：审计第八波（换镜复扫）**——本包再修 6 处：query 层两处 user 轮叠加
（`roles must alternate` 400 且重试不可恢复）· MCP HTTP 并发请求相互吃掉会话过期恢复守卫 ·
fork 读入把 JSON 数组行固化成幻影记录 · `file-store` 写吞读抛的 `ENAMETOOLONG` 不对称 ·
goal 匹配器继承 `failureMode:'closed'` 致挂起评审器把循环永久困住。

**v0.95.0（2026-07-28）：多波缺陷审计（八波 59 分区）**——100+ 处经核实真实缺陷全修，
每处均有具体失败输入；公开 API 与测试契约零改动。覆盖崩溃面（宽容输入致整轮丢弃）、线协议
（连续同角色轮 / 工具对边界 / MCP 跨会话 id）、权限 deny 七类绕过、原型污染与域名过滤绕过、
子代理与会话状态竞态、socket 与监听器泄漏、代理对截断与 NaN 守卫。战报见
`Public-Info-Pool/Resource/repo-engineering/sdk-bug-audit-multiwave-20260728.md`。

**v0.94.0（2026-07-28）：包内模型兜底默认值全数移除（BREAKING，黑池 sdk-bridge 转派需求）**——
触发事件：黑池生产两次报错，报错文案里的 `claude-sonnet-4-5` 在黑池任何配置里都不存在——它是
`query.ts` 里写死的 `DEFAULT_MODEL`，消费方漏传 `model` 时被静默换上、直到网关 400 才第一次现身。
结构问题不是「兜底值旧了」，是**包内置了一个错误来源**：包不知道消费方网关认哪些 id，兜什么都是错的。
按黑池首选方案 A 根治：`query()` 缺 `options.model` 且缺 `ANTHROPIC_MODEL` → 构造期即抛
`ConfigurationError`；`runUtilityCall` 全家（8 生成器 / tips / verifier / 直调 condition 评估）缺
`opts.model` → 请求出门前即拒；引擎内部 condition 调用改**继承会话模型**（与 compaction 摘要器同规）；
`DEFAULT_UTILITY_MODEL` / `VERIFIER_DEFAULT_MODEL` 两出口删除（0.3x 表面锁走 `knownRemovals`
登记通道，MIGRATION §3.10 记破坏性条目）。一致性台架显式钉住原默认 id，全部冻结基线字节不变；
COMPAT `model` 行降 FULL → PARTIAL 如实记「刻意偏离官方」。已按铁律传全网关 id 的黑池现有调用路径零行为变化。
**v0.93.0（2026-07-28）：recap 截断丢最新进度（BPT P1 需求单，3 小时活锁事故根因）**——确定性折叠的 `buildRecap` 超 4000 字符上限时取**前** 4000 字符即最早历史，最新进度（结尾几十行工具调用）必被截掉；模型每次折叠后从头重读（BPT 会话 4e2d03e0：3h15m 内 840 Read / 777 compact / 0 修改）。改**头尾双保留**：首行结构声明 + 尽可能多的完整结尾行，中间三问纪律标记衔接（丢多少/为何/怎么拿回），按行切不留半个 JSON，单行独超预算走 `sliceTailSurrogateSafe` 保尾。同轮把**截断纪律注册表扩到全 `src/` 递归**（0.87.0 守卫只扫 `src/tools`，engine 层结构性在射程外——本缺陷因此从未被「全家对齐」覆盖）；豁免走白名单，扩围浮现 30 档案逐条登记，除本条外均「登记即可」。验收先红后绿：旧实现下「recap 含最后一次 Read offset」断言必红。

**v0.92.1（2026-07-28）：自动续跑时被拒绝的控制面覆写仍被留存并重放**（全仓缺陷扫描 #861，TypeScript 侧首次 lint 扫描查出）——两条互相咬合：① 包裹层**先记账、后返回可能拒绝的 Promise**，`setPermissionMode('bypassPermissions')` 未解锁时会 REJECT，但该模式已写进 `pending`，一次被 query 拒绝、且被消费方正确 catch 的调用照样污染了重放状态；② `replayControlPlane` 声明 `(): void`、三个返回 Promise 的 setter 全不 await，叠加①后那个必然拒绝的重放成了悬空 Promise——Node ≥ 15 下未处理的 rejection **直接终止进程**，SDK 消费方连捕获的接缝都没有。改为「内层成功才记账」+ 调用点 await。**诚实边界**：次序竞态目前不可触发（四个 setter 首个 await 之前即完成赋值），按潜伏记；可触发的是拒绝路径。await 同时把「重放先于续跑被泵动」从**巧合**变成**结构保证**。两条均已证伪验证（回退任一，新增用例即红）。

**v0.88.0（2026-07-27）：处方卡型（A1）+ sessions 体检面（P1-S1）**——cards 模式增第二卡型
**处方卡**（意图/步骤/结果/适用边界，按字段集判型；单卡混用两型按名拒绝，结构化错误重述两模板；
进度卡映射处方型，解审计 P1-3 削足适履）；`MemoryCard` 改 kind 判别联合。新增
`assessSessionStoreHealth()`：sessions 目录只增不减而 `deleteSession` 无「何时清」信号——照
memory 体检成例给会话数/转录与 checkpoint 字节/腐化/最大会话/孤儿 checkpoint 目录，外部店诚实报
unavailable、触界标 lower bound、零进程零调度（N1）。blob 上限属正确性取舍挂 T74 待裁不静默选边。

**v0.87.0（2026-07-27）：截断纪律全家对齐 + cards 索引豁免**——上限砍内容须答三问（丢多少/为何/
怎么拿回）、流式保尾。后台 shell 流「命中 500K 即永久失聪」改保尾保留窗（丢弃计数入契约 + gap 标记）；
Bash/WebFetch/Glob/workflow 标记补齐；注册表测试逼新截断点登记；cards 校验两层豁免索引档
（修 0.84.0 自种 P4 矛盾）。详见 CHANGELOG。
**v0.87.1（2026-07-27）：嵌套路径普查（三扫）**（守密人「1 继续」）——前两轮普查比的都是**顶层键**，本轮把两边摊成**点号路径**（`contents[].blobSavedTo`、`gitOperation.commit.sha`）再比，专抓两类前两轮**结构上看不见**的差异：嵌在双方都声明的形状**里面**的字段，以及**两边都有、却待在不同类型里**的字段。**挖出一条真缺陷，而且是银芯自己的**：`timedOutAfterMs` 官方在**基类** `BashOutput` 里，0.85.0 却把它加在了银芯的**扩展类型**上。交出来的交集完全相同、没坏任何东西，而**任何顶层键比对都不可能发现它**——键在两边都存在，只是待错了地方。已移入基类。**其余全属平台绑定，只登记不声明**：`BashOutput.gitOperation.*`（官方**解析 git/gh 命令输出**成结构化 VCS 事实，银芯只跑 shell、不解析其输出，为填字段现造一个解析器不是对齐）· `ghRateLimitHint`/`staleReadFileStateHint`/`backgroundCwdHint`/`noOutputExpected` · `WebFetchOutput.artifactRead.*` · `gitDiff.repository`（在一个银芯声明了但从不产出的形状里）· `contents[].blobSavedTo` · AskUserQuestion 权限 UI 路径。~~九个类型逐层完全一致~~**（2026-07-27 由 v0.88.0 工具化重跑推翻：Glob / Grep / Workflow 三个并不一致——本轮手搓展平器只比了联合类型的第一支、也不匹配带引号的键，覆盖被高估了）**。**方法边界**：展平器只跟花括号深度与键名、不解析 TS 语义，故逐类型同时报**键总数**——数量级不对说明解析飞了，而不是类型真有差异。

**v0.92.0（2026-07-27）：Workflow 改为真异步启动**（守密人「1 改」）——**对调用方是行为破坏性变更**：工具不再返回跑完的结果。官方 Workflow 后台启动、立即返回 `{status:'async_launched', taskId}`；本工具原先把整个工作流跑在工具调用里再返回结果。**两者在类型层调和不了，而假装对齐比留着缺口更坏**——同步跑完再交 `status:'async_launched'`，等于给调用方一张「货已经在你手上」的取件凭证，它会去找一个在凭证打印之前就结束了的任务。于是**改的是行为**。**接进既有后台 id 空间**：新增 `ShellManager.registerTask({label,onStop})`，`TaskOutput` 读进度与结果、`TaskStop` 停——不另立注册表、不另加一对工具（模型拿着一个 task id，不该还要先知道它是哪种后台东西生出来的）；id 与 `bash_N` 共用计数器（永不撞号）、前缀 `task_`，记录里 `pid: undefined`（对一个 promise 而言这就是实话）、`kill` 路由到 `onStop` 而非发信号。**新增 `ToolContext.lifeSignal`**（查询生命周期信号）：`ctx.signal` 是**按回合**的，把后台工作挂在它上面是这里能犯的最坏一种错——启动回执照发、运行在回合边界**静默死掉**、调用方等一个永远不会来的结果。子代理运行时内部一直为此用查询级信号，本次把它开放给工具层。有回归测试钉住，且**已做反向对照**：把工具接回 `ctx.signal` 该测试确实转红——一条首跑就绿的竞态测试还不算证据。**语法错误保持同步**（新增只编译不执行的 `checkWorkflowSyntax()`）：官方同时规定「立即返回」和「语法错抛出」，这两条只有在**脱手之前**拿到判词才能同时成立；打错字的脚本绝不能先回执「已启动」、再在下一回合冒出错误。**停止优先于完成**：中途被停的任务报 `killed`，绝不报 `completed`。**三件刻意不声称的事**：不承诺 `<task-notification>` 推送（官方宿主有、本引擎对工具发起的后台工作没有，故回执指向 `TaskOutput`——那才是真正读得到结果的东西）；不给 `transcriptDir`（本来就没有）；**没有宿主就不谎称异步**——`query()` 之外没有 `lifeSignal` 可挂，工具就地跑完并在结果里**明说**，而不是回一个并未发生的 `async_launched`。`WorkflowOutput` 由此真正被填充、且诚实地是官方形状，Workflow 移出零产出台账——0.91.0 那道普查守卫的**陈条检查**在改动后首跑即抓到这次毕业。另清一条陈账：`'TaskStop'` 早已发货却一直挂在描述红线禁提清单上；红线是「绝不提未发货的工具」，把已发货的留在清单上会把规则反转成「绝不提我们有的」，反而压制诚实指引。

**v0.91.0（2026-07-27）：四个工具补上结构化产出 + 零产出面立台账**（守密人「全补」+「整体记档并入白名单」两裁）——**这一轮暴露的是 type-parity 那把尺子的射程边界**：它比的是**声明的形状**，不问**有没有人产出**，于是首跑一本正经地报 `AgentOutput` 差 20 个字段——而实情是本 SDK **从来没有任何代码填过 `AgentOutput`**，等于在很精确地量一个空盒子。顺着这条线做工具层普查，又揪出**四个「声明了官方形状、一行没填」**的类型，且每个的事实都**只能靠解析人话字符串**才拿得到。**Write** 补 `type`/`filePath`/`content`/`bytes`（+ 有 checkpoint 时的 `originalFile`）——`bytes` 是全批最刺眼的一个：数字**早就算好了**，然后拼进句子里扔掉了；**Edit** 补 `filePath`/`oldString`/`newString`/`originalFile`/`replaceAll`/`replacedCount`（前像不额外花钱——Edit 本来就得读全文才能替换）；**TodoWrite** 补 `oldTodos`/`newTodos`**完整**，为此新增一件东西：该工具原本零状态（模型每次重发整张单），`oldTodos` 根本不存在，现把上一版单子存进 **session-key WeakMap**（既定的按查询状态模式），调用方这才看得到**迁移**而不是只看到新单子；**EnterWorktree** 补三字段**完整**。`structuredPatch`/`gitDiff` 仍不填——没有差分引擎与 git 管线，填个空数组会被读成「没有改动」。**缺就报缺**：Write 的 `originalFile` 在没抓到前像时是**省略**而非 `null`——`null` 已经表示「原本没有这个文件」，把「不知道」塌缩成「不存在」会让字段主动误导（两条测试专钉这一点）。**立的是台账不是规矩**：`tests/structured-output-census.test.ts` 钉住「刻意不产出」的名单+逐条理由，新工具静默上线会红、名单里已经开始产出的陈条也会红。「所有工具都必须产出」是错的规矩——有些工具确实没有超出那句话之外的机器可读事实，硬套形状就是再造 typed-not-populated；真正会出事的是**静默增长**（四个工具躺了很多版没人数）。**18 条并入白名单**：`AgentOutput` 遥测/worktree/远程任务字段、`AgentInput.team_name`、`FileReadOutput.source`；Agent 那行**刻意只记档不补**——在工具连产出方都没有时争论补哪个字段是顺序反了。漂移报告已归零。**Workflow 仍开着**：官方 `WorkflowOutput` 必填 `status:'async_launched'`，本引擎同步跑完才返回，交这个字面量等于给一张「货已在你手上」的取件凭证；守密人已裁定改行为对齐，另轮跟进。

**v0.90.0（2026-07-27）：checkpoint blob 上限（T74 甲案）**——`record()` 原对每个被改文件存完整
前像、无上限（sessions 补审 P1-S2）。超 10MB（可配）前像**不存字节、标 `oversized`**——刻意不复用
`blob: null`（那意味着「本回合新建」，rewind 会**删档**，复用即让 rewind 摧毁唯一不能恢复的那个档；
`readIndex()` 往返保留标记，丢了同样致命，新测试首跑即抓）。rewind 对超限档**原样不动**、点名
不可恢复并整体报 `canRewind: false`——不完整的回滚绝不冒充干净回滚。

**v0.89.0（2026-07-27）：类型面漂移检测工具化 —— 只报「新的」**（守密人「按你建议继续」）——同日三轮普查全是跑完即弃的手搓脚本，于是「上次扫到哪、哪些已经裁过」全靠人记，这正是漂移能反复回来的原因（第三轮挖到的恰是第二轮当天引入的）。收成 `scripts/type-parity.mjs`：**价值不在重跑比对，在于自动扣除已裁定项、只把新长出来的摆上台**（`RULED` 白名单，且**一条裁定吸收整棵子树**——裁了 `BashOutput:gitOperation` 就不会再冒出它十一个孩子）。一份每次都吐同样四十条已知差异的报告，人第二次就不看了。与 `description-coverage.mjs` 同族同纪律：**尺子不是门禁，恒 exit 0**——差异本就不该为零，红线纪律禁止声明未发货能力，机械拉平等于逼类型面承诺本包做不到的事。**首跑就挖出四条真缺陷，三条同一种：发货了却没声明**——`GrepInput` 从未声明 `'-o'`（`grep.ts` 三处代码路径早已实现；前几轮漏看是因为手搓展平器不匹配带引号的键，而 `-o` 只能那样写）· `WorkflowInput` 从未声明 `title`/`description`（两者都在发货的 `inputSchema` 里当运行标签）· `GlobOutput` 空着官方的 `totalMatches`/`countIsComplete`（本引擎先枚举全集再切片，数得准，`countIsComplete` 恒 `true`）。**声明面少报代码实际接受的东西，是 typed-not-populated 的镜像，误导方式一模一样**：照类型读的调用方会以为一个已发货的能力不存在。**解析器易出假发现**（不是响亮地失败，而是给出一条自信、具体、纯属虚构的差异，然后有人去「修」一个本来没错的类型——三轮手搓每轮都干过至少一次），故 `tests/type-parity.test.ts` 逐条钉住真踩过的坑：单行 `{}` 接口吞掉下一个块、纯别名伸进邻居的花括号、带引号的短横线键、内联索引签名凭空造出一个以索引变量命名的幽灵字段、官方 `@minItems` 元组展开（一个类型 83KB）把后续元素挂错父节点。**尚待守密人裁的三项**（**故意不自行并入 `RULED`**——那份白名单只有在「进去 = 人看过」时才有意义）：`AgentOutput` 的官方遥测/worktree/远程任务字段 · `AgentInput.team_name` · `FileReadOutput.source`（挂在官方 `file_unchanged` 结果分支上，缺的是**整条分支**而非一个字段）。

**v0.86.0（2026-07-27）：主循环提示词补回开篇句 + 输出类型普查（续）**（守密人「1 对齐官方 4 续」+ 逐条裁定）——① **补回官方那句 “Text you write between tool calls may not be shown to the user.”**：银芯此前只搬了结论、没搬**理由**；缺了前提，整段就从「事实的后果」退化成「风格偏好」，而**前提缺失的规则是模型最先绕过的那条**。已对官方 2.1.220 逐字核实；字节金样**有意重生成**，差异经核实**只有这一句**（四个工具集各一处）。**官方 `# Focus mode` 整块刻意不复刻**——它为「用户只看得到最终消息」这一 UI 模式覆盖沟通行为，本 SDK 无此模式，为进不去的模式发指令，与描述未发货工具是同一条红线。② **15 个 `*Output` 逐字段比完**：**9 个完全一致**（FileEdit / Task 五件 / EnterWorktree / TodoWrite / Monitor）；6 个有官方独有字段，守密人裁「逐条再看」——**这一类并不齐整**：`ReadMcpResourceOutput.error` **加了并真产出**（非 UI 绑定：工具本有失败路径，调用方此前分不清「读失败」与「读到空」）；`WebSearchOutput` **整体补产出**（原议题 `searchCount` 其实是伪命题——每次调用只打一次后端、恒为 1；真缺口是它**根本没有结构化结果**，而 `query`/`results`/`durationSeconds` 全能填；报的是**过滤后**命中，免得结构化数字与文本对不上）；其余四条**只登记不声明**（`FileWrite.userModified`、`ExitPlanMode.planWasEdited`、`AskUserQuestion.afkTimeoutMs`/`annotations`、`Workflow` 远程任务字段——Workflow 的真障碍**不在可选字段**，而在官方**必填**判别式 `status: 'async_launched'`，本 SDK 同步跑工作流，填它等于断言一次没发生的启动）。**射程边界照实写**：本次是**顶层字段**比对，嵌套差异首轮漏看（`contents[].blobSavedTo` 是人工复读才发现的），其余嵌套字段可能仍未扫。

**v0.84.0（2026-07-27）：记忆索引纪律 + 整理规程**——SDK 给了常驻索引机制却没规定条目写法，且会话
收尾提示词命令模型把进度卡写**进**索引档（守密人 BPT 现场反馈根因）。进度卡改落 `/memories/progress/`
只留指针 · 索引纪律片段 · 写侧超限反压 · 四阶段整理规程。层界守 N1 不给调度；多租户须挂 S1。

**v0.85.0（2026-07-27）：GoalVerdict 家族统一（本包零行为改动）**——本包 `{status: 'achieved'|'not_achieved'|'impossible', reason?}` 判词类型升格为家族**正典**：maestro 0.85.0 把 `GoalChaser` 评审判词（原 `{achieved, feedback, impossible?}`）迁为同形，自此一个宿主评审器经结构类型同时服务引擎 `options.goal` Stop 门与 maestro 跨 query 追逐两条缝。背景是首个真实消费者陷阱：BPT 接了 `options.goal` 后报「goal 没效果、模型照样停」，排查出两包**同名不同形** `GoalVerdict`——评审器误用 maestro 形状时，引擎按既定失败方向（阻断停止才是危险动作，评审器坏 = fail-open 放行）把 malformed verdict 放行为允许停止，goal 无声失效。本包仅在 `src/types/subsystems.ts` 的 `GoalVerdict` 注释补「正典地位 + 改形需家族级裁定」声明，`options.goal` 行为与评审器契约一字未动。
**v0.85.0（2026-07-27）：工具真正产出结构化结果 + MCP 接受列表扩容**（偏离普查轴一 / 轴四守密人裁定）——**先订正普查自己的一处结论**：首轮只 grep `outputSchema`、没找到就报「银芯零输出面」，**错了**——`types/tools.ts` 里 `GlobOutput`/`GrepOutput`/`WebFetchOutput`/`FileReadOutput`/`BashOutput`/Task 五件**早已按官方形状声明**，缺的是**从来没人产出**（typed-not-populated）。于是改动比原先设想的小得多也好得多：**复用既有类型、不另造一套**。① `ToolResultPayload.structuredOutput` 承载机器可读结果，Read/Glob/Grep/Bash/WebFetch 在**每条终态分支**都产出（含空结果与失败——调用方不该需要区分「没有结构化结果」与「没有匹配」）；② 引擎按 tool_use_id 收集整批，经 **WeakMap 侧信道**（`engine/tool-use-results.ts`）挂到用户轮而**不是加字段**——`APIMessageParam` 是**Anthropic 线格式**，多挂一个属性要么发去 API、要么逼后来每个调用点都记得先剥掉；③ `query()` 读回并以`toolUseResult` 发给消费方。**形状差异（有意）**：官方是裸对象（它一消息一 tool_result），本引擎一轮批处理，故为 **tool_use_id 为键的 record**。新增可直接读到的事实：Glob `truncated` · Grep `appliedLimit`/`appliedOffset`/`truncated` · Bash `exitCode`/`interrupted`/`timedOutAfterMs`/`truncated` · Read `truncatedByCharCap`（**按本 SDK 的字符度量命名**，官方 `truncatedByTokenCap` 数的是 token，同名不同单位读起来像对齐、跑起来是漂移）。13 条测试，含一条**跑真引擎**的接缝测试（工具级绿说明不了值有没有传出去）。
**MCP 接受列表**加 `2024-10-07`（官方接受 5 个、银芯只接受 3 个，钉在最老修订的服务器在官方能连、在银芯被拒）；**提议版本仍留 `2025-06-18`**——官方提议 `2025-11-25`，其新增是**异步任务面**（`tasks/get`·`list`·`status`·`result`·`cancel`）与 `related-task`/`skills` 两扩展，本包一个都没实现；**宣告一个语义未发货的版本号，与描述未发货能力是同一条红线**。

> 更早版本的发布叙述已下沉 `CHANGELOG.md`（本档有 200 行封顶，`tests/test_claude_md_size.py` 守——
> 路由器不许长成目录；撞线时的正确动作是下沉，不是抬上限）。
