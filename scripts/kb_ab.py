#!/usr/bin/env python3
"""kb_ab.py — 知识库 vs 朴素搜索 反事实 A/B（北极星评判体系 #3）。

守密人 2026-07-04「如何追踪评判知识库是否有效」→ 建议 #3：反事实（金标准）。

**诚实边界**：真·反事实（LLM 用 KB vs 不用 KB **答题质量**）需 LLM+裁判在环，做不成确定性
pytest——那部分留**人工协议**（见 `docs/` 或 project-status，用本黄金集作题库，人工/裁判会话跑）。
本模块做**可确定性复现的检索层反事实**：同语料（okf 概念）、同目标（黄金集），比
- **A 臂（KB）**：结构化检索（kb_search 倒排+加权+tier / kb_activate 扩散激活）
- **B 臂（朴素 grep 基线）**：把问题分词后在概念正文里数 token 命中、按次数排序取 top-k
——隔离出「KB 的检索机器相对朴素 grep 到底赢在哪」。

预期（正是北极星那句「OKF ≠ 搜索」的数据验证）：**纯关键词题上 KB ≈ grep**（都在做词匹配，
KB 不显著胜——纯查串确实 ripgrep 就够）；**联想/结构题（activate 模式）上 KB 胜**（grep 无从遍历）。
即 KB 的价值不在关键词排名，在 grep **结构上做不到**的联想召回与跨层结构。

用法：
  python3 scripts/kb_ab.py            # 打印 A/B 对照表
  python3 scripts/kb_ab.py --json      # 机读汇总
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
RESERVED = {"index.md", "log.md"}
sys.path.insert(0, str(REPO / "scripts"))


def _concept_bodies() -> dict[str, str]:
    """{concept_id: lowercased full text}，供朴素 grep 基线。"""
    out = {}
    for f in BUNDLE.rglob("*.md"):
        if f.name in RESERVED:
            continue
        out["/" + str(f.relative_to(BUNDLE))] = f.read_text(encoding="utf-8").lower()
    return out


def grep_baseline_strong(question: str, k: int, bodies: dict[str, str]) -> list[str]:
    """**最强 grep 基线**（反稻草人）：把朴素 grep 一切能占的便宜都给足——
    整串短语命中大幅加权（`text.count(整问)`×10）+ 概念 id/标题字段命中加权（×5）+ 逐 token TF。
    用意：即便把文本搜索放到最强，联想/token 脱节题上 KB 仍应严格胜——因为那是**结构**上的差距
    （顺关系边遍历），非文本匹配强弱能补的。KB 赢在这条最强基线上，才彻底堵死「你的 grep 是稻草人」。"""
    from silver_tokenizer import tokenize

    q = question.lower().strip()
    toks = [t for t in dict.fromkeys(tokenize(question)) if t]
    scored = []
    for cid, text in bodies.items():
        score = 0
        if q and q in text:                      # 整串短语命中：grep 能占的最大便宜
            score += 10 * text.count(q)
        cid_l = cid.lower()
        for t in toks:                           # token TF + id/标题字段命中加权
            score += text.count(t)
            if t in cid_l:
                score += 5
        if score:
            scored.append((score, cid))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [cid for _s, cid in scored[:k]]


def grep_baseline(question: str, k: int, bodies: dict[str, str]) -> list[str]:
    """无 KB 时你会怎么做：把问题分词，在概念正文里数命中、按次数排序取 top-k。"""
    from silver_tokenizer import tokenize

    toks = [t for t in dict.fromkeys(tokenize(question)) if t]
    if not toks:
        return []
    scored = []
    for cid, text in bodies.items():
        cnt = sum(text.count(t) for t in toks)
        if cnt:
            scored.append((cnt, cid))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [cid for _c, cid in scored[:k]]


def ab_evaluate(golden: dict | None = None, k: int | None = None) -> dict:
    import kb_eval

    golden = golden or kb_eval.load_golden()
    k = k or golden.get("k", 3)
    bodies = _concept_bodies()

    per = []
    agg = {"kb": 0, "grep": 0, "grep_strong": 0,
           "kb_win": 0, "grep_win": 0, "tie_hit": 0, "both_miss": 0}
    by_mode: dict[str, dict] = {}
    for item in golden["questions"]:
        q, expect, mode = item["q"], item["expect"], item.get("mode", "search")
        a_ids = kb_eval._result_ids(q, mode, k)                 # A 臂：KB
        b_ids = grep_baseline(q, k, bodies)                     # B 臂：朴素 grep
        s_ids = grep_baseline_strong(q, k, bodies)              # C 臂：最强 grep（反稻草人）
        a_hit = any(sub in rid for rid in a_ids for sub in expect)
        b_hit = any(sub in rid for rid in b_ids for sub in expect)
        s_hit = any(sub in rid for rid in s_ids for sub in expect)
        agg["kb"] += int(a_hit)
        agg["grep"] += int(b_hit)
        agg["grep_strong"] += int(s_hit)
        if a_hit and not b_hit:
            verdict = "KB_win"
        elif b_hit and not a_hit:
            verdict = "grep_win"
        elif a_hit and b_hit:
            verdict = "tie_hit"
        else:
            verdict = "both_miss"
        agg[{"KB_win": "kb_win", "grep_win": "grep_win",
             "tie_hit": "tie_hit", "both_miss": "both_miss"}[verdict]] += 1
        m = by_mode.setdefault(mode, {"n": 0, "kb": 0, "grep": 0, "grep_strong": 0})
        m["n"] += 1
        m["kb"] += int(a_hit)
        m["grep"] += int(b_hit)
        m["grep_strong"] += int(s_hit)
        per.append({"q": q, "mode": mode, "verdict": verdict,
                    "kb_hit": a_hit, "grep_hit": b_hit, "grep_strong_hit": s_hit})

    n = len(golden["questions"])
    return {
        "n": n, "k": k,
        "kb_hit_rate": round(agg["kb"] / n, 4) if n else 0.0,
        "grep_hit_rate": round(agg["grep"] / n, 4) if n else 0.0,
        "grep_strong_hit_rate": round(agg["grep_strong"] / n, 4) if n else 0.0,
        "delta": round((agg["kb"] - agg["grep"]) / n, 4) if n else 0.0,
        "delta_strong": round((agg["kb"] - agg["grep_strong"]) / n, 4) if n else 0.0,
        "verdicts": {kk: agg[kk] for kk in ("kb_win", "grep_win", "tie_hit", "both_miss")},
        "by_mode": by_mode,
        "per_question": per,
    }


def _print(rep: dict) -> None:
    print(f"KB vs grep 反事实 A/B（同语料 okf 概念，hit@{rep['k']}）")
    print(f"  KB          hit_rate = {rep['kb_hit_rate']:.2f}")
    print(f"  grep 朴素    hit_rate = {rep['grep_hit_rate']:.2f}   Δ(KB-grep) = {rep['delta']:+.2f}")
    print(f"  grep 最强    hit_rate = {rep['grep_strong_hit_rate']:.2f}   Δ(KB-strong) = {rep['delta_strong']:+.2f}"
          "   ← 反稻草人：grep 放到最强，KB 仍应在联想题胜")
    print(f"  裁决（vs 朴素 grep）：{rep['verdicts']}")
    print("  分模式（KB / grep朴素 / grep最强 命中数）：")
    for mode, m in sorted(rep["by_mode"].items()):
        print(f"    {mode:10s} n={m['n']:2d}  KB={m['kb']}  grep={m['grep']}  strong={m['grep_strong']}"
              + ("   ← 联想/结构题，grep 无从遍历" if mode == "activate" else ""))
    wins = [p["q"] for p in rep["per_question"] if p["verdict"] == "KB_win"]
    if wins:
        print("  KB 独胜（grep 做不到）：" + " / ".join(wins))


def main() -> None:
    ap = argparse.ArgumentParser(description="KB vs 朴素 grep 反事实 A/B")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    rep = ab_evaluate()
    if args.json:
        print(json.dumps({k: v for k, v in rep.items() if k != "per_question"}, ensure_ascii=False))
    else:
        _print(rep)


if __name__ == "__main__":
    main()
