"""Additional unit tests for extract_client_data.py — main() + uncovered branches.

UnityPy/PIL stubbed via sys.modules; all I/O uses tmp_path.
"""

import json
import sys
import types
from pathlib import Path
from unittest import mock

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _install_unitypy_stub():
    if "UnityPy" in sys.modules:
        return

    class _ClassIDType:
        class _T:
            def __init__(self, name):
                self.name = name

            def __eq__(self, other):
                return isinstance(other, _ClassIDType._T) and other.name == self.name

            def __hash__(self):
                return hash(self.name)

        TextAsset = _T("TextAsset")
        MonoBehaviour = _T("MonoBehaviour")
        Texture2D = _T("Texture2D")

    unitypy = types.ModuleType("UnityPy")
    unitypy.load = mock.MagicMock(name="UnityPy.load")
    enums = types.ModuleType("UnityPy.enums")
    enums.ClassIDType = _ClassIDType
    unitypy.enums = enums
    sys.modules["UnityPy"] = unitypy
    sys.modules["UnityPy.enums"] = enums


_install_unitypy_stub()

import extract_client_data as ecd  # noqa: E402
from UnityPy.enums import ClassIDType  # noqa: E402


def _fake_obj(obj_type, **read_attrs):
    obj = mock.MagicMock()
    obj.type = obj_type
    data = mock.MagicMock()
    for k, v in read_attrs.items():
        setattr(data, k, v)
    obj.read.return_value = data
    return obj


class _Env:
    def __init__(self, objects):
        self.objects = objects
        self._files = {}


class TestFindAssetFilesExtras:
    def test_persistent_data_and_large_unknown_skipped(self, tmp_path):
        root = tmp_path / "game"
        pd = root / "PersistentData"
        pd.mkdir(parents=True)
        # unknown extension but small -> unity
        (pd / "small.dat").write_bytes(b"x")
        unity, direct = ecd.find_asset_files(root)
        assert "small.dat" in {p.name for p in unity}

    def test_skip_extension_excluded(self, tmp_path):
        root = tmp_path / "game"
        sa = root / "StreamingAssets"
        sa.mkdir(parents=True)
        (sa / "movie.mp4").write_bytes(b"x")
        unity, direct = ecd.find_asset_files(root)
        assert "movie.mp4" not in {p.name for p in unity + direct}


class TestExtractTexturesError:
    def test_save_exception_recorded(self, tmp_path):
        with mock.patch.object(ecd, "HAS_PIL", True):
            img = mock.MagicMock()
            img.width, img.height = 128, 128
            img.save.side_effect = RuntimeError("disk full")
            obj = _fake_obj(ClassIDType.Texture2D, m_Name="portrait", image=img)
            stats = {"textures": 0, "errors": []}
            ecd.extract_textures(_Env([obj]), tmp_path, stats)
            assert len(stats["errors"]) == 1


class TestMonoReadError:
    def test_outer_read_exception(self, tmp_path):
        obj = mock.MagicMock()
        obj.type = ClassIDType.MonoBehaviour
        obj.read.side_effect = RuntimeError("read boom")
        stats = {"mono_assets": 0, "errors": []}
        ecd.extract_monobehaviours(_Env([obj]), tmp_path, stats)
        assert len(stats["errors"]) == 1


class TestScanAndExtractParallel:
    def test_parallel_workers_path(self, tmp_path, monkeypatch):
        root = tmp_path / "game"
        root.mkdir()
        (root / "a.assets").write_bytes(b"x")
        (root / "b.assets").write_bytes(b"x")

        # Drive the parallel branch but run synchronously in-process via a fake
        # executor (real ProcessPoolExecutor would try to pickle the mock).
        class _ImmediateFuture:
            def __init__(self, result):
                self._result = result
            def result(self):
                return self._result

        class _FakeExecutor:
            def __init__(self, *a, **k):
                self._tasks = []
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def submit(self, fn, *args, **kw):
                return _ImmediateFuture(fn(*args, **kw))

        def _fake_extract(af, gdd, out, tex, texf, verbose=False):
            return {
                "asset_files_scanned": 1, "asset_files_failed": 0,
                "text_assets": 1, "json_files": 1, "mono_assets": 0,
                "textures": 0, "binary_skipped": 0, "errors": [],
                "object_types": {"TextAsset": 1}, "_rel": af.name,
            }

        monkeypatch.setattr(ecd, "ProcessPoolExecutor", _FakeExecutor)
        monkeypatch.setattr(ecd, "as_completed", lambda futs: list(futs))
        monkeypatch.setattr(ecd, "_extract_single_file", _fake_extract)
        stats = ecd.scan_and_extract(root, tmp_path / "out", workers=2, verbose=True)
        assert stats["asset_files_scanned"] == 2
        assert stats["text_assets"] == 2
        assert stats["all_object_types"]["TextAsset"] == 2

    def test_sequential_verbose(self, tmp_path):
        root = tmp_path / "game"
        root.mkdir()
        (root / "a.assets").write_bytes(b"x")
        obj = _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')
        with mock.patch.object(ecd.UnityPy, "load", return_value=_Env([obj])):
            stats = ecd.scan_and_extract(root, tmp_path / "out", workers=1, verbose=True)
        assert stats["asset_files_scanned"] == 1


class TestMain:
    def _setup(self, tmp_path):
        gdd = tmp_path / "game"
        sa = gdd / "StreamingAssets"
        sa.mkdir(parents=True)
        (sa / "data.assets").write_bytes(b"x")
        return gdd

    def test_not_a_directory(self, monkeypatch, tmp_path):
        monkeypatch.setattr(sys, "argv", ["x", str(tmp_path / "nope")])
        with pytest.raises(SystemExit) as e:
            ecd.main()
        assert e.value.code == 1

    def test_full_run_with_map_schema(self, monkeypatch, tmp_path):
        gdd = self._setup(tmp_path)
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv",
                            ["x", str(gdd), "-o", str(out), "--no-textures",
                             "--map-schema", "--workers", "1", "--verbose"])
        obj = _fake_obj(ClassIDType.TextAsset, m_Name="HeroConfig", m_Script='[{"hp":1,"atk":2}]')
        with mock.patch.object(ecd.UnityPy, "load", return_value=_Env([obj])):
            ecd.main()
        assert (out / "extraction_stats.json").exists()
        assert (out / "schema_mapping_report.json").exists()
        assert (out / "text" / "HeroConfig.json").exists()

    def test_autodetect_data_subdir(self, monkeypatch, tmp_path):
        # game root has no .assets/StreamingAssets, but a *_Data subdir does
        root = tmp_path / "Morimens"
        data = root / "Morimens_Data"
        sa = data / "StreamingAssets"
        sa.mkdir(parents=True)
        (sa / "data.assets").write_bytes(b"x")
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv",
                            ["x", str(root), "-o", str(out), "--no-textures", "--workers", "1"])
        obj = _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')
        with mock.patch.object(ecd.UnityPy, "load", return_value=_Env([obj])):
            ecd.main()
        assert (out / "extraction_stats.json").exists()

    def test_run_with_textures_and_many_json(self, monkeypatch, tmp_path):
        gdd = self._setup(tmp_path)
        out = tmp_path / "out"
        # textures enabled (no --no-textures) exercises extract_tex=True branch
        monkeypatch.setattr(sys, "argv", ["x", str(gdd), "-o", str(out), "--workers", "1"])
        monkeypatch.setattr(ecd, "HAS_PIL", True)
        # Emit 35 distinct JSON TextAssets so the ">30 ... more" listing runs
        objs = [_fake_obj(ClassIDType.TextAsset, m_Name=f"cfg{i}", m_Script='{"a":1}')
                for i in range(35)]
        with mock.patch.object(ecd.UnityPy, "load", return_value=_Env(objs)):
            ecd.main()
        json_files = list((out / "text").glob("*.json"))
        assert len(json_files) == 35

    def test_run_with_errors_reported(self, monkeypatch, tmp_path):
        gdd = self._setup(tmp_path)
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv",
                            ["x", str(gdd), "-o", str(out), "--no-textures", "--workers", "1"])
        with mock.patch.object(ecd.UnityPy, "load", side_effect=RuntimeError("bad bundle")):
            ecd.main()
        stats = json.loads((out / "extraction_stats.json").read_text())
        assert stats["asset_files_failed"] == 1
        assert stats["errors"]
