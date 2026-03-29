Validate all JSON data files in the wiki database:

1. For each file in `projects/wiki/data/db/*.json`:
   - Verify JSON is valid (parseable)
   - Check key fields are non-empty
   - Count data entries
2. Output a validation report table:
   | File | Valid | Entry Count | Issues |
3. Flag any files with 0 entries or parse errors
4. Check `characters.json` has > 50 characters
5. Check all JSON files are consistent (cross-reference IDs where applicable)
