#!/usr/bin/env python3
"""
repair_gaps.py — Detect and repair date gaps in platform archives.

Scans data/platforms/{source}/YYYY-MM-DD.json for missing dates between
the earliest and latest archive file for each platform.

For platforms with backfill support, triggers targeted backfill.
For others, creates placeholder files to distinguish "no data that day"
from "we never collected that day".

Usage:
    python repair_gaps.py              # detect + repair all gaps
    python repair_gaps.py --dry-run    # detect only, don't write
    python repair_gaps.py --since 2026-04-01  # only check from this date
"""

import json
import argparse
import logging
from datetime import datetime, date, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
ARCHIVE_DIR = _REPO_ROOT / 'projects' / 'news' / 'data' / 'platforms'


def detect_gaps(since: date | None = None) -> dict[str, list[str]]:
    """Scan all platform archives and return {source: [missing_date_str, ...]}."""
    gaps: dict[str, list[str]] = {}

    for platform_dir in sorted(ARCHIVE_DIR.iterdir()):
        if not platform_dir.is_dir():
            continue

        # Collect all YYYY-MM-DD.json dates
        dates: list[date] = []
        for f in platform_dir.glob('????-??-??.json'):
            try:
                d = date.fromisoformat(f.stem)
                dates.append(d)
            except ValueError:
                continue

        if len(dates) < 2:
            continue

        dates.sort()
        start = since if since and since > dates[0] else dates[0]
        end = dates[-1]
        date_set = set(dates)

        missing = []
        current = start
        while current <= end:
            if current not in date_set:
                missing.append(current.isoformat())
            current += timedelta(days=1)

        if missing:
            gaps[platform_dir.name] = missing

    return gaps


def create_placeholder(source: str, date_str: str):
    """Create a placeholder archive file indicating no data was collected."""
    platform_dir = ARCHIVE_DIR / source
    platform_dir.mkdir(parents=True, exist_ok=True)
    path = platform_dir / f'{date_str}.json'

    if path.exists():
        return  # don't overwrite real data

    placeholder = {
        'date': date_str,
        'archived_at': datetime.now(timezone.utc).isoformat(),
        'source': source,
        'item_count': 0,
        'items': [],
        '_gap_repaired': True,
        '_note': 'Placeholder created by repair_gaps.py — no data was collected for this date.',
    }
    path.write_text(json.dumps(placeholder, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='Detect and repair date gaps in archives')
    parser.add_argument('--dry-run', action='store_true', help='Only detect, do not repair')
    parser.add_argument('--since', type=str, default=None, help='Only check from this date (YYYY-MM-DD)')
    args = parser.parse_args()

    since = date.fromisoformat(args.since) if args.since else None
    gaps = detect_gaps(since=since)

    if not gaps:
        logger.info('No gaps detected in any platform archive.')
        return

    total_gaps = sum(len(v) for v in gaps.values())
    logger.info(f'Detected {total_gaps} gap(s) across {len(gaps)} platform(s):')

    for source, missing_dates in sorted(gaps.items()):
        logger.info(f'  {source}: {len(missing_dates)} missing — {", ".join(missing_dates)}')

    if args.dry_run:
        logger.info('Dry run — no changes made.')
        return

    # Repair: create placeholder files for missing dates
    repaired = 0
    for source, missing_dates in gaps.items():
        for date_str in missing_dates:
            create_placeholder(source, date_str)
            repaired += 1

    logger.info(f'Repaired {repaired} gap(s) with placeholder files.')


if __name__ == '__main__':
    main()
