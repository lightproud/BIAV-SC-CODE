"""Unit tests for the encrypted-AssetBundle decrypt/extract pipeline.

UnityPy is imported at module top (and ``sys.exit(1)`` on failure), so we
inject a stub into ``sys.modules`` before importing. No real crypto, bundles,
or client files are touched; all I/O runs through tempfile.
"""

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

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


class TestParseSignatures(unittest.TestCase):
    def test_parses_both_signatures(self):
        msg = "File is encrypted key_sig=b'abc' data_sig=b'xyz' end"
        self.assertEqual(dae.parse_signatures(msg), (b"abc", b"xyz"))

    def test_parses_hex_escapes(self):
        msg = r"key_sig=b'\x00\x01' data_sig=b'\xff' rest"
        key, data = dae.parse_signatures(msg)
        self.assertEqual(key, b"\x00\x01")
        self.assertEqual(data, b"\xff")

    def test_double_quoted_literals(self):
        msg = 'key_sig=b"aa" data_sig=b"bb"'
        self.assertEqual(dae.parse_signatures(msg), (b"aa", b"bb"))

    def test_missing_signature_returns_none(self):
        self.assertIsNone(dae.parse_signatures("no signatures here"))

    def test_only_one_signature_returns_none(self):
        self.assertIsNone(dae.parse_signatures("key_sig=b'abc' but no data"))


class TestDecodeScript(unittest.TestCase):
    def test_str_passthrough(self):
        self.assertEqual(dae.decode_script("text"), "text")

    def test_utf8_bytes(self):
        self.assertEqual(dae.decode_script("café".encode("utf-8")), "café")

    def test_bom_decoded_via_utf8_keeps_bom(self):
        # utf-8 succeeds on a BOM, so it is preserved (utf-8-sig is fallback-only)
        self.assertEqual(dae.decode_script("hi".encode("utf-8-sig")), "﻿hi")

    def test_undecodable_returns_none(self):
        self.assertIsNone(dae.decode_script(b"\xff\xfe\x81"))


class TestClassifyTextExtension(unittest.TestCase):
    def test_json_not_revalidated(self):
        # Unlike extract_client_data, broken JSON stays .json here
        self.assertEqual(dae.classify_text_extension("{broken"), ".json")

    def test_array_json(self):
        self.assertEqual(dae.classify_text_extension("[1]"), ".json")

    def test_lua(self):
        self.assertEqual(dae.classify_text_extension("local x = 1"), ".lua")

    def test_tsv(self):
        self.assertEqual(dae.classify_text_extension("a\tb\n1\t2"), ".tsv")

    def test_csv(self):
        self.assertEqual(dae.classify_text_extension("a,b\n1,2\n3,4"), ".csv")

    def test_txt(self):
        self.assertEqual(dae.classify_text_extension("hello world"), ".txt")


class TestFindPaths(unittest.TestCase):
    def test_detects_data_dir_and_subpaths(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data = root / "Morimens_Data"
            (data / "StreamingAssets").mkdir(parents=True)
            (data / "il2cpp_data" / "Metadata").mkdir(parents=True)
            paths = dae.find_paths(root)
            self.assertEqual(paths["data_dir"], data)
            self.assertEqual(paths["streaming"], data / "StreamingAssets")
            self.assertTrue(str(paths["metadata"]).endswith("global-metadata.dat"))

    def test_fallback_to_root_when_no_data_dir(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "somefolder").mkdir()
            paths = dae.find_paths(root)
            self.assertEqual(paths["data_dir"], root)


class TestTryBruteForce(unittest.TestCase):
    def test_unencrypted_file_returns_empty_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            ab = Path(d) / "config.ab"
            ab.write_bytes(b"x")
            with mock.patch.object(dae.UnityPy, "load", return_value=_Env([])):
                result = dae.try_brute_force(Path(d) / "meta.dat", ab)
            self.assertEqual(result, b"")

    def test_unexpected_error_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            ab = Path(d) / "config.ab"
            ab.write_bytes(b"x")
            with mock.patch.object(dae.UnityPy, "load", side_effect=RuntimeError("disk failure")):
                result = dae.try_brute_force(Path(d) / "meta.dat", ab)
            self.assertIsNone(result)

    def test_unparseable_signatures_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            ab = Path(d) / "config.ab"
            ab.write_bytes(b"x")
            with mock.patch.object(dae.UnityPy, "load", side_effect=RuntimeError("file is encrypted but no sigs")):
                result = dae.try_brute_force(Path(d) / "meta.dat", ab)
            self.assertIsNone(result)

    def test_key_found_via_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            ab = Path(d) / "config.ab"
            ab.write_bytes(b"x")
            meta = Path(d) / "meta.dat"
            meta.write_bytes(b"metadata")
            err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")
            with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
                 mock.patch.object(dae, "brute_force_key", return_value=b"SECRET") as bfk:
                result = dae.try_brute_force(meta, ab)
            self.assertEqual(result, b"SECRET")
            bfk.assert_called_once()

    def test_metadata_miss_then_all_fallbacks_fail(self):
        with tempfile.TemporaryDirectory() as d:
            ab = Path(d) / "config.ab"
            ab.write_bytes(b"x")
            meta = Path(d) / "meta.dat"
            meta.write_bytes(b"metadata")
            err = RuntimeError("encrypted key_sig=b'aa' data_sig=b'bb'")
            # No GameAssembly/UnityPlayer dlls exist -> brute force returns None
            with mock.patch.object(dae.UnityPy, "load", side_effect=err), \
                 mock.patch.object(dae, "brute_force_key", return_value=None):
                result = dae.try_brute_force(meta, ab)
            self.assertIsNone(result)


class TestExtractWithKey(unittest.TestCase):
    def test_load_failure_records_error(self):
        with tempfile.TemporaryDirectory() as d:
            ab = Path(d) / "x.ab"
            ab.write_bytes(b"x")
            with mock.patch.object(dae.UnityPy, "load", side_effect=RuntimeError("bad bundle")):
                stats = dae.extract_with_key(ab, b"key", Path(d) / "out")
            self.assertEqual(stats["text"], 0)
            self.assertEqual(len(stats["errors"]), 1)

    def test_extracts_text_mono_texture(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            text_obj = _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')
            mono_obj = _fake_obj(ClassIDType.MonoBehaviour, m_Name="Mono1")
            mono_obj.read_typetree.return_value = {"a": 1, "b": 2, "c": 3}
            img = mock.MagicMock()
            img.width, img.height = 128, 128
            tex_obj = _fake_obj(ClassIDType.Texture2D, m_Name="portrait", image=img)
            env = _Env([text_obj, mono_obj, tex_obj])
            with mock.patch.object(dae.UnityPy, "load", return_value=env):
                stats = dae.extract_with_key(Path(d) / "x.ab", b"key", out)
            self.assertEqual(stats["text"], 1)
            self.assertEqual(stats["mono"], 1)
            self.assertEqual(stats["tex"], 1)
            self.assertTrue((out / "text" / "cfg.json").exists())
            self.assertTrue((out / "mono" / "Mono1.json").exists())

    def test_small_texture_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            img = mock.MagicMock()
            img.width, img.height = 32, 32  # below the 64px threshold
            tex_obj = _fake_obj(ClassIDType.Texture2D, m_Name="icon", image=img)
            with mock.patch.object(dae.UnityPy, "load", return_value=_Env([tex_obj])):
                stats = dae.extract_with_key(Path(d) / "x.ab", b"key", Path(d) / "out")
            self.assertEqual(stats["tex"], 0)

    def test_binary_text_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            obj = _fake_obj(ClassIDType.TextAsset, m_Name="x", m_Script=b"\xff\xfe\x81")
            with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
                stats = dae.extract_with_key(Path(d) / "x.ab", b"key", Path(d) / "out")
            self.assertEqual(stats["text"], 0)

    def test_per_object_exception_collected(self):
        with tempfile.TemporaryDirectory() as d:
            obj = mock.MagicMock()
            obj.type = ClassIDType.TextAsset
            obj.read.side_effect = RuntimeError("read fail")
            with mock.patch.object(dae.UnityPy, "load", return_value=_Env([obj])):
                stats = dae.extract_with_key(Path(d) / "x.ab", b"key", Path(d) / "out")
            self.assertEqual(len(stats["errors"]), 1)


if __name__ == "__main__":
    unittest.main()
