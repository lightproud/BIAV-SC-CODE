"""kb_semantic_ab.py — 向量腿语义铁证 harness（paraphrase-recall，§八「厚锚撑向量」）。

守密人 2026-07-05 裁定(A) 解除零 ML 红线后，向量腿要证明它**真值回票价**：
换了说法 / 零共享 token 的查询，向量能召回目标消息，而 grep 与白盒脊柱（kb_activate）
结构上都到不了——这是 §八 8.3 承认的「既无本名、别名又没覆盖的纯散句」残差，正是向量独占。

**为什么不扩 kb_ab 四臂**：kb_ab 的目标空间是 OKF **概念**（expect=concept id），向量腿召回的是
长尾**消息**——两个不同目标空间，混一个 harness 里 hit 语义不清。故本 harness 独立，只共享
kb_ab 的 grep 打分零件与 kb_vector 的嵌入后端。

**自足黄金 + 现场嵌入**（解「索引切片不稳 / 索引仅 CI artifact」）：黄金集每条自带目标消息
原文 target_text + distractors；harness 现场把 {所有 target} ∪ {distractors} 嵌成临时内存语料，
问「该条自己的 target 是否为其 query 排进 top-k」。**绝不去 okf/kb_vectors.json.gz 查目标**——
故 ref 粒度粗、索引仅 CI artifact 等约束与本证据无关（proof 自带语料 + 自带真值）。

四臂（同一临时语料 C，hit@k 分模式）：
  - vector    ：kb_vector.embed 同后端同模型 + 余弦（真信号只有 Voyage；stub=词法袋，负控）。
  - grep      ：kb_ab.grep_baseline（朴素）。
  - grep_strong：kb_ab.grep_baseline_strong（整串+TF+id 加权，反稻草人）。
  - spine     ：charitable kb_activate/search「先锚」——取回概念的 title（+日后 aliases）当扩词集，
                再对 C 做 grep。别名/迂回 query 连概念都激活不到 → 脊柱 miss（诚实反映残差）。
铁证主分 vector_exclusive_win = vec_hit ∧ ¬grep ∧ ¬grep_strong ∧ ¬spine。

诚实边界：**stub 后端证不了语义胜**（词法袋无语义），只证「黄金真零词法重叠 + 管线正确」；
真胜负（voyage_win_rate − stub_win_rate ≥ margin）是 **CI-only** 断言（kb-semantic-proof.yml，
现场嵌 golden ≈百余条 ≈$0，不依赖已建索引）。stub 负控口径：与 chance 地板 k/|C| 比、非 ==0
（_STUB_DIM=64 哈希碰撞偶有虚命中，见 test）。

本模块 import-only 库 + __main__（CLI 供 CI 门控）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
for _p in (str(SCRIPTS),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

GOLDEN_PATH = REPO / "tests" / "kb_semantic_golden.jsonl"
_ARCHIVE_PREFIX = "Public-Info-Pool/Record/Community/"  # §1.1-HC 防火墙：目标只许来自公开社区档案


def load_golden(path: Path | str = GOLDEN_PATH) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            rows.append(json.loads(line))
    return rows


def build_corpus(rows: list[dict], extra_distractors: list[str] | None = None) -> list[tuple[str, str]]:
    """临时语料 C = 每条 target（id=行 id）∪ 各条 distractors ∪ 可选外部 distractors。

    doc-id 用**不透明** id（行 id / 'dist:N'），避免 grep_baseline_strong 的 `t in cid_l` 从 key 蹭分。
    """
    corpus: list[tuple[str, str]] = []
    seen = set()
    for r in rows:
        rid = r["id"]
        corpus.append((rid, r["target_text"]))
        seen.add(rid)
        for j, d in enumerate(r.get("distractors", [])):
            did = f"dist:{rid}:{j}"
            corpus.append((did, d))
    for i, d in enumerate(extra_distractors or []):
        corpus.append((f"dist:extra:{i}", d))
    return corpus


def _vector_ranker(corpus: list[tuple[str, str]], backend: str):
    """一次性嵌入语料，返回 rank(query,k)->[doc_id]（余弦，确定性 tie-break 同 kb_vector.search）。"""
    import kb_vector as kv

    doc_ids = [cid for cid, _ in corpus]
    doc_vecs = kv.embed([t for _, t in corpus], backend=backend, input_type="document")

    def rank(query: str, k: int) -> list[str]:
        qv = kv.embed([query], backend=backend, input_type="query")[0]
        scored = [(kv._cosine_prenorm(qv, dv), cid) for (cid, _), dv in zip(corpus, doc_vecs)]
        scored.sort(key=lambda r: (-r[0], r[1]))
        return [cid for _s, cid in scored[:k]]

    return rank


def _spine_expansion(query: str) -> str:
    """charitable「先锚」：kb_activate/search 取回概念的 title 当扩词集（脊柱最佳一击）。"""
    try:
        import kb_navigator as kn
        titles: list[str] = []
        for hit in kn.search(query, limit=5).get("results", []):
            if hit.get("title"):
                titles.append(hit["title"])
        act = kn.activate(query, hops=2, limit=8)
        for a in act.get("activated", []):
            if a.get("title"):
                titles.append(a["title"])
        return " ".join(dict.fromkeys(titles))
    except Exception:
        return ""


def evaluate(rows: list[dict] | None = None, k: int = 3, backend: str = "stub",
             extra_distractors: list[str] | None = None) -> dict:
    import kb_ab

    rows = rows if rows is not None else load_golden()
    if not rows:
        return {"error": "空黄金集", "rows": 0}

    corpus = build_corpus(rows, extra_distractors)
    n_corpus = len(corpus)
    # grep 臂语料：文本预 lower（镜像 kb_ab._concept_bodies 的 .lower()），口径与真管线一致。
    bodies_lower = {cid: text.lower() for cid, text in corpus}
    vrank = _vector_ranker(corpus, backend)

    per = []
    agg = {"vector": 0, "grep": 0, "grep_strong": 0, "spine": 0, "vector_exclusive": 0}
    mrr_v = 0.0
    by_mode: dict[str, dict] = {}
    for r in rows:
        rid = r["id"]
        q = r["query"]
        v_ids = vrank(q, k)
        g_ids = kb_ab.grep_baseline(q, k, bodies_lower)
        gs_ids = kb_ab.grep_baseline_strong(q, k, bodies_lower)
        exp = _spine_expansion(q)
        sp_ids = kb_ab.grep_baseline(exp, k, bodies_lower) if exp else []

        v_hit = rid in v_ids
        g_hit = rid in g_ids
        gs_hit = rid in gs_ids
        sp_hit = rid in sp_ids
        excl = v_hit and not g_hit and not gs_hit and not sp_hit

        if v_hit:
            agg["vector"] += 1
            mrr_v += 1.0 / (v_ids.index(rid) + 1)
        if g_hit:
            agg["grep"] += 1
        if gs_hit:
            agg["grep_strong"] += 1
        if sp_hit:
            agg["spine"] += 1
        if excl:
            agg["vector_exclusive"] += 1

        mode = r.get("capability", "paraphrase_recall")
        m = by_mode.setdefault(mode, {"n": 0, "vector": 0, "vector_exclusive": 0})
        m["n"] += 1
        m["vector"] += int(v_hit)
        m["vector_exclusive"] += int(excl)

        per.append({"id": rid, "capability": mode, "vector": v_hit, "grep": g_hit,
                    "grep_strong": gs_hit, "spine": sp_hit, "vector_exclusive": excl})

    n = len(rows)
    chance_floor = round(min(1.0, k / n_corpus), 4)  # 随机命中地板（负控参照）
    return {
        "backend": backend,
        "k": k,
        "rows": n,
        "corpus_size": n_corpus,
        "chance_floor": chance_floor,
        "vector_hit_rate": round(agg["vector"] / n, 4),
        "grep_hit_rate": round(agg["grep"] / n, 4),
        "grep_strong_hit_rate": round(agg["grep_strong"] / n, 4),
        "spine_hit_rate": round(agg["spine"] / n, 4),
        "vector_exclusive_win_rate": round(agg["vector_exclusive"] / n, 4),
        "vector_mrr": round(mrr_v / n, 4),
        "by_mode": {m: {"n": v["n"],
                        "vector_hit_rate": round(v["vector"] / v["n"], 4),
                        "vector_exclusive_win_rate": round(v["vector_exclusive"] / v["n"], 4)}
                    for m, v in by_mode.items()},
        "per_question": per,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="向量腿语义铁证 harness（paraphrase-recall 四臂对照）")
    ap.add_argument("--backend", default="stub", help="嵌入后端 stub/voyage（默认 stub；真胜负需 voyage）")
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--json", action="store_true", help="机读 JSON 输出")
    ap.add_argument("--assert-win", action="store_true", help="断言 vector_exclusive_win_rate ≥ --min-win-rate（CI 门控）")
    ap.add_argument("--min-win-rate", type=float, default=0.5, help="断言阈（须显著高于 chance_floor）")
    args = ap.parse_args()

    rep = evaluate(k=args.k, backend=args.backend)
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(f"[semantic-ab] backend={rep.get('backend')} rows={rep.get('rows')} "
              f"|C|={rep.get('corpus_size')} chance={rep.get('chance_floor')}")
        for key in ("vector_hit_rate", "grep_hit_rate", "grep_strong_hit_rate",
                    "spine_hit_rate", "vector_exclusive_win_rate", "vector_mrr"):
            print(f"  {key}: {rep.get(key)}")

    if args.assert_win:
        wr = rep.get("vector_exclusive_win_rate", 0)
        if wr < args.min_win_rate:
            print(f"::error::vector_exclusive_win_rate {wr} < 阈 {args.min_win_rate}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
