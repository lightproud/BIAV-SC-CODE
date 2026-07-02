Validate the wiki data baseline (realigned 2026-07-02; the legacy
`projects/wiki/data/db/` layer was wiped by keeper ruling 2026-06-15 —
its absence is expected, do NOT treat it as "not yet bootstrapped"):

1. Run the canonical validator and report its output:
   `python3 projects/wiki/scripts/validate_data.py`
   (validates `data/processed/characters.json` against
   `data/schemas/characters.processed.schema.json`, checks
   `_meta.total_characters == len(characters)`, and checks id uniqueness;
   legacy db schemas stay registered as SKIP)
2. For each file in `projects/wiki/data/processed/*.json`:
   - Verify JSON is valid (parseable)
   - Check key fields are non-empty
   - Count data entries
3. Output a validation report table:
   | File | Valid | Entry Count | Issues |
4. Flag any files with 0 entries or parse errors
5. Check `processed/characters.json` has exactly 72 characters
   (真实总数，含皮肤/联动/彩蛋；playable 58 / unreleased 12 / easter_egg 2，
   见 memory/wiki-phase-2-gap-inventory.md)
6. Check cross-references where applicable (e.g. `processed/story/index.json`
   character ids resolve against `processed/characters.json`).

Note: `memory/wiki-characters-schema-v1.md` (locked v1.0 schema) applies to
the retired db chain only; it is shelved until that structured layer is
rebuilt (see memory/decisions.md 2026-06-15 entry).
