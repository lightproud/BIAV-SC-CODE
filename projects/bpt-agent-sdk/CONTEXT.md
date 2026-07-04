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

**Backlog（守密人「先存下来」，2026-07-04）——黑箱行为观测法收窄能力层差**：质量/行为差里，
「能力层」（agent 环转数/决策对不对）可干净室安全地逼近官方，方法是**黑箱行为克隆**（Compaq 逆向 IBM BIOS 金标准）：
跑官方当黑箱、只观测其输入→输出行为（选哪个工具/怎么分步/答案排版），据此**独立撰写本 SDK 自己的提示词**去逼近
同样行为，全程不读官方提示词文本 + 拿自造提示词做 A/B 迭代爬坡。「秘方层」（专有提示词本体）仍是不可触碰的结构性天花板。
**硬红线**：泄漏/流传的官方提示词文本一律不并入本仓（净室=MIT 合法性地基，泄漏≠公开文档，见 POSITIONING §2）。

进度以 `memory/project-status.md` 为唯一权威。

## v0.2 候选

subagents（agents 选项）、上下文压缩（compact_boundary）、WebFetch/WebSearch
工具、设置文件 hooks、会话管理全量 API、defer 权限决策。
