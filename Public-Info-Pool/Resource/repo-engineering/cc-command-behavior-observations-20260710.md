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
P2（展开型对照样本，验证四分类判据）：`/loop`（观测其解析与调度注册行为，恰是 R3 的
官方参照）`/review`；破坏性命令（`/clear` 会清上下文）建议放在专用观测会话或作为
某次会话的最后一条。

> 追加观测：直接在本档案续 OBS-NNN 条目；重大机制发现（如 /goal 这类改变架构认知的）
> 同步 `memory/decisions.md` 或需求档修订。
