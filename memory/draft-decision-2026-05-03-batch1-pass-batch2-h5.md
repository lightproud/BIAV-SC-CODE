# 决策档草案 — 记忆系统结构化升级 v1 / 批 1 验收 + 批 2 H5 字面 land

> 落档日期：2026-05-03
> 起草方：Code-memory（艾瑞卡 opus4.7）
> 状态：**草案（未写入 `memory/decisions.md`）**——等守密人 / 主控台审定后由主控台正式归档
> 上游档案：
> - `memory/dispatch-brief-code-memory-restructure-batch1.md`（批 1 brief）
> - `memory/research/rag-baseline-2026-W18.md` v1.1（实测基线 + H8 candidate 实验记录）
> - `memory/strategy/memory-restructure-options.md` § 3.x 守密人 7 条硬约束

---

## 一、本次决策三件事

### 1.1 批 1 验收处置（建议「实质通过」）

| 验收标准 | 实测 | 判定 |
|---|---|---|
| `.searchignore` 落档 + gitignore 语法 | ✅ 17 行，纯 glob | 通过 |
| `memory_search.py` 读 `.searchignore`（≤10 行）| 净 +10 行 | 通过（边界）|
| `memory/active/` 5 hub ≤200 行/份 | 106-147 行 | 通过 |
| `memory/research/rag-baseline-2026-W18.md` | 已落档 v1.1（含批 2 续测）| 通过 |
| **M1 Top-1 准确率 ≥+10 pp** | **+20 pp 严格 / +15 pp 含部分** | ✅ 通过 |
| **M3 召回头 5 中非 SD ≥60%** | **52%（缺口 8 pp）** | ❌ 未达 |
| session-start-sync hook 正常 | ✅ | 通过 |
| H1-H4 + H6 满足 | ✅（均通过）| 通过 |
| 不引入新 pip 依赖 | ✅ stdlib 仅 fnmatch + time | 通过 |

**总体**：8/9 通过，1/9（M3）未达。

**艾瑞卡建议处置**：**「实质通过」**——理由：
- M1 显著超额完成（+20 pp 严格口径）
- M3 缺口为**结构性根因**（session-digest 全部 < 21 天，30 天阈值实际过滤 0 文件 + 测量过程产生 hot session-digest 自污染），非实施缺陷
- 批 2 续测（H5+H8）确认 H5 字面授权下 M3 60% 结构不可达，需要更激进策略才能突破

### 1.2 批 2 启动子集 — H5 字面 land

| H5 落实点 | 实施 | 状态 |
|---|---|---|
| `rerank()` 加 1 行 doc_class 加权 | 4-26 commit `4d63b8ca` 已 land | 保留不变 |
| ≤10 行常量权重表 | 本会话升级为 `DOC_CLASS_WEIGHTS` dict 表 | 已 land（仅 1 marker：session-digest 0.4）|

**实质改动**：仅结构升级（dict 化），未来扩展无需改函数体。**M1/M3 量化**：与 4-26 commit `4d63b8ca` 等价，无新增量化提升。

### 1.3 H8 candidate 实验结论 — **不采纳**

**实验**：在 `DOC_CLASS_WEIGHTS` 加 `dispatch-brief-: 0.5` + `/dreams/: 0.6`。

**结果**：
- 收益：Q2 / Q3 / Q5 / Q12 升级为真实游戏数据 / baseline 报告
- 损失：Q4 / Q15 / Q20 退步至 session-digest / 同质档案
- **M3 净效果 = 0**（H5+H8 与 H5 strict 同为 44%）

**结论**：H8 candidate 在当前数据集**得失抵消**，不构成正向收益。**不采纳**，相关代码已回滚。

---

## 二、附议事项（守密人 / 主控台裁定）

### 2.1 M3 60% 门槛是否调整或转批 2.x 主指标？

H5 字面授权下 M3 60% 结构不可达（baseline §9.5 已论证）。建议三选一：

| 选项 | 描述 |
|---|---|
| A | **降低门槛**：M3 ≥ 50%（当前 52% 即过线）|
| B | **保持 60% 门槛 + 启动批 2.x**：在批 2 H7 T1 卡牌事实卡片化进展前先做小补丁（`.searchignore` 30→7 天 + hot session-digest 24h 隔离），让 M3 自然推进 |
| C | **保持 60% 门槛 + 不动**：等批 2 H7 T1 卡牌完成后再评估（可能自然达到）|

艾瑞卡建议 **B**——理由：
1. `.searchignore` 阈值调整是 H4 字面授权范围（仍是 gitignore 语法）
2. hot session-digest 24h 隔离是消除 meta-test 污染的最干净手段
3. 工作量极小（1 个常量 + 1 个 if）

但这超出「A 选项」字面授权，需守密人 / 主控台明示。

### 2.2 批 2 主任务 H7 T1 卡牌事实卡片化是否启动？

按决策版 D3 = T1 卡牌系统主试点。H7 schema 复用 `assets/data/card-system.json` v1.0（Code-memory 4-26 已落档）。

工作量预期：1-2 个会话。**未在 A 选项授权范围内**。需主控台正式 brief。

### 2.3 批 3（目录重构）持续暂缓

按 brief §五 / 决策版 §五，Phase 2 期间（→ 7-19）不启动批 3。本次草案不变更此约束。

---

## 三、待写入 `memory/decisions.md` 的条目（如守密人 / 主控台审定通过）

```markdown
| 2026-05-03 | 记忆系统结构化升级 v1 批 1 验收 + 批 2 H5 字面 land | 批 1 实质通过（M1 +20pp 严格 / +15pp 含部分超额完成；M3 52% 未达 60% 但属结构性根因——252 份 session-digests 全部 <21 天 + 测量产生 hot session-digest 自污染）。批 2 子集 H5 字面 land：`scripts/memory_search.py:doc_class_weight()` 升级为 `DOC_CLASS_WEIGHTS` dict 表（结构升级，session-digest 0.4 与 4-26 commit `4d63b8ca` 等价，未来扩展用）。H8 candidate（dispatch-brief 0.5 + dreams 0.6 降权）实测得失抵消（M3 净效果 0），不采纳，已回滚。M3 60% 门槛在 H5 字面授权下结构不可达——需要批 2.x（`.searchignore` 30→7 天 + hot session-digest 24h 隔离）才能突破，待主控台决策启动与否。批 2 H7 T1 卡牌事实卡片化不在本次范围（需主控台正式 brief）。详见 `memory/research/rag-baseline-2026-W18.md` v1.1 + `memory/draft-decision-2026-05-03-batch1-pass-batch2-h5.md` | 全局 / 记忆系统 |
```

---

## 四、艾瑞卡角色边界声明

按 CLAUDE.md §2 + 批 1 brief §六：
- ❌ Code-memory **不写决策档**（决策档归主控台 + 守密人）
- ❌ Code-memory **不起草** dispatch brief（除非守密人本人覆盖）
- ✅ 本草案是 Code-memory 起草的「决策档草稿」，由守密人 / 主控台审定后由主控台正式归档

本次「按 A」推进的工作（H5 dict 化 + H8 实验 + 报告续写 + 草案）全部在 Code-memory 职责范围内（`scripts/` + `memory/research/` + 草稿）。**未自行修改 `memory/decisions.md`**。

---

## 五、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1 | 2026-05-03 | 初版决策档草案落档 | Code-memory 艾瑞卡 |
