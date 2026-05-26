import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import collect_global


class TestDedupKey(unittest.TestCase):
    def test_url_first(self):
        self.assertEqual(collect_global.dedup_key({"url": "https://x.com/a"}), "https://x.com/a")

    def test_url_normalized(self):
        # http->https, trailing slash and whitespace stripped, so the same
        # article from two collectors collapses to one dedup key.
        a = collect_global.dedup_key({"url": " http://x.com/a/ "})
        b = collect_global.dedup_key({"url": "https://x.com/a"})
        self.assertEqual(a, b)

    def test_title_source_author_fallback(self):
        key = collect_global.dedup_key({"title": "T", "source": "S", "author": "A"})
        self.assertEqual(key, "T|S|A")

    def test_empty_url_falls_back(self):
        # blank url must not collapse unrelated items onto the same key
        k1 = collect_global.dedup_key({"url": "", "title": "One", "source": "S"})
        k2 = collect_global.dedup_key({"url": "", "title": "Two", "source": "S"})
        self.assertNotEqual(k1, k2)


if __name__ == "__main__":
    unittest.main()
