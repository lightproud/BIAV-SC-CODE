#!/usr/bin/env python3
"""
check_version.py - Automated version update tracker for Morimens wiki.

Checks Steam store API and Fandom wiki for version changes.
Compares with current version in versions.json and creates stub entries
if a new version is detected.

Designed to run in GitHub Actions on a weekly schedule.
"""

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

STEAM_APP_ID = "3052450"
STEAM_API_URL = f"https://store.steampowered.com/api/appdetails?appids={STEAM_APP_ID}"
FANDOM_RC_URL = (
    "https://morimens.fandom.com/api.php"
    "?action=query&list=recentchanges&rclimit=20&rcprop=title|timestamp|user|comment&format=json"
)

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSIONS_PATH = REPO_ROOT / "data" / "db" / "versions.json"
META_PATH = REPO_ROOT / "data" / "db" / "meta.json"
OUTPUT_PATH = REPO_ROOT / "output" / "version_check_result.json"


def fetch_json(url: str, timeout: int = 30) -> dict | None:
    """Fetch JSON from a URL, return None on failure."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MorimensWikiBot/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
        print(f"[WARN] Failed to fetch {url}: {e}", file=sys.stderr)
        return None


def check_steam_version() -> dict:
    """Query Steam store API for the latest app details."""
    result = {"source": "steam", "checked_at": datetime.now(timezone.utc).isoformat()}

    data = fetch_json(STEAM_API_URL)
    if not data:
        result["status"] = "fetch_failed"
        return result

    app_data = data.get(STEAM_APP_ID, {})
    if not app_data.get("success"):
        result["status"] = "api_returned_failure"
        return result

    detail = app_data.get("data", {})
    result["status"] = "ok"
    result["name"] = detail.get("name", "")
    result["short_description"] = detail.get("short_description", "")
    result["last_modified"] = detail.get("last_modified")
    result["required_age"] = detail.get("required_age")

    # Steam doesn't expose a clean "game version" field, but we can
    # detect updates via release_date and recent news.
    release = detail.get("release_date", {})
    result["release_date"] = release.get("date", "")
    result["coming_soon"] = release.get("coming_soon", False)

    # Check recent news for version clues
    news_url = (
        f"https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
        f"?appid={STEAM_APP_ID}&count=5&maxlength=500&format=json"
    )
    news_data = fetch_json(news_url)
    if news_data:
        news_items = news_data.get("appnews", {}).get("newsitems", [])
        result["recent_news"] = [
            {
                "title": item.get("title", ""),
                "date": datetime.fromtimestamp(
                    item.get("date", 0), tz=timezone.utc
                ).isoformat(),
                "url": item.get("url", ""),
            }
            for item in news_items[:5]
        ]

    return result


def check_fandom_changes() -> dict:
    """Check Fandom wiki recent changes for new content."""
    result = {"source": "fandom", "checked_at": datetime.now(timezone.utc).isoformat()}

    data = fetch_json(FANDOM_RC_URL)
    if not data:
        result["status"] = "fetch_failed"
        return result

    changes = data.get("query", {}).get("recentchanges", [])
    result["status"] = "ok"
    result["recent_changes"] = [
        {
            "title": c.get("title", ""),
            "timestamp": c.get("timestamp", ""),
            "user": c.get("user", ""),
            "comment": c.get("comment", ""),
        }
        for c in changes[:10]
    ]
    result["change_count"] = len(changes)

    return result


def detect_version_from_news(steam_result: dict) -> str | None:
    """Try to extract a version number from Steam news titles."""
    import re

    news_items = steam_result.get("recent_news", [])
    version_pattern = re.compile(r"v?(\d+\.\d+(?:\.\d+)?)", re.IGNORECASE)

    for item in news_items:
        title = item.get("title", "")
        match = version_pattern.search(title)
        if match:
            return match.group(1)
    return None


def load_versions() -> dict:
    """Load the current versions.json."""
    with open(VERSIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_meta() -> dict:
    """Load the current meta.json."""
    with open(META_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_known_versions(versions_data: dict) -> set[str]:
    """Extract all known version numbers."""
    return {v["version"] for v in versions_data.get("versions", [])}


def create_stub_version(version: str, source: str) -> dict:
    """Create a stub version entry for a newly detected version."""
    now = datetime.now(timezone.utc)
    return {
        "version": version,
        "title": f"{version}版本（自动检测）",
        "period": str(now.year),
        "highlights": [
            f"版本 {version} 由自动检测系统于 {now.strftime('%Y-%m-%d')} 通过 {source} 发现",
            "具体更新内容待补充",
        ],
        "_auto_detected": True,
        "_detected_at": now.isoformat(),
        "_source": source,
    }


def save_versions(versions_data: dict) -> None:
    """Save updated versions.json."""
    with open(VERSIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(versions_data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def save_result(result: dict) -> None:
    """Save the check result for downstream consumption."""
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> int:
    print("=== Morimens Version Check ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")

    # Load current data
    versions_data = load_versions()
    meta = load_meta()
    known_versions = get_known_versions(versions_data)
    current_version = meta.get("current_version", "unknown")
    print(f"Current version in meta.json: {current_version}")
    print(f"Known versions: {sorted(known_versions)}")

    # Check sources
    steam_result = check_steam_version()
    fandom_result = check_fandom_changes()

    # Detect new version from news
    detected_version = detect_version_from_news(steam_result)
    new_version_found = False
    new_version_str = None

    if detected_version and detected_version not in known_versions:
        print(f"NEW VERSION DETECTED: {detected_version} (from Steam news)")
        new_version_found = True
        new_version_str = detected_version

        # Insert stub entry
        stub = create_stub_version(detected_version, "steam_news")
        versions_data["versions"].append(stub)
        save_versions(versions_data)
        print(f"Stub entry added to versions.json")

    # Compile result
    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "current_version": current_version,
        "known_versions": sorted(known_versions),
        "new_version_found": new_version_found,
        "new_version": new_version_str,
        "steam": steam_result,
        "fandom": fandom_result,
    }

    save_result(result)
    print(f"Result saved to {OUTPUT_PATH}")

    if new_version_found:
        # Write to GitHub Actions output if available
        import os

        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a") as f:
                f.write(f"new_version=true\n")
                f.write(f"version={new_version_str}\n")
        print(f"::notice::New version detected: {new_version_str}")
        return 0
    else:
        import os

        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            with open(github_output, "a") as f:
                f.write("new_version=false\n")
        print("No new version detected.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
