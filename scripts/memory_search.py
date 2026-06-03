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

import fnmatch
import gzip
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

from text_utils import tokenize as tokenize_text

REPO = Path(__file__).resolve().parent.parent
VECTORS_FILE = REPO / "assets" / "data" / "vectors.json.gz"
ACCESS_LOG_DIR = REPO / "memory" / "dreams" / "access-log"
ACCESS_LOG_LEGACY = REPO / "memory" / "dreams" / "access-log.json"
UTILITY_FILE = REPO / "assets" / "data" / "memory-utility.json"
TODAY = date.today()

# ============================================================
# Chunking
# ============================================================

KNOWLEDGE_GLOBS = [
    # === Tier 0: Core memory & facts (always indexed) ===
    "memory/*.md",
    "memory/*.json",
    "memory/active/*.md",
    "memory/dreams/*.json",
    "memory/dreams/*.md",
    "memory/session-digests/*.md",
    "assets/data/*.json",
    "assets/data/*.md",
    "BIAV-SC.md",
    "CLAUDE.md",

    # === Tier 1a: Game data (wiki db + config) ===
    "projects/wiki/data/*.json",
    "projects/wiki/data/db/*.json",
    "projects/wiki/data/schemas/*.json",
    "projects/wiki/data/extracted/categorized/*.txt",
    "projects/wiki/data/extracted/lua_tables/*.lua",

    # === Tier 1b: Wiki documentation (3 languages) ===
    "projects/wiki/docs/zh/**/*.md",
    "projects/wiki/docs/en/**/*.md",
    "projects/wiki/docs/ja/**/*.md",

    # === Tier 1c: News output & platform data ===
    "projects/news/output/*.json",
    "projects/news/output/*.md",
    "projects/news/output/*.jsonl",
    "projects/news/data/platforms/*/*.json",

    # === Tier 2: Discord (summaries, not per-message) ===
    "projects/news/data/discord/channel_index.json",
    "projects/news/data/discord/guild_meta.json",
    "projects/news/data/discord/activity_daily/*.json",

    # === Tier 1d: Project context & source code ===
    "projects/*/CONTEXT.md",
    "projects/site/*.html",
    "projects/site/*.css",
    "scripts/*.py",

    # === Tier 1e: Config & CI/CD ===
    ".github/workflows/*.yml",
    "projects/*/package.json",

    # === Tier 1f: Deliverables ===
    "deliverables/**/*.md",
    "deliverables/**/*.html",
]

SKIP_FILES = {
    "assets/data/vectors.json.gz",
    "assets/data/semantic-index.json",
    "assets/data/knowledge-graph.json",
    "assets/data/memory-utility.json",
    "assets/data/precomputed-cache.json",
    # Large auto-generated files that add noise
    "projects/news/output/news.json",
    # Noise files from game memory extraction (binary/system data, not game content)
    "projects/wiki/data/extracted/categorized/numeric_config.txt",
    "projects/wiki/data/extracted/categorized/asset_references.txt",
}

# Discord JSONL directories for on-demand message search (Tier 3)
DISCORD_CHANNELS_DIR = "projects/news/data/discord/channels"
SEARCHIGNORE_AGE_DAYS = 30  # files matching .searchignore AND older drop


def discover_files() -> list[Path]:
    """Find all knowledge files to index, honoring .searchignore."""
    si = REPO / ".searchignore"
    patterns = [l.strip() for l in si.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")] if si.exists() else []
    cutoff = time.time() - SEARCHIGNORE_AGE_DAYS * 86400
    files = []
    for pattern in KNOWLEDGE_GLOBS:
        for fp in sorted(REPO.glob(pattern)):
            rel = str(fp.relative_to(REPO))
            if rel in SKIP_FILES or not fp.is_file():
                continue
            if fp.stat().st_mtime < cutoff and any(fnmatch.fnmatch(rel, p) for p in patterns):
                continue
            files.append(fp)
    return files


def chunk_file(fp: Path, chunk_size: int = 500, overlap: int = 100) -> list[dict]:
    """Split a file into overlapping text chunks with format-aware extraction."""
    try:
        text = fp.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    rel = str(fp.relative_to(REPO))

    # Format-specific text extraction before generic chunking
    if fp.suffix == ".json":
        text = _json_to_text(text, rel)
    elif fp.suffix == ".jsonl":
        text = _jsonl_to_text(text, rel)
    elif fp.suffix == ".lua":
        text = _lua_to_text(text, rel)
    elif fp.suffix == ".yml" or fp.suffix == ".yaml":
        text = _yaml_to_text(text, rel)
    elif fp.suffix == ".txt" and "categorized" in rel:
        text = _categorized_txt_to_text(text, rel)
    elif fp.suffix in (".html", ".css"):
        # Strip HTML tags for indexing, keep text content
        text = re.sub(r"<[^>]+>", " ", text)
        text = f"File: {rel}\n{text}"
    elif fp.suffix in (".ts", ".tsx", ".py", ".js"):
        text = _code_to_text(text, rel)

    if not text.strip():
        return []

    # Adaptive chunk size: larger for data-heavy files, smaller for docs
    if "discord/activity_daily" in rel or "platforms/" in rel:
        chunk_size = 800  # Aggregated data, keep more context
    elif fp.suffix == ".lua":
        chunk_size = 1000  # Lua entries are self-contained blocks
    elif "wiki/docs/" in rel:
        chunk_size = 600  # Wiki pages are structured markdown

    return _split_into_chunks(text, rel, chunk_size, overlap)


def _split_into_chunks(text: str, rel: str, chunk_size: int, overlap: int) -> list[dict]:
    """Generic overlapping text chunker."""
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


# ---- Format-specific text extractors ----

def _json_to_text(raw: str, rel: str) -> str:
    """Convert JSON content to searchable text."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw

    # Discord activity_daily: extract channel names + stats
    if "activity_daily" in rel:
        return _discord_daily_to_text(data, rel)

    # News platform data: extract titles + summaries
    if "platforms/" in rel:
        return _platform_json_to_text(data, rel)

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


def _jsonl_to_text(raw: str, rel: str) -> str:
    """Convert JSONL (news feed) to searchable text."""
    parts = [f"File: {rel}"]
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        # Extract key searchable fields
        title = obj.get("title", "")
        summary = obj.get("summary", "")
        author = obj.get("author", "")
        source = obj.get("source", "")
        if title:
            parts.append(f"title: {title}")
        if summary:
            parts.append(f"summary: {summary}")
        if author:
            parts.append(f"author: {author}")
        if source and not title and not summary:
            # Fallback: dump all string values
            _extract_text_values(obj, parts, depth=0)
    return "\n".join(parts)


def _lua_to_text(raw: str, rel: str) -> str:
    """Convert Lua table config to searchable text.

    Extracts key-value pairs from Lua table syntax:
      Name = "xxx", Introduction = "yyy", ...
    """
    parts = [f"File: {rel}"]
    fname = Path(rel).stem  # e.g. "AwakerConfig"
    parts.append(f"Config: {fname}")

    # Extract string assignments: Key = "Value"
    for m in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', raw):
        key, value = m.group(1), m.group(2)
        if len(value) > 3:
            # Strip inline markup tags like <BleedingIconKeywords:xxx>
            clean = re.sub(r"<\w+:([^>]+)>", r"\1", value)
            parts.append(f"{key}: {clean}")

    # Extract numeric table keys as entity boundaries
    for m in re.finditer(r"\[(\d+)\]\s*=\s*\{", raw):
        parts.append(f"--- entry {m.group(1)} ---")

    return "\n".join(parts)


def _categorized_txt_to_text(raw: str, rel: str) -> str:
    """Convert pipe-delimited categorized text to searchable text.

    Format: ConfigKey_ID_Field|Value
    """
    parts = [f"File: {rel}"]
    fname = Path(rel).stem  # e.g. "character_data"
    parts.append(f"Category: {fname}")

    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Split on first pipe: key|value
        if "|" in line:
            key, _, value = line.partition("|")
            # Extract the field name from key like "AwakerConfig_15560_Name"
            key_parts = key.rsplit("_", 1)
            field = key_parts[-1] if len(key_parts) > 1 else key
            if len(value) > 2:
                clean = re.sub(r"<\w+:([^>]+)>", r"\1", value)
                parts.append(f"{field}: {clean}")
        elif len(line) > 5:
            parts.append(line)

    return "\n".join(parts)


def _yaml_to_text(raw: str, rel: str) -> str:
    """Convert YAML (workflow config) to searchable text."""
    parts = [f"File: {rel}"]
    fname = Path(rel).stem
    parts.append(f"Workflow: {fname}")
    # Extract key-value pairs and comments
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            parts.append(stripped.lstrip("# "))
        elif ":" in stripped and not stripped.startswith("-"):
            parts.append(stripped)
    return "\n".join(parts)


def _code_to_text(raw: str, rel: str) -> str:
    """Extract meaningful text from source code files."""
    parts = [f"File: {rel}"]
    lang = Path(rel).suffix

    for line in raw.splitlines():
        stripped = line.strip()
        # Keep comments
        if stripped.startswith("//") or stripped.startswith("#"):
            comment = stripped.lstrip("/#").strip()
            if len(comment) > 5:
                parts.append(comment)
        # Keep function/class/interface declarations
        elif lang in (".ts", ".tsx", ".js"):
            if re.match(r"(export\s+)?(function|class|interface|type|const|enum)\s+\w+", stripped):
                parts.append(stripped[:200])
        elif lang == ".py":
            if re.match(r"(def |class |async def )", stripped):
                parts.append(stripped[:200])
            elif stripped.startswith('"""') or stripped.startswith("'''"):
                parts.append(stripped.strip("\"'"))
    return "\n".join(parts)


def _discord_daily_to_text(data: dict, rel: str) -> str:
    """Convert Discord daily activity JSON to searchable text."""
    parts = [f"File: {rel}"]
    date_str = data.get("date", "")
    messages = data.get("messages", 0)
    authors = data.get("unique_authors", 0)
    parts.append(f"Discord daily: {date_str} messages={messages} authors={authors}")

    # Channel activity breakdown
    channel_activity = data.get("channel_activity", {})
    for channel, count in sorted(channel_activity.items(), key=lambda x: x[1], reverse=True):
        if count > 5:  # Skip near-empty channels
            parts.append(f"channel: {channel} messages={count}")

    return "\n".join(parts)


def _platform_json_to_text(data: dict, rel: str) -> str:
    """Convert news platform JSON to searchable text."""
    parts = [f"File: {rel}"]
    source = data.get("source", "")
    date_str = data.get("date", "")
    parts.append(f"Platform: {source} date: {date_str}")

    for item in data.get("items", []):
        title = item.get("title", "")
        summary = item.get("summary", "")
        author = item.get("author", "")
        engagement = item.get("engagement", 0)
        if title:
            parts.append(f"title: {title}")
        if summary and len(summary) > 10:
            parts.append(f"summary: {summary[:300]}")
        if author:
            parts.append(f"author: {author}")

    return "\n".join(parts)


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
    """Tokenize text into Chinese bigrams + English words (memory stop words)."""
    return tokenize_text(text, STOP_WORDS)


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

    # Step 2: Build vocabulary (dynamic sizing based on corpus)
    # Keep terms appearing in >= 2 docs, cap at 15000 to bound index size
    # Filter out ultra-rare terms (df=1) which add noise without recall benefit
    min_df = 2
    filtered = [(w, f) for w, f in doc_freq.items() if f >= min_df]
    vocab_cap = min(15000, len(filtered))
    vocab_items = sorted(filtered, key=lambda x: x[1], reverse=True)[:vocab_cap]
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
            # Keep only top-50 dimensions per vector to bound index size
            # This preserves >95% of cosine similarity for sparse TF-IDF
            if len(vec) > 50:
                top_items = sorted(vec.items(), key=lambda x: x[1], reverse=True)[:50]
                vec = dict(top_items)

            # L2 normalize
            norm = math.sqrt(sum(v * v for v in vec.values()))
            if norm > 0:
                vec = {k: round(v / norm, 4) for k, v in vec.items()}

            vectors[cid] = vec

        chunk_meta[cid] = {
            "file": chunk["file"],
            "preview": chunk["text"][:150],
            "offset": chunk["offset"],
        }

    # Inverted index: token -> [chunk_ids] that have a non-zero weight for it.
    # At query time we only score chunks sharing >=1 query token, which is
    # an exact-equivalent shortcut for cosine over sparse vectors (a chunk
    # with no shared token has dot-product 0 and is dropped by the >0.01
    # threshold anyway). Older index files without this key fall back to a
    # full scan in search().
    inverted = defaultdict(list)
    for cid, vec in vectors.items():
        for token in vec:
            inverted[token].append(cid)

    return {
        "vocabulary": vocabulary,
        "idf": idf,
        "vectors": vectors,
        "chunks": chunk_meta,
        "inverted": dict(inverted),
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


def _load_access_log() -> list[dict]:
    """Load access log from per-day files (with legacy single-file fallback)."""
    entries = []
    if ACCESS_LOG_DIR.exists():
        for f in sorted(ACCESS_LOG_DIR.glob("*.json")):
            try:
                entries.append(json.loads(f.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass
    if not entries and ACCESS_LOG_LEGACY.exists():
        try:
            entries = json.loads(ACCESS_LOG_LEGACY.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return entries


def access_frequency_score(file_path: str, logs: list[dict] = None) -> float:
    """Score based on how often a file appears in access logs.

    Pass a pre-loaded ``logs`` list to avoid re-reading the access log per
    candidate (rerank hoists the load out of its loop).
    """
    if logs is None:
        logs = _load_access_log()
    if not logs:
        return 0.5  # neutral default

    access_count = sum(
        1 for entry in logs if file_path in entry.get("files_scanned", [])
    )
    # Normalize: 0.5 baseline + 0.5 * frequency
    return 0.5 + 0.5 * (access_count / len(logs))


def _load_utility_data() -> dict:
    """Load the MemRL utility map once (empty dict if absent/unreadable)."""
    if not UTILITY_FILE.exists():
        return {}
    try:
        return json.loads(UTILITY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def utility_score(file_path: str, data: dict = None) -> float:
    """Get MemRL utility score if available.

    Pass pre-loaded ``data`` to avoid re-reading the utility file per call.
    """
    if data is None:
        data = _load_utility_data()
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
_graph_adj_cache = {}


def _graph_adjacency(graph: dict) -> dict:
    """Build (once per graph object) the node_id → [(other_id, ...)] adjacency
    table and cache it keyed by id(graph). find_related_files rebuilds this on
    every call (via get_neighbors), so for multi-bigram Chinese queries the same
    table was rebuilt many times per query — cache it so it's built once.
    """
    key = id(graph)
    adj = _graph_adj_cache.get(key)
    if adj is None:
        from collections import defaultdict
        adj = defaultdict(list)
        for edge in graph["edges"]:
            adj[edge["source"]].append((edge["target"], "outgoing", edge["type"]))
            adj[edge["target"]].append((edge["source"], "incoming", edge["type"]))
        _graph_adj_cache[key] = adj
    return adj


def _related_files_cached(graph: dict, query: str, max_depth: int = 2) -> list[dict]:
    """Behavioral equivalent of knowledge_graph.find_related_files, but BFS-traverses
    a cached adjacency table (see _graph_adjacency) instead of rebuilding it per call.
    Returns [{"file", "distance"}] sorted by distance.
    """
    from knowledge_graph import find_node

    matches = find_node(graph, query)
    if not matches:
        return []

    adj = _graph_adjacency(graph)
    results = {}  # file_path → distance

    for match in matches[:3]:  # Top 3 matching entities (mirrors find_related_files)
        node_id = match["node"]["id"]
        if node_id not in graph["nodes"]:
            continue

        visited = {node_id}
        frontier = [node_id]
        for d in range(1, max_depth + 1):
            next_frontier = []
            for current_id in frontier:
                for other_id, _direction, _edge_type in adj[current_id]:
                    if not other_id or other_id in visited:
                        continue
                    visited.add(other_id)
                    next_frontier.append(other_id)
                    node = graph["nodes"].get(other_id)
                    if node and node.get("type") == "File":
                        file_path = node.get("name", other_id.replace("file:", ""))
                        if file_path not in results or results[file_path] > d:
                            results[file_path] = d
            frontier = next_frontier

    return sorted(
        ({"file": fp, "distance": dist} for fp, dist in results.items()),
        key=lambda x: x["distance"],
    )


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
            from knowledge_graph import find_node
        except ImportError:
            return 0.5

        # Try full query first, then individual terms
        all_related = {}
        query_terms = [query]

        # Split into sub-terms for Chinese/English
        # Chinese: extract bigrams for graph matching
        for run in re.findall(r"[\u4e00-\u9fff]+", query):
            for i in range(len(run) - 1):
                query_terms.append(run[i : i + 2])
        english_terms = re.findall(r"[a-zA-Z]{3,}", query)
        query_terms.extend(english_terms)

        for term in query_terms:
            if not find_node(graph, term):
                continue
            for r in _related_files_cached(graph, term, max_depth=2):
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


# H5 doc_class weights — multiplied with rerank score to suppress noisy classes.
# Markers are substrings matched against file_path; first hit wins (dict order).
DOC_CLASS_WEIGHTS = {
    "/session-digests/": 0.4,   # verbatim conversation logs, repeated grep/JSON
}


def doc_class_weight(file_path: str) -> float:
    """Multiplier for noisy document classes. 1.0 = neutral, <1.0 = downscale."""
    for marker, weight in DOC_CLASS_WEIGHTS.items():
        if marker in file_path:
            return weight
    return 1.0


def rerank(candidates: list[dict], query: str, weights: dict = None) -> list[dict]:
    """Multi-dimension reranking.

    candidates: [{chunk_id, file, score, preview, ...}]
    query: user query string
    weights: optional weight overrides

    Returns sorted candidates with final_score added.
    """
    w = weights or DEFAULT_WEIGHTS

    # Hoist per-candidate file reads out of the loop (was N+1).
    access_logs = _load_access_log()

    for c in candidates:
        file_path = c["file"]
        sem = c.get("score", 0.0)
        rec = recency_score(file_path)
        acc = access_frequency_score(file_path, access_logs)
        gph = graph_proximity_score(file_path, query)
        cls = doc_class_weight(file_path)

        c["scores"] = {
            "semantic": round(sem, 4),
            "recency": round(rec, 4),
            "access": round(acc, 4),
            "graph": round(gph, 4),
            "class": round(cls, 4),
        }
        c["final_score"] = round(
            cls * (
                w["semantic"] * sem
                + w["recency"] * rec
                + w["access"] * acc
                + w["graph"] * gph
            ),
            4,
        )

    candidates.sort(key=lambda x: x["final_score"], reverse=True)
    return candidates


# ============================================================
# Search API
# ============================================================


# Maximum index age before auto-rebuild (hours)
INDEX_MAX_AGE_HOURS = 24

# In-process index cache (avoids re-reading 4.7MB gzip on every search)
_index_cache = None
_index_cache_mtime = 0


def load_index(allow_rebuild: bool = False) -> dict | None:
    """Load the vector index with in-process caching.

    First call: decompress from disk (~1-2s).
    Subsequent calls in same process: instant from memory.

    allow_rebuild=False (default, query/read path): serve the on-disk index
    even if stale; never trigger an inline build_index (~51s). Rebuilds are
    left to the CI cron entrypoint. allow_rebuild=True (CI/build path) keeps
    the auto-rebuild on missing/stale index.
    """
    global _index_cache, _index_cache_mtime

    needs_build = False

    if not VECTORS_FILE.exists():
        needs_build = True
    else:
        file_mtime = VECTORS_FILE.stat().st_mtime
        # Check staleness
        age_hours = (datetime.now() - datetime.fromtimestamp(file_mtime)).total_seconds() / 3600
        if age_hours > INDEX_MAX_AGE_HOURS:
            needs_build = True

        # Serve cached when the file is unchanged, unless a rebuild is both
        # needed and permitted (then fall through to rebuild). On the read
        # path (allow_rebuild=False) a stale-but-cached index is fine.
        cache_fresh = _index_cache is not None and file_mtime == _index_cache_mtime
        if cache_fresh and not (needs_build and allow_rebuild):
            return _index_cache

    # Query/read path: never inline-rebuild — serve the (possibly stale) file.
    if needs_build and allow_rebuild:
        print(f"  索引{'不存在' if not VECTORS_FILE.exists() else '已过期'}，自动重建...")
        try:
            build_index()
        except Exception as e:
            print(f"  自动重建失败: {e}")
            if not VECTORS_FILE.exists():
                return None

    try:
        with gzip.open(VECTORS_FILE, "rt", encoding="utf-8") as f:
            _index_cache = json.load(f)
        _index_cache_mtime = VECTORS_FILE.stat().st_mtime
        return _index_cache
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

    is_dense = index.get("meta", {}).get("layer", "tfidf") != "tfidf"

    if is_dense:
        q_vec = embedding_query_vector(query)
    else:
        q_vec = query_to_vector(query, index["idf"], index["vocabulary"])

    if not q_vec:
        return []

    # Score chunks. For sparse TF-IDF, use the inverted index to score only
    # candidates sharing >=1 query token — exact-equivalent to the full scan
    # (chunks with no shared token have cosine 0, below the 0.01 threshold).
    # Dense vectors share no tokens, so they always full-scan.
    sim_fn = cosine_similarity_dense if is_dense else cosine_similarity
    vectors = index["vectors"]
    inverted = index.get("inverted") if not is_dense else None

    if inverted is not None:
        candidate_ids = set()
        for token in q_vec:
            candidate_ids.update(inverted.get(token, ()))
        candidate_items = ((cid, vectors[cid]) for cid in candidate_ids if cid in vectors)
    else:
        candidate_items = vectors.items()

    results = []
    for chunk_id, vec in candidate_items:
        sim = sim_fn(q_vec, vec)
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

    final = deduped[:top_k]

    # Reflexion: log search failures for pattern analysis
    if not final:
        try:
            from reflexion import log_search_failure
            log_search_failure(query, tokenize(query))
        except Exception:
            pass

    return final


def synthesize(query: str, results: list[dict]) -> str | None:
    """Cross-document synthesis: connect findings from multiple sources.

    When results span 2+ different data categories, generates a brief
    synthesis showing how they relate. Requires ANTHROPIC_API_KEY.
    Returns a synthesis string, or None if not needed/available.
    """
    if len(results) < 2:
        return None

    # Check if results come from diverse sources
    categories = set()
    for r in results:
        f = r.get("file", "")
        if "wiki/docs" in f:
            categories.add("wiki")
        elif "wiki/data" in f:
            categories.add("game-data")
        elif "news/" in f:
            categories.add("news")
        elif "discord" in f:
            categories.add("discord")
        elif "memory/" in f:
            categories.add("memory")
        elif "scripts/" in f:
            categories.add("code")
        else:
            categories.add("other")

    # Only synthesize if results span 2+ categories
    if len(categories) < 2:
        return None

    try:
        import anthropic
        client = anthropic.Anthropic()
    except Exception:
        return None

    # Build context from result previews
    context_parts = []
    for i, r in enumerate(results[:5]):
        context_parts.append(f"[{r['file']}]\n{r.get('preview', '')}")

    prompt = f"""用户查询：{query}

以下是来自不同数据源的检索结果：

{"---".join(context_parts)}

请用 2-3 句话综合这些信息，说明它们之间的关联。只输出综合分析，不要重复原始内容。如果信息之间没有有意义的关联，回答"无需综合"。"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        result = response.content[0].text.strip()
        if result and result != "无需综合":
            return result
    except Exception:
        pass

    return None


# ============================================================
# Tier 3: Discord JSONL On-Demand Search
# ============================================================


def search_discord_messages(query: str, max_results: int = 10,
                            days_back: int = 30) -> list[dict]:
    """Search Discord JSONL archives directly for specific messages.

    This is the Tier 3 search: only called when TF-IDF results suggest
    Discord relevance or when explicitly searching community discussions.
    Scans JSONL files from recent days first.
    """
    channels_dir = REPO / DISCORD_CHANNELS_DIR
    if not channels_dir.exists():
        return []

    query_lower = query.lower()
    query_tokens = set(tokenize(query))
    cutoff = date.today().isoformat()
    # Calculate cutoff date
    from datetime import timedelta
    cutoff_date = (date.today() - timedelta(days=days_back)).isoformat()

    results = []
    files_scanned = 0

    # Iterate channel directories
    for channel_dir in sorted(channels_dir.iterdir()):
        if not channel_dir.is_dir():
            continue
        # Scan JSONL files (named by date), newest first
        jsonl_files = sorted(channel_dir.glob("*.jsonl"), reverse=True)
        for jf in jsonl_files:
            # Date filter from filename
            date_str = jf.stem  # e.g. "2026-04-12"
            if date_str < cutoff_date:
                break  # Older files, skip rest of channel

            files_scanned += 1
            try:
                for line in jf.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    content = msg.get("content", "")
                    if not content:
                        continue
                    # Quick keyword match
                    content_lower = content.lower()
                    if query_lower in content_lower or any(
                        t in content_lower for t in query_tokens if len(t) > 2
                    ):
                        results.append({
                            "file": str(jf.relative_to(REPO)),
                            "author": msg.get("author_name", "?"),
                            "content": content[:300],
                            "timestamp": msg.get("timestamp", ""),
                            "channel_id": msg.get("channel_id", ""),
                            "reactions": sum(
                                r.get("count", 0)
                                for r in msg.get("reactions", [])
                            ),
                        })
            except (OSError, UnicodeDecodeError):
                continue

    # Sort by timestamp (newest first), then by reactions
    results.sort(key=lambda x: (x.get("timestamp", ""), x.get("reactions", 0)),
                 reverse=True)
    return results[:max_results]


# ============================================================
# Art Asset Metadata Indexing
# ============================================================


def discover_art_assets() -> list[dict]:
    """Generate searchable chunks from art asset filenames and metadata."""
    chunks = []
    portraits_dir = REPO / "assets" / "images" / "portraits"
    if portraits_dir.exists():
        names = sorted(f.stem for f in portraits_dir.glob("*.png"))
        if names:
            text = "Art assets: character portraits\n"
            text += "Characters with portraits: " + ", ".join(names)
            chunks.append({
                "file": "assets/images/portraits/",
                "chunk_id": "assets/images/portraits/#metadata",
                "text": text,
                "offset": 0,
            })

    # Also index art_assets.json if it exists (already covered by KNOWLEDGE_GLOBS
    # via projects/wiki/data/db/*.json, but the portrait dir itself is binary)
    return chunks


# ============================================================
# Index Building
# ============================================================


# ============================================================
# Layer 2: API Embedding (optional upgrade)
# ============================================================


def get_embedding_client():
    """Get Voyage AI client if available."""
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        return None
    try:
        import voyageai
        return voyageai.Client(api_key=api_key)
    except ImportError:
        return None


def build_embedding_index(chunks: list[dict]) -> dict:
    """Build dense embedding vectors using Voyage AI API."""
    client = get_embedding_client()
    if not client:
        return {}

    texts = [c["text"][:2000] for c in chunks]  # Voyage limit
    print(f"  Voyage AI: encoding {len(texts)} chunks...")

    # Batch encode (Voyage supports up to 128 per batch)
    all_embeddings = []
    batch_size = 64
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        try:
            result = client.embed(batch, model="voyage-3", input_type="document")
            all_embeddings.extend(result.embeddings)
        except Exception as e:
            print(f"  Voyage API error at batch {i}: {e}")
            return {}

    if len(all_embeddings) != len(chunks):
        print(f"  Embedding count mismatch: {len(all_embeddings)} vs {len(chunks)}")
        return {}

    # Build index with dense vectors
    vectors = {}
    chunk_meta = {}
    for chunk, emb in zip(chunks, all_embeddings):
        cid = chunk["chunk_id"]
        # Store as list (dense vector)
        vectors[cid] = emb
        chunk_meta[cid] = {
            "file": chunk["file"],
            "preview": chunk["text"][:150],
            "offset": chunk["offset"],
        }

    return {
        "vocabulary": {},  # Not used for embeddings
        "idf": {},
        "vectors": vectors,
        "chunks": chunk_meta,
    }


def embedding_query_vector(query: str) -> list[float] | None:
    """Encode a query using Voyage AI."""
    client = get_embedding_client()
    if not client:
        return None
    try:
        result = client.embed([query], model="voyage-3", input_type="query")
        return result.embeddings[0]
    except Exception:
        return None


def cosine_similarity_dense(v1: list, v2: list) -> float:
    """Cosine similarity for dense vectors (lists)."""
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = sum(a * a for a in v1) ** 0.5
    norm2 = sum(a * a for a in v2) ** 0.5
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


def build_index() -> dict:
    """Build complete vector index from all knowledge files.

    Automatically selects Layer 2 (Voyage AI) if VOYAGE_API_KEY is set,
    otherwise falls back to Layer 1 (TF-IDF).
    """
    files = discover_files()
    # Deduplicate (multiple globs can match same file)
    seen = set()
    unique_files = []
    for fp in files:
        if fp not in seen:
            seen.add(fp)
            unique_files.append(fp)
    files = unique_files
    print(f"  发现 {len(files)} 个知识文件")

    # Categorize files for reporting
    categories = defaultdict(int)
    for fp in files:
        rel = str(fp.relative_to(REPO))
        if rel.startswith("memory/"):
            categories["memory"] += 1
        elif rel.startswith("projects/wiki/data/"):
            categories["wiki-data"] += 1
        elif rel.startswith("projects/wiki/docs/"):
            categories["wiki-docs"] += 1
        elif rel.startswith("projects/news/data/discord/"):
            categories["discord"] += 1
        elif rel.startswith("projects/news/"):
            categories["news"] += 1
        elif rel.startswith("assets/"):
            categories["assets"] += 1
        elif rel.startswith("scripts/"):
            categories["scripts"] += 1
        elif rel.startswith(".github/"):
            categories["ci"] += 1
        else:
            categories["other"] += 1

    for cat, count in sorted(categories.items(), key=lambda x: x[1], reverse=True):
        print(f"    {cat}: {count} 文件")

    all_chunks = []
    errors = 0
    for fp in files:
        try:
            chunks = chunk_file(fp)
            all_chunks.extend(chunks)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    跳过 {fp.name}: {e}")

    # Add art asset metadata chunks
    art_chunks = discover_art_assets()
    all_chunks.extend(art_chunks)
    if art_chunks:
        print(f"  + {len(art_chunks)} 个美术资产元数据块")

    print(f"  切分为 {len(all_chunks)} 个文本块")
    if errors:
        print(f"  ({errors} 个文件跳过)")

    # Try Layer 2 first
    layer = "tfidf"
    if os.environ.get("VOYAGE_API_KEY"):
        print("  检测到 VOYAGE_API_KEY -> 使用 Layer 2 (API Embedding)")
        index = build_embedding_index(all_chunks)
        if index and index.get("vectors"):
            layer = "voyage-3"
        else:
            print("  Layer 2 失败，回退到 Layer 1 (TF-IDF)")
            index = build_tfidf_index(all_chunks)
    else:
        index = build_tfidf_index(all_chunks)

    index["meta"] = {
        "generated": TODAY.isoformat(),
        "generator": "memory_search.py v2 (full coverage)",
        "files_count": len(files),
        "chunks_count": len(all_chunks),
        "vocab_size": len(index.get("vocabulary", {})),
        "layer": layer,
        "categories": dict(categories),
        "discord_jsonl_available": (REPO / DISCORD_CHANNELS_DIR).exists(),
    }

    # Save as gzip-compressed JSON (compact, no indent)
    VECTORS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(VECTORS_FILE, "wt", encoding="utf-8", compresslevel=6) as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = VECTORS_FILE.stat().st_size / 1024
    print(f"  词汇表：{len(index['vocabulary'])} 个词")
    print(f"  向量数：{len(index['vectors'])} 个")
    print(f"  索引文件：{VECTORS_FILE.relative_to(REPO)} ({size_kb:.0f}KB)")

    return index


# ============================================================
# CLI
# ============================================================


def print_results(results: list[dict], query: str):
    """Pretty-print search results with optional cross-document synthesis."""
    if not results:
        print(f"\n  没有找到与「{query}」相关的结果")
        return

    print(f"\n  搜索「{query}」- 找到 {len(results)} 个相关知识块\n")
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

    # Cross-document synthesis
    synthesis = synthesize(query, results)
    if synthesis:
        print(f"  -- 综合分析 --")
        print(f"  {synthesis}")
        print()


def print_stats():
    """Print index statistics."""
    index = load_index()
    if not index:
        print("  索引不存在")
        return

    meta = index.get("meta", {})
    print(f"\n  向量索引统计")
    print(f"  生成时间：{meta.get('generated', '?')}")
    print(f"  生成器：{meta.get('generator', '?')}")
    print(f"  索引层级：{meta.get('layer', '?')}")
    print(f"  文件数量：{meta.get('files_count', '?')}")
    print(f"  文本块数：{meta.get('chunks_count', '?')}")
    print(f"  词汇表大小：{meta.get('vocab_size', '?')}")
    print(f"  向量数量：{len(index.get('vectors', {}))}")

    # Category breakdown
    categories = meta.get("categories", {})
    if categories:
        print(f"\n  数据类别分布：")
        for cat, count in sorted(categories.items(), key=lambda x: x[1], reverse=True):
            print(f"    {cat}: {count} 文件")

    # Discord JSONL availability
    if meta.get("discord_jsonl_available"):
        print(f"\n  Discord JSONL 按需搜索：可用 (--discord 模式)")

    # File distribution
    files = defaultdict(int)
    for cid in index.get("vectors", {}):
        chunk_meta = index["chunks"].get(cid, {})
        files[chunk_meta.get("file", "?")] += 1

    print(f"\n  文件分布 TOP 15（按块数）：")
    for f, count in sorted(files.items(), key=lambda x: x[1], reverse=True)[:15]:
        print(f"    {count:3d} 块 - {f}")


def print_discord_results(results: list[dict], query: str):
    """Pretty-print Discord message search results."""
    if not results:
        print(f"\n  Discord 消息中没有找到与「{query}」相关的结果")
        return

    print(f"\n  Discord 消息搜索「{query}」- 找到 {len(results)} 条\n")
    for i, r in enumerate(results, 1):
        ts = r.get("timestamp", "?")[:16]
        author = r.get("author", "?")
        reactions = r.get("reactions", 0)
        content = r["content"].replace("\n", " ")[:150]
        print(f"  [{i}] {ts} @{author} (reactions: {reactions})")
        print(f"      {content}")
        print()


def main():
    args = sys.argv[1:]

    do_build = "--build" in args
    do_stats = "--stats" in args
    do_discord = "--discord" in args
    query_args = [a for a in args if not a.startswith("--")]
    query = " ".join(query_args) if query_args else None

    if do_build:
        print(f"构建向量索引 - {TODAY}")
        build_index()
        print("  索引构建完成")

    if do_stats:
        print_stats()

    if query and do_discord:
        # Discord-specific message search
        results = search_discord_messages(query)
        print_discord_results(results, query)
    elif query:
        results = search(query)
        print_results(results, query)
    elif not do_build and not do_stats:
        print("用法:")
        print('  python scripts/memory_search.py "查询内容"')
        print("  python scripts/memory_search.py --build")
        print("  python scripts/memory_search.py --stats")
        print('  python scripts/memory_search.py --discord "Discord消息搜索"')


if __name__ == "__main__":
    main()
