#!/usr/bin/env python3
"""
repair_gaps.py — Detect and report date gaps in platform archives.

Scans data/platforms/{source}/YYYY-MM-DD.json for missing dates between
the earliest and latest archive file for each platform.

Writes a gap_report.json for monitoring instead of creating empty placeholder
files (which inflate coverage metrics and mislead backfill scripts).

Usage:
    python repair_gaps.py              # detect + write report
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


def write_gap_report(gaps: dict[str, list[str]]):
    """Write a JSON report of detected gaps for monitoring, without creating placeholder files."""
    report_path = ARCHIVE_DIR.parent / 'gap_report.json'
    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'total_gaps': sum(len(v) for v in gaps.values()),
        'platforms': {
            source: {'missing_dates': dates, 'count': len(dates)}
            for source, dates in sorted(gaps.items())
        },
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


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

    write_gap_report(gaps)
    logger.info(f'Gap report written to data/gap_report.json ({total_gaps} gaps across {len(gaps)} platforms).')


if __name__ == '__main__':
    main()
