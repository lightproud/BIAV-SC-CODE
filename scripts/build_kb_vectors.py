"""build_kb_vectors.py — 构建银芯长尾向量索引（§八「厚锚撑向量」参照实现）。

从社区全量档案（`Public-Info-Pool/Record/Community/`）流式取有界切片，用可插拔
嵌入后端（生产 Voyage / 离线桩）算 embedding，落 gzip 索引 `okf/kb_vectors.json.gz`。

**有界原型优先**（守密人 2026-07-05 裁定「先小步」）：默认 `--limit` 只取前 N 条，
索引小到 numpy-free 暴力余弦即可，先证「向量腿跑得通且有独占价值」；量产全量留后续
（届时上 faiss/hnswlib + 量化 + Release）。

复用 `build_community_index.iter_records`（同一流式 emitter，DRY）：逐源逐条产
`(source, day, text, lang, eng)`，本脚本只取非空 `text`、攒到 `--limit` 即停。

放指针不放本体：索引每条存 embedding + 指针 `{source}:{day}` + 200 字预览，全文
回落 dated 原文件 ripgrep。索引本体不进 git（.gitignore），CI 构建后传 Release。

红线声明（2026-07-05 反转）：本脚本**引入 ML 嵌入**（Voyage），是银芯首个非零-ML
部件；隔离在向量腿内，白盒脊柱（kb_index / community_index）仍保持确定性零 ML。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
NEWS_SCRIPTS = REPO / "projects" / "news" / "scripts"
for _p in (str(SCRIPTS), str(NEWS_SCRIPTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import kb_vector  # noqa: E402  (同目录后端)

_PREVIEW_LEN = 200
_EMBED_BATCH = 128  # Voyage 单次批量上限量级


def _eligible_counts(max_files: int | None, min_len: int) -> dict[str, int]:
    """第一遍：各源合格（非空、够长）条数。只数数、零存储。"""
    from build_community_index import iter_records

    counts: dict[str, int] = {}
    for source, _day, text, _lang, _eng in iter_records(max_files=max_files):
        if len((text or "").strip()) < min_len:
            continue
        counts[source] = counts.get(source, 0) + 1
    return counts


def _quotas(counts: dict[str, int], limit: int) -> dict[str, int]:
    """水填配额（确定性）：小源全收、盈余滚给大源，大源均分剩余。

    语料结构极端偏斜（discord 753 万 = 99.5%，其余 16 平台合计 ~3.4 万）：均匀水位
    先让所有装得下的小源**全量收编**，省下的配额全滚给 discord 这类大源。
    纯算术、无随机——同 counts + 同 limit 必得同配额。
    """
    quotas: dict[str, int] = {}
    remaining, active = max(0, int(limit)), dict(counts)
    while active:
        share = remaining // len(active)
        small = {s: c for s, c in active.items() if c <= share}
        if not small:
            # 只剩大源：均分（余数按源名字典序发放，确定性）
            names = sorted(active)
            base, extra = remaining // len(names), remaining % len(names)
            for i, s in enumerate(names):
                quotas[s] = base + (1 if i < extra else 0)
            return quotas
        for s, c in small.items():
            quotas[s] = c
            remaining -= c
            del active[s]
        if remaining <= 0:
            for s in active:
                quotas[s] = 0
            return quotas
    return quotas


def collect(limit: int, max_files: int | None, min_len: int) -> list[dict]:
    """分层有界采样（两遍流式，确定性零随机）。

    v1「取前 limit 条」在几万量级是抽样失真（lesson #30 同源）：源按名迭代、
    discord 排第三——前缀切片会把 discord 之后的 14 个平台全排除，discord 自身
    也只取到最早几个频道。v2 改两遍：第一遍数各源合格条数 → 水填配额
    （小源全收、大源吃剩余）；第二遍按**跨步抽样**取样（步长 = 合格数 // 配额，
    在源内跨全频道全时间均匀落点），攒满配额即止。
    """
    from build_community_index import iter_records  # 复用流式 emitter

    counts = _eligible_counts(max_files, min_len)
    if not counts:
        return []
    quotas = _quotas(counts, limit)
    strides = {s: max(1, counts[s] // q) for s, q in quotas.items() if q > 0}
    seen = {s: 0 for s in counts}
    taken = {s: 0 for s in counts}
    rows: list[dict] = []
    for source, day, text, _lang, _eng in iter_records(max_files=max_files):
        text = (text or "").strip()
        if len(text) < min_len:
            continue
        q = quotas.get(source, 0)
        if q <= 0 or taken[source] >= q:
            continue
        k = seen[source]
        seen[source] += 1
        if k % strides[source]:
            continue
        taken[source] += 1
        rows.append({
            "source": source,
            "date": day,
            "preview": text[:_PREVIEW_LEN],
            "_text": text,
            "ref": f"{source}:{day}",  # 指针：回落 dated 文件 ripgrep
        })
    return rows


def embed_rows(rows: list[dict], backend: str, model: str) -> list[dict]:
    """分批嵌入，vec 落回每行；丢弃 _text（放指针不放本体）。"""
    items: list[dict] = []
    for i in range(0, len(rows), _EMBED_BATCH):
        batch = rows[i:i + _EMBED_BATCH]
        vecs = kb_vector.embed([r["_text"] for r in batch], backend=backend,
                               model=model, input_type="document")
        for r, v in zip(batch, vecs):
            items.append({
                "ref": r["ref"],
                "source": r["source"],
                "date": r["date"],
                "preview": r["preview"],
                "vec": [round(x, 6) for x in v],
            })
    return items


def main() -> int:
    ap = argparse.ArgumentParser(description="构建银芯长尾向量索引（有界原型优先）")
    ap.add_argument("--limit", type=int, default=20000,
                    help="最多索引多少条（有界切片；默认 20000）")
    ap.add_argument("--max-files", type=int, default=None,
                    help="最多扫描多少归档文件（抽样自检用）")
    ap.add_argument("--min-len", type=int, default=8,
                    help="过滤短于此长度的消息（默认 8 字符）")
    ap.add_argument("--backend", default=None,
                    help="嵌入后端 voyage/stub（默认：有 VOYAGE_API_KEY 则 voyage）")
    ap.add_argument("--model", default=kb_vector._VOYAGE_MODEL,
                    help="Voyage 模型名（随索引 meta 落存）")
    ap.add_argument("--out", default=str(REPO / "Public-Info-Pool" / "Rough" / "kb_vectors.json.gz"),
                    help="索引输出路径（默认 gitignored Public-Info-Pool/Rough/，防本地桩索引污染 "
                         "okf/；CI 建生产索引时显式传 --out okf/kb_vectors.json.gz --backend voyage）")
    args = ap.parse_args()

    backend = args.backend or kb_vector.default_backend()
    print(f"[build_kb_vectors] backend={backend} limit={args.limit} "
          f"max_files={args.max_files}", file=sys.stderr)

    rows = collect(args.limit, args.max_files, args.min_len)
    print(f"[build_kb_vectors] 采集 {len(rows)} 条切片，开始嵌入…", file=sys.stderr)
    if not rows:
        print("[build_kb_vectors] 零采集（语料缺失？）——未写索引", file=sys.stderr)
        return 1

    items = embed_rows(rows, backend, args.model)
    dim = len(items[0]["vec"]) if items else 0
    per_source: dict[str, int] = {}
    for it in items:
        per_source[it["source"]] = per_source.get(it["source"], 0) + 1
    meta = {
        "backend": backend,
        "model": args.model if backend == "voyage" else "stub",
        "dim": dim,
        "count": len(items),
        "data_layer": "full_archive",
        "sampling": "stratified",  # 分层：小源全收 + 大源跨步（见 collect docstring）
        "per_source": dict(sorted(per_source.items())),
        "note": "长尾语义召回索引；放指针不放本体，全文回落 dated 文件 ripgrep",
    }
    kb_vector.write_index(Path(args.out), items, meta)
    print(f"[build_kb_vectors] 已写 {args.out}：{len(items)} 条 × {dim} 维 "
          f"(backend={backend})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
