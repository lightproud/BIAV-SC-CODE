# bpt-agent-sdk 提示词装配层（Prompt-Assembly Layer）设计文档

> 状态：设计稿（DESIGN，未落地实现），已纳入三轮对抗式审查修订（见 §审查纪要）。守密人（制作人 Light）审批后进入构建。
> 定位：`projects/bpt-agent-sdk/`——银芯→黑池单向输出的工程产物（非使命线，与 §1.1-HC 防火墙同向）。
> 依据：守密人指令 B「运行时装配对官方保真」+ 上游语料库 553 片段全量勘测（applicable 272 / total 553）。
> 关键裁定悬置项：本设计给出**两条落地轨**（Track A 对账工具 / Track B 全套装配引擎），粒度由守密人经开放问题 Q1 裁定，见 §9/§10。§7 迁移计划的 Phase 0/0.5/1 为两轨共用，Phase 2+ 仅 Track B 走。

---

## 1. 背景与目标

### 1.1 为什么做这件事

bpt-agent-sdk 是官方 Claude Code / Claude Agent SDK 的干净重实现（clean-room reimplementation）。它的 agent-loop 要向模型发系统提示词。官方的系统提示词**不是一根字符串**——上游 README 明确写「Claude Code doesn't just have one single string」。它是一个**片段库（fragment store）**：553 个带 HTML 注释头的 markdown 文件，按 TYPE 前缀分组，坍缩到约 40 个不同的 LLM 调用点，每个调用点在运行时按会话模式 / 输出风格 / 模型档位 / 环境能力**选片段、定顺序、填变量、拼接**。

当前 bpt-agent-sdk 把这套东西压成了 `src/engine/prompts.ts` 里手写的 `defaultHarnessStableV1..V5` 五个单体函数（每个是内联字符串数组，源片段 slug 只以注释形式存在）。它**忠实但不可维护**：官方语料每周刷新一次（CI `refresh-claude-code-prompts.yml`），而这五个函数是人手抄的快照，天然漂移，且无法机器对账「我抄的这一句还等于上游那一句吗」。

小学生比喻：现在的做法是把一本活页参考书**整本手抄成一张大字报**——抄的时候是对的，但原书改一页，大字报不会自己跟着改，也没人能一眼看出大字报哪句和原书对不上了。本设计要做的是：把大字报拆回**活页 + 一张「我抄了哪些页、改了哪几个字、为什么略过某几页」的登记表**，让机器每周自动对账。

### 1.2 目标（理论目标 = 守密人指令 B 的兑现）

1. **SDK 内部持有 applicable 提示词语料** —— 把 272 个 applicable 片段（见 §6 勘定表）以结构化片段库形式纳入，每片段带可追溯的 provenance（源文件 + ccVersion + 改写标记）。
2. **确定性装配器（deterministic assembler）** —— 装配是纯函数：`assemble(ctx) -> { stable, volatile }`（reminder 面另有第三通道，见 §4.3），同输入必同字节输出（缓存命中的前提，见 §4/§8）。
3. **对官方保真、对漂移敏感** —— faithful 片段与上游逐字节可对账；`adapted` 片段以 dropClause 锚点 + 保留子串对账（见 §6.4/§8）；上游改动要么流过来、要么让 CI 红，绝不静默漂移。
4. **对本 SDK 诚实合法** —— 官方语料里所有引用「本 SDK 不发货的工具 / 能力」的片段（sandbox / Task / Workflow / plan-mode / 产品功能）必须以**可审计的方式**被略过，绝不向模型承诺一个不存在的工具或参数（红线，见 §6.4）。红线保证同时落在**构建期静态扫描**与**运行时 ctx 矩阵扫描**两层，不依赖单一 canonical ctx（此为本次修订的核心加固）。

### 1.3 非目标

- 不实现 sandbox、Task/subagent-spawn、plan-mode、产品功能面（teams / chrome / loop / cron / insights / cowork 等，见 §6.2 omit list）。
- 不改动缓存策略本身（`cache-control.ts` 的 `boundary:'first'` 语义保持）；本层只保证喂给它的 stable prefix 字节不变。
- 不引入运行时文件系统依赖：语料在**构建期**从归档生成、提交进仓，运行时零 IO 读语料。
- **不把嵌入方透传文本（`opt.append` / projectInstructions=CLAUDE.md/AGENTS.md / caller 的 segments 块）纳入红线信任边界**——这些是嵌入方责任，红线扫描只扫 SDK 自撰片段输出（见 §6.4 R12 与 §9「扫描边界」）。

---

## 2. 官方装配模型（证据基）

来自 553 文件全量勘测，四个可观测机制 + 一个引擎侧不可见项：

### 2.1 SELECTION（选片段）

- 语料按**文件名 slug** 索引，按 **TYPE 前缀**分组：`tool-description-*`(137) / `system-prompt-*`(130) / `data-*`(77) / `system-reminder-*`(76) / `agent-prompt-*`(64) / `skill-*`(63) / `tool-parameter-*`(6)。**七类前缀合计 553**（分组勘定与 include/omit 全量对账见 §6.4 勘定表）。
- 553 片段坍缩到 ~40 个 LLM 调用点。主交互 loop 拉 ~130 个 `system-prompt-*` + ~137 个 `tool-description-*`；subagent / classifier / summarizer / code-review / generator 各自选自己的小片段集；`system-reminder-*` 由**逐轮事件**触发注入消息流（非系统前缀，见 §4.3 面 5）。
- 选择 = **调用点身份 + 环境/配置门控**。例：Bash 单个工具就扇出 ~40 个子句（`bash-sandbox-*` / `bash-git-*` / `bash-alternative-*`），只在 sandbox/git 条件成立时选入；`*-compact` 变体由**模型档位**选；`webfetch-summarizer` 按 `IS_TRUSTED_DOMAIN` 分支；multi-agent 指引仅在 agent 数 > 1 时注入。

### 2.2 ORDERING（定顺序）

确定性拼接。由片段粒度推断，并由 SDK 自己 v4/v5 复现里逐行的源 slug 注释佐证：

```
identity intro
  -> doing-tasks-*（software-engineering-focus, no-unnecessary-additions,
                   no-compatibility-hacks, ambitious-tasks, security）
  -> tool-use discipline（prefer-dedicated-tools + 各 per-tool description 块）
  -> executing-actions-with-care
  -> communication style
  -> code-style
  -> volatile env tail（<env> 块）
```

顺序是**载重的**（load-bearing）：它决定字节、决定缓存键。

### 2.3 VARIABLE INTERPOLATION（填变量）

- 553 中约 200 个片段的 frontmatter 带 `variables:` 清单，枚举该片段消费的插槽；片段体带 `${VAR}` 占位。**注意**：frontmatter `variables:` 清单**只枚举 `${VAR}` 简单插槽，未必覆盖 `${FN()}` / `${FN()?A:B}` / `${OBJ.prop}` 三种复合形态**——这是 R6 fail-open 漏洞的根因，resolver 与测试必须扫全部四种句法而非仅 `variables:` 清单（见 §4.4 / §6.4 R6）。
- **主导变量类 = 工具名**（`AGENT_TOOL_NAME` 出现 33 次、`READ_TOOL_NAME` / `EDIT_TOOL_NAME` / `GREP_TOOL_NAME`…共约 20 个不同 `*_TOOL_NAME`）。这证明引擎**按活工具集参数化每个片段**，而非硬编码工具名。**但工具名的唯一解析源是发货工具注册表**（见 §4.4 不变式），`${*_TOOL_NAME}` 若解析到发货集之外的名字（如 `AGENT_TOOL_NAME`→`Agent`）必须整片段被 omit 或整句被 dropClause 删除，绝不允许经 varRebind 把非发货工具名注回（红线，见 §4.5/§6.4 R1'）。
- 其他变量：运行时事实（`CURRENT_MONTH_YEAR` / `PLAN_FILE_PATH` / `PR_NUMBER`）与配置开关（`IS_ARTIFACT_TOOL_ENABLED` / `OUTPUT_STYLE_CONFIG`）。

### 2.4 CONDITIONALS（条件）

两级：

- **粗（whole-fragment presence）**：整片段是否在场，键于配置布尔 + 模型档位（sandbox on/off、trusted-domain、artifact-enabled、compact vs full）。
- **细（variable branch）**：一个变量解析为值 **或** 空/替代分支。四种句法：
  - 三元 `${FN()?A:B}`（如 `${CAN_READ_PDF_FILES_FN()?' Reads PDFs...':""}`、`${IS_BASH_ENV_FN()?bashcmd:pwshcmd}`）
  - 函数插值 `${FN()}`（如 `${ADDITIONAL_INFO_FN()}`、`${MAX_TIMEOUT_MS_FN()}`，解析为字符串可空）
  - 对象属性 `${OBJ.prop}`（如 `${EXIT_PLAN_MODE_TOOL.name}`、`${ATTACHMENT_OBJECT.filename}`）
  - 大块拼接 `${*_BLOCK}`（如 `${REUSE_FINDER_ANGLE_BLOCK}`、`${DIFF_GATHERING_PHASE}`，本身是可复用子模板）
- **红线相关的静态展开约束**：构建期扫描时，每个 `${FN()?A:B}` 三元的 **A、B 两支都要展开进扫描**、每个 `${OBJ.prop}` / `${FN()}` 都要以「有值 / 无值」两态展开进扫描——因为一个被禁工具引用可能只活在某一分支里（如 `${EXIT_PLAN_MODE_TOOL.name}` 仅当 plan-mode on 才现形）。仅扫某一 canonical ctx 会漏掉门控分支里的引用（见 §6.4 静态扫描规范）。

### 2.5 归档看不见的那一层

条件**名字**可见（`IS_TRUSTED_DOMAIN`、`HAS_SUBAGENT_TYPE`），但**做分支决策的引擎代码是引擎侧的**，归档里没有。所以官方模型可归纳为：

> 片段库（slug + type + variables） → 每调用点的有序选择列表 → 配置/模型/环境门控 → `${VAR}` 从活上下文对象插值 → 拼接成 stable prefix + volatile tail（tools → system → messages 缓存层级）；system-reminder 另经逐轮事件注入消息流。且 `ccVersion` **逐片段**打版本，语料是 per-fragment versioned，不是 per-prompt。

本设计的核心增值：**把归档隐藏的那层 resolver 引擎显式化、可测试化**——但增值是否值回四层机器成本，取决于第二个真实装配面是否兑现，是 §9/§10 的核心取舍。

---

## 3. 现状与缺口

### 3.1 SDK 今天实际发出什么

> **勘测方法学修订**：本表的「面 / 位置」列曾为人手清单，已知存在陈旧路径（如误记 `src/tools/agent-tool.ts`，实际在 `src/subagents/agent-tool.ts`；`askuserquestion.ts` 为独立工具文件面，此前漏列）。**构建期必须以 `ls src/tools/*.ts src/subagents/*.ts` + 对内联 `description` / `inputSchema.description` 串的 grep 重新生成面清单**（`scripts/build-prompt-fragments.mjs` 的第一步产物之一），不得以本表手抄清单为准。下表为设计期快照，权威以脚本产出的面清单为准。

| 面（surface） | 位置 | 形态 | 说明 |
|---|---|---|---|
| `minimalStable()` | `prompts.ts:124` | 硬编码字符串 | 无 preset 默认，两行 `\n` join |
| `defaultHarnessStableV1..V4` | `prompts.ts:132/161/202/251` | 片段化（opt-in） | 逐版加厚，v4 逐句带源 slug 注释 |
| **`defaultHarnessStableV5`（默认）** | `prompts.ts:319` | 片段化 | undefined variant → v5；~40 子句忠实复现；`toolNames` 动态插值；**字节长度载重**（被有意撑过 Haiku 缓存阈值）。**注意：已知 R1 违例**：`prompts.ts:366` 含 `Use the Agent tool with specialized agents...`、v3:227 含 `(via the Agent tool)`，而 Agent 工具不在发货集——此为 Phase 0.5 必先处置的碰撞（见 §7）|
| `environmentBlock` `<env>` | `prompts.ts:89` | runtime-io | 模板壳硬编码、字段值来自 `gatherEnvironment()`；在 volatile tail（不缓存）|
| `volatileTail` 路径指引行 | `prompts.ts:113` | 硬编码 | preset 路径的相对路径说明 |
| projectInstructions 包装 | `prompts.ts:454` | runtime-io | `<system-reminder>...CLAUDE.md/AGENTS.md...` 包住 `loadProjectInstructions()` 内容；进 **stable prefix**（per-project 可缓存）；**属嵌入方透传，红线不扫**（§6.4 R12）|
| 10 个 canonical 工具描述 | `descriptions.ts:23` | 硬编码 const | BASH/READ/EDIT/WRITE/GREP/GLOB/TODOWRITE/WEBFETCH/WEBSEARCH/ASKUSERQUESTION；按引用 import 进各工具，`.toBe` 断言 |
| 离册工具描述 | `src/tools/resources.ts` / `src/tools/shells.ts` / `src/tools/toolsearch.ts` / `src/subagents/agent-tool.ts` | 硬编码 | ListMcpResources/ReadMcpResource、BashOutput/KillShell、ToolSearch、Agent 工具——**不在 descriptions.ts、不被红线禁词测试覆盖**（R1 补漏，见 §6.4）|
| 逐参数 inputSchema 描述 | `src/tools/*.ts` | 硬编码 | 每工具 JSON-schema property 描述散落于工具文件；**其归档对应为 `tool-parameter-*`（6 片段），映射关系见 §6.4 勘定表脚注** |
| `GENERAL_PURPOSE_PROMPT` | `subagents/agents.ts:42` | 硬编码 | clean-room（非复现）fallback subagent 系统提示 |
| `buildStructuredOutputInstruction` | `structured-output.ts:73` | 硬编码 | 双放置：string/preset 路径进 stable（`query.ts:566`）；segments 路径作尾部**未缓存**块（`query.ts:535`）|
| compaction summarizer | `compaction.ts:70` | 硬编码 | 独立 summarization 调用的系统提示 |
| `opt.append` 透传 | `prompts.ts:460` | runtime-io | caller 文本 `\n\n` 拼进 stable，放置固定；**属嵌入方透传，红线不扫**（§6.4 R12）|
| segments-form 系统块 | `query.ts:514` | runtime-io | host 分层路径，caller 组 `{text,cache}` 有序块，逐字转发、最多 3 个缓存断点；**绕过 buildSystemPromptParts**，一条已存在的平行装配缝。**其与本层 assembler 的关系见 §4.6；caller 提供的块属透传、红线不扫（§6.4 R12）**|
| **逐轮 system-reminder** | **（今日缺）** | **无** | 官方有 todo-state nudge / 恶意代码警告 / plan-mode 提醒 / 文件新鲜度·空文件提示，作为逐轮注入面。本设计新增第五面 `assembleReminders`（§4.3 面 5）承接，否则 §6.1 摄入的 55 个 reminder 片段无处发出 |

### 3.2 缺口（今天没有、本层要补或明确记为空）

- **无逐轮 system-reminder**：loop 只跟踪 perTurn 指标，不注入动态逐轮提醒。唯一发出的 `<system-reminder>` 是 projectInstructions 那一次性包装。**本设计新增第五面消化之**（若守密人裁定不做，则 55 个 reminder 片段须整组移入 §6.2 omit 并各带 `omittedWhy`，绝不摄入却悬空——见 §6.4 死库存守卫）。
- **无 classifier/generator 提示**：无 topic 分类器、会话标题生成、commit message 生成、下一步建议（pending task #15「G6 分类器/生成器提示词再现」）。唯一 generator 形态是 compaction summarizer。
- **无具名 subagent 系统提示**：只发 `GENERAL_PURPOSE_PROMPT`；其余 persona 全靠 caller 经 `options.agents` 传入。无角色提示库。
- **无 slash-command / skill 提示面**（这些在 host 仓 `.claude/`，不在 SDK）。
- **无 plan-mode / ExitPlanMode 提示、无 output-style/persona 层**（descriptions 测试显式禁 ExitPlanMode）。
- **CLAUDE.md 与 AGENTS.md 无差异化框定**：两者合并进同一条泛化 system-reminder，措辞相同。
- **无工具结果/观测后处理提醒面**：truncation / 空文件提示在各工具 `execute()` 里作结果载荷处理，不是可复用提示面（reminder 面上线后可择项迁入，见 §4.3 面 5）。

---

## 4. 目标架构 —— 五层模型

> **注**：草稿称「四层」，本次修订新增 reminder 面后，装配面从四增至五（mainLoop / toolDescription / subagent / generator / **reminder**）；「层」仍指 (a)–(d) 四个关注点。为避免混淆，下文「四关注点 + 五装配面」。

四个关注点，官方模型把它们分开，本设计也分开，但把归档隐藏的 resolver 引擎显式化：

- **(a) Fragment Store**：顺序无关的片段本体 + 元数据（provenance）。
- **(b) 每面 Assemblers**：顺序（载重）关在每面一份可读的 slug 列表里；**含 reminder 面的事件门控列表**。
- **(c) Variable + Conditional Resolution**：门控 + 插值收进单一 resolver（fail-loud 覆盖全部四种占位句法）。
- **(d) Adaptation/Omit Policy**：改写/略过声明进单一可审计 manifest。

### 4.1 数据流图（ASCII）

```
 构建期（build-time, 提交产物，运行时零 IO）
 ┌─────────────────────────────────────────────────────────────────────┐
 │  Public-Info-Pool/Reference/Claude-Code-System-Prompts/system-prompts/│
 │                    *.md  (Piebald 归档, CI 每周刷新)                    │
 │        每文件: HTML 注释 frontmatter + body(含 ${VAR}) │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │  scripts/build-prompt-fragments.mjs
                             │  (纯函数: 归档 + manifest + 面清单(ls 生成))
        ┌────────────────────┴───────────────────┐
        │  scripts/prompt-adaptation.json         │  <- 唯一改写/略过账本(人手, checked-in)
        │  { slug: {action, adaptation, varRebind,│
        │           omittedWhy, dropClauses} }    │
        └────────────────────┬───────────────────┘
                             ▼
   ┌──────────────────────────────────────────┐   ┌──────────────────────────────┐
   │ src/engine/prompt-fragments.generated.ts │   │ Public-Info-Pool/Resource/    │
   │  (a) FRAGMENT STORE (frozen, typed)      │   │ repo-engineering/             │
   │  slug -> {type,body,variables,source,    │   │ prompt-fragment-provenance-   │
   │           adaptation,omittedWhy?}        │   │ <date>.md  (归属+审计+勘定对账) │
   └─────────────────┬────────────────────────┘   └──────────────────────────────┘
                     │  + 构建期红线静态扫描(全 include 片段, 双分支展开)
                     │  + 勘定对账(include+omit == 553, 按 TYPE)
                     │  + 死库存守卫(每 include 片段被某面引用)
 运行时（run-time）
   PromptContext ctx  (toolNames, cwd, date, model, config flags, git, turnEvent ...)
        │
        ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ (b) 五装配面   assembler(ctx) -> {stable, volatile}(前四面)        │
   │                assembleReminders(ctx, turnEvent) -> Reminder[](面5)│
   │   mainLoop = [ intro, ...doingTasks, toolDiscipline(ctx.tools),   │
   │               executingActions, communication, codeStyle ]        │
   │   (有序 slug 列表 = 顺序的唯一真相源)                              │
   └─────────────────┬────────────────────────────────────────────────┘
                     │  对每个 slug 调用
                     ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ (c) resolve(fragment, ctx) -> string | ''                        │
   │   1. gate 门控(config bool + model tier + IS_TRUSTED_DOMAIN 式旗标)│
   │      -> gated off 则返回 ''                                        │
   │   2. 插值 4 句法: ${VAR}/${FN()}/${FN()?A:B}/${OBJ.prop}/{{MODEL}}│
   │      工具名一律 <- ctx.toolNames (发货注册表, 唯一源)             │
   │   3. 未解析 或 解析到 undefined/非发货工具名 -> 抛错(fail-loud)   │
   └─────────────────┬────────────────────────────────────────────────┘
                     ▼
        stable prefix (缓存)  +  volatile tail (<env>, 不缓存)
        reminder blocks -> 注入消息流(非 stable/volatile, 逐轮定位)
                     │
                     ▼   喂给现有 cache-control.ts (boundary:'first' 不变)
              发往模型  (+ 运行时红线扫描: 遍历 ctx 笛卡尔积)
```

### 4.2 (a) Fragment Store —— schema

生成的 TS 模块 `src/engine/prompt-fragments.generated.ts`，导出一个 frozen record，按 slug 索引。分组镜像归档 TYPE 前缀，便于 reviewer 按 slug diff store-vs-archive。

```ts
// src/engine/prompt-fragments.generated.ts  (GENERATED — 勿手改)

export type FragmentType =
  | 'system'      // system-prompt-*
  | 'tool-desc'   // tool-description-*
  | 'tool-param'  // tool-parameter-* (逐参数 inputSchema 描述, 见 §6.4 脚注)
  | 'reminder'    // system-reminder-*  (逐轮注入面, §4.3 面5)
  | 'agent'       // agent-prompt-*
  | 'generator';  // 内部 one-shot 生成器/分类器 (agentMetadata.model 载头)

export type Adaptation =
  | 'faithful'    // body 逐字节 == 归档 (仅变量重绑, 见 varRebind)
  | 'adapted'     // body 相对归档有记录在案的删改 (dropClauses 锚点显式)
  | 'original';   // SDK 自撰组合 (v1..v3、GENERAL_PURPOSE_PROMPT、generator 自撰面)

export interface FragmentSource {
  readonly archiveFile: string | null; // 归档相对路径, 'original' 时为 null
  readonly ccVersion: string | null;   // frontmatter ccVersion, per-fragment 版本; 'original' 时 null
}

/** 内部生成器/分类器载头 (6 文件带), 用于把该片段路由到廉价模型 */
export interface AgentMetadata {
  readonly agentType: string;
  readonly model: 'haiku' | 'inherit' | string;
  readonly permissionMode: 'dontAsk' | string;
}

export interface Fragment {
  readonly slug: string;
  readonly type: FragmentType;
  readonly body: string;                 // 保留 ${VAR} 占位, 不在构建期解析
  readonly variables: readonly string[]; // frontmatter 声明的插槽(仅 ${VAR}); ${FN()}/${OBJ.prop} 未必在此
  readonly source: FragmentSource | null;
  readonly adaptation: Adaptation;
  readonly agentMetadata?: AgentMetadata;
  readonly dropClauses?: readonly string[]; // adapted 时: 删除锚点, 供 §8 post-condition 测试
  readonly omittedWhy?: string;          // action:'omit' 时记录, 仅入 provenance 报告
}

export const FRAGMENTS: Readonly<Record<string, Fragment>>;
```

设计取舍：`variables` 直接当**依赖清单（dependency manifest）**，但**它只枚举 `${VAR}` 简单插槽，不足以覆盖占位可解析性检验**——检验必须扫 body 内实际出现的全部四种占位句法（见 §4.4 / §8 test c'）。`agentMetadata` 让生成器面（§4.3 面 4）能声明目标模型（haiku）+ 权限模式，SDK 据此把该片段的推理路由到廉价模型——**但这条路由信息必须能被装配输出结构携带出来**，故 generator 面的返回类型扩展了 `routing` 字段（见 §4.3 面 4）。

**关于 mainLoop 的 adaptation 分布（重要修订）**：诚实讲，v5 的 ~40 子句多为**跨多个归档片段手工合并 + reflow** 的产物（如 tool-use-discipline 段、dedicated-tools-over-bash 清单相对任一单一归档片段都是改写；Agent 子句须整删）。因此 **mainLoop 绝大多数子句会归类 `adapted` 而非 `faithful`**。逐字节强对账（§8 test b）只覆盖 `faithful`；`adapted` 子句由 §8 的 dropClause 锚点 + 保留子串断言提供对账（上游改动 kept 部分仍能让 CI 红）。草稿隐含的「mainLoop 大面积 faithful」不成立，本设计不再宣称。

### 4.3 (b) 五装配面 —— API 签名

前四面：纯函数 `assembler(ctx) -> { stable, volatile }`（generator 面额外返回 `routing`）。第五面 reminder 因逐轮、事件触发、注入消息流而**签名不同**。顺序（归档证明的载重物）被隔离在每面一份可读列表里。

```ts
export interface AssembledPrompt {
  readonly stable: string;    // 可缓存前缀
  readonly volatile: string;  // <env> 尾, 不缓存
}

export type Assembler = (ctx: PromptContext) => AssembledPrompt;

// 面 1: 主 agent-loop 系统提示 (替代 v5)
export const assembleMainLoop: Assembler;
//   mainLoop 有序列表 (slug):
//   [ intro,
//     doingTasks.softwareEngineeringFocus, doingTasks.noUnnecessaryAdditions,
//     doingTasks.noCompatibilityHacks, doingTasks.ambitiousTasks, doingTasks.security,
//     toolDiscipline.preferDedicatedTools,   // 消费 ctx.toolNames
//     ...perToolDescriptions(ctx.tools),     // tool-desc 片段, 按活工具集
//     executingActionsWithCare,
//     communication,                         // IS_TEXT_OUTPUT_VISIBLE_TO_USER 分支
//     codeStyle ]
//   注: Agent-tool 子句在 Phase 0.5 已从 v5 基线剔除(见 §7), 故本列表无 Agent 引用
//   stable = resolve 后各段 join；volatile = environmentBlock(ctx) + pathGuidance

// 面 2: 工具描述装配 (10 canonical + 离册 4 面, 见 §3.1 及 ls 生成的面清单)
export function assembleToolDescription(
  toolId: ToolId, ctx: PromptContext
): string;   // 返回单工具描述 (含逐参数 tool-param 片段的组装, 见迁移 §7 P3)

// 面 3: subagent 系统提示 (当前仅 general-purpose; 保留 original)
export interface SubagentAssembler {
  fresh(ctx: PromptContext): AssembledPrompt;  // HAS_SUBAGENT_TYPE=false 分支
  fork(ctx: PromptContext):  AssembledPrompt;  // 继承上下文分支
}
export const assembleSubagent: SubagentAssembler;
//   注: Task/Agent 派生工具本 SDK 不发货; 本面仅托管 SDK 自有 subagent 引擎
//   (runtime.ts) 用的系统提示, 不引入官方 subagent-spawn 语义。

// 面 4: 内部生成器/分类器 (compaction 已有; title/branch/commit-prefix 待补)
//   返回类型扩展 routing, 让 loop 的模型选择器能落实 haiku 路由 (修订)
export interface GeneratorPrompt extends AssembledPrompt {
  readonly routing: { model: 'haiku' | 'inherit' | string; permissionMode: string };
}
export interface GeneratorAssembler {
  compactionSummary(ctx: PromptContext): GeneratorPrompt; // 已存在, 迁入
  // 下列为 §7 P4 扩展, 各自 routing.model='haiku':
  sessionTitle?(ctx: PromptContext): GeneratorPrompt;
  branchName?(ctx: PromptContext):   GeneratorPrompt;
  commitPrefix?(ctx: PromptContext): GeneratorPrompt;
}
export const assembleGenerator: GeneratorAssembler;
//   loop 消费: model 选择器读 GeneratorPrompt.routing.model, 决定该 one-shot 调用打哪个模型;
//   embedder 若 pin 单模型, 可经 ctx.flags['ALLOW_MODEL_ROUTING']=false 覆盖为 inherit
//   (与开放问题 Q5 联动)。

// 面 5: 逐轮 system-reminder (新增, 承接 §6.1 的 55 个 reminder 片段)
//   与前四面签名不同: 逐轮、事件门控、注入消息流 (非 stable/volatile)。
export interface Reminder {
  readonly slug: string;       // provenance
  readonly text: string;       // 已 resolve 的 <system-reminder> 块
}
export function assembleReminders(
  ctx: PromptContext, turnEvent: TurnEvent
): readonly Reminder[];   // 有序 slug 列表 + 事件门控谓词; 空数组 = 本轮无提醒
//   reminder 有序 slug 列表(事件门控):
//   [ todoStateNudge   when turnEvent.todoChangedSinceLastTurn,
//     fileStalenessHint when turnEvent.staleFiles.length>0,
//     emptyFileHint     when turnEvent.emptyFileRead,
//     maliciousCodeWarn when turnEvent.maliciousCodeFlag ]
//   注: plan-mode reminder 属 omit(§6.2), 不入此列表。
//   注入点: loop 在组装本轮 user/tool-result 消息后, 追加这些块到消息流尾;
//   不进 stable prefix(不参与缓存键), 故逐轮变化不破缓存。

// 结构化输出 & append & projectInstructions: 不是独立面, 是 mainLoop stable
// 拼接的固定尾段 (放置字节敏感, 见 §7 P1 / migration_risk); 且属嵌入方透传/结构化载荷,
// 红线扫描按 §6.4 R12 处理其信任边界。
```

设计要点：**ordering 只活在这些 slug 列表里**，谁都不用去读装配代码就能审「主 loop / 每轮 reminder 到底按什么顺序拼」。这直接对应 migration_risk 里「prompts.test.ts pin 了各变体的精确子串顺序」——把顺序集中成一份数据，测试断言就锚在这一份上。

### 4.4 (c) Variable + Conditional Resolution

单一 `resolve(fragment, ctx)`，三步、fail-loud，**覆盖全部四种占位句法**：

```ts
export interface PromptContext {
  // 工具名注册表: 逻辑 tool id -> 运行时展示名 (支持改名/别名/MCP 命名空间)
  // 这是工具名的【唯一】解析源 (见下不变式); 发货集之外的名字一律不可解析。
  readonly toolNames: Readonly<Record<ToolId, string>>;
  // 运行时事实
  readonly cwd: string;
  readonly date: Date;              // -> CURRENT_MONTH_YEAR
  readonly model: { id: string; tier: 'full' | 'compact' };
  readonly scratchpadDir: string;  // -> SCRATCHPAD_DIR_FN
  readonly git?: { repo: string; defaultBranch: string; isRepo: boolean };
  // 配置旗标 (feature flags = 粗门控 + 细分支谓词)
  readonly flags: Readonly<Record<string, boolean>>; // IS_TRUSTED_DOMAIN, CAN_READ_PDF_FILES...
  // 字符串 provider (细分支的文本分支)
  readonly providers: Readonly<Record<string, () => string>>; // ADDITIONAL_INFO_FN...
  // 数值/上下文对象 (${OBJ.prop} 查找)
  readonly bag: Readonly<Record<string, unknown>>;
  // 逐轮事件状态 (reminder 面 §4.3 面5 消费; 前四面忽略)
  // 注意：本字段组为 provisional: 具体形状待 reminder 面 (§7 Phase R) 落地时定稿。
  readonly turnEvent?: TurnEvent;
  // 附加 (opt.append / projectInstructions / structuredOutput) 固定尾段载荷 (嵌入方透传)
  readonly append?: string;
  readonly projectInstructions?: string;
  readonly structuredOutputSchema?: unknown;
}

export interface TurnEvent {  // provisional, 见上
  readonly todoChangedSinceLastTurn: boolean;
  readonly staleFiles: readonly string[];  // 读后被改、复读前的文件
  readonly emptyFileRead: boolean;
  readonly maliciousCodeFlag: boolean;
}

export function resolve(fragment: Fragment, ctx: PromptContext): string;
// 1) GATE: 评估该片段的 gate 谓词 (config bool + model tier + trusted-domain 式旗标)
//    -> 门控关闭返回 '' (整片段缺席 = 官方粗条件)
// 2) INTERPOLATE (四句法全覆盖):
//    - ${*_TOOL_NAME}  <- ctx.toolNames[toolId]  唯一源; 查无 -> throw(见不变式)
//    - ${FN()} / ${FN()?A:B}  <- ctx.flags / ctx.providers (细条件)
//    - ${OBJ.prop}  <- ctx.bag 点查
//    - {{MODEL_*}}  <- ctx.model 身份替换 (仅身份片段)
//    - 模型档位 (compact vs full) 在此选变体 slug
// 3) ASSERT (fail-loud, 全句法):
//    a) body 内仍残留 ${...} 或 {{...}} -> throw
//    b) 任一 ${OBJ.prop} / ${FN()} 解析为 undefined -> throw (不得静默塌成 '' 或 'undefined')
//       ← 关闭 R6 fail-open 漏洞: 未提供的对象属性/函数不得静默出空
//    c) 任一 ${*_TOOL_NAME} 解析出的值 ∉ 发货工具注册表 -> throw
//       ← 关闭 varRebind 注入漏洞: 工具名只能是发货集成员
```

**关键不变式（修订加固）**：

1. **工具名唯一源 = 发货注册表**：所有 `${*_TOOL_NAME}` 一律从 `ctx.toolNames` 解析，`ctx.toolNames` 只含发货工具。任何 `*_TOOL_NAME` 若解析出发货集之外的名字（如 `AGENT_TOOL_NAME`），resolver **hard-fail**——这意味着该片段要么整片 omit、要么该子句被 dropClause 删除，绝无「解析成 `Agent` 却蒙混过关」的路径。这直接接住 migration_risk「`Available tools: <keys>.` 从 live registry 建」：resolver 从真 registry 取名，绝不硬编码工具列表。
2. **`variables:` 清单不是可解析性检验的全集**：官方 frontmatter `variables:` 只枚举 `${VAR}` 简单插槽。可解析性检验（§8 test c'）必须从 body **正则抽取实际出现的全部四种占位**逐一验证，而非只验 `variables:` 清单——否则 `${EXIT_PLAN_MODE_TOOL.name}` 之类对象属性占位会绕过检验、在 bag 缺键时静默塌陷（R6 修订）。
3. **档位简化钩子**：若守密人裁定 SDK 不支持 compact 档位（开放问题 Q6），`ctx.model.tier` 恒 `full`，所有 `*-compact` 变体在 manifest 直接 omit，resolver 的档位分支塌成常量。

### 4.5 (d) Adaptation/Omit Policy —— 单一可审计 manifest

改写与略过是**声明式数据**，唯一账本 `scripts/prompt-adaptation.json`（人手、checked-in）。生成脚本对归档做纯函数变换时查此表。生成产物**永不手改**。

```ts
// scripts/prompt-adaptation.json 的类型
export interface AdaptationEntry {
  action: 'include' | 'omit';
  adaptation?: 'faithful' | 'adapted';        // include 时必填
  omittedWhy?: string;                         // omit 时必填 (进 provenance 报告)
  varRebind?: Record<string, string>;          // e.g. {"CURRENT_MONTH_YEAR":"..."} — 见下约束
  dropClauses?: string[];                       // adapted 时: 删掉的子句锚点 (审计可见 + §8 post-condition 测试)
}
export type AdaptationManifest = Record<string /*slug*/, AdaptationEntry>;
```

**varRebind 约束（修订，关闭注入面）**：`varRebind` **禁止把任何 `*_TOOL_NAME` 键映射到字面工具名**——工具名的唯一解析源是发货注册表（§4.4 不变式 1）。manifest 校验器断言：varRebind 的键若匹配 `*_TOOL_NAME`，其值必须是发货工具注册表成员（否则 fail-build）；更严格地，推荐 varRebind 完全不承载工具名（工具名走 ctx），只承载非工具的运行时事实重绑。这挡住 `{"TASK_TOOL_NAME":"Task"}` 这类「解析干净、无残留占位、却注入了不存在工具名」的坑（§6.4 R1'）。

**默认略过（fail-loud）**：归档里任何**不在 manifest 的 slug**，默认 `action:'omit'` + `omittedWhy:'unreviewed'`。于是上游新增片段会被**浮现**（构建报告标红、勘定对账缺口报错），而不是静默拉进 loop。每一个 `include` 都是一次显式、被 review 过的决定。这条是整个保真机制的支点。

小学生比喻：manifest 是一张「准入白名单 + 每人为什么改造/为什么不放行」的门卫登记簿。归档里来了张生面孔（上游新片段），门卫默认不放行、还大声喊一嗓子（构建报告），等你登记签字才让进——绝不会有人溜进来你却不知道。而工具名这一栏，门卫只认「今天真上班的员工名册（发货注册表）」，谁想在登记簿上手写一个查无此人的名字（varRebind 注 `Task`），门卫当场拉警报。

### 4.6 装配面与 segments-form 平行缝的关系（修订新增）

`query.ts:514` 的 segments-form 是一条**已存在的、由嵌入方驱动**的平行装配路径：host/caller 提供有序 `{text, cache}` 块、最多 3 个缓存断点，逐字转发、绕过 `buildSystemPromptParts`。本层裁定其与五装配面的关系为**共存（coexist），非取代**：

- **五装配面产出的是「SDK 自撰系统前缀」**，走 `buildSystemPromptParts` → cache-control。segments-form 产出的是「嵌入方自组的块序列」，走另一条路。二者在最终 system 字符串里前后拼接。
- **红线信任边界**：五装配面输出在红线扫描内（§6.4 R1/R12）；segments-form 的 caller 块与 `opt.append` / projectInstructions 一样属**嵌入方透传，在红线信任边界之外**——嵌入方若在自己的 segment 里写 `Task`，那是嵌入方的责任，SDK 不为其背书也不扫（否则合法的 CLAUDE.md 提到 `Task` 会触发误报 DoS）。此边界必须**显式声明**而非隐含（§6.4 R12）。
- **结构化输出双放置**（string/preset 进 stable 缓存、segments 进未缓存尾）由 §7 Phase 4 单列测试守（§9 双放置复杂度）。

---

## 5. build-from-archive —— 生成脚本

`scripts/build-prompt-fragments.mjs`（TS/Node，构建期；**产物提交进仓**，运行时零文件系统依赖，SDK 保持纯库）。

- **INPUT**：`Public-Info-Pool/Reference/Claude-Code-System-Prompts/system-prompts/*.md`（CI 刷新的 Piebald 归档）+ `scripts/prompt-adaptation.json`（唯一改写/略过账本）+ **`ls src/tools/*.ts src/subagents/*.ts` 生成的面清单**（用于 §6.4 勘定对账与红线覆盖，取代手抄清单）。
- **TRANSFORM（逐 .md）**：
  1. 解析 HTML 注释 frontmatter → `{ name, description, ccVersion, variables[], agentMetadata? }`。
  2. 取 body **逐字节**，保留 `${VAR}` 占位（**不在构建期解析**——解析是运行时按 PromptContext）。
  3. 由文件名派生 slug、由前缀派生 type（含 `tool-param`）。
  4. 在 manifest 查该 slug 的 `action` / `adaptation` / `varRebind` / `omittedWhy` / `dropClauses`。
  5. 产出 fragment 对象，或跳过并记录 omission。
- **OUTPUT**：
  - `src/engine/prompt-fragments.generated.ts`（frozen typed store）。
  - `Public-Info-Pool/Resource/repo-engineering/prompt-fragment-provenance-<date>.md`（归属+审计报告：列出每个 included 片段的 slug/ccVersion/adaptation，每个 omission 的原因，**以及 §6.4 勘定对账表 include+omit==553 的机器核对结果**）——路径经 `scripts/deliverable_path.py --type repo-engineering` 算出（§6.2 强约束）。
- **构建期红线静态扫描（修订新增，BLOCKER 级）**：脚本在产出 store 后，对**每个 `action:'include'` 片段的 body（应用 dropClauses 后）**做禁词扫描：
  - 所有 `*_TOOL_NAME` 绑定到发货工具名；
  - 每个 `${FN()?A:B}` 三元的 A、B 两支都展开；每个 `${OBJ.prop}` / `${FN()}` 以「有值/无值」两态展开；
  - 对展开后的全部文本变体扫**禁词集**（§6.4 R1，禁词集从 §6.2 omit-groups 程序化派生，非手抄）；
  - 命中即 fail-build。此扫描**独立于运行时门控**，抓「被禁引用只活在某分支里」的漏。
- **SYNC / DRIFT GUARD**：
  - (a) 脚本是归档+manifest 的纯函数，每周刷新后重跑确定性再生成。**接入 `refresh-claude-code-prompts.yml`，但重生成 commit 不加 `[skip ci]` 或另挂一个不跳过的验证 job**——使 §8 三/四测在**真正改动语料的那个 commit 上就跑**，而非拖到下一个人类 PR 才红（关闭「[skip ci] 让漂移测延迟触发」的循环漏洞）。
  - (b)–(e) 的四测见 §8。

闭环：归档是唯一真相源，manifest 是唯一改写账本，生成 store + provenance 报告 + 四测 + 构建期静态红线扫描让语料保真且同步。

---

## 6. 范围边界

### 6.1 Applicable 子集（纳入，272/553）

| 类别 | count | 处理 |
|---|---|---|
| main-loop-system-prompt (system-prompt-core) | 81 | 纳入。**过滤泄漏**：autonomous×6 / plan×2 / learning 混进本命名桶，摄取时按项剔除。**注**：多数子句实际为 `adapted`（跨片段合并/reflow），非 faithful（§4.2）|
| tool-description-core | 74 | 纳入。1:1 映射 SDK 工具 schema。Bash 22 个非 sandbox 片段全纳入；sandbox 的 18 个另属 omit |
| system-reminder | 55 | 纳入 core loop 机制（truncation/hook/mcp-connecting/deferred-tools/todo nudge/文件新鲜度·空文件/恶意代码警告里 loop 相关者），**经第五装配面 `assembleReminders` 发出**（§4.3 面5）；按项剔除 product-only（brief-mode/usd-budget/team-coordination/cross-session-peer/browser/app-read-only）与 plan-mode reminder |
| agent-prompt-other (general subagents) | 29 | 纳入为 SDK subagent 模板；剔除 fleet/managed/away/schedule 产品编排变体 |
| sub-agent (code-review family) | 20 | 纳入（高价值，重参数化 `${*_FINDER_ANGLE_BLOCK}` 等）——**但注**：这些经 SlashCommand/Skill 触发、且 `ReportFindings` 不在发货集；作为片段可入库，装配面**暂不接线**（见开放问题 Q4 与死库存守卫例外，§6.4 脚注）|
| generator-classifier (internal generators) | 13 | 纳入 G2/G6 工作（commit-prefix/session-title/branch/transcript+compaction summary/away-summary/state classifier）；`agentMetadata.model=haiku` 路由廉价模型 |

**合计 272**。`tool-parameter-*`(6) 的处置见 §6.4 勘定表脚注（映射到逐参数 inputSchema 描述面）。

### 6.2 显式 Omit list（不纳入）

依据 ADAPTATION/OMIT POLICY，逐组。**每一组的能力名都是 §6.4 禁词集的程序化派生源**——即禁词扫描表由本 omit-list 生成、不手抄，且有测试断言「本 list 每个能力名都在扫描表里」（关闭「两份手抄清单漂移」漏洞）：

- **sandbox（18）** —— SDK 不 sandbox。无 `dangerouslyDisableSandbox` 参数、无 retry 循环、无「commands MUST run in sandbox」策略。
- **powershell 组** —— SDK 只发 Unix Bash，无 PowerShell；`$PROFILE` 惯用法与 PowerShell sleep 规则会误导 Unix shell。
- **Task/Agent 家族** —— Task/Agent 工具不发货；无 subagent-spawn、无 coordinator/worker、无 fork；所有 `${AGENT_TOOL_NAME}`/`${TASK_TOOL_NAME}` 引用整句删。**含 v5 现存的 `Use the Agent tool...` 子句，Phase 0.5 先处置**（§7）。
- **Workflow 工具** —— 不发货。
- **NotebookEdit / MultiEdit** —— 不发货；Edit 是唯一单文件编辑器。
- **Plan-mode 组**（EnterPlanMode/ExitPlanMode/enterworktree 及 plan-mode/ultraplan reminders）—— 不发货；AskUserQuestion 里交叉引用 plan-mode 的决策指引子句须剪掉。
- **Skill / SlashCommand 组** —— 不发货。
- **computer-use 组** —— 不发货。
- **loop / cron / schedule 组** —— 不发货（host 用 triggers 排程）。
- **worktree 组（EnterWorktree/ExitWorktree）** —— 不发货。
- **artifact 组（Artifact）** —— 不发货。
- **figma / design-sync 组（DesignSync）** —— 不发货。
- **cowork 组** —— 不发货。
- **chrome / browser 组** —— 不发货。
- **product-comms 工具**（SendMessage/SendUserMessage/SendUserFile/Monitor/PushNotification/ToolSearch/Advisor/StructuredOutput/ReportFindings）—— 不在发货集。发货集 = Bash/BashOutput/KillShell/Read/Edit/Write/Grep/Glob/TodoWrite/WebFetch/WebSearch/AskUserQuestion + **MCP resource 工具**。
- **connector/plugin/skill discovery** —— 不发货。**例外**：`ListMcpResourcesTool` 与 `ReadMcpResourceTool` 描述**保留**（唯一保留的 MCP 工具管理片段）。
- **产品功能提示组**（insights / learning / auto / focus / minimal / brief / output-style / interactive-agent-intro / teams-coordinator / managed-agents / onboarding / status-line / session-title-rename-search / away-summary / background-session / remote-planning / security-monitor / hook-condition-evaluator）—— 无自包含 loop 运行时。
- **platform-memory / dream 组** —— 银芯已退役等价物（§1.4 第 3 条），用平台原生记忆；一律 omit。
- **data-\* 参考载荷（77）** —— 文档/参考语料，非 loop 片段。
- **skill-body（43）** —— 按需加载 marketplace 内容，非基础装配。**注**：skill 前缀 63 = 43 skill-body omit + 其余（skill discovery / SlashCommand 触发的 code-review 家族等）分列其他组，勘定见 §6.4。
- **CLI-only 品牌位** —— `system-prompt-doing-tasks-help-and-feedback`（feedback URL / `/help` / `/bug`）、`COMMIT_CO_AUTHORED_BY_CLAUDE_CODE`、`PR_GENERATED_WITH_CLAUDE_CODE` 默认解析为空，除非嵌入方显式 opt-in。
- **hooks/config 产品片段** —— settings.json hook 配置、WSL managed-settings 属 CLI/host 关切。

### 6.3 变量映射（关键项）

| 变量 | 解析 |
|---|---|
| `${READ_/EDIT_/WRITE_/GLOB_/GREP_/BASH_/TODOWRITE_/WEBFETCH_/WEBSEARCH_TOOL_NAME}` | → `Read/Edit/Write/Glob/Grep/Bash/TodoWrite/WebFetch/WebSearch`（全发货，从 `ctx.toolNames` 解析） |
| `${ASK_USER_QUESTION_TOOL_NAME}` | → `AskUserQuestion`（发货）；但周围 `${ENTER/EXIT_PLAN_MODE_TOOL_NAME}` 决策指引子句删 |
| `${READ_ONLY_SEARCHING_BASH_COMMANDS}` | → 字面 `find, grep, cat, head, tail, sed, awk, echo`（逐字留，替代品全发货） |
| `${GET_MAX_TIMEOUT_MS()}` / `${GET_DEFAULT_TIMEOUT_MS()}` | → SDK 配置数值字面（默认 120000ms/2min、最大 600000ms/10min） |
| `${SCRATCHPAD_DIR_FN}` | → 会话 scratchpad 绝对路径（host 分配） |
| `${CURRENT_MONTH_YEAR}` | → 运行时 `Month YYYY`（保证 WebSearch 用对年份，红线 R10） |
| `${MAX_LINES_CONSTANT}` 等 Read 配置 | → `2000` 行上限 / `cat -n` 格式；`*_NOTE` 条件默认空串除非启用 |
| `${GET_TODO_TOOL_FN}` | → `TodoWrite`（发货）；同句 `${TASK_TOOL_NAME}` 半边删 |
| `${TASK_TOOL_NAME}` / `${AGENT_TOOL_NAME}` / `${ENTER/EXIT_PLAN_MODE_TOOL_NAME}` | **DROPPED**，整句改写删引用（不发占位、不发替身名、**不经 varRebind 注回**——resolver hard-fail 兜底，§4.4 不变式 1） |
| `${COMMIT_CO_AUTHORED_BY_CLAUDE_CODE}` / `${PR_GENERATED_WITH_CLAUDE_CODE}` | → 空串默认（`${x?...:''}` 守卫塌陷、整个 footer 略），仅嵌入方显式配置才非空 |
| `${LOADED_COMMANDS_CONTEXT.commit}` | git 片段紧凑 `# Git` vs 详细 `# Committing changes` 分支选择器，装配器**选定一支**（输出不留裸三元；对象属性缺键 → resolver fail-loud，§4.4） |
| `${GITHUB_REPOSITORY}` / `${DEFAULT_BRANCH}` | 仅 git 块发出且是 git 仓时注入 |
| `{{MODEL_*}}`（Fable/Mythos/Opus/Sonnet/Haiku 身份占位）| 仅身份片段需要，替换为实际运行模型营销名 + API id（是否入 loop 见开放问题 Q5） |

### 6.4 勘定对账、红线不变式与测试

#### 6.4.1 553 全量勘定对账表（修订新增，机器核对）

草稿只报 applicable 272、未证「include+omit==553」，是 `tool-parameter-*` 被静默漏掉的根因。构建脚本产出并在 provenance 报告核对下表，**任一 TYPE 前缀的 include+omit 不等于该前缀总数即 fail-build**：

| TYPE 前缀 | 总数 | include | omit | 备注 |
|---|---|---|---|---|
| `system-prompt-*` | 130 | 81 | 49 | omit=autonomous/plan/learning 泄漏项 + product 功能组 + CLI 品牌位等 |
| `tool-description-*` | 137 | 74 | 63 | omit=sandbox(18)/powershell/Task/Workflow/NotebookEdit/MultiEdit/plan-mode/computer/artifact/cowork/chrome/product-comms 等 |
| `system-reminder-*` | 76 | 55 | 21 | include 经面5发出；omit=brief/usd-budget/team/peer/browser/app-read-only/plan-mode 等 |
| `agent-prompt-*` | 64 | 49 | 15 | include=general subagents(29)+code-review family(20，入库不接线)；omit=fleet/managed/away/schedule |
| `skill-*` | 63 | 0 | 63 | 全 omit：skill-body(43)+skill/SlashCommand discovery(20) |
| `data-*` | 77 | 0 | 77 | 全 omit：参考载荷，非 loop 片段 |
| `tool-parameter-*` | 6 | 13(见脚注) | 0 | **修订补入**——逐参数 inputSchema 描述面 |
| **合计** | **553** | **≈272** | **≈281** | 具体数由脚本核对，本表为设计期估算骨架 |

> **注意：勘定表状态**：上表各前缀的 include/omit 拆分为**设计期估算**，用于确立「必须机器核对到 553」的骨架与失败契约；**精确数字以 `scripts/build-prompt-fragments.mjs` 首次运行产出为准**（脚本读真实归档 + manifest 得出，写入 provenance 报告）。合计恒等 553 是硬约束，分项数字待脚本回填。

> **`tool-parameter-*` 脚注（关闭 finding #3 覆盖错配）**：归档 `tool-parameter-*` 仅 6 片段，而 SDK 散落于工具文件的逐参数 `inputSchema.description` 面 **数量多于 6**。二者不是 1:1：(1) 归档 6 个 `tool-parameter-*` 覆盖官方**参数级**描述里被独立切片的那几个（如 Bash `command` / `timeout`、Edit `replace_all` 等），标 `type:'tool-param'` 入库、可 faithful 对账；(2) 其余无归档对应的参数描述标 `adaptation:'original'`（SDK 自撰，clean-room），不宣称 faithful，仅受红线扫描 + 死库存守卫约束。Phase 3 迁移时，provenance 报告须逐参数标注「corpus-derived(tool-param) vs SDK-original」，使 ~N 个参数面到 6 归档片段的映射可审。

#### 6.4.2 红线不变式（红线 = 硬约束）与测试

**禁词集单一真相源（修订，关闭「两份手抄清单漂移」BLOCKER）**：R1 的禁词表**不是手抄常量**，而是从 §6.2 omit-groups 的能力名 + 发货集补集**程序化派生**。测试断言：§6.2 每一个 omit-group 能力名（sandbox/PowerShell/Task/Agent/Workflow/NotebookEdit/MultiEdit/ExitPlanMode/EnterPlanMode/EnterWorktree/ExitWorktree/Skill/SlashCommand/computer-use/cowork/figma/DesignSync/Artifact/Cron/loop/schedule/insights/learning/teams/managed-agents/onboarding/status-line/Monitor/SendMessage/SendUserMessage/SendUserFile/PushNotification/ToolSearch/Advisor/StructuredOutput/ReportFindings/platform-memory/dream/…）都出现在扫描集里。禁词集 = 非发货能力名的**证明为超集**，不是人手拷贝。

| 红线 | 如何测 |
|---|---|
| **R1** 任何 emit 的工具描述/重定向/指令**不得命名不发货工具**（禁词集程序化派生自 §6.2）——整句删，绝不占位或替身 | **构建期静态扫描**（§5：全 include 片段 body、dropClauses 后、双分支展开）+ **运行时扫描遍历 ctx 笛卡尔积**（git on/off × trusted/untrusted × compact/full × 各 optional flag，非单一 canonical ctx）；扫描覆盖 10 canonical + 离册 4 面（`resources.ts`/`shells.ts`/`toolsearch.ts`/`subagents/agent-tool.ts`，路径经 ls 校准）+ 最终装配输出 |
| **R1'** 工具名注入防护：`${*_TOOL_NAME}` 只能解析出发货工具；varRebind 不得引入工具名 | resolver hard-fail（§4.4 不变式1、step-3c）+ manifest 校验测试（每个 `*_TOOL_NAME` 的 varRebind 值 ∈ 发货注册表）|
| **R1''** 描述/重定向区里工具名按**独立 token** 匹配（不止 `X tool` 二元组），自由散文区保留宽松 ` tool` 匹配 | 扫描器对 tool-description/redirect region 用 standalone-token 正则（抓 `Task(` / `use the Task to` 等无 ` tool` 后缀的裸引用）；自由散文区保留 `\bTask tool\b` 以免误伤 SDK 内部合法 task/agent 词汇 |
| R2 dedicated-over-bash 重定向只命名发货工具：Read(非 cat/head/tail)、Edit(非 sed/awk)、Write(非 echo/heredoc)、Glob(非 find/ls)、Grep(非 grep/rg) | 装配输出断言含 `Use Grep (NOT grep or rg)` 等 pin 串、不含未发货替代 |
| R3 **零 sandbox 语言**：无 `dangerouslyDisableSandbox` / `sandbox mode` / retry-without-sandbox | 禁词扫描 |
| R4 无 PowerShell/Windows 惯用法 | 禁词扫描 |
| R5 无 CLI-only 归属 footer 默认（Co-Authored-By / Generated with Claude Code），除非显式 opt-in | 默认装配输出不含这两串的测试 |
| **R6 最终装配零残留占位 + 零静默塌陷**：无字面 `${...}`、`{{...}}`；且**任一 `${OBJ.prop}` / `${FN()}` 解析为 undefined 必 fail-loud，不得静默出 `''` 或 `'undefined'`** | resolver step-3a/b 抛错 + 装配输出正则扫残留 + **test c'（§8）扫 body 内全部四种占位句法的可解析性**（不止 frontmatter `variables:` 清单）|
| R7 plan-mode/insights/learning/teams/managed-agents/platform-memory/dream 等产品片段永不入 loop | manifest 这些 slug `action:'omit'`；死库存守卫 + 勘定对账 |
| R8 git commit/PR 块门控于 git 可用 **且** 用户显式请求提交；保留「only commit when user explicitly asks」、永不自动 commit/push | 断言含该子句、且门控谓词覆盖测试 |
| R9 MCP 工具管理仅 emit `ListMcpResourcesTool` / `ReadMcpResourceTool` | 禁词表允许这两者、禁其余 discovery 工具 |
| R10 WebSearch 强制 `Sources:` 段 + `${CURRENT_MONTH_YEAR}` 年份正确性子句完整存活；WebFetch 的 MCP 优先 + GitHub-use-gh 注保留 | pin 串断言 |
| R11 `run_in_background`/BashOutput/KillShell 指引（no-polling、完成即通知、无尾随 `&`）与发货后台 shell 一致；不导入 sandbox-tmpdir / sleep-polling 变体 | pin 串 + 禁词扫描 |
| **R12 扫描信任边界显式化**：红线扫描目标 = **SDK 自撰片段输出**；`opt.append` / projectInstructions(CLAUDE.md/AGENTS.md) / segments-form caller 块 **在信任边界外，不扫**（嵌入方责任） | 扫描器输入只取 assembler 产出的片段文本，不含透传段；文档 + 测试注释显式声明此边界（避免合法 CLAUDE.md 提 `Task` 误报 DoS，也避免把 segments 缝当作被 SDK 背书的路径）|

**关键补漏（保留并加固）**：R1 现测只覆盖 `descriptions.ts`。本设计要求红线扫描扩展到**离册 4 面**（`resources.ts`/`shells.ts`/`toolsearch.ts`/`subagents/agent-tool.ts`，路径经 ls 校准、非草稿手抄的错误 `src/tools/agent-tool.ts`）+ **最终装配输出** + **构建期静态片段扫描**——三管齐下，否则一个只摄取 descriptions.ts+v5 的 assembler 会漏掉这些面。且此扩展**在 Phase 0/1 assembler 上线之前**落为合并门（见 §7），不拖到 Phase 2。

---

## 7. 迁移计划（分阶段，每阶段验收标准）

原则：**先零行为变更搬家，后扩面**；**红线门与字节快照门先于 assembler 上线落地**。每阶段 `pytest tests/`（Python 侧）与 SDK 侧 `*.test.ts` 全绿方可合。

> **两轨说明（联动 §9/§10 Q1）**：
> - **Track A（对账工具，最小投资）**：只做 Phase 0 + 0.5 + 1a，把片段库当「每周漂移对账器」，mainLoop / 描述仍是 curated 常量，不建 resolver / PromptContext / 五装配面。
> - **Track B（全套装配引擎）**：Track A + Phase 1b–5，建完整四关注点 + 五面。
> Phase 0/0.5/1a 两轨共用。**守密人裁 Q1 前，默认只推进到 Phase 1a**（Track A 边界），Phase 1b 起须 Q1 明确 greenlight 第二真实装配面（generators）方启动。

### Phase 0 — 骨架 + build 脚本 + 红线门（不接线运行时）

- 落 `scripts/build-prompt-fragments.mjs` + `scripts/prompt-adaptation.json`（先只登记 v5 与 10 canonical 描述对应的 slug）+ 生成 `prompt-fragments.generated.ts` + provenance 报告（含 §6.4.1 勘定对账）。
- 落 §8 四测（faithful 字节对账 + ccVersion、占位全句法可解析、assembler 引用存在、**死库存守卫**）——此阶段 assembler 尚空，第三/四测按当前 include 集判定。
- **落红线门（提前，BLOCKER 级）**：构建期静态红线扫描（§5）+ 禁词集从 §6.2 程序化派生 + 断言 omit-group 全覆盖扫描表 + 面清单从 `ls` 生成。**这些是合并门，先于任何运行时 assembler。**
- **验收**：`node scripts/build-prompt-fragments.mjs` 确定性可重跑；四测 + 红线静态扫描绿；勘定对账 include+omit==553；不改任何运行时路径，现有 `prompts.test.ts` / `tool-descriptions.test.ts` 不动且绿。

### Phase 0.5 — 先修 v5 的 R1 自违例（独立字节变更，重设缓存基线）

> **修订新增，解决「Phase 1 两门互斥」BLOCKER**：v5 现含 `Use the Agent tool...`（prompts.ts:366）与 v3 `(via the Agent tool)`，Agent 工具不发货。若 Phase 1 同时要求「字节等于 v5」与「R1 通过」，二门互斥、计划不可执行。故先在**未引入片段库前**把这条作为一次**显式、独立 owned 的字节变更**处置：

- 从 v5/v3 剔除 Agent-tool 子句（或按守密人裁定改写为 SDK 自有 subagent 引擎的合法措辞）。
- 因 stable prefix 字节变了：**重设 Haiku 缓存基线**（确认剔除后仍跨阈值，若逼近阈值则以中性 padding 或邻近子句吸收，记录在案），**更新 `prompts.test.ts` pin 串并新增 `.not.toContain('Agent tool')` / `.not.toContain('via the Agent')` 负向断言**（补上草稿指出的现测漏洞）。
- **验收**：修正后的 v5' 通过 R1 装配输出扫描；缓存 probe 仍跨阈值；pin 串更新且绿。此后 Phase 1 的「字节等于」锚定的是 **v5'**（已合规基线），两门不再互斥。
- **回滚位**：本阶段是纯 v5 常量改动，可独立 revert，不牵动片段库。

### Phase 1a — mainLoop 装配 + 字节快照金标（零行为变更 vs v5'，descriptions.ts 不动）

> **修订：Phase 1 拆为 1a/1b（解决「Phase 1 oversized」+「无确定性字节门」）。**

- 实现 `assembleMainLoop`，其有序 slug 列表 + resolver 输出**字节等于 v5'**。
- **落字节快照金标测试（vitest，确定性、CI 可跑）**：`expect(assembleMainLoop(canonicalCtx).stable).toBe(FIXTURE_MAINLOOP_STABLE)`，fixture 为 checked-in 的 v5' 完整 stable prefix 字节。**这是 Phase 1 的真门**——取代 `cache-probe.mjs`（后者 API-key gated、无 key 即 exit 2 跳过、非 vitest、非字节门，仅保留为可选 live 诊断）。快照门直接抓 `lines.join('\n')` 空串项产生 `\n\n` 之类的 whitespace reflow（子串 pin 抓不到）。
- 保持 stable/volatile 切分、CLAUDE.md system-reminder 注入、`opt.append` / projectInstructions / structuredOutput 固定尾段的**精确分隔符与放置**。
- **descriptions.ts 完全不动**（隔离变量，`.toBe` 引用相等风险留给 1b）。
- **验收（硬）**：
  - mainLoop stable 字节快照 == v5' fixture（金标测试绿）。
  - `prompts.test.ts` 所有 pin 串原样通过（`'Doing tasks:'`/`'Tool use:'`/`'Executing actions with care:'`/`'Communicating with the user:'`/`'Measure twice, cut once.'`/`'file_path:line_number'`/`'When you have enough information to act, act.'`/`'Assist with authorized security testing'`/`'Use Grep (NOT grep or rg)'`），含 v1/v2/v3/v4 段标记与负向断言（无 `'Workflow'`/`'computer-use'`/`'Agent tool'`）。
  - R1 运行时扫描（ctx 笛卡尔积）对 mainLoop 输出全绿。
  - `cache-probe.mjs` 作可选诊断绿（有 key 时）：stable prefix 仍跨 Haiku 阈值。
- **回滚位**：Phase 1a 只要金标不等，回退到 v5' 硬编码，Phase 0/0.5 产物保留待修。

### Phase 1b — 10 canonical 描述迁入 store（隔离 `.toBe` 风险）

- `descriptions.ts` 常量改为从 store **memoize 到同一 instance** 后 re-export（保住 `tools.get('Bash').description === D.BASH_DESCRIPTION` 引用相等，migration_risk 明列：store 返回新建字符串会破 `.toBe`）。
- 各描述落**字节快照金标**（10 条各一 fixture）。
- **验收（硬）**：`tool-descriptions.test.ts`：引用相等（`.toBe`）、BASH len>4000、TODOWRITE len>1500、红线禁词表通过；10 条描述字节快照 == fixture。**`.toBe` 若破，故障可单独定位在本子阶段**（不与 mainLoop 纠缠）。

### Phase 2 — 离册工具描述 + 逐参数 schema 描述纳管

- 把 `resources.ts` / `shells.ts` / `toolsearch.ts` / `subagents/agent-tool.ts`（路径经 ls 校准）的内联描述、以及散落工具文件的逐参数 `inputSchema.description` 迁入 store/assembler，`tool-parameter-*` 走 §6.4 脚注映射。
- **注**：R1 红线覆盖到这些面**已在 Phase 0 落为构建期门**；本阶段是把这些面的运行时输出也纳入运行时扫描。
- **验收**：离册面全部经 assembler 出；红线扫描覆盖最终装配输出 + 构建期静态；无新增未发货工具引用；逐参数面 provenance 标 corpus-derived vs SDK-original；现测全绿。

### Phase 3 — subagent 面（保留 original）

- `GENERAL_PURPOSE_PROMPT` 迁入 `assembleSubagent.fresh`，标 `adaptation:'original'`（clean-room，非复现）；`runtime.ts` 改用之。
- **验收**：child engine systemPrompt 字节快照不变；subagent 相关测试绿。

### Phase R — 逐轮 reminder 面（新增，承接 §6.1 的 55 片段）

> **修订新增，关闭「55 reminder 片段摄入却无处发出」major。** 位置在 Phase 2/3 之后、生成器之前或并行，由守密人排期。

- 实现 `assembleReminders(ctx, turnEvent)`（§4.3 面5）：事件门控有序列表，产 `Reminder[]`，loop 注入消息流尾（非 stable/volatile，不破缓存）。
- `PromptContext.turnEvent` 定稿（脱 provisional）；loop 侧接 todo-changed / 文件新鲜度 / 空文件 / 恶意代码事件源。
- **验收**：55 reminder 片段全部被本面引用（死库存守卫对 reminder 类转绿）；每类 reminder 有单测（事件触发正确、输出零残留占位、reminder 注入不改 stable prefix 字节 → 缓存 probe 不受影响）；plan-mode reminder 确认 omit、不入列表。
- **若守密人裁定不做本面**：则 55 reminder 片段须整组在 manifest 改 `action:'omit'` + `omittedWhy`，死库存守卫方能绿——二选一，绝不摄入却悬空。

### Phase 4 — generator/classifier 面（Track B，需 Q1 greenlight）

- `compaction.ts` 的 summarizer 迁入 `assembleGenerator.compactionSummary`（字节快照不变，返回 `GeneratorPrompt` 带 `routing`）。
- 新增 `sessionTitle` / `branchName` / `commitPrefix` 生成器面，各带 `routing.model='haiku'`；loop 的模型选择器读 `routing` 落实廉价模型路由（§4.3 面4）。
- **对账修订**：这些面派生自 generator-classifier 语料（§6.1，13 applicable）。**若宣称复现官方 → 标 `faithful` 并加逐字节 + ccVersion corpus-sync 验收**；**若为 SDK 自撰 → 标 `original` 并去掉「corpus-derived」宣称**。二者择一显式声明，不得既称语料派生又只验「含必需子句」（关闭「generator 面丢了保真论题」minor）。
- **验收**：compaction 双放置行为不变（string/preset 进 stable、segments 尾部未缓存）；新生成器面各有单测（输出含必需子句、`routing.model` 正确、embedder 可经 flag 覆盖为 inherit、零残留占位）；按 faithful/original 归类施加相应对账门。

### Phase 5（可选，待 Q4 裁定）— code-review family 接线

- 20 个 code-review/simplify/security-review 片段已入库；若守密人裁定接线，需先补 `ReportFindings` 等发货决策。**默认不接**（这些经 SlashCommand/Skill 触发、`ReportFindings` 不发货）。
- **死库存守卫例外**：入库不接线的 code-review 家族在守卫里登记为**显式豁免**（`quarantine: true` 白名单，附 Q4 溯源），使「摄入却无面引用」不误报——豁免是显式登记的，不是静默放过。

---

## 8. 测试与保真守护

四道锁（草稿三道 + 死库存守卫），对应「归档=真相源、manifest=唯一账本、生成物=派生、库存无死角」：

1. **单元测试（装配输出 pin + 字节金标）**：`prompts.test.ts` / `tool-descriptions.test.ts` 现有精确子串 + 引用相等 + 长度阈值 + 禁词表**保持并扩展**（离册面、最终装配输出、Agent-tool 负向断言）；**新增字节快照金标**（mainLoop stable、10 描述、subagent、compaction 各一 fixture，`.toBe(fixture)`，CI 确定性可跑，取代 cache-probe 作为字节门）。这一层锁「装出来的字节对不对」。
2. **语料同步检查（corpus-sync，四测）**：`tests/prompt-fragments.test.ts`——
   - **(b) faithful 逐字节对账 + ccVersion 对账**；且**至少一片段的 body 以 checked-in 字面 fixture 独立 pin**（不经 build 解析器），使解析器 bug / 上游 frontmatter 格式变化可被抓到（关闭「对账循环、双方共用同一 buggy parser」major）。
   - **(c') 占位全句法可解析**：扫每个 included body 内**实际出现的全部四种占位**（`${VAR}` / `${FN()}` / `${FN()?A:B}` / `${OBJ.prop}` / `{{MODEL_*}}`），每个都被 varRebind 重绑或可从 PromptContext 已知键解析——**不止 frontmatter `variables:` 清单**（关闭 R6 fail-open）。
   - **(d) assembler 引用存在**：每个被某面引用的 slug 存在且 `action:'include'`。
   - **(e) 死库存守卫（修订新增，逆向）**：每个 `action:'include'` 片段**必须被至少一个装配面的 slug 列表引用**，否则 fail-build（含 reminder 面引用 55 reminder 片段）；code-review 家族等入库不接线者走显式 `quarantine` 白名单豁免。镜像仓内 capability-index 孤儿检测纪律。
   - **(f) adapted 后置条件（修订新增）**：每个 `adapted` 片段，dropClauses 应用后，body **不含任一 dropClause 锚点串**、且**不含该改写意图删除的禁词**——把 dropClause 当**被验证的删除**而非被信任的删除（关闭「adapted 审计弱一档、无 post-condition」minor）。
   - **CI 触发修订**：本组测试**在 `refresh-claude-code-prompts.yml` 内运行**（regen commit 不加 `[skip ci]`，或另挂不跳过的验证 job），使「上游一改就红」落在改语料那个 commit 上，而非拖到下个人类 PR。
3. **既有漂移测（cache + 引用身份）**：`descriptions.ts` 的 `.toBe` 引用相等守 memoize 未破实例身份；`cache-probe.mjs` 降级为**可选 live 诊断**（有 API key 时验 stable prefix 跨 Haiku 阈值），**不再充当字节门**（字节门是第 1 层的快照金标）。
4. **红线扫描（构建期 + 运行时 ctx 矩阵）**：见 §6.4——构建期扫全 include 片段（双分支展开）、运行时遍历 ctx 笛卡尔积扫装配输出；禁词集从 §6.2 程序化派生并断言全覆盖；扫描目标仅 SDK 自撰片段（R12 边界）。

红线（§6.4 R1–R12）由禁词扫描 + pin 串 + 门控覆盖测试实现，扫描范围覆盖**构建期片段 + 运行时最终装配输出**而非仅源常量——这是相对现状的关键加固。

小学生比喻：四道锁像给活页参考书的四重防伪——第一重查「照着抄的作业答案字字对不对」（连书的厚度都用尺子量死，因为书架卡槽认厚度）；第二重查「活页本身和原书每个字一样、且作业里引用的页码都真存在、改写页删掉的话真删干净了」；第三重查「作业本抄袭检测挂在原书更新的那一刻就跑，不是等下次交作业才查」；第四重是门口安检——不光查放进书包的活页，连书包上现成的暗袋（各种条件分支）都翻一遍，且安检违禁品清单是照着「不发货能力名册」自动生成的，不是保安手抄的。

---

## 9. 风险与取舍

- **过度工程风险（片段粒度值不值，本设计最该被 grill 的取舍）**：官方 553 片段是给 ~40 个调用点、含大量本 SDK **不发货**面服务的。本 SDK 只发一套 loop + ~15 工具 + 少量生成器。诚实讲：**运行时装配的 FIDELITY 今天已由 curated v5' 常量达成**（`def===v5'` + pins + 字节金标），四层运行时机器（PromptContext 展开 flags/providers/bag、gate 评估、`${VAR}` 插值、memoize-to-same-instance 保 `.toBe`）**唯一不可替代的真实收益是「对上游每周刷新做机器漂移检测」——而漂移检测是一个 TEST，不是一个装配 ENGINE**。为一个 diff-check 建运行时装配引擎是成本倒挂。故本设计明确给出 **Track A（对账工具）**：保留 v5' + 10 描述为 curated per-surface 常量，只加**构建期对账器**（每子句映射到归档 slug、断言源未漂移、新 slug 默认 omit-unreviewed），交付每周 diff 收益，**零 resolver、零 PromptContext churn、零新字节缓存面**。Track B（全套四层五面）**只在第二个真实装配面（generators，pending #15）被守密人 greenlight 后才回本**。Phase 3/4/5 均为推测性（pending #11/#15、Q4-gated），不能单独 justify 现在就建 store。此取舍升为开放问题 Q1 的正式二选一。
- **保真 vs 成本张力 + mainLoop 多为 adapted**：faithful 逐字节对账最强，但 mainLoop 的 ~40 子句**多为跨片段手工合并/reflow，实际归类 `adapted` 而非 faithful**（§4.2）。因此逐字节强对账只覆盖 mainLoop 的一小部分；`adapted` 子句靠 dropClause 锚点 + 保留子串断言（§8 test f）对账，审计强度弱一档但**仍能在上游改动 kept 部分时让 CI 红**。取舍：faithful 尽量多、adapted 的 dropClauses 锚点强制显式，不留「无 post-condition 的信任式删除」。
- **缓存脆性（最高危迁移风险）**：stable prefix 必须字节不变（`boundary:'first'`）。片段库 round-trip 任何空白变化（`lines.join('\n')` 空串项 → `\n\n` vs 模板字面量 raw）都改缓存键 → 0% 命中。v5' 被有意撑过 Haiku 阈值，缩水/reflow 会静默掉回阈下。**缓解：Phase 1a/1b 字节快照金标（CI 确定性门，非 API-key-gated 的 cache-probe）+ Phase 0.5 已把 Agent-tool 剔除对缓存的影响独立处置并重设基线。** 草稿曾把此风险锁在一个「CI 里根本不跑」的 cache-probe 上，本次修订改为快照金标为主门。
- **离册面遗漏 + 面清单陈旧**：只摄取 descriptions.ts+v5 会漏离册面；且草稿手抄面清单有错（误记 `src/tools/agent-tool.ts`，实为 `src/subagents/agent-tool.ts`；漏 `askuserquestion.ts`）。缓解：面清单**从 `ls src/tools/*.ts src/subagents/*.ts` + grep 内联描述串生成**，红线门在 Phase 0 就落、先于 assembler 上线（不拖 Phase 2）。
- **红线保证的边界（修订澄清）**：红线只对 **SDK 自撰片段输出**成立（R12）。`opt.append` / projectInstructions / segments-form caller 块属嵌入方透传，**在信任边界外**——嵌入方在自己文本里写 `Task` 是嵌入方责任，SDK 既不背书也不扫（否则合法 CLAUDE.md 触发误报 DoS）。此边界是**显式声明**，不是隐含假设。segments-form 平行缝与五装配面**共存非取代**（§4.6）。
- **维护面**：manifest 是人手账本，上游新片段默认 omit-unreviewed（fail-loud）是双刃——安全，但每周刷新可能积压「待 review 的新 slug」。缓解：provenance 报告把 unreviewed 列出，作为每周轻量 review 清单。
- **双放置复杂度**：structured-output 两条放置路径（stable 缓存 / segments 未缓存）、segments-form 平行装配缝（`query.ts:514` 绕过 buildSystemPromptParts）——assembler 必须保两条路径，否则要么缓存 per-schema 指令污染复用、要么从 segments 路径丢指令。Phase 4 单列测试守。

---

## 10. 开放问题（待守密人裁定）

1. **粒度裁定（最重要，Track A vs Track B）**：建全套四层五面片段库+装配引擎（Track B），还是**只做 Phase 0/0.5/1a** 把它当「对账工具」（构建期漂移对账器，mainLoop/描述仍 curated 常量，无 resolver/PromptContext）（Track A）？§9 第一条论证：运行时 fidelity 今天已由 v5' 常量达成，四层机器唯一真实收益是漂移检测（一个 test，非一个 engine）。**建议默认 Track A，待第二真实装配面（generators，pending #15）greenlight 再升 Track B**。守密人裁。
2. **faithful vs original 的默认倾向**：mainLoop 应尽量逐字节复现官方（faithful，强对账、随上游漂移风险），还是保留 v1..v3 那种 SDK 自撰组合（original，稳定但不跟官方）？**修订补充**：勘测显示 mainLoop 现状**大面积是 adapted**（合并/reflow），纯 faithful 不现实，问题实为「adapted 的 dropClause 锚点严到什么程度」。当前 v5' 是 adapted 复现、v1–v3 是 original，两条路线是否长期并存？
3. **归属 footer 默认**：`COMMIT_CO_AUTHORED_BY_CLAUDE_CODE` / `PR_GENERATED_WITH_CLAUDE_CODE` 默认空（红线 R5）。但本仓 CLAUDE.md §Git 要求 commit 尾带 `Co-Authored-By: Claude Opus 4.8` + `Claude-Session:` —— 这是**银芯自身**的 git 纪律，不是 SDK 发货默认。确认：SDK 装配层默认空，银芯仓的 co-author 走 host/embedder opt-in（且属 R12 透传边界外），两者不冲突？
4. **code-review family（20 片段）接线与否**：已入库，但经 SlashCommand/Skill 触发且 `ReportFindings` 不发货。默认**不接线**（Phase 5 gated，死库存守卫走 `quarantine` 显式豁免）。守密人是否要在 SDK 内提供 code-review subagent 能力（则需先决定发货 `ReportFindings` 等价工具）？
5. **模型身份片段 + generator 路由覆盖**：`{{MODEL_*}}` 身份占位替换为实际运行模型（如 `claude-opus-4-8`）。SDK 作为库，模型 id 由 embedder 传入——身份片段是否纳入 loop，还是留给 embedder 自定？涉及「艾瑞卡身份门控」（§0）与 SDK 通用性的边界。**修订联动**：generator 面的 `routing.model='haiku'`（§4.3 面4）对 pin 单模型的 embedder 需可覆盖为 inherit（`ctx.flags['ALLOW_MODEL_ROUTING']`）——确认此覆盖语义。
6. **compact 档位是否发货**：官方 `*-compact`（readfile-compact/grep-compact）按模型档位选。本 SDK 是否支持 compact 档位？若否，manifest 直接 omit 所有 compact 变体，`ctx.model.tier` 恒 `full`，简化 resolver（§4.4 不变式3）。
7. **provenance 报告落点**：`Public-Info-Pool/Resource/repo-engineering/prompt-fragment-provenance-<date>.md`——是每次 build 覆盖同名（去 date、稳定路径便于 diff），还是按日期留版本（审计留痕但发散）？§6.2 强约束倾向前者（同产物同日覆盖），确认。
8. **reminder 面做不做（修订新增）**：§6.1 摄入 55 个 reminder 片段。若做，落 Phase R（新增第五装配面 + `PromptContext.turnEvent` 定稿）；若不做，55 片段须整组改 `action:'omit'` + `omittedWhy`（否则死库存守卫红）。二选一，不允许摄入却悬空。守密人裁。

---

## 审查纪要

三轮对抗式审查的处置逐条落点如下（blocker/major 全修，minor 记为 caveat 或开放问题）。

**Critique 1（COMPLETENESS）——改了什么：**
- 新增**第五装配面 `assembleReminders(ctx, turnEvent)`**（§4.3 面5）+ 专属 **Phase R**（§7）+ 验收，承接 55 个原本摄入却无处发出的 reminder 片段；并给出「不做则整组 omit」的二选一（开放问题 Q8）。（major #1）
- 新增**死库存守卫**（§8 test e）：每个 include 片段必须被某面引用，逆向堵住「摄入却不接线」，含 code-review 家族的 `quarantine` 显式豁免。（major #2）
- 补入 **`tool-parameter-*`(6)** 到 §6.4 勘定表 + 脚注，说明其到 ~N 个逐参数面的非 1:1 映射与 corpus-derived/original 归属。（major #3）
- generator 面返回类型扩展 **`GeneratorPrompt.routing`**（§4.3 面4），让 haiku 路由能被装配输出携带、被 loop 消费、被 embedder 覆盖。（major #4）
- 明确 **segments-form 平行缝与五面共存非取代**（§4.6）+ R1 边界（§6.4 R12）。（major #5）
- `PromptContext.turnEvent` 标 **provisional**、reminder 面定稿时脱标（§4.4）。（minor）
- Phase 4 generator 验收补 **faithful/original 二选一显式声明**（§7）。（minor）
- 新增 **553 全量勘定对账表**（§6.4.1），机器核对 include+omit==553、按 TYPE 前缀，任一不等 fail-build。（minor，也是 #3 的根因堵漏）

**Critique 2（RED-LINE-SAFETY）——改了什么：**
- 新增**构建期静态红线扫描**（§5 + §6.4）：扫全 include 片段 body、dropClauses 后、`${FN()?A:B}` 双分支 + `${OBJ.prop}` 两态展开，独立于运行时门控；运行时扫描改为**遍历 ctx 笛卡尔积**。（blocker #1）
- 禁词集**从 §6.2 omit-groups 程序化派生**、断言全覆盖，取代手抄常量表；补齐 EnterWorktree/cowork/Monitor 等缺项。（blocker #2）
- **varRebind 禁止引入工具名**、工具名唯一源 = 发货注册表、resolver hard-fail（§4.4 不变式1 + step-3c + R1'）。（major）
- **R6 fail-loud 扩到全占位句法**：`${OBJ.prop}`/`${FN()}` 解析为 undefined 必抛错、不静默塌空；test c' 扫 body 实际出现的全部四种句法而非 `variables:` 清单。（major）
- 描述/重定向区**按独立 token 匹配**工具名（抓 `Task(` 无 ` tool` 后缀的裸引用），散文区保留宽松匹配（R1''）。（major）
- 红线门**提前到 Phase 0** 落为合并门、先于 assembler 上线；**面清单从 `ls` 生成**，修正 `agent-tool.ts` 路径（实为 `src/subagents/`）、补 `askuserquestion.ts`。（major）
- **R12 显式声明扫描信任边界**：只扫 SDK 自撰片段，透传段/segments 缝在边界外。（minor）
- **adapted 后置条件测试**（§8 test f）：dropClause 后 body 不含锚点串、不含意图删除的禁词，删除即验证。（minor）

**Critique 3（over-engineering + migration-risk）——改了什么：**
- 新增 **Phase 0.5** 先修 v5 的 R1 自违例（`Use the Agent tool...`）为独立 owned 字节变更、重设缓存基线、补 `.not.toContain('Agent tool')` 负向断言，使 Phase 1 的「字节等于」锚定合规基线 v5'，解散两门互斥。（blocker）
- **字节快照金标测试**（§7 Phase 1a/1b + §8 第1层）取代 cache-probe 作为字节门，CI 确定性可跑、抓 whitespace reflow；cache-probe 降级为可选 live 诊断。（blocker）
- corpus-sync 测试**在 refresh workflow 内跑（不 [skip ci]）** + **至少一片段 body 以 checked-in 字面 fixture 独立 pin**（脱离 build 解析器），破循环、堵解析器 bug。（major）
- 明确 **Track A / Track B 两轨**（§7 前言 + §9 + Q1）：默认只到 Phase 1a 当对账工具，Track B 待第二真实面 greenlight。（major，over-engineering）
- **Phase 1 拆 1a/1b**：1a mainLoop 字节金标（descriptions 不动）、1b 描述迁入隔离 `.toBe` 风险。（major）
- 明确 **mainLoop 多为 adapted 而非 faithful**（§4.2/§9/Q2），adapted 子句给强制 dropClause 锚点 + 保留子串对账。（minor）
