#!/usr/bin/env python3
"""
Fetch publicly available assets for Morimens (忘却前夜) from Steam.

Uses the Steam Store API and known CDN URL patterns to download:
  - Store page screenshots
  - Header / capsule / library images
  - Description text and metadata
  - Movie/trailer thumbnails

Downloads are saved to assets/images/steam/ and art_assets.json is updated.

Usage:
  python3 fetch_steam_assets.py                  # fetch all available assets
  python3 fetch_steam_assets.py --dry-run        # show what would be fetched
  python3 fetch_steam_assets.py --app-id 3052450 # specific app ID only
  python3 fetch_steam_assets.py --skip-existing   # skip already downloaded files

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # brain-in-a-vat/
ASSETS_DIR = PROJECT_ROOT / "assets" / "images" / "steam"
ART_ASSETS_JSON = SCRIPT_DIR.parent / "data" / "db" / "art_assets.json"

UA = "Mozilla/5.0 (compatible; MorimensWikiBot/1.0; +https://github.com/lightproud/brain-in-a-vat)"

# Steam app IDs
APP_IDS = {
    "cn": 3052450,
    "jp": 4226130,
}

# Known Steam CDN image patterns (no API key needed)
STEAM_CDN_BASE = "https://cdn.cloudflare.steamstatic.com/steam/apps"

CDN_IMAGES = {
    "header": "header.jpg",
    "capsule_616x353": "capsule_616x353.jpg",
    "capsule_231x87": "capsule_231x87.jpg",
    "capsule_467x181": "capsule_467x181.jpg",
    "capsule_sm_120": "capsule_sm_120.jpg",
    "library_600x900": "library_600x900.jpg",
    "library_600x900_2x": "library_600x900_2x.jpg",
    "library_hero": "library_hero.jpg",
    "library_hero_blur": "library_hero_blur.jpg",
    "logo": "logo.png",
    "logo_2x": "logo_2x.png",
    "page_bg": "page_bg_generated_v6b.jpg",
    "hero_capsule": "hero_capsule.jpg",
}

# Steam Store API (public, no key required)
STORE_API = "https://store.steampowered.com/api/appdetails"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def fetch_url(url: str, timeout: int = 30) -> Optional[bytes]:
    """Fetch URL content. Returns bytes or None on failure."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
        print(f"  WARN: Failed to fetch {url}: {e}", file=sys.stderr)
        return None


def fetch_json(url: str) -> Optional[dict]:
    """Fetch and parse JSON from URL."""
    data = fetch_url(url)
    if data is None:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"  WARN: Failed to parse JSON from {url}: {e}", file=sys.stderr)
        return None


def download_file(url: str, dest: Path, skip_existing: bool = False) -> bool:
    """Download a file to dest path. Returns True on success."""
    if skip_existing and dest.exists() and dest.stat().st_size > 0:
        print(f"  Skip (exists): {dest.name}")
        return True

    data = fetch_url(url)
    if data is None:
        return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    size_kb = len(data) / 1024
    print(f"  Downloaded: {dest.name} ({size_kb:.1f} KB)")
    return True


# ---------------------------------------------------------------------------
# Steam Store API
# ---------------------------------------------------------------------------

def fetch_app_details(app_id: int) -> Optional[dict]:
    """Fetch app details from Steam Store API."""
    url = f"{STORE_API}?appids={app_id}&l=schinese"
    print(f"\nFetching Steam Store API: appid={app_id}")
    resp = fetch_json(url)
    if resp is None:
        return None

    app_data = resp.get(str(app_id), {})
    if not app_data.get("success"):
        print(f"  API returned success=false for appid {app_id}")
        return None

    return app_data.get("data", {})


def extract_store_info(details: dict) -> dict:
    """Extract useful info from Steam Store API response."""
    info = {
        "name": details.get("name", ""),
        "type": details.get("type", ""),
        "steam_appid": details.get("steam_appid"),
        "is_free": details.get("is_free", False),
        "short_description": details.get("short_description", ""),
        "detailed_description": details.get("detailed_description", ""),
        "about_the_game": details.get("about_the_game", ""),
        "supported_languages": details.get("supported_languages", ""),
        "developers": details.get("developers", []),
        "publishers": details.get("publishers", []),
        "categories": [c.get("description", "") for c in details.get("categories", [])],
        "genres": [g.get("description", "") for g in details.get("genres", [])],
        "release_date": details.get("release_date", {}),
        "platforms": details.get("platforms", {}),
        "metacritic": details.get("metacritic", {}),
        "header_image": details.get("header_image", ""),
        "capsule_image": details.get("capsule_image", ""),
        "capsule_imagev5": details.get("capsule_imagev5", ""),
        "website": details.get("website", ""),
    }

    # Screenshots
    screenshots = details.get("screenshots", [])
    info["screenshots"] = []
    for ss in screenshots:
        info["screenshots"].append({
            "id": ss.get("id"),
            "path_thumbnail": ss.get("path_thumbnail", ""),
            "path_full": ss.get("path_full", ""),
        })

    # Movies / trailers
    movies = details.get("movies", [])
    info["movies"] = []
    for mv in movies:
        info["movies"].append({
            "id": mv.get("id"),
            "name": mv.get("name", ""),
            "thumbnail": mv.get("thumbnail", ""),
            "webm_480": mv.get("webm", {}).get("480", ""),
            "webm_max": mv.get("webm", {}).get("max", ""),
            "mp4_480": mv.get("mp4", {}).get("480", ""),
            "mp4_max": mv.get("mp4", {}).get("max", ""),
        })

    return info


# ---------------------------------------------------------------------------
# Download logic
# ---------------------------------------------------------------------------

def download_cdn_images(
    app_id: int, region: str, dest_dir: Path, skip_existing: bool, dry_run: bool
) -> list[dict]:
    """Download known CDN images for an app ID."""
    downloaded = []
    region_dir = dest_dir / region

    print(f"\n--- CDN images for {region} (appid={app_id}) ---")
    for name, filename in CDN_IMAGES.items():
        url = f"{STEAM_CDN_BASE}/{app_id}/{filename}"
        dest = region_dir / filename

        if dry_run:
            print(f"  Would fetch: {url}")
            downloaded.append({"name": name, "url": url, "local": str(dest.relative_to(PROJECT_ROOT))})
            continue

        if download_file(url, dest, skip_existing):
            downloaded.append({
                "name": name,
                "url": url,
                "local": str(dest.relative_to(PROJECT_ROOT)),
            })
        # Small delay to be polite
        time.sleep(0.3)

    return downloaded


def download_screenshots(
    screenshots: list[dict], region: str, dest_dir: Path,
    skip_existing: bool, dry_run: bool
) -> list[dict]:
    """Download screenshot images from API data."""
    if not screenshots:
        return []

    ss_dir = dest_dir / region / "screenshots"
    downloaded = []

    print(f"\n--- Screenshots for {region} ({len(screenshots)} found) ---")
    for ss in screenshots:
        ss_id = ss.get("id", "unknown")
        url = ss.get("path_full", "")
        if not url:
            continue

        # Determine filename from URL or use ID
        fname = f"screenshot_{ss_id}.jpg"
        dest = ss_dir / fname

        if dry_run:
            print(f"  Would fetch screenshot {ss_id}: {url}")
            downloaded.append({"id": ss_id, "url": url, "local": str(dest.relative_to(PROJECT_ROOT))})
            continue

        if download_file(url, dest, skip_existing):
            downloaded.append({
                "id": ss_id,
                "url": url,
                "local": str(dest.relative_to(PROJECT_ROOT)),
            })
        time.sleep(0.5)

    # Also download thumbnails
    thumb_dir = dest_dir / region / "screenshots" / "thumbs"
    for ss in screenshots:
        ss_id = ss.get("id", "unknown")
        url = ss.get("path_thumbnail", "")
        if not url:
            continue

        fname = f"thumb_{ss_id}.jpg"
        dest = thumb_dir / fname

        if dry_run:
            continue  # Already noted above

        download_file(url, dest, skip_existing)
        time.sleep(0.3)

    return downloaded


def download_movie_thumbnails(
    movies: list[dict], region: str, dest_dir: Path,
    skip_existing: bool, dry_run: bool
) -> list[dict]:
    """Download movie/trailer thumbnail images."""
    if not movies:
        return []

    mv_dir = dest_dir / region / "movies"
    downloaded = []

    print(f"\n--- Movie thumbnails for {region} ({len(movies)} found) ---")
    for mv in movies:
        mv_id = mv.get("id", "unknown")
        thumb_url = mv.get("thumbnail", "")
        if not thumb_url:
            continue

        fname = f"movie_{mv_id}_thumb.jpg"
        dest = mv_dir / fname

        if dry_run:
            print(f"  Would fetch movie thumb {mv_id}: {thumb_url}")
            downloaded.append({
                "id": mv_id,
                "name": mv.get("name", ""),
                "thumbnail_url": thumb_url,
                "local": str(dest.relative_to(PROJECT_ROOT)),
            })
            continue

        if download_file(thumb_url, dest, skip_existing):
            downloaded.append({
                "id": mv_id,
                "name": mv.get("name", ""),
                "thumbnail_url": thumb_url,
                "local": str(dest.relative_to(PROJECT_ROOT)),
            })
        time.sleep(0.3)

    return downloaded


# ---------------------------------------------------------------------------
# Update art_assets.json
# ---------------------------------------------------------------------------

def update_art_assets(
    fetch_results: dict, dry_run: bool
) -> None:
    """Update art_assets.json with fetched asset information."""
    if not ART_ASSETS_JSON.exists():
        print("  WARN: art_assets.json not found, skipping update")
        return

    art_data = json.loads(ART_ASSETS_JSON.read_text("utf-8"))

    # Update steam_assets section with download info
    if "steam_assets" not in art_data:
        art_data["steam_assets"] = {}

    steam = art_data["steam_assets"]

    # Add fetched screenshots info
    for region, data in fetch_results.items():
        region_key = f"{region}_fetched"
        steam[region_key] = {
            "cdn_images": data.get("cdn_images", []),
            "screenshots_count": len(data.get("screenshots", [])),
            "movies_count": len(data.get("movies", [])),
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        # Add screenshot URLs
        if data.get("screenshots"):
            ss_key = f"{region}_screenshots"
            steam[ss_key] = [
                {"id": s["id"], "url": s["url"], "local": s.get("local", "")}
                for s in data["screenshots"]
            ]

    if dry_run:
        print("\n  Would update art_assets.json with fetch results")
        return

    ART_ASSETS_JSON.write_text(
        json.dumps(art_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n  Updated: {ART_ASSETS_JSON}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch Morimens assets from Steam public APIs and CDN.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be fetched without downloading",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip files that already exist locally",
    )
    parser.add_argument(
        "--app-id",
        type=int,
        help="Fetch only this specific app ID (default: fetch both CN and JP)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ASSETS_DIR,
        help=f"Output directory (default: {ASSETS_DIR.relative_to(PROJECT_ROOT)})",
    )
    parser.add_argument(
        "--no-screenshots",
        action="store_true",
        help="Skip downloading screenshots (CDN images only)",
    )
    parser.add_argument(
        "--save-store-info",
        action="store_true",
        help="Save full Steam Store API response as JSON",
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Morimens Steam Asset Fetcher")
    print(f"Output:   {args.output_dir}")
    print(f"Dry-run:  {args.dry_run}")
    print("=" * 60)

    # Determine which app IDs to fetch
    if args.app_id:
        targets = {"custom": args.app_id}
    else:
        targets = APP_IDS

    fetch_results = {}

    for region, app_id in targets.items():
        print(f"\n{'='*40}")
        print(f"Region: {region} | App ID: {app_id}")
        print(f"{'='*40}")

        region_results: dict[str, Any] = {}

        # 1. Download known CDN images
        cdn_downloaded = download_cdn_images(
            app_id, region, args.output_dir, args.skip_existing, args.dry_run
        )
        region_results["cdn_images"] = cdn_downloaded

        # 2. Fetch Store API details
        details = fetch_app_details(app_id)
        if details:
            store_info = extract_store_info(details)
            region_results["store_info"] = {
                "name": store_info["name"],
                "developers": store_info["developers"],
                "publishers": store_info["publishers"],
                "genres": store_info["genres"],
                "release_date": store_info["release_date"],
                "screenshots_count": len(store_info["screenshots"]),
                "movies_count": len(store_info["movies"]),
            }

            # Save full store info if requested
            if args.save_store_info and not args.dry_run:
                info_dir = args.output_dir / region
                info_dir.mkdir(parents=True, exist_ok=True)
                info_path = info_dir / "store_info.json"
                info_path.write_text(
                    json.dumps(store_info, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                print(f"\n  Saved store info: {info_path}")

            # 3. Download screenshots
            if not args.no_screenshots:
                ss_downloaded = download_screenshots(
                    store_info["screenshots"], region, args.output_dir,
                    args.skip_existing, args.dry_run,
                )
                region_results["screenshots"] = ss_downloaded

            # 4. Download movie thumbnails
            mv_downloaded = download_movie_thumbnails(
                store_info["movies"], region, args.output_dir,
                args.skip_existing, args.dry_run,
            )
            region_results["movies"] = mv_downloaded
        else:
            print(f"  Could not fetch store details for app {app_id}")

        fetch_results[region] = region_results

        # Polite delay between regions
        if len(targets) > 1:
            time.sleep(1)

    # Update art_assets.json
    update_art_assets(fetch_results, args.dry_run)

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for region, data in fetch_results.items():
        cdn_count = len(data.get("cdn_images", []))
        ss_count = len(data.get("screenshots", []))
        mv_count = len(data.get("movies", []))
        print(f"  {region}: {cdn_count} CDN images, {ss_count} screenshots, {mv_count} movie thumbs")

    print("\nDone.")


if __name__ == "__main__":
    main()
