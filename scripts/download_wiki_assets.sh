#!/usr/bin/env bash
# Download wiki art assets from GitHub Release for local development.
# Usage: bash scripts/download_wiki_assets.sh
set -euo pipefail

DEST="projects/wiki/docs/public"
TAG="art-assets-v2"

echo "Downloading art assets from Release $TAG..."
cd "$DEST"

TARBALLS=(
  "morimens-cg-full.tar.gz"
  "morimens-icons-full.tar.gz"
  "morimens-units.tar.gz"
  "morimens-portraits-full.tar.gz"
  "morimens-uiresources.tar.gz"
)

for tb in "${TARBALLS[@]}"; do
  if [ ! -f "$tb" ]; then
    echo "  Downloading $tb..."
    gh release download "$TAG" -p "$tb"
  else
    echo "  $tb already exists, skipping"
  fi
done

echo "Extracting..."
for tb in "${TARBALLS[@]}"; do
  echo "  $tb"
  tar xzf "$tb"
  rm "$tb"
done

# uiresources tarball also contains portrait/ -> rename to portrait-card/
[ -d portrait ] && mv portrait portrait-card

echo ""
echo "Done. Asset directories:"
for d in cg icon bunit munit portraits uiresources scenebg portrait-card; do
  if [ -d "$d" ]; then
    count=$(find "$d" -type f | wc -l)
    size=$(du -sh "$d" | cut -f1)
    echo "  $d: $count files ($size)"
  fi
done
