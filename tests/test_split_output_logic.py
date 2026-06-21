"""Logic tests for split_output's recency window + field-extraction guards.

Asserts the recency comparison and the field-mapping/preservation guards
directly — behaviour that line coverage alone does not pin (a flipped `<` or a
dropped media/metadata guard would stay green). Imports via the package path so
the assertions bind the same module object the rest of the suite uses.
(split_output is intentionally not under the mutmut gate; see setup.cfg.)
"""
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))
sys.path.insert(0, str(_REPO / "projects" / "news" / "scripts"))

from projects.news.scripts.split_output import (  # noqa: E402
    _is_recent,
    extract_item,
    extract_steam_item,
)


def _iso(hours_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()


# --- _is_recent: the time-window comparison ---
def test_empty_timestamp_is_not_recent():
    assert _is_recent("") is False
    assert _is_recent(None) is False


def test_recent_within_window():
    assert _is_recent(_iso(1), max_hours=24) is True


def test_old_outside_window():
    assert _is_recent(_iso(48), max_hours=24) is False


def test_window_is_strict_upper_bound():
    # an item exactly at/just beyond the window must be excluded (delta < window)
    assert _is_recent(_iso(25), max_hours=24) is False


def test_naive_timestamp_treated_as_utc():
    naive = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(
        tzinfo=None).isoformat()
    assert _is_recent(naive, max_hours=24) is True


def test_malformed_timestamp_is_not_recent():
    assert _is_recent("not-a-date", max_hours=24) is False


# --- extract_item: field mapping + optional preservation ---
def test_extract_item_core_fields():
    raw = {"source": "reddit", "time": "t", "lang": "en", "title": "T",
           "summary": "S", "url": "u", "author": "a", "engagement": 9}
    out = extract_item(raw)
    assert out["title"] == "T" and out["url"] == "u" and out["engagement"] == 9
    # no media / metadata keys when absent
    assert "media_url" not in out and "metadata" not in out


def test_extract_item_preserves_media_and_metadata():
    raw = {"source": "discord", "media_url": "m.png", "metadata": {"reply_to": "x"}}
    out = extract_item(raw)
    assert out["media_url"] == "m.png"
    assert out["content_type"] == "image"  # default when media present
    assert out["metadata"] == {"reply_to": "x"}


def test_extract_item_ignores_non_dict_metadata():
    out = extract_item({"source": "x", "metadata": ["not", "a", "dict"]})
    assert "metadata" not in out


def test_extract_steam_item_normalizes_source_and_voted_up():
    out = extract_steam_item({"language": "schinese", "title": "rev",
                              "metadata": {"voted_up": True}})
    assert out["source"] == "steam"
    assert out["voted_up"] is True
    assert out["lang"] == "schinese"
