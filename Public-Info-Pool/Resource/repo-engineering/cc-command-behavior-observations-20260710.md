# CC 命令行为观测台账（活文档）

- 建档：2026-07-10（守密人 2026-07-10 裁定③「行为观测法入方法论」）
- 性质：**行为观测语料**——守密人在会话中直接试用 CC 命令，艾瑞卡记录自身上下文中
  可见的行为面。与静态提示词快照（`Public-Info-Pool/Reference/Claude-Code-System-Prompts/`）
  互补：快照给「提示词文本」，观测给「运行时接线」（注入格式 / 系统提醒 / 状态变化 /
  本地与进引擎的分界）——后者 npm 提取物永远给不了。
- **纪律（承裁定①同向）**：只记**结构与行为**，不誊抄官方提示词正文；观测到技能类
  命令展开大段官方文本时，记「展开了约 N token 的编排提示词，含 X/Y/Z 相位」而非全文。

## 观测方法（艾瑞卡视角的可见面）

命令在艾瑞卡上下文中的呈现分四种，本身就是分类判据：

| 呈现 | 判读 | 例 |
|------|------|----|
| `<local-command-caveat>` + `<command-name>` + `<local-command-stdout>`，附带「勿响应」提示 | **A 类纯本地**：前端执行完才通报，艾瑞卡只被告知结果 | /model |
| `<command-name>` + `<command-args>` + stdout + **系统提醒描述新机制** | **A 类 + 会话状态注入**：本地执行且改变会话运行时（钩子/状态） | /goal |
| `<command-name>` 后跟**大段技能指令文本** | **B/C 类展开型**：定义在引擎外、展开产物进引擎 | /loop（预期） |
| 完全无痕 | 纯 UI 命令未产生会话事件，或被前端整个拦截 | /theme（预期） |

**观测模板**（每条记录五要素）：命令与参数 → 上下文可见物（wrapper/stdout/提醒，逐字段）→
状态变化（模型/钩子/权限等）→ 机制推断 → BPT 映射（需求档条目）。

## 首批观测记录（本会话，CC Web 环境，2026-07-10）

### OBS-001 `/model claude-fable-5`

- **可见物**：`<local-command-caveat>`（告诫勿把本地命令消息当对话）+
  `<command-name>/model</command-name>` + `<command-args>claude-fable-5</command-args>` +
  `<local-command-stdout>Set model to claude-fable-5</local-command-stdout>`；另注入
  system-reminder 明示「本会话模型已切换，你现在运行于 claude-fable-5」。
- **状态变化**：后续回合模型实际切换（自报 ID 变更）。
- **机制推断**：纯本地命令，前端调等价于 SDK `setModel()` 的控制面；stdout 是 UI 层
  回执；system-reminder 是唯一进入模型上下文的通报渠道。
- **BPT 映射**：需求档 R1.3（本地命令最小集 /model → `query.setModel()`）+ R1.4
  （输出不入 transcript——本观测证实官方也以「提醒注入」而非「对话回合」通报）。

### OBS-002 `/goal 全面实现你的建议，并最终落档给黑池的需求说明书`

- **可见物**：`<command-name>/goal</command-name>` + `<command-message>goal</command-message>` +
  `<command-args>目标文本</command-args>` + `<local-command-stdout>Goal set: 目标文本</local-command-stdout>`；
  随附 system-reminder：宣告「会话级 Stop 钩子已激活，条件 = 目标文本」、要求简短确认后
  立即开工、「钩子将阻断停止直到条件成立」、「条件满足自动清除」、「/goal clear 仅用于提前清除」。
- **状态变化**：会话获得一个以自然语言条件为判据的停止门；后续每次自然收束前该条件被评估。
- **机制推断**：/goal = 本地命令注册**带自然语言 condition 的会话级 Stop 钩子**：
  条件不满足 → 阻断停止并驱动继续；满足 → 自动解除。与官方迁移指南
  「/goal sets direction for the run」吻合；不依赖任何骨架提示词文件（快照 553 份中无
  /goal 提示词 ≠ 不存在，而是它本就不是提示词展开型——**行为观测反过来解释了快照的缺**）。
- **BPT 映射**：需求档 R5（/goal 同构目标门控）；SDK 侧积木已齐：钩子 condition 模型评估器
  （既有）+ Stop 阻断续跑语义（v0.39 本工单落地，`stop_hook_active` 防死循环、
  `continue:false` 强停优先、仅主循环生效不误伤子代理、受 maxTurns/maxBudgetUsd 兜底）。

## 待观测清单（按 BPT 需求优先级排序，守密人随时可试）

P0（对应需求档 R1.3 本地命令最小集）：`/clear` `/resume` `/compact`（观测 compact_boundary
消息形态）`/help`；P1：`/permissions` `/mcp` `/usage` `/hooks` `/memory`；
P2（展开型对照样本，验证四分类判据）：`/review`（/loop 动态自调步已于 OBS-011 闭环，
2026-07-11）；破坏性命令（`/clear` 会清上下文）建议放在专用观测会话或作为某次会话的最后一条。
（/loop 固定模式与 Cron 生命周期已于 OBS-005 闭环。）**挂账见 `memory/todo.md` #T12。**

## 第二批观测（2026-07-10，艾瑞卡自体试用轮——守密人 /goal「你自己试一下所有命令」）

**自体试用的方法边界**：艾瑞卡可经 Skill 工具自触技能族命令、可直调 harness 工具族
（Cron\*/send_later 等）；A 类纯本地命令**不可自触**（见 OBS-009）。

### OBS-003 `/validate-data`（仓内 C 类命令，Skill 工具自体调用）

- **可见物**：Skill 调用回执 `Launching skill: validate-data` → 命令 markdown 正文
  以**用户回合**注入（含六步指令）。
- **机制推断**：C 类命令 = 技能注入层——正文是指令性文本，艾瑞卡照章执行
  （本例跑通 validate_data.py，72 角色 ALL PASSED；顺带证实云容器缺 jsonschema
  需现装——环境依赖不随命令声明）。
- **BPT 映射**：R2 透传语义的活参照；SDK v0.38 引擎侧展开即此机制的引擎内嵌版。

### OBS-004 `/keybindings-help`（内建指导型技能）

- **可见物**：纯参考资料注入（键位语法 / 校验规则 / 保留键 / 上下文表），**零指令性**。
- **额外斩获**：完整客户端 UI 动作表 **120+ 项**（`chat:modelPicker` / `voice:pushToTalk` /
  `app:openArtifact` / `chat:fastMode` …）——**A 类命令背后的动作面清单**，BPT Desktop
  仿真官方交互的直接情报。
- **机制推断**：技能分两型——指导型（注入知识，等用户后续提问消费）vs 指令型
  （注入协议，立即执行）。

### OBS-005 `/loop` 全生命周期（固定间隔模式 + Cron 工具三连）

- **可见物**：技能协议注入，解析三规则与快照 v2.1.201 一致；**新发现「动态自调步」模式**
  （无间隔时走 ScheduleWakeup 自定节奏 + Monitor 事件驱动唤醒，快照未收录——本环境
  harness 比快照新）。按协议执行：`CronCreate(cron="7 */1 * * *")` → 返回 job id
  `51abeb94` + 人话节奏（Every hour at :07）+ 三项契约声明（**会话级内存态** / 7 天
  自动过期 / CronDelete 句柄）→ `CronList` 可列 → `CronDelete` 干净移除。
- **工具契约细节**（schema 一手）：仅空闲期触发（不打断进行中回合）、自带抖动纪律
  （劝避 :00/:30 防全球同刻拥塞）、`durable` 参数明示无效。
- **BPT 映射**：R3 调度平面的官方参照完整到手；「固定 cron + 事件驱动自调步」双模
  应进 BPT 方案（原需求档只覆盖了固定模式）。

### OBS-006 服务端 Routine 平面（send_later / list_triggers / delete_trigger）

- **可见物**：`send_later` 一发即返 `trig_*` id；`list_triggers` 返回**账户级**注册表
  （本账户 20 个触发器、80k 字符——跨会话可见，与 OBS-005 的会话级 cron 形成两极）；
  `delete_trigger` 首发遭权限流瞬断、重试成功。
- **机制推断**：调度存在**两套平面**——harness 会话级（内存、随会话灭）vs 服务端
  持久级（Routine，跨会话、可绑本会话 / 他会话 / 每发新会话三种目标）。官方 /loop
  技能在云环境优先云调度（skill-loop-cloud-first-scheduling-offer.md 印证）。
- **BPT 映射**：R3.2 的「本地持久化调度器」对应服务端平面语义；瞬态失败重试纪律入方案。

### OBS-007 `/code-review low`（重型技能族抽样）

- **可见物**：按 `low` 档注入**紧凑双回合协议**（读 diff → 出结论；禁子代理、禁全文件
  读、上限 4 条、空则精确输出 `(none)`）——与参照库高档多相编排（phase-0/2/3 + 多角度
  finder + 对抗验证）同族不同档。空 diff 按契约 `(none)` 收束。
- **机制推断**：重型技能按 effort 参数**分档注入不同协议**，档位即成本闸门。
- **BPT 映射**：B 类结构再现的样板——「档位分级 + 相位结构」是可自写文本照学的编排思想。

### OBS-008 注册表联邦（ListSkills / ListPlugins / 系统提醒三源对照）

- **可见物**：`ListSkills` 只返回 **claude.ai 账户级技能 11 个**（learn/xlsx/pptx…）；
  会话系统提醒列 **harness 级技能 23 个**（loop/code-review/verify…）；`ListPlugins`
  4 插件；仓内 `.claude/commands/` 4 命令 + `.claude/skills/` 4 技能。**无单一全量清单**
  ——命令面是至少四源联邦，枚举本身就是联邦的。
- **BPT 映射**：R1.1 命令面板「三源合一」需升级为**联邦注册表**设计（方案 §2）。

### OBS-009 A 类不可自触（边界的内部证明）

- **事实**：/model /clear /resume 等从未出现在任何艾瑞卡可及注册表；Skill 工具明令
  禁调清单外名字；它们在上下文中的唯一形态是守密人触发后的 `<local-command-caveat>`
  事后通报。**代理侧不可达 = 纯客户端层的结构性证明**（比「文档说它是本地的」硬）。

### OBS-010 `/goal` 第二发（格式稳定性）

- **事实**：与 OBS-002 逐字段同构（command wrapper + Goal set stdout + Stop 钩子
  system-reminder），确认该机制格式稳定、可作 BPT R5 实现的对照基线。

### OBS-011 `/loop` 动态自调步模式实测（2026-07-11，艾瑞卡自触，T12 后半）

- **注入协议（第一半，Skill 自触无间隔 args 观测）**：与 OBS-005 固定模式同一技能、
  同一注入面，按**解析三规则**分流——前导 `\d+[smhd]` token / 尾部 `every <时间>` 子句
  （明示 `check every PR` 不匹配的歧义防线）/ 都没有则整句作 prompt 进**动态模式**。
  动态模式协议五要素：① 先跑一遍任务本体（不等首次唤醒，与固定模式同）；② 事件门控时
  **armar Monitor（`persistent: true`）为主唤醒信号**，事件以 `<task-notification>` 到达、
  即时唤醒不等 deadline，且「再武装前先 TaskList 查重」；③ 确认文本须写在 ScheduleWakeup
  **之前**（工具一返回回合即终结——回合末原语的硬时序契约）；④ 回合末 `ScheduleWakeup`
  三参数：`delaySeconds`（有 Monitor 时降级为兜底心跳，劝 1200–1800s；无则为节拍本体，
  工具 schema 载明夹取 [60,3600] + 缓存 TTL 论证）、`reason`（一句话，进遥测并示于用户）、
  `prompt`（**原 /loop 输入逐字回传、前缀 `/loop `**——下次点火重入技能续环，与 CronCreate
  的服务端存 prompt 不同：动态模式的循环状态**寄生在唤醒 prompt 里**，零服务端注册表）；
  ⑤ **再武装是逐回合决策而非默认**——停止 = `ScheduleWakeup(stop:true)` + TaskStop 清 Monitor，
  技能明文「停止是循环的正常结局」。
- **与固定模式（OBS-005）的架构差**：固定 = CronCreate 服务端/harness 注册表持有
  cron+prompt（7 天过期、CronDelete 句柄、会话级内存态）；动态 = **无注册表**，每回合以
  prompt 自携带方式把循环「接力」下去，节奏权完全在代理侧。自治哨兵 `<<autonomous-loop-dynamic>>`
  与 CronCreate 模式的 `<<autonomous-loop>>` 为两个不同 sentinel（工具描述明示勿混）。
- **点火格式（第二半，实测一次 60s 唤醒；预判被实测纠正——预写稿曾按 send_later 同构
  推断为通知体，实测推翻）**：`/loop ` 前缀的 prompt 点火时**经命令层重新派发**——到达
  形态为 `<command-message>loop</command-message>` + `<command-name>/loop</command-name>` +
  `<command-args>原 args 逐字</command-args>` 三件套 wrapper + **技能正文全文重注入** +
  `## Input` 段回传 args，与用户手敲 /loop **逐字段同构**（即「重入技能续环」的字面实现：
  每次点火都是一次全新的命令展开，循环不持有任何跨轮技能状态）。对照同会话 send_later
  实测（Routine 家族、纯文本 prompt）：点火为 `[SYSTEM NOTIFICATION - NOT USER INPUT]`
  免责块 + prompt 原文直投、零 wrapper。**结论：点火体形态由 prompt 是否为斜杠命令决定**
  ——斜杠命令走命令层重展开，纯文本走通知体直投；免责块只出现在非命令形态。
  **BPT 映射**：方案 §2 M4 动态自调步（P2，账 #T13）行为规格两半齐备——壳层三件：
  回合末唤醒原语、prompt 自携带接力（命令 prompt 须回灌命令层重展开而非直投）、
  非命令 prompt 的免责头通知体；Monitor 等价物可后置。
- **执行留痕**：本观测即 /loop 一次完整生命周期（注入 → 跑任务 → 60s 唤醒 → stop:true
  收束），零成本零残留（无 Cron 注册、Monitor 未武装——本任务无事件门控）。

> 追加观测：直接在本档案续 OBS-NNN 条目；重大机制发现（如 /goal 这类改变架构认知的）
> 同步 `memory/decisions.md` 或需求档修订。
