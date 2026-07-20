"""Logic tests for parse_cg_gallery.

Asserts the dense logic: cg/ prefix filter, `c(\\d+)` chapter regex, chapter-vs-
special grouping, int-key sort (not string sort), name sort, and the count
rollups, plus the unknown-chapter and empty-manifest paths.

NOT under the mutmut gate: this module embeds a 15-entry chapter-name dict whose
string mutants would require asserting every display name (pins data, not logic)
— see setup.cfg. These assertions are the standing logic guard.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.parse_cg_gallery import parse_cg_gallery  # noqa: E402


def _manifest(tmp_path, files):
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps({"files": files}), encoding="utf-8")
    return str(p)


def test_only_cg_prefixed_files_are_counted(tmp_path):
    mp = _manifest(tmp_path, [
        {"name": "a", "path": "cg/c00/a.png", "size": 1},
        {"name": "skip", "path": "ui/button.png", "size": 9},  # not cg/ -> excluded
    ])
    res = parse_cg_gallery(mp)
    assert res["_meta"]["total_cg"] == 1


def test_chapter_extracted_via_regex_and_named(tmp_path):
    mp = _manifest(tmp_path, [{"name": "x", "path": "cg/c00/x.png", "size": 5}])
    res = parse_cg_gallery(mp)
    assert res["_meta"]["story_chapters"] == 1
    ch = res["chapters"][0]
    assert ch["chapter_id"] == "00"
    assert ch["chapter_name"] == "Arc 1 - Prologue (序章)"
    assert ch["image_count"] == 1
    assert ch["images"][0]["path"] == "cg/c00/x.png"


def test_unknown_chapter_key_gets_generic_name(tmp_path):
    mp = _manifest(tmp_path, [{"name": "x", "path": "cg/c77/x.png", "size": 1}])
    res = parse_cg_gallery(mp)
    assert res["chapters"][0]["chapter_name"] == "Chapter 77"


def test_non_chapter_subdir_goes_to_special_group(tmp_path):
    mp = _manifest(tmp_path, [
        {"name": "s", "path": "cg/cg_sd/s.png", "size": 2},  # no c<digits> -> special
    ])
    res = parse_cg_gallery(mp)
    assert res["_meta"]["story_chapters"] == 0
    assert res["_meta"]["special_groups"] == 1
    sg = res["special"][0]
    assert sg["group_id"] == "cg_sd"
    assert sg["group_name"] == "SD / Chibi CG (Q版CG)"
    assert sg["image_count"] == 1


def test_chapters_sorted_by_int_not_string(tmp_path):
    # string sort would put "201" before "08"; int sort must put 8 before 201.
    mp = _manifest(tmp_path, [
        {"name": "b", "path": "cg/c201/b.png", "size": 1},
        {"name": "a", "path": "cg/c08/a.png", "size": 1},
    ])
    res = parse_cg_gallery(mp)
    ids = [c["chapter_id"] for c in res["chapters"]]
    assert ids == ["08", "201"]


def test_images_within_chapter_sorted_by_name(tmp_path):
    mp = _manifest(tmp_path, [
        {"name": "z", "path": "cg/c00/z.png", "size": 1},
        {"name": "a", "path": "cg/c00/a.png", "size": 1},
    ])
    res = parse_cg_gallery(mp)
    names = [img["name"] for img in res["chapters"][0]["images"]]
    assert names == ["a", "z"]


def test_image_count_matches_grouping(tmp_path):
    mp = _manifest(tmp_path, [
        {"name": "a", "path": "cg/c00/a.png", "size": 1},
        {"name": "b", "path": "cg/c00/b.png", "size": 1},
        {"name": "c", "path": "cg/c01/c.png", "size": 1},
    ])
    res = parse_cg_gallery(mp)
    counts = {c["chapter_id"]: c["image_count"] for c in res["chapters"]}
    assert counts == {"00": 2, "01": 1}
    assert res["_meta"]["total_cg"] == 3


def test_empty_manifest_yields_zero_everything(tmp_path):
    mp = _manifest(tmp_path, [])
    res = parse_cg_gallery(mp)
    assert res["_meta"]["total_cg"] == 0
    assert res["chapters"] == [] and res["special"] == []


def test_manifest_missing_files_key_defaults_to_empty(tmp_path):
    # no 'files' key at all -> .get('files', []) default must be [] (not None,
    # which would crash the iteration). Pins the missing-key default.
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps({"other": 1}), encoding="utf-8")
    res = parse_cg_gallery(str(p))
    assert res["_meta"]["total_cg"] == 0


def test_entry_missing_path_is_excluded_not_crashed(tmp_path):
    # an entry with no 'path' -> .get('path', '') default '' (not None, which
    # would crash .startswith). The entry is simply excluded from cg_entries.
    mp = _manifest(tmp_path, [
        {"name": "nopath", "size": 1},                       # no 'path'
        {"name": "ok", "path": "cg/c00/ok.png", "size": 1},
    ])
    res = parse_cg_gallery(mp)
    assert res["_meta"]["total_cg"] == 1
