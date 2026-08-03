# Black Pool Memory Provider (blackpool)

Chinese-capable shell over the bundled `holographic` provider. Same SQLite
store (`$HERMES_HOME/memory_store.db`), same HRR algebra, same tools
(`fact_store` / `fact_feedback`) — plus deterministic Chinese word
segmentation so Chinese facts are actually retrievable.

## Why

Stock holographic tokenizes by whitespace and FTS5 `unicode61` treats a run
of CJK characters as ONE token, so a fact like 「守密人喜欢鎏金主题」 can
never be found by querying 「鎏金」. This provider segments both the index
side and the query side with the same FMM-plus-bigram segmenter
(`zh_seg.py` + optional `dict.txt`), which restores full-text, Jaccard, and
entity recall for Chinese while leaving English behavior identical.

## What changes vs holographic

| Chokepoint | Fix |
|---|---|
| FTS index | auxiliary `facts_fts_zh` table indexes segmented content+tags; auto-backfills facts stored before switchover |
| FTS query | query segmented before FTS5 sanitization |
| Jaccard | `_tokenize` segments query AND fact content |
| Entities | 「」『』《》"" quoted spans become entities (probe/related/reason for Chinese subjects) |
| HRR vectors | unchanged (raw content) — keeps probe/related/reason/contradict internally consistent |

## Setup

```bash
hermes config set memory.provider blackpool
```

Config is shared with holographic (`plugins.hermes-memory-store` in
`config.yaml`): `db_path`, `auto_extract` (keep `false` — its extraction
regexes are English-only), `default_trust`, `hrr_dim`.

Switching between `holographic` and `blackpool` is lossless in both
directions — same database file; `blackpool` just maintains one extra
index table.

## dict.txt

Optional, one term per line (>= 2 chars). Ships with the Silver Core domain
dictionary (character names, card terms, story units, worldview terms, Black
Pool engineering terms). Missing file degrades to pure bigram segmentation —
recall is unaffected (index and query always agree), only token granularity
changes.

## Requirements

None beyond the bundle: SQLite (stdlib), NumPy optional (HRR algebra;
pinned in the Black Pool portable bundle).
