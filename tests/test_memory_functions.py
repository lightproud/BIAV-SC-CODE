import gzip
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import dream
import fact_store
import knowledge_graph
import memory_search
import memrl


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


class TestEntityDict(unittest.TestCase):
    def test_unified_dict_covers_both_former_copies(self):
        # Concepts/systems that previously lived in only one of the two
        # diverged copies must now all resolve from the single source.
        ed = knowledge_graph._build_entity_dict()
        for key in ("SVN", "THPDom", "止血", "BPT", "MCP", "TF-IDF", "事实圣经", "Silver Core"):
            self.assertIn(key, ed)

    def test_system_aliases_collapse(self):
        ed = knowledge_graph._build_entity_dict()
        self.assertEqual(ed["银芯"], "system:银芯")
        self.assertEqual(ed["Silver Core"], "system:银芯")

    def test_concept_nodes_use_canonical_dict(self):
        nodes, _ = knowledge_graph.extract_concepts_from_text()
        names = {n["name"] for n in nodes if n["type"] == "Concept"}
        self.assertTrue({"BPT", "MCP", "TF-IDF"} <= names)


class TestSuggestArchival(unittest.TestCase):
    def _entry(self, utility, trend, days_old):
        return {
            "utility": utility,
            "trend": trend,
            "first_seen": (memrl.TODAY - timedelta(days=days_old)).isoformat(),
        }

    def test_only_old_low_nonrising_suggested(self):
        # Regression: archival relies on first_seen, not the always-today
        # "computed" field, so a long-tracked low-utility file is now flagged.
        utility = {
            "old_low.md": self._entry(0.1, "declining", 40),
            "new_low.md": self._entry(0.1, "declining", 0),
            "old_high.md": self._entry(0.5, "stable", 40),
            "old_rising.md": self._entry(0.1, "rising", 40),
        }
        suggested = {s["file"] for s in memrl.suggest_archival(utility)}
        self.assertEqual(suggested, {"old_low.md"})


class TestInvertedIndexEquivalence(unittest.TestCase):
    """PERF-03: the inverted-index search path must return the same top-k as a
    full scan over all vectors. The inverted path only scores chunks sharing
    >=1 query token, which is exact-equivalent because a chunk with no shared
    token has cosine 0 (below the 0.01 threshold)."""

    # A few short docs sharing/overlapping vocabulary so the vocab min_df>=2
    # filter keeps real terms and queries hit multiple candidates.
    DOCS = [
        "alpha beta gamma delta alpha",
        "beta gamma epsilon zeta beta",
        "gamma delta epsilon theta",
        "alpha epsilon iota kappa alpha",
        "lambda mu nu beta gamma",
        "alpha beta delta theta iota",
    ]

    def _chunks(self):
        return [
            {"chunk_id": f"c{i}", "text": t, "file": f"f{i}.md", "offset": 0}
            for i, t in enumerate(self.DOCS)
        ]

    def _run_search_with_index(self, index, query, top_k):
        """Drive the real search() against a tmp gzip index, isolating all
        global state (VECTORS_FILE + in-process cache) so the real 39MB index
        is never touched."""
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "vectors.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as f:
                json.dump(index, f, ensure_ascii=False)
            orig_file = memory_search.VECTORS_FILE
            orig_cache = memory_search._index_cache
            orig_mtime = memory_search._index_cache_mtime
            try:
                memory_search.VECTORS_FILE = path
                memory_search._index_cache = None
                memory_search._index_cache_mtime = 0
                return memory_search.search(query, top_k=top_k, use_reranker=False)
            finally:
                memory_search.VECTORS_FILE = orig_file
                memory_search._index_cache = orig_cache
                memory_search._index_cache_mtime = orig_mtime

    def test_inverted_path_matches_full_scan(self):
        index = memory_search.build_tfidf_index(self._chunks())
        self.assertIn("inverted", index)

        # Full-scan variant: same index minus the inverted key (older index
        # files without it fall back to a full scan inside search()).
        full_scan_index = {k: v for k, v in index.items() if k != "inverted"}

        for query in ("alpha beta", "gamma delta", "epsilon theta iota", "alpha"):
            inv = self._run_search_with_index(index, query, top_k=5)
            full = self._run_search_with_index(full_scan_index, query, top_k=5)

            self.assertEqual(
                [r["chunk_id"] for r in inv],
                [r["chunk_id"] for r in full],
                msg=f"top-k order diverged for query {query!r}",
            )
            for a, b in zip(inv, full):
                self.assertAlmostEqual(a["score"], b["score"], places=6)


if __name__ == "__main__":
    unittest.main()
