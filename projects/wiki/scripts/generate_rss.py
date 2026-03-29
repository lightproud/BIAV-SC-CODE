#!/usr/bin/env python3
"""
generate_rss.py - Generate RSS and Atom feeds for the Morimens wiki.

Produces two feeds:
  1. Game version updates (from versions.json)
  2. Wiki content updates (from git log on data files)

Output:
  - docs/public/feed.xml  (RSS 2.0)
  - docs/public/atom.xml  (Atom 1.0)
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree, indent

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSIONS_PATH = REPO_ROOT / "data" / "db" / "versions.json"
META_PATH = REPO_ROOT / "data" / "db" / "meta.json"
DATA_DIR = REPO_ROOT / "data" / "db"
FEED_DIR = REPO_ROOT / "docs" / "public"

SITE_URL = "https://lightproud.github.io/brain-in-a-vat/wiki"
FEED_TITLE = "Morimens Wiki Updates"
FEED_TITLE_ZH = "忘却前夜 Wiki 更新"
FEED_DESCRIPTION = "Latest updates from the Morimens (忘却前夜) community wiki - game versions and data changes."


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_git_log_entries(directory: Path, max_count: int = 20) -> list[dict]:
    """Get recent git commits affecting data files."""
    try:
        result = subprocess.run(
            [
                "git", "log",
                f"--max-count={max_count}",
                "--format=%H|%aI|%an|%s",
                "--", str(directory),
            ],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=30,
        )
        if result.returncode != 0:
            return []

        entries = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            parts = line.split("|", 3)
            if len(parts) == 4:
                entries.append({
                    "hash": parts[0],
                    "date": parts[1],
                    "author": parts[2],
                    "subject": parts[3],
                })
        return entries
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


def build_version_items(versions_data: dict) -> list[dict]:
    """Build feed items from version history."""
    items = []
    for v in reversed(versions_data.get("versions", [])):
        version = v.get("version", "")
        title = v.get("title", f"Version {version}")
        period = v.get("period", "")
        highlights = v.get("highlights", [])

        description_parts = [f"<p><strong>{title}</strong> ({period})</p>"]
        if highlights:
            description_parts.append("<ul>")
            for h in highlights:
                description_parts.append(f"  <li>{h}</li>")
            description_parts.append("</ul>")

        items.append({
            "title": f"[Game] v{version} - {title}",
            "link": f"{SITE_URL}/zh/changelog",
            "guid": f"morimens-version-{version}",
            "description": "\n".join(description_parts),
            "category": "game-version",
            "pub_date": period,
        })
    return items


def build_wiki_items(git_entries: list[dict]) -> list[dict]:
    """Build feed items from git log entries."""
    items = []
    for entry in git_entries:
        items.append({
            "title": f"[Wiki] {entry['subject']}",
            "link": f"https://github.com/lightproud/brain-in-a-vat/commit/{entry['hash']}",
            "guid": f"morimens-wiki-commit-{entry['hash'][:12]}",
            "description": f"<p>Data update by {entry['author']}: {entry['subject']}</p>",
            "category": "wiki-update",
            "pub_date": entry["date"],
        })
    return items


def parse_fuzzy_date(date_str: str) -> datetime:
    """Parse various date formats into datetime objects."""
    # Try ISO format first
    try:
        return datetime.fromisoformat(date_str)
    except (ValueError, TypeError):
        pass

    # Try extracting a year
    import re
    year_match = re.search(r"(\d{4})", str(date_str))
    if year_match:
        return datetime(int(year_match.group(1)), 1, 1, tzinfo=timezone.utc)

    return datetime.now(timezone.utc)


def format_rfc822(dt: datetime) -> str:
    """Format datetime as RFC 822 for RSS."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%a, %d %b %Y %H:%M:%S %z")


def format_rfc3339(dt: datetime) -> str:
    """Format datetime as RFC 3339 for Atom."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def generate_rss(items: list[dict], output_path: Path) -> None:
    """Generate RSS 2.0 feed."""
    rss = Element("rss", version="2.0")
    rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")

    channel = SubElement(rss, "channel")
    SubElement(channel, "title").text = FEED_TITLE
    SubElement(channel, "link").text = SITE_URL
    SubElement(channel, "description").text = FEED_DESCRIPTION
    SubElement(channel, "language").text = "zh-CN"
    SubElement(channel, "lastBuildDate").text = format_rfc822(datetime.now(timezone.utc))

    atom_link = SubElement(channel, "atom:link")
    atom_link.set("href", f"{SITE_URL}/feed.xml")
    atom_link.set("rel", "self")
    atom_link.set("type", "application/rss+xml")

    for item_data in items:
        item = SubElement(channel, "item")
        SubElement(item, "title").text = item_data["title"]
        SubElement(item, "link").text = item_data["link"]

        guid = SubElement(item, "guid")
        guid.set("isPermaLink", "false")
        guid.text = item_data["guid"]

        SubElement(item, "description").text = item_data["description"]
        SubElement(item, "category").text = item_data["category"]

        pub_date = parse_fuzzy_date(item_data["pub_date"])
        SubElement(item, "pubDate").text = format_rfc822(pub_date)

    tree = ElementTree(rss)
    indent(tree, space="  ")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(b'<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode" if sys.version_info >= (3, 8) else "utf-8",
                   xml_declaration=False)
    # Fix: write as bytes properly
    content = output_path.read_text("utf-8")
    output_path.write_text(content, encoding="utf-8")

    print(f"RSS feed written to {output_path} ({len(items)} items)")


def generate_atom(items: list[dict], output_path: Path) -> None:
    """Generate Atom 1.0 feed."""
    ns = "http://www.w3.org/2005/Atom"
    feed = Element("feed", xmlns=ns)

    SubElement(feed, "title").text = FEED_TITLE
    SubElement(feed, "subtitle").text = FEED_DESCRIPTION
    SubElement(feed, "id").text = f"{SITE_URL}/"
    SubElement(feed, "updated").text = format_rfc3339(datetime.now(timezone.utc))

    link_self = SubElement(feed, "link")
    link_self.set("href", f"{SITE_URL}/atom.xml")
    link_self.set("rel", "self")
    link_self.set("type", "application/atom+xml")

    link_alt = SubElement(feed, "link")
    link_alt.set("href", SITE_URL)
    link_alt.set("rel", "alternate")
    link_alt.set("type", "text/html")

    author = SubElement(feed, "author")
    SubElement(author, "name").text = "Morimens Wiki"
    SubElement(author, "uri").text = SITE_URL

    for item_data in items:
        entry = SubElement(feed, "entry")
        SubElement(entry, "title").text = item_data["title"]
        SubElement(entry, "id").text = f"urn:morimens-wiki:{item_data['guid']}"

        link = SubElement(entry, "link")
        link.set("href", item_data["link"])
        link.set("rel", "alternate")

        pub_date = parse_fuzzy_date(item_data["pub_date"])
        SubElement(entry, "updated").text = format_rfc3339(pub_date)
        SubElement(entry, "published").text = format_rfc3339(pub_date)

        content = SubElement(entry, "content")
        content.set("type", "html")
        content.text = item_data["description"]

        category = SubElement(entry, "category")
        category.set("term", item_data["category"])

    tree = ElementTree(feed)
    indent(tree, space="  ")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(b'<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode" if sys.version_info >= (3, 8) else "utf-8",
                   xml_declaration=False)
    content_str = output_path.read_text("utf-8")
    output_path.write_text(content_str, encoding="utf-8")

    print(f"Atom feed written to {output_path} ({len(items)} items)")


def main() -> int:
    print("=== Morimens Wiki RSS/Atom Feed Generator ===")

    # Load data
    versions_data = load_json(VERSIONS_PATH)
    git_entries = get_git_log_entries(DATA_DIR)

    # Build items
    version_items = build_version_items(versions_data)
    wiki_items = build_wiki_items(git_entries)

    # Combine and sort (wiki items first as they have real dates)
    all_items = wiki_items + version_items

    print(f"Version items: {len(version_items)}")
    print(f"Wiki data change items: {len(wiki_items)}")
    print(f"Total items: {len(all_items)}")

    # Generate feeds
    rss_path = FEED_DIR / "feed.xml"
    atom_path = FEED_DIR / "atom.xml"

    generate_rss(all_items, rss_path)
    generate_atom(all_items, atom_path)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
