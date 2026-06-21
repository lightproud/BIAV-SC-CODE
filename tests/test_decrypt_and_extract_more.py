"""Extra branch coverage for decrypt_and_extract.py.

Reuses the same UnityPy sys.modules stubbing approach as
tests/test_decrypt_and_extract_unit.py (no real crypto / bundles; tmp_path I/O).
Targets the remaining uncovered branches: parse_signatures decode failure,
brute-force parents-loop fallbacks, extract_with_key object-type branches and
env cleanup, and main()'s rglob-sample / error-printing / step-3 cap / >50
file listing paths.
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


def _fake_obj(obj_type, read_attrs=None, read_side=None, typetree=None,
              typetree_side=None, image=None):
    obj = mock.MagicMock()
    obj.type = obj_type
    if read_side is not None:
        obj.read.side_effect = read_side
    else:
        data = mock.MagicMock()
        for k, v in (read_attrs or {}).items():
            setattr(data, k, v)
        if image is not None:
            data.image = image
        obj.read.return_value = data
    if typetree_side is not None:
        obj.read_typetree.side_effect = typetree_side
    elif typetree is not None:
        obj.read_typetree.return_value = typetree
    return obj


class _Env:
    def __init__(self, objects, files=None):
        self.objects = objects
        self._files = files if files is not None else {}


# ---------- parse_signatures ----------

def test_parse_signatures_decode_failure_returns_none():
    # Matches the regex but literal_eval raises -> except branch (52-53).
    msg = r"encrypted key_sig=b'\xZZ' data_sig=b'\xYY'"
    assert dae.parse_signatures(msg) is None


# ---------- try_brute_force parents-loop fallbacks ----------

def test_gameassembly_found_via_parents_loop(tmp_path):
    # metadata at root (no parent.parent.parent dir), GameAssembly deeper up the
    # parents chain -> exercises the `for parent in metadata_path.parents` loop (156-157).
    meta = tmp_path / "global-metadata.dat"
    meta.write_bytes(b"m")
    (tmp_path / "GameAssembly.dll").write_bytes(b"\x00" * 10)
    ab = tmp_path / "config.ab"
    ab.write_bytes(b"x")
    err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")

    def _bfk(path, *a):
        if "GameAssembly" in path:
            return b"GAKEY"
        return None

    with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
         mock.patch.object(dae, "brute_force_key", side_effect=_bfk):
        assert dae.try_brute_force(meta, ab) == b"GAKEY"


def test_gameassembly_present_but_key_not_found_and_no_dll(tmp_path):
    # GameAssembly exists at root, brute force returns None (167-168 else branch),
    # no UnityPlayer/baselib -> all fail -> None.
    meta = tmp_path / "global-metadata.dat"
    meta.write_bytes(b"m")
    (tmp_path / "GameAssembly.dll").write_bytes(b"\x00" * 10)
    ab = tmp_path / "config.ab"
    ab.write_bytes(b"x")
    err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")

    with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
         mock.patch.object(dae, "brute_force_key", return_value=None):
        assert dae.try_brute_force(meta, ab) is None


def test_gameassembly_brute_force_raises(tmp_path):
    # GameAssembly brute force raises -> except branch (168-169).
    meta = tmp_path / "global-metadata.dat"
    meta.write_bytes(b"m")
    (tmp_path / "GameAssembly.dll").write_bytes(b"\x00" * 10)
    ab = tmp_path / "config.ab"
    ab.write_bytes(b"x")
    err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")

    def _bfk(path, *a):
        if "GameAssembly" in path:
            raise RuntimeError("ga boom")
        return None

    with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
         mock.patch.object(dae, "brute_force_key", side_effect=_bfk):
        assert dae.try_brute_force(meta, ab) is None


def test_unityplayer_found_via_parents_loop(tmp_path):
    # metadata at root, UnityPlayer.dll up the parents chain (180-181).
    meta = tmp_path / "global-metadata.dat"
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
        assert dae.try_brute_force(meta, ab) == b"UPKEY"


def test_unityplayer_brute_force_raises(tmp_path):
    # UnityPlayer.dll brute force raises -> except (189-190); then all fail -> None.
    meta = tmp_path / "global-metadata.dat"
    meta.write_bytes(b"m")
    (tmp_path / "UnityPlayer.dll").write_bytes(b"\x00" * 10)
    ab = tmp_path / "config.ab"
    ab.write_bytes(b"x")
    err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")

    def _bfk(path, *a):
        if "UnityPlayer" in path:
            raise RuntimeError("up boom")
        return None

    with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
         mock.patch.object(dae, "brute_force_key", side_effect=_bfk):
        assert dae.try_brute_force(meta, ab) is None


# ---------- extract_with_key branches ----------

def test_text_asset_undecodable_binary_skipped(tmp_path):
    # decode_script returns None for undecodable bytes -> continue (221).
    out = tmp_path / "out"
    binary = b"\xff\xfe\xff\xfe"
    obj = _fake_obj(ClassIDType.TextAsset, {"m_Name": "x", "m_Script": binary})
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["text"] == 0


def test_text_asset_whitespace_only_skipped(tmp_path):
    # Non-None but blank text -> `if not text or len(strip)<2: continue` (221).
    out = tmp_path / "out"
    obj = _fake_obj(ClassIDType.TextAsset, {"m_Name": "x", "m_Script": "  \n "})
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["text"] == 0


def test_mono_behaviour_without_name_skipped(tmp_path):
    # m_Name falsy -> continue (234).
    out = tmp_path / "out"
    obj = _fake_obj(ClassIDType.MonoBehaviour, {"m_Name": ""})
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["mono"] == 0


def test_mono_behaviour_typetree_raises_swallowed(tmp_path):
    # read_typetree raises -> except: pass (245-246), no crash.
    out = tmp_path / "out"
    obj = _fake_obj(ClassIDType.MonoBehaviour, {"m_Name": "mb"},
                    typetree_side=RuntimeError("tt boom"))
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["mono"] == 0


def test_mono_behaviour_typetree_written(tmp_path):
    # Valid typetree dict with >2 keys -> written (covers 237-244 happy path).
    out = tmp_path / "out"
    obj = _fake_obj(ClassIDType.MonoBehaviour, {"m_Name": "mb"},
                    typetree={"a": 1, "b": 2, "c": 3})
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["mono"] == 1
    assert (out / "mono" / "mb.json").exists()


def test_texture_branch_raises_swallowed(tmp_path):
    # Texture2D path: accessing .image raises -> except: pass (258-259).
    out = tmp_path / "out"
    data = mock.MagicMock()
    data.m_Name = "tex"
    type(data).image = mock.PropertyMock(side_effect=RuntimeError("img boom"))
    obj = mock.MagicMock()
    obj.type = ClassIDType.Texture2D
    obj.read.return_value = data
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["tex"] == 0


def test_texture_branch_saved(tmp_path):
    # Texture2D large enough -> img.save called, tex counted (253-257).
    out = tmp_path / "out"
    img = mock.MagicMock()
    img.width = 128
    img.height = 128
    obj = _fake_obj(ClassIDType.Texture2D, {"m_Name": "tex"}, image=img)
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["tex"] == 1
    img.save.assert_called_once()


def test_env_cleanup_closes_files(tmp_path):
    # env._files has closeable handles -> cleanup loop runs f.close() (267-270).
    out = tmp_path / "out"
    closeable = mock.MagicMock()
    env = _Env([], files={"a": closeable})
    with mock.patch.object(dae.UnityPy, "load", return_value=env):
        dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    closeable.close.assert_called_once()


def test_env_cleanup_exception_swallowed(tmp_path):
    # _files access / close raises -> outer except: pass (269-270).
    out = tmp_path / "out"

    class _BadEnv:
        objects = []

        @property
        def _files(self):
            raise RuntimeError("files boom")

    with mock.patch.object(dae.UnityPy, "load", return_value=_BadEnv()):
        stats = dae.extract_with_key(tmp_path / "f.ab", b"K", out)
    assert stats["text"] == 0  # no crash


# ---------- main() remaining branches ----------

def _game_root(tmp_path):
    data = tmp_path / "Morimens_Data"
    md = data / "il2cpp_data" / "Metadata"
    md.mkdir(parents=True)
    (md / "global-metadata.dat").write_bytes(b"m")
    sa = data / "StreamingAssets"
    sa.mkdir(parents=True, exist_ok=True)
    return tmp_path, sa


def test_main_sample_ab_via_rglob_fallback(monkeypatch, tmp_path):
    # No priority .ab present, but a nested .ab exists -> rglob fallback (330-331).
    root, sa = _game_root(tmp_path)
    nested = sa / "sub"
    nested.mkdir()
    (nested / "weird.ab").write_bytes(b"x")
    out = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", ["x", str(root), str(out)])
    monkeypatch.setattr(dae, "try_brute_force", lambda *a: b"KEY")
    with mock.patch.object(dae.UnityPy, "load", return_value=_Env([])):
        dae.main()
    assert out.exists()


def test_main_prints_extraction_errors(monkeypatch, tmp_path):
    # extract_with_key returns errors -> main prints the errors block (369-371).
    root, sa = _game_root(tmp_path)
    (sa / "config.ab").write_bytes(b"x")
    out = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", ["x", str(root), str(out)])
    monkeypatch.setattr(dae, "try_brute_force", lambda *a: b"KEY")
    monkeypatch.setattr(dae, "extract_with_key",
                        lambda *a, **k: {"text": 0, "mono": 0, "tex": 0,
                                         "errors": ["e1", "e2", "e3", "e4"]})
    dae.main()  # must not raise; error printing path executed


def test_main_step3_cap_and_listing_over_50(monkeypatch, tmp_path):
    # Step 3 hits >100 char bundles -> break (396); >50 text files -> "... more" (415).
    root, sa = _game_root(tmp_path)
    (sa / "config.ab").write_bytes(b"x")
    for i in range(105):
        (sa / f"hero_{i}.ab").write_bytes(b"x")
    out = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", ["x", str(root), str(out)])
    monkeypatch.setattr(dae, "try_brute_force", lambda *a: b"KEY")

    # Pre-populate >50 text files so the listing truncation runs.
    tdir = out / "text"
    tdir.mkdir(parents=True)
    for i in range(55):
        (tdir / f"pre_{i}.txt").write_text("x", encoding="utf-8")

    def _extract(ab, key, output_dir):
        return {"text": 1, "mono": 0, "tex": 0, "errors": []}

    monkeypatch.setattr(dae, "extract_with_key", _extract)
    dae.main()
    assert (out / "text").exists()
