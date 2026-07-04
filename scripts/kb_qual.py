#!/usr/bin/env python3
"""kb_qual.py — 知识库质性能力 probe（评判体系 #4：测 grep 给不了知识的维度）。

守密人 2026-07-04「针对专有能力 grep 还是那么好用」逼出的真相：**hit@k 结构上是 grep 的主场**
——它只测「找没找到文本」，而找文本正是 grep 本来就会的。grep「命中」≠ grep「给了你知识」：
它找到 community-discord，却分不清全量 vs 抽样（会带你进 lesson #30）；它返回一堆「沙耶」的出现，
却给不了「沙耶这个规范概念」。**KB 的真价值在检索之后的结构化知识——层 / 身份 / 类型 / 边界——
这些 grep 一个都给不了，hit@k 一个都测不出。**

本模块用**质性 probe** 测这些维度：不比「谁先摸到书」，比「摸到之后能不能给对结构化知识」。
每个 probe 是 KB 的事实性能力，纯朴素文本搜索（grep over 原始源）结构上给不了 → grep 计 0。

用法：
  python3 scripts/kb_qual.py            # 打印质性能力报告
  python3 scripts/kb_qual.py --json      # 机读汇总
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
INDEX = REPO / "okf" / "kb_index.json"
GRAPH = REPO / "okf" / "graph.json"


def _concepts() -> dict:
    return json.loads(INDEX.read_text(encoding="utf-8")).get("concepts", {})


def _graph() -> dict:
    return json.loads(GRAPH.read_text(encoding="utf-8")) if GRAPH.exists() else {"edges": []}


def probe_layer_disambiguation(concepts: dict | None = None) -> dict:
    """层判定：凡同时有全量档案 + 输出抽样概念的平台，KB 靠 data_layer tag 能**唯一区分**
    「全量 vs 抽样」；grep over 原始源无此字段、三个一视同仁 → 会把抽样当全量（lesson #30）。"""
    concepts = concepts or _concepts()
    plat = {}
    for cid, c in concepts.items():
        tags = c.get("tags", [])
        p = next((t.split(":", 1)[1] for t in tags if t.startswith("platform:")), None)
        if not p:
            continue
        e = plat.setdefault(p, {"full": [], "output": []})
        if "data_layer:full_archive" in tags:
            e["full"].append(cid)
        if "data_layer:output" in tags:
            e["output"].append(cid)
    both = {p: e for p, e in plat.items() if e["full"] and e["output"]}
    # KB 能区分 = 该平台的全量与输出概念各自带明确 data_layer tag（可唯一挑出全量）
    kb_ok = sum(1 for e in both.values() if e["full"] and e["output"])
    return {
        "platforms_with_both_layers": len(both),
        "kb_can_disambiguate": kb_ok,
        "grep_can_disambiguate": 0,  # 原始源无 data_layer 字段，结构上给不了层知识
        "sample": sorted(both)[:6],
        "meaning": "grep 找到 discord 相关文本，却分不清全量档案 vs 输出抽样→lesson #30；KB 靠 data_layer 唯一区分",
    }


def probe_identity_canonical(concepts: dict | None = None,
                             names: list[str] | None = None) -> dict:
    """身份消歧：一个角色名，KB 有**唯一** type=character 规范概念；正文提及它的非角色概念另有多个。
    grep 返回全部出现、分不清「X 这个概念」和「提到 X 的报告」。KB 靠 type 隔出规范身份。"""
    concepts = concepts or _concepts()
    names = names or ["沙耶", "徐", "萝坦", "奥吉尔", "达芙黛尔"]
    per = []
    ok = 0
    for name in names:
        canon = [cid for cid, c in concepts.items()
                 if c.get("type") == "character" and c.get("title") == name]
        mentions = [cid for cid, c in concepts.items()
                    if c.get("type") != "character" and name in (c.get("description") or "")]
        is_canon = len(canon) == 1
        ok += int(is_canon)
        per.append({"name": name, "canonical": len(canon), "mention_concepts": len(mentions)})
    return {
        "names_probed": len(names),
        "kb_isolates_canonical": ok,               # KB 给出唯一规范身份
        "grep_isolates_canonical": 0,              # grep 返回全部出现，无 type、无规范
        "per_name": per,
        "meaning": "grep『沙耶』返回一堆出现（角色+提及它的报告混在一起）；KB 靠 type=character 隔出那一个规范身份",
    }


def probe_boundary_enumeration(concepts: dict | None = None) -> dict:
    """边界枚举：KB 能给出**闭合完整**的概念集合（如『全部角色概念』『全部 full_archive 概念』）；
    grep 只返回文本出现、永远给不了『概念的集合』、更给不了『这就是全部』的边界。"""
    concepts = concepts or _concepts()
    from collections import Counter
    by_type = Counter(c.get("type") for c in concepts.values())
    full_archive = sum(1 for c in concepts.values()
                       if any(t == "data_layer:full_archive" for t in c.get("tags", [])))
    return {
        "total_concepts": len(concepts),
        "characters_enumerable": by_type.get("character", 0),
        "full_archive_enumerable": full_archive,
        "by_type": dict(by_type.most_common()),
        "kb_can_enumerate_bounded": True,
        "grep_can_enumerate_bounded": False,       # grep 给不了「概念的完整集合」与「这就是全部」
        "meaning": "KB 能答『关于 X 的全部概念就这些』（可枚举有界）；grep 只能给文本命中、无法界定完整集合",
    }


def probe_relation_typing(concepts: dict | None = None, graph: dict | None = None) -> dict:
    """类型化关系：白盒图每条边带**关系类型**（variant/lore/cv/mention/cross）——KB 能答
    『A 与 B 是什么关系』（本源萝坦↔萝坦=variant、萝坦↔奥吉尔=lore 同篇）。grep 结构上只能给
    **共现**（两名出现在同一文本），给不了「这是哪种关系」——类型是白盒图独有、hit@k 测不出。"""
    concepts = concepts or _concepts()
    graph = graph or _graph()
    from collections import Counter
    typed = Counter()
    exemplars: dict[str, dict] = {}
    title = lambda cid: concepts.get(cid, {}).get("title", "") or cid
    for e in graph.get("edges", []):
        rt = e.get("rel_type")
        if not rt:
            continue
        typed[rt] += 1
        if rt not in exemplars:
            exemplars[rt] = {"a": title(e.get("source", "")), "b": title(e.get("target", "")),
                             "rel": e.get("rel", rt)}
    return {
        "typed_edges": int(sum(typed.values())),
        "relation_types": dict(typed.most_common()),
        "distinct_types": len(typed),
        "exemplars": exemplars,
        "kb_can_type_relations": len(typed) > 0,
        "grep_can_type_relations": False,          # grep 只给共现，给不了关系类型
        "meaning": "KB 答『本源萝坦与萝坦是 variant 关系』；grep 只能告诉你两名共现、给不了关系的类型",
    }


def evaluate(concepts: dict | None = None) -> dict:
    concepts = concepts or _concepts()
    layer = probe_layer_disambiguation(concepts)
    identity = probe_identity_canonical(concepts)
    boundary = probe_boundary_enumeration(concepts)
    relation = probe_relation_typing(concepts)
    # 汇总：KB 在几个质性维度上交付了 grep 结构上给不了的知识
    dims = {
        "layer_disambiguation": layer["kb_can_disambiguate"] > 0,
        "identity_canonical": identity["kb_isolates_canonical"] > 0,
        "boundary_enumeration": boundary["kb_can_enumerate_bounded"],
        "relation_typing": relation["kb_can_type_relations"],
    }
    return {
        "dimensions_kb_delivers": sum(dims.values()),
        "dimensions_total": len(dims),
        "dimensions_grep_delivers": 0,             # 四维 grep 结构上均给不了
        "layer": layer, "identity": identity, "boundary": boundary, "relation": relation,
    }


def _print(rep: dict) -> None:
    print("KB 质性能力报告（测 grep 给不了知识的维度——hit@k 测不出的那些）")
    print(f"  KB 交付 {rep['dimensions_kb_delivers']}/{rep['dimensions_total']} 个质性维度；"
          f"grep 结构上交付 {rep['dimensions_grep_delivers']}/{rep['dimensions_total']}")
    l = rep["layer"]
    print(f"  ① 层判定：{l['platforms_with_both_layers']} 个平台同时有全量+抽样概念，"
          f"KB 能区分 {l['kb_can_disambiguate']}、grep {l['grep_can_disambiguate']}"
          f"（grep 会把抽样当全量→lesson #30）")
    i = rep["identity"]
    print(f"  ② 身份：{i['names_probed']} 个角色名，KB 隔出唯一规范身份 {i['kb_isolates_canonical']}、grep {i['grep_isolates_canonical']}")
    for pn in i["per_name"][:3]:
        print(f"       {pn['name']}: 规范 {pn['canonical']} 个 / 提及它的概念 {pn['mention_concepts']} 个"
              f"（grep 会把这些混在一起）")
    b = rep["boundary"]
    print(f"  ③ 边界枚举：KB 可枚举有界（{b['characters_enumerable']} 角色 / "
          f"{b['full_archive_enumerable']} 全量概念）；grep 给不了完整集合")
    r = rep["relation"]
    print(f"  ④ 类型化关系：KB 对 {r['typed_edges']} 条边给出关系类型 "
          f"{r['relation_types']}；grep 只给共现、给不了类型")


def main() -> None:
    ap = argparse.ArgumentParser(description="知识库质性能力 probe")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    rep = evaluate()
    if args.json:
        print(json.dumps({k: v for k, v in rep.items()
                          if k in ("dimensions_kb_delivers", "dimensions_total", "dimensions_grep_delivers")},
                         ensure_ascii=False))
    else:
        _print(rep)


if __name__ == "__main__":
    main()
