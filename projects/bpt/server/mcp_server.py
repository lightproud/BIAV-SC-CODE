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
from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import FastMCP

# -- Server instance ---------------------------------------------------------

mcp = FastMCP("BPT Server")

# -- Tool definitions (Phase A stubs) ----------------------------------------

_STUB_MSG = "Phase A stub -- implementation pending"


@mcp.tool()
def memory_search(query: str, top_k: int = 5) -> Dict[str, Any]:
    """
    Semantic search across indexed project files.
    Uses TF-IDF with Chinese bigram + English word tokenization
    and 4-dimension reranking (semantic, recency, access, graph proximity).
    """
    return {
        "status": "not_implemented",
        "tool": "memory_search",
        "message": _STUB_MSG,
        "query": query,
        "top_k": top_k,
    }


@mcp.tool()
def graph_query(entity: str, depth: int = 1) -> Dict[str, Any]:
    """
    Query the knowledge graph for an entity and its neighbors.
    Returns the entity node and all connected nodes up to the specified depth.
    """
    return {
        "status": "not_implemented",
        "tool": "graph_query",
        "message": _STUB_MSG,
        "entity": entity,
        "depth": depth,
    }


@mcp.tool()
def graph_related_files(entity: str, max_depth: int = 2) -> Dict[str, Any]:
    """
    Find files related to an entity through the knowledge graph.
    BFS traversal to find File-type nodes connected to the query entity.
    """
    return {
        "status": "not_implemented",
        "tool": "graph_related_files",
        "message": _STUB_MSG,
        "entity": entity,
        "max_depth": max_depth,
    }


@mcp.tool()
def store_facts(facts: str) -> Dict[str, Any]:
    """
    Store facts into the knowledge base with semantic deduplication.
    Input: JSON array string or plain text. Each fact has content, optional category and source.
    Categories: decision / discovery / preference / convention / context / lesson.
    """
    return {
        "status": "not_implemented",
        "tool": "store_facts",
        "message": _STUB_MSG,
        "facts_input": facts,
    }


@mcp.tool()
def memory_utility(top_n: int = 10) -> Dict[str, Any]:
    """
    Rank files by utility score (EMA-weighted engagement, citations, recency, momentum).
    Returns the top-N most useful files.
    """
    return {
        "status": "not_implemented",
        "tool": "memory_utility",
        "message": _STUB_MSG,
        "top_n": top_n,
    }


@mcp.tool()
def check_cache(query: str) -> Dict[str, Any]:
    """
    Check the precomputed cache for a matching entry.
    Keyword substring matching against cached question patterns with TTL check.
    """
    return {
        "status": "not_implemented",
        "tool": "check_cache",
        "message": _STUB_MSG,
        "query": query,
    }


@mcp.tool()
def recommend_context(query: str, role: str = "", max_files: int = 5) -> Dict[str, Any]:
    """
    Recommend context files for a query using 4-layer fusion:
    role defaults, semantic search, graph proximity, and utility adjustment.
    """
    return {
        "status": "not_implemented",
        "tool": "recommend_context",
        "message": _STUB_MSG,
        "query": query,
        "role": role,
        "max_files": max_files,
    }


@mcp.tool()
def rebuild_indexes() -> Dict[str, Any]:
    """
    Rebuild all indexes: TF-IDF vectors, knowledge graph, memory utility.
    Full scan of DATA_ROOT with multi-format parsing.
    """
    return {
        "status": "not_implemented",
        "tool": "rebuild_indexes",
        "message": _STUB_MSG,
    }


@mcp.tool()
def memory_writeback(dry_run: bool = False) -> Dict[str, Any]:
    """
    Detect file changes (via mtime comparison) and write back extracted
    knowledge to the fact store and knowledge graph.
    """
    return {
        "status": "not_implemented",
        "tool": "memory_writeback",
        "message": _STUB_MSG,
        "dry_run": dry_run,
    }


@mcp.tool()
def session_briefing(role: str = "") -> Dict[str, Any]:
    """
    Generate a session briefing with recent changes, topic momentum,
    and recommended context. Uses mtime scanning instead of git log.
    """
    return {
        "status": "not_implemented",
        "tool": "session_briefing",
        "message": _STUB_MSG,
        "role": role,
    }


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
    return {
        "status": "not_implemented",
        "tool": "character_persona",
        "message": _STUB_MSG,
        "character": character,
        "context": context,
        "action": action,
    }


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
