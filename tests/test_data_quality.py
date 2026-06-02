import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import data_quality as dq


class TestNormalizeEngagement(unittest.TestCase):
    def test_default_source_uses_raw_engagement(self):
        self.assertEqual(dq.normalize_engagement({"source": "reddit", "engagement": 50}), 50.0)

    def test_unknown_source_falls_back_to_default_weight(self):
        self.assertEqual(dq.normalize_engagement({"source": "mystery", "engagement": 7}), 7.0)

    def test_bilibili_engagement_only_treated_as_views(self):
        # with no interaction metadata, engagement is assumed to be play count
        self.assertEqual(
            dq.normalize_engagement({"source": "bilibili", "engagement": 100000}),
            100.0,
        )

    def test_bilibili_weighted_interactions(self):
        item = {
            "source": "bilibili",
            "engagement": 0,
            "metadata": {"play": 100000, "like": 10, "coin": 5, "favorite": 2, "share": 1},
        }
        # 100000*0.001 + (10 + 5*2 + 2*2 + 1*3) = 100 + 27
        self.assertEqual(dq.normalize_engagement(item), 127.0)

    def test_weibo_weighted_formula(self):
        item = {
            "source": "weibo",
            "engagement": 0,
            "metadata": {"reposts_count": 10, "comments_count": 5, "attitudes_count": 20},
        }
        # 10*3 + 5*2 + 20*1
        self.assertEqual(dq.normalize_engagement(item), 60.0)

    def test_youtube_weighted_formula(self):
        item = {
            "source": "youtube",
            "engagement": 0,
            "metadata": {"viewCount": 10000, "likeCount": 50, "commentCount": 10},
        }
        # 10000*0.0001 + 50 + 10
        self.assertEqual(dq.normalize_engagement(item), 61.0)


class TestIsHotNormalized(unittest.TestCase):
    def test_threshold_boundary_inclusive(self):
        # reddit threshold is 50; equal counts as hot
        self.assertTrue(dq.is_hot_normalized({"source": "reddit", "engagement": 50}))
        self.assertFalse(dq.is_hot_normalized({"source": "reddit", "engagement": 49}))

    def test_bilibili_views_cross_threshold(self):
        # 200000 plays -> 200 normalized >= 100 threshold
        self.assertTrue(dq.is_hot_normalized({"source": "bilibili", "engagement": 200000}))
        self.assertFalse(dq.is_hot_normalized({"source": "bilibili", "engagement": 50000}))


if __name__ == "__main__":
    unittest.main()
