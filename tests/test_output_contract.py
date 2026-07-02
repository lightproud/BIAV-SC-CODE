"""输出层契约测试（P2-9，2026-07-02）。

{source}-latest.json 是银芯→黑池的正式接口面。此前口径全靠默契——本测试把
契约锁进 schema（projects/news/schema/output-latest.schema.json）：
1) 合成往返：split_output.write_source_file 产出的包裹必须过 v1 契约；
2) 实盘抽检：仓内现存 *-latest.json 逐个过契约（contract_version 字段
   2026-07-02 起才有，存量文件放宽为 required 校验，待下轮采集覆盖后收紧）。
"""

import json
import sys
from pathlib import Path

import pytest

jsonschema = pytest.importorskip("jsonschema")

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "projects" / "news" / "scripts"))

import split_output  # noqa: E402

SCHEMA = json.loads(
    (REPO / "projects" / "news" / "schema" / "output-latest.schema.json")
    .read_text(encoding="utf-8"))


def _validate(payload, *, legacy: bool = False):
    schema = SCHEMA
    if legacy:
        # 存量文件尚无 contract_version（写方 2026-07-02 起才盖章）——仅放宽该项
        schema = dict(SCHEMA)
        schema["properties"] = dict(SCHEMA["properties"])
        schema["properties"]["contract_version"] = {"type": "integer"}
    jsonschema.validate(instance=payload, schema=schema)


def test_writer_output_passes_contract(tmp_path, monkeypatch):
    """合成往返：写方产物必须过 v1 契约。"""
    monkeypatch.setattr(split_output, "OUTPUT_DIR", tmp_path)
    items = [{"source": "bilibili", "time": "2026-07-02T00:00:00+00:00",
              "lang": "zh", "title": "t", "summary": "s", "url": "https://x.co",
              "author": "a", "engagement": 3}]
    split_output.write_source_file("bilibili", items, "2026-07-02T00:00:00+00:00")
    payload = json.loads((tmp_path / "bilibili-latest.json").read_text(encoding="utf-8"))
    _validate(payload)
    assert payload["contract_version"] == 1
    assert payload["item_count"] == 1


def test_writer_empty_source_passes_contract(tmp_path, monkeypatch):
    monkeypatch.setattr(split_output, "OUTPUT_DIR", tmp_path)
    split_output.write_source_file("weibo", [], "2026-07-02T00:00:00+00:00")
    _validate(json.loads((tmp_path / "weibo-latest.json").read_text(encoding="utf-8")))


def _real_latest_files():
    out = REPO / "projects" / "news" / "output"
    if not out.exists():
        return []
    skip = {"all-latest.json"}  # 合并文件同构，单独一条用例
    return sorted(p for p in out.glob("*-latest.json") if p.name not in skip)


@pytest.mark.parametrize("path", _real_latest_files(),
                         ids=lambda p: p.name)
def test_real_output_files_pass_contract(path: Path):
    """实盘抽检：现存输出文件不得偏离契约（sparse 环境无 output/ 时自动零参数）。"""
    payload = json.loads(path.read_text(encoding="utf-8"))
    _validate(payload, legacy="contract_version" not in payload)


def test_real_all_latest_passes_contract():
    p = REPO / "projects" / "news" / "output" / "all-latest.json"
    if not p.exists():
        pytest.skip("all-latest.json absent")
    payload = json.loads(p.read_text(encoding="utf-8"))
    _validate(payload, legacy="contract_version" not in payload)
