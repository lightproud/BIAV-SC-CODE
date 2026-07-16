"""别名 A/B 铁证——关系腿（守密人 2026-07-05 裁定 3-乙，零网络、跑在已提交 bundle 上）。

**否掉的稻草人**：「grep 找不到别名→角色」不成立——别名一写进概念正文，grep 同篇
逐字命中（kb_search 命中别名靠的也是正文倒排，与 grep 同维度）。
**立的关系腿**：KB 独占的是**图边**——一份只写了黑话别名、通篇没有角色本名的档案，
kb_neighbors / kb_activate 能顺 `提及:{别名}` mention 边跳到角色概念；grep 拿着别名
只能命中同篇，**结构上**给不出「这篇讲的是哪个角色概念」的跳转。

「提及:{别名}」标签本身即证明该 pair 非本名可达：build_graph 先扫本名（names_by_len
在前）、pair_seen 去重——若扫描文本里有本名，边会以 `提及:{本名}` 落下，别名标签
根本轮不到。故断言别名标签边存在 = 断言「只写别名的文档 → 角色」关系腿真实存在。
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_navigator  # noqa: E402
import silver_aliases  # noqa: E402

GRAPH = REPO / "okf" / "graph.json"


def _alias_edges():
    silver_aliases.cache_clear()
    amap = silver_aliases.alias_map(confirmed_only=True)
    g = json.loads(GRAPH.read_text(encoding="utf-8"))
    out = []
    for e in g.get("edges", []):
        rel = e.get("rel", "")
        if e.get("rel_type") == "mention" and rel.startswith("提及:"):
            alias = rel[len("提及:"):]
            if alias in amap:
                assert e["target"] == f"/characters/{amap[alias]}.md", \
                    f"别名边 {alias} 指向错误概念 {e['target']}"
                out.append((alias, e["source"], e["target"]))
    return out


def test_alias_relation_leg_exists():
    """图中须存在 ≥1 条已确认别名的 mention 边（只写别名的档案 → 角色概念）。"""
    edges = _alias_edges()
    assert edges, ("bundle 图中无任何已确认别名边——厚锚关系腿断了"
                   "（先查 aliases.json 是否有 confirmed 条目、再重建 bundle）")


def test_alias_edge_traversable_by_kb_neighbors():
    """从别名档案概念出发，kb_neighbors 一跳可达角色概念——grep 结构上给不出的跳转。"""
    kb_navigator.load_index.cache_clear()
    ok = 0
    for alias, src, target in _alias_edges():
        res = kb_navigator.neighbors(src, limit=200)
        ids = [n["id"] for n in res.get("neighbors", [])]
        assert target in ids, f"别名边 {alias}（{src}）未进 kb_index 邻接表"
        ok += 1
    assert ok >= 1


def test_alias_edge_traversable_by_kb_activate():
    """扩散激活从别名档案概念点亮对应角色（mention 边权重 0.6 传导）。"""
    kb_navigator.load_index.cache_clear()
    alias, src, target = _alias_edges()[0]
    res = kb_navigator.activate(src, hops=1, limit=50)
    lit = [a["id"] for a in res.get("activated", [])]
    assert target in lit, f"activate({src}) 未点亮 {target}（别名 {alias}）"


def test_confirmed_cjk_alias_searchable():
    """已确认 CJK 别名经正文浮出 + 领域词典整词，kb_search 直达角色概念。

    注意这条**不是** KB 独占（grep 同篇也命中别名——正文浮出即同维度）；留它只为
    锁「别名流经白盒」的管线不回退，独占性主张只落在上面的关系腿三测。
    """
    kb_navigator.load_index.cache_clear()
    from silver_tokenizer import domain_dict
    domain_dict.cache_clear()
    res = kb_navigator.search("融朵", limit=3)
    ids = [r["id"] for r in res.get("results", [])]
    assert "/characters/15602.md" in ids, "kb_search 融朵 应命中 熔毁·朵尔"


def test_unconfirmed_alias_builds_no_edge():
    """未确认别名（压权重墙）绝不进图：图中不得有未确认别名的 mention 边。"""
    silver_aliases.cache_clear()
    unconfirmed = {r["alias"] for r in silver_aliases.load()
                   if r.get("confirmed") is not True}
    confirmed = set(silver_aliases.alias_map(confirmed_only=True))
    # 同别名既有确认又有未确认条目时以确认为准，不在本断言范围
    strictly_unconfirmed = unconfirmed - confirmed
    g = json.loads(GRAPH.read_text(encoding="utf-8"))
    bad = [e for e in g.get("edges", [])
           if e.get("rel", "").startswith("提及:")
           and e["rel"][len("提及:"):] in strictly_unconfirmed]
    assert not bad, f"未确认别名漏进了图：{[(e['rel'], e['source']) for e in bad]}"
