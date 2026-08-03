"""blackpool — Chinese-capable holographic memory provider for Black Pool.

Entry point: ``register(ctx)`` -> ``ctx.register_memory_provider(...)``
(named here so upstream's user-plugin text-scan heuristic sees it early).

A thin extension shell over the bundled ``holographic`` provider: same SQLite
store, same HRR algebra, same tools (``fact_store`` / ``fact_feedback``) —
plus deterministic Chinese word segmentation (FMM + bigram fallback,
``zh_seg.py``) wired into the retrieval chokepoints that upstream leaves
whitespace-tokenized:

  1. FTS index side  — auxiliary ``facts_fts_zh`` table indexes SEGMENTED
     content+tags (stock ``facts_fts`` sees a CJK run as ONE token, so
     Chinese keyword recall is near-zero without this).
  2. FTS query side  — queries are segmented before FTS5 sanitization.
  3. Jaccard         — ``_tokenize`` segments both query and fact content.
  4. Entities        — CJK-quoted spans (「」『』《》 etc.) extracted as
     entities so probe/related/reason work for Chinese subjects.

HRR fact vectors stay computed from RAW content (upstream behavior), keeping
every algebra path (probe / related / reason / contradict) internally
consistent; those paths key on entity atoms, which segmentation must not
disturb. Content-level Chinese HRR is a possible v2.

Zero upstream intrusion: pure subclassing, discovered as a sibling provider.
Activate with ``hermes config set memory.provider blackpool``.
"""
from __future__ import annotations

import logging
import re

from plugins.memory.holographic import HolographicMemoryProvider, _load_plugin_config
from plugins.memory.holographic.store import MemoryStore
from plugins.memory.holographic.retrieval import FactRetriever

from . import zh_seg

logger = logging.getLogger(__name__)

# CJK quote pairs treated as entity markers (mirrors upstream's ASCII-quote
# heuristic). Length-capped so a fully quoted sentence is not an "entity".
_RE_CJK_QUOTED = [
    re.compile(r"「([^」]{1,16})」"),
    re.compile(r"『([^』]{1,16})』"),
    re.compile(r"《([^》]{1,16})》"),
    re.compile(r"“([^”]{1,16})”"),
]

_ZH_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts_zh
    USING fts5(content, tags);
"""


class ZhMemoryStore(MemoryStore):
    """MemoryStore with a parallel segmented FTS index for CJK recall."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        with self._lock:
            self._conn.executescript(_ZH_SCHEMA)
            self._backfill_zh_index()

    # -- segmented index maintenance ------------------------------------

    def _zh_index(self, fact_id: int, content: str, tags: str) -> None:
        self._conn.execute(
            "DELETE FROM facts_fts_zh WHERE rowid = ?", (fact_id,))
        self._conn.execute(
            "INSERT INTO facts_fts_zh(rowid, content, tags) VALUES (?, ?, ?)",
            (fact_id, zh_seg.seg_join(content), zh_seg.seg_join(tags)))

    def _backfill_zh_index(self) -> None:
        """Index facts created before this provider was active (seamless
        switchover from stock holographic on an existing memory_store.db)."""
        rows = self._conn.execute(
            "SELECT f.fact_id, f.content, f.tags FROM facts f "
            "WHERE f.fact_id NOT IN (SELECT rowid FROM facts_fts_zh)"
        ).fetchall()
        for r in rows:
            self._zh_index(r["fact_id"], r["content"], r["tags"] or "")
        if rows:
            logger.info("blackpool memory: backfilled %d facts into zh index", len(rows))

    # -- overridden mutations -------------------------------------------

    def add_fact(self, content: str, category: str = "general", tags: str = "") -> int:
        fact_id = super().add_fact(content, category=category, tags=tags)
        with self._lock:
            self._zh_index(fact_id, content.strip(), tags)
        return fact_id

    def update_fact(self, fact_id, content=None, trust_delta=None, tags=None, category=None) -> bool:
        ok = super().update_fact(fact_id, content=content, trust_delta=trust_delta,
                                 tags=tags, category=category)
        if ok and (content is not None or tags is not None):
            with self._lock:
                row = self._conn.execute(
                    "SELECT content, tags FROM facts WHERE fact_id = ?", (fact_id,)
                ).fetchone()
                if row:
                    self._zh_index(fact_id, row["content"], row["tags"] or "")
        return ok

    def remove_fact(self, fact_id: int) -> bool:
        ok = super().remove_fact(fact_id)
        if ok:
            with self._lock:
                self._conn.execute("DELETE FROM facts_fts_zh WHERE rowid = ?", (fact_id,))
        return ok

    # -- entity extraction: add CJK-quoted spans ------------------------

    def _extract_entities(self, content: str) -> list[str]:
        names = list(super()._extract_entities(content))
        seen = {n.lower() for n in names}
        for pat in _RE_CJK_QUOTED:
            for m in pat.findall(content):
                name = m.strip()
                if name and name.lower() not in seen:
                    names.append(name)
                    seen.add(name.lower())
        return names


class ZhFactRetriever(FactRetriever):
    """FactRetriever whose FTS + Jaccard legs speak segmented Chinese."""

    @staticmethod
    def _tokenize(text: str) -> set[str]:
        return set(zh_seg.tokenize(text))

    @classmethod
    def _sanitize_fts_query(cls, query: str) -> str:
        return FactRetriever._sanitize_fts_query(zh_seg.seg_join(query))

    def _fts_candidates(self, query, category, min_trust, limit) -> list[dict]:
        """Same shape as upstream, but MATCHed against ``facts_fts_zh``.

        The segmented table also carries every latin token, so it fully
        replaces (not merely supplements) the stock index for candidates.
        """
        conn = self.store._conn
        params: list = [self._sanitize_fts_query(query)]
        where_clauses = ["facts_fts_zh MATCH ?"]
        if category:
            where_clauses.append("f.category = ?")
            params.append(category)
        where_clauses.append("f.trust_score >= ?")
        params.append(min_trust)
        sql = f"""
            SELECT f.*, facts_fts_zh.rank as fts_rank_raw
            FROM facts_fts_zh
            JOIN facts f ON f.fact_id = facts_fts_zh.rowid
            WHERE {" AND ".join(where_clauses)}
            ORDER BY facts_fts_zh.rank
            LIMIT ?
        """
        params.append(limit)
        try:
            rows = conn.execute(sql, params).fetchall()
        except Exception:
            return []
        if not rows:
            return []
        raw_ranks = [abs(row["fts_rank_raw"]) for row in rows]
        max_rank = max(max(raw_ranks), 1e-6)
        results = []
        for row, raw_rank in zip(rows, raw_ranks):
            fact = dict(row)
            fact.pop("fts_rank_raw", None)
            fact["fts_rank"] = raw_rank / max_rank
            results.append(fact)
        return results


class BlackPoolMemoryProvider(HolographicMemoryProvider):
    """Holographic memory with deterministic Chinese segmentation."""

    @property
    def name(self) -> str:
        return "blackpool"

    def initialize(self, session_id: str, **kwargs) -> None:
        # Mirrors upstream holographic initialize(), constructing the
        # zh-capable store/retriever subclasses instead.
        from hermes_constants import get_hermes_home
        _hermes_home = str(get_hermes_home())
        db_path = self._config.get("db_path", _hermes_home + "/memory_store.db")
        if isinstance(db_path, str):
            db_path = db_path.replace("$HERMES_HOME", _hermes_home)
            db_path = db_path.replace("${HERMES_HOME}", _hermes_home)
        default_trust = float(self._config.get("default_trust", 0.5))
        hrr_dim = int(self._config.get("hrr_dim", 1024))
        hrr_weight = float(self._config.get("hrr_weight", 0.3))
        temporal_decay = int(self._config.get("temporal_decay_half_life", 0))

        self._store = ZhMemoryStore(db_path=db_path, default_trust=default_trust,
                                    hrr_dim=hrr_dim)
        self._retriever = ZhFactRetriever(
            store=self._store,
            temporal_decay_half_life=temporal_decay,
            hrr_weight=hrr_weight,
            hrr_dim=hrr_dim,
        )
        self._session_id = session_id

    def system_prompt_block(self) -> str:
        block = super().system_prompt_block()
        return block.replace(
            "# Holographic Memory",
            "# Black Pool Memory (holographic, zh-capable)")


def register(ctx) -> None:
    """Register the Black Pool memory provider with the plugin system."""
    provider = BlackPoolMemoryProvider(config=_load_plugin_config())
    ctx.register_memory_provider(provider)
