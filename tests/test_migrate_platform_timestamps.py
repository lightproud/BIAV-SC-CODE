"""ruliweb / appstore / google_play 历史时间戳订正的守卫。

这个脚本改的是**已入库**的时间戳，而且改完要按新时间换桶。它必须做到两件相反的事：
把三类确定性的口径错误改对，同时**不碰** D4（旧落桶逻辑留下的错桶）——守密人对 D4
的裁定是「先定因再谈回填」，借订正之便顺手做掉就是替守密人做了决定。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import migrate_platform_timestamps as mig


@pytest.fixture
def lake(tmp_path, monkeypatch):
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(tmp_path))
    return tmp_path / "Record" / "Community"


def _item(title: str, time: str, url: str = "", engagement: int = 0) -> dict:
    return {"title": title, "summary": "", "source": "x", "time": time,
            "url": url or f"https://e.com/{title}", "engagement": engagement, "author": ""}


def _write(lake: Path, layer: str, day: str, items: list[dict], source: str) -> Path:
    d = lake / layer
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{day}.json"
    p.write_text(json.dumps({"date": day, "archived_at": "2026-09-01T00:00:00+00:00",
                             "source": source, "item_count": len(items), "items": items},
                            ensure_ascii=False), encoding="utf-8")
    return p


def _days(lake: Path, layer: str) -> dict[str, dict]:
    """读日档（冷热透明）——冷月写出的是 .gz，直接 read_text 会撞上 gzip 魔数。"""
    out = {}
    for p in sorted((lake / layer).iterdir()):
        if not mig._DAY_RE.match(p.name):
            continue
        with mig.archive_layout.open_archive_text(p) as fh:
            out[p.name] = json.load(fh)
    return out


class TestRuliweb:
    def test_midnight_signature_becomes_local_noon_one_day_later(self, lake):
        # 旧写法：韩国日历日 2025-11-03 → 存成 2025-11-02T15:00:00+00:00，桶 2025-11-02
        _write(lake, "ruliweb", "2025-11-02", [_item("글", "2025-11-02T15:00:00+00:00")], "ruliweb")
        mig.run(["ruliweb"], dry_run=False, cutoff="2026-08")
        days = _days(lake, "ruliweb")
        assert list(days) == ["2025-11-03.json.gz"], "桶应落回帖子真实的韩国日历日"
        # KST 正午 = UTC 03:00
        assert days["2025-11-03.json.gz"]["items"][0]["time"] == "2025-11-03T03:00:00+00:00"

    def test_real_clock_entries_are_not_touched(self, lake):
        p = _write(lake, "ruliweb", "2026-06-19",
                   [_item("글", "2026-06-19T03:30:00+00:00")], "ruliweb")
        before = p.read_bytes()
        res = mig.run(["ruliweb"], dry_run=False, cutoff="2026-08")
        assert res["layers"]["ruliweb"]["fixed"] == 0
        assert p.read_bytes() == before


class TestAppstore:
    def test_winter_entry_is_relabelled_to_pst(self, lake):
        _write(lake, "appstore/global", "2023-12-07",
               [_item("r", "2023-12-07T12:19:29-07:00")], "appstore")
        mig.run(["appstore"], dry_run=False, cutoff="2026-08")
        item = _days(lake, "appstore/global")["2023-12-07.json.gz"]["items"][0]
        assert item["time"].endswith("-08:00")
        assert item["time"].startswith("2023-12-07T12:19:29"), "墙钟不得被改动"

    def test_summer_entry_is_left_alone(self, lake):
        p = _write(lake, "appstore/global", "2024-07-07",
                   [_item("r", "2024-07-07T12:19:29-07:00")], "appstore")
        before = p.read_bytes()
        mig.run(["appstore"], dry_run=False, cutoff="2026-08")
        assert p.read_bytes() == before

    def test_relabel_that_crosses_the_day_line_moves_bucket(self, lake):
        # 北京日界在 UTC 16:00。墙钟 08:30 标成 -07:00 是 UTC 15:30（北京 12-07 23:30），
        # 按真实的 PST(-08:00) 则是 UTC 16:30（北京 12-08 00:30）——差的那一小时正好跨日。
        _write(lake, "appstore/global", "2023-12-07",
               [_item("r", "2023-12-07T08:30:00-07:00")], "appstore")
        mig.run(["appstore"], dry_run=False, cutoff="2026-08")
        assert list(_days(lake, "appstore/global")) == ["2023-12-08.json.gz"]

    def test_region_and_schema_survive(self, lake):
        _write(lake, "appstore/global", "2023-12-07",
               [_item("r", "2023-12-07T12:19:29-07:00")], "appstore")
        mig.run(["appstore"], dry_run=False, cutoff="2026-08")
        doc = _days(lake, "appstore/global")["2023-12-07.json.gz"]
        assert doc["region"] == "global" and doc["source"] == "appstore"
        assert doc["item_count"] == len(doc["items"]) == 1


class TestGooglePlay:
    def test_naive_gets_utc_label_without_changing_the_bucket(self, lake):
        _write(lake, "google_play/global", "2026-04-04",
               [_item("r", "2026-04-04T15:53:55")], "google_play")
        mig.run(["google_play"], dry_run=False, cutoff="2026-08")
        days = _days(lake, "google_play/global")
        assert list(days) == ["2026-04-04.json.gz"]
        assert days["2026-04-04.json.gz"]["items"][0]["time"] == "2026-04-04T15:53:55+00:00"

    def test_d4_leftovers_stay_where_they_are(self, lake):
        """补时区不改时刻，所以本来就错桶的条目**保持错桶**——D4 另案，不在此顺手做掉。"""
        _write(lake, "google_play/global", "2026-05-01",
               [_item("old", "2026-04-04T15:53:55")], "google_play")
        res = mig.run(["google_play"], dry_run=False, cutoff="2026-08")
        assert res["layers"]["google_play/global"]["moved"] == 0
        assert list(_days(lake, "google_play/global")) == ["2026-05-01.json.gz"]


class TestGeneral:
    def test_dry_run_touches_nothing(self, lake):
        p = _write(lake, "ruliweb", "2025-11-02",
                   [_item("글", "2025-11-02T15:00:00+00:00")], "ruliweb")
        before = p.read_bytes()
        res = mig.run(["ruliweb"], dry_run=True, cutoff="2026-08")
        assert res["layers"]["ruliweb"]["fixed"] == 1
        assert res["layers"]["ruliweb"]["written"] == 0
        assert p.read_bytes() == before

    def test_rerun_is_idempotent(self, lake):
        _write(lake, "ruliweb", "2025-11-02",
               [_item("글", "2025-11-02T15:00:00+00:00")], "ruliweb")
        mig.run(["ruliweb"], dry_run=False, cutoff="2026-08")
        first = _days(lake, "ruliweb")
        again = mig.run(["ruliweb"], dry_run=False, cutoff="2026-08")
        assert again["layers"]["ruliweb"]["fixed"] == 0
        assert _days(lake, "ruliweb") == first

    def test_no_item_is_lost(self, lake):
        items = [_item(f"글{i}", "2025-11-02T15:00:00+00:00") for i in range(5)]
        items += [_item(f"real{i}", f"2025-11-02T0{i}:30:00+00:00") for i in range(4)]
        _write(lake, "ruliweb", "2025-11-02", items, "ruliweb")
        mig.run(["ruliweb"], dry_run=False, cutoff="2026-08")
        assert sum(d["item_count"] for d in _days(lake, "ruliweb").values()) == 9


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
