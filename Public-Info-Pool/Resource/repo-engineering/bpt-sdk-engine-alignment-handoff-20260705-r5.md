# BPT Agent SDK — 引擎侧修改交接清单 r5（账目结算 / SETTLED）

> **r5（2026-07-05）——账目对齐结算档**。触发：隔壁引擎的状态基于交接档 **r4**，把 E1–E8 全列为
> **待领的引擎工单**；但那批工单正是守密人「全面实现」批次（**PR #480 `feat(bpt-sdk): completion-inventory
> full-implementation campaign — v0.7.0`，合并进 main = `9260261e`**）已在**本仓库引擎侧**做掉的。r4 是那批
> 落地**之前**写就的快照，据此得出的「待办」视图已过期。本档按 §4.2 R3（「审计建议」≠「代码已落盘」，
> 引用必须验直接产出该事实的源）**逐工单核对 main 实况 + 代码铁证**，退役 r4 的待领工视图。
>
> **账目错位的物理根源**：交接档 r4（`...-r4.md`，commit `9ed0c015`）成文于 #480 之前；隔壁拿到的是那一刻的
> 冻结视图。r4 与 r5 并存时**以 r5 为准**（日期同、修订新）。r4 保留供审计追溯，不再作待办清单消费。

- **对齐基准**：origin/main 顶点含 `#480`（9260261e，v0.7.0）与 `#484`（c8421c7d，posix-hazard 守卫 + 前台 Bash kill 孪生修复）。
- **证据合规**：净室 r3 已解除内容盲(②)，E7 系列规格实读官方请求体（合法）；③ 泄漏禁引 + §1.1-HC 黑池防火墙不变。
- **小学生比喻（账目错位本身）**：隔壁手里的是「上周的待办便签」，可这周的活早干完了、还归了档；两张单子并排看像有一堆没做的活，
  其实只是便签没跟着更新。本档就是把便签换成「已完工验收单」。

---

## 逐工单结算表（r4 待办 → main 实况）

| 工单 | r4 视图 | main 实况 | 铁证（直接产出该事实的源） |
|------|---------|-----------|------|
| **E1** preset 默认开思考 | 待办 | **已落地**（#480 之前，验收轮 run 28741914245：chat-03 0/3→3/3、乙门禁 +13.0pp、econ 2.25×） | r4 §E1 自身已记该验收轮结果 |
| **E2** result 字段口径 | 待办 | **已落地 @ #480** | `src/query.ts:939` 注释「E2, KD-L5-04 pinned live」；num_turns/usage 转本轮量、cost/duration 累计；KD-L5-04 退役 |
| **E3** 截断轮优雅降级 | 待办 | **韧性默认已落地 @ #480**（maxRetries 10 + stall-watchdog）；KD-L4-02/04 转 MATCH 需一轮 L4 实证核对 | #480 commit + `src/transport/stall-watchdog.ts`（新增 82 行） |
| **E4** Write 读前写门 | 待办 | **已落地 @ #480** | `src/tools/write.ts:90` 官方原文错误串「File has not been read yet. Read it first before writing to it.」 |
| **E5** maxBudgetUsd 执行前截停 | 待办 | **已落地 @ #480** | `src/engine/loop.ts` 多处 `error_max_budget_usd` 前置分发（:1086/:1234/:1269/:1313） |
| **E6a/c/d** 错误面收口 | 待办（E6b 已由银芯落地） | **已落地 @ #480** | `src/errors.ts`（+113 行，McpError 分类 + 稳定错误码）+ `tests/error-discipline.test.ts`（层间抛错白名单守护） |
| **E7-01** thinking 默认自适应 | 待办 | **已落地 @ #480** | `WIRE_ALIGNMENT_GAPS` 中 default/tool-loop/mcp-added 三场景 `thinking` facet 已清（仅显式 thinking-off/4096 覆盖场景保留，属预期） |
| **E7-02** 工具 schema 补参 | 待办 | **主体已落地 @ #480**（Read `pages` / Bash `dangerouslyDisableSandbox` / Agent `isolation`+`model` 已补）；残余 `TOOL_GAPS = ['Agent:params']` | `tests/conformance-wire.test.ts:162`（TOOL_GAPS 从 Agent/Bash/Read 三条缩到一条） |
| **E7-03** 工具块缓存断点 | 最低优先、需实测收益 | **有意保留为 KD**（systemSegments 缓存边界放置 + toolCacheBreakpoints，策略差非缺陷；改前需 benchmark 实测净收益） | `WIRE_ALIGNMENT_GAPS` 仍登记；#480 未动（需裁定的策略差） |
| **E8** 子代理生命周期 system+subtype 编码 | 待办 | **已落地 @ #480** | `tests/conformance-l35.test.ts:18`「KD-L35-02 (encoding): RETIRED 2026-07-05 (B2a/E8, v0.7). Both arms now emit ... system SUBTYPES」；锁已翻转钉官方编码 |
| **settingSources 默认反转** | （#480 射程内） | **有意 deferred** — 守密人升钉裁定项 | #480 commit message 明示「settingSources default reversal deferred (keeper bump-pin decision)」 |

**结论**：r4 列的 E1–E8 引擎工单在 main **已全部落地**（E1 于 #480 之前、其余随 #480/v0.7.0），
两项**非缺陷保留**：E7-03（需裁定的缓存策略差 KD）、settingSources 默认反转（需升钉裁定）。
E7-02 留一条 `Agent:params` 残余（我方 Agent 必填 `subagent_type` 用于路由，与官方必填集差一项——drop-in 语义差，
待确认按 KD 保留还是对齐）。**隔壁无待领引擎工单。**

---

## 剩余动作：纯花预算 / 需裁定的验收动作（非引擎代码工作）

代码侧已无挂账。以下三项皆需守密人给信号才推进，不擅自花预算 / 升钉：

1. **一轮真 L5 双臂**（`conformance_l5` dispatch，~$1.5 帽内）——验 E7-01 自适应思考是否移动 **code-01 残余**（现 0/3，E1 验收轮未动）。
   这是唯一有实质悬念的花预算动作。
2. **run-l35 双臂实证封印**——E8 代码 + 锁已落地并翻转，encodingDiff 逻辑上已清；双臂真跑一轮给 KD-L35-02 盖实证退役章（需官方臂）。
3. **升钉 + `run-wire --update-reference` + settingSources 默认反转**——同一个升钉裁定点：官方 pin 升级后刷参考目标、并把 settingSources 默认反转一并做。

守密人给「dispatch 真 L5」或「升钉」任一信号即可推进；否则**本线判定收官**。

## 与 r4 的关系

- r4（`bpt-sdk-engine-alignment-handoff-20260705-r4.md`，commit `9ed0c015`）：**冻结于 #480 之前的待办快照，已过期**，仅供审计追溯。
- r5（本档）：**结算档，当前权威**。隔壁应据本档把 r4 的「待领工」项全部销账。
