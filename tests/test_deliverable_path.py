"""锁定 scripts/deliverable_path.py 的强约束契约：确定性路径 + 挡同义分裂 + 形式守卫。"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "deliverable_path.py"
REGISTRY = ROOT / "Public-Info-Pool" / "types.json"


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True, text=True,
    )


class TestDeliverablePath(unittest.TestCase):
    def test_path_deterministic(self):
        r = run("path", "--type", "daily-news", "--topic", "morimens-daily", "--date", "20260601")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(
            r.stdout.strip(),
            "Public-Info-Pool/Resource/daily-news/morimens-daily-20260601.md",
        )

    def test_same_inputs_same_path(self):
        a = run("path", "--type", "game-analysis", "--topic", "foo", "--date", "20260601")
        b = run("path", "--type", "game-analysis", "--topic", "foo", "--date", "20260601")
        self.assertEqual(a.stdout, b.stdout)

    def test_revision_suffix(self):
        r = run("path", "--type", "daily-news", "--topic", "x", "--date", "20260601", "--rev", "2", "--ext", "pdf")
        self.assertTrue(r.stdout.strip().endswith("x-20260601-r2.pdf"), r.stdout)

    def test_rev1_no_suffix(self):
        r = run("path", "--type", "daily-news", "--topic", "x", "--date", "20260601", "--rev", "1")
        self.assertTrue(r.stdout.strip().endswith("x-20260601.md"), r.stdout)

    def test_unregistered_type_rejected(self):
        r = run("path", "--type", "dailynews", "--topic", "x", "--date", "20260601")
        self.assertEqual(r.returncode, 1)
        self.assertIn("未登记", r.stderr)

    def test_underscore_form_rejected(self):
        r = run("path", "--type", "daily_news", "--topic", "x", "--date", "20260601")
        self.assertEqual(r.returncode, 1)
        self.assertIn("形式不合规", r.stderr)

    def test_bad_date_rejected(self):
        r = run("path", "--type", "daily-news", "--topic", "x", "--date", "2026-06-01")
        self.assertEqual(r.returncode, 1)

    def test_registry_form_compliant(self):
        data = json.loads(REGISTRY.read_text(encoding="utf-8"))
        import re
        kebab = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
        for name in data["types"]:
            self.assertRegex(name, kebab, f"类型名 '{name}' 违反 kebab-case 形式约定")


if __name__ == "__main__":
    unittest.main()
