"""Self-contained deterministic Chinese segmenter for the blackpool memory provider.

Forward-maximum-match (FMM) over an optional plugin-local dictionary
(``dict.txt`` next to this file, one term per line), falling back to
overlapping bigrams for runs the dictionary does not cover. Latin words
pass through as-is.

Design contract (why bigram fallback is enough): index side and query side
run the SAME segmenter, so tokens always agree — recall never depends on
linguistic correctness, only on determinism. The dictionary just upgrades
domain terms to whole-word tokens (better Jaccard/FTS precision).

Zero dependencies, zero ML, zero network — mirrors the silver_tokenizer
philosophy but is fully portable (no repo data files required).
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

_LATIN = re.compile(r"[a-z][a-z0-9']+")
_CJK_RUN = re.compile(r"[一-鿿぀-ヿ가-힣]+")
_DICT_FILE = Path(__file__).resolve().parent / "dict.txt"


@lru_cache(maxsize=1)
def _dictionary() -> tuple[frozenset[str], int]:
    """Load ``dict.txt`` beside this module. Missing file = empty dict (pure bigram)."""
    try:
        terms = frozenset(
            t for t in (line.strip() for line in
                        _DICT_FILE.read_text(encoding="utf-8").splitlines())
            if len(t) >= 2
        )
    except OSError:
        terms = frozenset()
    maxlen = max((len(t) for t in terms), default=2)
    return terms, maxlen


def _seg_run(run: str, dic: frozenset[str], maxlen: int) -> list[str]:
    """FMM over one CJK run; dictionary hit = whole word, miss = overlapping bigram."""
    toks: list[str] = []
    i, n = 0, len(run)
    while i < n:
        hit = None
        for L in range(min(maxlen, n - i), 1, -1):
            w = run[i:i + L]
            if w in dic:
                hit = w
                break
        if hit:
            toks.append(hit)
            i += len(hit)
        else:
            if i + 1 < n:
                toks.append(run[i:i + 2])
            else:
                toks.append(run[i])
            i += 1
    return toks


def tokenize(text: str) -> list[str]:
    """Deterministic tokens: latin words + CJK FMM (bigram fallback). Order-preserving."""
    if not text:
        return []
    low = text.lower()
    dic, maxlen = _dictionary()
    toks: list[str] = []
    for m in re.finditer(r"[a-z][a-z0-9']+|[一-鿿぀-ヿ가-힣]+", low):
        piece = m.group(0)
        if _CJK_RUN.fullmatch(piece):
            toks.extend(_seg_run(piece, dic, maxlen))
        else:
            toks.append(piece)
    return toks


def seg_join(text: str) -> str:
    """Space-joined token stream for FTS/HRR consumption. Empty input -> ''. """
    toks = tokenize(text)
    return " ".join(toks) if toks else text
