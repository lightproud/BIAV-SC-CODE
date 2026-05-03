# 派发 Brief — Code-memory：记忆系统结构化升级 批 1

> 落档日期：2026-05-03
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-memory 会话（追派现会话或另启）
> 验收方：守密人 / 主控台
>
> 上游依据：
> - 守密人 2026-04-26 裁定：D1 增强 / D2 方案 2（批 1+2，批 3 暂缓）/ D3 T1 卡牌系统主试点
> - Code-strategy 调研三件套：`memory/research/ai-memory-restructure-2026-04.md`、`memory/research/ai-memory-vendor-matrix.md`、`memory/strategy/memory-restructure-options.md`
> - Code-strategy 接力档：`memory/strategy/handoff-to-mainconsole-memory-restructure.md`
> - 决策档：`memory/decisions.md` 2026-04-26「记忆系统结构化升级 v1」条目
> - 守密人原话：「全部按你推荐来。我只有一个希望，**确保代码精简优雅可维护**。」
>
> 状态：待 Code-memory 会话取用

---

## 一、任务概要

记忆系统结构化升级**批 1**——为银芯既有 9 模块在表层加一层「冷档案过滤 + 主题入口 hub」，不替代核心，仅增强检索质量。**不动 9 模块核心代码**，**不动目录结构**（批 3 才碰），**不动 BIAV-SC.md / CLAUDE.md**。

预期收益（待批 1 后 Q4 基线验证）：
- M1 Top-1 准确率提升 ≥ 10 个百分点
- M3 召回头 5 条中非 session-digest 占比 ≥ 60%

---

## 二、任务清单（批 1）

| # | 动作 | 落点 |
|---|---|---|
| 1 | 写 `.searchignore` 文件，排除 `memory/session-digests/` 中 30 天前的冷档案 | 仓库根 `.searchignore` |
| 2 | 改 `scripts/memory_search.py:scan_files()` 读取 `.searchignore` 并跳过匹配项 | `scripts/memory_search.py` |
| 3 | 写 5 个主题入口 hub（纯 markdown ≤ 200 行/份） | `memory/active/*.md` 5 份 |
| 4 | 跑 Q4 标准 20 查询（查询集见下方 § 四），出基线表 | `memory/research/rag-baseline-2026-W18.md` |

---

## 三、5 个主题入口 hub 建议路径

```
memory/active/policy-direct-push-main.md       # 直推 main 政策（v2.0 + decisions.md 2026-03-29）
memory/active/mission-v2.0-three-pillars.md    # 银芯 v2.0 三新使命
memory/active/silver-blackpool-interface.md    # 双系统接口（已有，加链接到 active 目录）
memory/active/contribution-protocol.md         # 贡献协议 v1.0（已有，加链接）
memory/active/dream-system-overview.md         # 做梦三层架构概览
```

每份 hub 结构（守密人 § 3.x 要求）：
- § 一 引文：本主题最权威档案的引用 + 1 段摘要
- § 二 当前结论：截至落档日的有效结论 + 决策版本号
- § 三 相关档案：横向链接到所有相关 memory/* 与 projects/*

---

## 四、Q4 基线 20 查询集（主控台审定）

> 查询集设计原则：覆盖游戏事实（5）+ 战略政策（5）+ 系统架构（5）+ 历史决策（5），便于 doc_class 加权效果评估。

### 游戏事实（5）

1. "唤醒体 张爱玲 的技能"
2. "命轮 旋律 的效果"
3. "Aequor 界域的角色"
4. "v2.5 联动事件"
5. "卡牌系统三类（指令/灵体/疯狂）的设计哲学"

### 战略政策（5）

6. "v2.0 三新使命是什么"
7. "黑池-银芯接口规则"
8. "Issue 安全策略"
9. "贡献协议 PR 流程"
10. "Phase 2 M1-M4 时间表"

### 系统架构（5）

11. "session-end-distill hook 设计取舍"
12. "RAG 检索链条"
13. "做梦 Agent 三层"
14. "知识图谱节点类型"
15. "MCP server 暴露的工具"

### 历史决策（5）

16. "2026-04-19 战略转向"
17. "BPT 删除背景"
18. "characters.json schema 6 项裁决"
19. "lesson #30 数据层混淆"
20. "Code-strategy 角色定义"

每个查询的基线表必须含：

| 字段 | 含义 |
|---|---|
| query | 查询文本 |
| top_1_path | 召回第 1 名档案路径 |
| top_5_paths | 召回前 5 路径列表 |
| top_5_session_digest_count | 前 5 名中 session-digest 占比 |
| relevant_yes_no | 主控台主观判断 top_1 是否相关 |
| latency_ms | 检索延迟 |

---

## 五、守密人 7 条硬约束（H1-H7，逐字复制自决策版 § 3.x）

> **任一条款超出 → Code-memory 必须先回主控台说明理由，不得自行越界。**

### 当下批 1 适用

| # | 条款 | 触发条件 |
|---|---|---|
| **H1** | 新增脚本数 ≤ 2（含 `.searchignore` 读取层修改） | 超出 → 回主控台说明理由 |
| **H2** | 单文件长度 ≤ 300 行 | 同上 |
| **H3** | 不引入任何新 pip 依赖 | 纯 stdlib + 已有 PyYAML / jq |
| **H4** | `.searchignore` 复用 gitignore 语法 | 不得自创新格式 / YAML / GUI 配置 |
| **H6** | 主题入口 hub 纯 markdown ≤ 200 行 / 份 | 不得引入新 frontmatter 扩展 / 多语言扩展 |

### 批 2 才适用（本批先记录，批 2 brief 时复读）

| # | 条款 | 适用范围 |
|---|---|---|
| **H5** | `doc_class` 加权 = `rerank()` 加 1 行 + ≤ 10 行常量权重表 | 批 2 doc_class 加权 |
| **H7** | 事实卡片 schema **直接复用** `assets/data/card-system.json` v1.0 模式 | 批 2 T1 卡牌事实卡片化 |

---

## 六、不在范围内（明确边界）

- ❌ 不动 9 模块核心代码（`memory_search.py` 仅加 `.searchignore` 读取层，约 5-10 行）
- ❌ 不动 `BIAV-SC.md` / `CLAUDE.md`（批 3 才碰，**Phase 2 期间不得启动批 3**）
- ❌ 不引入 LLM API 调用（批 1 全部本地）
- ❌ 不动 `memory/` 现有文件（仅新增 `memory/active/*` 5 份）
- ❌ 不引入分类器 / ML 模型（H5 也禁止）
- ❌ 不实现 Q&A 预计算 / 叙事记忆 / 全栈 Mem0 / Letta / Cognee（决策版 § 二「不推荐」清单）
- ✅ 仅改 `scripts/memory_search.py`（≤ 10 行）+ 新增 `.searchignore` + 新增 `memory/active/*.md` 5 份 + 新增 `memory/research/rag-baseline-2026-W18.md`

---

## 七、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `.searchignore` 落档，复用 gitignore 语法 | 文件存在 + 语法人工核对 |
| 2 | `memory_search.py` 读取 `.searchignore`（仅 ≤ 10 行新增） | `git diff --stat scripts/memory_search.py` |
| 3 | `memory/active/` 5 份 hub 落档，每份 ≤ 200 行 | `wc -l` 命令行 |
| 4 | `memory/research/rag-baseline-2026-W18.md` 落档，20 查询全表 | 文件存在 + 表格完整 |
| 5 | M1 Top-1 准确率提升 ≥ 10 个百分点 | 基线对比（修改前 vs 修改后） |
| 6 | M3 召回头 5 条中非 session-digest 占比 ≥ 60% | 基线表汇总 |
| 7 | session-start-sync hook 正常 | hook 日志 |
| 8 | H1-H4 + H6 全部满足 | 逐条核查 |
| 9 | 不引入新 pip 依赖 | `pip freeze` 对比修改前后 |

---

## 八、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  feat(memory): batch 1 — .searchignore + 5 active hubs

  Resolves dispatch (memory/dispatch-brief-code-memory-restructure-batch1.md).
  - .searchignore: gitignore-style cold archive filter (30d session-digest)
  - memory_search.py: +N lines to read .searchignore
  - memory/active/*.md: 5 topic hubs ≤200 lines each
  - memory/research/rag-baseline-2026-W18.md: Q4 20-query baseline

  Hard constraints (守密人 2026-04-26):
  - H1 ≤2 new scripts ✓
  - H2 ≤300 lines per file ✓
  - H3 no new pip deps ✓
  - H4 gitignore syntax ✓
  - H6 ≤200 lines per hub ✓

  Code-memory boundary observed: scripts/ + memory/ infrastructure only.
  ```

---

## 九、艾瑞卡角色规则提醒

Code-memory 会话仍以**艾瑞卡**自称，对守密人使用「守密人」称谓。技术操作用角色术语（修正档案 / 索引重建 / 同步至远端存储 / 数据扫描）。完整规则见 `BIAV-SC.md §0`。

---

## 十、批 2 接力（待批 1 验收后决策）

批 1 完成 + Q4 基线落档后：
- 主控台评估输入：M1 Top-1 提升幅度 + M3 召回均衡度 + 守密人主观感受
- **评估通过** → 主控台另起 batch2 dispatch brief，派 Code-memory 实施 T1 卡牌完整化 + Code-wiki 接力同步 schema + `doc_class` 加权（H5、H7 适用）
- **评估未通过** → 主控台回派 Code-strategy 调研缺口

---

## 十一、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-03 | 初版批 1 brief 落档（基于 Code-strategy 调研 + 守密人裁定） | 主控台艾瑞卡 opus4.7 |
