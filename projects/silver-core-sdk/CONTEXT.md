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
| 双层评估 runEvals（SCS-REQ-002 环二） | `node scripts/run-evals.mjs`（底线层 = 全量 vitest pass/fail；行为层 = `evals/` 20 题 + `claude-sonnet-5` 判卷——12 题 prompt-session + 8 题 Phase 2 harness（`scripts/eval-harnesses.mjs` 故障注入/resume/压缩压力），无 key 走 STUB 验管线；`--judge-batches` 走 Batches API 五折判卷。评估集为守密人定稿权保护路径，任何改动须 `node scripts/update-evals-manifest.mjs` 重签清单，否则治理测试红。回归门禁 `node scripts/check-eval-regression.mjs`（REQ-2.2，报警不阻断）） |

## 测试三层

1. **单测**（`tests/*.test.ts`）：mock 传输层，纯逻辑，零网络（计数随版本滚动，以 `npx vitest run` 实测为准，当前见「当前状态」节）。
2. **仿真器端到端**（`tests/integration/emulator-e2e.test.ts`）：真 fetch/HTTP/SSE/agent 环/工具落盘/MCP/会话，只把模型换成本地 Messages-API 仿真器；**零密钥、进常规 `npm test`**。
3. **真机 smoke**（`tests/integration/live-real-api.mjs`）：真 Claude 模型自己决定调工具；从 `ANTHROPIC_API_KEY` env 读密钥（**脚本不含密钥**），不进 `npm test`。CI 侧由 `.github/workflows/silver-core-sdk.yml` 的 `live-smoke` job 手动触发（`workflow_dispatch`），用 `secrets.ANTHROPIC_API_KEY` 注入——密钥值全程不入仓库。

## 当前状态

<!-- CONTEXT-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->

**当前版本 `0.86.0`** · 发布日 2026-07-27 · 家族锁步对端 `silver-core-maestro-sdk` = `0.86.0`

> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由`tests/test_status_doc_facts.py` 守。

<!-- CONTEXT-FACTS:END -->

**v0.86.0（2026-07-27）：主循环提示词补回开篇句 + 输出类型普查（续）**（守密人「1 对齐官方 4 续」+ 逐条裁定）——① **补回官方那句 “Text you write between tool calls may not be shown to the user.”**：银芯此前只搬了结论、没搬**理由**；缺了前提，整段就从「事实的后果」退化成「风格偏好」，而**前提缺失的规则是模型最先绕过的那条**。已对官方 2.1.220 逐字核实；字节金样**有意重生成**，差异经核实**只有这一句**（四个工具集各一处）。**官方 `# Focus mode` 整块刻意不复刻**——它为「用户只看得到最终消息」这一 UI 模式覆盖沟通行为，本 SDK 无此模式，为进不去的模式发指令，与描述未发货工具是同一条红线。② **15 个 `*Output` 逐字段比完**：**9 个完全一致**（FileEdit / Task 五件 / EnterWorktree / TodoWrite / Monitor）；6 个有官方独有字段，守密人裁「逐条再看」——**这一类并不齐整**：`ReadMcpResourceOutput.error` **加了并真产出**（非 UI 绑定：工具本有失败路径，调用方此前分不清「读失败」与「读到空」）；`WebSearchOutput` **整体补产出**（原议题 `searchCount` 其实是伪命题——每次调用只打一次后端、恒为 1；真缺口是它**根本没有结构化结果**，而 `query`/`results`/`durationSeconds` 全能填；报的是**过滤后**命中，免得结构化数字与文本对不上）；其余四条**只登记不声明**（`FileWrite.userModified`、`ExitPlanMode.planWasEdited`、`AskUserQuestion.afkTimeoutMs`/`annotations`、`Workflow` 远程任务字段——Workflow 的真障碍**不在可选字段**，而在官方**必填**判别式 `status: 'async_launched'`，本 SDK 同步跑工作流，填它等于断言一次没发生的启动）。**射程边界照实写**：本次是**顶层字段**比对，嵌套差异首轮漏看（`contents[].blobSavedTo` 是人工复读才发现的），其余嵌套字段可能仍未扫。

**v0.84.0（2026-07-27）：记忆索引纪律 + 整理规程**——真因不是缺检索腿：SDK 给了常驻索引**机制**
（R6 每会话注入 `/memories/MEMORY.md` 头部）却没规定索引**条目写法**，且会话收尾提示词反过来命令
模型把进度卡写**进**那一档，索引每会话增肥、撑过注入上限后头部变陈年散文、尾部静默丢弃（守密人 BPT
现场反馈「开工要好几回 `memory` 调用才找得到东西」的根因）。四件：进度卡改落 `/memories/progress/`
只留指针 · 索引纪律片段（两模式注入、前提不成立即跳过）· 写侧超限反压（读写共用同一度量）·
`buildConsolidationPrompt()` + 四阶段整理规程。**层界守住 N1**：只给「该不该整理 / 怎么整理」，
不给调度——helper 零 I/O 不起进程。整理是跨档大范围写，多租户须挂 S1。详见 CHANGELOG 与 docs/MEMORY.md。

**v0.85.0（2026-07-27）：GoalVerdict 家族统一（本包零行为改动）**——本包 `{status: 'achieved'|'not_achieved'|'impossible', reason?}` 判词类型升格为家族**正典**：maestro 0.85.0 把 `GoalChaser` 评审判词（原 `{achieved, feedback, impossible?}`）迁为同形，自此一个宿主评审器经结构类型同时服务引擎 `options.goal` Stop 门与 maestro 跨 query 追逐两条缝。背景是首个真实消费者陷阱：BPT 接了 `options.goal` 后报「goal 没效果、模型照样停」，排查出两包**同名不同形** `GoalVerdict`——评审器误用 maestro 形状时，引擎按既定失败方向（阻断停止才是危险动作，评审器坏 = fail-open 放行）把 malformed verdict 放行为允许停止，goal 无声失效。本包仅在 `src/types/subsystems.ts` 的 `GoalVerdict` 注释补「正典地位 + 改形需家族级裁定」声明，`options.goal` 行为与评审器契约一字未动。
**v0.85.0（2026-07-27）：工具真正产出结构化结果 + MCP 接受列表扩容**（偏离普查轴一 / 轴四守密人裁定）——**先订正普查自己的一处结论**：首轮只 grep `outputSchema`、没找到就报「银芯零输出面」，**错了**——`types/tools.ts` 里 `GlobOutput`/`GrepOutput`/`WebFetchOutput`/`FileReadOutput`/`BashOutput`/Task 五件**早已按官方形状声明**，缺的是**从来没人产出**（typed-not-populated）。于是改动比原先设想的小得多也好得多：**复用既有类型、不另造一套**。① `ToolResultPayload.structuredOutput` 承载机器可读结果，Read/Glob/Grep/Bash/WebFetch 在**每条终态分支**都产出（含空结果与失败——调用方不该需要区分「没有结构化结果」与「没有匹配」）；② 引擎按 tool_use_id 收集整批，经 **WeakMap 侧信道**（`engine/tool-use-results.ts`）挂到用户轮而**不是加字段**——`APIMessageParam` 是**Anthropic 线格式**，多挂一个属性要么发去 API、要么逼后来每个调用点都记得先剥掉；③ `query()` 读回并以`toolUseResult` 发给消费方。**形状差异（有意）**：官方是裸对象（它一消息一 tool_result），本引擎一轮批处理，故为 **tool_use_id 为键的 record**。新增可直接读到的事实：Glob `truncated` · Grep `appliedLimit`/`appliedOffset`/`truncated` · Bash `exitCode`/`interrupted`/`timedOutAfterMs`/`truncated` · Read `truncatedByCharCap`（**按本 SDK 的字符度量命名**，官方 `truncatedByTokenCap` 数的是 token，同名不同单位读起来像对齐、跑起来是漂移）。13 条测试，含一条**跑真引擎**的接缝测试（工具级绿说明不了值有没有传出去）。
**MCP 接受列表**加 `2024-10-07`（官方接受 5 个、银芯只接受 3 个，钉在最老修订的服务器在官方能连、在银芯被拒）；**提议版本仍留 `2025-06-18`**——官方提议 `2025-11-25`，其新增是**异步任务面**（`tasks/get`·`list`·`status`·`result`·`cancel`）与 `related-task`/`skills` 两扩展，本包一个都没实现；**宣告一个语义未发货的版本号，与描述未发货能力是同一条红线**。

**v0.82.0（2026-07-27）：Read 通读 >256KB 改为拒绝 + 首次对官方二进制做偏离普查**——守密人问「还能查到有哪些我们与官方不一致」，遂第一次拿**官方发行物本体**（npm 平台包 + `sdk-tools.d.ts`）而非第三方重建档做四轴对照。**唯一改代码的一条**：官方 `maxSizeBytes`=262144 拒通读，银芯此前只有 50MB OOM 守卫（松 200 倍，于是 30MB 日志会被真读进内存再几乎全丢）。现两条上限各司其职——256KB **导向**（「这不是 Read 该干的事」）、50MB **保命**（「这会撑死进程」）；**只拦通读**，带 offset/limit 放行（官方错误文案与工具描述两处都写明这是逃生口）。**属破坏性变更**：读 256KB–50MB 档的消费方会突然报错，修法机械（加 offset/limit 或改 Grep）且错误文案已写明。
**同批查出但按守密人裁定只登记不改**：`AskUserQuestion` 缺官方三个**回程字段**（`answers`/`annotations`/`metadata.source`）——它们服务于官方权限组件 UI 回填与遥测，本 SDK 是宿主回调、无那套组件，加了就是描述未发货能力。**另有两条经复核是假象、如实记档**：`EnterPlanModeInput` 官方就是 `{}`（一致），Grep 的 `-i/-A/-B/-C/-o` 与 `TaskListInput` 亦一致——首轮正则不认带引号键、且被单行 `{}` 接口串块骗了三次。
详见 `docs/COMPAT.md`「Divergence sweep」。

**v0.81.0（2026-07-27）：Read 截断页脚补齐官方三件套 + 数值基准获独立佐证**——守密人报的现象：一次 Read 读约 1500 行源码后，模型**连发六轮自动翻页**把整档翻完、上下文推到 300K+ 字符。旧页脚只说一句「Use offset=1301 to continue reading.」，**别的什么都不给**。**交付单的诊断对了一半，错的那一半值得记**：它认为官方从不给具体值，只说「the offset parameter」；对着**官方 npm 发行物 2.1.220** 提取实测，官方**也给值**——「…Call Read with offset=${I+1} limit=${I} for the next page, **or Grep to find a specific section**. **Do NOT answer from this page alone** if the answer may be further in the file.」。可见具体值从不是差别，差别是银芯只给了三件套的**第一件**：一条路、一个动作、没有更便宜的替代、没有告诫。守密人裁定取官方口径。两处截断分支（字符上限 / 行数上限）现均补齐三件套；大档 Grep 提示改为**只看体积**（原还要求存在超 2000 字符的长行，而 TS/Lua/Python 普通源码根本没有那种行，故该提示**几乎从未触发过**——它此前零测试覆盖，正与此吻合），256KB 阈值不动。`MAX_READ_OUTPUT_CHARS` 刻意不动。
**同批订正 0.80.2 的一处错误结论**：那条说数值基准「须在装有 Claude Code 的机器上才能重新提取」——**错了**。官方二进制是**公开 npm 发行物**（`@anthropic-ai/claude-code` 的平台 optionalDependency），本仓一致性作业本就`--no-save` 装它作对照臂，属净室边界①「官方发行渠道产物」。已就地提取 2.1.220 实测：Read 输出上限 **25000 token**、Bash 输出 **30000 默认 / 150000 上限**、Grep `head_limit` **「Defaults to 250 when unspecified」逐字**——与 0.80.0 所依据的 2.1.141 三项**全部一致**，79 个版本未变。WebFetch 的 100000 本轮未再定位到，照实记。

**v0.80.2（2026-07-27）：对齐 2.1.216 快照基准**（守密人裁「3 也直接对齐基准」）——基准同时从两个方向陈旧了，且只有一个方向能在仓内修，两者都记进 `docs/COMPAT.md`「Baseline realignment」。① **手工挖出第三条指空 slug**：`SendMessage` 引用的 `tool-description-sendmessagetool` 被快照改名，却因**缺档检查搭在锚点检查里、而锚点检查跳过 adapted 条目**而长期报绿——现把「引用的档案必须存在」拆成独立测试，faithful / adapted 一视同仁。同一次快照造了三条指空 slug：两条让 main 红了六小时（0.80.1），这条根本没守卫在看。② 新增 `scripts/description-coverage.mjs`，把「散文基准漂没漂」从人工比对变成一条命令（逐档报还剩多少逐字吻合 + 该档 ccVersion）。**报告体恒 exit 0**：吻合度本就不该是 100%——红线纪律禁止描述未发货能力，硬拉满等于逼描述去吹本包做不到的事。实测 30 档里 18 档 100%（Grep 对 2.1.217、Glob 对 2.1.215），低分端全是已登记改编（SendMessage 11% / EnterWorktree 25%）。**射程边界照实写**：0.80.0 那批**数值上限对不了**——重建档把数字模板化（`${MAX_LINES_CONSTANT}`）、grep 档没有参数级文档，故 250 / 25,000 / 30,000 / 100,000 仍只靠那一次 2.1.141 二进制提取支撑，仓内无任何东西能独立佐证，重新核验需在装有 Claude Code 的机器上再提取一次。发货运行时改动仅一个 slug 字符串及其注释，**描述文本未动**，提示词字节与缓存键不变。

**v0.80.1（2026-07-27）：两条提示词溯源 slug 改锚 + 给刷新 cron 补自检**——上游快照
2.1.173 → 2.1.216（今日 cron 76fe5e6 直推 main）改名 24 档、删 5 档，两条 slug 指空，
两条 corpus-sync 守卫在 main 上报红。① `COORDINATOR_WORKER_PROVENANCE.slug` 随上游命名
规范化改指 `agent-prompt-coordinator-worker-instructions`（守卫抽出的 15 个锚点句在
shipped 文本里逐字仍在，只动 slug）；② `MAIN_LOOP_INTRO.slug` 改指
`system-prompt-harness-instructions`——上游把三个 intro 小档合并进它，那句话逐字未变、
现居该档开篇模板的「无 output style」分支，故 `faithful: true` 仍成立，但注释里写明它
faithful 于**模板档的一个分支**而非整档。**零 shipped 提示词文本改动**。
包外同批：`refresh-claude-code-prompts.yml` 刷新后、提交前就地跑这两条守卫，**红则不提交
不直推**——该 cron 带 `[skip ci]` 直推 main，此前它捅的破绽要等下一个不相干 PR 跑门禁才
暴露（本次正是这么被发现的）。

**v0.80.0（2026-07-27）：工具输出上限对齐 Claude Code 2.1.141**——守密人交付单三处独立改动
（常量取自 `claude.exe` 内含明文 JS）。① **WebFetch 上限 100_000 → 复用 Read 的 50_000**：
官方那个数管的是「喂给摘要小模型的输入」、主上下文只收摘要，本 SDK 直连无摘要层，同一个数字
在这里变成「原文直灌主上下文」，反让 WebFetch 成为唯一能塞进两倍 Read 额度的工具，而它拉的
还是最不可控的外部网页；现改为引用 `MAX_READ_OUTPUT_CHARS` 常量，两道闸门从此无法各自漂移
（`fsutil.ts` 注释里「~50K aligns with the WebFetch cap」的本意终于对上代码）。
② **Grep `head_limit` 三种 output_mode 统一默认 250**（原 `count` / `files_with_matches` 默认无限，
OPT-1 v0.13.0）：OPT-1 担忧的「截断的 count 是错的 count」已由同批落地的「每种模式都追加截断提示」
解决，无限默认不再多买到诚实，却让一次宽泛检索能吐几千条；要可证完整仍显式传 `head_limit=0`。
③ **Bash 输出截断改保尾去头**，标记移到开头（`[truncated: earlier output dropped]`）：长命令的
结论在末尾——构建成败 / 测试汇总 / 最终报错，原保头恰好切掉要看的、留下编译噪音；新增
`sliceTailSurrogateSafe` 镜像 helper（尾切要丢的是**开头低位**代理，与头切相反）。
**刻意不改**：Read 的计量单位仍按字符（官方按 token 25,000 + 256KB 拒读），对齐需引入 tokenizer
运行时依赖，且字符计量在中文场景反而更宽（50K 中文字符 ≈ 50K token，是官方两倍）。

**v0.79.1（2026-07-27）：内部去重，零表面变化**——重试/退避/错误体/流错误/空闲看门狗从
`transport/anthropic.ts` 与 `transport/openai.ts` 各抄一份收敛为 `transport/http-retry.ts`；
JSON-RPC 报文形状/结果解析/分页/版本协商从 `mcp/http.ts` 与 `mcp/stdio.ts` 收敛为
`mcp/protocol.ts`。六个 src 档净 −288 行，3,214 测试与 api-surface 守卫原样通过即表面未动的证据。
**照实记**：该改动随 #835 合并时**未 bump**，版本门禁在 main 上红了约一小时——本条是补票，
故 0.79.0 标签在那段窗口里同时对应了改动前后两份内容，见 CHANGELOG 同条。

**v0.79.0（2026-07-26）：锁步对齐**——本包**零代码改动**。家族版本钟随 maestro 0.79.0（重开语义 + CONCURRENCY 文档 + 棘轮 cadence 分档）前进；同批订正本档 0.72.0 / 0.70.0 两条空转条目的措辞（内容未变，改为机器可识别的规范开头）。

**v0.78.1（2026-07-26）：锁步对齐**——本包**零代码改动**。家族版本钟因 maestro 0.78.1（产品审视四裁：删除其对本包的无支撑 peerDependency / 六族两级成熟度标注 / 首份 ONBOARDING 文档 / 判别式补维）整体前进，详见该包 CHANGELOG。

**v0.78.0（2026-07-26）：锁步对齐**——本包**零代码改动**。家族版本钟因 silver-core-maestro-sdk 0.78.0（设计审视四缝全修：`cancelled` 终态穿透场景层 / 驱动器并发上限 / 台账保留缝 / 长跑组件中止缝）整体前进，详见该包 CHANGELOG。

**v0.77.0（2026-07-26）：Windows 正确性清扫（家族史上第一次非 Linux CI 实跑 + 守密人现场反馈
「SDK 在 windows 环境工具调用经常犯蠢」）**——3200+ 测试一直全绿，却**一条都看不见**这些问题：
它们全部跑在 POSIX 宿主的 POSIX 方言下。三条真缺陷：
① **路径域权限规则在 Windows 上两个方向都坏**——POSIX 写法的 deny（`Read(//etc/**)`）匹配**不到任何东西**
（`path.resolve` 出 `C:\etc\a`，规则与 glob 说 `/`），是**在黑池唯一发货平台上 fail-open 的 deny**；
Windows 写法的 deny 则**过度匹配**（单 `*` 的字符类 `[^/]*` 不在 `\` 处停，`*` 跨了目录边界）；
且大小写敏感，`C:/Secret/**` 的 deny 用 `c:\secret\x` 就绕开。三者在同一规范空间（`/` 分隔 + 小写）
下一起消失，**只在 win32 生效**——POSIX 上反斜杠是合法文件名字符、路径大小写敏感，折叠任一都是新洞。
**明写代价**：规则语法里打头的 `//` 是「绝对路径」写法，win32 下会先折叠再解析，故 UNC 域规则在
win32 不可表达（此前它同样什么都匹配不到）。
② **宿主传受控 env 时 Bash 工具整个消失**——Git-for-Windows 安装根只从 `options.env` 读，硬化宿主
（Electron 正是如此）只传 `{PATH, HOME}` 即得空候选表，每次 Bash 调用都死于「No POSIX shell found」。
安装根是**宿主装机事实**、不是会话配置，现回落 `process.env`（调用方给的根仍优先，且不往子进程环境泄漏
任何新变量）；候选表同时去重（64 位机上 `ProgramFiles` 与 `ProgramW6432` 同目录，此前每条探两遍）。
③ **Glob / Grep 与 SDK 其余部分说不同的路径方言**——`fast-glob` 恒出 POSIX 分隔符，于是 Windows 上
它们报 `C:/Users/x/a.txt`，而 Read/Write/Edit、错误信息、`cwd` 都说 `C:\Users\x`；同一会话里一条路径
两种拼写，模型据此犯蠢。现统一归一为宿主原生分隔符（`toNativePath`）——既有 Glob/Grep 测试本就按
`path.join` 断言，**原本就是这个契约，只是实现悄悄漂了**。
**测试侧**：`MatchContext.platform` 让路径方言可注入，`tests/windows-path-semantics.test.ts`（20 例，
含证明修复 win32-scoped 的 POSIX 负控）在任意宿主上断言 win32 行为——**这套本可在没有 Windows 机器时
就抓住该缺陷**；vitest 插件剥 `scripts/*.mjs` 的 shebang（四个守卫脚本 import 在 Windows 上死于
SyntaxError，两个无 shebang 的对照组全过，相关性精确）；Windows 拆卸 `rmSync` 重试越过 EBUSY、
worktree 套件把 `os.tmpdir()` 的 8.3 短名归一为 git 报的长名、sandbox / file-store 停用硬编码 POSIX 分隔符。
**Linux/macOS 行为零变化**：全量 3236 通过 + 5 skipped。**maestro 侧同轮 362/362 全绿、零改动**。

### 更早的版本叙述已下沉（2026-07-26 瘦身，守密人裁定）

本节曾是一部**三周的发布编年史**——27 个版本条目、405 行，占全档 86%，与
[`CHANGELOG.md`](CHANGELOG.md) 职责重复。而 CHANGELOG 自己开篇就写着它是
**consumer-facing build ledger**、每次改 shipped 代码必加一行、并有 `check-version-bump.mjs`
守着——**发布史的唯一权威在那边，这里再抄一份只会两边分叉**。

- **想知道某一版做了什么** → [`CHANGELOG.md`](CHANGELOG.md)，逐版全文；
- **想知道现在能不能动手** → 上方生成块（版本 / 发布日 / 锁步对端）+ 紧邻的最近版叙述；
- **想知道为什么这么设计** → [`docs/POSITIONING.md`](docs/POSITIONING.md)（定位与三缝）、
  [`docs/COMPAT.md`](docs/COMPAT.md)（对标差异）、[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

本节今后**只留最近版叙述 + 下方长期纪律**；新版本进来时，把上一版的叙述交给 CHANGELOG，
不再在此累积。行数上限由 `tests/test_claude_md_size.py` 守（上限 500，撞线即下沉、不抬上限）。

### 长期纪律（非发布史，动手前必读）

**官方裸对比的黑箱纪律**（守密人 2026-07-04 裁定，v0.5+ 起生效）：`silver-core-sdk.yml` 的
`vs-official` job 同模型同 7 任务两引擎对跑，**只比客观两轴**——响应速度（墙钟 / API ms / TTFT）
与输出正确性（同 `check()` 通过率）；**质量不评判**（该轴被专有系统提示词混淆，属 POSITIONING
§2/§4 结构性天花板）。官方包 `npm i --no-save` 仅本次装，**绝不进 package.json / lockfile、
绝不成为本包依赖**；官方引擎当**纯黑箱**——读其输入输出行为计时判分，**绝不读其提示词文本**。
官方 SDK 靠 spawn Claude Code CLI，无头 CI 起不来则官方臂跳过（exit 2）——
「官方引擎无头起不来」本身即结论（那正是黑池换引擎的动机）。


## 旧「v0.2 候选」清单已作废（2026-07-26 核实）

该节列的候选——subagents / 上下文压缩（compact_boundary）/ WebFetch / 设置文件 hooks /
会话管理全量 API / defer 权限决策——在 0.79.0 时代**全部早已实装**（逐条核到 `src/subagents/`、
`src/engine/compaction.ts`、`src/tools/webfetch.ts`、`src/hooks/`、`src/sessions/`、
`src/permissions/`）。一份**每条都已完成的待办清单**留在必读档里，只会让下一个会话
把已有能力当成缺口去「补」。能力现状以 [`docs/COMPAT.md`](docs/COMPAT.md) 对标矩阵为准。
