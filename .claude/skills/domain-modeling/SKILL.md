---
name: domain-modeling
description: Build and sharpen 银芯's shared language, and record decisions as they crystallise. Use when the keeper wants to pin down terminology, resolve a fuzzy term, capture an architectural decision, or when another skill (e.g. /grilling) needs to maintain the model.
---

# Domain Modeling — 术语锐化与决策落档

Actively sharpen the project's shared language *as you design*, and write
terminology and decisions down the moment they crystallise. This is the *active*
discipline — challenging terms, inventing edge-case scenarios, recording outcomes —
not merely *reading* a glossary for vocabulary (any skill can do that in one line).

## Where things land (银芯 targets)

银芯 has no generic `CONTEXT.md` glossary or `docs/adr/` tree. Map the upstream
"glossary + ADR" idea onto the existing knowledge layer:

- **术语 (glossary)** → `memory/morimens-context.md` 「核心术语」table for
  worldview/game terms; the term tables in `CLAUDE.md §5` for system/architecture
  terms. A sub-project's own jargon goes in its `projects/<x>/CONTEXT.md`.
- **决策 (decisions, the ADR equivalent)** → `memory/decisions.md`「当前有效决策」table.

## During the session

### Challenge against the glossary
When the keeper uses a term that conflicts with the existing language, call it out
immediately. "morimens-context 把『X』定义为 A，但守密人此处似乎指 B —— 哪个为准？"

### Sharpen fuzzy language
When a term is vague or overloaded, propose a precise canonical 银芯 term, listing
the words to avoid. "守密人说『数据层』—— 指全量档案层（`Public-Info-Pool/Record/Community/`）还是
输出展示层（`projects/news/output/`）？二者语义不可互换（§4.1）。"

### Stress-test with scenarios
When relationships are discussed, invent concrete edge-case scenarios that force the
boundaries between concepts to be made precise.

### Cross-reference with the archive
When the keeper states how something works, check whether the repository agrees
(`assets/data/*`, `memory/decisions.md`, `memory/project-status.md`). Surface any
contradiction at once — never let a claim past that the archive refutes.

### Update the glossary inline
When a term resolves, record it right there in the appropriate glossary file (format
above) — don't batch. A glossary entry is a tight one-or-two-sentence definition of
what the term **is**, plus the words to `_Avoid_`. No implementation detail.

### Offer to record a decision — sparingly, and gated
Only propose a `memory/decisions.md` entry when **all three** are true:

1. **Hard to reverse** — changing your mind later has a meaningful cost.
2. **Surprising without context** — a future session will wonder "为什么这么做？".
3. **The result of a real trade-off** — there were genuine alternatives.

If any is missing, skip it. When all three hold, **draft** the entry in the existing
decision-table format and present it for the keeper to ratify — **do not write to
`memory/decisions.md` directly**. Per `CLAUDE.md §3.1`, the decision archive is
守密人 / 主控台 authority only; Erica drafts and flags, the keeper commits.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) `domain-modeling`
(MIT, © 2026 Matt Pocock); retargeted onto 银芯's glossary files and the §3.1-gated
decision log.
