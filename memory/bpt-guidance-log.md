# BPT 指导搬运日志

> 最后更新：2026-04-28 by Code-BPT 会话（首条记录）
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
