#!/usr/bin/env python3
"""kb_eval.py — 知识库需求侧有效性评分器（北极星评判体系 #1，黄金问题集）。

守密人 2026-07-04「如何追踪评判知识库是否有效」→ 建议 #1：黄金问题集。
本模块把「有效」从一句感觉变成一个**每次可重跑的分数**——对一组真实守密人风格问题，
跑检索原语（kb_search / kb_activate），打分「该被 surface 的概念在 top-k 里吗」（hit@k + MRR）。

**度量的是需求侧有效性**（人要的够到没）——区别于覆盖哨兵的供给侧完备（该有的上架没）。
确定性零 ML（检索原语本身确定性）。黄金集数据在 `tests/kb_golden_questions.json`，随新问题增长。

用法：
  python3 scripts/kb_eval.py              # 打印记分卡（每题 hit/miss + 排名 + top 命中）
  python3 scripts/kb_eval.py --json       # 机读汇总（供遥测/追踪）
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GOLDEN_PATH = REPO / "tests" / "kb_golden_questions.json"
sys.path.insert(0, str(REPO / "scripts"))


def load_golden(path: Path = GOLDEN_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _result_ids(q: str, mode: str, k: int) -> list[str]:
    import kb_navigator as kb

    if mode == "activate":
        r = kb.activate(q, hops=2, limit=k)
        return [a["id"] for a in r.get("activated", [])]
    r = kb.search(q, limit=k)
    return [x["id"] for x in r.get("results", [])]


def evaluate(golden: dict | None = None, k: int | None = None) -> dict:
    """跑黄金集，返回 {hit_rate, mrr, n, hits, per_question:[...]}。"""
    golden = golden or load_golden()
    k = k or golden.get("k", 3)
    per = []
    hits = 0
    rr_sum = 0.0
    for item in golden["questions"]:
        q, expect, mode = item["q"], item["expect"], item.get("mode", "search")
        ids = _result_ids(q, mode, k)
        rank = 0
        for i, rid in enumerate(ids, start=1):
            if any(sub in rid for sub in expect):
                rank = i
                break
        hit = rank > 0
        hits += int(hit)
        rr_sum += (1.0 / rank) if rank else 0.0
        per.append({
            "q": q, "mode": mode, "expect": expect, "hit": hit,
            "rank": rank, "top": ids[0] if ids else None, "probe": item.get("probe", ""),
        })
    n = len(golden["questions"])
    return {
        "n": n, "k": k, "hits": hits,
        "hit_rate": round(hits / n, 4) if n else 0.0,
        "mrr": round(rr_sum / n, 4) if n else 0.0,
        "min_hit_rate": golden.get("min_hit_rate", 0.0),
        "per_question": per,
    }


def _print_scorecard(rep: dict) -> None:
    print(f"KB 需求侧有效性记分卡（黄金问题集，hit@{rep['k']}）")
    print(f"  hit_rate = {rep['hit_rate']:.2f}  ({rep['hits']}/{rep['n']})   MRR = {rep['mrr']:.3f}"
          f"   门槛 = {rep['min_hit_rate']:.2f}")
    print("  " + "-" * 66)
    for p in rep["per_question"]:
        mark = "OK " if p["hit"] else "MISS"
        rank = f"@{p['rank']}" if p["rank"] else "  "
        print(f"  [{mark}]{rank:>3} {p['q'][:24]:24s} -> {p['top'] or '（零命中）'}")
    misses = [p["q"] for p in rep["per_question"] if not p["hit"]]
    if misses:
        print("  " + "-" * 66)
        print(f"  缺口（改进目标，{len(misses)}）：" + " / ".join(misses))


def main() -> None:
    ap = argparse.ArgumentParser(description="知识库黄金问题集评分器")
    ap.add_argument("--json", action="store_true", help="输出机读汇总")
    args = ap.parse_args()
    rep = evaluate()
    if args.json:
        print(json.dumps({k: v for k, v in rep.items() if k != "per_question"},
                         ensure_ascii=False))
    else:
        _print_scorecard(rep)


if __name__ == "__main__":
    main()
