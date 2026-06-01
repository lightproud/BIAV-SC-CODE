"""
collection_state.py — Adaptive time window for news collection pipeline.

Tracks when the last successful collection ran, so the next run automatically
expands its lookback window to cover any gap caused by CI downtime.

Usage:
    from collection_state import get_lookback_hours, mark_collection_done

    hours = get_lookback_hours()          # dynamic: covers since last run
    # ... run collectors ...
    mark_collection_done(item_count=42)   # persist timestamp for next run

State file: projects/news/data/collection_state.json
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
STATE_PATH = _REPO_ROOT / 'projects' / 'news' / 'data' / 'collection_state.json'

# Defaults
DEFAULT_HOURS = 24
MAX_HOURS = 7 * 24    # 7-day cap: beyond this, rely on backfill_platforms.py
BUFFER_HOURS = 1      # overlap buffer to avoid edge-case gaps


def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}


def _save_state(state: dict):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')


def get_lookback_hours() -> int:
    """Calculate how many hours to look back based on last successful run.

    Returns max(DEFAULT_HOURS, hours_since_last_run + buffer), capped at MAX_HOURS.
    If no state file exists, returns DEFAULT_HOURS.
    """
    state = _load_state()
    last_run = state.get('last_collected_at')
    if not last_run:
        logger.info(f'collection_state: no previous run recorded, using default {DEFAULT_HOURS}h')
        return DEFAULT_HOURS

    try:
        last_dt = datetime.fromisoformat(last_run)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        gap = datetime.now(timezone.utc) - last_dt
        gap_hours = int(gap.total_seconds() / 3600) + BUFFER_HOURS
        result = max(DEFAULT_HOURS, min(gap_hours, MAX_HOURS))
        if gap_hours > DEFAULT_HOURS:
            logger.warning(
                f'collection_state: last run was {gap_hours - BUFFER_HOURS}h ago, '
                f'expanding lookback to {result}h (default {DEFAULT_HOURS}h)'
            )
        else:
            logger.info(f'collection_state: last run {gap_hours - BUFFER_HOURS}h ago, lookback={result}h')
        return result
    except (ValueError, TypeError) as e:
        logger.warning(f'collection_state: bad timestamp {last_run!r}: {e}, using default')
        return DEFAULT_HOURS


def mark_collection_done(item_count: int = 0):
    """Record that a collection run completed successfully."""
    state = _load_state()
    now = datetime.now(timezone.utc).isoformat()
    state['last_collected_at'] = now
    state['last_item_count'] = item_count

    # Keep a short history for debugging
    history = state.get('history', [])
    history.append({'time': now, 'items': item_count})
    state['history'] = history[-48:]  # keep last 48 entries (~2 days at hourly)

    _save_state(state)
    logger.info(f'collection_state: marked done at {now}, {item_count} items')
