"""视频评论日档回填（采集轮次 → 发布日）的守卫。

旧档的语义是「哪一轮采到的」，新档是「评论发布于哪天」。回填要把前者改写成后者，
而两种档在目录里长得一模一样（都是 `YYYY-MM-DD.json`），所以判错一次不会有任何
报错——只会让这一层永远混着两套日期语义。不变量在这里钉死。
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import migrate_video_comment_days as mig


def _row(cid: str, published: str | None, likes: int = 0) -> dict:
    row = {"id": cid, "video_id": "v1", "author": "@a", "text": "t", "likes": likes,
           "fetched_at": "2026-09-16T12:00:00+00:00"}
    if published is not None:
        row["published"] = published
    return row


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(tmp_path))
    d = tmp_path / "Record" / "Community" / "youtube_comments"
    d.mkdir(parents=True)
    return d


def _write_day(root: Path, day: str, rows: list[dict], gz: bool = False) -> Path:
    p = root / (f"{day}.json.gz" if gz else f"{day}.json")
    body = json.dumps(rows, ensure_ascii=False, indent=1)
    if gz:
        with gzip.open(p, "wt", encoding="utf-8") as fh:
            fh.write(body)
    else:
        p.write_text(body, encoding="utf-8")
    return p


def _days(root: Path) -> dict[str, list[dict]]:
    out = {}
    for p in sorted(root.iterdir()):
        if mig._DAY_RE.match(p.name):
            out[p.name] = mig._load(p)
    return out


def test_comment_is_filed_under_its_publish_day(root):
    # UTC 23:30 → 北京次日；UTC 02:00 → 北京同日
    _write_day(root, "2026-07-01", [_row("a", "2026-07-01T23:30:00Z"),
                                    _row("b", "2026-07-01T02:00:00Z")])
    mig.run(dry_run=False, cutoff="2026-08")
    days = _days(root)
    assert sorted(days) == ["2026-07-01.json.gz", "2026-07-02.json.gz"]
    assert [r["id"] for r in days["2026-07-01.json.gz"]] == ["b"]
    assert [r["id"] for r in days["2026-07-02.json.gz"]] == ["a"]


def test_backfilled_old_comment_leaves_the_collection_round_bucket(root):
    """回填积压的典型：某轮一次采到 4 个月前的评论，旧档按采集日记，新档按发布日。"""
    _write_day(root, "2026-07-01", [_row("old", "2026-02-17T06:00:00Z")])
    mig.run(dry_run=False, cutoff="2026-08")
    assert sorted(_days(root)) == ["2026-02-17.json.gz"]


def test_missing_publish_time_stays_in_its_original_bucket(root):
    """判不出发布日就留在原桶——原桶至少是「那一轮采到它」的真实标签。"""
    _write_day(root, "2026-07-01", [_row("x", None), _row("y", "not-a-time"),
                                    _row("z", "2026-07-01T23:30:00Z")])  # 跨日，触发重写
    mig.run(dry_run=False, cutoff="2026-08")
    days = _days(root)
    assert sorted(days) == ["2026-07-01.json.gz", "2026-07-02.json.gz"]
    assert sorted(r["id"] for r in days["2026-07-01.json.gz"]) == ["x", "y"]


def test_nothing_to_move_leaves_the_files_untouched(root):
    """一条都不用改桶的目录不重写——回填只动它该动的，不顺手规范化整层。"""
    p = _write_day(root, "2026-07-01", [_row("a", "2026-07-01T02:00:00Z")])
    before = p.read_bytes()
    res = mig.run(dry_run=False, cutoff="2026-08")
    assert res["written"] == 0
    assert p.read_bytes() == before


def test_same_comment_in_two_old_buckets_collapses(root):
    _write_day(root, "2026-07-01", [_row("dup", "2026-07-01T02:00:00Z")])
    _write_day(root, "2026-07-02", [_row("dup", "2026-07-01T02:00:00Z")])
    mig.run(dry_run=False, cutoff="2026-08")
    assert [r["id"] for r in _days(root)["2026-07-01.json.gz"]] == ["dup"]


def test_rows_stay_sorted_by_likes(root):
    _write_day(root, "2026-07-01", [_row("low", "2026-07-01T02:00:00Z", likes=1),
                                    _row("high", "2026-07-01T03:00:00Z", likes=99),
                                    _row("next", "2026-07-01T23:30:00Z")])  # 跨日，触发重写
    mig.run(dry_run=False, cutoff="2026-08")
    assert [r["id"] for r in _days(root)["2026-07-01.json.gz"]] == ["high", "low"]


def test_hot_month_written_raw(root):
    _write_day(root, "2026-09-10", [_row("a", "2026-09-10T02:00:00Z")])
    mig.run(dry_run=False, cutoff="2026-08")
    assert sorted(_days(root)) == ["2026-09-10.json"]


def test_dry_run_touches_nothing(root):
    p = _write_day(root, "2026-07-01", [_row("a", "2026-07-01T23:30:00Z")])
    before = p.read_bytes()
    res = mig.run(dry_run=True, cutoff="2026-08")
    assert res["moved"] == 1 and res["written"] == 0
    assert p.read_bytes() == before


def test_rerun_is_idempotent(root):
    _write_day(root, "2026-07-01", [_row("a", "2026-07-01T23:30:00Z"),
                                    _row("b", "2026-07-01T02:00:00Z")])
    mig.run(dry_run=False, cutoff="2026-08")
    first = _days(root)
    again = mig.run(dry_run=False, cutoff="2026-08")
    assert again["moved"] == 0
    assert _days(root) == first


def test_sidecar_files_are_left_alone(root):
    """comments.jsonl 累积库与 state.json 不是日档，回填不得碰它们。"""
    (root / "comments.jsonl").write_text('{"id": "1"}\n', encoding="utf-8")
    (root / "state.json").write_text('{"v1": {}}', encoding="utf-8")
    _write_day(root, "2026-07-01", [_row("a", "2026-07-01T23:30:00Z")])
    mig.run(dry_run=False, cutoff="2026-08")
    assert (root / "comments.jsonl").read_text(encoding="utf-8") == '{"id": "1"}\n'
    assert (root / "state.json").read_text(encoding="utf-8") == '{"v1": {}}'


def test_no_comment_is_lost(root):
    rows = [_row(str(i), f"2026-07-0{i % 3 + 1}T{(i * 5) % 24:02d}:00:00Z") for i in range(20)]
    for day in ("2026-07-01", "2026-07-02", "2026-07-03"):
        _write_day(root, day, [r for r in rows if r["published"].startswith(day)])
    before = sum(len(v) for v in _days(root).values())
    mig.run(dry_run=False, cutoff="2026-08")
    assert sum(len(v) for v in _days(root).values()) == before


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
