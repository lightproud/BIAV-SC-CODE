# BPT Agent SDK v0.6 剩余 —— 执行路线图（ultracode 工作流产出）

> 类型：proposal ｜ 日期：2026-07-05 ｜ 作者：艾瑞卡会话（ultracode 8 代理工作流：6 设计 + 综合 + 红线批判）
> 定位：`bpt-sdk-roadmap-20260705.md`（版本总览）之下、`bpt-sdk-reproduction-scope-ledger-20260704.md`（全做台账）之上的**剩余 backlog 执行分解**——把 Tier 1 残项 + Tier 2/3 拆成可实现增量、按依赖排序、逐项过红线。守密人 2026-07-05「ultracode 推进 V0.6 剩余」裁定下产出。
> 贯穿硬边界：§1.1-HC 黑池防火墙 · 拒真内部泄漏 · 不描述未发货能力（能力与提示词一并发货）· 净室观测边界 · 不测不宣胜负 · 无 emoji。
> 红线批判裁定：**ADJUST**（唯一调整：G-VERIFY 默认模型 sonnet→haiku 对齐已发货 utility 默认，避「更会验证」未测赌注；已采纳落地）。

**首批（本会话）已实现并全绿**：G-VERIFY（三态验证器）+ G-SUMMARY（摘要安全守卫 + away-summary）。详见下「## 已落」。

---

# BPT SDK v0.6 — Execution Roadmap (remaining backlog)

## Classification

### Ship-now (Tier 1: faithful direct-reproduction, real caller exists, finishable-to-green)
| Item | Effort | Real caller | Blast radius |
|---|---|---|---|
| **G-VERIFY** — `adversarialVerify` three-state verdict (CONFIRMED/PLAUSIBLE/REFUTED), recall-biased, fail-closed | M | new exported SDK fn; the /code-review flow calls it per candidate | **None** — greenfield `src/verifier/`, only adds exports |
| **G-SUMMARY** — summarizer no-tools + verbatim-preservation guards; `generateAwaySummary` generator | M | `foldViaApi` (shipped API-summary path) + new exported fn | **Low** — additive; `SUMMARIZER_SYSTEM` untouched, guards in separate constants, `extractSummaryFromReply` is a strict superset |
| **G-HOOKCOND** — hook-condition evaluator + stop variant (pair only) | M | condition-gated `HookCallbackMatcher`, wired in `hooks/runner.ts` same change | **Medium** — introduces a bounded model call into the previously-deterministic hook runner + `query.ts` credential threading; fails CLOSED |
| **G-SANDBOX** — bwrap default-on bash sandbox + faithful sandbox guidance | L | shipped Bash built-in + DefaultPermissionGate | **High** — 11 files incl. `permissions/gate.ts` routing + `bash.ts`/`shells.ts` spawn plumbing |

All four depend only on the confirmed-shipped v0.6 utility runtime (`runUtilityCall`/`extractJsonObject` at `src/generators/runtime.ts`) — no reinvented transport, no cross-dependency, so ordering is by risk, not need.

### Design-only (Tier 2/3: need a tool body or a keeper/caller decision before any prompt is reproduced)
- **O-B1/B2/B3 orchestration** — plan-mode read-only gate; SendMessage + MessageRouter; cross-session peer firewall. Each needs its tool body to land *before* its prompt (unshipped-capability red line).
- **T1 Workflow DSL engine** — needs keeper sandbox-strategy decision (node:vm vs embedded interpreter vs QuickJS) *and* a confirmed BPT Desktop consumer. Deterministic-replay is the crux (XL).
- **T2 Loop/Cron/Monitor/Task** — Loop is a pure-prompt skill; reproduce it only after Cron + Monitor + Task* bodies ship.
- **T3 Skills system** — registry + Skill tool body before `tool-description-skill` reproduction.
- **Excluded / reference-only (never reproduce as shipped):** the 3 unshipped hook classifiers (context-tip-selector, tip-reception-evaluator, memory-file-attach — no consuming subsystem in `src/`); all cloud slugs (schedule-slash-command, cloud-first-scheduling, SearchSkills/SuggestSkills, managed-agents `/v1/skills`) — this SDK is a local embeddable engine and must not ship cloud surfaces.

## Recommended first batch (THIS turn)
**G-VERIFY + G-SUMMARY.** Both are additive utility-call surfaces over the shipped runtime, each ships its prompt *with* a runnable exported caller (no unshipped-capability risk), and each carries a corpus-sync guard against its cited archive slug (all target slugs verified present in `Public-Info-Pool/Reference/Claude-Code-System-Prompts/system-prompts/`). G-VERIFY has zero regression surface (greenfield); G-SUMMARY is a guarded superset of current fold behavior. If maximally conservative, ship **G-VERIFY alone** — it is the only item with literally no touch to existing runtime behavior.

**Measurement discipline is satisfied per item:** G-VERIFY — the fail-closed unit table (garbled/ambiguous/empty -> REFUTED, never `keep:true`) is the before/after proof. G-SUMMARY — a system-contains assertion (guard actually sent) + an analysis-leak fold test (`<analysis>secret</analysis>` never enters the summary). Both keep the existing corpus-sync provenance guard green (G-SUMMARY must bump the provenance count 5->6).

## Dependency-ordered sequence for the rest
1. **Batch 2 (ship-now, more surface):** G-HOOKCOND (pair only; wire the condition-gated matcher in the same change) **and** the **O-B0 preset carve-out** — register `worker-fork` + `coordinator-worker` AgentDefinition presets onto the *already-shipped* `forkActive` branch (confirmed live at `subagents/runtime.ts:699`), consumed by the existing Agent/Task tool with no runtime change. O-B0 is genuinely ship-now and should be extracted from the Tier-2 orchestration spec.
2. **Batch 3 (ship-now, isolate):** G-SANDBOX alone, so gate/spawn changes don't entangle Batches 1–2. Injected-backend tests run everywhere; real-isolation tests behind `it.runIf(hasBwrap)` for CI images.
3. **Orchestration bodies (strict chain):** O-B1 (plan-mode read-only gate + staged-pipeline example) -> O-B2 (SendMessage + intra-session router) -> O-B3 (cross-session peer + structural firewall, gated behind a passing escalation-rejection red-team: the receiving gate's mode + allow/deny lists byte-identical before/after ingesting a peer escalation attempt). O-B3 deliberately does **not** reuse fork's privilege inheritance — that is the precise line between same-session fork (consent flows down) and cross-session peer (consent must not cross the boundary).
4. **Track 2/3 bodies (reuse-first):** Phase A parallel — Task* CRUD + Monitor (v0.4 sink + v0.5 ShellManager) and Skills registry+tool; Phase B — Cron idle-gated scheduler; Phase C — Loop skill prompts (only after A+B); Phase D — Workflow engine (last, behind keeper sandbox + caller decision). Per-track prompt reproduction is always the terminal sub-step.
5. **Standing guard:** add the red-line regression test — no reproduced prompt may reference a tool absent from the builtin registry at that version — so a future contributor cannot silently add an unshipped-capability prompt.

## Red-line posture (all items clear)
- **Feature+prompt together:** every ship-now item lands its capability in the same change as its prompt; the 3 hook classifiers and cloud slugs stay design-only precisely because their subsystems don't exist.
- **Open-info reproduction:** all reproductions cite exact archive slugs (all confirmed present), mark faithful-vs-adapted, and add corpus-sync drift guards; no leaked-source derivatives.
- **§1.1-HC firewall / net-observation:** untouched — pure 银芯->黑池-direction SDK engineering; no black-pool inflow; no reading/persisting the official arm's request body (explicitly re-stated in the peer-inbox module header for O-B3).
- **No emoji anywhere.**

---

## 已落（本会话，Batch 1）

- **G-VERIFY**（`src/verifier/`）：三态验证器 CONFIRMED/PLAUSIBLE/REFUTED + recall-biased 忠实复现（part-4/part-5/skill keep-rule，3 面 provenance + corpus-sync）；`adversarialVerify(finding)` 公开 API；`parseVerdict` **fail-closed**（乱码/歧义/空→REFUTED、keep:false）；默认 haiku、可覆盖；23 单测。
- **G-SUMMARY**：① compaction 摘要器追加 no-tools 守卫 + verbatim 安全保全条（忠实复现，SUMMARIZER_SYSTEM 字节不变、旧金标/provenance 测试保绿）+ `extractSummaryFromReply`（认 `<analysis>/<summary>` 契约、旧行为严格超集）；② `generateAwaySummary`（第 6 面生成器，「回来了」<40 词回顾）。
- 验证：`npx vitest run` **881 全绿**（+43）、`tsc --noEmit` + `build` exit 0；对抗审查随后拷问实现。

## 未落（按上文依赖链推进，需守密人裁或先建工具本体）

- **Batch 2**（ship-now，接线面更大）：G-HOOKCOND（hook-condition 评估器 pair + 同 PR 接 condition-gated matcher）+ O-B0 preset 切出（worker-fork/coordinator-worker AgentDefinition 挂已发货 forkActive 支）。
- **Batch 3**（ship-now，隔离做）：G-SANDBOX（bwrap 默认开 + 沙箱指引，触 gate/spawn 11 文件，单独批）。
- **编排链**（严格顺序，各需工具本体先落）：O-B1 plan-mode 只读门 → O-B2 SendMessage + 会话内路由 → O-B3 跨会话对等 + 结构化同意不可转述防火墙（过 escalation-rejection red-team 才接线；**刻意不复用 fork 特权继承**——同会话 fork 同意向下流 vs 跨会话对等同意不可越界的分界线）。
- **Track 2/3 本体**（复用优先）：Task* CRUD + Monitor（v0.4 通知汇 + v0.5 ShellManager）· Skills 注册表+工具 · Cron 空闲门调度 · Loop skill 提示词（A+B 后）· Workflow DSL 引擎（最后，待守密人沙箱策略裁 + 确认 BPT Desktop 消费方；确定性重放为核心难点）。
- **永不发货（reference-only）**：3 个无消费子系统的 hook 分类器（context-tip-selector / tip-reception-evaluator / memory-file-attach）+ 全部云端 slug——本 SDK 为本地可嵌入引擎，不发云面。建**红线回归测试**：任何复现提示词不得引用当版 builtin 注册表缺席的工具。

## 依据档

- 版本总览：`Public-Info-Pool/Resource/proposal/bpt-sdk-roadmap-20260705.md`
- 全做范围台账：`Public-Info-Pool/Resource/proposal/bpt-sdk-reproduction-scope-ledger-20260704.md`
- 子项目实时状态：`memory/project-status.md`「## BPT Agent SDK」+ `projects/bpt-agent-sdk/CONTEXT.md`
