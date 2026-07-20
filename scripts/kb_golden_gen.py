#!/usr/bin/env python3
"""kb_golden_gen.py — 图驱动黄金集自动生成器（评判体系 #1 扩容）。

守密人 2026-07-04「黄金集数量太少」→ 洞察：**白盒图的每条带类型边本身就是一条标准答案**，
所以能从图**自动生成**黄金集——让结构自己给自己出考卷。手写 17 题（distinctive 仅 4）→
自动生成数百题（distinctive 大幅补齐），确定性、自带真值（边即答案）、自动标能力标签。

生成四类：
  - identity：每个角色概念 →「{名}」，expect 该概念（grep 也能，distinctive=false）
  - associative 1 跳：variant/lore 边 (a→b)，activate a、expect b，distinctive=token 脱节
  - associative 2 跳脱节：activate 角色取 top-k 中**与查询零共享字**的邻居（经 mention 边多跳），
    expect 该邻居——**grep 结构上到不了（distinctive=true）**，是 KB 独占价值的规模化题源
  - layer：每个双层平台 →「{平台} 全量档案」，expect full 概念（distinctive=false）

**诚实陷阱（已知）**：从边生成的联想题对 KB 是「送分题」（activate 就是顺那条边走，必中）——
故本集测的是**「KB vs grep 的差距」与「覆盖广度」在规模上稳不稳**，非「刁难 KB」。真·held-out
难题靠遥测零命中回流（评判 #2），两条腿互补：本集管够多够全，遥测管够难够真。

**内存生成、不落 committed 文件**（防 churn）；复用 `kb_eval`/`kb_ab` 打分。

用法：
  python3 scripts/kb_golden_gen.py          # 生成 + 规模化记分卡 + A/B
  python3 scripts/kb_golden_gen.py --json    # 机读汇总
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
sys.path.insert(0, str(REPO / "scripts"))


def _token_disjoint(a: str, b: str) -> bool:
    """两名零共享 2-gram 且互不包含 → grep 一方查不到另一方。"""
    if not a or not b or a in b or b in a:
        return False
    A = {a[i:i + 2] for i in range(len(a) - 1)}
    B = {b[i:i + 2] for i in range(len(b) - 1)}
    return not (A & B)


def generate(k: int = 3, per_seed_disjoint: int = 4) -> dict:
    """从图确定性生成黄金集 dict（schema 同手写集，供 kb_eval/kb_ab 直接消费）。"""
    import kb_navigator as kb

    concepts = json.loads((BUNDLE / "kb_index.json").read_text(encoding="utf-8"))["concepts"]
    graph = json.loads((BUNDLE / "graph.json").read_text(encoding="utf-8"))
    title = lambda cid: concepts.get(cid, {}).get("title", "")
    chars = sorted(cid for cid, c in concepts.items() if c.get("type") == "character")

    seen: set[tuple] = set()
    qs: list[dict] = []

    def add(q, expect, mode, cap, distinctive):
        key = (q, tuple(sorted(expect)), mode)
        if key in seen:
            return
        seen.add(key)
        qs.append({"q": q, "expect": expect, "mode": mode,
                   "capability": cap, "distinctive": distinctive, "generated": True})

    # 1) identity：角色名 → 该角色概念
    for cid in chars:
        t = title(cid)
        if len(t) >= 2:  # 单字名（如「徐」）跳过，避免歧义噪声
            add(t, [cid], "search", "identity", False)

    # 2) associative 1 跳：variant/lore 边
    for e in graph["edges"]:
        if e.get("rel_type") in ("variant", "lore"):
            a, b = e["source"], e["target"]
            for src, tgt in ((a, b), (b, a)):
                if title(src) and title(tgt):
                    add(title(src), [tgt], "activate", "associative",
                        _token_disjoint(title(src), title(tgt)))

    # 3) associative 2 跳 token 脱节：activate top-k 中的脱节邻居（grep 到不了）
    for cid in chars:
        seed = title(cid)
        if len(seed) < 2:
            continue
        hit = 0
        for a in kb.activate(cid, hops=2, limit=k)["activated"]:
            if _token_disjoint(seed, a.get("title", "")):
                add(seed, [a["id"]], "activate", "associative", True)
                hit += 1
                if hit >= per_seed_disjoint:
                    break

    # 4) layer：双层平台 → 全量档案概念
    plat = {}
    for cid, c in concepts.items():
        p = next((t.split(":", 1)[1] for t in c.get("tags", []) if t.startswith("platform:")), None)
        if not p:
            continue
        e = plat.setdefault(p, {"full": [], "output": []})
        if "data_layer:full_archive" in c.get("tags", []):
            e["full"].append(cid)
        if "data_layer:output" in c.get("tags", []):
            e["output"].append(cid)
    for p, e in sorted(plat.items()):
        if e["full"] and e["output"]:
            add(f"{p} 全量档案", [e["full"][0].rsplit("/", 1)[-1].replace(".md", "")],
                "search", "layer_aware", False)

    return {"version": "generated", "k": k, "min_hit_rate": 0.0,
            "min_distinctive_hit_rate": 0.0, "questions": qs}


def report(golden: dict | None = None) -> dict:
    import kb_ab
    import kb_eval

    golden = golden or generate()
    from collections import Counter
    caps = Counter(q["capability"] for q in golden["questions"])
    dist_n = sum(1 for q in golden["questions"] if q["distinctive"])
    ev = kb_eval.evaluate(golden)
    ab = kb_ab.ab_evaluate(golden)
    return {
        "total": len(golden["questions"]),
        "distinctive": dist_n,
        "by_capability": dict(caps.most_common()),
        "kb_hit_rate": ev["hit_rate"],
        "distinctive_hit_rate": ev["distinctive"]["hit_rate"],
        "ab_kb": ab["kb_hit_rate"], "ab_grep": ab["grep_hit_rate"], "ab_delta": ab["delta"],
        "ab_by_mode": ab["by_mode"],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="图驱动黄金集生成器 + 规模化评分")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    rep = report()
    if args.json:
        print(json.dumps(rep, ensure_ascii=False))
        return
    print("图驱动黄金集（规模化，从边自动生成）")
    print(f"  总题 = {rep['total']}   distinctive（grep 到不了）= {rep['distinctive']}")
    print(f"  按能力：{rep['by_capability']}")
    print(f"  KB hit@3 = {rep['kb_hit_rate']:.2f}   ★distinctive = {rep['distinctive_hit_rate']:.2f}")
    print(f"  反事实 A/B：KB {rep['ab_kb']:.2f} vs grep {rep['ab_grep']:.2f}  Δ={rep['ab_delta']:+.2f}")
    for mode, m in sorted(rep["ab_by_mode"].items()):
        print(f"    {mode:10s} n={m['n']:3d}  KB={m['kb']}  grep={m['grep']}")


if __name__ == "__main__":
    main()
