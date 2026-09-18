"""discord 历史日档 UTC 日 → 北京日迁移的守卫。

这个脚本要重写全量档案层最大的一棵树（2026-09-17 实测 9,708,177 条消息、19,826 个
日档），而且**原地**重写：旧档撤掉、新档落位。写错一次没有回退键（Release 副本停在
压扁前），所以每一条不变量都在这里钉死，而不是靠跑一遍看着像对的。
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import migrate_discord_beijing_day as mig


def _msg(mid: str, ts: str) -> str:
    return json.dumps({"id": mid, "channel_id": "c1", "author_id": "u1",
                       "author_name": "t", "content": f"m{mid}", "timestamp": ts},
                      ensure_ascii=False)


@pytest.fixture
def lake(tmp_path, monkeypatch):
    """一个只有 volunteer 区服的迷你数据湖，channels/c1 一个频道。"""
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(tmp_path))
    ch = tmp_path / "Record" / "Community" / "discord" / "volunteer" / "channels" / "c1"
    ch.mkdir(parents=True)
    return ch


def _write(ch: Path, day: str, lines: list[str], gz: bool = False) -> Path:
    p = ch / (f"{day}.jsonl.gz" if gz else f"{day}.jsonl")
    body = "\n".join(lines) + "\n"
    if gz:
        with gzip.open(p, "wt", encoding="utf-8") as fh:
            fh.write(body)
    else:
        p.write_text(body, encoding="utf-8")
    return p


def _days(ch: Path) -> dict[str, list[str]]:
    out = {}
    for p in sorted(ch.iterdir()):
        m = mig._DAY_RE.match(p.name)
        if m:
            out[p.name] = mig._read_lines(p)
    return out


def test_message_after_16z_moves_to_the_next_beijing_day(lake):
    # UTC 23:30 = 北京次日 07:30；UTC 10:00 = 北京同日 18:00
    _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00"),
                                _msg("2", "2026-09-10T10:00:00+00:00")])
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    days = _days(lake)
    assert sorted(days) == ["2026-09-10.jsonl", "2026-09-11.jsonl"]
    assert [json.loads(l)["id"] for l in days["2026-09-10.jsonl"]] == ["2"]
    assert [json.loads(l)["id"] for l in days["2026-09-11.jsonl"]] == ["1"]


def test_dry_run_touches_nothing(lake):
    p = _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00")])
    before = p.read_bytes()
    res = mig.run(["volunteer"], dry_run=True, cutoff="2026-08")
    assert res["totals"]["moved"] == 1
    assert res["totals"]["rewritten"] == 0
    assert p.read_bytes() == before


def test_rerun_is_idempotent(lake):
    _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00"),
                                _msg("2", "2026-09-10T10:00:00+00:00")])
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    first = _days(lake)
    again = mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    assert again["totals"]["moved"] == 0, "迁完再跑不该还有可迁的条目"
    assert _days(lake) == first


def test_duplicate_ids_collapse_across_cold_and_raw_sidecar(lake):
    """重写一个频道时，同日冷层 .gz 与裸旁车按 id 并轨，输出只留一份。

    旁车并轨本身是月度压冷器的活；这里要守的是迁移**不制造**第二份——重排过的日
    只能留一个文件，否则读方冷热并出即双计。
    """
    _write(lake, "2026-03-02", [_msg("1", "2026-03-02T01:00:00+00:00")], gz=True)
    _write(lake, "2026-03-02", [_msg("1", "2026-03-02T01:00:00+00:00"),
                                _msg("2", "2026-03-02T02:00:00+00:00"),
                                _msg("3", "2026-03-02T23:30:00+00:00")])  # 跨日，触发重写
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    days = _days(lake)
    assert sorted(days) == ["2026-03-02.jsonl.gz", "2026-03-03.jsonl.gz"]
    assert sorted(json.loads(l)["id"] for l in days["2026-03-02.jsonl.gz"]) == ["1", "2"]
    assert [json.loads(l)["id"] for l in days["2026-03-03.jsonl.gz"]] == ["3"]


def test_channel_with_nothing_to_move_is_left_alone(lake):
    """没有一条要改桶的频道不重写——迁移只动它该动的，不顺手翻修全树。"""
    p = _write(lake, "2026-03-02", [_msg("1", "2026-03-02T01:00:00+00:00")])
    before = p.read_bytes()
    res = mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    assert res["totals"]["rewritten"] == 0
    assert p.read_bytes() == before


def test_cold_month_written_gz_hot_month_written_raw(lake):
    _write(lake, "2026-03-02", [_msg("1", "2026-03-02T23:30:00+00:00")])
    _write(lake, "2026-09-10", [_msg("2", "2026-09-10T23:30:00+00:00")])
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    names = sorted(_days(lake))
    assert names == ["2026-03-03.jsonl.gz", "2026-09-11.jsonl"]


def test_unparsable_rows_stay_in_their_original_bucket(lake):
    """判不出发生日的行不猜、不丢——留在原桶。"""
    _write(lake, "2026-09-10", ["{not json", json.dumps({"id": "9", "content": "无时间戳"}),
                                _msg("1", "2026-09-10T23:30:00+00:00")])
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    days = _days(lake)
    assert len(days["2026-09-10.jsonl"]) == 2
    assert days["2026-09-11.jsonl"] == [_msg("1", "2026-09-10T23:30:00+00:00")]


def test_no_message_is_lost(lake):
    """迁移前后条目总数守恒（本用例无重复 id）。"""
    rows = [_msg(str(i), f"2026-09-{10 + i % 3:02d}T{(i * 3) % 24:02d}:00:00+00:00")
            for i in range(30)]
    for day in ("2026-09-10", "2026-09-11", "2026-09-12"):
        _write(lake, day, [r for r in rows if json.loads(r)["timestamp"].startswith(day)])
    before = sum(len(v) for v in _days(lake).values())
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    assert sum(len(v) for v in _days(lake).values()) == before


def test_half_written_tmp_dir_from_an_earlier_kill_is_discarded(lake):
    """上次被杀留下的 .migrate-tmp 不得被当成结果搬回频道目录。"""
    (lake / mig.TMP_DIRNAME).mkdir()
    (lake / mig.TMP_DIRNAME / "2020-01-01.jsonl").write_text("stale\n", encoding="utf-8")
    _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00")])
    mig.run(["volunteer"], dry_run=False, cutoff="2026-08")
    assert "2020-01-01.jsonl" not in _days(lake)
    assert not (lake / mig.TMP_DIRNAME).exists()


class TestRecomputeStats:
    """activity_daily 必须与 JSONL 同日基准——否则同一天的两份档互相矛盾。"""

    @staticmethod
    def _region_dir(ch: Path) -> Path:
        return ch.parent.parent

    def _stats(self, ch: Path) -> dict[str, dict]:
        out = {}
        for p in sorted((self._region_dir(ch) / "activity_daily").iterdir()):
            with gzip.open(p, "rt", encoding="utf-8") if p.suffix == ".gz" \
                    else open(p, encoding="utf-8") as fh:
                out[p.name] = json.load(fh)
        return out

    def test_day_key_and_hour_follow_beijing(self, lake):
        _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00"),
                                    _msg("2", "2026-09-10T10:00:00+00:00")])
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True)
        stats = self._stats(lake)
        assert sorted(stats) == ["2026-09-10.json", "2026-09-11.json"]
        # UTC 23:30 → 北京次日 07:30；UTC 10:00 → 北京同日 18:00
        assert stats["2026-09-11.json"]["hourly_activity"] == {"7": 1}
        assert stats["2026-09-10.json"]["hourly_activity"] == {"18": 1}

    def test_totals_are_conserved(self, lake):
        rows = [_msg(str(i), f"2026-09-10T{i:02d}:00:00+00:00") for i in range(24)]
        _write(lake, "2026-09-10", rows)
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True)
        assert sum(d["messages"] for d in self._stats(lake).values()) == 24

    def test_channel_names_come_from_the_index(self, lake):
        (self._region_dir(lake) / "channel_index.json").write_text(
            json.dumps({"c1": {"name": "综合讨论", "dir": "c1"}}), encoding="utf-8")
        _write(lake, "2026-09-10", [_msg("1", "2026-09-10T10:00:00+00:00")])
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True)
        assert self._stats(lake)["2026-09-10.json"]["channel_activity"] == {"综合讨论": 1}

    def test_forum_posts_are_keyed_by_thread_title(self, lake):
        """论坛帖记在帖标题下，与归档器写 activity_daily 时的口径一致。"""
        row = json.dumps({"id": "1", "channel_id": "c1", "author_id": "u1",
                          "author_name": "t", "content": "x",
                          "timestamp": "2026-09-10T10:00:00+00:00",
                          "thread_title": "关于命轮的建议"}, ensure_ascii=False)
        _write(lake, "2026-09-10", [row])
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True)
        assert self._stats(lake)["2026-09-10.json"]["channel_activity"] == {"关于命轮的建议": 1}

    def test_unknown_channel_falls_back_to_id(self, lake):
        _write(lake, "2026-09-10", [_msg("1", "2026-09-10T10:00:00+00:00")])
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True)
        assert self._stats(lake)["2026-09-10.json"]["channel_activity"] == {"c1": 1}

    def test_cold_month_stats_written_gz_and_stale_twin_removed(self, lake):
        stats_dir = self._region_dir(lake) / "activity_daily"
        stats_dir.mkdir()
        (stats_dir / "2026-03-02.json").write_text('{"date": "2026-03-02"}', encoding="utf-8")
        _write(lake, "2026-03-02", [_msg("1", "2026-03-02T01:00:00+00:00")])
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True)
        assert sorted(p.name for p in stats_dir.iterdir()) == ["2026-03-02.json.gz"]

    def test_dry_run_reports_without_writing(self, lake):
        _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00")])
        res = mig.run(["volunteer"], dry_run=True, cutoff="2026-08", stats=True)
        assert res["totals"]["stats_changed"] == 1
        assert res["totals"]["stats_written"] == 0
        assert not (self._region_dir(lake) / "activity_daily").exists()

    def test_stats_only_leaves_jsonl_untouched(self, lake):
        p = _write(lake, "2026-09-10", [_msg("1", "2026-09-10T23:30:00+00:00")])
        before = p.read_bytes()
        mig.run(["volunteer"], dry_run=False, cutoff="2026-08", stats=True, messages=False)
        assert p.read_bytes() == before
        assert "2026-09-11.json" in self._stats(lake)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
