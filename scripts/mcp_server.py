"""
mcp_server.py — BIAV-SC Memory MCP Server

Exposes the Silver Core knowledge-write tools as MCP tools, accessible by any
AI tool (Claude Code, Qoder, Cursor, etc.).

History: 2026-06-14 the auto-memory loop (蒸馏 + 语义召回 + 做梦) was retired
for conflicting with platform-native memory; on 2026-06-20 the Keeper ruled the
whole subsystem (TF-IDF search / knowledge graph / MemRL / fact store / dream /
session recall) be removed. The remaining memory tools are platform-complementary:
persona activation and decision/lesson write-back to the curated archives.

2026-07-04 the Keeper ruled the static OKF bundle be upgraded into a knowledge base
艾瑞卡 can navigate dynamically at runtime (思想溯源 OKF + LLMwiki). This adds a KB
navigation surface (kb_*) over okf/kb_index.json — the only runtime-dynamic
orchestration plane gains a way to search / open / traverse the knowledge graph.

Tools (11):
  memory:      character_persona, record_decision, record_lesson, current_continuity
  kb-navigate: kb_search, kb_get, kb_neighbors, kb_overview, kb_activate（扩散激活检索）,
               kb_vector_search（长尾语义召回，向量腿）, kb_anchor（先锚后扩合流）

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

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    # Graceful fallback: print tool definitions as JSON for non-MCP environments
    print("mcp package not installed. Install with: pip install mcp", file=sys.stderr)
    print("Running in standalone mode — listing available tools.", file=sys.stderr)

    tools = [
        {"name": "character_persona", "description": "激活角色人格模式"},
        {"name": "record_decision", "description": "追加决策到 decisions.md"},
        {"name": "record_lesson", "description": "追加教训到 lessons-learned.md"},
        {"name": "current_continuity", "description": "读取会话连续性链"},
        {"name": "kb_search", "description": "知识库按词检索概念"},
        {"name": "kb_get", "description": "取单个概念全档（元数据+正文+邻居）"},
        {"name": "kb_neighbors", "description": "顺关系图遍历概念邻居"},
        {"name": "kb_overview", "description": "知识库总览（分区/类型/两层结构）"},
        {"name": "kb_activate", "description": "扩散激活检索（联想召回）"},
        {"name": "kb_vector_search", "description": "长尾语义召回（向量腿）"},
        {"name": "kb_anchor", "description": "先锚后扩合流（脊柱锚定+别名扩词+向量捞长尾）"},
    ]
    print(json.dumps(tools, ensure_ascii=False, indent=2))
    sys.exit(0)

mcp = FastMCP("biav-sc-memory")


# ============================================================
# Tool 1: Character Persona
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
# 银芯记忆写入工具 —— 追写人工策展档案（decisions / lessons），平台原生记忆互补
# ---------------------------------------------------------------------------


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
def current_continuity() -> str:
    """读取 session 连续性链（上次 session 快照 + topics_hint）。

    Returns:
        JSON: session-continuity.json 内容 + last_session_file + topics_hint
    """
    from silver_memory_tools import current_continuity as _cc

    return json.dumps(_cc(), ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 银芯知识库运行时导航 —— 把静态 OKF bundle 变成艾瑞卡运行时可动态导航的知识库
# （守密人 2026-07-04 裁定；底座索引 okf/kb_index.json，后端 scripts/kb_navigator.py）
# ---------------------------------------------------------------------------


def _log(tool: str, query: str, ids) -> None:
    """使用遥测埋点（评判体系 #2）——best-effort，只在 MCP 消费边界记，绝不拖垮工具。"""
    try:
        from kb_telemetry import log_call

        log_call(tool, query, [i for i in (ids or []) if i])
    except Exception:
        pass


@mcp.tool()
def kb_search(query: str, limit: int = 8, type_filter: str = "") -> str:
    """在银芯知识库中按词检索概念（角色 / 数据源 / 记忆 / 剧情）。

    倒排表打分、词典法分词，确定性零 ML。返回排序后的概念摘要，每条带
    `resource` 指针——艾瑞卡据此再按需 fetch 仓内权威源（放指针不放本体）。

    Args:
        query: 检索词（中英文皆可，如 "徐" / "playable 画师" / "剧情 lore"）
        limit: 返回条数上限（默认 8，封顶 50）
        type_filter: 仅返回该 type 的概念（如 character / dataset / knowledge-pointer；空=不过滤）

    Returns:
        JSON: {query, tokens, total_matches, returned, results:[{id,type,title,
               description,resource,tags,score,matched_terms}...]}
    """
    from kb_navigator import KBIndexMissing, search

    try:
        result = search(query, limit, type_filter or None)
        _log("kb_search", query, [r.get("id") for r in result.get("results", [])])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except KBIndexMissing as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False, indent=2)


@mcp.tool()
def kb_get(concept_id: str) -> str:
    """取单个概念的全档：元数据 + 正文 markdown + resource 指针 + 邻居列表。

    接受规范 id（`/characters/125346.md`）或宽松形式（`125346` / `characters/125346`
    / 精确标题）。正文来自 OKF concept 文件；本体仍在 `resource` 指向的权威源，不复刻。

    Args:
        concept_id: 概念标识（规范 id 或宽松引用）

    Returns:
        JSON: {id,type,title,description,resource,tags,degree,body,neighbors,neighbor_count}
    """
    from kb_navigator import KBIndexMissing, get

    try:
        result = get(concept_id)
        _log("kb_get", concept_id, [result.get("id")])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except KBIndexMissing as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False, indent=2)


@mcp.tool()
def kb_neighbors(concept_id: str, limit: int = 20, rel_filter: str = "") -> str:
    """顺 OKF 关系图遍历某概念的邻居（角色按画师/CV 聚簇、显式链接边等）。

    Args:
        concept_id: 起点概念标识（规范 id 或宽松引用）
        limit: 返回邻居上限（默认 20，封顶 200）
        rel_filter: 仅返回该关系标签的边（如 "画师:巴拉巴拉" / "link"；空=全部）

    Returns:
        JSON: {id,title,total_neighbors,returned,rel_filter,neighbors:[{id,type,title,rel...}]}
    """
    from kb_navigator import KBIndexMissing, neighbors

    try:
        result = neighbors(concept_id, limit, rel_filter or None)
        _log("kb_neighbors", concept_id, [n.get("id") for n in result.get("neighbors", [])])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except KBIndexMissing as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False, indent=2)


@mcp.tool()
def kb_activate(seed: str, hops: int = 2, decay: float = 0.5, limit: int = 15) -> str:
    """扩散激活检索（联想召回）：从种子沿知识图谱多跳带衰减扩散，返回被点亮的相关概念子图。

    「概念网络 ≠ 搜索」的杀手级消费——搜索给「精确含某词的几条」，扩散激活给「和这个概念
    在联想上相近的一片」。高信号边（变体/lore）传导更多激活，弱信号边（同声优）近乎不传。
    骨架层（characters/sources/community/news-output）最有效；参考层概念多需作检索种子进入。

    Args:
        seed: 概念 id（/characters/125346.md 或 125346）或检索词（"沙耶" / "discord 社区"）
        hops: 扩散跳数（默认 2，封顶 4）
        decay: 每跳衰减（默认 0.5）
        limit: 返回上限（默认 15，封顶 50）

    Returns:
        JSON: {seed, resolved_seeds, hops, activated:[{id,title,tier,activation,via}...]}
    """
    from kb_navigator import KBIndexMissing, activate

    try:
        result = activate(seed, hops, decay, limit)
        _log("kb_activate", seed, [a.get("id") for a in result.get("activated", [])])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except KBIndexMissing as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False, indent=2)


@mcp.tool()
def kb_overview() -> str:
    """知识库总览（LLMwiki 楼层平面图）：分区 / 类型分布 / 各分区入口索引 / 用法。

    艾瑞卡导航前先取此总览定位，再用 kb_search / kb_get / kb_neighbors 下钻。

    Returns:
        JSON: {generated, meta, stats:{concepts,edges,terms,by_type,sections}, sections, usage}
    """
    from kb_navigator import KBIndexMissing, overview

    try:
        result = overview()
        _log("kb_overview", "", [])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except KBIndexMissing as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False, indent=2)


@mcp.tool()
def kb_vector_search(query: str, limit: int = 8) -> str:
    """长尾语义召回（§八「厚锚撑向量」的向量腿）：对社区全量档案做模糊语义检索。

    与 kb_search 分工：kb_search 走白盒脊柱（概念、带类型边、确定性），本工具走
    黑盒向量（换了说法、脊柱与 grep 都到不了的散句）。合流用法（先锚后扩）：先用
    kb_search / kb_activate 锚定身份与边界，再用本工具在锚周边捞长尾正文上色。

    放指针不放本体：返回片段预览 + 指针（来源:日期），全文回落 dated 文件 ripgrep。
    向量索引缺失 / 未配 VOYAGE_API_KEY 时**优雅降级**（返回 degraded 标记，改用 kb_search）。

    Args:
        query: 语义查询（如 "冰系奶妈技能被削的抱怨"）
        limit: 返回条数上限（默认 8，封顶 50）

    Returns:
        JSON: {query, backend, degraded, returned, results:[{score,source,date,
               preview,ref,data_layer}...]}
    """
    from kb_vector import search as vsearch

    try:
        result = vsearch(query, limit)
        _log("kb_vector_search", query, [r.get("ref") for r in result.get("results", [])])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as e:  # Voyage 网络/导入等异常 → 降级而非崩溃
        return json.dumps(
            {"query": query, "degraded": True, "reason": f"{type(e).__name__}: {e}",
             "fallback": "改用 kb_search（关键词）白盒回退", "results": []},
            ensure_ascii=False, indent=2)


@mcp.tool()
def kb_anchor(query: str, anchor_limit: int = 3, tail_limit: int = 8) -> str:
    """先锚后扩合流（§八 8.3「厚锚撑向量」）：脊柱锚定 + 别名扩词 + 向量捞长尾一次给全。

    与单腿工具的分工：kb_search 只给脊柱概念、kb_vector_search 只给长尾散句；本工具
    把「先锚（身份 / 边界 / 厚锚别名）后扩（向量在锚周边捞正文 + 据锚去杂标记）」
    编排成一次调用。锚附带侧表别名（已确认进扩词、未确认标注供掂量）；tail 命中含
    锚词者标 anchored 排前、未命中降序不删（最终判杂的是调用方）。

    任何一条腿垮掉只降级自己：向量索引 / VOYAGE_API_KEY 缺失时 tail.degraded=true，
    锚 + 别名照常返回；零锚查询自动喂入别名候选闭环（alias_gaps.jsonl）。

    Args:
        query: 查询（本名 / 黑话别名 / 换说法散句皆可，如 "融朵怎么打"）
        anchor_limit: 脊柱锚数上限（默认 3，封顶 10）
        tail_limit: 长尾返回上限（默认 8，封顶 50）

    Returns:
        JSON: {query, anchors:[{id,title,aliases:[{alias,confirmed}]}...], expansion_terms,
               spine_degraded, tail:{degraded, results:[{score,preview,ref,anchored,...}]}}
    """
    from kb_anchor import anchor_expand

    try:
        result = anchor_expand(query, anchor_limit, tail_limit)
        _log("kb_anchor", query, [a.get("id") for a in result.get("anchors", [])])
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as e:  # 合流层再兜一道：绝不因单腿异常崩工具面
        return json.dumps(
            {"query": query, "degraded": True, "reason": f"{type(e).__name__}: {e}",
             "fallback": "改用 kb_search（关键词）白盒回退", "anchors": [], "results": []},
            ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
