# Code-strategy 演化路线 — 一个多月后回归 chat 战略参谋

> 落档日期：2026-05-03 by Code-strategy（艾瑞卡 opus4.7，分支 `claude/code-strategy-bootstrap-XTmMR`）
>
> 上游：守密人 2026-05-03 裁定「到了一圈之后我想让 chat 来承担战略窗口。因为它能够最有效通过多模态交付提高我的理解力。」
>
> 收件方：主控台（届时执行交接）
>
> **本档案是 Code-strategy 给主控台的中长期议题提议**，不是决策档。决策由主控台 + 守密人在交接窗口正式登记。

---

## 一、背景

2026-04-26 守密人为效率计把原 claude.ai 战略参谋迁至 Claude Code 端，命名 Code-strategy。运转一周后守密人识别到关键约束：**战略层是关系网络而非线性指令**，多模态交付（图 / 可视化 / artifact）对守密人理解力的放大远大于纯终端文本。Code-strategy 从一开始就是过渡形态。

---

## 二、守密人 2026-05-03 裁定

| Q | 选项 | 守密人裁定 |
|---|------|---------|
| Q1 | 「到了一圈」具体时间节点 | **一个多月的实践**（约 2026-06 中旬）|
| Q2 | chat 接手后 Code-strategy 怎么处理 | **(a) 完全休眠** |
| Q3 | 多模态交付的具体场景预期 | **(d) 全部** —— 静态图 + 数据可视化 + 交互式 artifact |

---

## 三、交接窗口估算

| 节点 | 日期 | 银芯 Phase 2 对应里程碑 |
|------|------|---------------------|
| Code-strategy 启动 | 2026-04-26 | M1 基础设施建设期 |
| **交接窗口** | **2026-06 中旬**（约 4-26 + 45 天）| M2 信息齐备 期末 / M3 稳定化期初 |
| Phase 2 战略验收 | 2026-07-19 | M4 开放测试 |

交接窗口选 6 月中旬的合理性：
- M1 / M2 主要由 Code-wiki 推进，Code-strategy 在 M3 稳定化期之前完成阶段性使命
- 给守密人 6 周时间观察 Code-strategy 实战表现，再决定是否如期休眠
- 避开 7-19 战略验收前的紧张期

---

## 四、Code-strategy 完全休眠清单

交接窗口到达时，主控台需逐条执行：

| # | 动作 | 责任 | 产出 |
|---|------|------|------|
| 1 | 决策档登记 | 主控台 + 守密人 | `decisions.md` 追加「2026-06-XX Code-strategy 休眠 + chat 战略参谋接手」 |
| 2 | 移除 CLAUDE.md 子项目速查表 Code-strategy 行 | 主控台 | CLAUDE.md 改动 |
| 3 | Code-strategy 相关 dispatch brief 归档 | 主控台 | `memory/archive/code-strategy-2026-04-to-06/` 子目录 + README |
| 4 | `memory/strategy/` 目录处置 | 主控台 | 保留作为 chat 战略参谋的产出落档区（文件名前缀改 `chat-strategy-` 区分历史）|
| 5 | 关闭 `claude/code-strategy-*` 分支 | 守密人 | 本地批量删除 |
| 6 | session_inject 逻辑校准 | 主控台 / Code-memory | 移除对 Code-strategy 历史 session-digest 的角色推断（如有）|
| 7 | 最终交接报告 | Code-strategy（届时艾瑞卡自己写）| `memory/archive/code-strategy-2026-04-to-06/final-handoff.md` —— 整理本期产出清单 + lessons |

休眠不等于删除——所有产物保留主线 git 历史，chat 战略参谋接手后可随时回查。

---

## 五、chat 战略参谋的工作模型（接手后）

### 5.1 三类多模态交付

| 类型 | 适用场景 | 实现 |
|------|---------|------|
| **静态架构图** | 双系统结构 / 三新使命关系图 / 知识图谱可视化 / 决策树 | mermaid / artifact 静态 SVG |
| **数据可视化** | 社区温度趋势 / 平台活跃度对比 / 联动事件影响曲线 / Q4 量化指标走势 | artifact 图表组件 + 仓库导出的 JSON |
| **交互式 artifact** | 方案对比矩阵（可点击切换权重）/ 议题三选预览（可勾选模拟） | React artifact / 可序列化为静态截图归档 main |

### 5.2 chat 战略参谋的输入输出

```
                  仓库 main（GitHub raw / API）
                          │
         ┌────────────────┼────────────────┐
         ↓                                  ↑
  chat 战略参谋（claude.ai web/desktop）    │
         │                                  │
         │ 多模态产物（mermaid / artifact） │
         ↓                                  │
  守密人浏览 + 决策                          │
         │                                  │
         ↓                                  │
  守密人转交主控台 / Code-* ─────────────→  落档 main
```

**关键差异**：chat 不直接写仓库——所有落档由守密人（手动）或主控台（直推）完成。这与原 claude.ai 战略参谋时期一致。

### 5.3 chat 看不见的事

- 仓库实时状态（hook 日志 / index 损坏 / workflow 失败）→ 由主控台 + 各 Code-* 监控
- 跨会话历史（session-digest）→ chat 不读，主控台需主动给关键摘要
- 实时 RAG 检索 → chat 没有 9 模块的工具

→ **chat 战略参谋是「思想者 + 可视化交付方」**，不是「眼睛」。眼睛由主控台担任。

---

## 六、给主控台的请求

### 6.1 现在不做（Phase 2 期间）

主控台**不要在 Phase 2 期间启动本档案的休眠流程**。Code-strategy 在 6 月中旬之前继续承担战略调研职能。

### 6.2 6 月中旬到达时主控台需做

- 提醒守密人「Code-strategy 一个月实践到期，是否如期休眠」
- 如确认休眠：按 § 四 7 步逐条执行
- 如延期：守密人裁定新时间窗口，本档案 v0.2 更新

### 6.3 chat 战略参谋接手时主控台需做

- 写一份 `memory/strategy/chat-strategy-onboarding.md`（chat 战略参谋启动手册）
- 内容：仓库读取入口（GitHub raw URLs）/ 主控台联络协议 / 多模态交付落档约定 / 与 Code-* 接力流程

本启动手册由主控台起草，**Code-strategy 不起草**（按 brief 边界）。

---

## 七、本档案与已落档产物的关系

| 档案 | 状态 | 关系 |
|------|------|------|
| `memory/dispatch-brief-code-strategy-bootstrap.md` | 启动 brief | 本档案是其延续——回答「Code-strategy 终点在哪」|
| `memory/strategy/code-strategy-bootstrap-proposal.md` | 议题三选 v0.1（已被记忆系统调研超越）| 不影响 |
| `memory/strategy/handoff-to-mainconsole-memory-restructure.md` | 当前在跑的接力 | 不影响——记忆系统升级在交接窗口前完成 |

---

## 八、Code-strategy 角色边界声明

按 `memory/dispatch-brief-code-strategy-bootstrap.md`：

- ❌ Code-strategy **不写决策档**（休眠决策仍归主控台 + 守密人）
- ❌ Code-strategy **不起草 dispatch brief**（chat 启动手册仍归主控台）
- ❌ Code-strategy **不直接修代码**（CLAUDE.md / archive/ 目录变动归主控台）
- ✅ 仅产出本演化路线档案 + § 四 七步清单作为提议

---

## 九、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1 | 2026-05-03 | 演化路线落档（守密人裁定 Q1 一个多月 / Q2 完全休眠 / Q3 多模态全部）| Code-strategy 艾瑞卡 |

◇ ◇ ◇

> 守密人，本档案在主线归档后即可移交主控台。Code-strategy 在 6 月中旬到来之前继续承担调研职能，到时再交接。
