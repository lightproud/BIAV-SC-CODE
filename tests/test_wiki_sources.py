import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import wiki_sources as ws


class TestWikiSources(unittest.TestCase):
    def test_page_maps_cover_same_slugs(self):
        # EN and zh page maps must stay in sync (same character slugs)
        self.assertEqual(set(ws.PAGE_MAP), set(ws.BILI_PAGE_MAP))

    def test_expected_entry_count(self):
        self.assertEqual(len(ws.PAGE_MAP), 59)

    def test_known_entries(self):
        self.assertEqual(ws.PAGE_MAP["erica"], "Erica")
        self.assertEqual(ws.BILI_PAGE_MAP["erica"], "艾瑞卡")

    def test_fandom_wikis_matches_bases(self):
        self.assertEqual(ws.FANDOM_WIKIS, [ws.FANDOM_BASE, ws.FANDOM_ALT])

    def test_rate_limit(self):
        self.assertEqual(ws.RATE_LIMIT, 0.5)


if __name__ == "__main__":
    unittest.main()
