"""
TF-IDF search engine for BPT Server.

Loads the compressed index built by indexer.py and provides two search
methods: plain cosine similarity and 4-dimension reranked search
(semantic + recency + access frequency + graph proximity).
"""

import gzip
import json
import math
import os
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .. import config
from .indexer import build_index, needs_rebuild
from .tokenizer import tokenize


# -- Data structures ---------------------------------------------------------


@dataclass
class SearchResult:
    """A single search result with per-dimension scoring breakdown."""
    file: str
    score: float
    preview: str
    chunk_idx: int = 0
    scores: Dict[str, float] = field(default_factory=dict)


# -- Search engine -----------------------------------------------------------


class SearchEngine:
    """TF-IDF search engine with lazy index loading and optional reranking.

    The index is loaded from vectors.json.gz on first query.  If the index
    is stale (older than INDEX_MAX_AGE_HOURS) it is rebuilt automatically.
    """

    def __init__(self) -> None:
        self._vocabulary: Optional[Dict[str, int]] = None
        self._idf: Optional[List[float]] = None
        self._vectors: Optional[List[Dict[str, Any]]] = None
        self._chunks: Optional[List[Dict[str, Any]]] = None
        self._meta: Optional[Dict[str, Any]] = None
        self._loaded: bool = False

    # -- Index management ----------------------------------------------------

    def _load_index(self) -> None:
        """Read and decompress vectors.json.gz into memory."""
        idx_path = config.index_path("vectors.json.gz")

        with gzip.open(idx_path, "rt", encoding="utf-8") as f:
            data = json.loads(f.read())

        self._vocabulary = data["vocabulary"]
        self._idf = data["idf"]
        self._vectors = data["vectors"]
        self._chunks = data["chunks"]
        self._meta = data.get("meta", {})
        self._loaded = True

    def _ensure_index(self) -> None:
        """Ensure index is loaded, rebuilding first if stale or missing."""
        if needs_rebuild():
            build_index()
        if not self._loaded:
            self._load_index()

    @property
    def meta(self) -> Dict[str, Any]:
        """Return index metadata (triggers load if needed)."""
        self._ensure_index()
        return self._meta or {}

    # -- Query vectorization -------------------------------------------------

    def _query_vector(self, query: str) -> Dict[int, float]:
        """Convert a query string into an L2-normalized sparse TF-IDF vector.

        Returns a dict mapping vocabulary dimension index to weight.
        """
        tokens = tokenize(query)
        if not tokens:
            return {}

        tf: Counter = Counter(tokens)
        max_freq = max(tf.values())

        vec: Dict[int, float] = {}
        for word, count in tf.items():
            if word not in self._vocabulary:
                continue
            dim = self._vocabulary[word]
            aug_tf = 0.5 + 0.5 * (count / max_freq)
            idf_val = self._idf[dim] if dim < len(self._idf) else 0.0
            vec[dim] = aug_tf * idf_val

        # L2-normalize
        norm = math.sqrt(sum(v * v for v in vec.values()))
        if norm > 0:
            vec = {d: v / norm for d, v in vec.items()}

        return vec

    # -- Cosine similarity on sparse vectors ---------------------------------

    @staticmethod
    def _sparse_dot(
        query_vec: Dict[int, float],
        chunk_dims: List[int],
        chunk_vals: List[float],
    ) -> float:
        """Compute dot product between a query sparse vector and a stored
        chunk vector.  Both are L2-normalized so dot == cosine similarity.

        Iterates over the query dimensions and looks up matching entries
        in the chunk vector (converted to a dict for O(1) access).
        """
        if not query_vec or not chunk_dims:
            return 0.0

        # Build lookup from chunk vector
        chunk_map: Dict[int, float] = {}
        for d, v in zip(chunk_dims, chunk_vals):
            chunk_map[d] = v

        dot = 0.0
        for dim, qval in query_vec.items():
            cval = chunk_map.get(dim)
            if cval is not None:
                dot += qval * cval
        return dot

    # -- Plain search --------------------------------------------------------

    def search(self, query: str, top_k: int = 5) -> List[SearchResult]:
        """Search the index for chunks most similar to *query*.

        Args:
            query: Free-text search query (Chinese, English, or mixed).
            top_k: Number of results to return.

        Returns:
            List of SearchResult sorted by descending cosine similarity.
        """
        self._ensure_index()

        query_vec = self._query_vector(query)
        if not query_vec:
            return []

        scored: List[tuple] = []
        for idx, vec_data in enumerate(self._vectors):
            dims = vec_data.get("dims", [])
            vals = vec_data.get("vals", [])
            sim = self._sparse_dot(query_vec, dims, vals)
            if sim > 0:
                scored.append((idx, sim))

        # Sort descending by similarity
        scored.sort(key=lambda x: x[1], reverse=True)
        scored = scored[:top_k]

        results: List[SearchResult] = []
        for idx, sim in scored:
            chunk = self._chunks[idx]
            preview = chunk.get("text", "")[:300]
            results.append(SearchResult(
                file=chunk["file"],
                score=round(sim, 6),
                preview=preview,
                chunk_idx=chunk.get("chunk_idx", 0),
                scores={"semantic": round(sim, 6)},
            ))
        return results

    # -- Reranked search -----------------------------------------------------

    def search_with_reranking(
        self,
        query: str,
        top_k: int = 5,
        access_log: Optional[Dict[str, int]] = None,
        graph: Optional[Dict[str, float]] = None,
    ) -> List[SearchResult]:
        """Search with 4-dimension reranking.

        Retrieves top-50 candidates via plain cosine search, then rescores
        each with a weighted combination of:
          - semantic  (0.40): TF-IDF cosine similarity
          - recency   (0.25): exponential decay from file mtime
          - access_frequency (0.20): from access_log
          - graph_proximity  (0.15): from graph distance dict

        Args:
            query: Free-text search query.
            top_k: Number of final results to return.
            access_log: Optional dict mapping file path -> access count.
            graph: Optional dict mapping file path -> graph distance
                   (lower distance = closer relationship).

        Returns:
            List of SearchResult sorted by combined reranked score.
        """
        # Fetch a wider candidate pool for reranking
        candidates = self.search(query, top_k=50)
        if not candidates:
            return []

        access_log = access_log or {}
        graph = graph or {}

        # Weights
        w_semantic = 0.40
        w_recency = 0.25
        w_access = 0.20
        w_graph = 0.15

        # Normalize access counts for scoring
        max_access = max(access_log.values()) if access_log else 1

        reranked: List[SearchResult] = []
        for r in candidates:
            # Semantic: already computed
            s_semantic = r.scores.get("semantic", r.score)

            # Recency: exponential decay with 7-day half-life
            s_recency = _recency_score(r.file)

            # Access frequency: normalized count
            raw_access = access_log.get(r.file, 0)
            s_access = raw_access / max_access if max_access > 0 else 0.0

            # Graph proximity: convert distance to score
            # Lower distance = higher score; missing = 0.0
            distance = graph.get(r.file)
            if distance is not None and distance >= 0:
                s_graph = 1.0 / (1.0 + distance)
            else:
                s_graph = 0.0

            combined = (
                w_semantic * s_semantic
                + w_recency * s_recency
                + w_access * s_access
                + w_graph * s_graph
            )

            reranked.append(SearchResult(
                file=r.file,
                score=round(combined, 6),
                preview=r.preview,
                chunk_idx=r.chunk_idx,
                scores={
                    "semantic": round(s_semantic, 6),
                    "recency": round(s_recency, 6),
                    "access_frequency": round(s_access, 6),
                    "graph_proximity": round(s_graph, 6),
                },
            ))

        reranked.sort(key=lambda x: x.score, reverse=True)
        return reranked[:top_k]


# -- Helpers -----------------------------------------------------------------


def _recency_score(file_path: str) -> float:
    """Exponential decay score based on file modification time.

    Half-life = 7 days.  Score = exp(-ln2 * days_since_modified / 7).
    Returns 0.0 if the file cannot be stat'd.
    """
    try:
        mtime = os.path.getmtime(file_path)
    except OSError:
        return 0.0

    now = time.time()
    days_since = (now - mtime) / 86400.0
    if days_since < 0:
        days_since = 0.0

    # ln2 ~= 0.693147
    return math.exp(-0.693147 * days_since / 7.0)
