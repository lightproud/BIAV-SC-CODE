"""Guards for the public-edition in-repo workshop (keeper directive 2026-08-04).

The workshop lets any silver-core checkout assemble and deploy the PUBLIC
Black Pool bundle by itself (projects/black-pool-agent/public-workshop/).
These tests pin the three field-proven disciplines the cmd suite relies on:
the kit files it references must exist, runtime dirs must never enter git,
and goto-label blocks must stay ASCII (65001 parser desync, field case 3).
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WS = ROOT / "projects" / "black-pool-agent" / "public-workshop"
KIT = ROOT / "projects" / "black-pool-agent" / "deploy"


class TestPublicWorkshop(unittest.TestCase):
    def test_workshop_files_exist(self):
        for name in ("RUNBOOK.md", "assemble.cmd", "rollback.cmd", ".gitignore"):
            self.assertTrue((WS / name).is_file(), f"public-workshop/{name} missing")

    def test_referenced_kit_helpers_exist(self):
        """assemble.cmd borrows helpers from ../deploy — they must stay in place."""
        for name in (
            "launcher.cmd",
            "launch_desktop.py",
            "fix_venv_path.py",
            "kill_by_path.py",
            "make-shortcut.vbs",
        ):
            self.assertTrue((KIT / name).is_file(), f"deploy kit helper {name} missing")

    def test_gitignore_covers_runtime_dirs(self):
        ignore = (WS / ".gitignore").read_text(encoding="utf-8")
        for entry in ("releases/", "staging/", "BlackPool/", "BlackPool.old/", "*.log"):
            self.assertIn(entry, ignore, f".gitignore lost entry {entry}")

    def test_failure_labels_stay_ascii(self):
        """Blocks entered via goto must be ASCII-only (65001 desync, field case 3).

        Heuristic: from a failure label (rot_fail) to the next exit, every echo
        must be plain ASCII.
        """
        text = (WS / "assemble.cmd").read_text(encoding="utf-8")
        block = re.search(r":rot_fail(.*?)exit /b", text, re.S)
        self.assertIsNotNone(block, "rot_fail block missing")
        for line in block.group(1).splitlines():
            self.assertTrue(
                line.isascii(), f"non-ASCII line inside goto-label block: {line!r}"
            )

    def test_no_intranet_ingredients(self):
        """Public workshop must not invoke intranet injection machinery.

        Checked by tool invocation, not by literal word — prose comments may
        legitimately say 'no intranet parts involved'.
        """
        for name in ("assemble.cmd", "rollback.cmd"):
            text = (WS / name).read_text(encoding="utf-8")
            for tool in ("assemble_inject", "apply_patch", "assembly.txt"):
                self.assertNotIn(tool, text, f"{name} pulls intranet step {tool}")


if __name__ == "__main__":
    unittest.main()
