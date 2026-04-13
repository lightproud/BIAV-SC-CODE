"""
TF-IDF index builder for BPT Server search.

Walks DATA_ROOT, parses files into chunks, builds vocabulary + sparse
TF-IDF vectors, and writes a compressed index to INDEX_DIR/vectors.json.gz.

Algorithm mirrors Silver Core (scripts/memory_search.py) but delegates
tokenization to search.tokenizer and file parsing to parsers/.
"""

import gzip
import json
import math
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from .. import config
from ..parsers import parse_file
from .tokenizer import tokenize


# -- File scanning -----------------------------------------------------------


def scan_files() -> List[str]:
    """Walk DATA_ROOT recursively and return indexable file paths.

    Respects config.SKIP_DIRS, config.INDEXABLE_EXTENSIONS, and
    config.MAX_FILE_SIZE.  Returns absolute path strings.
    """
    root = Path(config.DATA_ROOT)
    results: List[str] = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune skipped directories in-place so os.walk does not descend
        dirnames[:] = [
            d for d in dirnames if d not in config.SKIP_DIRS
        ]

        for fname in filenames:
            fpath = Path(dirpath) / fname
            ext = fpath.suffix.lower()
            if ext not in config.INDEXABLE_EXTENSIONS:
                continue
            try:
                if fpath.stat().st_size > config.MAX_FILE_SIZE:
                    continue
            except OSError:
                continue
            results.append(str(fpath))

    return sorted(results)


# -- Index building ----------------------------------------------------------


def build_index() -> Dict[str, Any]:
    """Build a TF-IDF index from all indexable files under DATA_ROOT.

    Steps:
      1. Scan files via scan_files().
      2. Parse each file into chunks.
      3. Tokenize every chunk.
      4. Build vocabulary capped at VOCAB_CAP by IDF score.
      5. Compute augmented-TF * IDF, keep TOP_DIMS_PER_VEC per chunk.
      6. L2-normalize each sparse vector.
      7. Save gzip-compressed JSON to INDEX_DIR/vectors.json.gz.

    Returns:
        Meta dict with built_at, total_files, total_chunks, vocab_size.
    """
    # -- 1. Scan ---
    file_paths = scan_files()

    # -- 2. Parse into chunks ---
    all_chunks: List[Dict[str, Any]] = []
    files_parsed = 0

    for fpath in file_paths:
        try:
            result = parse_file(fpath)
        except (FileNotFoundError, ValueError, OSError, UnicodeDecodeError):
            continue

        files_parsed += 1
        chunks = result.chunks if result.chunks else []
        # If the parser returned text but no chunks, treat the full text
        # as a single chunk so it still gets indexed.
        if not chunks and result.text:
            chunks = [result.text]

        for idx, chunk_text in enumerate(chunks):
            if not chunk_text or not chunk_text.strip():
                continue
            all_chunks.append({
                "file": fpath,
                "text": chunk_text,
                "chunk_idx": idx,
            })

    n_chunks = len(all_chunks)
    if n_chunks == 0:
        meta = {
            "built_at": datetime.now(timezone.utc).isoformat(),
            "total_files": files_parsed,
            "total_chunks": 0,
            "vocab_size": 0,
        }
        _save_index(
            vocabulary={},
            idf_list=[],
            vectors=[],
            chunks_meta=[],
            meta=meta,
        )
        return meta

    # -- 3. Tokenize ---
    chunk_token_lists: List[List[str]] = []
    doc_freq: Counter = Counter()

    for chunk in all_chunks:
        tokens = tokenize(chunk["text"])
        chunk_token_lists.append(tokens)
        unique = set(tokens)
        for tok in unique:
            doc_freq[tok] += 1

    # -- 4. Build vocabulary capped by IDF score ---
    # Compute raw IDF for every term, then take top VOCAB_CAP.
    raw_idf: Dict[str, float] = {}
    for word, df in doc_freq.items():
        raw_idf[word] = math.log(n_chunks / (1 + df))

    # Sort by IDF descending (rare-but-present terms rank higher).
    sorted_terms = sorted(raw_idf.keys(), key=lambda w: raw_idf[w], reverse=True)
    vocab_terms = sorted_terms[: config.VOCAB_CAP]

    vocabulary: Dict[str, int] = {word: idx for idx, word in enumerate(vocab_terms)}
    vocab_size = len(vocabulary)

    # IDF array aligned with vocabulary indices
    idf_list: List[float] = [0.0] * vocab_size
    for word, idx in vocabulary.items():
        idf_list[idx] = raw_idf[word]

    # -- 5 & 6. TF-IDF sparse vectors ---
    vectors: List[Dict[str, Any]] = []
    chunks_meta: List[Dict[str, Any]] = []

    for i, chunk in enumerate(all_chunks):
        tokens = chunk_token_lists[i]
        if not tokens:
            # Still record chunk metadata so indices stay aligned
            vectors.append({"dims": [], "vals": []})
            chunks_meta.append({
                "file": chunk["file"],
                "text": chunk["text"][:300],
                "chunk_idx": chunk["chunk_idx"],
            })
            continue

        tf: Counter = Counter(tokens)
        max_freq = max(tf.values())

        # Compute TF-IDF for terms in vocabulary
        scored: List[tuple] = []  # (dim_index, tfidf_value)
        for word, count in tf.items():
            if word not in vocabulary:
                continue
            dim = vocabulary[word]
            aug_tf = 0.5 + 0.5 * (count / max_freq)
            tfidf = aug_tf * idf_list[dim]
            scored.append((dim, tfidf))

        # Keep only TOP_DIMS_PER_VEC highest values
        if len(scored) > config.TOP_DIMS_PER_VEC:
            scored.sort(key=lambda x: x[1], reverse=True)
            scored = scored[: config.TOP_DIMS_PER_VEC]

        # L2-normalize
        norm = math.sqrt(sum(v * v for _, v in scored))
        if norm > 0:
            scored = [(d, v / norm) for d, v in scored]

        # Round for storage efficiency
        dims = [d for d, _ in scored]
        vals = [round(v, 6) for _, v in scored]

        vectors.append({"dims": dims, "vals": vals})
        chunks_meta.append({
            "file": chunk["file"],
            "text": chunk["text"][:300],
            "chunk_idx": chunk["chunk_idx"],
        })

    # -- 7. Save ---
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "total_files": files_parsed,
        "total_chunks": n_chunks,
        "vocab_size": vocab_size,
    }
    _save_index(vocabulary, idf_list, vectors, chunks_meta, meta)
    return meta


def _save_index(
    vocabulary: Dict[str, int],
    idf_list: List[float],
    vectors: List[Dict[str, Any]],
    chunks_meta: List[Dict[str, Any]],
    meta: Dict[str, Any],
) -> None:
    """Write the index as gzip-compressed JSON to INDEX_DIR/vectors.json.gz."""
    config.ensure_index_dir()
    out_path = config.index_path("vectors.json.gz")

    payload = {
        "vocabulary": vocabulary,
        "idf": [round(v, 6) for v in idf_list],
        "vectors": vectors,
        "chunks": chunks_meta,
        "meta": meta,
    }

    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with gzip.open(out_path, "wt", encoding="utf-8") as f:
        f.write(raw)


# -- Freshness check --------------------------------------------------------


def needs_rebuild() -> bool:
    """Return True if the index is missing or older than INDEX_MAX_AGE_HOURS."""
    idx_path = config.index_path("vectors.json.gz")
    if not os.path.exists(idx_path):
        return True

    try:
        mtime = os.path.getmtime(idx_path)
    except OSError:
        return True

    age_hours = (time.time() - mtime) / 3600.0
    return age_hours > config.INDEX_MAX_AGE_HOURS
