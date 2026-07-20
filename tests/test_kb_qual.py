"""KB 质性能力回归（评判体系 #4：测 grep 给不了知识的维度）。

守密人 2026-07-04「针对专有能力 grep 还是好用」→ 真相：hit@k 是 grep 主场（只测找文本）。
KB 的真价值在检索之后的结构化知识（层/身份/边界/关系类型）——grep 结构上给不了。本组断言 KB 在
这四个质性维度上交付、且这是 hit@k 测不出的价值。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_qual  # noqa: E402


def test_kb_delivers_all_qualitative_dimensions():
    rep = kb_qual.evaluate()
    assert rep["dimensions_kb_delivers"] == rep["dimensions_total"] == 4, (
        f"KB 未交付全部质性维度：{rep['dimensions_kb_delivers']}/{rep['dimensions_total']}"
    )
    assert rep["dimensions_grep_delivers"] == 0  # grep 结构上给不了这些


def test_relation_typing_names_edge_types():
    """类型化关系维度：KB 对图上的边给出关系类型（variant/lore/...），grep 结构上给不了。"""
    r = kb_qual.probe_relation_typing()
    assert r["typed_edges"] >= 100, f"类型化边偏少（{r['typed_edges']}）——图疑退化"
    assert r["distinct_types"] >= 3, "关系类型种类过少"
    assert r["kb_can_type_relations"] is True
    assert r["grep_can_type_relations"] is False
    for rt, ex in r["exemplars"].items():
        assert ex["a"] and ex["b"], f"关系类型 {rt} 缺范例端点"


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


# ---------- CLI 入口 / 报告渲染冒烟（main + _print） ----------

def test_main_prints_four_dimensions(monkeypatch, capsys):
    """main() 默认路径：质性报告四维逐条打印（层/身份/边界/关系类型）。"""
    monkeypatch.setattr(sys, "argv", ["kb_qual.py"])
    kb_qual.main()
    out = capsys.readouterr().out
    assert "KB 质性能力报告" in out
    assert "层判定" in out
    assert "身份" in out
    assert "边界枚举" in out
    assert "类型化关系" in out
    assert "4/4" in out  # KB 交付全部四维


def test_main_json_summary_only(monkeypatch, capsys):
    """--json 机读路径：只输出三项汇总（维度计数），不带四维明细。"""
    import json

    monkeypatch.setattr(sys, "argv", ["kb_qual.py", "--json"])
    kb_qual.main()
    rep = json.loads(capsys.readouterr().out)
    assert set(rep) == {"dimensions_kb_delivers", "dimensions_total",
                        "dimensions_grep_delivers"}
    assert rep["dimensions_kb_delivers"] == rep["dimensions_total"] == 4
    assert rep["dimensions_grep_delivers"] == 0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
