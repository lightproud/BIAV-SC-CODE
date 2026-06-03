"""
mcp_server.py — BIAV-SC Memory MCP Server

Exposes the Silver Core memory system as MCP tools,
accessible by any AI tool (Claude Code, Qoder, Cursor, etc.).

Tools: memory_search, graph_query, graph_related_files,
       memory_utility, check_cache, recommend_context, rebuild_indexes,
       store_facts, memory_writeback, session_briefing, character_persona

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
        {"name": "session_briefing", "description": "新会话智能简报"},
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
    from memory_search import search, synthesize
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

    # Cross-document synthesis when results span multiple data categories
    synthesis = synthesize(query, results)

    response = {"query": query, "results": output}
    if synthesis:
        response["synthesis"] = synthesis
    return json.dumps(response, ensure_ascii=False, indent=2)


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


# ============================================================
# Tool 8: Store Facts (AI-driven knowledge write-back)
# ============================================================

@mcp.tool()
def store_facts(facts: str) -> str:
    """存储本次对话中发现的重要知识事实。

    当你在对话中遇到以下情况时，主动调用此工具：
    - 做出了技术/架构决策（如"选择 X 替代 Y，因为..."）
    - 发现了 bug 的根本原因
    - 了解到用户偏好或项目惯例
    - 获得了重要的背景知识

    自动去重：相似度 >75% 的事实会合并而非重复存储。

    Args:
        facts: JSON 数组字符串，每项含 content（必填）、category（可选：decision/discovery/preference/convention/context/lesson）、source（可选：来源文件路径）
              示例：[{"content": "FTS5 换成 MeiliSearch，中文分词更好", "category": "decision"}]
    """
    from fact_store import store_multiple_facts

    try:
        items = json.loads(facts)
        if isinstance(items, str):
            items = [{"content": items, "category": "discovery"}]
        elif isinstance(items, dict):
            items = [items]
    except json.JSONDecodeError:
        # Plain text — treat as single fact
        items = [{"content": facts, "category": "discovery"}]

    results = store_multiple_facts(items)

    summary = {"added": 0, "merged": 0, "duplicate": 0, "details": []}
    for r in results:
        action = r.get("action", "unknown")
        summary[action] = summary.get(action, 0) + 1
        summary["details"].append({
            "action": action,
            "content": r.get("fact", {}).get("content", r.get("existing", ""))[:80],
            "similarity": r.get("similarity"),
        })

    return json.dumps(summary, ensure_ascii=False, indent=2)


# ============================================================
# Tool 9: Memory Write-back (auto, git-based)
# ============================================================

@mcp.tool()
def memory_writeback(dry_run: bool = False) -> str:
    """将当前会话产生的新知识写回知识库。

    检测会话期间的文件变更，提取知识事实，更新知识图谱，
    生成会话摘要，并触发增量重索引。

    Args:
        dry_run: 仅预览，不实际写入。默认 False
    """
    from memory_writeback import run_writeback
    result = run_writeback(dry_run=dry_run)

    return json.dumps(result, ensure_ascii=False, indent=2)


# ============================================================
# Tool 10: Session Briefing (Memory Flywheel)
# ============================================================

@mcp.tool()
def session_briefing(role: str = "") -> str:
    """新会话启动时调用，获取智能 briefing。

    综合 6 个数据源生成动态简报：
    - 上次会话回顾（做了什么、决策、遗留事项）
    - 自上次以来的 git 变更
    - 做梦系统发现（异常、趋势）
    - 话题动量（最近焦点方向）
    - 效用趋势（哪些文件正在升温/降温）
    - 推荐上下文（基于动量的智能推荐）

    替代被动读取 boot-snapshot.md，提供主动、上下文感知的会话初始化。

    Args:
        role: 会话角色（如 Code-wiki, Code-news），可选
    """
    from session_briefing import generate_briefing, render_markdown as render_brief

    briefing = generate_briefing(role=role)
    # Return JSON with both structured data and pre-rendered markdown
    return json.dumps({
        "briefing_markdown": render_brief(briefing),
        "sections": briefing.get("sections", {}),
        "generated_at": briefing.get("generated_at", ""),
    }, ensure_ascii=False, indent=2)


# ============================================================
# Tool 11: Character Persona
# ============================================================

@mcp.tool()
def character_persona(character: str = "erica", context: str = "", action: str = "prompt") -> str:
    """激活角色人格模式，让AI以游戏角色的语气进行对话。

    当前可用角色：艾瑞卡（erica）——弥萨格大学自动人偶，数据库终端。
    她也是个机器人，与银芯系统的身份完美契合。

    三种操作模式：
    - prompt: 生成角色扮演系统提示词（默认）
    - greeting: 生成角色开场白
    - list: 列出所有可用角色

    跨平台支持：银芯（MCP）、黑池系统。

    Args:
        character: 角色ID（默认 erica）
        context: 当前对话上下文，用于定制提示词（可选）
        action: 操作类型 prompt/greeting/list（默认 prompt）
    """
    from character_persona import load_persona, list_personas, build_system_prompt, build_greeting

    if action == "list":
        personas = list_personas()
        return json.dumps({
            "available_personas": personas,
            "total": len(personas),
        }, ensure_ascii=False, indent=2)

    persona = load_persona(character)
    if not persona:
        available = list_personas()
        return json.dumps({
            "error": f"未找到角色: {character}",
            "available": [p["id"] for p in available],
        }, ensure_ascii=False, indent=2)

    if action == "greeting":
        return json.dumps({
            "character": character,
            "name": persona["name"],
            "greeting": build_greeting(persona, platform="silver_core"),
        }, ensure_ascii=False, indent=2)

    # Default: generate system prompt
    prompt = build_system_prompt(persona, context=context, platform="silver_core")
    return json.dumps({
        "character": character,
        "name": persona["name"],
        "system_prompt": prompt,
        "usage": "将 system_prompt 内容作为系统提示词注入对话，AI 将以该角色语气回复",
    }, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 银芯记忆增强工具（2026-04-14 新增，面向黑池需求 4 黑池记忆）
# 对标 claude-mem 能力但纯 MIT 自建
# 详见 memory/silver-memory-enhancement-plan.md
# ---------------------------------------------------------------------------


@mcp.tool()
def recall_session(query: str, k: int = 5) -> str:
    """在历史 session digest 中语义搜索相关 session（TF-IDF + 4 维重排）。

    Args:
        query: 搜索关键词
        k: 返回数量（默认 5）

    Returns:
        JSON: {"matches": [{"session_id","digest_path","score","excerpt"}]}
    """
    from silver_memory_tools import recall_session as _recall

    return json.dumps(_recall(query, k), ensure_ascii=False, indent=2)


@mcp.tool()
def current_continuity() -> str:
    """读取 session 连续性链（上次 session 快照 + topics_hint）。

    Returns:
        JSON: session-continuity.json 内容 + last_session_file + topics_hint
    """
    from silver_memory_tools import current_continuity as _cc

    return json.dumps(_cc(), ensure_ascii=False, indent=2)


@mcp.tool()
def record_decision(summary: str, scope: str, rationale: str = "") -> str:
    """追加决策条目到 memory/decisions.md 的当前有效决策表格末尾。

    Args:
        summary: 决策摘要（一句话）
        scope: 影响范围（"全局" / "子项目名" / 等）
        rationale: 理由（可选）

    Returns:
        JSON: {"status": "ok|error", "line_added": "..."}
    """
    from silver_memory_tools import record_decision as _rd

    return json.dumps(_rd(summary, scope, rationale), ensure_ascii=False, indent=2)


@mcp.tool()
def record_lesson(summary: str, context: str = "") -> str:
    """追加教训条目到 memory/lessons-learned.md 末尾。

    Args:
        summary: 教训摘要
        context: 触发场景（可选）

    Returns:
        JSON: {"status": "ok|error", "lesson_id": "..."}
    """
    from silver_memory_tools import record_lesson as _rl

    return json.dumps(_rl(summary, context), ensure_ascii=False, indent=2)


@mcp.tool()
def session_progress(session_id: str) -> str:
    """读取指定 session 的 progress.jsonl 增量事件列表（由 session_watch hook 记录）。

    Args:
        session_id: session ID

    Returns:
        JSON: {"events": [...]} 或 {"error": "..."}
    """
    from silver_memory_tools import session_progress as _sp

    return json.dumps(_sp(session_id), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
