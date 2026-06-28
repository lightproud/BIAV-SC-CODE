# TODO — 银芯仓库优化（/grill 会话遗留）

> 维护者：会话续接用。完成一项打勾或删除。新会话**先核实再建设**（见文末警示）。
> 最后更新：2026-06-21（环境 flaky，下方"已确证"仅指当时直接核实者）。

## A. 待核实是否真落盘 main（新会话第一步）

```bash
git fetch origin main && git log origin/main --oneline -30
# 旧路径已废：projects/news/data/discord 整体迁出，下方为现行核实命令
ls projects/news/data/discord/channels 2>/dev/null && echo "迁移未落盘" || echo "旧路径已清(预期)"
du -sh Public-Info-Pool/Record/Community/discord   # 现址，2026-06-21 de-tier 后永驻 git，~2.1G text 全量
```
用 Read（勿用 bash cat/grep，会串扰）确认 origin/main 上：

- [x] discord 瘦身 + 迁移（2026-06-28 核实）：旧路径 `projects/news/data/discord/channels` **已消失**，
  数据迁至 `Public-Info-Pool/Record/Community/discord`（~2.1G，de-tier 后永驻 git），与 CLAUDE.md §5.2 一致。
  原 `du projects/news/data/...` 核实命令指向已死路径，已订正为现址。
- [x] `memory/lessons-learned.md` 含 `## 40.` 与 `## 41.`（2026-06-21 核实在）
- [x] `memory/research/discord-archive-backfill-conflict.md`（核实在）
- [x] history-rewrite-plan / handoff-grill-session 两档**核实不存在**（从未落盘 main，引用作废，勿再找）

## B. 已确证（注入的真实文件内容为证，可信）

- [ ] ~~Release `art-assets-v1` 已删（API 404）~~ **2026-06-21 推翻**：独立核实 API 返回完整元数据（5,218 图/943M，非 404），`art-assets-v1` **仍在线**，删除待守密人手动执行（lesson #41 假回执再现）；`art-assets-v2` 完好（5.1G）已核实
- [x] CLAUDE.md §5.2 已含 `RELEASES.md` 指针（第 173 行在）
- [x] **CLAUDE.md §1.1-HC 防火墙升格**（2026-06-21 落盘）：已从 §1.1 表格升格为独立编号硬约束块（含后果/可执行规则/防误删守卫）→ 见 C1

## C. 待补做

- [x] **C1 重做 §1.1-HC**（2026-06-21 完成）：黑池→银芯防火墙已从 §1.1 表格升格为独立编号硬约束
  块 `§1.1-HC`（讲后果：唯一防火墙、失效=不可逆外向泄漏；可执行：黑池→银芯方向任何同步/回填一律拒绝并报告，
  仅银芯自有 Release 同源回流属合法；防误删守卫：与 §1.1 表格成对约束、单方被改即报警）。
  落盘前已 fetch origin/main 确认无并行冲突；全量单测 1651 通过。
- [x] **C2 RELEASES.md 速查表**（2026-06-21 完成主体）：已加「我要找 X → 哪个 tag」意图表（新一节）
  + 大资产表加「典型用途」列。**未做**「移除 art-assets-v1 行 / 标清冗余完成」——前提不成立：
  独立核实该 Release 仍在线（见 B 节订正），故保留其行并标「2026-06-21 核实仍在线，删除待守密人手动」。
- [ ] C3 A 节核实中发现缺失的任何成果，重新落盘。

## D. 守密人手动 / 已完成

- [x] 删冗余 Release `art-assets-v1`（2026-06-21 守密人手动删除，已核实 release 404）。RELEASES.md 该行已移除。
- [x] 残留 git tag `art-assets-v1` 清理（2026-06-28 核实）：`git tag -l 'art-assets*'` 返回空、
  `RELEASES.md` 已无对应行 → 该 tag 已不存在，清理完成。备有 `Delete Release` workflow
  （`.github/workflows/delete-release.yml`）供以后清其他冗余 release 复用。

## 风险提示（勿删）

- **残余数据风险**：删掉的 3.0G discord，只实证 30 月中 3 月在 Releases 有副本。
  **做 git 历史重写前，不得假定其余 27 月安全**（历史 blob 是唯一二次抢救网）。
- **lesson #41（本会话二次违反）**：flaky 环境工具输出会串扰失真（假"成功"、幻影内容、
  矛盾回执）。禁止凭工具回执或记忆判定"已完成"；交付前必用独立 Read / git log 核实。
  **当核实工具本身也 flaky 时**（如本会话 git add 给矛盾回执）：停止在该环境制造更多写入，
  交给干净环境重做。

## 工作分支

`claude/grill-skill-research-e82r8p`，完成且验证通过后默认 squash 合并 main。
