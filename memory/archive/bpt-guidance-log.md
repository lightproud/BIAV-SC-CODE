# BPT 指导搬运日志

> 最后更新：2026-04-28 by Code-BPT 会话（W18 第 3 轮：3 验收答复 + 高幻觉率应对发起）
>
> **⚠ 定日志注（2026-07-10 对账补）**：本日志 W18 后停更；Code-BPT 多会话角色已于 2026-06 退役
>（现为单一艾瑞卡会话），指导线现状见 `memory/bpt-guidance-protocol.md`（v0.7）。本档保留为历史记录。
>
> 用途：每轮搬运的主题 / 日期 / 成果概要，**一行一条**，按 ISO 周倒序。Code-BPT 沉淀机制依据 `memory/bpt-guidance-protocol.md` §五。
>
> 填写规则：
> - **格式**：`| W?? | YYYY-MM-DD | 主题 | 守密人输入 | Code-BPT 产出 | 沉淀路径 |`
> - **守密人输入**：周报 / 反馈包 / Q1-Q3 简要主题，不复述全文
> - **Code-BPT 产出**：搬运包主题 + 落盘文件链接（如有）
> - **沉淀路径**：lessons-learned.md #N / decisions.md / 仅本 log / 上呈主控台

---

## 2026-W18（2026-04-27 ~ 2026-05-03）

| 周 | 日期 | 主题 | 守密人输入 | Code-BPT 产出 | 沉淀 |
|----|------|------|-----------|--------------|------|
| W18 | 2026-04-27 | Code-BPT 角色启用 + 协议 v0.2 + 架构基线快照 + 周报模板首版 | 守密人指令「新起 Code-BPT」 | `decisions.md` 角色决策 / `bpt-guidance-protocol.md` v0.2 / `bpt-architecture-snapshot-2026-04-19.md` / `bpt-architecture-summary-template.md` | decisions.md 已写 |
| W18 | 2026-04-28 | W18 周报反馈包接收（首份真实搬运循环） | r340 / r343 / r344 三 commit + SDK 迁移进度 + 模板缺陷反馈 + decisions.md 归档询问 | 模板 §2.2/§2.2bis/§2.3 补正 / lessons-learned #31（上游 framework high-churn）/ 答疑 decisions.md 边界 / 下周计划无偿建议 | lessons #31 + 本 log + 模板 v0.2 |
| W18 | 2026-04-28 | 事实采信纪律 3 条硬规则（W18 周报抓包 4 层根因） | 守密人转述 BPT 实例自省 + 协议层落地诉求 | lessons-learned #32 / CLAUDE.md §9 提级第 13 条 R1/R2/R3（**仅银芯端生效**，BPT 内网未搬运） | lesson #32 + CLAUDE.md §9 |
| W18 | 2026-04-28 | 3 验收问题答复接收 + 高幻觉率系统问题发起 | 守密人复述 BPT 答复：(Q1) 04-23 Q1 = BPT 内部架构决策（不上呈） + 标「接口潜在约束」备注；(Q2) W19 跑 ≥1 次 10 轮 baseline；(Q3) W19 周报 §4.2 加 Hooks 19 种价值评估表 | 接收答复 + 抛出 3 核实问题（模型/场景/CLAUDE.md 存在性）等待回包 | 仅本 log（W19 commitment 待兑现） |
| W18 | 2026-04-28 | 高幻觉率应对搬运包 W18-3（核实回包 → 5 步落地方案） | 守密人转述 BPT 实例：幻觉率 5-10% / opus 4.7 / 内网无 CLAUDE.md | 搬运包 5 步：BPT 内网 CLAUDE.md 首版可粘贴文本（§1 R1/R2/R3 + §2 合法 escape + §3 双列硬约束）/ system prompt 事实采信片段 / 周报模板双列改造 / temperature 锁定 / Code-BPT 接收端核验 SOP | 仅本 log（搬运包待守密人执行） |

---

## 沉淀路由说明（来自 §五）

不同性质的反馈走不同档案：

| 反馈类型 | 沉淀路径 | 由 Code-BPT 自行还是上呈主控台 |
|---------|---------|-----------------------------|
| BPT 内部架构决策（commit 选型 / SDK API 用法 / 数据库表结构） | **本 log 一行 + 不写 decisions.md** | 自行 |
| 通用教训（其他子项目也可能踩） | `memory/lessons-learned.md` 加条 | 自行 |
| 跨子项目接口变化（影响银芯-BPT 数据流向 / silver-blackpool-interface） | `memory/decisions.md` | **上呈主控台裁定** |
| Phase 边界 / 战略时序变更 | `memory/decisions.md` + `memory/strategic-plan-2026.md` | **上呈主控台裁定** |
| 周报里的数值类事实（LOC / cache hit / token 数） | **不沉淀**（避免噪音，仅做趋势观察） | — |

按协议 §六 #3：「BPT 的内部决策不入银芯档案——只有守密人公开认可并搬回银芯的**经验**才沉淀」。这里的关键是**经验**（lesson）vs **决策**（decision）的区分：BPT 内部决策走本 log；从决策中提炼出的通用教训走 lessons-learned.md；只有跨子项目接口或战略级才碰 decisions.md。

---

## 接口潜在约束备注（watch list）

记录虽属 BPT 内部决策、但**可能在未来产生跨边界影响**的项。当任一项的语义发生扩张（从纯内部 → 接口层），立即上呈主控台。

| ID | 起源 | 当前语义（守密人裁定） | 潜在扩张语义（需上呈触发条件） | 状态 |
|----|------|---------------------|-----------------------------|------|
| 04-23 Q1 | BPT 否决"外部 MCP 注入 SDK" | BPT 不主动 inject 任何外部 MCP server，仍可走「BPT 自行 spawn 银芯 mcp_server.py 暴露为 tool_use」消费银芯能力 | 若进一步演化为「BPT 完全断绝 MCP 协议消费」（含银芯 mcp_server.py），则影响 silver-blackpool-interface 数据消费层，必须上呈主控台 + 改 `silver-blackpool-interface.md` | 🟢 watching（W18 守密人确认未扩张） |

---

## W19 待兑现 commitments（来自守密人 W18 第 3 轮答复）

| ID | 来源 | 内容 | 截止 | W19 周报核验点 |
|----|------|------|------|--------------|
| C1 | W18 验收 Q2 | BPT 跑 ≥ 1 次 10 轮 token 预算 baseline（手动触发 + SDK usage 汇总，不等 P1-A） | W19 周报 | §3 Token 经济实测**不再标「本周不采集」**，至少 1 行实测数据（即使不达标） |
| C2 | W18 验收 Q3 | Hooks 19 种未接入价值评估表 | W19 周报 | §4.2 新增小节，每条 1 行：是否对 BPT 用户场景有用 / 实现成本 / 优先级 |
| C3 | W18 lesson #32 衍生 | R1/R2/R3 搬运到 BPT 内网 CLAUDE.md（搬运包 W18-3 已交付，5 步方案可粘贴） | W19 前段 | BPT 内网 CLAUDE.md 落地 commit SHA + 至少 1 次跑通 |
| C4 | 搬运包 W18-3 衍生 | 周报模板双列改造（事实 \| 来源工具调用），未填来源 = ⚠待补不得报数 | W19 周报 | 模板新版 + W19 周报每条 numbered fact 配源 |
| C5 | 搬运包 W18-3 衍生 | Code-BPT 接收端核验 SOP：W19 周报到达时主动抽样 3-5 条 numbered fact 要求补证据 | W19 周报到达 | 由 Code-BPT 自行执行（不需守密人动作） |
