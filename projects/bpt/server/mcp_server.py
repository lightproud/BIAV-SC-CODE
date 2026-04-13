"""
BPT Server -- MCP entry point.

Standalone MCP server for the BPT desktop terminal.
Provides 11 tools mirroring Silver Core's API, designed to work
independently without git.

Usage:
    python server/mcp_server.py              # Start MCP server (stdio transport)
    python server/mcp_server.py --list-tools # Print all tool names and exit
    python server/mcp_server.py --rebuild    # Rebuild indexes and exit
"""

import argparse
import json
import sys
import traceback
from typing import Any, Dict, List

from mcp.server.fastmcp import FastMCP

# -- Import implementation modules -------------------------------------------

from .search.engine import SearchEngine
from .search.indexer import build_index as _build_search_index
from .graph.builder import build_graph as _build_graph, load_graph as _load_graph
from .graph.query import query_entity as _query_entity, find_related_files as _find_related_files
from .memory.facts import store_facts as _store_facts
from .memory.utility import compute_utility as _compute_utility
from .memory.writeback import writeback as _writeback
from .context.recommender import recommend as _recommend
from .context.briefing import generate_briefing as _generate_briefing
from .context.cache import check as _check_cache
from .persona.character import (
    generate_prompt as _generate_prompt,
    generate_greeting as _generate_greeting,
    list_personas as _list_personas,
)

# -- Shared state ------------------------------------------------------------

_search_engine = SearchEngine()

# -- Server instance ---------------------------------------------------------

mcp = FastMCP("BPT Server")

# -- Tool definitions --------------------------------------------------------


@mcp.tool()
def memory_search(query: str, top_k: int = 5) -> Dict[str, Any]:
    """
    Semantic search across indexed project files.
    Uses TF-IDF with Chinese bigram + English word tokenization
    and 4-dimension reranking (semantic, recency, access, graph proximity).
    """
    try:
        results = _search_engine.search_with_reranking(query, top_k=top_k)
        return {
            "status": "ok",
            "query": query,
            "count": len(results),
            "results": [
                {
                    "file": r.file,
                    "score": round(r.score, 4),
                    "preview": r.preview,
                    "scores": {k: round(v, 4) for k, v in r.scores.items()},
                }
                for r in results
            ],
        }
    except FileNotFoundError:
        # Index not built yet -- build it first, then retry
        try:
            _build_search_index()
            results = _search_engine.search_with_reranking(query, top_k=top_k)
            return {
                "status": "ok",
                "query": query,
                "count": len(results),
                "results": [
                    {
                        "file": r.file,
                        "score": round(r.score, 4),
                        "preview": r.preview,
                        "scores": {k: round(v, 4) for k, v in r.scores.items()},
                    }
                    for r in results
                ],
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def graph_query(entity: str, depth: int = 1) -> Dict[str, Any]:
    """
    Query the knowledge graph for an entity and its neighbors.
    Returns the entity node and all connected nodes up to the specified depth.
    """
    try:
        graph = _load_graph()
        if graph is None:
            return {"status": "error", "error": "Knowledge graph not built. Run rebuild_indexes first."}
        result = _query_entity(graph, entity, depth=depth)
        return {"status": "ok", "entity": entity, "depth": depth, **result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def graph_related_files(entity: str, max_depth: int = 2) -> Dict[str, Any]:
    """
    Find files related to an entity through the knowledge graph.
    BFS traversal to find File-type nodes connected to the query entity.
    """
    try:
        graph = _load_graph()
        if graph is None:
            return {"status": "error", "error": "Knowledge graph not built. Run rebuild_indexes first."}
        result = _find_related_files(graph, entity, max_depth=max_depth)
        return {"status": "ok", "entity": entity, **result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def store_facts(facts: str) -> Dict[str, Any]:
    """
    Store facts into the knowledge base with semantic deduplication.
    Input: JSON array string or plain text. Each fact has content, optional category and source.
    Categories: decision / discovery / preference / convention / context / lesson.
    """
    try:
        return _store_facts(facts)
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def memory_utility(top_n: int = 10) -> Dict[str, Any]:
    """
    Rank files by utility score (EMA-weighted engagement, citations, recency, momentum).
    Returns the top-N most useful files.
    """
    try:
        result = _compute_utility()
        # Trim to top_n
        if "rankings" in result and len(result["rankings"]) > top_n:
            result["rankings"] = result["rankings"][:top_n]
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def check_cache(query: str) -> Dict[str, Any]:
    """
    Check the precomputed cache for a matching entry.
    Keyword substring matching against cached question patterns with TTL check.
    """
    try:
        return _check_cache(query)
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def recommend_context(query: str, role: str = "", max_files: int = 5) -> Dict[str, Any]:
    """
    Recommend context files for a query using 4-layer fusion:
    role defaults, semantic search, graph proximity, and utility adjustment.
    """
    try:
        return _recommend(query=query, role=role, max_files=max_files)
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def rebuild_indexes() -> Dict[str, Any]:
    """
    Rebuild all indexes: TF-IDF vectors, knowledge graph, memory utility.
    Full scan of DATA_ROOT with multi-format parsing.
    """
    results: Dict[str, Any] = {"status": "ok"}
    errors: List[str] = []

    # 1. Search index
    try:
        search_result = _build_search_index()
        results["search"] = search_result
        # Force reload in the engine
        _search_engine._loaded = False
    except Exception as e:
        errors.append(f"search: {e}")

    # 2. Knowledge graph
    try:
        graph_result = _build_graph()
        results["graph"] = graph_result
    except Exception as e:
        errors.append(f"graph: {e}")

    # 3. Memory utility
    try:
        utility_result = _compute_utility()
        results["utility"] = {"total_files": utility_result.get("total_files", 0)}
    except Exception as e:
        errors.append(f"utility: {e}")

    if errors:
        results["errors"] = errors
        if len(errors) == 3:
            results["status"] = "error"

    return results


@mcp.tool()
def memory_writeback(dry_run: bool = False) -> Dict[str, Any]:
    """
    Detect file changes (via mtime comparison) and write back extracted
    knowledge to the fact store and knowledge graph.
    """
    try:
        return _writeback(dry_run=dry_run)
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def session_briefing(role: str = "") -> Dict[str, Any]:
    """
    Generate a session briefing with recent changes, topic momentum,
    and recommended context. Uses mtime scanning instead of git log.
    """
    try:
        return _generate_briefing(role=role)
    except Exception as e:
        return {"status": "error", "error": str(e)}


@mcp.tool()
def character_persona(
    character: str = "erica",
    context: str = "",
    action: str = "prompt",
) -> Dict[str, Any]:
    """
    Load a character persona and generate a system prompt, greeting, or list available personas.
    Actions: prompt (generate system prompt), greeting (generate greeting), list (list personas).
    """
    try:
        if action == "list":
            return _list_personas()
        elif action == "greeting":
            return _generate_greeting(character=character)
        else:
            return _generate_prompt(character=character, context=context)
    except Exception as e:
        return {"status": "error", "error": str(e)}


# -- Tool registry (for --list-tools) ----------------------------------------

TOOL_NAMES: List[str] = [
    "memory_search",
    "graph_query",
    "graph_related_files",
    "store_facts",
    "memory_utility",
    "check_cache",
    "recommend_context",
    "rebuild_indexes",
    "memory_writeback",
    "session_briefing",
    "character_persona",
]


# -- CLI entry point ---------------------------------------------------------

def _list_tools() -> None:
    """Print all registered tool names to stdout."""
    print(f"BPT Server -- {len(TOOL_NAMES)} tools registered:")
    print()
    for name in TOOL_NAMES:
        print(f"  {name}")


def _run_rebuild() -> None:
    """Execute rebuild_indexes and print the result."""
    result = rebuild_indexes()
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="BPT Server -- MCP server for BPT desktop terminal",
    )
    parser.add_argument(
        "--list-tools",
        action="store_true",
        help="Print all tool names and exit",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Rebuild all indexes and exit",
    )

    args = parser.parse_args()

    if args.list_tools:
        _list_tools()
        sys.exit(0)

    if args.rebuild:
        _run_rebuild()
        sys.exit(0)

    # Default: run MCP server with stdio transport
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
