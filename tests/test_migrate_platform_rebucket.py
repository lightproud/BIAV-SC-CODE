"""平台层历史错桶回填（D4）的守卫。

这个脚本的难处不在搬，在**克制**：同一层里还压着另一种历史问题（同一条内容在同一个日档里
重复几十上百份），守密人尚未裁定清理。若回填顺手把日档整个重写去重，就把那件事一并做掉了。
所以这里既要守「错桶的搬对」，也要守「没错桶的一条都别动」。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import migrate_platform_rebucket as mig


@pytest.fixture
def lake(tmp_path, monkeypatch):
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(tmp_path))
    return tmp_path / "Record" / "Community"


def _item(title: str, time: str, **extra) -> dict:
    row = {"title": title, "summary": "", "source": "weixin", "time": time,
           "url": f"https://e.com/{title}", "engagement": 0, "author": ""}
    row.update(extra)
    return row


def _write(lake: Path, layer: str, day: str, items: list[dict]) -> Path:
    d = lake / layer
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{day}.json"
    p.write_text(json.dumps({"date": day, "archived_at": "2026-09-01T00:00:00+00:00",
                             "source": layer.split("/")[0], "item_count": len(items),
                             "items": items}, ensure_ascii=False), encoding="utf-8")
    return p


def _days(lake: Path, layer: str) -> dict[str, dict]:
    out = {}
    for p in sorted((lake / layer).iterdir()):
        if mig._DAY_RE.match(p.name):
            with mig.archive_layout.open_archive_text(p) as fh:
                out[p.name] = json.load(fh)
    return out


def test_misbucketed_item_moves_to_its_own_day(lake):
    _write(lake, "weixin", "2026-09-10", [_item("a", "2026-09-04T02:00:00+00:00"),
                                          _item("b", "2026-09-10T02:00:00+00:00")])
    mig.run(None, dry_run=False, cutoff="2026-08")
    days = _days(lake, "weixin")
    assert sorted(days) == ["2026-09-04.json", "2026-09-10.json"]
    assert [r["title"] for r in days["2026-09-04.json"]["items"]] == ["a"]
    assert [r["title"] for r in days["2026-09-10.json"]["items"]] == ["b"]


def test_same_day_duplicates_are_left_alone(lake):
    """同一日档里的重复堆积不是本脚本的射程——一条都不许动。"""
    dupes = [_item("x", "2026-09-10T02:00:00+00:00") for _ in range(5)]
    p = _write(lake, "weixin", "2026-09-10", dupes)
    before = p.read_bytes()
    res = mig.run(None, dry_run=False, cutoff="2026-08")
    assert res["layers"] == {}
    assert p.read_bytes() == before


def test_staying_items_keep_their_order(lake):
    rows = [_item(str(i), "2026-09-10T02:00:00+00:00") for i in range(4)]
    rows.insert(2, _item("moving", "2026-09-04T02:00:00+00:00"))
    _write(lake, "weixin", "2026-09-10", rows)
    mig.run(None, dry_run=False, cutoff="2026-08")
    kept = [r["title"] for r in _days(lake, "weixin")["2026-09-10.json"]["items"]]
    assert kept == ["0", "1", "2", "3"], "留下的条目须原序不变"


def test_collision_merges_fields_instead_of_dropping_them(lake):
    """撞键的两份是同一条内容的不同 schema 版本：以目标桶那份为底，补它缺的键。"""
    _write(lake, "weixin", "2026-09-04", [_item("x", "2026-09-04T02:00:00+00:00",
                                                tags=["t"], content_type="text")])
    _write(lake, "weixin", "2026-09-10", [_item("x", "2026-09-04T02:00:00+00:00",
                                                media_url="https://img")])
    res = mig.run(None, dry_run=False, cutoff="2026-08")
    days = _days(lake, "weixin")
    assert "2026-09-10.json" not in days, "搬空的源档应删除"
    rows = days["2026-09-04.json"]["items"]
    assert len(rows) == 1 and res["layers"]["weixin"]["dropped"] == 1
    assert rows[0]["tags"] == ["t"] and rows[0]["media_url"] == "https://img"


def test_dry_run_reports_collisions_without_writing(lake):
    _write(lake, "weixin", "2026-09-04", [_item("x", "2026-09-04T02:00:00+00:00")])
    p = _write(lake, "weixin", "2026-09-10", [_item("x", "2026-09-04T02:00:00+00:00")])
    before = p.read_bytes()
    res = mig.run(None, dry_run=True, cutoff="2026-08")
    assert res["layers"]["weixin"]["moved"] == 1
    assert res["layers"]["weixin"]["dropped"] == 1, "dry-run 必须先报出会少掉几条"
    assert p.read_bytes() == before


def test_unparsable_time_stays_put(lake):
    p = _write(lake, "weixin", "2026-09-10", [_item("x", "not-a-time"), _item("y", "")])
    before = p.read_bytes()
    mig.run(None, dry_run=False, cutoff="2026-08")
    assert p.read_bytes() == before


def test_cold_target_is_written_gz_and_hot_twin_removed(lake):
    _write(lake, "weixin", "2026-09-10", [_item("a", "2026-03-04T02:00:00+00:00")])
    (lake / "weixin" / "2026-03-04.json").write_text(
        json.dumps({"date": "2026-03-04", "source": "weixin", "item_count": 0, "items": []}),
        encoding="utf-8")
    mig.run(None, dry_run=False, cutoff="2026-08")
    assert sorted(_days(lake, "weixin")) == ["2026-03-04.json.gz"]


def test_layered_platform_keeps_region_and_subtype(lake):
    _write(lake, "steam/global/news", "2026-09-10",
           [_item("a", "2026-09-04T02:00:00+00:00")])
    mig.run(None, dry_run=False, cutoff="2026-08")
    doc = _days(lake, "steam/global/news")["2026-09-04.json"]
    assert doc["source"] == "steam" and doc["region"] == "global"
    assert doc["content_subtype"] == "news"


def test_discord_and_video_comments_are_out_of_scope(lake):
    """两者自带归档器与自带语义，本脚本不得伸手。"""
    _write(lake, "discord", "2026-09-10", [_item("a", "2026-09-04T02:00:00+00:00")])
    _write(lake, "youtube_comments", "2026-09-10", [_item("b", "2026-09-04T02:00:00+00:00")])
    res = mig.run(None, dry_run=False, cutoff="2026-08")
    assert res["layers"] == {}


def test_rerun_is_idempotent(lake):
    _write(lake, "weixin", "2026-09-10", [_item("a", "2026-09-04T02:00:00+00:00"),
                                          _item("b", "2026-09-10T02:00:00+00:00")])
    mig.run(None, dry_run=False, cutoff="2026-08")
    first = _days(lake, "weixin")
    again = mig.run(None, dry_run=False, cutoff="2026-08")
    assert again["layers"] == {}
    assert _days(lake, "weixin") == first


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
