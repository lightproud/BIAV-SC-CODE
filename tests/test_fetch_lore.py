import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_lore


class TestTextExtractor(unittest.TestCase):
    def test_extracts_visible_text(self):
        p = fetch_lore.TextExtractor()
        p.feed("<p>Hello</p><p>World</p>")
        self.assertIn("Hello", p.get_text())
        self.assertIn("World", p.get_text())

    def test_skips_script_and_style(self):
        p = fetch_lore.TextExtractor()
        p.feed("<script>var x=1;</script><p>Keep</p><style>.a{}</style>")
        text = p.get_text()
        self.assertIn("Keep", text)
        self.assertNotIn("var x", text)
        self.assertNotIn(".a{}", text)

    def test_block_tags_insert_newlines(self):
        p = fetch_lore.TextExtractor()
        p.feed("<div>A</div><div>B</div>")
        self.assertIn("\n", p.get_text())


class TestExtractChapterInfo(unittest.TestCase):
    def test_description_built_from_long_lines(self):
        text = "\n".join([
            "短",  # too short, dropped
            "这是一段足够长的剧情描述用来作为章节摘要内容测试。",
            "另一段同样足够长的剧情描述继续补充摘要文本内容信息。",
        ])
        info = fetch_lore.extract_chapter_info(text)
        self.assertIn("足够长的剧情描述", info["detailed_description"])

    def test_skips_navigation_lines(self):
        text = "编辑这个页面的导航目录分类模板信息内容内容内容内容内容\n真正的剧情描述足够长的内容文本继续补充信息测试。"
        info = fetch_lore.extract_chapter_info(text)
        self.assertNotIn("导航目录分类", info["detailed_description"])
        self.assertIn("真正的剧情描述", info["detailed_description"])

    def test_featured_characters_detected(self):
        text = "在这一章中，艾瑞卡和莉莉一同行动，遇到了拉蒙娜的阻拦内容内容内容内容。"
        info = fetch_lore.extract_chapter_info(text)
        self.assertIn("艾瑞卡", info["featured_characters"])
        self.assertIn("莉莉", info["featured_characters"])
        self.assertIn("拉蒙娜", info["featured_characters"])

    def test_description_capped_at_1000_chars(self):
        long_line = "字" * 60
        text = "\n".join([long_line] * 30)
        info = fetch_lore.extract_chapter_info(text)
        self.assertLessEqual(len(info["detailed_description"]), 1000)

    def test_empty_text(self):
        info = fetch_lore.extract_chapter_info("")
        self.assertEqual(info["detailed_description"], "")
        self.assertEqual(info["featured_characters"], [])


class TestFetchSideStories(unittest.TestCase):
    def test_detects_mentioned_story(self):
        sides = fetch_lore.fetch_side_stories("本章提到了雨镇幽影的事件")
        ids = {s["id"] for s in sides}
        self.assertIn("rainy_town", ids)
        self.assertTrue(all(s["mentioned"] for s in sides))

    def test_no_mention_yields_empty(self):
        self.assertEqual(fetch_lore.fetch_side_stories("无关内容"), [])


if __name__ == "__main__":
    unittest.main()
