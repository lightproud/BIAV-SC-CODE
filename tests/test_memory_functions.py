import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import dream
import fact_store
import knowledge_graph


class TestComputeDeviation(unittest.TestCase):
    def test_ratio(self):
        self.assertEqual(dream.compute_deviation(10, 5), 2.0)

    def test_zero_baseline_guarded(self):
        self.assertEqual(dream.compute_deviation(5, 0), 0.0)
        self.assertEqual(dream.compute_deviation(5, -1), 0.0)


class TestExtractKeywords(unittest.TestCase):
    def test_counts_repeats(self):
        self.assertEqual(dream.extract_keywords("hello hello world")["hello"], 2)

    def test_drops_stop_words(self):
        kw = dream.extract_keywords("the the cat")
        self.assertNotIn("the", kw)
        self.assertEqual(kw["cat"], 1)

    def test_chinese_runs_kept_whole(self):
        # extract_keywords uses whole-run matching (NOT sliding bigrams)
        self.assertEqual(dream.extract_keywords("银芯系统")["银芯系统"], 1)


class TestFindNearDuplicates(unittest.TestCase):
    def test_identical_texts_flagged(self):
        dupes = dream.find_near_duplicates(["hello world foo", "hello world foo"])
        self.assertEqual(len(dupes), 1)

    def test_disjoint_texts_not_flagged(self):
        self.assertEqual(dream.find_near_duplicates(["apple banana", "cat dog"]), [])


class TestParseTimestamp(unittest.TestCase):
    def _write(self, text: str) -> Path:
        f = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
        f.write(text)
        f.close()
        return Path(f.name)

    def test_last_updated_pattern(self):
        self.assertEqual(dream.parse_timestamp(self._write("> 最后更新：2026-05-01\n")), date(2026, 5, 1))

    def test_version_dash_pattern(self):
        self.assertEqual(dream.parse_timestamp(self._write("> v3.0 — 2026.05.19\n")), date(2026, 5, 19))

    def test_no_timestamp_returns_none(self):
        self.assertIsNone(dream.parse_timestamp(self._write("no date here\n")))


class TestCosineSimilarity(unittest.TestCase):
    def test_identical(self):
        self.assertAlmostEqual(fact_store.cosine_similarity(["a", "b"], ["a", "b"]), 1.0)

    def test_disjoint(self):
        self.assertEqual(fact_store.cosine_similarity(["a"], ["b"]), 0.0)

    def test_empty(self):
        self.assertEqual(fact_store.cosine_similarity([], ["a"]), 0.0)


class TestMakeNodeId(unittest.TestCase):
    def test_format(self):
        self.assertEqual(knowledge_graph.make_node_id("Character", "Erica"), "character:Erica")


if __name__ == "__main__":
    unittest.main()
