# 交接 — 主控台 / 记忆系统结构化升级（守密人裁定 + 接力请求）

> 落档日期：2026-04-26
> 发起方：Code-strategy（艾瑞卡 opus4.7，分支 `claude/code-strategy-bootstrap-XTmMR`）
> 收件方：**主控台**（艾瑞卡 opus4.7 长期战略锚点）
> 上游：守密人 2026-04-26 18:30+ 对 Code-strategy 调研三件套的最终裁定
>
> **本档案就是给主控台读的对话文本**——主控台读完即可启动接力，无需守密人转述。

---

## 一、守密人裁定（2026-04-26）

| 决策 | 结果 |
|------|------|
| **D1** 总方向 | **增强**（layer on top） |
| **D2** 启动节奏 | **方案 2** —— 批 1 + 批 2，不动目录（**批 3 暂缓**） |
| **D3** 主试点 | **T1 卡牌系统**（事实卡片化） |

守密人附加硬约束原话（不可省）：

> 「全部按你推荐来。我只有一个希望，**确保代码精简优雅可维护**。」

---

## 二、调研产出（主控台审定参考）

主控台请按顺序读：

1. **决策版**（最短，含 § 3.x 7 条精简硬约束）：`memory/strategy/memory-restructure-options.md`
2. **主报告**（Q1-Q8 全答 10 章节）：`memory/research/ai-memory-restructure-2026-04.md`
3. **业界对标**（7 家 + Native + 横向矩阵）：`memory/research/ai-memory-vendor-matrix.md`

---

## 三、请求主控台承担的三件事

### 3.1 决策档登记（主控台 + 守密人）

在 `memory/decisions.md` 追加一行：

> | 2026-04-26 | 记忆系统结构化升级 v1：增强姿态（不替代 9 模块）/ 方案 2（批 1 + 批 2，批 3 暂缓）/ T1 卡牌系统作主试点 / 守密人硬约束「代码精简优雅可维护」/ 详见 `memory/strategy/memory-restructure-options.md` § 三 § 3.x | 全局 / 记忆系统 |

### 3.2 起草批 1 dispatch brief

建议落档：`memory/dispatch-brief-code-memory-restructure-batch1.md`

brief 模板已在决策版 § 4.1 给出；主控台**务必把 § 3.x 7 条硬约束逐字复制进 brief 验收清单**。

### 3.3 派 Code-memory 实施批 1 + 跑 Q4 基线

工作量预期 1-2 个会话。批 1 完成后落档：
- `.searchignore`（复用 gitignore 语法）
- 5 个主题入口 hub（位置见决策版 § 4.1）
- `memory_search.py:rerank()` 加 1 行 doc_class 加权
- `memory/research/rag-baseline-2026-W18.md`（Q4 基线表，20 查询）

---

## 四、批 1 验收硬性条款（守密人约束派生）

| # | 条款 | 触发条件 |
|---|------|---------|
| H1 | 新增脚本数 ≤ 2 | 超出 → Code-memory 回主控台说明理由 |
| H2 | 单文件长度 ≤ 300 行 | 同上 |
| H3 | 不引入任何新 pip 依赖 | 同上 |
| H4 | `.searchignore` 复用 gitignore 语法 | 不得自创新格式 |
| H5 | `doc_class` 加权 = `rerank()` 加 1 行 + ≤ 10 行常量权重表 | 不得引入分类器 / ML 模型 |
| H6 | 主题入口 hub 纯 markdown ≤ 200 行 / 份 | 不得引入新 frontmatter 扩展 |
| H7 | 事实卡片 schema **直接复用** `assets/data/card-system.json` v1.0 模式 | 不得自创 schema |

任一条款超出 → Code-memory 必须**先回主控台说明理由**，不得自行越界。

---

## 五、批 2 节奏（待批 1 验收后决策）

- 批 1 完成 + Q4 基线落档后，主控台评估
- 评估输入：M1 Top-1 准确率提升幅度 + M3 召回均衡度 + 守密人主观感受
- 评估通过 → 派 Code-memory 实施批 2（T1 卡牌完整化 + Code-wiki 接力同步 schema）
- 评估未通过 → 主控台重新派 Code-strategy 调研缺口

---

## 六、批 3 处置（守密人裁定暂缓）

批 3 涉及目录重构（`memory/core/` `active/` `archive/` 分层）+ BIAV-SC.md / CLAUDE.md Skill 化拆分，工程量大、改动面广。守密人裁定**Phase 2 之后视基线数据再评估**。

主控台**不要在 Phase 2 期间启动批 3**，避免与三新使命的 84 天窗口冲突。

---

## 七、Code-strategy 后续姿态

- 调研已交付，进入待命状态
- 等下一议题派发（守密人 / 主控台均可发起）
- 不主动写决策档 / dispatch brief / 业务代码
- 可主动观察长期信号（社区温度 / 联动窗口 / Phase 2 进度），有发现给主控台**提议**

---

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-26 | 守密人裁定 + 主控台接力请求落档 | Code-strategy 艾瑞卡 |

◇ ◇ ◇

> 主控台艾瑞卡，请按 § 三 三件事接力。守密人通过本档案链接转交，无需复制文本。
