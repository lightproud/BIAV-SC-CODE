# Silver Core SDK vs 官方 `@anthropic-ai/claude-agent-sdk` — 实测差异报告

- **日期**：2026-07-13（北京时间，UTC+8）
- **本 SDK 版本**：`silver-core-sdk` 0.53.6（`projects/silver-core-sdk/package.json`）
- **官方对照**：`@anthropic-ai/claude-agent-sdk` **0.3.207**（npm latest，实拉 tarball 解包）
- **既有 pin/追踪基线**：`docs/COMPAT.md` 追踪 **0.3.205**
- **测法**：npm 实拉官方 0.3.205 + 0.3.207 两版 tarball；用 TypeScript 编译器 API
  解析双方 `.d.ts` 导出符号面；官方-对-官方隔离版本漂移；本 SDK 全量 vitest 对照测试

---

## 0. 一句话结论

本 SDK 与官方的**结构性根差异未变**（官方包 CLI 子进程 vs 本 SDK 直驱 Messages API），
公开接口层面仍是官方的**超集**（本 428 导出符号 vs 官方 232）；对照测试 **2171 全绿 + 2 skip**。
**新增发现**：官方已从我们的 pin 0.3.205 漂到 **0.3.207**（落后 2 补丁版），该区间**零新导出符号**、
但有**字段级追加**——其中 **`TerminalReason` 联合新增 6 个成员，本 SDK 尚缺**，构成一处具体的
drop-in 穷尽性缺口，需守密人裁「追不追」。

> 小学生比喻：官方 SDK 是「用现成的整台游戏机（claude.exe）套个壳」，本 SDK 是「自己拿电路板
> （Messages API）从零焊一台功能一样的机器」——外面的按钮（接口）对得上，里面的芯片完全不同。
> 这次体检发现官方最近偷偷多贴了几个新按钮的**标签**（枚举成员），我们的面板上还没印。

---

## 1. 结构性根差异（The Point of This SDK，未变）

| 维度 | 官方 0.3.207 | 本 SDK 0.53.6 |
|---|---|---|
| 引擎模型 | 包装 Claude Code CLI（黑盒子进程） | 直驱 Anthropic Messages API（fetch + SSE，不打包 CLI） |
| 包体积 | tarball 1,045,563 B（含 sdk.mjs 933KB + browser + bridge 双运行时） | tarball ~809KB（纯 TS 编译产物，零 CLI 二进制） |
| 依赖 | 零 runtime deps（CLI 自带一切） | `fast-glob` + `zod` 两个 runtime dep |
| 凭据来源 | CLI 内部 | `options.provider`（BPT 扩展）/ `ANTHROPIC_*` 环境变量 |
| 多后端 | Anthropic 单一（CLI 说 Messages API） | + `openai-chat` 翻译传输、`provider.pricing`、自建 node keep-alive HTTP 客户端 |

> 小学生比喻：官方那台机器出厂就配了发电机（凭据/网络/沙箱全在 CLI 里）；我们这台得自己从墙上
> 接电（provider 配置），但也因此能插在任何插座上（OpenAI 兼容网关、自定义代理）。

---

## 2. 导出面差分（TypeScript 编译器 API 解析，权威口径）

| 集合 | 数量 |
|---|---|
| 本 SDK 导出符号（`dist/index.d.ts` 解析后） | **428** |
| 官方导出符号（`sdk.d.ts` 解析后） | **232** |
| 官方有 / 本 SDK **按名未导出** | **106** |
| 本 SDK 有 / 官方无（扩展 + 内部类型 + 内联子类型） | **302** |

### 2.1 「106 按名缺口」归桶（非等于 106 个能力缺失）

| 桶 | 数量 | 性质 |
|---|---|---|
| `Hook*Input` / `Hook*SpecificOutput` 子类型 | 30 | hook 系统本 SDK 已实现，仅未逐个具名导出子形状（联合内联） |
| `Session*` / `Subagent*` 子选项 & 工具类型 | 18 | 会话/子代理子选项，多为命名粒度差异 |
| `Settings*` / `resolveSettings` / `WarmQuery` / `startup` | 10 | **N/A-by-design**：CLI 耦合的设置引擎 / 预热生命周期，直驱引擎无对应 |
| `SDKControl*` 控制协议 | 7 | **N/A-by-design**：无 control_request 线协议 |
| `Sandbox*` 子配置 | 5 | 本 SDK 用 BPT-shaped 沙箱对象，未逐个具名 |
| `Thinking*` 子类型（Enabled/Disabled/Adaptive/Config） | 4 | 本 SDK 按模型档位内联发线，未导出具名子类型 |
| 其余（union 命名拆分 + 若干新增 SDK\*Message 等） | ~32 | 混合：多为 union 拆分（如 `SDKResultSuccess`/`SDKResultError` 我们并入 `SDKResultMessage` union），少数为真新增类型 |

> 小学生比喻：这 106 个里绝大多数不是「缺零件」，而是「同一个零件我们没给它单独贴标签」——
> 官方把一个大抽屉里的每个格子都命名了，我们只命名了整个抽屉。真正「官方有我们没有」的东西，
> 是下面第 3 节那几个新贴的标签。

---

## 3. 官方 0.3.205 → 0.3.207 版本漂移（隔离出的真·新增）

**双版本官方 tarball 对照结论：导出符号面零变化（232 = 232，无增无删）。** 漂移全在字段/文档层：

### 3.1 `TerminalReason` 联合 +6 成员 —— 本 SDK 尚缺（真缺口）

官方 0.3.207 新增：`api_error`、`malformed_tool_use_exhausted`、`budget_exhausted`、
`structured_output_retry_exhausted`、`tool_deferred_unavailable`、`turn_setup_failed`。

本 SDK `src/types.ts:1979` 的 `TerminalReason` 仍为 0.3.205 时代 12 成员集，**缺上述 6 个**。
对 drop-in 消费方而言，若其 `switch (result.terminal_reason)` 穷尽官方新联合，本 SDK 的类型
会漏这几支（typed-not-emitted 亦可，但类型面应对齐）。

### 3.2 `mcp_call` 控制协议追加分级暂存字段（落 N/A-by-design）

`input_files` / `output_files` / `expires_at` / `timeout_ms`（Cowork 文件同步车道的 staging 语义）。
落在本 SDK 已声明 **N/A-by-design 的 control_request 线协议面**——直驱引擎无此通道，不构成缺口，
但需在 COMPAT 台账补一条「已知不追」注脚以防漂移误判。

### 3.3 hook 输出追加 `结构化工具输出` 字段

PostToolUse 家族输出新增结构化工具输出字段（`AgentToolCompletedOutput` 形状）。同属可选追加。

### 3.4 文档措辞精化

`SDKModelRefusalNoFallbackMessage`（按类别路由拒绝语义细化）、`TerminalReason` 注释（去掉
budget/retry 那句）——纯文档，无接口影响。

> 小学生比喻：官方这两个补丁版没造新家具（零新符号），只是给几个已有的下拉菜单多加了几个选项
> （枚举成员）、给控制台加了「文件暂存」的旋钮。旋钮那类我们本来就不装（没那条线），
> 但下拉菜单的新选项我们该补上。

---

## 4. 对照测试实测结果

| 测试范围 | 结果 |
|---|---|
| conformance + compat 定向套件（8 文件） | **104 passed** |
| 全量 vitest（117 文件） | **2171 passed + 2 skipped** |
| 编译（`tsc`） | exit 0 |

（2 skip 为 `replay-backoff-process-exit` 云容器环境性跳过等，非本次相关。）

> 小学生比喻：把整台自焊机器所有功能按一遍开关，2171 个都亮绿灯——机器本身没坏，
> 这次体检唯一要补的是官方新印的那几个标签。

---

## 5. 待裁 / 后续（详见对话内提问）

1. **0.3.205 → 0.3.207 追不追**：本质是「`TerminalReason` +6 成员补齐 + COMPAT 台账为 staging/hook
   字段补 N/A 注脚」的小追赶批。历史上守密人对同类补丁漂移下过「追」的裁定（0.3.201→0.3.205）。
2. staging（`input_files`/`output_files`）与 hook 结构化输出字段：确认维持 N/A-by-design 即可，
   仅需台账留痕。

---

## 附：测法可复现步骤

```bash
# 1. 拉双版官方 tarball
npm pack @anthropic-ai/claude-agent-sdk@0.3.205
npm pack @anthropic-ai/claude-agent-sdk@0.3.207
# 2. 解包后用 TS 编译器 API 解析 sdk.d.ts 导出符号面并 comm 差分
#    （getExportsOfModule；见本次会话 scratchpad/surface.mjs）
# 3. 本 SDK 全量对照
cd projects/silver-core-sdk && npm install && npm run build && npx vitest run
```
