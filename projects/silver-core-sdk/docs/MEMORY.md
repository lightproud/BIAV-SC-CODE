# Memory system (BPT-EXTENSION `options.memory`)

Cross-session memory for agents: a `memory_20250818`-equivalent six-command
tool whose STORAGE is injected by the hosting application. The SDK defines the
contract, enforces the reference formats and the path-security boundary; where
the data lives is entirely the consumer's decision (a local directory, an
intranet share, a database — the SDK never knows).

Status: **M1 shipped in v0.46.0** (spec R1–R6) and **M2 shipped in v0.47.0**
(spec R7–R9). The GOVERNANCE layer on top — scope-routing mounts (S1),
incognito sessions (S2), the structured tool-call log (S3), claim
verification (S4) — shipped in **v0.48.0**; see `docs/MEMORY-GOVERNANCE.md`.
The full R-spec surface is implemented, and the R2 acceptance is
now CLOSED end to end: the conformance memory axis carries both the mock-wire
locks AND a field-level differential against a LIVE official-arm capture
(fixture `tests/conformance/official-memory-wire.json`, captured 2026-07-11 by
`tests/integration/capture-official-memory-wire.mjs` via the live-smoke
workflow — findings: the official SDK serializes the typed entry as exactly
`{type, name}` and byte-matches this SDK's native-mode entry; tools[] order is
caller-defined; anthropic-version parity holds). live-smoke phase 3 also
proved the native-mode assembly against the real API (model wrote through the
typed entry into the local store, memoryHealth writes=1).

M2 surface summary:
- **R7 write-timing** — `flushOnCompaction` (default on): when auto-compaction
  is about to fold, the engine first injects ONE memory-write opportunity as a
  user turn (docs-style "record un-saved progress now, then continue"); the
  fold happens on the following check, and a PreCompact hook deny suppresses
  both. `sessionEndUpdate` (default on): after a NORMAL end of input (never
  abort/error), a bounded progress-card round updates /memories/MEMORY.md; its
  assistant messages stream, its result is absorbed into session accounting so
  the task's own result stays the last one the consumer sees.
- **R8 governance** — `memory.limits` (defaults 65536 bytes/file, 64
  files/directory, 16000 view chars with a view_range pagination hint),
  enforced in the store engine and re-checked at the tool layer (view
  truncation + create size + create cards) so directly-implemented stores are
  covered too; `metrics.memoryHealth` reports operations / reads / writes /
  errors / bytesRead / bytesWritten / indexInjectionTokens per run. For the
  deep on-demand store scan (waterlines / rot / capacity / supersede chains
  / read-write ratio) see "Store health assessment" below.
- **R9 cards mode** — `schema: 'cards'` + `memory.cards` (defaults 500
  chars/card, 50 cards/file): every written file must be `## <title>` cards
  with 结论 / 依据 / 过期条件 fields (half- or full-width colons, multi-line
  values); invalid writes return a structured error restating the format so
  the model can retry.

Requirements provenance: the r1 spec (2026-07-11) is archived verbatim at the
bottom of this file. Implementation basis is exclusively the public Messages
API memory-tool documentation (six commands, reference return strings, error
formats, the auto-injected protocol prompt) plus the officially published SDK
helpers it links — clean-room discipline unchanged.

## Quick start

```ts
import { query } from 'silver-core-sdk';

for await (const m of query({
  prompt: 'Remember that customer Acme Corp prefers email follow-ups.',
  options: {
    memory: {},   // local store under <cwd>/.claude/memory/memories
  },
})) { /* ... */ }
```

With an injected store (the intranet/BPT shape):

```ts
query({ prompt, options: {
  memory: {
    store: new IntranetMemoryStore(userId, projectId), // implements MemoryStore
    indexInjection: { maxLines: 200 },
    instructions: 'Only record information relevant to this project.',
  },
}});
```

## The two assembly modes (spec R2)

One consuming surface, two wire shapes; the SDK picks by transport protocol
(`options.memory.mode` overrides):

| | mode `native` (default on Anthropic protocol) | mode `custom` (default on `openai-chat`) |
|---|---|---|
| tools[] entry | official `{ "type": "memory_20250818", "name": "memory" }` verbatim; no input_schema | SDK-defined `memory` tool with the six-command JSON schema |
| tool definition + protocol prompt | injected server-side by the API | definition advertised by the SDK; protocol prompt (docs-verbatim fragment) injected into the stable system tail |
| execution | the SDK builtin executes every `memory` tool_use | same builtin, same store |
| store artifacts | identical in both modes (R2 acceptance: tested byte-equal) | |

Forcing `mode: 'native'` on `provider.protocol: 'openai-chat'` throws
`ConfigurationError` — the typed entry is a Messages API concept.

Permissions: enabling memory implicitly allows the `memory` tool (official
parity — memory operations never permission-prompt; plan mode still denies
writes since the tool is not read-only). A bare `disallowedTools: ['memory']`
entry disables the whole system. Memory is main-loop-only in v1: subagents
never see the tool.

## Storage contract (spec R3)

Two implementation levels — prefer the first:

1. **`MemoryFileOps` primitives + `createMemoryStore()`** (recommended):
   implement six small storage primitives (`stat` / `list` / `read` / `write`
   / `delete` / `rename` over virtual `/memories/...` paths) and wrap them:

   ```ts
   import { createMemoryStore, type MemoryFileOps } from 'silver-core-sdk';
   const store = createMemoryStore(myOps /* MemoryFileOps */);
   ```

   All command semantics and the byte-exact reference return strings come from
   the SDK's semantics engine — format fidelity for free, in exactly one place.
   The built-in `createLocalFilesystemMemoryStore(baseDir)` is this same engine
   over node:fs (plus symlink-escape defense and 0600/0700 modes).

2. **Direct `MemoryStore` implementation**: the six command methods
   (`view` / `create` / `strReplace` / `insert` / `delete` / `rename`), each
   returning the reference result string or throwing an Error whose message is
   the reference error string.

Either way, validate with the publishable contract suite (R3 acceptance):

```ts
import { runMemoryStoreContractSuite } from 'silver-core-sdk';
const report = await runMemoryStoreContractSuite(() => makeFreshEmptyStore());
// report.passed === true  <=>  contract-compliant
```

### Concurrency semantics (contract, 2026-07-18)

The storage contract declares exactly two concurrency guarantees — no more:

1. **Single-command atomicity.** Every command applies entirely or not at
   all; a reader never observes a torn or partial write. The built-in
   backends satisfy this with whole-content writes (in-memory) and
   write-to-temp-then-rename (local filesystem).
2. **Last-write-wins.** Concurrent writers race without coordination: a lost
   update is an acceptable outcome, a byte-interleaved mix of two writes is
   not. The `old_str` precondition of `str_replace` is the contract's only
   optimistic guard — content that changed underneath a writer fails the
   replace with the reference not-found error instead of clobbering the
   newer content.

Version tokens, locks, and transactions are deliberately NOT part of the
contract (keeper ruling 2026-07-18: no new machinery). Both guarantees are
executable — the contract suite's two `concurrency:` checks
(`src/tools/memory/contract-suite.ts`) drive parallel writes and a stale
replace against any implementation.

## Store health assessment (keeper memo 2026-07-18 §2)

`assessMemoryStoreHealth(ops, options?)` deep-scans a memory tree over the
`MemoryFileOps` primitives and returns a `MemoryStoreAssessment` — the
trigger surface the black-pool dream mechanism (a scheduled tidy-up task)
gates on. Distinct from the per-run `metrics.memoryHealth` counters: this is
an async scan a host runs when it decides to, not something the engine
computes per result.

```ts
import { assessMemoryStoreHealth, createLocalMemoryFileOps } from 'silver-core-sdk';

const ops = createLocalMemoryFileOps('<baseDir>/memories');
const health = await assessMemoryStoreHealth(ops, {
  counters: lastResult.metrics?.memoryHealth,   // optional: stamps readWriteRatio
});
if (health.warnDirectories.length > 0 || !health.supersede.intact) {
  // dispatch the consolidation ("dream") session
}
```

The five dimensions, each honest about its limits:

- **Directory waterlines** — per-directory direct-file counts against the R8
  hard cap (64), with a soft early-warning line at 48
  (`softWaterline` option); `warnDirectories` lists offenders.
- **Rot (staleness)** — files unmodified for `staleAfterDays` (default 30),
  oldest-first. Requires backend mtimes: `MemoryEntryStat.mtimeMs` /
  `MemoryDirEntry.mtimeMs` are OPTIONAL fields the built-in local-fs backend
  populates; a backend without them gets `staleness.available: false` with a
  note — never a fabricated number.
- **Capacity headroom** — largest file vs the 64 KB cap, files over half the
  cap (consolidation candidates), fullest directory.
- **Supersede-chain integrity** — every `supersedes:` /`superseded_by:`
  frontmatter reference to a `/memories/...` path (the S6 prompt-driven
  convention) is checked; `broken` lists dangling targets.
- **Read/write ratio** — computed from the per-run counters when passed in
  (`reads / writes`, null without writes): a store that is only ever written
  and never read back is hoarding, not remembering.

Scans are bounded (`maxEntries`, default 4096); hitting the bound sets
`truncatedScan: true` instead of silently under-reporting.

## Reference formats (spec R1)

Golden-tested against the official docs (`tests/memory-golden.test.ts`);
highlights:

- `view` file: `Here's the content of {path} with line numbers:` + lines as
  6-character right-aligned numbers, tab separator; `view_range` paginates;
  \>999,999 lines returns the docs line-limit error. A malformed `view_range`
  (start < 1 or beyond the file, end < start, negative end other than -1) is
  rejected with a structured error instead of leaking JS negative-slice
  semantics; an end beyond the file clamps.
- `view` directory: the docs header, then `{size}\t{path}` lines, 2 levels
  deep, hidden items and `node_modules` excluded, directories with a trailing
  `/`, du-style sizes.
- `create`: `File created successfully at: {path}`; existing file returns
  `Error: File {path} already exists` (reference default) — set
  `createOverwrite: true` to overwrite instead (docs-sanctioned choice).
- `str_replace`: `The memory file has been edited.` + a numbered snippet
  spanning the replacement ±2 context lines; unique-occurrence enforcement
  with the docs' not-found / multiple-occurrence strings; omitted `new_str`
  deletes. Matching runs over the FULL content (multi-line `old_str` works;
  occurrences are counted, not lines — two hits on one line are rejected as
  multiple, each reported by the line its match starts on); empty `old_str`
  is rejected; `$&`-style replacement patterns in `new_str` are written
  literally.
- `insert` / `delete` / `rename`: docs strings verbatim, including root
  protection (`/memories` itself can never be deleted or renamed).

## Path security (spec R4 — release gate)

Every path in every command is validated at the SDK layer BEFORE the store is
called (stores are never trusted to defend themselves): `/memories` prefix
required, canonical resolve, `../` and `..\` rejected, URL-encoded variants
(`%2e%2e%2f`, nested encodings, `%5c`) decoded-then-rejected, NUL bytes
rejected. The attack corpus (23 variants) lives in
`tests/memory-paths.test.ts` and is part of the release gate. The local
filesystem store adds realpath/symlink containment as defense in depth;
injected stores must still not trust incoming paths (spec §8.6).

## Protocol prompt + resident index (spec R5 + R6)

- **R5 (custom mode only)**: the SDK injects the docs-verbatim protocol
  fragment (`MEMORY_PROTOCOL_FRAGMENT`, faithful reproduction) into the stable
  system tail; `options.memory.instructions` appends consumer guidance (in
  both modes). Native mode injects nothing — the API adds the protocol prompt
  server-side, and doubling it would skew behavior.
- **R6**: at session start the harness reads the head of
  `/memories/MEMORY.md` (through the store, so it works for any backend) and
  injects it as a labeled system part — default caps 200 lines / 25,600 bytes,
  first hit wins, truncation noted to the model. Missing file = zero
  injection, zero errors. `indexInjection: false` disables. Cache-breakpoint
  layout is unchanged: the injection lands inside the existing stable-tail
  breakpoint (see `appendSystemInjection`).

## Pitfall recording (SCS-REQ-002 Phase 0 / REQ-3.2)

Opt-in via `options.memory.pitfalls` (`true`, or `{ instructions }` to append
extra guidance). Injects the sdk-original `MEMORY_PITFALLS_FRAGMENT`: record
non-obvious failures under `/memories/pitfalls/` — one kebab-case file per
distinct pitfall with symptom / root cause / fix / avoidance — **technical
facts only** (the stripping rule: nothing evaluative about any person, no PII
beyond what the fix requires; mirrors the nightly-synthesis pipeline's rule).
Applies in BOTH assembly modes (it directs WHAT to record, layered on top of
the base protocol, so it never doubles the API-injected native prompt).
Forced off on incognito sessions (S2: memory is read-only there). This is the
zero-code-change quality ramp of the self-improvement loop
(`memory/active/self-improvement-requirements.md` Phase 0); its record
quality over ~2 weeks of runtime is the go/no-go signal for loop 3
(acceptance: >= 10 reviewable records in `memory/pitfalls/`).

## Module map

| Piece | Location |
|---|---|
| Six-command tool (zod validation + R4 gate) | `src/tools/memory/memory-tool.ts` |
| Path validator | `src/tools/memory/paths.ts` |
| Semantics/format engine + `MemoryFileOps` | `src/tools/memory/store.ts` |
| Local-filesystem store | `src/tools/memory/local-store.ts` |
| Contract test suite (publishable) | `src/tools/memory/contract-suite.ts` |
| Assembly runtime (mode/store/index resolution) | `src/tools/memory/index.ts` |
| `MemoryStore` / `MemoryOptions` types | `src/types.ts` (re-exported via contracts) |
| Protocol fragment | `src/engine/prompt-fragments.ts` |
| Server-tool passthrough | `EngineConfig.serverTools` + `engine/loop.ts` buildToolDefs |
| System injection seam | `src/engine/config-builder.ts` `appendSystemInjection` |
| Typed error | `MemoryToolError` (`src/errors.ts`, code `memory_tool_error`) |

---

# 附:实现需求说明书(r1 归档)

> 以下为 2026-07-11 派发的原始需求说明书 r1,逐字归档作需求溯源。M1(R1–R6)
> 已于 v0.46.0 落地;R7–R9 为 M2 待建;§8 为黑池侧搬运包内容,银芯不接收回流。

## 1. 问题陈述

BPT(60 人游戏团队的 AI 平台)缺乏可用的跨会话记忆:用户每次会话需重复交代项目背景与个人偏好,长任务被上下文重置打断后进度丢失。SDK 现有 sessions 模块只解决「原样回放」(录像带),不解决「蒸馏复用」(笔记本)。不解决的代价:重复输入直接加重痛点 2(输入 token 过高),任务连续性缺失压低平台留存。

## 2. 目标

- G1:SDK 提供与 Anthropic memory tool(`memory_20250818`)协议等价的记忆工具面,**双 transport 可用**(Anthropic 直通官方类型 / OpenAI 协议走自定义工具),一套接口。
- G2:存储完全客户端化——SDK 只定义契约,黑池注入实现,SDK 零感知存储介质(对齐黑池防火墙:记忆数据永不出内网)。
- G3:记忆质量下限由 harness 保障,不依赖模型自觉(结构化写入 + 钩子强制时机 + 索引常驻)。
- G4:可度量——上线后能用评测集与用量账单回答「记忆效果是否变好」。

## 3. 非目标

- N1:**不做**服务端/离线合成管线(三层架构中的第 1 层画像合成)。那是黑池侧的批处理任务,本 spec 仅在 §8 给消费建议;SDK 不新增任何后台进程。
- N2:**不做**向量检索/嵌入/知识图谱。已退役方向,重建需先有量化证据(见开放问题 Q3)。
- N3:**不做**团队共享记忆空间。v1 作用域固定为 用户×项目;跨用户共享涉及权限模型,推后。
- N4:**不做**记忆数据加密。存储在黑池手里,加密是存储实现方的责任,不进 SDK 契约。

## 4. 设计原则

1. **净室纪律延续**:实现依据仅限公开 Messages API 文档(memory tool 页给出了六命令、参考返回字符串、错误格式的完整规范),照抄公开规范不违反观测边界。
2. **drop-in 纪律**:所有新公开面标注 `BPT-EXTENSION`(先例:`provider.fetch`);官方 `@anthropic-ai/claude-agent-sdk` 未来若出对应面,以官方命名为准迁移,`docs/MIGRATION.md` 记录。
3. **零新依赖**:runtime 依赖维持 zod + fast-glob。
4. **模型定上限,harness 定下限**:凡依赖模型自觉的行为(选择、时机、整理),都提供 harness 强制的降级路径。

## 5. 需求

### P0 — 不可裁剪(M1,已落地 v0.46.0)

**R1 记忆工具面(六命令)**
`view / create / str_replace / insert / delete / rename`,参数与参考返回字符串严格对齐官方文档(行号 6 字符右对齐、目录列表两级深度带大小、既定错误字符串)。理由:模型按参考格式训练,格式跑偏 = 记忆行为退化。
- 验收:每命令的成功/错误返回逐字节比对文档参考格式(golden 测试);`view_range` 分页;`create` 对已存在路径按文档返回错误(覆盖式作为可配置项);`delete`/`rename` 拒绝作用于 `/memories` 根。

**R2 双模式工具装配**
- 模式 A(Anthropic transport):请求体声明官方 `{"type":"memory_20250818","name":"memory"}`,工具定义与协议提示由 API 服务端注入;SDK 侧只接执行回路。
- 模式 B(OpenAI transport / 任意自定义模型):SDK 自带等价 custom tool 定义(六命令 zod schema)+ 自拼协议提示(R4)。
- 装配点:transport factory 按协议自动选模式;`options.memory.mode` 可显式覆盖。
- 验收:同一段消费代码在两个 transport 下行为一致(存储侧产物 diff 为空);conformance 套件新增 memory 轴,模式 A 的请求体线缆差分对齐官方臂。

**R3 MemoryStore 存储契约(黑池注入点)**
`src/internal/contracts.ts` 新增 `MemoryStore` 接口:`view / create / strReplace / insert / delete / rename`,异步,路径以 `/memories` 为虚拟前缀。SDK 内置默认实现 `LocalFilesystemMemoryStore`(本地目录映射,供开发与单机场景);黑池经 `options.memory.store` 注入自己的实现(内网目录 / 数据库均可)。
- 验收:契约测试套件(store-agnostic)——任何实现通过同一组测试即合规;默认实现通过全套。

**R4 路径穿越防护(安全硬约束)**
每条命令的每个路径必须校验:前缀必须为 `/memories`;规范化(canonical resolve)后仍在记忆目录内;拒绝 `../`、`..\`、URL 编码变体(`%2e%2e%2f`)。校验在 SDK 层执行,**不信任 store 实现自行防护**。
- 验收:穿越攻击用例集(≥15 个变体,含编码/混合分隔符/符号链接)全部拒绝;此项测试列为发版门禁。

**R5 协议提示注入**
模式 B 下,经 `engine/prompt-fragments` 注入行为协议(等价官方自动注入内容):开工先 view 记忆目录、进展随时落盘、假设上下文随时重置。片段可由消费方追加(如「仅记录与 <主题> 相关的信息」)。
- 验收:片段参与缓存断点布局不破坏现有 4 断点结构;prompt-composition 测试覆盖。

**R6 索引常驻(读侧兜底)**
会话开始时,harness 自动读取 `/memories/MEMORY.md`(若存在)前 N 行(默认 200 行 / 25KB,取先到者)注入上下文;超限部分不加载,细节文件按需 view。对齐 Claude Code 的「小索引常驻 + 懒加载」模式。
- 验收:超限截断正确;MEMORY.md 不存在时零注入零报错;注入体积计入 token 账单(R8)。

### P1 — 高优先跟进(M2,未实现)

**R7 生命周期钩子联动(写侧时机强制)**
- PreCompact 联动:压缩触发前发起一轮记忆写入机会(「即将被摘要的关键信息落盘」),复用现有 PreCompact 钩子语义,可 deny。
- 会话收尾:`query` 正常终结路径上触发 SessionEnd 记忆更新回合(进度卡),可配置关闭。
- 验收:compaction 测试扩展;终结路径(含 abort/错误终结)各自行为明确——abort 不触发写入。

**R8 治理限额与可观测**
- 限额:单文件字节上限(默认 64KB)、目录文件数上限(默认 64)、`view` 返回截断(16,000 字符,提示用 `view_range` 分页)。超限返回明确错误字符串。
- 观测:memory 操作计入 query-accounting(次数、读写字节、注入索引 token 数);`metrics` 暴露 `memoryHealth` 计数器。
- 验收:限额均可配置;账单字段有单测。

**R9 结构化记忆卡模式(可选,降级自由写作)**
`options.memory.schema = 'cards'` 时,create/replace 写入内容须通过卡片 zod 校验:固定字段(`结论 / 依据 / 过期条件`)、单卡字数上限、卡数上限。面向写侧纪律弱的模型(国产模型场景)。
- 验收:非法卡片返回结构化错误(模型可据此重试);cards 模式与自由模式可逐项目切换。

### P2 — 架构预留,v1 不建

- 记忆目录离线整理任务的**接口预留**(导出/导入整个 store 的快照方法),供黑池夜间批处理(去重/合并/淘汰)对接。
- 多模型记忆评测 harness(对接 conformance 基建)。
- 共享记忆空间(团队级)。

## 6. 模块落位与工程纪律

| 事项 | 落位 |
|---|---|
| 工具实现(六命令 + 路径校验)| `src/tools/memory/`(C+D 族)|
| `MemoryStore` 契约 | `src/internal/contracts.ts`(实际落位:`src/types.ts` 公开类型面定义、contracts 转发,防类型环)|
| 默认文件系统实现 | `src/tools/memory/local-store.ts` |
| 协议提示片段 | `src/engine/prompt-fragments.ts` |
| 索引常驻注入 | `src/engine/`(runtime-context 邻位;实际落位 `config-builder.appendSystemInjection` + query 层调用)|
| 钩子联动 | `src/hooks/` + `src/engine/compaction.ts` 既有缝(M2)|
| import edges | `tools/memory` 走既有 `src/tools/` 边;engine 未读 store,未新增边 |

其余纪律照旧:TS strict ESM、命名导出、无 console、AbortSignal 全程贯通;**minor 版本 bump + CHANGELOG 一行**;COMPAT.md 新增 memory 条目(标注 BPT-EXTENSION 与官方对应关系);tests 目标 ≥60 新增用例(R4 攻击集单列)。

## 7. 验收标准(发版门禁)

- [x] 六命令 golden 格式测试全绿(R1)
- [x] 双 transport 行为一致性 diff 为空(R2)
- [x] store 契约测试套件可独立发布给黑池自测其实现(R3)
- [x] 路径穿越攻击集 100% 拒绝(R4,门禁)
- [x] 索引常驻截断与零注入路径正确(R6)
- [x] 全量 pytest/vitest 无回归;版本 bump 守卫绿

## 8. 黑池消费指南(搬运包)

> 按人工对话搬运协议交付;以下均为黑池内网侧动作,银芯不接收任何回流。

**8.1 存储实现**:实现 `MemoryStore`(建议:实现 `MemoryFileOps` 六原语 + `createMemoryStore()` 包装,参考格式白拿),映射到内网存储,作用域 键 = `用户ID × 项目ID`。建议纯目录方案起步(`\\内网存储\bpt-memory\<user>\<project>\`),先跑通再谈数据库。用 SDK 附带的契约测试套件(`runMemoryStoreContractSuite`)自测。

**8.2 配置样例**(M1 可用面;`schema` / `sessionEndUpdate` 为 M2):

```ts
query({ prompt, options: {
  memory: {
    store: new BptIntranetMemoryStore(userId, projectId),
    indexInjection: { maxLines: 200 },
    instructions: '仅记录与本项目相关的信息。',
  },
}})
```

**8.3 三层组合与优先级**(冲突时:人写 > 模型自写 > 离线合成;写进 BPT 系统提示):
1. 人写指令层:每项目一份指令文件,BPT 经 systemPrompt append 注入,今天就能上,与本 spec 无耦合。
2. 模型自写层:即本 spec,SDK 一个 minor 版本(v0.46.0)。
3. 离线合成层:黑池夜间批处理(可用便宜模型),读会话与记忆目录 → 覆盖式重写每用户画像卡(几百 token)→ 次日注入。**等 1、2 层跑一个月、有真实数据后再建。**

**8.4 token 预算硬上限**(防记忆层反噬痛点 2):指令层 2K / 索引常驻 1K / 画像卡 0.5K;超限即裁剪,预算数值上线后按账单校准。

**8.5 评测集**:上线前建 20 题跨会话回忆集(「上周约定的命名规范是什么」类),对候选模型 × cards 开关跑分;上线后每月回归。效果争议以评测分和 query-accounting 数据为准,不以体感为准。

**8.6 安全提醒**:路径校验虽在 SDK 层,黑池 store 实现仍不得信任传入路径(纵深防御);记忆文件含用户工作内容,按内部数据密级管理,不进任何外发渠道。

## 9. 开放问题

- Q1(守密人,阻塞):`memory` 工具名与官方保留名冲突策略——模式 B 下沿用 `memory` 名(利于模型习得迁移)还是改名避歧义?建议沿用。**M1 按建议沿用 `memory` 名实现;守密人若裁定改名,`MEMORY_TOOL_NAME` 单点可改。**
- Q2(黑池,非阻塞):用户×项目之外是否需要「用户全局」记忆空间(跨项目偏好)?v1 可用一个约定项目 ID 模拟,先观察。
- Q3(数据说话,非阻塞):grep 级检索何时不够?触发条件建议定为「评测集检索类题目得分 < 80% 且索引常驻已到预算上限」,届时再评估向量方案。

## 10. 里程碑

| 阶段 | 内容 | 规模 | 状态 |
|---|---|---|---|
| M1 | R1–R6(P0 全量)+ 契约测试套件 | 一个 minor 版本 | **已落地 v0.46.0** |
| M2 | R7–R9(P1)+ COMPAT/MIGRATION 文档 | 一个 minor 版本 | 待建 |
| M3 | 黑池接入 + 评测集首跑 + 预算校准 | 黑池侧,SDK 只修 bug | 待 M2 |
| M4 | 离线合成层立项评审(凭 M3 数据)| 另立 spec | 待 M3 |
