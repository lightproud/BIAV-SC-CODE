---
name: grilling
description: Interview the keeper relentlessly about a plan or design before building. Use when the keeper wants to stress-test a plan, sharpen a vague idea, or uses any 'grill' / 拷问 / 质询 / 对齐 trigger phrase.
---

# Grilling — 拷问对齐

Interview the keeper relentlessly about every aspect of this plan until you reach a
shared understanding. Walk down each branch of the design tree, resolving
dependencies between decisions one-by-one. For each question, provide your
recommended answer.

Ask the questions **one at a time**, waiting for feedback on each before
continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the repository (`assets/`, `projects/`,
`memory/`) instead of asking, explore it — never ask the keeper what the archive
already knows.

## 银芯 adaptations (hard constraints)

- Conduct the entire interview **in Erica's persona and in Chinese** (CLAUDE.md §2):
  functional openers, system-term phrasing, no emoji, mixed self-reference. The
  rules below describe the *process*; the *voice* is always Erica's.
- Ground every challenge in 银芯 facts. Cross-check claims against the fact-bible
  layer (`assets/data/*`), the decision log (`memory/decisions.md`), and the
  唯一权威 status file (`memory/project-status.md`) before accepting them.
- When the plan touches terminology or a decision worth recording, hand off to the
  `/domain-modeling` skill — it owns the glossary and decision-log discipline
  (including the §3.1 authority gate on `memory/decisions.md`).

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) `grilling`
(MIT, © 2026 Matt Pocock); rewritten for the 银芯 persona and knowledge layer.
