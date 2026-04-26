#!/usr/bin/env bash
# Download wiki assets from GitHub Releases for local development.
# Usage: bash scripts/download_wiki_assets.sh [--all | --art | --media]
set -euo pipefail

DEST="projects/wiki/docs/public"
cd "$DEST"

download_and_extract() {
  local tag="$1"
  shift
  for tb in "$@"; do
    if [ ! -f "$tb" ]; then
      echo "  Downloading $tb from $tag..."
      gh release download "$tag" -p "$tb"
    fi
    echo "  Extracting $tb..."
    tar xzf "$tb" && rm "$tb"
  done
}

MODE="${1:---all}"

if [ "$MODE" = "--art" ] || [ "$MODE" = "--all" ]; then
  echo "=== Art assets (art-assets-v2) ==="
  download_and_extract art-assets-v2 \
    morimens-cg-full.tar.gz \
    morimens-icons-full.tar.gz \
    morimens-units.tar.gz \
    morimens-portraits-full.tar.gz \
    morimens-uiresources.tar.gz
  [ -d portrait ] && mv portrait portrait-card
fi

if [ "$MODE" = "--media" ] || [ "$MODE" = "--all" ]; then
  echo "=== Audio assets (audio-assets-v1) ==="
  mkdir -p audio
  download_and_extract audio-assets-v1 \
    morimens-audio-ogg-part1.tar.gz \
    morimens-audio-ogg-part2.tar.gz
  find . -maxdepth 2 -name "*.ogg" -not -path "./audio/*" -exec mv {} audio/ \; 2>/dev/null || true

  echo "=== Video assets (video-assets-v1) ==="
  mkdir -p video
  download_and_extract video-assets-v1 \
    morimens-video.tar.gz
  find . -maxdepth 2 -name "*.mp4" -not -path "./video/*" -exec mv {} video/ \; 2>/dev/null || true
fi

echo ""
echo "Done. Asset directories:"
for d in cg icon bunit munit portraits uiresources scenebg portrait-card audio video; do
  if [ -d "$d" ]; then
    count=$(find "$d" -type f | wc -l)
    size=$(du -sh "$d" | cut -f1)
    echo "  $d: $count files ($size)"
  fi
done
