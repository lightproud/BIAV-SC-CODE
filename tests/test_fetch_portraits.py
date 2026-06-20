import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"))

import fetch_portraits


class TestGetExtension(unittest.TestCase):
    def test_png(self):
        self.assertEqual(fetch_portraits.get_extension("http://x/a/b.png"), ".png")

    def test_jpg(self):
        self.assertEqual(fetch_portraits.get_extension("http://x/a/b.JPG?v=1"), ".jpg")

    def test_webp(self):
        self.assertEqual(fetch_portraits.get_extension("http://x/img.webp"), ".webp")

    def test_unknown_extension_defaults_png(self):
        self.assertEqual(fetch_portraits.get_extension("http://x/img.gif"), ".png")

    def test_no_extension_defaults_png(self):
        self.assertEqual(fetch_portraits.get_extension("http://x/img"), ".png")


class TestFindPortraitImage(unittest.TestCase):
    def test_prioritizes_portrait_keyword(self):
        images = ["File:Map.png", "File:Erica_portrait.png", "File:Erica_misc.png"]
        self.assertEqual(
            fetch_portraits.find_portrait_image(images, "Erica"),
            "File:Erica_portrait.png",
        )

    def test_skips_icon_logo_banner(self):
        images = ["File:Erica_icon.png", "File:Erica_banner.png", "File:Erica_full.png"]
        self.assertEqual(
            fetch_portraits.find_portrait_image(images, "Erica"),
            "File:Erica_full.png",
        )

    def test_name_match_fallback(self):
        images = ["File:Unrelated.png", "File:Erica_art.png"]
        self.assertEqual(
            fetch_portraits.find_portrait_image(images, "Erica"),
            "File:Erica_art.png",
        )

    def test_no_candidate_returns_first_image(self):
        images = ["File:Something.png"]
        self.assertEqual(
            fetch_portraits.find_portrait_image(images, "Nobody"),
            "File:Something.png",
        )

    def test_empty_list_returns_none(self):
        self.assertIsNone(fetch_portraits.find_portrait_image([], "Erica"))

    def test_name_with_underscore_and_colon_normalized(self):
        images = ["File:Ramona_art.png"]
        self.assertEqual(
            fetch_portraits.find_portrait_image(images, "Ramona:_Timeworn"),
            "File:Ramona_art.png",
        )


if __name__ == "__main__":
    unittest.main()
