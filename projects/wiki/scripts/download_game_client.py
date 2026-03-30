#!/usr/bin/env python3
"""
Auto-download Morimens PC game client from official sources.

Tries multiple official download channels in order:
1. Global official site (morimens.qookkagames.com)
2. TW official site (morimens.sialiagames.com.tw)

Extracts the installer/archive to get the game data directory.

Usage:
    python3 download_game_client.py --output ~/game_data
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urljoin


OFFICIAL_SITES = [
    "https://morimens.qookkagames.com/",
    "https://morimens.sialiagames.com.tw/",
]

# Patterns for download links in page HTML
DOWNLOAD_LINK_PATTERNS = [
    # Direct download links (exe, zip, 7z)
    re.compile(r'href=["\']([^"\']*(?:\.exe|\.zip|\.7z|\.rar)[^"\']*)["\']', re.IGNORECASE),
    # CDN links often in data attributes or JS
    re.compile(r'["\']?(https?://[^"\'<>\s]*(?:download|client|setup|install)[^"\'<>\s]*\.(?:exe|zip|7z))["\']?', re.IGNORECASE),
    # Generic download button hrefs
    re.compile(r'href=["\']([^"\']*(?:download|client)[^"\']*)["\']', re.IGNORECASE),
]

# Known CDN patterns for Qookka/Sialia games
CDN_PATTERNS = [
    re.compile(r'["\']?(https?://(?:cdn|dl|download)[^"\'<>\s]+(?:Morimens|morimens)[^"\'<>\s]*)["\']?', re.IGNORECASE),
]


def fetch_page(url: str) -> str | None:
    """Fetch a web page, return HTML or None on failure."""
    print(f"  Fetching {url} ...")
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  Failed: {e}")
        return None


def find_download_url(html: str, base_url: str) -> str | None:
    """Extract PC client download URL from page HTML."""
    # Try CDN patterns first (most specific)
    for pattern in CDN_PATTERNS:
        matches = pattern.findall(html)
        for match in matches:
            url = match if match.startswith("http") else urljoin(base_url, match)
            print(f"  Found CDN link: {url}")
            return url

    # Try download link patterns
    for pattern in DOWNLOAD_LINK_PATTERNS:
        matches = pattern.findall(html)
        for match in matches:
            url = match if match.startswith("http") else urljoin(base_url, match)
            # Filter out obvious non-game links
            lower = url.lower()
            if any(skip in lower for skip in ("android", "apk", "ios", "appstore", "google")):
                continue
            if any(kw in lower for kw in ("pc", "windows", "win", "client", "setup", "install", ".exe", ".zip")):
                print(f"  Found download link: {url}")
                return url

    # Look for JavaScript variables containing download URLs
    js_url_pattern = re.compile(
        r'(?:pc_?url|download_?url|client_?url|win_?url)\s*[:=]\s*["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    matches = js_url_pattern.findall(html)
    for match in matches:
        url = match if match.startswith("http") else urljoin(base_url, match)
        print(f"  Found JS download URL: {url}")
        return url

    return None


def download_file(url: str, dest_dir: Path) -> Path:
    """Download a file to dest_dir, return the file path."""
    filename = url.split("/")[-1].split("?")[0]
    if not filename or len(filename) > 200:
        filename = "morimens_client.exe"
    dest = dest_dir / filename
    print(f"  Downloading to {dest} ...")

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })
    with urllib.request.urlopen(req, timeout=600) as resp:
        total = resp.headers.get("Content-Length")
        total = int(total) if total else None
        downloaded = 0
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)  # 1MB chunks
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 / total
                    print(f"\r  Progress: {downloaded / 1024 / 1024:.1f} / {total / 1024 / 1024:.1f} MB ({pct:.0f}%)", end="", flush=True)
                else:
                    print(f"\r  Downloaded: {downloaded / 1024 / 1024:.1f} MB", end="", flush=True)
    print()
    return dest


def extract_installer(installer: Path, output_dir: Path) -> None:
    """Extract installer/archive using 7z (handles EXE/ZIP/7Z/RAR/NSIS/InnoSetup)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = installer.suffix.lower()

    if suffix in (".zip", ".7z", ".rar"):
        subprocess.run(
            ["7z", "x", str(installer), f"-o{output_dir}", "-y"],
            check=True,
        )
    elif suffix == ".exe":
        # Try 7z first (handles NSIS, InnoSetup, self-extracting archives)
        result = subprocess.run(
            ["7z", "x", str(installer), f"-o{output_dir}", "-y"],
            capture_output=True,
        )
        if result.returncode != 0:
            # Some installers need special handling — try innoextract
            inno_result = subprocess.run(
                ["innoextract", "-d", str(output_dir), str(installer)],
                capture_output=True,
            )
            if inno_result.returncode != 0:
                print(f"  7z output: {result.stderr.decode()}")
                print(f"  innoextract output: {inno_result.stderr.decode()}")
                raise RuntimeError("Failed to extract installer with 7z and innoextract")
    else:
        # Try 7z as generic extractor
        subprocess.run(
            ["7z", "x", str(installer), f"-o{output_dir}", "-y"],
            check=True,
        )


def find_game_data_dir(extract_dir: Path) -> Path | None:
    """Find the *_Data directory in extracted files."""
    # Look for Morimens_Data or similar
    for d in extract_dir.rglob("*_Data"):
        if d.is_dir():
            return d

    # Look for StreamingAssets
    for d in extract_dir.rglob("StreamingAssets"):
        if d.is_dir():
            return d.parent

    # Look for .assets files
    for f in extract_dir.rglob("*.assets"):
        return f.parent

    return None


def main():
    parser = argparse.ArgumentParser(description="Auto-download Morimens PC client")
    parser.add_argument("--output", "-o", type=Path, default=Path.home() / "game_data",
                        help="Output directory for extracted game data")
    parser.add_argument("--url", type=str, default=None,
                        help="Direct download URL (skip auto-detection)")
    parser.add_argument("--keep-installer", action="store_true",
                        help="Keep the downloaded installer after extraction")
    args = parser.parse_args()

    download_url = args.url

    if not download_url:
        print("=" * 60)
        print("Morimens PC Client Auto-Downloader")
        print("Searching official sites for download link...")
        print("=" * 60)

        for site_url in OFFICIAL_SITES:
            html = fetch_page(site_url)
            if html:
                download_url = find_download_url(html, site_url)
                if download_url:
                    print(f"\nFound download URL from {site_url}")
                    break

    if not download_url:
        print("\nERROR: Could not find PC client download URL from official sites.")
        print("The official sites may use JavaScript rendering or have changed their structure.")
        print("\nYou can provide the URL directly:")
        print("  python3 download_game_client.py --url 'https://...'")
        sys.exit(1)

    print(f"\nDownload URL: {download_url}")

    # Download
    with tempfile.TemporaryDirectory(prefix="morimens_dl_") as tmp:
        tmp_dir = Path(tmp)
        installer = download_file(download_url, tmp_dir)
        print(f"  Downloaded: {installer} ({installer.stat().st_size / 1024 / 1024:.1f} MB)")

        # Extract
        print("\nExtracting installer...")
        extract_dir = tmp_dir / "extracted"
        extract_installer(installer, extract_dir)

        # Find game data
        game_data = find_game_data_dir(extract_dir)
        if not game_data:
            print("ERROR: Could not find game data directory in extracted files")
            print("Extracted structure:")
            for p in sorted(extract_dir.rglob("*"))[:50]:
                if p.is_file():
                    print(f"  {p.relative_to(extract_dir)}")
            sys.exit(1)

        print(f"Found game data: {game_data}")

        # Copy to output
        args.output.mkdir(parents=True, exist_ok=True)
        import shutil
        if args.output.exists():
            shutil.rmtree(args.output)
        shutil.copytree(game_data, args.output)
        print(f"Game data copied to: {args.output}")

        if args.keep_installer:
            kept = args.output.parent / installer.name
            shutil.copy2(installer, kept)
            print(f"Installer kept at: {kept}")

    print("\nDone. Game data is ready for extraction.")
    print(f"Next step: python3 extract_client_data.py {args.output}")


if __name__ == "__main__":
    main()
