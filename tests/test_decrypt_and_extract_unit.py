"""Additional unit tests for decrypt_and_extract.py — main() driver + branches.

UnityPy is stubbed into sys.modules (same approach as the existing test) before
import. No real crypto/bundles; all I/O uses tmp_path.
"""

import sys
import types
from pathlib import Path
from unittest import mock

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _install_unitypy_stub():
    if "UnityPy" in sys.modules and hasattr(sys.modules["UnityPy"], "helpers"):
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

    unitypy = sys.modules.get("UnityPy") or types.ModuleType("UnityPy")
    unitypy.load = mock.MagicMock(name="UnityPy.load")
    unitypy.set_assetbundle_decrypt_key = mock.MagicMock()
    enums = types.ModuleType("UnityPy.enums")
    enums.ClassIDType = _ClassIDType
    unitypy.enums = enums
    helpers = types.ModuleType("UnityPy.helpers")
    archive = types.ModuleType("UnityPy.helpers.ArchiveStorageManager")
    archive.brute_force_key = mock.MagicMock(name="brute_force_key")
    helpers.ArchiveStorageManager = archive
    unitypy.helpers = helpers
    sys.modules["UnityPy"] = unitypy
    sys.modules["UnityPy.enums"] = enums
    sys.modules["UnityPy.helpers"] = helpers
    sys.modules["UnityPy.helpers.ArchiveStorageManager"] = archive


_install_unitypy_stub()

import decrypt_and_extract as dae  # noqa: E402
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


class TestBruteForceFallbacks:
    def test_gameassembly_dll_found_via_parent(self, tmp_path):
        # metadata three levels under root; place GameAssembly.dll at root
        meta = tmp_path / "il2cpp_data" / "Metadata" / "global-metadata.dat"
        meta.parent.mkdir(parents=True)
        meta.write_bytes(b"m")
        (tmp_path / "GameAssembly.dll").write_bytes(b"\x00" * 10)
        ab = tmp_path / "config.ab"
        ab.write_bytes(b"x")
        err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")

        # metadata brute force returns None, GameAssembly returns a key
        calls = []

        def _bfk(path, *a):
            calls.append(path)
            if "GameAssembly" in path:
                return b"DLLKEY"
            return None

        with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
             mock.patch.object(dae, "brute_force_key", side_effect=_bfk):
            result = dae.try_brute_force(meta, ab)
        assert result == b"DLLKEY"

    def test_unityplayer_dll_fallback(self, tmp_path):
        meta = tmp_path / "a" / "b" / "global-metadata.dat"
        meta.parent.mkdir(parents=True)
        meta.write_bytes(b"m")
        (tmp_path / "UnityPlayer.dll").write_bytes(b"\x00" * 10)
        ab = tmp_path / "config.ab"
        ab.write_bytes(b"x")
        err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")

        def _bfk(path, *a):
            if "UnityPlayer" in path:
                return b"UPKEY"
            return None

        with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
             mock.patch.object(dae, "brute_force_key", side_effect=_bfk):
            result = dae.try_brute_force(meta, ab)
        assert result == b"UPKEY"

    def test_metadata_brute_force_raises_then_fails(self, tmp_path):
        meta = tmp_path / "global-metadata.dat"
        meta.write_bytes(b"m")
        ab = tmp_path / "config.ab"
        ab.write_bytes(b"x")
        err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")
        with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
             mock.patch.object(dae, "brute_force_key", side_effect=RuntimeError("crypto boom")):
            result = dae.try_brute_force(meta, ab)
        assert result is None


class TestMain:
    def _game_root(self, tmp_path, with_meta=True, with_streaming=True, with_ab=True):
        data = tmp_path / "Morimens_Data"
        if with_meta:
            md = data / "il2cpp_data" / "Metadata"
            md.mkdir(parents=True)
            (md / "global-metadata.dat").write_bytes(b"m")
        else:
            data.mkdir(parents=True, exist_ok=True)
        if with_streaming:
            sa = data / "StreamingAssets"
            sa.mkdir(parents=True, exist_ok=True)
            if with_ab:
                (sa / "config.ab").write_bytes(b"x")
        return tmp_path

    def test_no_args_exits(self, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["decrypt_and_extract.py"])
        with pytest.raises(SystemExit) as e:
            dae.main()
        assert e.value.code == 1

    def test_not_a_directory_exits(self, monkeypatch, tmp_path):
        monkeypatch.setattr(sys, "argv", ["x", str(tmp_path / "missing")])
        with pytest.raises(SystemExit) as e:
            dae.main()
        assert e.value.code == 1

    def test_missing_metadata_exits(self, monkeypatch, tmp_path):
        root = self._game_root(tmp_path, with_meta=False)
        monkeypatch.setattr(sys, "argv", ["x", str(root)])
        with pytest.raises(SystemExit) as e:
            dae.main()
        assert e.value.code == 1

    def test_missing_streaming_exits(self, monkeypatch, tmp_path):
        root = self._game_root(tmp_path, with_streaming=False)
        monkeypatch.setattr(sys, "argv", ["x", str(root)])
        with pytest.raises(SystemExit) as e:
            dae.main()
        assert e.value.code == 1

    def test_no_ab_files_exits(self, monkeypatch, tmp_path):
        root = self._game_root(tmp_path, with_ab=False)
        monkeypatch.setattr(sys, "argv", ["x", str(root)])
        with pytest.raises(SystemExit) as e:
            dae.main()
        assert e.value.code == 1

    def test_key_not_found_exits(self, monkeypatch, tmp_path):
        root = self._game_root(tmp_path)
        monkeypatch.setattr(sys, "argv", ["x", str(root)])
        monkeypatch.setattr(dae, "try_brute_force", lambda *a: None)
        with pytest.raises(SystemExit) as e:
            dae.main()
        assert e.value.code == 1

    def test_full_run_with_key(self, monkeypatch, tmp_path):
        root = self._game_root(tmp_path)
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv", ["x", str(root), str(out)])
        monkeypatch.setattr(dae, "try_brute_force", lambda *a: b"KEY")

        text_obj = _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')
        env = _Env([text_obj])
        with mock.patch.object(dae.UnityPy, "load", return_value=env):
            dae.main()  # returns None; just must not raise
        assert (out / "text" / "cfg.json").exists()
        dae.UnityPy.set_assetbundle_decrypt_key.assert_called()

    def test_full_run_scans_character_art_bundles(self, monkeypatch, tmp_path):
        # Step 3 only runs when text/mono > 0; add a char-art bundle to scan.
        root = self._game_root(tmp_path)
        sa = root / "Morimens_Data" / "StreamingAssets"
        (sa / "hero_portrait.ab").write_bytes(b"x")
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv", ["x", str(root), str(out)])
        monkeypatch.setattr(dae, "try_brute_force", lambda *a: b"KEY")

        def _env_for(_):
            return _Env([_fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')])

        with mock.patch.object(dae.UnityPy, "load", side_effect=_env_for):
            dae.main()
        # text dir populated and step-3 listing executed without error
        assert (out / "text").exists()

    def test_unencrypted_returns_empty_key_branch(self, monkeypatch, tmp_path):
        # try_brute_force returns b"" (falsy) -> skip set_assetbundle_decrypt_key
        root = self._game_root(tmp_path)
        out = tmp_path / "out"
        monkeypatch.setattr(sys, "argv", ["x", str(root), str(out)])
        monkeypatch.setattr(dae, "try_brute_force", lambda *a: b"")
        dae.UnityPy.set_assetbundle_decrypt_key.reset_mock()
        with mock.patch.object(dae.UnityPy, "load", return_value=_Env([])):
            dae.main()
        dae.UnityPy.set_assetbundle_decrypt_key.assert_not_called()
