#!/usr/bin/env python3
"""Build a reverse drop index for Morimens stages.

Reads:
    projects/wiki/data/db/stages.json   (curated authoritative form)
        OR (fallback) projects/wiki/data/processed/stages.json
    projects/wiki/data/db/items.json    (optional, for item id resolution)

Writes:
    projects/wiki/data/processed/drops_by_item.json
        Shape: { "_meta": {...}, "drops_by_item": { "<item_id>": [stage_id, ...] } }

Why:
    The Mooncell-style "where do I farm material X?" reverse lookup needs an
    item -> stages index. Forward index (stage -> drops) is in stages.json;
    this script inverts it so item pages can list source stages without
    scanning every stage at render time.

Usage:
    python projects/wiki/scripts/build_drop_index.py
    python projects/wiki/scripts/build_drop_index.py --dry-run
    python projects/wiki/scripts/build_drop_index.py --source processed   # use raw extraction
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data"
DB_DIR = DATA_DIR / "db"
PROCESSED_DIR = DATA_DIR / "processed"

DB_STAGES = DB_DIR / "stages.json"
PROCESSED_STAGES = PROCESSED_DIR / "stages.json"
OUTPUT_PATH = PROCESSED_DIR / "drops_by_item.json"


def load_stages(source: str) -> tuple[list[dict], str]:
    """Return (stages_list, source_label). Stages list contains forward-drop entries."""
    if source == "db":
        if not DB_STAGES.exists():
            print(f"  [WARN] {DB_STAGES} missing; falling back to processed source")
            return load_stages("processed")
        with open(DB_STAGES, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("stages", []), "db/stages.json"

    if not PROCESSED_STAGES.exists():
        print(f"  [ERROR] no stages source available")
        sys.exit(2)
    with open(PROCESSED_STAGES, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("stages", []), "processed/stages.json"


def build_index(stages: list[dict]) -> dict[str, list[int]]:
    """Invert stage.drops[].item_id into item_id -> [stage_ids]."""
    index: dict[str, set[int]] = defaultdict(set)
    for stage in stages:
        sid = stage.get("id")
        if sid is None:
            continue
        for drop in stage.get("drops", []) or []:
            item_id = drop.get("item_id")
            if not item_id:
                continue
            index[str(item_id)].add(int(sid))
        for reward in stage.get("first_clear_rewards", []) or []:
            item_id = reward.get("item_id")
            if not item_id:
                continue
            index[str(item_id)].add(int(sid))
    return {k: sorted(v) for k, v in sorted(index.items())}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print summary without writing")
    parser.add_argument(
        "--source",
        choices=["db", "processed"],
        default="db",
        help="Which stages.json to read (default: db, falls back to processed if absent)",
    )
    args = parser.parse_args()

    stages, source_label = load_stages(args.source)
    index = build_index(stages)

    item_count = len(index)
    total_refs = sum(len(v) for v in index.values())

    out = {
        "_meta": {
            "source": source_label,
            "stages_scanned": len(stages),
            "items_with_sources": item_count,
            "total_drop_references": total_refs,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "drops_by_item": index,
    }

    print(f"  scanned   : {len(stages)} stages from {source_label}")
    print(f"  items     : {item_count} unique items have at least one source")
    print(f"  refs      : {total_refs} stage->item edges total")
    print(f"  output    : {OUTPUT_PATH.relative_to(SCRIPT_DIR.parent)}")

    if args.dry_run:
        print("  (dry-run: no file written)")
        return 0

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  wrote     : {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
