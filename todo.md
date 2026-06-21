# TODO — 银芯仓库优化（/grill 会话遗留）

> 维护者：会话续接用。完成一项打勾或删除。新会话**先核实再建设**（见文末警示）。
> 最后更新：2026-06-21（环境 flaky，下方"已确证"仅指当时直接核实者）。

## A. 待核实是否真落盘 main（新会话第一步）

```bash
git fetch origin main && git log origin/main --oneline -30
du -sh projects/news/data/discord/channels   # 期望 ~229M；仍 3.2G = 瘦身未落盘
```
用 Read（勿用 bash cat/grep，会串扰）确认 origin/main 上：

- [ ] discord 瘦身（10,601 文件删除，channels ~229M）
- [ ] `memory/lessons-learned.md` 含 `## 40.` 与 `## 41.`
- [ ] `memory/research/discord-archive-backfill-conflict.md` 存在
- [ ] `memory/strategy/history-rewrite-plan.md` 存在
- [ ] `memory/active/handoff-grill-session.md` 是否真落盘（本会话 git add 曾报 pathspec 矛盾，存疑）

## B. 已确证（注入的真实文件内容为证，可信）

- [ ] ~~Release `art-assets-v1` 已删（API 404）~~ **2026-06-21 推翻**：独立核实 API 返回完整元数据（5,218 图/943M，非 404），`art-assets-v1` **仍在线**，删除待守密人手动执行（lesson #41 假回执再现）；`art-assets-v2` 完好（5.1G）已核实
- [x] CLAUDE.md §5.2 已含 `RELEASES.md` 指针（第 173 行在）
- [ ] **CLAUDE.md §1.1-HC 防火墙升格 = 确证未落盘**（第 27 行仍旧表格格式）→ 见 C1

## C. 待补做

- [ ] **C1 重做 §1.1-HC**：把黑池→银芯防火墙从 §1.1 表格格升格为独立编号硬约束
  （讲后果：唯一防火墙、失效=不可逆外向泄漏；可执行：黑池→银芯方向任何同步/回填一律拒绝并报告；
  防误删守卫）。**注意**：CLAUDE.md 正被并行治理会话改动，动前先 fetch + 看冲突。
- [x] **C2 RELEASES.md 速查表**（2026-06-21 完成主体）：已加「我要找 X → 哪个 tag」意图表（新一节）
  + 大资产表加「典型用途」列。**未做**「移除 art-assets-v1 行 / 标清冗余完成」——前提不成立：
  独立核实该 Release 仍在线（见 B 节订正），故保留其行并标「2026-06-21 核实仍在线，删除待守密人手动」。
- [ ] C3 A 节核实中发现缺失的任何成果，重新落盘。

## D. 守密人手动 / 已完成

- [x] 删冗余 Release `art-assets-v1`（守密人手机操作，已核实 404）

## 风险提示（勿删）

- **残余数据风险**：删掉的 3.0G discord，只实证 30 月中 3 月在 Releases 有副本。
  **做 git 历史重写前，不得假定其余 27 月安全**（历史 blob 是唯一二次抢救网）。
- **lesson #41（本会话二次违反）**：flaky 环境工具输出会串扰失真（假"成功"、幻影内容、
  矛盾回执）。禁止凭工具回执或记忆判定"已完成"；交付前必用独立 Read / git log 核实。
  **当核实工具本身也 flaky 时**（如本会话 git add 给矛盾回执）：停止在该环境制造更多写入，
  交给干净环境重做。

## 工作分支

`claude/grill-skill-research-e82r8p`，完成且验证通过后默认 squash 合并 main。
