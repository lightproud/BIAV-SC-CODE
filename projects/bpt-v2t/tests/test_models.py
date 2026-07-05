"""模型管理验证:清单结构、路径解析、缓存覆盖、缺文件报错。云端可跑(不下载)。"""
import pytest

from bpt_v2t import models


def test_manifest_structure():
    assert models.DEFAULT_MODEL_ID in models.MODELS
    for mid, spec in models.MODELS.items():
        assert spec["archive_url"].startswith("https://")
        assert "root" in spec
        assert set(spec["globs"]) == {"tokens", "encoder", "decoder", "joiner"}
        assert spec["modeling_unit"] == "cjkchar"


def test_unknown_model_id_raises():
    with pytest.raises(ValueError):
        models.resolve("nonesuch")


def test_cache_root_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("BPT_V2T_MODEL_DIR", str(tmp_path))
    assert models.cache_root() == tmp_path


def test_resolve_missing_dir_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("BPT_V2T_MODEL_DIR", str(tmp_path))
    with pytest.raises(FileNotFoundError):
        models.resolve(models.DEFAULT_MODEL_ID)


def test_resolve_finds_files_and_prefers_non_int8(monkeypatch, tmp_path):
    monkeypatch.setenv("BPT_V2T_MODEL_DIR", str(tmp_path))
    base = models.model_dir(models.DEFAULT_MODEL_ID)
    base.mkdir(parents=True)
    (base / "tokens.txt").write_text("x")
    (base / "encoder-epoch-99-avg-1.int8.onnx").write_text("x")
    (base / "encoder-epoch-99-avg-1.onnx").write_text("x")  # 非 int8 优先
    (base / "decoder-epoch-99-avg-1.onnx").write_text("x")
    (base / "joiner-epoch-99-avg-1.onnx").write_text("x")
    paths = models.resolve(models.DEFAULT_MODEL_ID)
    assert paths["tokens"].endswith("tokens.txt")
    assert paths["encoder"].endswith("encoder-epoch-99-avg-1.onnx")
    assert "int8" not in paths["encoder"]
    assert paths["modeling_unit"] == "cjkchar"


def test_resolve_incomplete_dir_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("BPT_V2T_MODEL_DIR", str(tmp_path))
    base = models.model_dir(models.DEFAULT_MODEL_ID)
    base.mkdir(parents=True)
    (base / "tokens.txt").write_text("x")  # 缺 encoder/decoder/joiner
    with pytest.raises(FileNotFoundError):
        models.resolve(models.DEFAULT_MODEL_ID)
