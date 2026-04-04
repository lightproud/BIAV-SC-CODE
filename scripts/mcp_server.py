"""
mcp_server.py — BIAV-SC Memory MCP Server

Exposes the Silver Core memory system as MCP tools,
accessible by any AI tool (Claude Code, Qoder, Cursor, etc.).

Tools: memory_search, graph_query, graph_related_files,
       memory_utility, check_cache, recommend_context, rebuild_indexes

Usage:
  python scripts/mcp_server.py              # Start server (stdio transport)

Config (.mcp.json at repo root):
  {"mcpServers": {"biav-sc-memory": {"command": "python", "args": ["scripts/mcp_server.py"]}}}
"""

import json
import sys
from pathlib import Path

# Ensure scripts/ is on path for imports
SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

REPO = SCRIPTS_DIR.parent

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    # Graceful fallback: print tool definitions as JSON for non-MCP environments
    print("mcp package not installed. Install with: pip install mcp", file=sys.stderr)
    print("Running in standalone mode — listing available tools.", file=sys.stderr)

    tools = [
        {"name": "memory_search", "description": "搜索银芯知识库"},
        {"name": "graph_query", "description": "查询知识图谱实体"},
        {"name": "graph_related_files", "description": "查找与实体相关的文件"},
        {"name": "memory_utility", "description": "查看文件效用排名"},
        {"name": "check_cache", "description": "查询预计算缓存"},
        {"name": "recommend_context", "description": "推荐上下文文件"},
        {"name": "rebuild_indexes", "description": "重建所有索引"},
    ]
    print(json.dumps(tools, ensure_ascii=False, indent=2))
    sys.exit(0)

mcp = FastMCP("biav-sc-memory")


# ============================================================
# Tool 1: Semantic Search
# ============================================================

@mcp.tool()
def memory_search(query: str, top_k: int = 5) -> str:
    """搜索银芯知识库，返回最相关的知识块。

    基于 TF-IDF 向量检索 + 4 维重排序（语义×新鲜度×访问频率×图谱距离）。
    支持中文和英文查询。

    Args:
        query: 搜索查询（自然语言）
        top_k: 返回结果数量，默认 5
    """
    from memory_search import search
    results = search(query, top_k=top_k)
    if not results:
        return json.dumps({"results": [], "message": f"未找到与「{query}」相关的结果"}, ensure_ascii=False)

    output = []
    for r in results:
        output.append({
            "file": r["file"],
            "score": r.get("final_score", r.get("score", 0)),
            "preview": r.get("preview", "")[:200],
            "scores": r.get("scores", {}),
        })
    return json.dumps({"query": query, "results": output}, ensure_ascii=False, indent=2)


# ============================================================
# Tool 2: Graph Entity Query
# ============================================================

@mcp.tool()
def graph_query(entity: str, depth: int = 1) -> str:
    """查询知识图谱中的实体及其关联。

    支持角色名、系统名、概念名等。返回实体属性和关联的邻居节点。

    Args:
        entity: 实体名称（如"黑池"、"洛水"、"联动"）
        depth: 遍历深度（1-3），默认 1
    """
    from knowledge_graph import load_graph, find_node, get_neighbors

    graph = load_graph()
    if not graph:
        return json.dumps({"error": "知识图谱不存在，请先运行 rebuild_indexes"}, ensure_ascii=False)

    matches = find_node(graph, entity)
    if not matches:
        return json.dumps({"error": f"未找到实体: {entity}"}, ensure_ascii=False)

    node = matches[0]["node"]
    result = get_neighbors(graph, node["id"], depth=min(depth, 3))

    # Simplify for output
    neighbors_summary = []
    for n in result.get("neighbors", [])[:20]:
        neighbors_summary.append({
            "name": n["node"].get("name", n["node"]["id"]),
            "type": n["node"].get("type", "?"),
            "edge": n["edge_type"],
            "direction": n["direction"],
            "depth": n["depth"],
        })

    return json.dumps({
        "entity": {"name": node["name"], "type": node["type"], "properties": node.get("properties", {})},
        "neighbors": neighbors_summary,
        "total_neighbors": len(result.get("neighbors", [])),
    }, ensure_ascii=False, indent=2)


# ============================================================
# Tool 3: Graph Related Files
# ============================================================

@mcp.tool()
def graph_related_files(entity: str, max_depth: int = 2) -> str:
    """查找与实体相关的文件，按图谱距离排序。

    用于快速定位与某个话题/角色/概念相关的所有知识文件。

    Args:
        entity: 实体名称
        max_depth: 最大遍历深度，默认 2
    """
    from knowledge_graph import load_graph, find_related_files as _find_related

    graph = load_graph()
    if not graph:
        return json.dumps({"error": "知识图谱不存在"}, ensure_ascii=False)

    related = _find_related(graph, entity, max_depth=min(max_depth, 3))
    return json.dumps({
        "entity": entity,
        "related_files": related[:10],
    }, ensure_ascii=False, indent=2)


# ============================================================
# Tool 4: Memory Utility Rankings
# ============================================================

@mcp.tool()
def memory_utility(top_n: int = 10) -> str:
    """查看记忆文件效用排名。

    基于 MemRL-lite 的 EMA 效用追踪，显示哪些文件最有价值，哪些可能需要归档。

    Args:
        top_n: 显示前 N 个文件，默认 10
    """
    from memrl import compute_utility

    utility = compute_utility()
    items = sorted(utility.items(), key=lambda x: x[1]["utility"], reverse=True)

    output = []
    for fp, data in items[:top_n]:
        output.append({
            "file": fp,
            "utility": data["utility"],
            "trend": data["trend"],
            "access_count": data["access_count"],
            "insight_citations": data["insight_citations"],
        })

    return json.dumps({"rankings": output, "total_files": len(utility)}, ensure_ascii=False, indent=2)


# ============================================================
# Tool 5: Check Precomputed Cache
# ============================================================

@mcp.tool()
def check_cache(query: str) -> str:
    """查询 Sleep-Time Compute 预计算缓存。

    深睡时预生成的常见问题答案。如果命中，可以直接引用而无需重新分析。

    Args:
        query: 查询内容
    """
    from dream import check_cache as _check_cache

    result = _check_cache(query)
    if result:
        return json.dumps({"hit": True, "entry": result}, ensure_ascii=False, indent=2)
    return json.dumps({"hit": False, "message": "缓存未命中，请使用 memory_search 进行完整搜索"}, ensure_ascii=False)


# ============================================================
# Tool 6: Recommend Context
# ============================================================

@mcp.tool()
def recommend_context(query: str, role: str = "", max_files: int = 5) -> str:
    """根据当前话题推荐应加载的知识文件（虚拟上下文管理）。

    综合向量检索 + 知识图谱 + 效用分数，推荐最相关的文件组合。
    新会话启动时调用此工具，获得最优的上下文加载方案。

    Args:
        query: 当前话题或用户的第一句话
        role: 会话角色（如 Code-wiki, Code-news），可选
        max_files: 最多推荐文件数，默认 5
    """
    try:
        from context_manager import recommend_context as _recommend
        result = _recommend(query, role=role, max_files=max_files)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ImportError:
        # Fallback: use search directly
        from memory_search import search
        results = search(query, top_k=max_files)
        files = [{"file": r["file"], "score": r.get("final_score", 0), "reason": "semantic_match"} for r in results]
        return json.dumps({"query": query, "recommended_files": files}, ensure_ascii=False, indent=2)


# ============================================================
# Tool 7: Rebuild Indexes
# ============================================================

@mcp.tool()
def rebuild_indexes() -> str:
    """重建所有索引（向量索引 + 知识图谱 + 效用分数）。

    在知识文件更新后调用，确保搜索和图谱反映最新内容。
    """
    results = {}

    try:
        from memory_search import build_index
        idx = build_index()
        results["vector_index"] = {
            "status": "ok",
            "chunks": len(idx.get("vectors", {})),
            "vocabulary": len(idx.get("vocabulary", {})),
        }
    except Exception as e:
        results["vector_index"] = {"status": "error", "message": str(e)}

    try:
        from knowledge_graph import build_graph
        graph = build_graph()
        results["knowledge_graph"] = {
            "status": "ok",
            "nodes": graph["meta"]["node_count"],
            "edges": graph["meta"]["edge_count"],
        }
    except Exception as e:
        results["knowledge_graph"] = {"status": "error", "message": str(e)}

    try:
        from memrl import compute_utility
        utility = compute_utility()
        results["memory_utility"] = {
            "status": "ok",
            "files_scored": len(utility),
        }
    except Exception as e:
        results["memory_utility"] = {"status": "error", "message": str(e)}

    return json.dumps(results, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
