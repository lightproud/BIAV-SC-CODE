Memory audit + sync playbook（记忆巡检手册，守密人 2026-07-12 裁定升级）。
本手册同时是月检 CCR 例程「记忆巡检」的执行流程——例程与人工共用一套，不另立分叉。
红线：机器只点火与体检，**档案写入仍人工策展**——机械项直接修，语义改动与毕业提案均属
待裁项，按 CLAUDE.md §2.2 用 AskUserQuestion 逐个呈上守密人（不复活 2026-06-14 退役的自动记忆环）。

## A. 机械体检（先跑工具，再动手）

1. `python3 scripts/memory_freshness.py` — 保鲜巡检报告四段：
   门禁级不变量（lessons 指针完整性 / 编号对账）、引用路径存在性、超龄档案、头部日期错位。
2. 门禁级红项当场修复；确认 `pytest tests/test_memory_freshness.py tests/test_claude_md*.py -q` 绿。
3. 报告级发现（失效路径 / 超龄 / 日期错位）逐条核实：机械可修的（改指针、补 ⚠ 标注、
   更新头部日期）直接修；涉内容语义的转入 C 段复核。

## B. 状态同步（原有职能）

4. List files in each `projects/*/` directory.
5. Compare actual state with `memory/project-status.md` — update if out of sync.
6. Compare actual state with each `projects/*/CONTEXT.md` — update if out of sync.
7. Check `assets/index.md` references point to existing files — fix broken references.

## C. 语义复核（工具测不出的，巡检的核心价值）

8. **前提复核**：对照 `memory/decisions.md`（必要时 decisions-archive），逐条问在役 lessons
   与各 CONTEXT 的前提是否仍成立——机制退役、路径删除、环境演进都会让旧结论悄悄失效
   （参照案例：#16「Web 无外网」被环境演进推翻、#17 前提随 de-tier 消失、#22 权威源被删）。
   失效者按「已迁档 / 已并入」指针处置。
9. **矛盾扫描**：lessons ↔ decisions ↔ CLAUDE.md 三层间新出现的互相矛盾（以日期新者为准，双向同步）。
10. **毕业提案**：在役 lesson 若已被测试 / 钩子 / CLAUDE.md 硬约束覆盖，提案标毕业迁档
    （lessons-learned.md 维护说明第 2 条毕业纪律）。
11. **定额检查**：新增条目是否超 3–5 行定额、长叙事是否落了归档层案卷区。

## D. 收尾

12. 待裁项 AskUserQuestion 逐个呈上；获裁后按 §7.6 流程（对话内全量测试绿即合并）落盘。
13. Report all changes made——合并后附总结体（§7.6 ⓪–④）。
