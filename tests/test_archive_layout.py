"""archive_layout.py 契约测试：写方落的路径，读方必能找回来。

这是「归档布局单一真相源」（2026-07-02 P0-1）的核心不变量——此前布局知识散落
在写方与读方各自代码里，分层实施后互相失联（6 源假 degraded / 断档检测扫空屋 /
回填写平级与主线写分层对冲）。本测试锁定：任一注册源经 resolve_write_layout +
build_relpath 写下的文件，iter_source_files/dated_files 以同一源名必能读回，
且不会被别的源读走（跨源隔离）。
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import archive_layout as al  # noqa: E402


def _write_via_layout(root: Path, source: str, date_str: str, payload=None) -> Path:
    platform, region, subtype = al.resolve_write_layout(source)
    path = root / al.build_relpath(platform, region, subtype, date_str)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload or {"item_count": 1, "items": []}), encoding="utf-8")
    return path


# ── 写读往返：每个代表性源 ──────────────────────────────────────────────────

@pytest.mark.parametrize("source", [
    "steam", "official", "steam_discussion", "taptap_review",
    "appstore", "google_play", "youtube", "bilibili", "weibo",
])
def test_write_read_roundtrip(tmp_path, source):
    written = _write_via_layout(tmp_path, source, "2026-07-01")
    found = al.dated_files(source, tmp_path)
    assert written in found, (
        f"{source}: 写方落在 {written.relative_to(tmp_path)}，读方没找回来")


# ── 具体落点断言（规范形态锁定） ─────────────────────────────────────────────

def test_layout_targets_match_spec(tmp_path):
    expect = {
        "steam": "steam/global/review/2026-07-01.json",
        "official": "steam/global/news/2026-07-01.json",
        "steam_discussion": "steam/global/discussion/2026-07-01.json",
        "taptap_review": "taptap/global/review/2026-07-01.json",
        "appstore": "appstore/global/2026-07-01.json",
        "google_play": "google_play/global/2026-07-01.json",
        "youtube": "youtube/global/video/2026-07-01.json",
        "bilibili": "bilibili/2026-07-01.json",  # 单子类平台平铺即规范形态
    }
    for source, rel in expect.items():
        written = _write_via_layout(tmp_path, source, "2026-07-01")
        assert str(written.relative_to(tmp_path)) == rel


# ── 跨源隔离：宿主不吞折叠源，折叠源不吞宿主 ─────────────────────────────────

def test_cross_source_isolation(tmp_path):
    p_steam = _write_via_layout(tmp_path, "steam", "2026-07-01")
    p_news = _write_via_layout(tmp_path, "official", "2026-07-01")
    p_disc = _write_via_layout(tmp_path, "steam_discussion", "2026-07-01")

    steam_files = al.dated_files("steam", tmp_path)
    assert p_steam in steam_files
    assert p_news not in steam_files and p_disc not in steam_files

    official_files = al.dated_files("official", tmp_path)
    assert official_files == [p_news]


def test_host_platform_skips_claimed_subtype_dirs(tmp_path):
    """taptap 自身递归遍历须避开 taptap_review 认领的 review/ 子目录。"""
    p_review = _write_via_layout(tmp_path, "taptap_review", "2026-07-01")
    flat = tmp_path / "taptap" / "2026-06-30.json"
    flat.parent.mkdir(parents=True, exist_ok=True)
    flat.write_text("{}", encoding="utf-8")

    taptap_files = al.dated_files("taptap", tmp_path)
    assert flat in taptap_files and p_review not in taptap_files
    assert al.dated_files("taptap_review", tmp_path) == [p_review]


# ── 旧平级兼容：迁移前的历史文件仍可读 ──────────────────────────────────────

def test_legacy_flat_files_still_readable(tmp_path):
    legacy = tmp_path / "official" / "2026-06-22.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text("{}", encoding="utf-8")
    layered = _write_via_layout(tmp_path, "official", "2026-07-01")
    found = al.dated_files("official", tmp_path)
    assert legacy in found and layered in found
    assert [f.stem for f in found] == ["2026-06-22", "2026-07-01"]  # 按日期升序


# ── 非日期文件过滤 ──────────────────────────────────────────────────────────

def test_non_date_files_filtered(tmp_path):
    pdir = tmp_path / "appstore" / "global"
    pdir.mkdir(parents=True)
    (pdir / "state.json").write_text("{}", encoding="utf-8")
    (pdir / "2026-07-01.json").write_text("{}", encoding="utf-8")
    assert [f.name for f in al.dated_files("appstore", tmp_path)] == ["2026-07-01.json"]
