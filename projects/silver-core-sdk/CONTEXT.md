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
| 双层评估 runEvals（SCS-REQ-002 环二） | `node scripts/run-evals.mjs`（底线层 = 全量 vitest pass/fail；行为层 = `evals/` 20 题 + `claude-sonnet-5` 判卷——12 题 prompt-session + 8 题 Phase 2 harness（`scripts/eval-harnesses.mjs` 故障注入/resume/压缩压力），无 key 走 STUB 验管线；`--judge-batches` 走 Batches API 五折判卷。评估集为守密人定稿权保护路径，任何改动须 `node scripts/update-evals-manifest.mjs` 重签清单，否则治理测试红。回归门禁 `node scripts/check-eval-regression.mjs`（REQ-2.2，报警不阻断）） |

## 测试三层

1. **单测**（`tests/*.test.ts`）：mock 传输层，纯逻辑，零网络（计数随版本滚动，以 `npx vitest run` 实测为准，当前见「当前状态」节）。
2. **仿真器端到端**（`tests/integration/emulator-e2e.test.ts`）：真 fetch/HTTP/SSE/agent 环/工具落盘/MCP/会话，只把模型换成本地 Messages-API 仿真器；**零密钥、进常规 `npm test`**。
3. **真机 smoke**（`tests/integration/live-real-api.mjs`）：真 Claude 模型自己决定调工具；从 `ANTHROPIC_API_KEY` env 读密钥（**脚本不含密钥**），不进 `npm test`。CI 侧由 `.github/workflows/silver-core-sdk.yml` 的 `live-smoke` job 手动触发（`workflow_dispatch`），用 `secrets.ANTHROPIC_API_KEY` 注入——密钥值全程不入仓库。

## 当前状态

<!-- CONTEXT-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->

**当前版本 `0.79.1`** · 发布日 2026-07-27 · 家族锁步对端 `silver-core-maestro-sdk` = `0.79.1`

> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由`tests/test_status_doc_facts.py` 守。

<!-- CONTEXT-FACTS:END -->

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
