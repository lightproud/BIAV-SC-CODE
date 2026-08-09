# silver-core-sdk — 子项目会话上下文

> **维护态（守密人 2026-08-02 换轨裁定 + 施工边界文书裁 3）**：使命#2 载体已换轨
> `projects/black-pool-agent/`（基于 NousResearch/hermes-agent 改造扩展）。本家族
> （agent / maestro / testbed）即日起**纯维稳**——版本冻结、仅修影响生产的 bug、零新功能，
> BPT 在产 pin 消费者不断供；迁移终裁 = 能力对照表齐（文书裁 14）后按 wiki 先例冻结
> （触发线 `memory/todo.md` #T78）。决策全文见 `memory/decisions.md` 2026-08-02 两条。

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

**当前版本 `2.2.3`** · 发布日 2026-07-29 · 家族锁步对端 `silver-core-maestro-sdk` = `2.2.3`

> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由`tests/test_status_doc_facts.py` 守。

<!-- CONTEXT-FACTS:END -->

**v2.2.3（2026-07-29）：观察项批收口**——2.2.2 审计留在观察位的静默回落全线收紧。本版为
家族锁步同号（maestro = 2.2.3）。

**当前定位**：Claude Agent SDK 的干净重实现，**20+ 真实消费者、BPT 在产**；黑池侧已全面
换装自有技术栈（BPT + 本包 pin）。**2026-08-02 起随 T78 转维护态**——纯维稳、仅修影响生产的
bug、零新功能；家族工程守卫工作流（unit tests / conformance / mutation-ratchet / testbed-patrol /
cold-start）已全数降级为 `workflow_dispatch` 手动触发，验证网保留不删；BPT 换装完成后按 wiki
先例冻结。使命#2 现行核心载体已换轨 `projects/black-pool-agent/`（2026-08-02 裁定）。

**逐版发布叙述以 `CHANGELOG.md` 为唯一权威**（有 `scripts/check-version-bump.mjs` 守着）；
锁步纪元下约四成版本为「本包零改动」空转对齐，`python3 scripts/sdk_substantive_versions.py`
可筛出对消费方有实质变更的那些。官方语义差异台账见 `docs/COMPAT.md`。

**2026-08-08 之前累积的逐版叙述已下沉** `memory/archive/sdk-context-chronicle-20260808.md`
（原文逐字未改）。状态档侧的同类内容另见 `memory/archive/sdk-status-chronicle-20260727.md`。

> **本档 27,500 字符封顶**（`tests/test_claude_md_size.py` 守）——路由器不许长成目录。
> 撞线时的正确动作是下沉、且**一次整理到上限的 50%**，不是抬上限、也不是压回刚好达标
> （守密人 2026-08-08 追裁）。**注意**：2026-07-26 那次瘦身后本档曾在**行数**上限下靠
> 「把行写长」回涨到 122 字符/行——度量已于同日改为字符，此路已封。
