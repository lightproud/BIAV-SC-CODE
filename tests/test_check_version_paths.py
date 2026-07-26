"""check_version 落点守卫 —— 「写盘目标不能指向已被裁定删除的层」。

2026-07-26 死手开关首跑数出来的第三条：本脚本每周红一次、**连红 5 周以上无人知**。
根因不在检测逻辑（它当场仍识别出新版本 2.5.3），而在落点——它写
`projects/wiki/data/db/versions.json`，而 `data/db/` 整层已于 **2026-06-15 守密人裁定
删除**（占位数据长期误导引用）。读侧写了优雅降级、写侧没有，于是**看得见敌情、报不出来**。

守两条不变量：
1. 落点必须在**现行数据层** `data/processed/`，且**绝不重建**已被裁定删除的 `data/db/`；
2. 写盘自建父目录——本脚本是 versions.json 的唯一写者，目录不该指望别人替它准备。
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "projects" / "wiki" / "scripts" / "check_version.py"


@pytest.fixture(scope="module")
def cv():
    spec = importlib.util.spec_from_file_location("check_version", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_version"] = module
    spec.loader.exec_module(module)
    return module


def test_write_target_is_the_live_data_layer(cv) -> None:
    assert cv.VERSIONS_PATH.parent.name == "processed", (
        f"落点不在现行数据层: {cv.VERSIONS_PATH}"
    )
    assert cv.META_PATH.parent.name == "processed", f"meta 落点不在现行数据层: {cv.META_PATH}"


def test_the_deleted_layer_is_never_referenced(cv) -> None:
    """2026-06-15 裁定删除的 data/db/ 不得在本脚本任何路径常量里复活。"""
    for name in ("VERSIONS_PATH", "META_PATH", "OUTPUT_PATH"):
        path = str(getattr(cv, name))
        assert "/data/db/" not in path, f"{name} 指向已被裁定删除的 data/db/: {path}"


def test_save_versions_creates_its_own_parent_directory(cv, tmp_path, monkeypatch) -> None:
    """目录不存在时自建——原实现在这里 FileNotFoundError，正是连红 5 周的那一行。"""
    target = tmp_path / "nonexistent" / "versions.json"
    monkeypatch.setattr(cv, "VERSIONS_PATH", target)
    cv.save_versions({"versions": [{"version": "9.9.9"}]})
    assert json.loads(target.read_text(encoding="utf-8"))["versions"][0]["version"] == "9.9.9"


def test_reads_degrade_gracefully_when_files_are_absent(cv, tmp_path, monkeypatch) -> None:
    """读侧本就优雅降级（本次事故中它一直是对的）——锁住，别在修写侧时顺手改坏。"""
    monkeypatch.setattr(cv, "VERSIONS_PATH", tmp_path / "missing.json")
    monkeypatch.setattr(cv, "META_PATH", tmp_path / "missing-meta.json")
    assert cv.load_versions() is not None
    assert cv.load_meta() is not None
