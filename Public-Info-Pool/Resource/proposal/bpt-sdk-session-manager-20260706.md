# BPT Agent SDK — SessionManager 设计提案（层一：共享协调 + 监督恢复）

> **状态**：proposal（待守密人过目后派工）。
> **裁定链**：守密人 2026-07-06「讨论 SDK 后台进程」→ 收敛为层一（进程内协调者，非守护进程）→
> 「A」（同 app 内多对话共享 MCP/配置）→ 「先谈稳定性（崩了无法恢复）」→
> 「认可层一 = 共享协调 + 监督恢复」→ 「乙：先出 proposal 落档再建」（本档）。
> **版本落点**：v0.9 候选（additive，向后兼容）；COMPAT 定性 **BPT-EXTENSION**
> （官方 SDK 无进程内多对话协调者——官方的协调发生在其 CLI 宿主进程里，对 SDK 调用方不可见）。

---

## 1. 动机：两处实测痛点

**痛点一：连接浪费（无共享）。** 现状每个 `query()` 自带一份 `AnthropicTransport`
（`src/query.ts:384`）+ 一份 `DefaultMcpRegistry`（`:492`）。BPT 一个 app 里开三个对话 =
同一个 stdio MCP server 被 spawn 三次、同一个 HTTP MCP session 建三遍、三份传输配置。
没有任何共享，也没有一处能看全局。

**痛点二：崩了无法恢复（守密人原话）。** 拆解后真因有三个缺口，而**不是**缺后台进程：

| # | 缺口 | 现状 |
|---|------|------|
| G1 | 持久化默认不开 | `sessionStore` 是可选注入；不接 = 纯内存，崩了全没 |
| G2 | 恢复要手动 | resume 能力已有且加固（残损 transcript 自愈），但**得调用方自己发起**，没有监督者 |
| G3 | 中途崩丢当前轮 | 逐消息 append 只覆盖「已完成的消息」；请求在飞时崩，只能退回上一条已落盘消息 |

**关键论断（已与守密人对齐）**：恢复能力来自**耐久持久化 + 监督重驱**，与「有没有独立进程」无关——
一个不做持久化的守护进程自己崩了照样全丢。三个缺口全部在库内可堵。

> 小学生比喻：恢复不是「让厨房整夜开着」，是「把做到一半的菜随手记进带锁账本」——停电了翻账本就能接着做。
> 守护进程只是守夜人；守夜人睡死了照样白搭，**账本才是命根子**。

## 2. 定位与非目标

**定位**：`SessionManager` = 同一宿主进程内的**对象级协调者**，双职责：
① **共享协调**（一份 transport + 一份 MCP 连接池 + 全局视图，多 query 复用）；
② **监督恢复**（持久化加固 + query 崩溃自动 resume 重驱）。

**非目标（明确不做，防范围蔓延）**：
- **不做层二守护进程**（客户端-服务器、断连续跑、远程瘦客户端）——那是平台级立项，另案；
- 不做跨进程 IPC / 线协议；
- 不做跨对话硬预算上限（v1 只给只读聚合视图，避免并发扣费竞态）；
- 不改变任何现有 wire 行为（一致性棘轮零扰动）。

## 3. API 形状

```ts
import { createBptSession, fileSessionStore } from 'bpt-agent-sdk';

const mgr = createBptSession({
  provider, mcpServers, model,                     // 共享层配置
  store: fileSessionStore('~/.bpt/sessions'),      // R1：内建文件 store，一行接
  recovery: { autoResume: true, maxResumes: 2 },   // R2：监督恢复
});

const a = mgr.query({ prompt: pa, sessionId: 'convo-a' });  // 借共享连接、被持久化、受监督
const b = mgr.query({ prompt: pb, sessionId: 'convo-b' });  // 同一份 MCP 连接，多路复用

mgr.usage();        // 只读聚合：跨对话 token/费用总览
await mgr.close();  // 统一拆共享连接
```

**向后兼容（零破坏）**：现有独立 `query(x)` 签名不变，内部重构为语法糖——
`query(x) ≈ createBptSession(x).query(x) + auto-close`。存量调用方零改动。

## 4. 职责一：共享协调

### 4.1 共享物与安全性论证

| 共享物 | 现状 | 共享后 | 并发安全依据 |
|---|---|---|---|
| `AnthropicTransport` | 每 query 一份 | 进程一份 | 无状态请求器：每次 fetch+SSE 独立，只持配置（key/端点/重试），不持对话态 |
| `DefaultMcpRegistry` | 每 query 一份、同 server 开 N 遍 | 进程一份、连一次多路复用 | 已按 **request id 关联**响应（`http.ts:438` / stdio id 校验）；同 query 内并行只读工具已在并发调它，跨 query 并发同理不串话 |
| 配置/预算账本 | 各自独立 | 共享默认 + 只读聚合 | 账本聚合读加锁即可 |

### 4.2 生命周期契约（头号正确性约束）

- **manager 拥有**共享连接：构造时 `connectAll` 一次；
- **query 借用不拆**：单对话结束**不关**共享 MCP/transport（现 query 会 `closeAll`，共享模式下改为只收 query-scoped 资源——checkpoint store、shell 注册表等仍归 query）；
- **`mgr.close()` 统一收尸**：拆所有共享连接；close 后再 `mgr.query()` 抛 `ConfigurationError`。
- 反面用例钉死：**「一个对话结束把别人的 MCP 连接拆了」= 本设计的头号回归红线**，必须有专测。

### 4.3 D 系决策点（共享侧，沿用 A 轮已给默认）

| # | 决策 | v1 默认 |
|---|---|---|
| D1 | query 在共享池之上叠加私有 MCP server？ | **v1 只用共享池**；私有叠加涉及混合生命周期，留 v2 |
| D2 | 跨对话预算 | **只读聚合视图**（`mgr.usage()`），不做硬上限 |
| D3 | 命名 | `createBptSession` / `SessionManager`（守密人可改名） |

## 5. 职责二之基座：持久化加固

### 5.1 内建 `FileSessionStore`（堵 G1）

- 新增 `fileSessionStore(dir)`：基于现有 `SessionStore` 适配器契约的本地 JSONL 实现
  （每 session 一文件、逐记录 append、原子写尾）；
- **R1 默认**：持久化**默认关**（库不擅自写盘），但接入成本压到一行；文档明示「无 store = 无恢复」。

### 5.2 预写检查点（堵 G3）

- 时机：**每轮发起 API 调用前**，先落一条 `pending_turn` 检查点记录（含该轮用户输入 / 待发工具结果批的引用）；
- 崩溃后 resume：发现尾部 `pending_turn` 无对应完成记录 → 该轮**重驱**（幂等：重发同一请求；工具已执行的批次按现有 tool_result 落盘状态判断，绝不重放已产生副作用的工具调用——只重放 API 请求段）；
- 正常完成：落完成记录，pending 标记随之失效（逻辑上被覆盖，不回删——store 是 append-only）；
- 与现有「resume 残损自愈」（尾悬空 tool_use 修复）叠加，构成完整的「任意崩点可恢复」链。

## 6. 职责二：监督恢复（堵 G2）

### 6.1 错误分类（恢复决策表）

| 类 | 例 | 监督者动作 |
|---|---|---|
| **可恢复** | `APIConnectionError`（网络/流崩/看门狗，含 `sse_malformed_frame`/`stream_idle_timeout`）、`McpError` 连接类（`mcp_connect_timeout`/`mcp_connection_closed`/`mcp_server_exited`） | 自动从 store resume 重驱，透明续跑 |
| **终态** | `AbortError`（用户主动）、`ConfigurationError`、`APIStatusError` 4xx 非限流（认证/请求非法）、权限致命 | 照常上抛，**绝不**重试 |
| **限流/5xx** | 429 / 5xx | 传输层已有重试（maxRetries 10）；重试耗尽后升格为可恢复类，进监督 resume（等效退避一轮） |

复用 E6c 稳定错误码 `code` 做分类判据（错误面收口的直接红利）——分类靠机器码，不靠猜消息文本。

### 6.2 监督语义

- 范围：仅 `mgr.query()` 且接了 store 且 `recovery.autoResume !== false`；
- 上限：`maxResumes`（默认 **2**）次/查询；到顶后把最后一个错误原样上抛，并在错误上附 `resumeAttempts` 现场；
- 可观测：每次自动 resume 发射一条 `system`/`status` 观测消息（复用现有观测臂，不新造类型）；
- 独立 `query()`（无 manager）行为**完全不变**——监督是 manager 的能力，不是全局魔法。

### 6.3 R 系决策点（恢复侧，推荐默认）

| # | 决策 | 推荐默认 | 理由 |
|---|---|---|---|
| R1 | 默认开持久化？ | **否**，内建 store 一行接 | 库擅自写盘是惊吓；易接即可 |
| R2 | 自动 resume？ | **有 store 时默认开**，`maxResumes: 2`，仅可恢复类 | 无 store 无处 resume；有界防无限重试 |
| R3 | 预写检查点？ | **做** | 不做则「中途崩丢当前轮」缺口仍在，恢复不完整 |

## 7. 测试与验收

| 域 | 必测 |
|---|---|
| 共享协调 | 两 query 并发压同一 MCP registry 不串话（id 关联）；单 query 结束共享连接存活（**头号红线**）；`mgr.close()` 全拆；close 后 query 报 `ConfigurationError` |
| 持久化 | `fileSessionStore` 往返（append→load）；`pending_turn` 落盘时机（API 调用前）；崩后 resume 重驱该轮且**不重放已执行工具** |
| 监督恢复 | 注入式 transport 模拟流崩 → 自动 resume 续跑出正确终态；终态错误不 resume 直接上抛；`maxResumes` 到顶上抛带现场；观测消息发射 |
| 回归 | 独立 `query()` 语法糖化后全量 vitest 保绿；一致性 L1–L4 + wire 棘轮零扰动（共享化不改请求体） |

验收 = 全量 vitest 绿 + 上表专测全绿 + 升版 v0.9.0 + CHANGELOG/COMPAT（BPT-EXTENSION 章）/MIGRATION（若 query() 内部化有可观测差异则记，预期无）。

## 8. 风险与消解

| 风险 | 消解 |
|---|---|
| 共享连接被单 query 误拆（头号） | 生命周期契约 + 专测钉死；close 权限只在 manager |
| 预写检查点误重放已执行工具 | 重驱只重放 API 请求段；工具执行状态以 tool_result 落盘为准（§5.2） |
| 自动 resume 掩盖真实故障 | 仅可恢复类 + 有界 maxResumes + 观测消息留痕，错误到顶原样上抛 |
| query() 语法糖化引入行为漂移 | 全量回归 + 棘轮把关；糖化只动构造位置，不动请求体 |
| 范围蔓延到层二 | §2 非目标钉死；任何 IPC/守护诉求另案立项 |

## 9. 实施计划（获准后）

两子代理并行（文件面不相交），艾瑞卡合流：

- **甲·共享协调**：`SessionManager` + transport/MCP 上提注入 + `query()` 语法糖化 + 共享生命周期专测；
- **乙·持久化恢复**：`fileSessionStore` + 预写检查点 + 监督者（错误分类复用 E6c code）+ 恢复专测；
- **合流**：全量验证 → v0.9.0 → CHANGELOG/COMPAT 落账 → PR。

预估量级：甲 M、乙 M-L；一个批次内可完。

## 10. 指针

- 现状证据：`src/query.ts:384/:492`（每 query 各建）、`src/sessions/store.ts`（resume 自愈）、
  `src/errors.ts` + `docs/ERRORS.md`（E6c 错误码，监督分类判据）
- 差异台账：`projects/bpt-agent-sdk/docs/COMPAT.md`「Divergences」表（本特性落地后增 SessionManager 行）
- 讨论链存证：本会话 2026-07-06（后台进程 → 层一/层二拆分 → A → 稳定性 → 双定位认可 → 乙）
