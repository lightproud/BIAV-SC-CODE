# bpt-agent-sdk — 子项目会话上下文

## 定位

BPT Agent SDK：净室（clean-room）实现的 TypeScript agent 框架，公开调用面
drop-in 兼容 `@anthropic-ai/claude-agent-sdk`，引擎直连 Anthropic Messages API
（fetch + SSE），**不捆绑任何专有 CLI 二进制**。银芯 → 黑池单向输出物：黑池
（BPT Desktop, Electron/Node）换 import 即可摆脱对被禁 `claude.exe` 子进程引擎
的依赖。

- 派发来源：守密人 2026-07-03 会话（背景：Claude Code 被列入办公环境高风险软件，
  BPT 需自有引擎）。
- 净室纪律：唯一输入为公开文档（code.claude.com/docs/en/agent-sdk/* 与公开
  Messages API 文档），零复制专有代码；本包 MIT 许可。
- **净室观测边界（硬约束，守密人 2026-07-05 裁定，全文见 `memory/decisions.md`）**：
  ① 行为对照仅限**官方发行渠道产物 + 官方公开文档**，第三方复刻不得作参照；
  ② **内容盲纪律**——官方臂请求体（内含专有系统提示词）任何工具/仿真器/日志/档案
  **不得读取、不得持久化**；合法观测面 = 公开消息流 + 文件系统副作用 + 终态答案 +
  线缆元数据（方法/路径/头名 + 协议元数据头值白名单）；内容盲组件必须自带自审断言；
  ③ **泄漏衍生禁引**——claw-code / Nano-Claude-Code / claurst 及 2026-03 泄漏事件
  同源衍生物一律不读不引（泄漏≠公开文档，转写/查重清零/转手均不洗白）。
  官方臂协议剖面（首个合规执行范例）：
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-arm-protocol-profile-20260705.md`。
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
3. **真机 smoke**（`tests/integration/live-real-api.mjs`）：真 Claude 模型自己决定调工具；从 `ANTHROPIC_API_KEY` env 读密钥（**脚本不含密钥**），不进 `npm test`。CI 侧由 `.github/workflows/bpt-agent-sdk.yml` 的 `live-smoke` job 手动触发（`workflow_dispatch`），用 `secrets.ANTHROPIC_API_KEY` 注入——密钥值全程不入仓库。

## 当前状态

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
挂 `bpt-agent-sdk.yml` 的 `ab_benchmark` dispatch 输入，报告作 artifact 上传。**691 单测全绿**。
首轮真 API 实测（haiku，7/7 全过，$0.076/18 轮）：工具耗时全毫秒级、缓存命中 0%（短会话摊不平缓存写入溢价，
实证 POSITIONING §6「缓存复利只在多轮长对话显现」），offender 头部为 4 轮写改类（轮数是成本主乘数）。

**官方裸对比（v0.5+，守密人 2026-07-04「先跑裸对比」裁定）**：`bpt-agent-sdk.yml` 加 `vs-official` job
（`vs_official` dispatch 输入）——同模型同 7 任务、本 SDK vs 官方 `@anthropic-ai/claude-agent-sdk` 两引擎各跑，
`--compare` 出并排表。只比**客观两轴**：响应速度（墙钟/API ms/TTFT）+ 输出正确性（同 `check()` 通过率）；
**质量不评判**（该轴被专有系统提示词混淆，属 POSITIONING §2/§4 结构性天花板）。官方包用 `npm i --no-save` 仅本次装、
**绝不进 package.json/lockfile、绝不成本包依赖**（净室纪律）；官方引擎当**纯黑箱**计时+判分，读其输入输出行为、
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
  **各面 provenance + corpus-sync 已覆盖 SDK 实用 4 surface**：① main-loop（片段库+装配器+金标）② tool-descriptions（`descriptions.ts` `TOOL_DESCRIPTION_PROVENANCE`）③ general-purpose 子代理（`agents.ts`，净室→忠实复现官方 strengths+guidelines）④ compaction 摘要器（`compaction.ts` `SUMMARIZER_SYSTEM`，净室→忠实复现官方 5 节续接摘要）。
  **范围边界（红线）**：归档剩的生成器/分类器（commit-msg/session-title/branch/bash-前缀检测/后台状态分类器/auto-mode）**属 SDK 未发货功能，不复现**（不得描述不存在的能力）。**待续（可选）**：build-from-archive 生成器（现有校验器已达「保真+抗漂移」核心，生成器为进一步自动化）。
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

**缓存稳定前缀优化（v0.5+，守密人 2026-07-04「优化」裁定，已落地）**：裸对比 run #35 发现本 SDK 短任务缓存命中
0%、长任务 45%——诊断为 cwd 焊进系统提示正中间致缓存前缀逐任务变（`prompts.ts`）。修法：系统提示拆
**稳定前缀**（工具表+静态开场白，逐字节稳定）+ **易变 cwd 尾块**，缓存断点落稳定块（`cacheSystemBoundary:'first'`
新开关，默认 `'last'` 保持契约）、cwd 尾块骑在断点后不污染缓存前缀 → 同账号跨 query 复用「工具+静态系统」。
仅缓存开时拆块（关时仍发单串保 drop-in）。693 单测全绿（+2）。真机命中率提升由 benchmark 复测确认。
**复测结论（run #40）**：短任务缓存**仍 0%**——真因不是 cwd（那是正确卫生、已修）而是**精简前缀够不着 Haiku 2048 门槛**
（逐任务写/读原始数：短任务写0读0、长任务写读俱全）。稳定前缀优化在 Haiku 短任务非绑定约束、未显效，但在 Sonnet（门槛 1024）
/ 长会话仍有效、无害留门。**净成本本 SDK 仍便宜 ~24%**（$0.121 vs $0.158）、速度 2.55× 快、正确性 9/9 平——0% 是精简的影子非病。

**v2 净室提示词 A/B（守密人 2026-07-04「学公开材料造自己提示词 + 顺便测缓存」裁定，探针进行中）**：
写 `defaultHarnessStableV2`（公开 prompt-engineering 实践驱动：规划/先取上下文/并行只读/改后验证/接地诚实/收尾/安全，
因更能干而变大非灌水，~489 vs v1 ~229 est tok）；开关 `options.harnessPromptVariant:'v1'|'v2'`（默认 v1、不动生产），
`prompts.ts` variant 路由 + `query.ts` 接线。benchmark 加 `--variant`、workflow 加 `prompt_ab` job（v1 vs v2 背靠背、无官方臂、
repeat=1 便宜探针 ~$0.08）。验收标准=**净值**：v2 须成本持平/更省 + 质量/轮数改善才提拔，否则退回 v1。699 单测全绿（+6）。
硬红线不变：只学公开材料、绝不读泄漏官方提示词文本。

进度以 `memory/project-status.md` 为唯一权威。

## v0.2 候选

subagents（agents 选项）、上下文压缩（compact_boundary）、WebFetch/WebSearch
工具、设置文件 hooks、会话管理全量 API、defer 权限决策。
