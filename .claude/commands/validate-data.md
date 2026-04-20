Validate all JSON data files in the wiki database:

0. Pre-check: verify `projects/wiki/data/db/` directory exists.
   - If the directory is missing, the Phase 2 baseline has not been
     bootstrapped yet. Halt, and report: "data/db/ not yet established,
     see memory/wiki-phase-2-gap-inventory.md and
     memory/wiki-characters-schema-draft.md for the bootstrap plan."
1. For each file in `projects/wiki/data/db/*.json` (and `projects/wiki/data/processed/*.json`):
   - Verify JSON is valid (parseable)
   - Check key fields are non-empty
   - Count data entries
2. Output a validation report table:
   | File | Valid | Entry Count | Issues |
3. Flag any files with 0 entries or parse errors
4. If `characters.json` exists, check it has exactly 72 characters
   (真实总数，含皮肤/联动/彩蛋；见 memory/wiki-phase-2-gap-inventory.md)
5. Check all JSON files are consistent (cross-reference IDs where applicable)
6. Cross-validate against `projects/wiki/data/schemas/*.schema.json`
   (characters / meta / realms) and the draft v0.1 schema in
   `memory/wiki-characters-schema-draft.md` when applicable.
