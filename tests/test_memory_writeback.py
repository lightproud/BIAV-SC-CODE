import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import memory_writeback


class TestDigestCleanupSparesMetaFiles(unittest.TestCase):
    """Regression: digest cleanup glob("*.json") must NOT match *.meta.json.

    session_distiller.py writes {stamp}-{sid}.meta.json into the same
    session-digests dir; those are memrl/dream_rem inputs (gitignored runtime
    data) and deleting them is unrecoverable.
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_digests_dir = memory_writeback.DIGESTS_DIR
        memory_writeback.DIGESTS_DIR = Path(self._tmp.name)

    def tearDown(self):
        memory_writeback.DIGESTS_DIR = self._orig_digests_dir
        self._tmp.cleanup()

    def test_cleanup_keeps_meta_json(self):
        digests_dir = memory_writeback.DIGESTS_DIR
        # 55 plain digests (over the keep-last-50 threshold) + 3 meta files
        for i in range(55):
            (digests_dir / f"20260101-{i:06d}.json").write_text("{}", encoding="utf-8")
        meta_names = [f"20260101-{i:06d}-sid.meta.json" for i in range(3)]
        for name in meta_names:
            (digests_dir / name).write_text("{}", encoding="utf-8")

        changes = {"modified": [], "added": [], "deleted": [], "commits": []}
        memory_writeback.write_session_digest(changes, facts=[], graph_updates=0)

        remaining = {p.name for p in digests_dir.glob("*.json")}
        # All meta files survive the cleanup
        for name in meta_names:
            self.assertIn(name, remaining)
        # Plain digests are trimmed to the 50 newest
        plain = [n for n in remaining if not n.endswith(".meta.json")]
        self.assertEqual(len(plain), 50)


if __name__ == "__main__":
    unittest.main()
