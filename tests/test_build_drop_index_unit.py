"""Unit tests for build_drop_index.py (wiki reverse drop index)."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects/wiki/scripts"))

import build_drop_index as bdi  # noqa: E402


def _write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


@pytest.fixture
def patched_dirs(tmp_path, monkeypatch):
    db = tmp_path / "db"
    processed = tmp_path / "processed"
    db.mkdir()
    processed.mkdir()
    # SCRIPT_DIR.parent must be tmp_path so OUTPUT_PATH.relative_to(...) works
    (tmp_path / "scripts").mkdir()
    monkeypatch.setattr(bdi, "SCRIPT_DIR", tmp_path / "scripts")
    monkeypatch.setattr(bdi, "DB_DIR", db)
    monkeypatch.setattr(bdi, "PROCESSED_DIR", processed)
    monkeypatch.setattr(bdi, "DB_STAGES", db / "stages.json")
    monkeypatch.setattr(bdi, "PROCESSED_STAGES", processed / "stages.json")
    monkeypatch.setattr(bdi, "OUTPUT_PATH", processed / "drops_by_item.json")
    return {"db": db, "processed": processed}


class TestBuildIndex:
    def test_inverts_drops_and_rewards(self):
        stages = [
            {"id": 1, "drops": [{"item_id": "wood"}, {"item_id": "iron"}],
             "first_clear_rewards": [{"item_id": "gem"}]},
            {"id": 2, "drops": [{"item_id": "wood"}]},
        ]
        idx = bdi.build_index(stages)
        assert idx["wood"] == [1, 2]
        assert idx["iron"] == [1]
        assert idx["gem"] == [1]

    def test_skips_stage_without_id(self):
        idx = bdi.build_index([{"drops": [{"item_id": "x"}]}])
        assert idx == {}

    def test_skips_drop_without_item_id(self):
        idx = bdi.build_index([{"id": 5, "drops": [{"qty": 1}], "first_clear_rewards": [{}]}])
        assert idx == {}

    def test_handles_none_drop_lists(self):
        idx = bdi.build_index([{"id": 3, "drops": None, "first_clear_rewards": None}])
        assert idx == {}


class TestLoadStages:
    def test_db_source(self, patched_dirs):
        _write(patched_dirs["db"] / "stages.json", {"stages": [{"id": 1}]})
        stages, label = bdi.load_stages("db")
        assert label == "db/stages.json"
        assert stages == [{"id": 1}]

    def test_db_missing_falls_back_to_processed(self, patched_dirs):
        _write(patched_dirs["processed"] / "stages.json", {"stages": [{"id": 7}]})
        stages, label = bdi.load_stages("db")
        assert label == "processed/stages.json"
        assert stages == [{"id": 7}]

    def test_processed_source(self, patched_dirs):
        _write(patched_dirs["processed"] / "stages.json", {"stages": [{"id": 9}]})
        stages, label = bdi.load_stages("processed")
        assert label == "processed/stages.json"

    def test_no_source_exits(self, patched_dirs):
        with pytest.raises(SystemExit) as exc:
            bdi.load_stages("processed")
        assert exc.value.code == 2


class TestMain:
    def test_main_writes_output(self, patched_dirs, monkeypatch):
        _write(patched_dirs["db"] / "stages.json",
               {"stages": [{"id": 1, "drops": [{"item_id": "wood"}]}]})
        monkeypatch.setattr(sys, "argv", ["build_drop_index.py"])
        rc = bdi.main()
        assert rc == 0
        out = json.loads((patched_dirs["processed"] / "drops_by_item.json").read_text())
        assert out["drops_by_item"]["wood"] == [1]
        assert out["_meta"]["items_with_sources"] == 1

    def test_main_dry_run_writes_nothing(self, patched_dirs, monkeypatch):
        _write(patched_dirs["db"] / "stages.json",
               {"stages": [{"id": 1, "drops": [{"item_id": "wood"}]}]})
        monkeypatch.setattr(sys, "argv", ["build_drop_index.py", "--dry-run"])
        rc = bdi.main()
        assert rc == 0
        assert not (patched_dirs["processed"] / "drops_by_item.json").exists()

    def test_main_source_processed(self, patched_dirs, monkeypatch):
        _write(patched_dirs["processed"] / "stages.json",
               {"stages": [{"id": 2, "drops": [{"item_id": "iron"}]}]})
        monkeypatch.setattr(sys, "argv", ["build_drop_index.py", "--source", "processed"])
        rc = bdi.main()
        assert rc == 0
