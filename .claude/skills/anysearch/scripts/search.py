#!/usr/bin/env python3
"""AnySearch web search — thin wrapper over the public api.anysearch.com endpoint.

Exit 0 with results on success. Exit non-zero on any failure (network, auth,
quota, empty results) so the caller can fall back to the built-in WebSearch tool.

API key (optional) is read from the ANYSEARCH_API_KEY env var; anonymous otherwise.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://api.anysearch.com/v1/search"


def search(query, max_results, freshness):
    body = {"query": query, "max_results": max_results}
    if freshness:
        body["constraint"] = {"freshness": freshness}
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("ANYSEARCH_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser(description="AnySearch web search")
    ap.add_argument("query")
    ap.add_argument("--max-results", type=int, default=8)
    ap.add_argument("--freshness", choices=["day", "week", "month", "year"])
    args = ap.parse_args()

    try:
        payload = search(args.query, args.max_results, args.freshness)
    except urllib.error.HTTPError as e:
        print(f"anysearch: HTTP {e.code} {e.reason}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"anysearch: network error: {e}", file=sys.stderr)
        return 1
    except json.JSONDecodeError:
        print("anysearch: invalid JSON response", file=sys.stderr)
        return 1

    if payload.get("code") != 0:
        print(f"anysearch: api error: {payload.get('message', 'unknown')}", file=sys.stderr)
        return 1

    data = payload.get("data") or {}
    results = data.get("results") or []
    if not results:
        print("anysearch: zero results", file=sys.stderr)
        return 1

    meta = data.get("metadata") or {}
    print(
        f"# AnySearch: {len(results)} results "
        f"({meta.get('search_time_ms', '?')}ms, "
        f"routes {meta.get('routes_succeeded', '?')}/{meta.get('routes_queried', '?')})\n"
    )
    for i, r in enumerate(results, 1):
        content = (r.get("content") or r.get("description") or "").strip()
        if len(content) > 600:
            content = content[:600] + "…"
        print(f"[{i}] {r.get('title', '').strip()}")
        print(f"    {r.get('url', '')}")
        if r.get("score") is not None:
            print(f"    score={r['score']:.1f}")
        if content:
            print(f"    {content}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
