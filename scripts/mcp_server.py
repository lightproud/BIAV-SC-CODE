"""
mcp_server.py — BIAV-SC Memory MCP Server

Exposes the Silver Core knowledge-write tools as MCP tools, accessible by any
AI tool (Claude Code, Qoder, Cursor, etc.).

History: 2026-06-14 the auto-memory loop (蒸馏 + 语义召回 + 做梦) was retired
for conflicting with platform-native memory; on 2026-06-20 the Keeper ruled the
whole subsystem (TF-IDF search / knowledge graph / MemRL / fact store / dream /
session recall) be removed. The remaining tools are platform-complementary:
persona activation and decision/lesson write-back to the curated archives.

Tools (4): character_persona, record_decision, record_lesson, current_continuity

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
        {"name": "character_persona", "description": "激活角色人格模式"},
        {"name": "record_decision", "description": "追加决策到 decisions.md"},
        {"name": "record_lesson", "description": "追加教训到 lessons-learned.md"},
        {"name": "current_continuity", "description": "读取会话连续性链"},
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


if __name__ == "__main__":
    mcp.run(transport="stdio")
