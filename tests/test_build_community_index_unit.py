"""build_community_index 纯函数与聚合逻辑单测（_unit 后缀）。

锁定 polarity / lang_of / _ymd 的确定性契约，以及 iter_records 对异构原文件的
归一化、build 的聚合算术（vol_index / coverage / sentiment）。DATA 重定向到
tmp_path 合成数据，零网络、零 release 依赖。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_community_index as bci


# --- polarity ---------------------------------------------------------------

def test_polarity_counts_pos_neg():
    pos, neg = bci.polarity(["good", "love", "bug", "trash", "neutral"])
    assert pos == 2
    assert neg == 2


def test_polarity_empty():
    assert bci.polarity([]) == (0, 0)


def test_polarity_chinese_seeds():
    pos, neg = bci.polarity(["喜欢", "垃圾", "失望"])
    assert pos == 1 and neg == 2


# --- lang_of ----------------------------------------------------------------

def test_lang_of_declared_takes_precedence():
    assert bci.lang_of("anything", "en-US") == "en"
    assert bci.lang_of("anything", "ZH-CN") == "zh"


def test_lang_of_japanese():
    assert bci.lang_of("これはテスト") == "ja"


def test_lang_of_korean():
    assert bci.lang_of("안녕하세요") == "ko"


def test_lang_of_chinese():
    assert bci.lang_of("你好世界") == "zh"


def test_lang_of_english():
    assert bci.lang_of("hello world") == "en"


def test_lang_of_undetermined():
    assert bci.lang_of("12345 !!!") == "und"


# --- _ymd -------------------------------------------------------------------

def test_ymd_full_date():
    assert bci._ymd("2026-06-21T10:00:00Z") == "2026-06-21"


def test_ymd_month_only_pads():
    assert bci._ymd("2026-06") == "2026-06-01"


def test_ymd_too_short_returns_none():
    assert bci._ymd("") is None
    assert bci._ymd("2026") is None
    assert bci._ymd(None) is None


def test_ymd_unparseable_returns_none():
    assert bci._ymd("not-a-date-xx") is None


# --- iter_records (synthetic DATA) ------------------------------------------

@pytest.fixture
def synth_data(tmp_path, monkeypatch):
    data = tmp_path / "data"
    # platform json
    pdir = data / "platforms" / "bilibili"
    pdir.mkdir(parents=True)
    (pdir / "feed.json").write_text(json.dumps({
        "date": "2026-06-01",
        "items": [
            {"title": "好玩 game", "summary": "love it", "time": "2026-06-01T00:00:00Z",
             "engagement": 10, "lang": "zh"},
            {"title": "bug report", "time": "2026-06-02", "engagement": "bad"},  # eng coerced to 0
        ],
    }, ensure_ascii=False), encoding="utf-8")
    # a malformed json file -> skipped
    (pdir / "broken.json").write_text("{not json", encoding="utf-8")
    # discord jsonl
    ddir = data / "discord" / "channels" / "abc"
    ddir.mkdir(parents=True)
    (ddir / "2026-06-01.jsonl").write_text(
        json.dumps({"content": "discord msg good", "timestamp": "2026-06-01T12:00:00Z",
                    "reactions": [1, 2, 3]}) + "\n"
        + "\n"  # blank line skipped
        + "{bad json}\n",
        encoding="utf-8")
    # comments jsonl
    cdir = data / "platforms" / "youtube_comments"
    cdir.mkdir(parents=True)
    (cdir / "c.jsonl").write_text(
        json.dumps({"text": "nice video", "published": "2026-06-03", "likes": 5}) + "\n",
        encoding="utf-8")
    # 合成旧布局（platforms/ + discord/）；走 _sources 的 legacy 分支：
    # 把 COMMUNITY_NEW 指向不存在路径，DATA_OLD 指向合成 data。
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    return data


def test_iter_records_yields_all_layers(synth_data):
    recs = list(bci.iter_records())
    platforms = [r[0] for r in recs]
    assert "bilibili" in platforms
    assert "discord" in platforms
    assert "youtube_comments" in platforms
    # engagement coercion: the "bad" engagement item -> 0
    bili = [r for r in recs if r[0] == "bilibili"]
    engs = [r[4] for r in bili]
    assert 10 in engs and 0 in engs


def test_iter_records_discord_reactions_len(synth_data):
    recs = list(bci.iter_records())
    disc = [r for r in recs if r[0] == "discord"]
    assert disc and disc[0][4] == 3  # len(reactions)


def test_iter_records_max_files_limits(synth_data):
    # max_files 现按「源数」限流（重构后 _sources 逐源产出）；=1 → 仅一个源
    recs = list(bci.iter_records(max_files=1))
    assert recs, "expected records from one source"
    assert len({r[0] for r in recs}) == 1


# --- build (aggregation arithmetic) -----------------------------------------

def test_build_aggregates_synthetic(synth_data):
    idx = bci.build()
    assert idx["_meta"]["data_layer"] == "full_archive"
    assert idx["_meta"]["total_records"] >= 3
    assert idx["_meta"]["platform_count"] >= 1
    assert "bilibili" in idx["platforms"]
    bili = idx["platforms"]["bilibili"]
    assert bili["total"] >= 1
    # coverage ratio present and within bounds
    mo = next(iter(bili["by_month"].values()))
    assert 0 <= mo["coverage"]["ratio"] <= 1
    assert "sentiment" in mo
    assert "first_month" in bili and "last_month" in bili


def test_build_timeline_and_vol_index(synth_data):
    idx = bci.build()
    timeline = idx["timeline"]
    assert timeline, "timeline empty"
    for ym, t in timeline.items():
        assert "count" in t and "by_platform" in t
        assert "vol_index" in t  # None for first months, set later


def test_build_top_terms_by_month(synth_data):
    idx = bci.build()
    assert isinstance(idx["top_terms_by_month"], dict)


def test_build_empty_when_no_data(tmp_path, monkeypatch):
    empty = tmp_path / "empty"
    (empty / "platforms").mkdir(parents=True)
    (empty / "discord").mkdir(parents=True)
    monkeypatch.setattr(bci, "COMMUNITY_NEW", empty / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", empty)
    idx = bci.build()
    assert idx["_meta"]["total_records"] == 0
    assert idx["platforms"] == {}
    assert idx["timeline"] == {}


def test_build_records_without_day_skipped(tmp_path, monkeypatch):
    data = tmp_path / "data"
    pdir = data / "platforms" / "steam"
    pdir.mkdir(parents=True)
    (data / "discord").mkdir()
    (pdir / "f.json").write_text(json.dumps({
        "items": [{"title": "no date here", "engagement": 1}],
    }), encoding="utf-8")
    monkeypatch.setattr(bci, "COMMUNITY_NEW", data / "__no_such_new__")
    monkeypatch.setattr(bci, "DATA_OLD", data)
    idx = bci.build()
    # the dateless record is dropped
    assert idx["_meta"]["total_records"] == 0


def _repo_tmp_out(prefix):
    """A unique JSON path under REPO (main() prints OUT.relative_to(REPO))."""
    import tempfile, os
    repo = Path(__file__).resolve().parent.parent
    fd, name = tempfile.mkstemp(suffix=".json", prefix=prefix, dir=repo)
    os.close(fd)
    return Path(name)


def test_main_writes_index(synth_data, monkeypatch, capsys):
    """main() over synthetic DATA, writing to a redirected OUT (no real data)."""
    out = _repo_tmp_out("_unit_ci_")
    monkeypatch.setattr(bci, "OUT", out)
    monkeypatch.setattr(sys, "argv", ["build_community_index.py"])
    try:
        bci.main()
        written = json.loads(out.read_text(encoding="utf-8"))
        assert written["_meta"]["data_layer"] == "full_archive"
        captured = capsys.readouterr()
        assert "community index" in captured.out
    finally:
        out.unlink(missing_ok=True)


def test_main_max_files_arg(synth_data, monkeypatch):
    out = _repo_tmp_out("_unit_ci2_")
    monkeypatch.setattr(bci, "OUT", out)
    monkeypatch.setattr(sys, "argv", ["build_community_index.py", "--max-files", "1"])
    try:
        bci.main()
        assert out.exists()
    finally:
        out.unlink(missing_ok=True)
