"""Unit tests for the wiki client-data extractor (mission #2 self-bootstrap).

The module imports UnityPy at top level and ``sys.exit(1)`` if it is missing,
so we inject lightweight stubs into ``sys.modules`` before importing. No real
UnityPy / PIL / client files are touched; all I/O runs through tempfile.
"""

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "projects" / "wiki" / "scripts"
sys.path.insert(0, str(SCRIPTS))


# --- stub UnityPy + UnityPy.enums so the module imports without the real lib ---
def _install_unitypy_stub():
    if "UnityPy" in sys.modules:
        return

    class _ClassIDType:
        # The module only references these three names.
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
    """Build a fake UnityPy object whose .read() returns an attr bag."""
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


class TestClassifyTextExtension(unittest.TestCase):
    def test_valid_json_object(self):
        self.assertEqual(ecd.classify_text_extension('{"a": 1}'), ".json")

    def test_valid_json_array(self):
        self.assertEqual(ecd.classify_text_extension("[1, 2, 3]"), ".json")

    def test_invalid_json_falls_back_to_txt(self):
        self.assertEqual(ecd.classify_text_extension('{not valid,}'), ".txt")

    def test_invalid_json_kept_as_json_when_not_validating(self):
        self.assertEqual(
            ecd.classify_text_extension("{broken", validate_json=False), ".json"
        )

    def test_lua_comment(self):
        self.assertEqual(ecd.classify_text_extension("-- a lua file"), ".lua")

    def test_lua_function_keyword(self):
        self.assertEqual(ecd.classify_text_extension("x = 1\nfunction foo() end"), ".lua")

    def test_lua_local_keyword(self):
        self.assertEqual(ecd.classify_text_extension("local t = {}"), ".lua")

    def test_tsv_first_line_tab(self):
        self.assertEqual(ecd.classify_text_extension("a\tb\tc\n1\t2\t3"), ".tsv")

    def test_csv_needs_comma_and_multiple_lines(self):
        self.assertEqual(ecd.classify_text_extension("a,b,c\n1,2,3\n4,5,6"), ".csv")

    def test_single_comma_line_is_txt(self):
        # Comma present but only one newline -> not enough lines for CSV
        self.assertEqual(ecd.classify_text_extension("a,b,c"), ".txt")

    def test_plain_text(self):
        self.assertEqual(ecd.classify_text_extension("just some prose"), ".txt")


class TestDecodeScript(unittest.TestCase):
    def test_str_passthrough(self):
        self.assertEqual(ecd.decode_script("already text"), "already text")

    def test_utf8_bytes(self):
        self.assertEqual(ecd.decode_script("héllo".encode("utf-8")), "héllo")

    def test_bom_decoded_via_utf8_keeps_bom(self):
        # utf-8 succeeds on a BOM (never raises), so the BOM is preserved;
        # the utf-8-sig branch only triggers when utf-8 itself fails.
        self.assertEqual(ecd.decode_script("hi".encode("utf-8-sig")), "﻿hi")

    def test_undecodable_returns_none_and_counts(self):
        stats = {"binary_skipped": 0}
        self.assertIsNone(ecd.decode_script(b"\xff\xfe\x00\x80\x81", stats))
        self.assertEqual(stats["binary_skipped"], 1)

    def test_undecodable_without_stats(self):
        self.assertIsNone(ecd.decode_script(b"\xff\xfe\x81"))


class TestClassifyJsonFile(unittest.TestCase):
    def test_name_character(self):
        self.assertEqual(ecd.classify_json_file("HeroConfig", {}), "characters")

    def test_name_skill(self):
        self.assertEqual(ecd.classify_json_file("AbilityTable", {}), "skills")

    def test_name_equipment(self):
        self.assertEqual(ecd.classify_json_file("covenant_data", {}), "equipment")

    def test_name_stage(self):
        self.assertEqual(ecd.classify_json_file("DungeonMap", {}), "stages")

    def test_name_localization(self):
        self.assertEqual(ecd.classify_json_file("lang_en", {}), "localization")

    def test_content_character_by_stats_keys(self):
        data = [{"hp": 100, "atk": 20}]
        self.assertEqual(ecd.classify_json_file("misc01", data), "characters")

    def test_content_skill_by_keys(self):
        data = [{"cost": 3, "effect": "burn"}]
        self.assertEqual(ecd.classify_json_file("misc02", data), "skills")

    def test_unmapped(self):
        self.assertEqual(ecd.classify_json_file("randomstuff", {"foo": "bar"}), "unmapped")

    def test_empty_list_is_unmapped(self):
        self.assertEqual(ecd.classify_json_file("randomstuff", []), "unmapped")

    def test_name_priority_over_content(self):
        # Name 'hero' wins even though content looks like a skill table
        data = [{"cost": 1}]
        self.assertEqual(ecd.classify_json_file("hero_skills", data), "characters")


class TestFindAssetFiles(unittest.TestCase):
    def test_classifies_streaming_files(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            sa = root / "StreamingAssets"
            sa.mkdir()
            (sa / "config.json").write_text("{}", encoding="utf-8")   # direct
            (sa / "data.bundle").write_bytes(b"x")                    # unity
            (sa / "audio.wem").write_bytes(b"x")                      # skipped
            (sa / "noext").write_bytes(b"x")                          # extensionless -> unity
            unity, direct = ecd.find_asset_files(root)
            unity_names = {p.name for p in unity}
            direct_names = {p.name for p in direct}
            self.assertIn("data.bundle", unity_names)
            self.assertIn("noext", unity_names)
            self.assertIn("config.json", direct_names)
            self.assertNotIn("audio.wem", unity_names | direct_names)

    def test_top_level_assets_pattern(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "resources.assets").write_bytes(b"x")
            unity, direct = ecd.find_asset_files(root)
            self.assertIn("resources.assets", {p.name for p in unity})

    def test_unknown_small_extension_treated_as_unity(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            sa = root / "StreamingAssets"
            sa.mkdir()
            (sa / "thing.xyz").write_bytes(b"small")
            unity, _ = ecd.find_asset_files(root)
            self.assertIn("thing.xyz", {p.name for p in unity})

    def test_dedup_and_sorted(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "a.assets").write_bytes(b"x")
            (root / "b.assets").write_bytes(b"x")
            unity, _ = ecd.find_asset_files(root)
            names = [p.name for p in unity]
            self.assertEqual(names, sorted(names))
            self.assertEqual(len(names), len(set(names)))


class TestCopyDirectFiles(unittest.TestCase):
    def test_copies_preserving_relative_layout(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "game"
            (root / "StreamingAssets").mkdir(parents=True)
            src = root / "StreamingAssets" / "cfg.json"
            src.write_text("{}", encoding="utf-8")
            out = Path(d) / "out"
            stats = ecd.copy_direct_files([src], root, out)
            self.assertEqual(stats["direct_copied"], 1)
            self.assertEqual(stats["direct_errors"], [])
            self.assertTrue((out / "text" / "raw" / "StreamingAssets" / "cfg.json").exists())

    def test_missing_source_recorded_as_error(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            out = Path(d) / "out"
            stats = ecd.copy_direct_files([root / "nope.json"], root, out)
            self.assertEqual(stats["direct_copied"], 0)
            self.assertEqual(len(stats["direct_errors"]), 1)


class TestExtractTextAssets(unittest.TestCase):
    def _stats(self):
        return {"text_assets": 0, "json_files": 0, "binary_skipped": 0, "errors": []}

    def test_writes_json_and_lua(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            env = _Env([
                _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}'),
                _fake_obj(ClassIDType.TextAsset, m_Name="script", m_Script="-- lua"),
            ])
            stats = self._stats()
            ecd.extract_text_assets(env, out, stats)
            self.assertEqual(stats["text_assets"], 2)
            self.assertEqual(stats["json_files"], 1)
            self.assertEqual(stats["lua_files"], 1)
            self.assertTrue((out / "text" / "cfg.json").exists())
            self.assertTrue((out / "text" / "script.lua").exists())

    def test_binary_script_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            env = _Env([_fake_obj(ClassIDType.TextAsset, m_Name="x", m_Script=b"\xff\xfe\x81")])
            stats = self._stats()
            ecd.extract_text_assets(env, Path(d), stats)
            self.assertEqual(stats["binary_skipped"], 1)
            self.assertEqual(stats["text_assets"], 0)

    def test_too_short_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            env = _Env([_fake_obj(ClassIDType.TextAsset, m_Name="x", m_Script="a")])
            stats = self._stats()
            ecd.extract_text_assets(env, Path(d), stats)
            self.assertEqual(stats["text_assets"], 0)

    def test_non_textasset_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            env = _Env([_fake_obj(ClassIDType.Texture2D, m_Name="img")])
            stats = self._stats()
            ecd.extract_text_assets(env, Path(d), stats)
            self.assertEqual(stats["text_assets"], 0)

    def test_read_exception_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            obj = mock.MagicMock()
            obj.type = ClassIDType.TextAsset
            obj.read.side_effect = RuntimeError("boom")
            stats = self._stats()
            ecd.extract_text_assets(_Env([obj]), Path(d), stats)
            self.assertEqual(len(stats["errors"]), 1)
            self.assertIn("TextAsset", stats["errors"][0])


class TestExtractMonobehaviours(unittest.TestCase):
    def test_writes_typetree_json(self):
        with tempfile.TemporaryDirectory() as d:
            obj = _fake_obj(ClassIDType.MonoBehaviour, m_Name="Mono1")
            obj.read_typetree.return_value = {"a": 1, "b": 2, "c": 3}
            stats = {"mono_assets": 0, "errors": []}
            ecd.extract_monobehaviours(_Env([obj]), Path(d), stats)
            self.assertEqual(stats["mono_assets"], 1)
            self.assertTrue((Path(d) / "mono" / "Mono1.json").exists())

    def test_small_tree_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            obj = _fake_obj(ClassIDType.MonoBehaviour, m_Name="Mono1")
            obj.read_typetree.return_value = {"a": 1}  # len <= 2
            stats = {"mono_assets": 0, "errors": []}
            ecd.extract_monobehaviours(_Env([obj]), Path(d), stats)
            self.assertEqual(stats["mono_assets"], 0)

    def test_no_name_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            obj = _fake_obj(ClassIDType.MonoBehaviour, m_Name=None)
            stats = {"mono_assets": 0, "errors": []}
            ecd.extract_monobehaviours(_Env([obj]), Path(d), stats)
            self.assertEqual(stats["mono_assets"], 0)

    def test_typetree_exception_swallowed(self):
        with tempfile.TemporaryDirectory() as d:
            obj = _fake_obj(ClassIDType.MonoBehaviour, m_Name="Mono1")
            obj.read_typetree.side_effect = RuntimeError("il2cpp")
            stats = {"mono_assets": 0, "errors": []}
            ecd.extract_monobehaviours(_Env([obj]), Path(d), stats)
            self.assertEqual(stats["mono_assets"], 0)
            self.assertEqual(stats["errors"], [])


class TestExtractTextures(unittest.TestCase):
    def _img(self, w, h):
        img = mock.MagicMock()
        img.width, img.height = w, h
        return img

    def test_no_pil_short_circuits(self):
        with mock.patch.object(ecd, "HAS_PIL", False):
            stats = {"textures": 0, "errors": []}
            ecd.extract_textures(_Env([1, 2, 3]), Path("/tmp"), stats)
            self.assertEqual(stats["textures"], 0)

    def test_saves_large_texture(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(ecd, "HAS_PIL", True):
            obj = _fake_obj(ClassIDType.Texture2D, m_Name="portrait", image=self._img(128, 128))
            stats = {"textures": 0, "errors": []}
            ecd.extract_textures(_Env([obj]), Path(d), stats)
            self.assertEqual(stats["textures"], 1)
            obj.read.return_value.image.save.assert_called_once()

    def test_tiny_texture_skipped(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(ecd, "HAS_PIL", True):
            obj = _fake_obj(ClassIDType.Texture2D, m_Name="icon", image=self._img(16, 16))
            stats = {"textures": 0, "errors": []}
            ecd.extract_textures(_Env([obj]), Path(d), stats)
            self.assertEqual(stats["textures"], 0)

    def test_name_filter_excludes_nonmatching(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(ecd, "HAS_PIL", True):
            obj = _fake_obj(ClassIDType.Texture2D, m_Name="background", image=self._img(256, 256))
            stats = {"textures": 0, "errors": []}
            ecd.extract_textures(_Env([obj]), Path(d), stats, name_filter="portrait,avatar")
            self.assertEqual(stats["textures"], 0)


class TestExtractSingleFile(unittest.TestCase):
    def test_success_path_aggregates(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "game"
            root.mkdir()
            af = root / "data.assets"
            af.write_bytes(b"x")
            obj = _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')
            obj.type = ClassIDType.TextAsset
            env = _Env([obj])
            with mock.patch.object(ecd.UnityPy, "load", return_value=env):
                stats = ecd._extract_single_file(af, root, Path(d) / "out", False, None)
            self.assertEqual(stats["asset_files_scanned"], 1)
            self.assertEqual(stats["text_assets"], 1)
            self.assertIn("TextAsset", stats["object_types"])

    def test_load_failure_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            af = root / "broken.assets"
            af.write_bytes(b"x")
            with mock.patch.object(ecd.UnityPy, "load", side_effect=RuntimeError("bad")):
                stats = ecd._extract_single_file(af, root, Path(d) / "out", False, None)
            self.assertEqual(stats["asset_files_failed"], 1)
            self.assertEqual(len(stats["errors"]), 1)


class TestScanAndExtract(unittest.TestCase):
    def test_no_unity_files_returns_base_stats(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "game"
            root.mkdir()
            stats = ecd.scan_and_extract(root, Path(d) / "out")
            self.assertEqual(stats["asset_files_scanned"], 0)

    def test_sequential_single_file(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "game"
            root.mkdir()
            (root / "data.assets").write_bytes(b"x")
            obj = _fake_obj(ClassIDType.TextAsset, m_Name="cfg", m_Script='{"a":1}')
            with mock.patch.object(ecd.UnityPy, "load", return_value=_Env([obj])):
                stats = ecd.scan_and_extract(root, Path(d) / "out", workers=1)
            self.assertEqual(stats["asset_files_scanned"], 1)
            self.assertEqual(stats["text_assets"], 1)


class TestMapToWikiSchema(unittest.TestCase):
    def test_missing_text_dir_returns_base(self):
        with tempfile.TemporaryDirectory() as d:
            res = ecd.map_to_wiki_schema(Path(d))
            self.assertEqual(res["mapped"], 0)

    def test_classifies_files_into_buckets(self):
        with tempfile.TemporaryDirectory() as d:
            text = Path(d) / "text"
            text.mkdir()
            (text / "HeroConfig.json").write_text("[]", encoding="utf-8")
            (text / "lang_en.json").write_text('{"hi": "hello"}', encoding="utf-8")
            (text / "mystery.json").write_text('{"foo": 1}', encoding="utf-8")
            (text / "broken.json").write_text("{not json", encoding="utf-8")
            res = ecd.map_to_wiki_schema(Path(d))
            self.assertEqual([c["file"] for c in res["characters"]], ["HeroConfig.json"])
            self.assertIn("lang_en.json", res["localization"])
            self.assertEqual(len(res["unmapped_files"]), 1)
            self.assertEqual(res["unmapped_files"][0]["file"], "mystery.json")
            # broken.json fails to parse and is skipped entirely
            self.assertEqual(res["mapped"], 2)


if __name__ == "__main__":
    unittest.main()
