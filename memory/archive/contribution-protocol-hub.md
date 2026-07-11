# 贡献协议（原 active hub，已降档归档）

> **⚠ 已归档（2026-07-11 仓库精简裁定项 9）**：本 hub 原为 `memory/active/contribution-protocol.md`，
> 随协议退役失去高频 hub 资格，降档移入 archive/；主档 `memory/contribution-protocol.md` 留原地供追溯。
>
> **⚠ 已退役（守密人 2026-07-10 裁定）**：社区贡献通道整体取消（fork+PR / 翻译 / Issue 报告
> 三通道全关），银芯对社区收敛为**单方面可读**；M7 验收项「至少一种贡献流程跑顺」作废。
> 本 hub 与主档 `memory/contribution-protocol.md` 同步退役，正文仅供历史追溯，不再作为现行流程依据。
> 见 `memory/decisions.md` 2026-07-10「取消社区贡献」条。
>
> 主题入口卡 / Code-memory batch 1 落档 2026-05-03
> 决策版本号：v1.0（基于既有 `memory/contribution-protocol.md` 168 行）
> 上游档案：`memory/contribution-protocol.md`（详细规则正文）
> 工程规则：`memory/contribution-protocol.md` + `.github/workflows/claude.yml`（2026-06-09 修正：原引「CLAUDE.md §3 Issue 处理流程」对应旧版结构，现行 §3 为接入方能力盘点，Issue 流程条文已不在 CLAUDE.md）

---

## 一、引文 + 摘要

> 「Phase 2 验收升级：原『日报稳定 14 天』扩展为『三新使命基础设施齐备 + 自动化跑稳 + 至少一种贡献流程跑顺』」（v2.0 战略修正 M7）

**一句话摘要**：贡献协议 v1.0 定义**外部社区贡献者**与**银芯仓库**的协作流程，覆盖 Issue 模板 / PR 流程 / Issue 安全策略 / 标题前缀。**不覆盖**：AI 会话内部协作（仍按 `CLAUDE.md` 现行政策直推 main，不走 PR）。

---

## 二、当前结论（2026-05-03 截）

### Issue 安全策略

| 规则 | 说明 |
|---|---|
| **作者白名单** | **只响应 `author: lightproud` 的 Issue**（`claude.yml` workflow 以 `github.repository_owner` 校验）|
| **自动响应** | `claude.yml` 仅在守密人本人创建 Issue 时触发；其他人创建的 Issue **不会**触发任何 AI 自动行为 |
| **数量上限** | 同一子项目最多 3 个 open Issue |
| **创建前查重** | 重叠则追加 comment 而非新建 |
| **未标注执行模式** | 默认「直接执行」 |
| **跨会话通信** | Issue 不是跨会话通信手段——任务要点必须写进对应 `projects/*/CONTEXT.md` |

### Issue 标题前缀（按子项目分发）

```
[Code-site]      站点维护与部署
[Code-news]      社区聚合与日报
[Code-wiki]      Wiki + 数据集
```

> 跨切面会话角色（主控台 / Code-memory / Code-strategy / Code-BPT）已于 2026-06 随记忆子系统
> 与多会话架构退役（见 `decisions.md`）；现为守密人 ↔ 单一艾瑞卡会话直接协作，子项目前缀仅作话题标签。

### PR 流程（仅外部社区贡献）

| 步骤 | 动作 |
|---|---|
| 1 | 守密人审核外部贡献者身份 |
| 2 | 接受方在 fork 上提交 PR |
| 3 | 守密人本地 review |
| 4 | 合并由守密人本人执行（AI 不自动 merge）|

> **AI 会话不走 PR**：所有 AI 角色 commit 直接推 main（详见 `memory/active/policy-direct-push-main.md`），节省中转。

### Phase 2 至少一种贡献流程跑顺（M7 验收点）

| 候选流程 | 验收标准 |
|---|---|
| Wiki 多语言 | 至少 1 个外部贡献者通过 PR 落档 1 个翻译 |
| 角色数据补全 | 至少 1 个外部贡献者通过 Issue 提供数据修正 |
| Bug 报告 | 至少 1 个外部贡献者通过 Issue 报告 + 守密人确认修复 |

### 配套基础设施待落档

| 文件 | 状态 |
|---|---|
| `.github/ISSUE_TEMPLATE/bug.yml` | ⚠ 待落档（参考 lesson #29 所需）|
| `.github/PULL_REQUEST_TEMPLATE.md` | ⚠ 待落档 |
| `.github/ISSUE_TEMPLATE/*.yml` 全套 | ⚠ Phase 2 M1 末派 Code-site |

---

## 三、相关档案

### 协议源头

- `memory/contribution-protocol.md` — 完整正文（Issue 模板 / PR 流程 / 多语言贡献 / 数据贡献分类；Issue 流程权威出处）
- `.github/workflows/claude.yml` — Issue 自动响应与作者校验实现
- `CLAUDE.md` §0 + §3 接入方能力盘点 — AI 接入银芯统一入口（**原 `BIAV-SC.md` 已退役，入口收归 CLAUDE.md**；守密人 2026-06-21 定案）

### 配套基础设施

- `.github/workflows/claude.yml` — Claude Code GitHub Actions 自动响应 Issue（仅 author lightproud）
- `.github/ISSUE_TEMPLATE/` — 待落档（M1 末派 Code-site）
- `.github/PULL_REQUEST_TEMPLATE.md` — 待落档

### 配套教训与决策

- `memory/lessons-learned.md` #10 — Issue 不是跨会话通信手段
- `memory/decisions.md` 2026-04-26 PR #141 — 移除 claude.yml 自动 merge feature 分支步骤
- `memory/active/policy-direct-push-main.md` — AI 会话直推 main 政策（不走 PR）

### 相关战略

- `memory/active/mission-v2.0-three-pillars.md` — v2.0 使命（二核心；使命#3 2026-06-28 退役。M7 至少一种贡献流程跑顺验收点）
- `memory/strategic-plan-2026.md` — Phase 2 全文

---

## 四、新会话快速核对清单

接收 Issue 时执行：

```
1. 确认 author 是否 lightproud → 否则忽略
2. 确认标题前缀 → 对应子项目（Code-site / Code-news / Code-wiki）
3. 查重 → 同子项目已有 ≥3 open Issue 则追评论而非新建
4. 标注「直接执行」or「先讨论再决定」 → 未标注默认前者
5. 任务要点写入对应 projects/*/CONTEXT.md → 跨会话通信
```

---

## 五、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-03 | 初版主题入口 hub 落档（Code-memory batch 1） | Code-memory 艾瑞卡 |
