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


def collect(limit: int, max_files: int | None, min_len: int) -> list[dict]:
    """流式取有界切片：非空、够长的 text，攒到 limit 即停。"""
    from build_community_index import iter_records  # 复用流式 emitter

    rows: list[dict] = []
    for source, day, text, _lang, _eng in iter_records(max_files=max_files):
        text = (text or "").strip()
        if len(text) < min_len:
            continue
        rows.append({
            "source": source,
            "date": day,
            "preview": text[:_PREVIEW_LEN],
            "_text": text,
            "ref": f"{source}:{day}",  # 指针：回落 dated 文件 ripgrep
        })
        if len(rows) >= limit:
            break
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
    ap.add_argument("--out", default=str(kb_vector.DEFAULT_INDEX),
                    help="索引输出路径（默认 okf/kb_vectors.json.gz）")
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
    meta = {
        "backend": backend,
        "model": args.model if backend == "voyage" else "stub",
        "dim": dim,
        "count": len(items),
        "data_layer": "full_archive",
        "note": "长尾语义召回索引；放指针不放本体，全文回落 dated 文件 ripgrep",
    }
    kb_vector.write_index(Path(args.out), items, meta)
    print(f"[build_kb_vectors] 已写 {args.out}：{len(items)} 条 × {dim} 维 "
          f"(backend={backend})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
