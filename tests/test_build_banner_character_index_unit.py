"""Unit tests for build_banner_character_index.py (banner<->character cross-index)."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects/wiki/scripts"))

import build_banner_character_index as bci  # noqa: E402


def _write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def patched(tmp_path, monkeypatch):
    db = tmp_path / "db"
    processed = tmp_path / "processed"
    db.mkdir()
    processed.mkdir()
    (tmp_path / "scripts").mkdir()
    monkeypatch.setattr(bci, "SCRIPT_DIR", tmp_path / "scripts")
    monkeypatch.setattr(bci, "DB_DIR", db)
    monkeypatch.setattr(bci, "PROCESSED_DIR", processed)
    monkeypatch.setattr(bci, "CHARACTERS_JSON", db / "characters.json")
    monkeypatch.setattr(bci, "SUMMON_JSON", processed / "summon.json")
    monkeypatch.setattr(bci, "OUTPUT_PATH", processed / "banners_by_character.json")
    return {"db": db, "processed": processed}


class TestBuildNameToId:
    def test_maps_all_handles_and_normalized(self):
        chars = [{"id": "1", "name_zh": "玛 修", "slug": "mash", "name_en": None}]
        m = bci.build_name_to_id(chars)
        assert m["玛 修"] == "1"
        assert m["玛修"] == "1"  # normalized (spaces removed)
        assert m["mash"] == "1"

    def test_ignores_non_string_values(self):
        chars = [{"id": "2", "name_zh": 123, "slug": "abc"}]
        m = bci.build_name_to_id(chars)
        assert "abc" in m
        assert 123 not in m.values() or m == {"abc": "2"}


class TestExtractTerms:
    def test_splits_on_separators(self):
        banner = {"rate_up": "玛修/吉尔伽美什·恩奇都", "title": "限定 召唤"}
        terms = bci.extract_terms(banner)
        assert "玛修" in terms
        assert "吉尔伽美什" in terms
        assert "恩奇都" in terms
        assert "召唤" in terms

    def test_ignores_non_string_fields(self):
        assert bci.extract_terms({"rate_up": 5, "name": ""}) == []


class TestMatchBanner:
    def test_exact_match(self):
        idx = {"玛修": "1"}
        matched, unmatched = bci.match_banner({"rate_up": "玛修"}, idx)
        assert matched == {"1"}
        assert unmatched == set()

    def test_substring_match(self):
        idx = {"玛修": "1"}
        matched, unmatched = bci.match_banner({"desc": "本期主角玛修登场"}, idx)
        assert matched == {"1"}

    def test_unmatched_term_recorded(self):
        idx = {"玛修": "1"}
        matched, unmatched = bci.match_banner({"rate_up": "未知角色"}, idx)
        assert matched == set()
        assert "未知角色" in unmatched

    def test_single_char_unmatched_not_recorded(self):
        idx = {"玛修": "1"}
        matched, unmatched = bci.match_banner({"rate_up": "X"}, idx)
        assert unmatched == set()


class TestLoaders:
    def test_load_characters_list(self, patched):
        _write(patched["db"] / "characters.json", [{"id": "1"}])
        assert bci.load_characters() == [{"id": "1"}]

    def test_load_characters_dict_shape(self, patched):
        _write(patched["db"] / "characters.json", {"characters": [{"id": "2"}]})
        assert bci.load_characters() == [{"id": "2"}]

    def test_load_characters_missing_exits(self, patched):
        with pytest.raises(SystemExit) as exc:
            bci.load_characters()
        assert exc.value.code == 2

    def test_load_banners(self, patched):
        _write(patched["processed"] / "summon.json", {"banners": [{"id": 1}]})
        assert bci.load_banners() == [{"id": 1}]

    def test_load_banners_missing_exits(self, patched):
        with pytest.raises(SystemExit) as exc:
            bci.load_banners()
        assert exc.value.code == 2


class TestMain:
    def test_main_writes_output(self, patched, monkeypatch):
        _write(patched["db"] / "characters.json", [{"id": "1", "name_zh": "玛修"}])
        _write(patched["processed"] / "summon.json",
               {"banners": [{"id": 10, "rate_up": "玛修"}, {"id": 11, "rate_up": "未知"}]})
        monkeypatch.setattr(sys, "argv", ["x"])
        rc = bci.main()
        assert rc == 0
        out = json.loads((patched["processed"] / "banners_by_character.json").read_text())
        assert out["banners_by_character"]["1"] == [10]
        assert out["characters_by_banner"]["10"] == ["1"]
        assert "未知" in out["unmatched_rate_up_terms"]

    def test_main_dry_run_and_show_unmatched(self, patched, monkeypatch, capsys):
        _write(patched["db"] / "characters.json", [{"id": "1", "name_zh": "玛修"}])
        _write(patched["processed"] / "summon.json",
               {"banners": [{"id": 10, "rate_up": "未知角色"}, {"id": None}]})
        monkeypatch.setattr(sys, "argv", ["x", "--dry-run", "--show-unmatched"])
        rc = bci.main()
        assert rc == 0
        assert not (patched["processed"] / "banners_by_character.json").exists()
        assert "未知角色" in capsys.readouterr().out
