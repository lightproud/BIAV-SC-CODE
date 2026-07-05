"""silver_aliases 厚锚别名侧表的单测（零网络、确定性）。

三墙回归：出身牌（每条必带 provenance）/ 可撤回（删条即撤，读取层无状态）/
惰性确认态（confirmed=false 不进 domain_dict、不进 alias_map 默认面）。
防御回归：侧表缺失 / 空 / 损坏一律优雅返空——构建期 import 绝不能炸。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import silver_aliases as sa  # noqa: E402


def _write_table(tmp_path, rows):
    p = tmp_path / "aliases.json"
    p.write_text(json.dumps({"_meta": {}, "aliases": rows}, ensure_ascii=False),
                 encoding="utf-8")
    sa.cache_clear()
    return p


# ---------- 防御：缺失 / 空 / 损坏优雅返空 ----------

def test_missing_table_returns_empty(tmp_path):
    sa.cache_clear()
    assert sa.load(tmp_path / "nonexistent.json") == []
    assert sa.confirmed(tmp_path / "nonexistent.json") == []
    assert sa.confirmed_cjk_aliases(tmp_path / "nonexistent.json") == []
    assert sa.alias_map(path=tmp_path / "nonexistent.json") == {}


def test_corrupt_table_returns_empty(tmp_path):
    p = tmp_path / "broken.json"
    p.write_text("{not valid json", encoding="utf-8")
    sa.cache_clear()
    assert sa.load(p) == []


def test_empty_and_malformed_rows_skipped(tmp_path):
    p = _write_table(tmp_path, [
        {"concept_id": "1", "alias": "好名"},          # 合法（未确认）
        {"concept_id": "", "alias": "无主"},            # 缺 concept_id → 跳
        {"concept_id": "2", "alias": ""},               # 空别名 → 跳
        "not-a-dict",                                     # 非 dict → 跳
    ])
    assert [r["alias"] for r in sa.load(p)] == ["好名"]


# ---------- 确认态墙：未确认压权重 ----------

def test_confirmed_filter_and_cjk_gate(tmp_path):
    p = _write_table(tmp_path, [
        {"concept_id": "1", "alias": "融朵", "confirmed": True},
        {"concept_id": "1", "alias": "Ramona", "confirmed": True},   # 拉丁：不进 CJK 词典面
        {"concept_id": "2", "alias": "潘迪娅", "confirmed": False},  # 未确认：全面压下
    ])
    assert len(sa.confirmed(p)) == 2
    assert sa.confirmed_cjk_aliases(p) == ["融朵"]  # 只有 confirmed 且纯 CJK
    assert sa.alias_map(path=p) == {"融朵": "1", "Ramona": "1"}
    assert sa.alias_map(confirmed_only=False, path=p)["潘迪娅"] == "2"


def test_aliases_for_unconfirmed_gate(tmp_path):
    p = _write_table(tmp_path, [
        {"concept_id": "9", "alias": "甲", "confirmed": True},
        {"concept_id": "9", "alias": "乙", "confirmed": False},
    ])
    assert sa.aliases_for("9", path=p) == [{"alias": "甲", "confirmed": True}]
    both = sa.aliases_for("9", include_unconfirmed=True, path=p)
    assert {a["alias"] for a in both} == {"甲", "乙"}


# ---------- 出身牌墙：真实侧表每条必带 provenance ----------

def test_real_table_every_row_has_provenance_walls():
    sa.cache_clear()
    rows = sa.load()
    assert rows, "真实侧表不应为空（chunk3 已落 manual-seed）"
    for r in rows:
        prov = r.get("provenance", {})
        # 出身牌四件套：来源平台 / 档案定位 / 真实引文 / 推断者
        for key in ("source", "ref", "quote", "inferred_by"):
            assert prov.get(key), f"别名 {r['alias']} 缺出身牌字段 {key}"
        assert isinstance(r.get("confirmed"), bool)
        assert r.get("added")


def test_real_table_confirmed_cjk_reaches_domain_dict():
    """已确认纯 CJK 别名须被 silver_tokenizer 领域词典吸收（整词切出，不碎 bigram）。"""
    sa.cache_clear()
    cjk = sa.confirmed_cjk_aliases()
    assert cjk, "真实侧表应含至少一条已确认纯 CJK 别名（融朵）"
    from silver_tokenizer import domain_dict, tokenize
    domain_dict.cache_clear()
    dic, _ = domain_dict()
    for a in cjk:
        assert a in dic, f"已确认 CJK 别名 {a} 未进领域词典"
    assert "融朵" in tokenize("癫狂列车打融朵攻略")
