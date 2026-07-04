"""KB 质性能力回归（评判体系 #4：测 grep 给不了知识的维度）。

守密人 2026-07-04「针对专有能力 grep 还是好用」→ 真相：hit@k 是 grep 主场（只测找文本）。
KB 的真价值在检索之后的结构化知识（层/身份/边界）——grep 结构上给不了。本组断言 KB 在这三个
质性维度上交付、且这是 hit@k 测不出的价值。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_qual  # noqa: E402


def test_kb_delivers_all_qualitative_dimensions():
    rep = kb_qual.evaluate()
    assert rep["dimensions_kb_delivers"] == rep["dimensions_total"] == 3, (
        f"KB 未交付全部质性维度：{rep['dimensions_kb_delivers']}/{rep['dimensions_total']}"
    )
    assert rep["dimensions_grep_delivers"] == 0  # grep 结构上给不了这些


def test_layer_disambiguation_all_platforms():
    """凡同时有全量+抽样概念的平台，KB 都能靠 data_layer 唯一区分（防 lesson #30）。"""
    l = kb_qual.probe_layer_disambiguation()
    assert l["platforms_with_both_layers"] >= 10, "多层平台样本过少"
    assert l["kb_can_disambiguate"] == l["platforms_with_both_layers"], (
        "存在 KB 无法区分全量 vs 抽样的平台"
    )
    assert l["grep_can_disambiguate"] == 0


def test_identity_isolates_one_canonical():
    """每个探测角色名都恰好隔出 1 个 type=character 规范概念（身份消歧）。"""
    i = kb_qual.probe_identity_canonical()
    assert i["kb_isolates_canonical"] == i["names_probed"], "存在未能隔出唯一规范身份的名字"
    for pn in i["per_name"]:
        assert pn["canonical"] == 1, f"{pn['name']} 规范概念数 {pn['canonical']}≠1"


def test_boundary_enumeration_exact():
    """KB 可枚举有界：角色概念数与 characters 层实际一致。"""
    import json
    b = kb_qual.probe_boundary_enumeration()
    concepts = json.loads((REPO / "okf" / "kb_index.json").read_text(encoding="utf-8"))["concepts"]
    actual_chars = sum(1 for c in concepts.values() if c.get("type") == "character")
    assert b["characters_enumerable"] == actual_chars >= 70
    assert b["kb_can_enumerate_bounded"] is True
    assert b["grep_can_enumerate_bounded"] is False


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
