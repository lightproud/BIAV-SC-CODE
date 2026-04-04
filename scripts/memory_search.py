"""
memory_search.py — Semantic Memory Search with TF-IDF Vectors + Reranker

Part of BIAV-SC Advanced Memory System (Sprint 1).
Provides vector-based semantic search across all knowledge files,
with a 4-dimension reranker for optimal retrieval.

Layer 1: TF-IDF vectors (pure Python, zero API cost)
Layer 2: API Embedding (auto-upgrade when VOYAGE_API_KEY available)

Usage:
  python scripts/memory_search.py "查询内容"              # 搜索
  python scripts/memory_search.py --build                 # 重建索引
  python scripts/memory_search.py --build --search "查询"  # 重建后搜索
  python scripts/memory_search.py --stats                 # 索引统计
"""

import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from hashlib import md5
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VECTORS_FILE = REPO / "assets" / "data" / "vectors.json"
ACCESS_LOG = REPO / "memory" / "dreams" / "access-log.json"
UTILITY_FILE = REPO / "assets" / "data" / "memory-utility.json"
TODAY = date.today()

# ============================================================
# Chunking
# ============================================================

KNOWLEDGE_GLOBS = [
    "memory/*.md",
    "assets/data/*.json",
    "assets/data/*.md",
    "projects/*/CONTEXT.md",
    "BIAV-SC.md",
]

SKIP_FILES = {
    "assets/data/vectors.json",
    "assets/data/semantic-index.json",
    "assets/data/knowledge-graph.json",
    "assets/data/memory-utility.json",
    "assets/data/precomputed-cache.json",
}


def discover_files() -> list[Path]:
    """Find all knowledge files to index."""
    files = []
    for pattern in KNOWLEDGE_GLOBS:
        for fp in sorted(REPO.glob(pattern)):
            rel = str(fp.relative_to(REPO))
            if rel not in SKIP_FILES and fp.is_file():
                files.append(fp)
    return files


def chunk_file(fp: Path, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Split a file into overlapping text chunks."""
    try:
        text = fp.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    rel = str(fp.relative_to(REPO))

    # For JSON files, try to extract meaningful text
    if fp.suffix == ".json":
        text = _json_to_text(text, rel)

    if not text.strip():
        return []

    chunks = []
    lines = text.splitlines()
    current = []
    current_len = 0
    chunk_idx = 0

    for line in lines:
        current.append(line)
        current_len += len(line) + 1

        if current_len >= chunk_size:
            chunk_text = "\n".join(current)
            chunks.append({
                "file": rel,
                "chunk_id": f"{rel}#chunk-{chunk_idx}",
                "text": chunk_text,
                "offset": chunk_idx,
            })
            chunk_idx += 1

            # Keep overlap
            overlap_chars = 0
            overlap_start = len(current)
            for i in range(len(current) - 1, -1, -1):
                overlap_chars += len(current[i]) + 1
                if overlap_chars >= overlap:
                    overlap_start = i
                    break
            current = current[overlap_start:]
            current_len = sum(len(l) + 1 for l in current)

    # Last chunk
    if current:
        chunk_text = "\n".join(current)
        if chunk_text.strip():
            chunks.append({
                "file": rel,
                "chunk_id": f"{rel}#chunk-{chunk_idx}",
                "text": chunk_text,
                "offset": chunk_idx,
            })

    return chunks


def _json_to_text(raw: str, rel: str) -> str:
    """Convert JSON content to searchable text."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw

    parts = [f"File: {rel}"]
    _extract_text_values(data, parts, depth=0)
    return "\n".join(parts)


def _extract_text_values(obj, parts: list, depth: int):
    """Recursively extract string values from JSON."""
    if depth > 5:
        return
    if isinstance(obj, str) and len(obj) > 5:
        parts.append(obj)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and len(v) > 5:
                parts.append(f"{k}: {v}")
            elif isinstance(v, (dict, list)):
                _extract_text_values(v, parts, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _extract_text_values(item, parts, depth + 1)


# ============================================================
# TF-IDF Vectorization (pure Python, no dependencies)
# ============================================================

STOP_WORDS = {
    # English
    "the", "and", "for", "that", "this", "with", "from", "are", "was",
    "been", "have", "has", "not", "but", "can", "all", "will", "would",
    "could", "should", "may", "also", "more", "than", "into", "each",
    "which", "where", "when", "what", "how", "who", "its", "you", "your",
    "our", "they", "their", "there", "here", "just", "only", "very",
    "some", "any", "other", "about", "after", "before", "between",
    "under", "over", "such", "then", "them", "these", "those",
    # Chinese
    "可以", "需要", "使用", "目前", "已经", "以及", "进行", "通过",
    "是否", "如果", "但是", "或者", "因为", "所以", "关于", "对于",
    "以下", "文件", "内容", "状态", "说明", "其他", "包括", "支持",
    "相关", "具体", "作为", "还是", "就是", "这个", "那个", "什么",
    "一个", "这些", "那些", "没有", "不是", "已经", "正在", "例如",
}


def tokenize(text: str) -> list[str]:
    """Tokenize text into Chinese bigrams + English words.

    Chinese: sliding window bigrams (2-char pairs) to handle unsegmented text.
    English: whole words of 3+ chars.
    """
    words = []

    # English words
    for m in re.finditer(r"[a-zA-Z]{3,}", text.lower()):
        words.append(m.group())

    # Chinese: extract bigrams (2-char sliding window)
    # This handles both pre-segmented and continuous Chinese text
    chinese_runs = re.findall(r"[\u4e00-\u9fff]+", text)
    for run in chinese_runs:
        if len(run) >= 2:
            for i in range(len(run) - 1):
                bigram = run[i : i + 2]
                words.append(bigram)

    return [w for w in words if w not in STOP_WORDS and len(w) > 1]


def build_tfidf_index(chunks: list[dict]) -> dict:
    """Build TF-IDF vectors for all chunks.

    Returns {
        "vocabulary": {word: index},
        "idf": {word: idf_value},
        "vectors": {chunk_id: {word: tfidf_score}},
        "chunks": {chunk_id: {file, text_preview, offset}},
    }
    """
    n_docs = len(chunks)
    if n_docs == 0:
        return {"vocabulary": {}, "idf": {}, "vectors": {}, "chunks": {}}

    # Step 1: Document frequency
    doc_freq = Counter()
    chunk_tokens = {}

    for chunk in chunks:
        tokens = tokenize(chunk["text"])
        chunk_tokens[chunk["chunk_id"]] = tokens
        unique_tokens = set(tokens)
        for token in unique_tokens:
            doc_freq[token] += 1

    # Step 2: Build vocabulary (top 2000 terms by document frequency)
    vocab_items = sorted(doc_freq.items(), key=lambda x: x[1], reverse=True)[:2000]
    vocabulary = {word: idx for idx, (word, _) in enumerate(vocab_items)}

    # Step 3: IDF
    idf = {}
    for word in vocabulary:
        idf[word] = math.log(n_docs / (1 + doc_freq[word])) + 1.0

    # Step 4: TF-IDF vectors (sparse, only store non-zero)
    vectors = {}
    chunk_meta = {}

    for chunk in chunks:
        cid = chunk["chunk_id"]
        tokens = chunk_tokens[cid]
        if not tokens:
            continue

        tf = Counter(tokens)
        max_tf = max(tf.values()) if tf else 1

        vec = {}
        for word, count in tf.items():
            if word in vocabulary:
                # Augmented TF to prevent bias toward long documents
                tf_score = 0.5 + 0.5 * (count / max_tf)
                vec[word] = tf_score * idf[word]

        if vec:
            # L2 normalize
            norm = math.sqrt(sum(v * v for v in vec.values()))
            if norm > 0:
                vec = {k: v / norm for k, v in vec.items()}

            vectors[cid] = vec

        chunk_meta[cid] = {
            "file": chunk["file"],
            "preview": chunk["text"][:200],
            "offset": chunk["offset"],
        }

    return {
        "vocabulary": vocabulary,
        "idf": idf,
        "vectors": vectors,
        "chunks": chunk_meta,
    }


def cosine_similarity(v1: dict, v2: dict) -> float:
    """Cosine similarity between two sparse vectors."""
    common_keys = set(v1.keys()) & set(v2.keys())
    if not common_keys:
        return 0.0
    dot = sum(v1[k] * v2[k] for k in common_keys)
    # Vectors are already L2-normalized, so dot product = cosine similarity
    return dot


def query_to_vector(query: str, idf: dict, vocabulary: dict) -> dict:
    """Convert a query string to a TF-IDF vector."""
    tokens = tokenize(query)
    if not tokens:
        return {}

    tf = Counter(tokens)
    max_tf = max(tf.values()) if tf else 1

    vec = {}
    for word, count in tf.items():
        if word in vocabulary:
            tf_score = 0.5 + 0.5 * (count / max_tf)
            vec[word] = tf_score * idf.get(word, 1.0)

    # L2 normalize
    norm = math.sqrt(sum(v * v for v in vec.values()))
    if norm > 0:
        vec = {k: v / norm for k, v in vec.items()}
    return vec


# ============================================================
# Reranker (4-dimension scoring)
# ============================================================

DEFAULT_WEIGHTS = {
    "semantic": 0.40,
    "recency": 0.25,
    "access": 0.20,
    "graph": 0.15,
}


def recency_score(file_path: str) -> float:
    """Exponential decay score based on file modification time."""
    fp = REPO / file_path
    if not fp.exists():
        return 0.0
    mtime = datetime.fromtimestamp(fp.stat().st_mtime).date()
    days = (TODAY - mtime).days
    # Half-life of 7 days
    return math.exp(-0.693 * days / 7)


def access_frequency_score(file_path: str) -> float:
    """Score based on how often a file appears in access logs."""
    if not ACCESS_LOG.exists():
        return 0.5  # neutral default

    try:
        logs = json.loads(ACCESS_LOG.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0.5

    total_sessions = len(logs)
    if total_sessions == 0:
        return 0.5

    access_count = sum(
        1 for entry in logs if file_path in entry.get("files_scanned", [])
    )
    # Normalize: 0.5 baseline + 0.5 * frequency
    return 0.5 + 0.5 * (access_count / total_sessions)


def utility_score(file_path: str) -> float:
    """Get MemRL utility score if available."""
    if not UTILITY_FILE.exists():
        return 0.5

    try:
        data = json.loads(UTILITY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0.5

    entry = data.get(file_path, {})
    return entry.get("utility", 0.5)


_graph_cache = None


def _load_graph_cached():
    """Load graph once per session."""
    global _graph_cache
    if _graph_cache is None:
        try:
            from knowledge_graph import load_graph
            _graph_cache = load_graph() or False
        except ImportError:
            _graph_cache = False
    return _graph_cache if _graph_cache else None


_graph_query_cache = {}


def graph_proximity_score(file_path: str, query: str) -> float:
    """Score based on knowledge graph distance between file and query entities.

    Tokenizes the query into terms, finds matching entities in the graph,
    then checks if this file is within 2 hops of any matched entity.
    Closer = higher score: 1 hop → 1.0, 2 hops → 0.6, not found → 0.2
    """
    graph = _load_graph_cached()
    if not graph:
        return 0.5

    # Cache related files per query to avoid repeated graph traversals
    if query not in _graph_query_cache:
        try:
            from knowledge_graph import find_related_files, find_node
        except ImportError:
            return 0.5

        # Try full query first, then individual terms
        all_related = {}
        query_terms = [query]

        # Split into sub-terms for Chinese/English
        import re
        # Chinese: extract bigrams for graph matching
        for run in re.findall(r"[\u4e00-\u9fff]+", query):
            for i in range(len(run) - 1):
                query_terms.append(run[i : i + 2])
        english_terms = re.findall(r"[a-zA-Z]{3,}", query)
        query_terms.extend(english_terms)

        for term in query_terms:
            if not find_node(graph, term):
                continue
            for r in find_related_files(graph, term, max_depth=2):
                fp = r["file"]
                if fp not in all_related or all_related[fp] > r["distance"]:
                    all_related[fp] = r["distance"]

        _graph_query_cache[query] = all_related

    distance = _graph_query_cache[query].get(file_path)
    if distance is None:
        return 0.2
    if distance == 1:
        return 1.0
    elif distance == 2:
        return 0.6
    else:
        return 0.4


def rerank(candidates: list[dict], query: str, weights: dict = None) -> list[dict]:
    """Multi-dimension reranking.

    candidates: [{chunk_id, file, score, preview, ...}]
    query: user query string
    weights: optional weight overrides

    Returns sorted candidates with final_score added.
    """
    w = weights or DEFAULT_WEIGHTS

    for c in candidates:
        file_path = c["file"]
        sem = c.get("score", 0.0)
        rec = recency_score(file_path)
        acc = access_frequency_score(file_path)
        gph = graph_proximity_score(file_path, query)

        c["scores"] = {
            "semantic": round(sem, 4),
            "recency": round(rec, 4),
            "access": round(acc, 4),
            "graph": round(gph, 4),
        }
        c["final_score"] = round(
            w["semantic"] * sem
            + w["recency"] * rec
            + w["access"] * acc
            + w["graph"] * gph,
            4,
        )

    candidates.sort(key=lambda x: x["final_score"], reverse=True)
    return candidates


# ============================================================
# Search API
# ============================================================


def load_index() -> dict | None:
    """Load the vector index from disk."""
    if not VECTORS_FILE.exists():
        return None
    try:
        return json.loads(VECTORS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def search(query: str, top_k: int = 5, use_reranker: bool = True) -> list[dict]:
    """Semantic search: query → top-K relevant knowledge chunks.

    Returns [{chunk_id, file, preview, score, final_score, scores}]
    """
    index = load_index()
    if not index:
        print("  ⚠ 索引不存在，请先运行: python scripts/memory_search.py --build")
        return []

    q_vec = query_to_vector(query, index["idf"], index["vocabulary"])
    if not q_vec:
        return []

    # Score all chunks
    results = []
    for chunk_id, vec in index["vectors"].items():
        sim = cosine_similarity(q_vec, vec)
        if sim > 0.01:  # threshold
            meta = index["chunks"].get(chunk_id, {})
            results.append({
                "chunk_id": chunk_id,
                "file": meta.get("file", ""),
                "preview": meta.get("preview", ""),
                "score": sim,
            })

    # Sort by semantic score first
    results.sort(key=lambda x: x["score"], reverse=True)

    # Deduplicate: keep best chunk per file
    seen_files = set()
    deduped = []
    for r in results:
        if r["file"] not in seen_files:
            seen_files.add(r["file"])
            deduped.append(r)
        if len(deduped) >= top_k * 2:  # keep extra for reranker
            break

    if use_reranker:
        deduped = rerank(deduped, query)

    return deduped[:top_k]


# ============================================================
# Index Building
# ============================================================


def build_index() -> dict:
    """Build complete vector index from all knowledge files."""
    files = discover_files()
    print(f"  发现 {len(files)} 个知识文件")

    all_chunks = []
    for fp in files:
        chunks = chunk_file(fp)
        all_chunks.extend(chunks)

    print(f"  切分为 {len(all_chunks)} 个文本块")

    index = build_tfidf_index(all_chunks)
    index["meta"] = {
        "generated": TODAY.isoformat(),
        "generator": "memory_search.py",
        "files_count": len(files),
        "chunks_count": len(all_chunks),
        "vocab_size": len(index["vocabulary"]),
        "layer": "tfidf",
    }

    # Save
    VECTORS_FILE.parent.mkdir(parents=True, exist_ok=True)
    VECTORS_FILE.write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    size_kb = VECTORS_FILE.stat().st_size / 1024
    print(f"  词汇表：{len(index['vocabulary'])} 个词")
    print(f"  向量数：{len(index['vectors'])} 个")
    print(f"  索引文件：{VECTORS_FILE.relative_to(REPO)} ({size_kb:.0f}KB)")

    return index


# ============================================================
# CLI
# ============================================================


def print_results(results: list[dict], query: str):
    """Pretty-print search results."""
    if not results:
        print(f"\n  没有找到与「{query}」相关的结果")
        return

    print(f"\n  🔍 搜索「{query}」— 找到 {len(results)} 个相关知识块\n")
    for i, r in enumerate(results, 1):
        score_str = f"final={r.get('final_score', r['score']):.3f}"
        if "scores" in r:
            s = r["scores"]
            score_str += f" (sem={s['semantic']:.2f} rec={s['recency']:.2f} acc={s['access']:.2f} gph={s['graph']:.2f})"
        print(f"  [{i}] {r['file']}")
        print(f"      {score_str}")
        preview = r["preview"].replace("\n", " ")[:120]
        print(f"      {preview}...")
        print()


def print_stats():
    """Print index statistics."""
    index = load_index()
    if not index:
        print("  索引不存在")
        return

    meta = index.get("meta", {})
    print(f"\n  📊 向量索引统计")
    print(f"  生成时间：{meta.get('generated', '?')}")
    print(f"  索引层级：{meta.get('layer', '?')}")
    print(f"  文件数量：{meta.get('files_count', '?')}")
    print(f"  文本块数：{meta.get('chunks_count', '?')}")
    print(f"  词汇表大小：{meta.get('vocab_size', '?')}")
    print(f"  向量数量：{len(index.get('vectors', {}))}")

    # File distribution
    files = defaultdict(int)
    for cid in index.get("vectors", {}):
        chunk_meta = index["chunks"].get(cid, {})
        files[chunk_meta.get("file", "?")] += 1

    print(f"\n  文件分布（按块数）：")
    for f, count in sorted(files.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"    {count:3d} 块 — {f}")


def main():
    args = sys.argv[1:]

    do_build = "--build" in args
    do_stats = "--stats" in args
    query_args = [a for a in args if not a.startswith("--")]
    query = " ".join(query_args) if query_args else None

    if do_build:
        print(f"🔨 构建向量索引 — {TODAY}")
        build_index()
        print("  ✅ 索引构建完成")

    if do_stats:
        print_stats()

    if query:
        results = search(query)
        print_results(results, query)
    elif not do_build and not do_stats:
        print("用法:")
        print('  python scripts/memory_search.py "查询内容"')
        print("  python scripts/memory_search.py --build")
        print("  python scripts/memory_search.py --stats")


if __name__ == "__main__":
    main()
