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

## 测试三层

1. **单测**（`tests/*.test.ts`）：mock 传输层，纯逻辑，零网络（348 通过）。
2. **仿真器端到端**（`tests/integration/emulator-e2e.test.ts`）：真 fetch/HTTP/SSE/agent 环/工具落盘/MCP/会话，只把模型换成本地 Messages-API 仿真器；**零密钥、进常规 `npm test`**。
3. **真机 smoke**（`tests/integration/live-real-api.mjs`）：真 Claude 模型自己决定调工具；从 `ANTHROPIC_API_KEY` env 读密钥（**脚本不含密钥**），不进 `npm test`。CI 侧由 `.github/workflows/silver-core-sdk.yml` 的 `live-smoke` job 手动触发（`workflow_dispatch`），用 `secrets.ANTHROPIC_API_KEY` 注入——密钥值全程不入仓库。

## 当前状态

**v0.48.0(2026-07-11):记忆治理 P0 组(spec S1–S4)落地**——守密人 0711 派发《记忆系统、
隐私治理与会议记录支持》需求书(归档 `docs/MEMORY-GOVERNANCE.md`)的 SDK 侧收口。
S1 作用域路由:`options.memory.mounts` 按 query 声明子树权限(read-only / read-write),
工具层在 R4 穿越防护之上强制执行——只读挂载点拒写、挂载点外拒读写、祖先目录列目录按
挂载可见性过滤(用户 A 看不到用户 B 的目录名)、rename 双端校验、R6 常驻索引仅在
MEMORY.md 挂载可读时注入。S2 无痕原语:`options.incognito` 一键零持久化(转录不落盘、
memory 降级只读 view 可用、R7 两写回合关断、S3 记录抑制、sessionStore 组合报配置错误),
需求书泄漏测试清单直接落为集成测试(标记词全盘 grep 零残留)。S3 结构化工具调用日志:
每次 tool_use 派发在会话 JSONL 写一条 `tool_call` 记录(名/截断参数/时间戳/序号/成败/
耗时/摘要;子代理带 parent_tool_use_id),`getSessionToolCalls` 读回,经 tool_use_id 与
tool_use 块对齐可全量重放。S4 声明核验:`auditToolClaims`/`auditSessionToolClaims` 检出
「嘴上说调了、日志无记录」轮次(中英文记忆写入探测器默认集,漏报优先压低)。S5 由既有
按 query 组合满足(同一 store 上 team-ro 用户会话与 team-rw synthesis 任务并存已入测试)、
S6 架构预留由 S3 记录携 session_id 兑现。+32 测试,全量 1812 绿。

**v0.47.0(2026-07-11):记忆系统 M2(spec R7–R9)落地,spec 全量收口**——R7 压缩前落盘回合
(auto 触发将至先注入一次记忆写入机会、PreCompact 钩子可 deny、每折叠周期恰一次)+ 会话正常
终结进度卡回合(abort/错误不触发,回合 result 被吸收、任务自身 result 仍为流内最后一个);
R8 治理限额(64KB/文件、64 文件/目录、view 16k 截断带 view_range 提示,store 引擎 + 工具层
双层执行)+ `metrics.memoryHealth` 记账(次数/读写字节/索引注入 token);R9 `schema:'cards'`
记忆卡校验(结论/依据/过期条件,结构化可重试错误)。live-smoke 第 3 阶段(真 API 原生模式)
+ conformance 记忆轴 mock 线缆锁(官方臂差分槽位待守密人 dispatch 采集)。+31 测试,全量 1782 绿。

**v0.46.0(2026-07-11):记忆系统 M1(spec R1–R6)落地**——`options.memory` 六命令
memory 工具(memory_20250818 协议等价)+ 双模式装配(native 直通官方类型条目 /
custom 自带 schema + 官方逐字协议提示)+ `MemoryStore` 契约与 `MemoryFileOps`
原语层(参考格式单点收口 `createMemoryStore`)+ 本地默认 store + 可交付契约
测试套件 + R4 穿越攻击集(23 变体,发版门禁)+ `/memories/MEMORY.md` 索引常驻
(行/字节双帽)。M2(R7 钩子联动 / R8 治理限额 / R9 记忆卡)待建;需求书归档
`docs/MEMORY.md`。80 新测试,全量 1755 绿。

v0.2 完成（2026-07-03）：v0.1 已合并入 main；v0.2 补齐上下文压缩 / 结构化输出 /
子代理运行时 / 权限 v2 / 提示缓存 / 新工具（WebFetch·WebSearch·AskUserQuestion·
TodoWrite）/ 外部会话存储 + 文件检查点 + 工具搜索。

v0.3 进行中：per-run 预算度量（`result.metrics`）已落；**观测消息流扩容（task #16）
已落**——`SDKMessage` union 补齐观测臂全 25 变体（`SDKObservabilityMessage`），
其中 `permission_denied` 真发射（gate deny 时 yield，与 `result.permission_denials`
台账一致），其余类型化待驱动源（详见 `docs/COMPAT.md` 观测臂表）。
**task #17（P1/P2 长尾）已收口**：Read 图像（PNG/JPEG/GIF/WebP magic-byte 嗅探→image 块）+
tool() 第 5 参 ToolAnnotations 转发 + mcpServerStatus 富化（config/tools[]/scope 类型）+
listSessions option（dir 别名 + limit）+ Usage 字段（server_tool_use/service_tier）。

**桶1（守密人「都先全面实现」）已收口**：① Read PDF→base64 document 块（API 文档确认
document 块可入 tool_result）；② rate_limit_event/api_retry 真发射（transport `onRetry`
桥接进流）；③ 连续≥2 只读内建工具**并行执行**（Promise.all，结果保序，stop/defer 覆盖同组后续为
「Not executed」）。**遗留两项亦已清（守密人「清遗留」）**：
① **MCP `readOnlyHint` 注解链**——`listTools` 经 sdk/stdio/http 把 annotations 捕获到
`McpToolEntry.annotations`，loop `isReadOnlyTool` 统一 builtin.readOnly + MCP readOnlyHint，
喂进 gate（default/plan/acceptEdits 只读自动放行）+ 并行分组；真 gate 端到端测试证明只读 MCP 工具
自动放行、非只读被拒。② **PDF base64 源 live-API 确认**——`tests/integration/live-real-api.mjs`
加阶段2（生成合法最小 PDF→模型 Read→成功即 API 接受 document 块），随 live-smoke workflow
手动 dispatch 用 `secrets.ANTHROPIC_API_KEY` 跑。

**v0.4（2026-07-04）：观测臂生命周期真发射 + 契约对齐**。① subagent 任务生命周期
task_started / task_progress（按子回合预算份额）/ task_updated（completed·failed·cancelled，
带 500 字符结果预览）/ task_notification（仅后台子代理）真发射——runtime 推入共享观测队列，
loop 与 query 泵在消息边界排空（拉式生成器无法在 await 中途插播，前台事件在其工具组结束后浮出）；
② hook 生命周期 hook_started / hook_response 成对真发射（`includeHookEvents` 门控，hook_id 关联，
hook_progress 无诚实来源保持 TYPED）；③ 契约小项：error 结果臂补官方 `errors: string[]`、
权限规则 deny/allow 位支持 `*` 与 `mcp__*` glob；④ 对账修正：会话三函数
（getSessionMessages/renameSession/tagSession）与 canUseTool suggestions/requestId 实为 v0.2
已落地，COMPAT.md 陈旧行已更正。**680 单测全绿**。

**v0.5（2026-07-04，守密人裁定三线并进）：换装就绪 + Bash 一族 + A/B 测量线**。
① **background Bash 一族**：Bash `run_in_background` 经每 query 一个的 ShellManager 分离拉起后台
shell（BashOutput 增量读 + 按行 filter / KillShell 击杀，进程组 SIGTERM→SIGKILL，query 结束清场）；
前台 Bash `cd` + export 环境经状态档回放跨调用持久（函数/别名不持久，COMPAT 记 PARTIAL）。
② **换装就绪包**：`docs/MIGRATION.md`（一行换装 / 凭据 / Electron 接线 / 七条已知行为差异 /
试点验收清单）+ `examples/electron-host.mjs`（四个 host callback 接线范本）；`npm pack` tarball
已在干净目录实测安装 + import 通过。③ **A/B 测量线**（POSITIONING §7 测量强制令）：
`tests/integration/ab-benchmark.mjs` 七任务代表集（含中文两项），产 JSON 报告 + offender 排序；
挂 `silver-core-sdk.yml` 的 `ab_benchmark` dispatch 输入，报告作 artifact 上传。**691 单测全绿**。
首轮真 API 实测（haiku，7/7 全过，$0.076/18 轮）：工具耗时全毫秒级、缓存命中 0%（短会话摊不平缓存写入溢价，
实证 POSITIONING §6「缓存复利只在多轮长对话显现」），offender 头部为 4 轮写改类（轮数是成本主乘数）。

**官方裸对比（v0.5+，守密人 2026-07-04「先跑裸对比」裁定）**：`silver-core-sdk.yml` 加 `vs-official` job
（`vs_official` dispatch 输入）——同模型同 7 任务、本 SDK vs 官方 `@anthropic-ai/claude-agent-sdk` 两引擎各跑，
`--compare` 出并排表。只比**客观两轴**：响应速度（墙钟/API ms/TTFT）+ 输出正确性（同 `check()` 通过率）；
**质量不评判**（该轴被专有系统提示词混淆，属 POSITIONING §2/§4 结构性天花板）。官方包用 `npm i --no-save` 仅本次装、
**绝不进 package.json/lockfile、绝不成本包依赖**（黑箱对比纪律：官方当纯黑箱、绝不读其提示词、
绝不进 package.json/lockfile）；官方引擎当**纯黑箱**计时+判分，读其输入输出行为、
绝不读其提示词文本。官方 SDK 靠 spawn Claude Code CLI，无头 CI 起不来则官方臂跳过（exit 2），
「官方引擎无头起不来」本身即结论（正是 BPT 换引擎的动机）。

**v0.5 续 —— 公开信息再现转向 + 引擎机制加固（守密人 2026-07-04 裁定，范围认可，续入 v0.5）**：
定位从 clean-room 反转为**公开信息再现**（明确署名）——**覆盖并作废上方旧 Backlog「全程不读官方提示词 /
泄漏一律不并入」**（该段是转向前的黑箱克隆计划，现已不适用）。四条腿分工：官方提示词还原（Piebald 快照，
公开 GitHub/MIT/逆向自公开分发 CLI）=行为规格 / 开源 CC 重实现（OpenCode/Codex/Gemini/goose/Cline，全宽松许可）
=引擎机制 / 公开文档 + 自研引擎=兜底主权。**硬边界不变**：§1.1-HC 黑池防火墙、拒绝真正的内部未授权泄漏
（「公开分发可逆向」≠「内部偷流出」）、不逐字大段克隆到会引用空气处、署名。

- **提示词装配层 Track B（守密人 2026-07-05 裁定「先设计落档、再实现 Track B」，进行中）**：设计档 `Public-Info-Pool/Resource/proposal/bpt-prompt-assembly-layer-design-20260705.md`（五层模型 + build-from-archive + 剔除清单）。
  **Phase 0.5 已落**：修 R1——v5/v3 无条件引用 Agent 工具，但 Agent 仅在配置 subagents 时注册（`query.ts:498`）；现每条工具子句 gate 在该工具在场，红线测试锁定。
  **Phase 1a 已落**：main-loop 从硬编码 `defaultHarnessStableV5` 迁入**片段库**（`src/engine/prompt-fragments.ts`，每片带 id+archive slug provenance+faithful 标+tool gate）+ **装配器**（`src/engine/prompt-assembler.ts` `assembleMainLoop`）；v5 变薄封装；**字节金标锁定**（`tests/fixtures/v5-mainloop-golden.json` 四工具集，装配器逐字节复现）。
  **corpus-sync 校验器已落**：每 faithful 片段对上游归档逐锚点对账、漂移即 CI 报红（21 faithful 全过；provenance 曾乐观标注、已按内容匹配诚实校正为 21 faithful / 11 adapted）。
  **各面 provenance + corpus-sync 已覆盖 SDK 实用 4 surface**：① main-loop（片段库+装配器+金标）② tool-descriptions（`descriptions.ts` `TOOL_DESCRIPTION_PROVENANCE`）③ general-purpose 子代理（`agents.ts`，原净室自撰→忠实复现官方 strengths+guidelines）④ compaction 摘要器（`compaction.ts` `SUMMARIZER_SYSTEM`，原净室自撰→忠实复现官方 5 节续接摘要）。
  **范围边界更新（守密人 2026-07-05「V0.6 加这些产品功能吧，这就是我们看到的黑盒」反转）**：归档的生成器/分类器
  （session-title/branch/session-name/bash-前缀检测/后台状态分类器）不再列「未发货、不复现」——**v0.6 将其作为真实产品功能发货**
  （见下「v0.6」段）。红线本质是「不得描述不存在的能力」；功能与其提示词一并发货后，能力即存在、红线自然满足（提示词有真实调用方）。
  commit-msg 仍不单列（官方由主循环 tool-use 产出，非独立 utility 调用，不凭空造）；auto-mode 归档仅为 guidance 片段、非独立整prompt，暂缓。
- **已落**：v4/v5 官方主循环提示词忠实再现（`harnessPromptVariant`，**v5 全面再现四节、已提为 claude_code preset 默认**，见下「提示词默认提升」）
  + Bash 命令分解权限（安全，`decomposeBashCommand`）+ SSE 空闲看门狗（`streamIdleTimeoutMs`，默认 120s/0 关）。
- **提示词默认提升 v1→v5（2026-07-05，守密人「2 模拟行为」+「目标是跟官方提示词一致」裁定，已落地）**：
  claude_code preset 无 variant 时默认走 **v5**（~3774 tok 全面忠实再现官方主循环）。**决定性 A/B 实证**（run 28725983766，硬任务 10/11 median-of-3）：
  v5 vs v1 **~3× 便宜**（$0.0089 vs $0.0272）、同正确（2/2）、略快，真因缓存（v5 95% 命中 vs v1 落尺寸死区 0%）。
  **⚠ 连带修掉 A/B 测量 bug（踩坑 #44）**：harness 选 variant 却没设 `systemPrompt` preset → variant 只在 preset 路径生效被静默忽略，
  早前「v2/v3/v4 无收益」两臂实际都跑极简默认，结论作废。v5 保真：对着归档官方还原逐段自审、补回两条漏收官方子句
  （`act-when-ready` + 安全策略 `censoring-assistance`）；产品专属两条（反馈 URL / CLI harness 头）确认应省。v1–v4 保留为显式变体。
- **剩余目标（Tier 1）**：G1 压缩前置廉价层（逐结果预算→内容指针 + 去重，模型摘要前甩字节）/ G2 摘要·标题走 Haiku
  （`compaction.model`）/ G3 双 system 缓存断点（用满第 4 断点）/ G4 子代理 Fork 模式（继承缓存共享上下文）+ sidechain 转录 /
  ~~G5 v4 补工具使用纪律片段~~（**已由 v5 涵盖**：Tool use 节含 dedicated-tools-over-bash 重定向「Use Grep (NOT grep or rg)」等全表）/ G6 分类器·生成器提示词再现（标题/分支/描述、后台状态分类器）/
  G7 定位反转全仓扫尾（POSITIONING/COMPAT/README/ARCHITECTURE/MIGRATION + 两轴行为天花板解封）/ G8 decisions.md 两条落档（仅守密人）。
- **测试比对（守密人 2026-07-04「需增加测试比对」——本版一等目标）**：每项再现/采纳**必附对照测试证其效**，**不测不宣胜负**。
  ① 提示词 A/B v1 vs v5（含硬任务 10/11，`prompt-ab` job 支持 v2–v5，**已跑：v5 ~3× 便宜同正确、提为默认**）；② **vs-official 裸对比**（再现是否收窄行为差）；
  ③ 逐机制 before/after（压缩前置层的 input-token 削减 / 双断点的缓存命中率 / Haiku 摘要成本），benchmark 加各机制开关位；产对照报告。
- **vs-official 升为常规做法（守密人 2026-07-05 裁定）**：与官方 `@anthropic-ai/claude-agent-sdk` 的裸对比（`vs_official` job：
  同模型同任务集、速度 + 正确性两客观轴，官方当黑箱、绝不读其提示词）**每里程碑必跑一次、计入退出标准、对照报告归档 Resource**。
  不再是一次性探针——再现工作每推进一批，就重跑 vs-official 看行为差是否真被收窄（数据说话）。官方 CLI 无头起不来则官方臂跳过（本身即结论）。
- **推迟到 v0.6+（全做 Tier 2/3）**：Plan 分阶段流水线 · 审查/三态验证器 · coordinator/同意不可转述 · Workflow DSL ·
  做梦记忆（Claude 蓝本再现）· 沙箱再现 · 循环/调度 · 产品面大件。
- **依据档**：`Public-Info-Pool/Resource/proposal/bpt-sdk-reproduction-scope-ledger-20260704.md`（全做路线图）/
  `.../repo-engineering/oss-cc-engine-designs-survey-20260704.md`（开源引擎设计）/
  `.../repo-engineering/official-cc-prompt-architecture-inference-20260704.md`（官方架构推断）。

> **能力层仍可安全逼近官方**：转向后不仅可黑箱观测行为，更可直接研读公开还原的提示词结构与开源引擎机制。
> 「秘方层」的**逐比特复刻**仍非目标，残余行为差主要由 BPT 主权模型选择决定（换模型换手感），非「拒看」。

**v0.6 起步 —— 生成器/分类器产品功能（守密人 2026-07-05「V0.6 加这些产品功能吧，这就是我们看到的黑盒」裁定，已落）**：
把 Claude Code 主循环**之外**触发的辅助 utility 模型调用作为**真实公开 SDK 功能**发货（`src/generators/`）——即用户在 Claude Code 里
观测到的「黑盒」小调用。五件：① `detectCommandPrefix`（bash 命令前缀提取/命令注入判定，喂权限白名单匹配，**失败方向锁死 fail-closed**：
空/乱回复一律判 injection，绝不误放行）② `classifyBackgroundState`（读后台运行转录尾判 working/blocked/done/failed 驱动手机通知门，
**fail-safe**：不可解析回退 done，绝不伪造 blocked 假打扰，接 v0.5 后台 Bash）③ `generateSessionTitle`（会话标题）
④ `generateTitleAndBranch`（标题 + `claude/` 分支名，分支强规整为合法 kebab）⑤ `generateSessionName`（`/rename` kebab 名）。
每件 = 忠实复现提示词（`src/generators/prompts.ts`，5 面 provenance + corpus-sync 逐锚点守护）+ 一次性 utility 调用运行时
（`runtime.ts`，默认 Haiku 便宜模型、temperature 0 确定性、注入式 transport 可离线单测）+ 健壮解析器（`extractJsonObject` 认字符串内花括号/转义）。
公开 API 走 `src/index.ts` 导出 → BPT Desktop 等消费方即真实调用方（红线满足：能力与提示词一并发货）。**838 单测全绿**（+46）。

**v0.6 剩余 Batch 1（守密人 2026-07-05「ultracode 推进 V0.6 剩余」裁定，已落）**：经 ultracode 8 代理工作流（6 设计 + 综合 + 红线批判 ADJUST）
产执行路线图 `Public-Info-Pool/Resource/proposal/bpt-sdk-v06-remaining-execution-roadmap-20260705.md`（Tier 1 残项 + Tier 2/3 依赖排序、逐项过红线），
首批实现两件：① **G-VERIFY**（`src/verifier/`）三态验证器 CONFIRMED/PLAUSIBLE/REFUTED + recall-biased 忠实复现（part-4/part-5/skill keep-rule，
3 面 provenance + corpus-sync）；`adversarialVerify(finding)` 公开 API；`parseVerdict` **fail-closed**（乱码/歧义/空→REFUTED、绝不 keep 未验证发现）；
默认 haiku（批判揪出 sonnet 未测赌注、改齐 utility 默认）、可覆盖。② **G-SUMMARY**：compaction 摘要器追加 no-tools 守卫 + verbatim 安全保全条
（忠实复现，SUMMARIZER_SYSTEM 字节不变、旧金标保绿）+ `extractSummaryFromReply`（认 `<analysis>/<summary>` 契约、旧行为严格超集）；`generateAwaySummary`（第 6 面生成器）。
**881 单测全绿**（+43，含对抗审查 4 findings 修复回归）。红线批判确认零红线/零未发货能力/零黑池/零净室问题。G-HOOKCOND/G-SANDBOX（ship-now 但接线面大）与编排/DSL/沙箱/技能（需工具本体）留后续批。

**v0.6 剩余 Batch 2 —— 补 hook 分类器子系统（守密人「这意味着我们内部没有实现对应的功能，补！」裁定，已落）**：3 个 hook 分类器原被批判降级 design-only，
**唯一原因是「无消费子系统」**；守密人裁定**把子系统建出来**、让分类器像 v0.6 生成器一样「功能与提示词一并发货」（红线自然满足）。两子系统：
① **上下文提示**（`src/tips/`）：情境目录注册表（忠实复现 manual-polling/persistent-memory 两条情境、可扩展）+ `selectContextTip`（忠实复现 context-tip-selector，
**fail-safe** 默认 no-tip、且只返回 eligible∩catalog 内 feature_id、幻觉/越权 id 一律丢弃）+ `evaluateTipReception`（忠实复现 reception-evaluator，默认 unknown/neutral）；
② **记忆文件选择**（生成器族第 7 面）：`selectMemoryFilesToAttach`（忠实复现 determine-which-memory-files-to-attach，接 settingSources/记忆加载路径，**≤5、只返回可用集内文件名（幻觉丢弃）、去重、fail-safe 空表**、无文件时零调用短路）。
5 条新复现**字节级与归档一致**（reverse-diff 确认）。**930 单测全绿**（+55，含对抗审查 3 findings 修复回归）。原「3 分类器降级 design-only」判定被此裁定反转。

**v0.6 剩余 Batch 2 续 —— G-HOOKCOND + O-B0（守密人「继续」，已落）**：① **hook 条件门控**：`HookCallbackMatcher` 加 `condition`（自然语言条件）——runner 在触发该 matcher 回调**之前**用忠实复现的 hook-condition 评估器（`src/hooks/condition.ts`，base + stop 双变体，Stop/SubagentStop 自动走 stop 变体、支持 `impossible` 逃生口）做一次有界模型调用判定，**fail-closed**：不满足/乱码/评估出错（含无凭据）一律跳过回调；无 condition 的 matcher 走原确定性路径**零模型调用**（存量配置行为逐字节不变）；凭据经 query.ts `conditionOptions` 线程。② **O-B0 worker-fork preset**：`WORKER_FORK_FRAMING`（忠实复现 agent-prompt-worker-fork，适配 AGENT_TOOL_NAME→Agent）+ `buildWorkerForkPrompt`（`<system>` framing + 指令 + 附加上下文，与官方装配一致——framing 骑在 fork 任务轮里、不动缓存前缀）+ `WORKER_FORK_AGENT` preset（fork:true / maxTurns 200，挂 G4 已发货 fork 机制、runtime 零改动）。**coordinator/teams preset 刻意不发**（预设 SendMessage/teams 工具本体，属 O-B2——先建本体再复现提示词）。3 条新复现字节级一致（reverse-diff）。**952 单测全绿**（+22）。

**v0.6 剩余 Batch 3 —— G-SANDBOX + 卫生批（守密人「G-SANDBOX 推荐 / 网络默认断网」裁定，已落）**：默认开启的 Bash 沙箱、**可插拔后端**（`src/sandbox/`）。
`resolveSandboxBackend`（Linux+bwrap→BwrapBackend，否则 null 优雅降级 + 诚实 debug；`{backend}` 注入接缝供测试/未来 Seatbelt）+ `BwrapBackend`（纯 argv `--ro-bind / /` + writablePath 逐条 rw-bind + `--unshare-net` 默认断网 + `$TMPDIR` 重定向；限制范围只做归档描述的写盘/网络/tmpdir，**不发明**读隐藏/seccomp）+ `detectSandboxEvidence`/`sandboxFailureHint`（沙箱致败签名→`[sandbox]` 证据 + 重试路径）。
双 spawn 位（前台 `bash.ts` / 后台 `shells.ts`）经 `planShellSpawn` 同一接缝；持久 cwd/env 在沙箱内仍工作（stateDir rw-bind）。`dangerouslyDisableSandbox` 经权限门走 ask（Bash 非只读天然不自动放行，除 bypass/allow 规则）；`allowEscape:false` mandatory 模式政策拒绝。
**描述/schema 门控红线**：未激活时 Bash 描述字节不变、无 param、不含 "sandbox" 字样；激活加忠实指引（17 片段 provenance + corpus-sync 字节对齐归档）+ param；断网默认才装网络证据片段（不描述未激活限制）。
**Windows/macOS 无后端 → 如实降级、不假装隔离**（同官方 CC Windows 姿态）。卫生批：`tests/red-line-tool-names.test.ts`（红线常驻守卫：复现提示词不得引用当版缺席工具）+ plan 模式注释订正；conformance/emulator 钉 `sandbox:false` 保确定性。任务 #17（G-cmp）对账 completed（一致性 M1-M4 早已封顶）。**对抗审查揪出并修掉 4 个真问题**（含 1 个高危 fail-open）：**F1（HIGH fail-open）**——`dangerouslyDisableSandbox` 原对权限门不可见（我误以为「Bash 非只读→天然 ask」，实则 hook-allow / auto-classifier-allow / 为沙箱内用途写的 allow 规则都会静默放行到沙箱外）；已修：escape 成为**独立权限维度**（`gate.check.sandboxEscape`，loop.ts 接线），一律走 ask（除 bypassPermissions）、无 canUseTool/dontAsk 时 fail-closed，7 条回归测试锁定。**F3**：不存在的 writablePath 令每条沙箱命令全废 → 改 `--bind-try`。**F4**：`bwrap --version` 在禁用 userns 的硬化内核上假阳 → 改跑真隔离功能探测。**F2**（证据误报）：作为与官方同源的启发式 + 诚实免责声明 + F1 真 ask 接受。**1026 单测全绿 + 2 skipped**（真 bwrap 隔离测试无 bwrap 时跳过）、`tsc` + `build` exit 0。

**缓存稳定前缀优化（v0.5+，守密人 2026-07-04「优化」裁定，已落地）**：裸对比 run #35 发现本 SDK 短任务缓存命中
0%、长任务 45%——诊断为 cwd 焊进系统提示正中间致缓存前缀逐任务变（`prompts.ts`）。修法：系统提示拆
**稳定前缀**（工具表+静态开场白，逐字节稳定）+ **易变 cwd 尾块**，缓存断点落稳定块（`cacheSystemBoundary:'first'`
新开关，默认 `'last'` 保持契约）、cwd 尾块骑在断点后不污染缓存前缀 → 同账号跨 query 复用「工具+静态系统」。
仅缓存开时拆块（关时仍发单串保 drop-in）。693 单测全绿（+2）。真机命中率提升由 benchmark 复测确认。
**复测结论（run #40）**：短任务缓存**仍 0%**——真因不是 cwd（那是正确卫生、已修）而是**精简前缀够不着 Haiku 2048 门槛**
（逐任务写/读原始数：短任务写0读0、长任务写读俱全）。稳定前缀优化在 Haiku 短任务非绑定约束、未显效，但在 Sonnet（门槛 1024）
/ 长会话仍有效、无害留门。**净成本本 SDK 仍便宜 ~24%**（$0.121 vs $0.158）、速度 2.55× 快、正确性 9/9 平——0% 是精简的影子非病。

**v2 自撰提示词 A/B（守密人 2026-07-04「学公开材料造自己提示词 + 顺便测缓存」裁定，历史探针）**
[已被 v5 默认取代，见上「提示词默认提升 v1→v5」：`claude_code` preset 无 variant 现默认走 v5 忠实开放再现；
v1–v4 保留为显式变体。下方为当时自撰路线的运行记录，保留作历史，不再是当前默认]：
写 `defaultHarnessStableV2`（公开 prompt-engineering 实践驱动：规划/先取上下文/并行只读/改后验证/接地诚实/收尾/安全，
因更能干而变大非灌水，~489 vs v1 ~229 est tok）；开关 `options.harnessPromptVariant:'v1'|'v2'`（默认 v1、不动生产），
`prompts.ts` variant 路由 + `query.ts` 接线。benchmark 加 `--variant`、workflow 加 `prompt_ab` job（v1 vs v2 背靠背、无官方臂、
repeat=1 便宜探针 ~$0.08）。验收标准=**净值**：v2 须成本持平/更省 + 质量/轮数改善才提拔，否则退回 v1。699 单测全绿（+6）。
硬红线不变：只学公开材料、绝不读泄漏官方提示词文本。

**一致性测试套件 M1（2026-07-05，设计定稿见
`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-conformance-suite-design-20260705-r2.md`）**：
`tests/conformance/` 落地——内容盲仿真器正式版（请求体零读取 + `assertContentBlind` 自审）、
L1 流语法差分（`run-l1.mjs`，双臂活体对跑、归一化 token 序列 + KD 已知差异表比较）、
双包同钉 `pins.json`（agent-sdk 0.3.201 + claude-code 2.1.201 分别锁死；0.3.199→0.3.201 已于 2026-07-05 追版、零漂移）、CI 作业
`conformance-l1`（无钥零费常跑，官方臂 `--no-save` 临时装）。**首份矩阵：3/3
MATCH_WITH_KNOWN_DIFFS、零未解释分歧**；KD-01~KD-05 五条已知差异全部登记在
`normalize.mjs`（KD-05 = 消息粒度：官方按内容块/逐 tool_result 拆消息、本 SDK 按轮合批——
未来引擎对齐候选，对逐消息渲染的 Desktop UI 可感知）。本 SDK 流语法另有 vitest 回归锁
`tests/conformance-l1.test.ts`（无官方依赖、进常规 `npm test`）。

**一致性套件 M2（2026-07-05，ultracode 编排 8 代理落地）**：L2 选项语义差分 15 场景
（`tests/conformance/run-l2.mjs` + `scenarios-l2.mjs`，12 已知差异内全等 + 2 有意保红引擎发现
（s6 bypass 互锁 BPT 独有严格性 / s12 maxBudgetUsd 截停时点）+ s13 降级单臂锁）、L2 单臂语义锁 16 条
（`tests/conformance-l2-locks.test.ts`）、L3 工具行为差分 20 用例 + 4 单臂锁（`run-l3.mjs` +
`scenarios-l3.mjs` + `normalize-l3.mjs`，tool_result 内容级，0 未解释分歧；Write 读前写门缺失为
加固候选）。流 KD 表扩至 KD-01~11、工具 KD-L3-01~21，全部报告制不遮蔽。CI 作业合并为 `conformance`
（L1-L3 三连，无钥零费常跑）。对抗审查 2 major + 4 minor 已全修（承重化 s2/s3、s14 环境清洗 +
存储级连续性证明、KD-10 归因模式校验、crossCompare 豁免洞封死）。770 单测全绿。

**一致性套件 M3+M4（2026-07-05，第二轮 ultracode 落地）**：L4 故障注入（`run-l4.mjs` 9 用例，
KD-12/KD-L4-01~04，3 条保红引擎发现=截断轮优雅降级缺口）；棋轮门禁（`ratchet.mjs` + 入库
`baseline.json` 51 行，CI 硬门）；漂移哨兵（`conformance-drift.yml` 周检只报不追，首跑发现官方
0.3.201 已发布待裁定）；L5 五维 18 任务 + 乙门禁（`run-l5.mjs`，真 API dispatch `conformance_l5`，
`--smoke` 无钥自证，L6 公开流留痕）。M1-M4 封顶，799 单测全绿。

**引擎对齐批 E1–E5（2026-07-05，L5 交接档
`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-engine-alignment-handoff-20260705.md` 派单）**：
E1 preset 默认思考（4096 我方值、KD 登记、非 preset 零变化）；E4 Write 读前写门（逐字官方错误文案、
`readFilePaths` 每 query 一份子代理共享、L3-WRITE-02 官方臂 CONTENT_MATCH、KD-L3-06 退役）；
E5 预算执行前截停（工具零执行、L2 s12 转 MATCH、engineFinding 退役）；E3 截断轮优雅降级
（整块挽救、完整 tool_use 照常执行续轮、未闭合绝不执行、L4 三红行全清、KD-L4-04 退役、
KD-L4-02 收窄 errorPresent）；E2 result 口径对齐（num_turns/usage 逐 result、cost/apiMs 累计、
**破坏性** MIGRATION 5e、run-l5 聚合并轨、KD-L5-04 退役）。1049 全绿。E1 验收待守密人派真 L5。

**官方文档逐条接口对账（2026-07-05）**：live 官方 TypeScript 参考（3550 行）快照
`Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md`；逐条审计档
`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-docs-interface-audit-20260705.md`
（drop-in 破坏级 15 项总榜 + COMPAT.md 15 处陈旧行修订 + NEW-IN-DOCS 挂账 + P0/P1/P2 修复 backlog）。
COMPAT.md 头部已挂该档指针；修复 backlog 待守密人裁定后开工。

**透传上下文构成明细（v0.32.0，2026-07-09，黑池 ContextRing「上下文构成」面板派单）**：SDK 在装配请求那一刻
把它本就掌握、且不依赖网关的两块信息暴露出来，让黑池面板不再事后从转录反解 + 字符估算。**需求 A（逐部分估算）**：
`analyzeRequestComposition(request, system?)` 出 `promptComposition = { systemBase / systemAppend[] / toolDefs / messages / totalEstTokens }`，
每桶用 SDK 自己的 `engine/tokens.ts`（与判上下文窗口同口径），`systemAppend` 带回黑池传入的 label；**需求 B（缓存断点内容映射）**：
`cacheBreakpoints = [{ afterPart, prefixEstTokens }]`——逐个 `cache_control` 断点标注它封的前缀估算 token（tools→system→messages 序），
黑池据此把真实 usage（`cache_read` 真=命中缓存前缀 / `input`+`cache_creation` 真=本轮新增）零调用映射进构成桶。交付：`analyzeRequestComposition`
导出可同步调；同一份数据在 `options.includePromptComposition` 开时经 `system`/`prompt_composition` 观测消息每请求发一次（默认关、零成本、绝不动线缆请求）。
「带 label」理想面：preset `systemPrompt` 增 `appendSegments: {label,text}[]`、`SystemPromptSegment` 增 `label?`（均元数据、线缆字节不变），使 Root/Runtime/Memory 各桶可分别归位。
与 `buildSystemPromptParts` / `enumerateBuiltinToolMetadata` 同血统（ADR 0014/0022）；逐段精确真值仍待 `count_tokens`（互补，非本需求范围）。**1521 单测全绿**（+14）。
**同 PR 兼收黑池第二份请求「激活技能持续占用计量」**（守密人 2026-07-09 裁定「复用 systemAppend label」）：本 SDK **无技能子系统**（会话 `skills` ACCEPTED-IGNORED、无 `load_skill` 工具、无 `peakContextTokens`），故方案 A/B 无从原样实现；改由**带 label 的 `systemAppend`** 承接——激活技能若以常驻 **system-prompt 段**（`appendSegments`/`append`/segments）重注入，给该段贴 `skill:<id>` label 即从 Unknown 残差里析出归 Skills 桶。诚实边界：首次 `load_skill` 的 `tool_result` 与「以消息内容重注入」的技能落 `messages` 聚合桶（注入方为宿主、自可计量），逐消息段归账属另一独立请求。

**OpenAI 协议支持（v0.35.0，2026-07-09，守密人「可以想办法支持 OpenAI 协议么」派单）**：
`provider.protocol: 'openai-chat'` 经翻译传输层（`src/transport/openai.ts`）直驱任意 OpenAI 兼容
Chat Completions 端点（api.openai.com / DeepSeek / vLLM / one-api 网关）——引擎全程仍说 Messages API
形状，翻译只发生在线缆边界（请求编码：system/tools/tool_choice/图像/tool_result 扇出/response_format；
流合成：text / tool_calls→tool_use+input_json_delta / DeepSeek `reasoning_content`→thinking 块 /
finish_reason 与 usage 映射含缓存 token 拆分）。重试/退避/空闲看门狗/并发闸与 Anthropic 传输同策略；
错误规整为 Messages API 错误类型词汇（引擎侧处理免改）。三处传输构造点（query/session-manager/generators）
统一走工厂 `src/transport/factory.ts`，默认仍 'anthropic' 零行为变化。诚实边界：`thinking` 配置不上线缆
（改用 `openai.reasoningEffort`）、`cache_control` 剥除（OpenAI 侧缓存自动）、PDF 块降级占位文本、
Claude 短别名（generators 默认模型等）需显式改模型、非 Claude 模型成本估算为 0（`maxBudgetUsd` 不可执行）。
详见 `docs/OPENAI-PROTOCOL.md`。**1548 单测全绿（+21）**、`tsc` + `build` exit 0。

**审计债务清偿（v0.37.0，2026-07-10，守密人「将所有审计的技术债务还完」目标令，已落）**：
四维审计报告（`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-optimization-review-20260710.md`）
的 P0/P1/P2 全部落地——3 个 P0 真缺陷（OpenAI 翻译器交错 tool_calls / 两条孤儿 tool_use 入库路径 /
TaskOutput 阻塞无视 abort）+ P1 加固（压缩触发 O(n²) 消除 + 真值地板、钩子 fail-safe 旋钮
`hookFailureMode` + 注册序确定性聚合、pending_turn 终局 settle 防预算绕过、list() 元信息扫描、
后台收尾先 settle 再 flush、OpenAI 网关 modelMap/Azure 鉴权/pricing 注入/informational 静默失效警告）
+ P2 结构（import-discipline 守卫 + 断 engine↔subagents 环、transport 双胞胎防漂移测试、
tool-dispatch/config-builder/sessions-persistence/query-accounting/async 五件抽取
（query.ts 2008→约1530 行、loop.ts 1519→约1160 行）、system 场推导单点化 + 装配↔推导契约测试、
ToolContext 收编 sessionKey/permissionGate、workflow-engine 迁 tools/、`src/version.ts` 单一版本源、
文档三处 settingSources 矛盾统一 + electron 示例修复 + 示例漂移守卫、L5 月度定时轮）。
ToolContext 阶段二字段归组按审计自身裁定挂大版本窗口（契约注记在案）。**1600+ 单测全绿**、`tsc` + `build` exit 0。

进度以 `memory/project-status.md` 为唯一权威。

## v0.2 候选

subagents（agents 选项）、上下文压缩（compact_boundary）、WebFetch/WebSearch
工具、设置文件 hooks、会话管理全量 API、defer 权限决策。
