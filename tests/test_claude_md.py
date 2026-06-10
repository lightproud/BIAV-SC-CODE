"""Guard against CLAUDE.md referencing paths that no longer exist (lessons #25/#29)."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLAUDE_MD = ROOT / "CLAUDE.md"

# Backtick tokens containing these are commands, globs, or templates — not literal paths.
SKIP_CHARS = ("{", "*", "<", " ", "&", '"')


def referenced_paths():
    text = CLAUDE_MD.read_text(encoding="utf-8")
    for token in re.findall(r"`([^`\n]+)`", text):
        if any(c in token for c in SKIP_CHARS):
            continue
        if "/" not in token or token.startswith("/"):
            continue  # bare names are not paths; leading "/" means a slash command
        yield token.rstrip("/")


class TestClaudeMdReferences(unittest.TestCase):
    def test_extracts_a_meaningful_sample(self):
        paths = list(referenced_paths())
        self.assertGreaterEqual(len(paths), 15, "extraction regex likely broken")

    def test_referenced_paths_exist(self):
        missing = sorted({p for p in referenced_paths() if not (ROOT / p).exists()})
        self.assertEqual(missing, [], f"CLAUDE.md references nonexistent paths: {missing}")


if __name__ == "__main__":
    unittest.main()
