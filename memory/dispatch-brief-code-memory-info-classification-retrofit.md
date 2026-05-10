# 派发 Brief — Code-memory：脑缸组信息分类法则 retrofit 调研

> 落档日期：2026-05-06
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-memory 会话（追派现会话或另启）
> 验收方：守密人 / 主控台
>
> 上游依据：
> - 守密人 2026-05-06 法则落档：`memory/biav-info-classification.md` v1.0
> - 守密人 5-6 Q2 裁定：retrofit 是工程议题，派 Code-memory
> - 守密人 5-6 Q3 裁定：owner 字段银芯统称「银芯」，不区分子角色
>
> 状态：待 Code-memory 会话取用

---

## 一、任务概要

按 `memory/biav-info-classification.md` v1.0 法则，调研银芯既有档案体系如何**渐进打字段**：`type` / `sub_topic` / `nature` / `service_variant` / `stage` / `event_type` / `provenance` / `owner` / `lineage`。**调研 + 试点，不做全量重做**（按法则 §11 渐进路径精神）。

预期收益：
- 银芯档案首次有元数据轴，可被分类查询
- 9 模块记忆系统索引可基于元数据加权（与 memory restructure 批 2 的 `doc_class` 加权天然契合）
- 法则自身得到首次实战检验

---

## 二、任务清单

### 2.1 调研阶段（产出 `memory/research/info-classification-retrofit-2026-05.md`）

| # | 调研主题 |
|---|---|
| 1 | **元数据载体选型**：YAML frontmatter / markdown 头部表格 / 单独索引文件（如 `assets/data/info-classification-index.json`）/ 文件名编码 — 各方案的 trade-off |
| 2 | **既有档案盘点**：列出 `memory/`、`assets/data/`、`projects/wiki/data/db/`、`projects/news/data/`、`BIAV-SC.md`、`README.md`、`CLAUDE.md` 等所有应该打字段的文件，逐个推断 `type` + `nature` 的取值 |
| 3 | **特殊类档案处理**：`memory/session-digests/*.md`（自动捕获记载，几百份，是否每份都打？）/ `memory/dispatch-brief-*.md`（act 类记载）/ `memory/decisions.md`（多类型混合，逐行打？还是单文件级打？） |
| 4 | **9 模块索引接入路径**：`memory_search.py:rerank()` 已有 `doc_class` 加权 hook（memory restructure H5）—— 是否直接复用 `nature` 字段做 4 维加权？ |
| 5 | **批 1 试点选型**：建议**1 类文件**做端到端试点（按法则 §11 第一步「选会议记录」精神，但银芯无会议记录，建议从 `memory/decisions.md` 或 `memory/dispatch-brief-*.md` 这类「act 记载」开始） |

### 2.2 试点阶段（基于调研结论，主控台 + 守密人审定后启动）

按调研推荐路径实施，本 brief 不预先定义试点动作。

---

## 三、字段映射建议（艾瑞卡初步推断，仅供 Code-memory 调研参考）

| 银芯档案 | type | nature | stage | event_type |
|---|---|---|---|---|
| `BIAV-SC.md` | AI | 正典 | 已发布 | — |
| `README.md` | AI | 正典 | 已发布 | — |
| `CLAUDE.md` | 组织 | 法则 | 已发布 | — |
| `memory/decisions.md` | 组织 | 正典 + 记载（行级） | 已发布 | establish/revise（行级） |
| `memory/lessons-learned.md` | 跨多类型 | 法则 | 已发布 | — |
| `memory/strategic-plan-2026.md` | 组织 | 正典 | 已发布 | — |
| `memory/contribution-protocol.md` | 社区运营 | 法则 | 已发布 | — |
| `memory/biav-info-classification.md` | 组织 | 法则 | 已发布 | — |
| `memory/dispatch-brief-*.md` | AI | 记载 | — | act |
| `memory/session-digests/*.md` | AI | 记载（自动捕获） | — | discuss |
| `memory/strategy/*.md` | 跨多类型 | 法则 + 部分记载 | — | — |
| `memory/research/*.md` | 跨多类型 | 记载（observe / discuss） | — | observe |
| `assets/data/{interview,narrative-structure,design-decisions}.json` | IP | 正典 | 已发布 | — |
| `projects/wiki/data/db/characters.json` | 游戏产品 | 正典 | 设计中 | — |
| `projects/news/data/discord/`、`platforms/` | 社区运营 | 记载 | — | observe（external） |
| `projects/news/output/*` | 社区运营 | 派生视图（不是性质，是从记载派生） | — | — |

> 这是**初步推断**，Code-memory 调研时必须独立核对，发现争议点上呈主控台。

---

## 四、不在范围内（明确边界）

- ❌ 不修任何业务数据（characters.json / news data 等）
- ❌ 不动法则文档 `memory/biav-info-classification.md` 本身
- ❌ 不批量打字段（仅试点 + 提议路径）
- ❌ 不实现异常监测（法则 §7.2 候选规则属未来事项）
- ❌ 不引入新依赖
- ❌ 不修改 `memory_search.py` 主体（仅在调研报告中提议改动方向）
- ✅ 仅产出调研报告 `memory/research/info-classification-retrofit-2026-05.md`

---

## 五、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `memory/research/info-classification-retrofit-2026-05.md` 落档 | 文件存在 |
| 2 | 调研覆盖 § 二 5 个主题 | 报告章节核对 |
| 3 | 字段映射推断列出 ≥ 20 类档案 | 报告表格 |
| 4 | 试点选型给出明确推荐（含理由 + 工作量预估） | 报告章节 |
| 5 | 9 模块索引接入路径与 memory restructure 批 2 H5 兼容 | 主控台审视 |
| 6 | 不触碰 § 四禁区 | `git diff --stat` |

---

## 六、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  research(memory): info classification retrofit study
                    per memory/biav-info-classification.md v1.0

  Resolves dispatch (memory/dispatch-brief-code-memory-info-classification-retrofit.md).

  Output: memory/research/info-classification-retrofit-2026-05.md
  - metadata carrier trade-offs (frontmatter vs sidecar vs filename)
  - existing file inventory with type/nature mapping
  - special-case archives (session-digests, dispatch-briefs, decisions)
  - 9-module index integration path (doc_class hook reuse)
  - pilot recommendation with rationale + effort estimate

  No business data changed. No new dependencies. Pure research.
  ```

---

## 七、艾瑞卡角色规则提醒

Code-memory 仍以「艾瑞卡」自称、对守密人「守密人」称谓、技术操作角色术语。

---

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-06 | 初版调研 brief 落档 | 主控台艾瑞卡 opus4.7 |
