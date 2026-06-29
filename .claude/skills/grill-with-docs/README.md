# grill-with-docs — 上游原版（未改编）

This is the **verbatim, un-adapted upstream** `grill-with-docs` skill from
[mattpocock/skills](https://github.com/mattpocock/skills) (`skills/engineering/grill-with-docs`),
installed alongside — not replacing — 银芯's own adapted `grill` chain
(`.claude/skills/grill` + `grilling` + `domain-modeling`).

It is kept in its original generic form on purpose (守密人 2026-06-29 裁定：补装上游原版，
保留 CONTEXT.md / ADR 通用范式），so the upstream's generic glossary + ADR convention is
preserved here as a faithful reference, distinct from the 银芯-flavoured adaptation.

## What's in this folder

| File | Source (mattpocock/skills) | Role |
|------|----------------------------|------|
| `SKILL.md` | `skills/engineering/grill-with-docs/SKILL.md` | The skill itself — a 2-line delegator |
| `reference/grilling.md` | `skills/productivity/grilling/SKILL.md` | The relentless one-question interview loop |
| `reference/domain-modeling.md` | `skills/engineering/domain-modeling/SKILL.md` | Generic glossary + ADR discipline |
| `reference/CONTEXT-FORMAT.md` | `skills/engineering/domain-modeling/CONTEXT-FORMAT.md` | Generic `CONTEXT.md` glossary format |
| `reference/ADR-FORMAT.md` | `skills/engineering/domain-modeling/ADR-FORMAT.md` | Generic `docs/adr/` ADR format |

The `reference/` files are bundled as documentation only — they are not registered as
separate skills (only `SKILL.md` is), so they do **not** collide with the repo's existing
`/grilling` and `/domain-modeling` skills.

## ⚠ Runtime note (read before relying on the generic form)

`SKILL.md` says verbatim: *"Run a `/grilling` session, using the `/domain-modeling` skill."*
Those two slugs resolve **globally** within this repo, where `/grilling` and `/domain-modeling`
already exist as the **银芯-adapted** skills (which target `memory/decisions.md` /
`memory/morimens-context.md`, not generic `CONTEXT.md` / `docs/adr/`).

Therefore, invoking `/grill-with-docs` here behaves **functionally like the adapted `/grill`**.
The generic CONTEXT.md / ADR convention lives in `reference/` as a faithful on-disk copy for
reference and comparison; it is not what executes at runtime. To drive the generic convention,
follow the `reference/*` files manually.

## License / attribution

Adapted-from-nothing — these are verbatim copies. Original work © 2026 Matt Pocock,
released under the MIT License. See https://github.com/mattpocock/skills.
