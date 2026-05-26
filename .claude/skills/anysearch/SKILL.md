---
name: anysearch
description: Live web search via the AnySearch API for current or external information — community discussion, news, cross-region (CN/JP/TW) sources, and full-page content extraction. Use when a query needs up-to-date web results or sources beyond the local repo and the news pipeline. Falls back to the built-in WebSearch tool when AnySearch is unavailable.
---

# AnySearch web search

Thin wrapper over the public `api.anysearch.com/v1/search` endpoint (original code,
not vendored from the upstream skill). Use it for live web research — especially
multi-region community intel (Bilibili / Gamerch / あにまん / 巴哈姆特 etc.), where
it extracts discussion content, not just links.

## Usage

```
python3 .claude/skills/anysearch/scripts/search.py "<query>" [--max-results N] [--freshness day|week|month|year]
```

- Anonymous by default (rate-limited ~10 req/min per client IP).
- Set `ANYSEARCH_API_KEY` (env var / repo secret) for higher quota. Never commit the key.

## Fallback (required)

If `search.py` exits non-zero — network error, 401/403 (invalid/expired key),
429 / quota exhausted, or zero results — **fall back to the built-in `WebSearch`
tool with the same query**. Never block research on an AnySearch failure.
