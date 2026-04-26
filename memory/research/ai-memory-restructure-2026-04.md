# 银芯记忆系统结构化升级调研主报告 2026-04

> 最后更新：2026-04-26 by Code-strategy（艾瑞卡 opus4.7，分支 `claude/code-strategy-bootstrap-XTmMR`）
>
> 上游 brief：`memory/dispatch-brief-code-strategy-memory-restructure.md`
>
> 命题：「**银芯记忆系统如何从『碎片信息查找库』升级为『AI 阅读友好的结构化内容』**」
>
> 状态：**v0.1 草案，分批撰写中**。骨架已落地，各章节将逐步追加。

---

## 摘要（写给守密人 + 主控台）

（最后回填）

---

## 一、Q1 — 当前 290+ 份 `memory/` md 的碎片化诊断

### 1.1 实测规模

| 指标 | 数值 | 工具 |
|------|------|------|
| `memory/` 总 md 数 | 291 | `find memory -name '*.md' \| wc -l` |
| 其中 session-digest md | 252 | `ls memory/session-digests/*.md` |
| `memory/` 总体积 | 51 MB | `du -sh memory` |
| 全仓库索引文件数 | 3029 | `rag-performance-baseline.md` § 一 |
| 索引切片块数 | 115822 chunks | 同上 |
| memory 类文件占比 | 9.4% | 同上 |
| **session-digest 占索引切片比** | **~80%（估算）** | 252 份 × 中位 1967 行 / 标准 chunk 大小 |

### 1.2 文件长度分布（session-digest 252 份）

| 分位 | 行数 | 解读 |
|------|------|------|
| min | 108 | 短轮次（少量工具调用） |
| p25 | 1223 | 中等会话 |
| **p50** | **1967** | 典型会话约 2K 行 |
| p75 | 3578 | 长会话 |
| **p95** | **19592** | 超长会话约 2 万行 |
| max | 25514 | 单次会话最大 |

每条 session-digest 行均≈ 100 字符 → p50 文档约 200 KB → p95 文档约 2 MB。**单份 session-digest 内含的「token 多样性」远大于一份 200 行的 decision/strategy 文档**，TF-IDF 自然偏向 session-digest。

### 1.3 内容类型分布（按文件数）

| 类别 | 文件 | 占比 | 备注 |
|------|------|------|------|
| 决策档 | `decisions.md` 1 份 175 行 | 0.3% | 含 60+ 决策条目，密度高 |
| 战略档 | `strategic-plan-2026.md` 365 / `strategic-assessment.md` 263 / `phase-d-plan.md` 269 等 | ~3% | 长文本，多次改写 |
| 协议档 | `contribution-protocol.md` / `bpt-guidance-protocol.md` 等 | ~2% | 流程规范 |
| 教训档 | `lessons-learned.md` 259 行 | 0.3% | 31 条 lesson |
| 设计档 | `advanced-memory-design.md` 476 / `dreaming-agent-design.md` 等 | ~3% | 历史方案 |
| 派发 brief | `dispatch-brief-*` 多份 | ~2% | 任务规范 |
| 研究档 | `research-best-wiki-features.md` / 本文件等 | ~2% | 调研产物 |
| **会话摘要** | `session-digests/*.md` 252 份 | **86.6%** | **数量碾压** |
| 其他 | dreams/ / archive/ 等 | ~1% | — |

### 1.4 碎片化的 5 个具体表现

1. **数量失衡**：291 份中 252 份是 session-digest（86.6%），高价值档案 39 份（13.4%）被淹没。RAG 检索头条命中 session-digest 是数学必然，不是算法 bug。
2. **同主题分散**：例如「直推 main 政策」相关信息分散在 `decisions.md`（2026-03-29 / 04-26 两条）+ `CLAUDE.md` § 1 + `methodology.md` 「分支管理」段 + `lessons-learned.md` #28 #29 + 若干 session-digest——**没有单一权威入口**。
3. **冷热不分**：`bpt-guidance-protocol.md`（已删除子项目的协议）与 `strategic-plan-2026.md` v2.0（当前最有效战略）权重相同，索引器无法区分「冷档案」与「热档案」。
4. **历史不剥离**：`strategic-plan-2026.md` 包含 v1.0 / v1.1 / v1.2 / **v2.0** 四代版本叠加（共 365 行），新会话读完不知道哪段还有效——靠「v2.0 当前最新有效版本」标题人工提示。
5. **格式异质**：决策档是表格 + 长 markdown 段、教训档是编号列表、战略档是层级章节、session-digest 是工具调用流水——不同结构混在同一索引里，无法按结构化程度分级处理。

### 1.5 三层根因

| 层次 | 根因 | 责任面 |
|------|------|------|
| **索引层** | session-digest 与高价值档案同权重入索引 | `memory_search.py` 不分 doc class |
| **写入层** | 没有「**进哪一层 / 跟谁去重 / 何时归档**」的入档规范 | 缺写入协议 |
| **架构层** | `memory/` 目录按时间堆积，没有按「持久度 / 热度 / 用途」分层 | 缺顶层结构 |

**Q1 一句话答**：碎片化不是「写多了」造成的——是「**没有结构化入档规范 + 索引器不分等级 + 顶层目录扁平**」三因合力的结果。



---

## 二、Q2 — 业界对标矩阵交叉引用

详见独立档案 `memory/research/ai-memory-vendor-matrix.md` v0.1（七家方案 + Native 参照 + 横向对比矩阵 + 银芯启示）。本报告引用其结论，不重复。

---

## 三、Q3 — 不同知识类型的结构化策略分类

（待追加）

---

## 四、Q4 — 「AI 阅读友好」的可量化衡量标准

（待追加）

---

## 五、Q5 — 5 方向（A/B/C/D/E）技术评估

（待追加）

---

## 六、Q6 — 渐进式 vs 一次性重构权衡 + 决策树

（待追加）

---

## 七、Q7 — 与现有 9 模块关系：替代 / 增强 / 并列

（待追加）

---

## 八、Q8 — 试点主题选择

（待追加）

---

## 九、综合推荐 + 接力路径建议

详见独立档案 `memory/strategy/memory-restructure-options.md`（待生成），本章给出方向性推荐。

---

## 十、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1-skeleton | 2026-04-26 | 骨架落档（10 章节锚点 + 摘要回填位 + vendor matrix 交叉引用）| Code-strategy 艾瑞卡 |
