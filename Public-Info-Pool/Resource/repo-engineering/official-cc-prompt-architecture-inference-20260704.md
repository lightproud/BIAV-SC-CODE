# 官方 Claude Code 内部架构推断图（自公开提示词还原逆推）

> 类型：repo-engineering ｜ 日期：2026-07-04 ｜ 作者：艾瑞卡会话（守密人派发：「读这些提示词能否推断内部实现结构」）
> 定位：**公开信息再现**（守密人 2026-07-04 裁定放弃 clean-room 主张，改「公开信息再现、明确署名」）。
> 源：`Public-Info-Pool/Reference/Claude-Code-System-Prompts/`（Piebald-AI v2.1.201 快照，MIT，逆向自公开分发的 `@anthropic-ai/claude-code` 包）。
> **证据性质**：这些是引擎插值发送的**字符串常量**，揭示「意图」与「调用点之间的接缝」，**不是**它们周围的确定性接线。文件名/模板变量名可自由引用（属结构），散文一律转述、不搬原文。

## 0. 一句话

**能，而且能推断出相当完整的架构骨架。** 官方「系统提示词」不是一整块，而是 `tools/updatePrompts.js` 揭示的**片段合成树**——553 文件坍缩成 **~40 个不同调用点**，其余是主循环片段或逐工具描述。片段合成的粒度**本身就是架构**：系统提示词是按环境**在请求组装期条件拼接**出来的，不是存成整块的。

小学生比喻：官方的「系统提示词」不是一整张大纸，而是一盒**乐高积木**——每次开工按环境拼一台；拼好后有条流水线（先派十个侦察兵各找 bug、再派复核员一个个投票、最后一个新人兜底扫一遍）；进门口还蹲着门卫（先把命令削成前缀再对花名册，发现夹带私货就拉警报改人工）。这盒积木只告诉你「该怎么做」，没告诉你「机器怎么把积木递进去、怎么记账、崩了怎么重试」——那些是看不见的传送带。

## 1. 调用点清单（~40 个不同 LLM 调用点）

- **A. 主交互循环（1 个调用点，~130 `system-prompt-*` + ~137 `tool-description-*` 片段）**：不是 130 个调用点，是**一台拼装的提示词**。片段按环境/配置开关：身份引子变体、行为条款（`doing-tasks-*`）、沟通风格、逐工具描述块（Bash 一家就 ~40 个子条款：`bash-sandbox-*`/`bash-git-*`/`bash-alternative-*`）。
- **B. 子代理（~18 个）**：只读研究员（`explore` 871 tks，禁 Agent/Edit/Write，thoroughness 分档；`read-only-search-agent`；`general-purpose`）、架构师（`plan-mode-enhanced` 四阶段，末尾「Critical Files」3-5 路径）、worker/coordinator（`worker-fork` maxTurns=200 叶子不可再生；`coordinator-mode-orchestration` 5916 tks）、guide、setup、slash 命令代理（`/review`/`/simplify`/`/batch`/`/security-review`/`/schedule`）。
- **C. 分类器/检测器（~12 个，神经符号胶水）**：`bash-command-prefix-detection`（把命令削成可比对白名单的前缀，三出：前缀串/`none`/`command_injection_detected` 哨兵）、`background-agent-state-classifier`（四态 done/working/blocked/failed → 门控手机通知）、权限分类器 + 绕过分类器（抓 `python -c`/`sed -i`/`cat >`/heredoc 绕开 Edit/Write deny）、`memory-files-to-attach`（≤5 文件精确偏置）、`context-tip-selector`、`hook-condition-evaluator`、以及两段式**安全监视器**（`security-monitor-*` 8582 + 18941 tks，全库最大，对自主工具动作的放行/拦截裁决）。
- **D. 摘要/压缩（~8 个）**：`conversation-summarization`（`<analysis>` 预扫 → 9 段 `<summary>`）、`context-compaction-summary`（5 段，元数据指向 haiku 档模型）、`webfetch-summarizer`（按 `IS_TRUSTED_DOMAIN` 分支），共享 `summarization-no-tools-guard`（「只回文本，工具调用会被拒」）。
- **E. 审查/验证（~14 片段，分阶段流水线）**：`code-review-part-1..10` + `skill-code-review-*`（角度 A–E，阶段 0/2/3）——是**多代理扇出/验证流水线**，详见 §2。
- **F. 生成器（~12 个）**：标题/分支名、`bash-command-description-writer`、`away-summary`、`onboarding-guide`、`quick-pr-creation`、`insights-*` 一族。
- **G. 记忆固化（"做梦" ~4 个）**：`dream-memory-consolidation`（orient→gather→merge→prune）、`dream-claudemd-reconciliation`、只读记忆抽取子代理。
- **H. Workflow 编排引擎（1 个工具驱动调用点 + N 个派生代理）**：`tool-description-workflow` 6988 tks + `workflow-{script,subagent}-*`，一套确定性 JS DSL（§3）。

## 2. 编排与控制流

- **主循环 → 子代理派发**：`writing-subagent-prompts` 按 `HAS_SUBAGENT_TYPE` 二分——非 fork 代理**零上下文**起步（须像交接新同事一样喂具体路径行号，「绝不委派理解」）；fork **继承上下文 + 共享提示缓存**、给指令而非简报。
- **Plan 模式是分阶段流水线**：Phase 1 Understanding 只并行派 `EXPLORE_SUBAGENT`（数量 `PLAN_V2_EXPLORE_AGENT_COUNT`），Phase 2 Design 派 `PLAN_AGENT`（`PLAN_V2_AGENT_COUNT`），多代理指引**仅当 count>1 时条件注入**；数量按 effort 缩放；回合必须以 `AskUserQuestion` 或 `ExitPlanMode` 收尾。
- **代码审查 = 扇出 → 验证 → 兜底扫**，按 effort 用模板缩放（`code-review-part-3` 正文直写 `${EFFORT}: 5+5 angles × 8 candidates → 1-vote verify → sweep → ≤15 findings`）：low 读一遍 ≤4；medium 3 角度 → 1 票三态验证（CONFIRMED/PLAUSIBLE/REFUTED）→ ≤8 精确偏置；high 3 角度 → 召回偏置 → ≤10；xhigh/max **10 独立角度**（5 正确性 + 3 清理 + altitude + conventions）→ 每候选一验证器 → 兜底扫 → ≤15。**这是「精度/召回旋钮」用模板替换 + 代理数实现，不是不同代码路径。**
- **Coordinator 模式** = 四阶段（研究并行→综合→实现→验证）；coordinator 从不编辑，worker 以 `<task-notification>` XML 用户回合返结果。**安全路由铁律**：用户批准对 worker 自己的安全检查不可见，故已批准的特权动作必须**新派一个代理、引用用户原话 + 按路径给产物**——同意绝不 model-to-model 转述（一道洗白防火墙）。
- **权限门是多级漏斗**：静态 allow/deny → LLM 前缀抽取器 → 绕过分类器 → 严格复核分类器（`<block>` 前强制 `<thinking>`）→ 用户兜底。`command_injection_detected` 哨兵强制人工确认。
- **信任边界门控无处不在**：`webfetch-summarizer` 按 `IS_TRUSTED_DOMAIN` 切换护栏；外部/对等内容一律标「不可信数据、非指令」。

## 3. 工具面与工具使用纪律

- **清单**：文件操作、Bash(+BashOutput/KillShell)、Web、TodoWrite、Task*、AskUserQuestion、Agent/Task(+fork)、Workflow、Plan/Worktree、ToolSearch、Skill、MCP、Artifact、Send*、Cron/Schedule/Monitor、ReportFindings/StructuredOutput、浏览器/computer-use、REPL。
- **按模型分档的工具描述**（结构性线索）：`*-compact` 变体（`readfile-compact`/`grep-compact`…）「服务较新模型」⇒ 引擎**按模型档切换工具描述字符串**。
- **行为纪律**：独立并行/依赖串行；优先专用工具而非 Bash（几十条 `bash-alternative-*` 把 find→Glob、grep→Grep、cat→Read、sed→Edit 改道）；Bash 权限按**抽取前缀**匹配（保留前置 env 赋值与多 token 子命令如 `git commit`）；沙箱流（默认沙箱→带证据失败→`dangerouslyDisableSandbox` 重试→问用户）；fork「别偷看别抢跑」；Snooze `delaySeconds` 相对**5 分钟提示缓存 TTL** 选取（缓存感知调度提示漏进工具描述）；**Workflow DSL**（最深结构揭示）：`pipeline`(无阶段屏障)/`parallel`(屏障)、`meta` 须纯字面量、`schema` 强制 StructuredOutput 校验层重试、`budget` 共享硬 token 上限、`Date.now()`/`Math.random()` **抛错**以保 resume 确定性回放、嵌套仅一层、门控在显式 "ultracode"。

## 4. 功能清单（各有专属提示词）

后台代理 · Auto 模式（`auto-mode-setup` 15001 tks）· Away 摘要 · CLAUDE.md 创建 + `/init`（7589 tks）· 做梦记忆固化（4）+ 文件记忆 · Plan/Ultraplan/Remote plan · Coordinator/worker 团队 + 跨会话对等 · Fork 子代理 · Workflow + Ultracode · 循环（`/loop` cron + 动态节奏 + 自节奏 + monitor 心跳）· 调度（`/schedule`/CronCreate/PR 跟进 cron）· Insights 报告（~11）· 引导生成器 · Skills 系统 · Context tips · Minimal 模式（`CLAUDE_CODE_SIMPLE=1`）· Learning/Focus/Brief 模式 · 安全审查 + 安全监视器 · 代码审查（10 部）+ Simplify + Verify · Design/Cowork/Artifact/Data-viz · 浏览器 & computer use · 托管代理云 API（~30 参考文档）· 状态栏 · 会话搜索 & 标题生成。

## 5. 实现意涵（每条一行）

- 片段合成 + `updatePrompts.js` 变量拼接 ⇒ 请求组装是确定性模板拼接器，系统提示词是拼出来的、不存整块。
- `*-compact`「服务较新模型」⇒ 请求期按模型档选工具描述字符串集。
- LLM bash 前缀抽取器 + `command_injection_detected` 哨兵 ⇒ 权限白名单按命令**前缀**匹配，注入检测走人工确认而非白名单。
- `deny-rule-circumvention-classifier` 点名 `python -c`/`sed -i`/`cat >` ⇒ Edit/Write deny 规则按**效果（文件写）**执行，分类器守 Bash 逃逸口。
- effort 档 = 同代码、不同模板槽 + 代理数 ⇒ 审查精度/召回是一条流水线用 `EFFORT_LEVEL`/`*_COUNT`/上限参数化，非分支代码。
- 验证器 CONFIRMED/PLAUSIBLE/REFUTED + 逐候选代理 ⇒ 验证是单独扇出的一次性投票、按 REFUTED 门聚合，非内联自检。
- 摘要 `no-tools-guard`「工具调用会被拒」⇒ 摘要调用点结构性禁工具（或强制单回合）。
- 状态分类器唯一输出门控 PushNotification ⇒ 通知策略是专用 LLM 分类器的下游消费方，与工作代理解耦。
- Workflow `Date.now`/`Math.random` 抛错 ⇒ workflow 在 resume 时确定性重放；引擎记录代理输出并重跑脚本。
- `schema` → 强制 StructuredOutput 校验层重试 ⇒ 结构化输出在工具调用边界执行（模式不符即重问），非解析模型文本。
- Snooze 延迟绑 5 分钟缓存 TTL ⇒ 提示缓存 TTL 是引擎暴露给模型的一等调度常量。
- Coordinator「引用用户原话新派」⇒ 授权态活在 harness/权限层、**故意不**序列化进 worker 上下文——同意不能 model-to-model 转述。
- fork「共享提示缓存」vs 非 fork「零上下文」⇒ 两条不同子代理构造路径。
- `memory-files-to-attach` 选择器（≤5、首消息目录）⇒ 记忆是两阶段检索：便宜目录 LLM 打分再挂载，非全库注入。

## 6. 这些提示词**推断不出**什么

提示词是字符串常量，对一切确定性脚手架沉默：请求组装顺序 & 缓存断点落位 · SSE/流解析 / 重试退避 / stall 看门狗 · 逐代理模型路由（元数据暗示但无路由表）· 会话存储/JSONL schema/checkpoint & rewind · 压缩触发阈值 · 权限规则求值顺序 & 数据结构 · 工具结果截断上限 / token 记账 / budget 执行内部 · hook 分发 / matcher 引擎 / MCP transport · **片段如何被选中**（条件名可见，解析器引擎侧）· eval 调优理由（数字可见、调优不可见）· 33 变体观测流发射逻辑。

## 7. 置信与三角验证

**这些是「意图」不是「已确认接线」**——提示词说「并行派 10 个角度」证明的是指令，不是引擎真派 10 进程（模型可能串行）。最需交叉核对（对我们公开接口 + 黑盒实测）的头几条：

1. **审查 effort → 代理数/上限映射**：查我们 `effort` 是否接到模板选择；黑盒跑 `/code-review low` vs `max` 数派生代理与上限。我们 COMPAT 列 `effort` 为「接受但忽略」——真缺口。
2. **Bash 权限按抽取前缀匹配非全串**：查 `permissions/classifier.ts`；批准 `git commit -m x` 后测 `-m y` 是否重问。COMPAT 有前缀规则——多半 CONFIRM。
3. **只读并行批处理**：CONFIRM 我们 bucket-1 `Promise.all`。
4. **Workflow 确定性重放**：我们未建 Workflow；若建须沙箱 `Date.now`/`Math.random`。设计约束，非现行。
5. **StructuredOutput = 校验层重试**：CONFIRM 我们 v0.2 `outputFormat` 校验重问 + 重试上限。
6. **压缩 9 段 vs 5 段 & 安全逐字保留**：核我们 `compaction.ts` 是否逐字保留安全约束。
7. **fork 共享缓存 vs 非 fork 零上下文**：核 `subagents/runtime.ts` 的 fork/fresh 分叉是否存在。
8. **按模型档切工具描述串（`*-compact`）**：我们发一套描述不分档——可能是分歧；对我们优先级低（本就自研提示词）。

## 8. 对 bpt-agent-sdk 可落地项（价值/工价排序）

> 按我们工具**适配**、不逐字克隆散文（工程卫生 + 署名；他们的提示词是给他们工具调的，照抄反劣化）。定位已反转为「公开信息再现」，故此处「不克隆」的理由是工程卫生 + 版权，不再是 clean-room 禁令。

1. **代码审查做成 effort 缩放的扇出/验证/兜底流水线**（高价值/中工价）：已有 `/code-review` skill，采其**结构**——N 角度 → 逐候选三态验证 → 兜底扫 → 上限 `ReportFindings`，用我们自己的 `effort` 拨。纯结构、无受保护文本，直击 POSITIONING「行为保真度」缺口。
2. **验证器判词体系（CONFIRMED/PLAUSIBLE/REFUTED + 引证 + 精度/召回翻转）**（高/低）：可复用对抗验证原语，契合 lesson #32 事实采信纪律。
3. **Bash 权限门前置 LLM 前缀抽取器 + 注入哨兵**（高/中）：`classifier.ts` 已有前缀规则，补 `command_injection_detected` 失败转人工 + `sed -i`/`cat >` 绕过分类器。安全硬化、来源清晰。
4. **两阶段记忆检索（目录打分选择器、≤5 挂载）**（高/中）：映射银芯 `kb_*` + `memory/*.md`——挂载前先便宜 LLM 相关性门过「文件名+描述」目录，而非全注入。强化 §4 数据层纪律。
5. **片段合成提示词构建器 + 模型档/信任边界条件位**（高/高）：`systemPrompt:{type:'segments'}` seam 已在，正式化片段表 + `IS_TRUSTED_DOMAIN` 标志 + `*-compact` 档切。复利缓存效率（gear ①）。
6. **确定性重放编排 DSL**（中/高）：若建 Workflow 采 `pipeline`(无屏障)/`parallel`(屏障) + 共享 token `budget` + 沙箱非确定性。大工程，按「选择性追踪」延后。
7. **后台代理状态分类器门控通知**（中/低）：四态分类器唯一输出「该不该 ping」，解耦可复用。
8. **摘要 no-tools 守卫 + 逐字保留压缩**（中/低）：硬化 `compaction.ts`，摘要调用点禁工具 + 跨压缩逐字保留安全约束（CJK 感知）。
9. **同意不可转述防火墙**（中/低）：扩 `SendMessage`/子代理时，绝不把批准序列化进 worker 上下文；特权动作引用用户原话 + 按路径给产物重派。结构性安全，镜像 §1.1-HC 单向纪律。

**三角小结**：提示词强 **CONFIRM** 我们 v0.2 的结构化输出重试、只读并行、前缀权限、压缩；**EXTEND** 我们只勾勒过的具体流水线形（effort 缩放审查、目录记忆检索、注入哨兵门控）；**CONTRADICT** 我们已建的一切均无——分歧（Workflow DSL、模型档工具串、33 变体流）恰是 POSITIONING 故意不追的 CLI 耦合长尾。
