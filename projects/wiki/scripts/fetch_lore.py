#!/usr/bin/env python3
"""
Fetch detailed story/lore data from wiki sources and update lore.json.

Sources:
  1. Bilibili wiki (wiki.biligame.com/morimens) - most complete Chinese source
  2. GameKee (gamekee.com/morimens) - detailed chapter guides
  3. Huiji wiki (morimens.huijiwiki.com) - supplementary

Extracts:
  - Detailed chapter descriptions (500-1000 chars)
  - Featured characters per chapter
  - Side stories (雨镇幽影, etc.)
  - Key dialogue snippets

Usage:
  python3 fetch_lore.py              # fetch and update
  python3 fetch_lore.py --dry-run    # print results only

Requires: Python 3.8+ (stdlib only)
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
LORE_JSON = SCRIPT_DIR.parent / "data" / "db" / "lore.json"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

# Bilibili wiki pages for story chapters
BWIKI_BASE = "https://wiki.biligame.com/morimens"
BWIKI_PAGES = {
    "main_story": f"{BWIKI_BASE}/主线剧情",
    "chapter_1": f"{BWIKI_BASE}/第一章_东区秘事",
    "chapter_2": f"{BWIKI_BASE}/第二章_蜕变",
    "chapter_3": f"{BWIKI_BASE}/第三章",
    "chapter_4": f"{BWIKI_BASE}/第四章",
    "chapter_5": f"{BWIKI_BASE}/第五章",
    "chapter_6": f"{BWIKI_BASE}/第六章",
    "chapter_7": f"{BWIKI_BASE}/第七章",
    "stellar_1": f"{BWIKI_BASE}/星辰篇第一章",
    "stellar_2": f"{BWIKI_BASE}/星辰篇第二章_蜕变",
    "stellar_3": f"{BWIKI_BASE}/星辰篇第三章",
    "stellar_4": f"{BWIKI_BASE}/星辰篇第四章_乐园",
    "side_stories": f"{BWIKI_BASE}/支线故事",
}

# GameKee story pages
GAMEKEE_BASE = "https://www.gamekee.com/morimens"

# Huiji wiki API for structured data
HUIJI_API = "https://morimens.huijiwiki.com/api.php"


class TextExtractor(HTMLParser):
    """Simple HTML to text converter."""

    def __init__(self):
        super().__init__()
        self.text = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "footer", "header"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer", "header"):
            self._skip = False
        if tag in ("p", "br", "div", "h1", "h2", "h3", "h4", "li"):
            self.text.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.text.append(data.strip())

    def get_text(self) -> str:
        return " ".join(self.text)


def fetch_url(url: str) -> str:
    """Fetch URL and return text content."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
            parser = TextExtractor()
            parser.feed(html)
            return parser.get_text()
    except Exception as e:
        print(f"  [WARN] Failed to fetch {url}: {e}")
        return ""


def fetch_huiji_page(title: str) -> str:
    """Fetch a page from Huiji wiki via API."""
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": title,
        "prop": "text",
        "format": "json",
    })
    url = f"{HUIJI_API}?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            html = data.get("parse", {}).get("text", {}).get("*", "")
            parser = TextExtractor()
            parser.feed(html)
            return parser.get_text()
    except Exception as e:
        print(f"  [WARN] Huiji API failed for '{title}': {e}")
        return ""


def extract_chapter_info(text: str) -> dict:
    """Extract chapter details from wiki page text."""
    info = {
        "detailed_description": "",
        "featured_characters": [],
    }

    # Try to extract story summary (first meaningful paragraph)
    lines = [l.strip() for l in text.split("\n") if len(l.strip()) > 20]
    if lines:
        # Take first 3-5 meaningful lines as description
        desc_lines = []
        for line in lines[:10]:
            if any(skip in line for skip in ["编辑", "目录", "导航", "分类", "模板"]):
                continue
            desc_lines.append(line)
            if len("".join(desc_lines)) > 500:
                break
        info["detailed_description"] = " ".join(desc_lines)[:1000]

    # Extract character names mentioned
    char_patterns = [
        "莉莉", "艾尔瓦", "朵尔", "拉蒙娜", "萝坦", "奥吉尔",
        "图鲁", "希莱斯特", "珊", "雷娅", "尤乌哈希",
        "塔薇", "24", "弥利亚姆", "艾瑞卡", "莉兹",
        "萨尔瓦多", "墨菲", "达芙黛尔", "索蕾尔",
    ]
    for name in char_patterns:
        if name in text:
            info["featured_characters"].append(name)

    return info


def fetch_side_stories(text: str) -> list[dict]:
    """Extract side story info from wiki content."""
    side_stories = []
    known_sides = [
        {"id": "rainy_town", "name": "雨镇幽影", "name_en": "Rainy Town Shadows"},
        {"id": "elworth", "name": "艾尔沃斯", "name_en": "Elworth"},
    ]
    for story in known_sides:
        if story["name"] in text:
            story["mentioned"] = True
            side_stories.append(story)
    return side_stories


def main():
    dry_run = "--dry-run" in sys.argv

    print("=== Fetching lore data from wiki sources ===\n")

    # Try each source
    chapter_data = {}

    # Source 1: Bilibili wiki
    print("--- Source: Bilibili Wiki ---")
    for key, url in BWIKI_PAGES.items():
        print(f"  Fetching {key}...")
        text = fetch_url(url)
        if text:
            chapter_data[key] = extract_chapter_info(text)
            chars = chapter_data[key]["featured_characters"]
            desc_len = len(chapter_data[key]["detailed_description"])
            print(f"    ✓ {desc_len} chars, {len(chars)} characters mentioned")
        else:
            print(f"    ✗ Failed")
        time.sleep(1)

    # Source 2: Huiji wiki
    print("\n--- Source: Huiji Wiki ---")
    huiji_pages = ["主线剧情", "忘却篇", "星辰篇", "支线故事"]
    for title in huiji_pages:
        print(f"  Fetching '{title}'...")
        text = fetch_huiji_page(title)
        if text and len(text) > 100:
            key = f"huiji_{title}"
            chapter_data[key] = extract_chapter_info(text)
            print(f"    ✓ {len(text)} chars extracted")
        else:
            print(f"    ✗ Failed or empty")
        time.sleep(1)

    # Source 3: GameKee
    print("\n--- Source: GameKee ---")
    gamekee_urls = {
        "story_overview": f"{GAMEKEE_BASE}/606912.html",
    }
    for key, url in gamekee_urls.items():
        print(f"  Fetching {key}...")
        text = fetch_url(url)
        if text:
            chapter_data[f"gamekee_{key}"] = extract_chapter_info(text)
            print(f"    ✓ {len(text)} chars")
        else:
            print(f"    ✗ Failed")
        time.sleep(1)

    print(f"\n=== Results: {len(chapter_data)} pages fetched ===\n")

    if dry_run:
        for key, info in chapter_data.items():
            desc = info["detailed_description"][:100]
            print(f"  {key}: {desc}...")
            if info["featured_characters"]:
                print(f"    Characters: {', '.join(info['featured_characters'])}")
        return

    # Update lore.json
    with open(LORE_JSON) as f:
        data = json.load(f)

    # Map fetched data to chapters
    chapter_map = {
        "chapter_1": (0, 1),  # arc 0, chapter index 1
        "chapter_2": (0, 2),
        "chapter_3": (0, 3),
        "chapter_4": (0, 4),
        "chapter_5": (0, 5),
        "chapter_6": (0, 6),
        "chapter_7": (0, 7),
        "stellar_1": (1, 1),
        "stellar_2": (1, 2),
        "stellar_3": (1, 3),
        "stellar_4": (1, 4),
    }

    updated = 0
    for key, (arc_idx, ch_idx) in chapter_map.items():
        if key not in chapter_data:
            continue
        info = chapter_data[key]
        if not info["detailed_description"]:
            continue

        arc = data["main_story"]["arcs"][arc_idx]
        if ch_idx < len(arc["chapters"]):
            chapter = arc["chapters"][ch_idx]
            chapter["detailed_description"] = info["detailed_description"]
            if info["featured_characters"]:
                chapter["featured_characters"] = info["featured_characters"]
            updated += 1

    # Add side stories if found
    if "side_stories" in chapter_data:
        sides = fetch_side_stories(chapter_data.get("side_stories", {}).get("detailed_description", ""))
        if sides:
            data["side_stories"] = sides

    with open(LORE_JSON, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Updated {updated} chapters in lore.json")


if __name__ == "__main__":
    main()
