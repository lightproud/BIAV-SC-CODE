"""Crash-safety smoke tests for the UserPromptSubmit hook scripts/session_inject.py.

Contract derived from the source: the hook must never block user input —
every failure path calls _emit_empty() and main() returns 0, so the process
must always exit 0 and never print a Python traceback. Output on stdout is a
single JSON object with hookSpecificOutput.additionalContext.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOK_PATH = REPO_ROOT / "scripts" / "session_inject.py"

TIMEOUT = 30  # generous upper bound; the no-recall paths return in well under 1s


def _run_hook(stdin_text: str, script: Path = HOOK_PATH, cwd: Path = REPO_ROOT):
    return subprocess.run(
        [sys.executable, str(script)],
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        cwd=str(cwd),
    )


class TestSessionInjectCrashSafety(unittest.TestCase):
    def _assert_no_crash(self, proc):
        self.assertEqual(proc.returncode, 0, msg=f"stderr: {proc.stderr}")
        self.assertNotIn("Traceback", proc.stderr)

    def _assert_empty_context(self, proc):
        payload = json.loads(proc.stdout)
        hook_out = payload["hookSpecificOutput"]
        self.assertEqual(hook_out["hookEventName"], "UserPromptSubmit")
        self.assertEqual(hook_out["additionalContext"], "")

    def test_empty_stdin_exits_zero_with_empty_context(self):
        proc = _run_hook("")
        self._assert_no_crash(proc)
        self._assert_empty_context(proc)

    def test_malformed_json_exits_zero_with_empty_context(self):
        proc = _run_hook("{not valid json!!")
        self._assert_no_crash(proc)
        self._assert_empty_context(proc)

    def test_non_dict_json_exits_zero_with_empty_context(self):
        proc = _run_hook('["a", "list", "not", "a", "dict"]')
        self._assert_no_crash(proc)
        self._assert_empty_context(proc)

    def test_trivial_prompt_skips_recall_and_exits_zero(self):
        # Prompts shorter than MIN_RECALL_CHARS (12) skip the recall path entirely.
        proc = _run_hook(json.dumps({"prompt": "ok", "session_id": "s1"}))
        self._assert_no_crash(proc)
        self._assert_empty_context(proc)

    def test_valid_json_in_empty_workspace_exits_zero(self):
        # The hook locates silver_memory_tools via its own __file__ directory.
        # Running a copy from an empty tmp dir simulates a workspace with no
        # memory layer: the import fails and the hook must fall back to empty
        # output instead of crashing.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_script = Path(tmp) / "session_inject.py"
            shutil.copy(HOOK_PATH, tmp_script)
            payload = json.dumps(
                {"prompt": "a sufficiently long prompt to trigger the recall path",
                 "session_id": "s2"}
            )
            proc = _run_hook(payload, script=tmp_script, cwd=Path(tmp))
        self._assert_no_crash(proc)
        self._assert_empty_context(proc)


if __name__ == "__main__":
    unittest.main()
