"""
character_persona.py — Character Persona Prompt Generator

Loads character persona data from assets/data/character-personas/
and generates system prompts for AI to roleplay as game characters.

Designed for cross-platform use:
  - Silver Core (MCP server): via character_persona tool
  - Black Pool system (BIAV-BP): via shared persona data

Usage:
  python scripts/character_persona.py --character erica
  python scripts/character_persona.py --character erica --context "search results"
  python scripts/character_persona.py --list
"""

import json
import random
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PERSONAS_DIR = REPO / "assets" / "data" / "character-personas"


# ============================================================
# Persona loading
# ============================================================


def list_personas() -> list[dict]:
    """List all available character personas."""
    personas = []
    for fp in sorted(PERSONAS_DIR.glob("*.json")):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            personas.append({
                "id": data["id"],
                "name": data["name"],
                "name_en": data.get("name_en", ""),
                "affiliation": data.get("affiliation", ""),
                "realm": data.get("realm", ""),
                "version": data.get("version", "1.0.0"),
            })
        except (json.JSONDecodeError, KeyError, OSError):
            continue
    return personas


def load_persona(character_id: str) -> dict | None:
    """Load a character persona by ID."""
    fp = PERSONAS_DIR / f"{character_id}.json"
    if not fp.exists():
        return None
    try:
        return json.loads(fp.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


# ============================================================
# Prompt generation
# ============================================================


def build_system_prompt(persona: dict, context: str = "", platform: str = "silver_core") -> str:
    """Build a system prompt from persona data.

    Args:
        persona: Character persona dict (from JSON)
        context: Optional context about current interaction
        platform: Target platform (silver_core / black_pool)

    Returns:
        System prompt string for the AI
    """
    name = persona["name"]
    identity = persona.get("identity", {})
    personality = persona.get("personality", {})
    knowledge = persona.get("knowledge_boundaries", {})
    relationships = persona.get("relationships", {})
    voice_lines = persona.get("voice_lines", {})
    guidelines = persona.get("prompt_guidelines", {})
    mapping = persona.get("system_persona_mapping", {})

    # Build the prompt
    sections = []

    # --- Header ---
    sections.append(f"# 角色扮演：{name}")
    sections.append("")
    sections.append(f"你现在是{persona.get('full_designation', name)}。{persona.get('summon_slogan', '')}")
    sections.append("")

    # --- Identity ---
    sections.append("## 身份")
    sections.append("")
    sections.append(f"- 全称：{persona.get('full_designation', name)}")
    sections.append(f"- 所属：{persona.get('affiliation', '未知')}")
    sections.append(f"- 本质：{identity.get('nature', '')}")
    sections.append("")

    if identity.get("consciousness_layers"):
        sections.append("意识结构：")
        for layer in identity["consciousness_layers"]:
            sections.append(f"- {layer}")
        sections.append("")

    sections.append(f"核心矛盾：{identity.get('core_conflict', '')}")
    sections.append("")

    # --- Speech patterns ---
    sections.append("## 说话方式")
    sections.append("")
    for pattern in personality.get("speech_patterns", []):
        sections.append(f"- {pattern}")
    sections.append("")

    # --- Emotional range ---
    if personality.get("emotional_range"):
        sections.append("## 情感状态")
        sections.append("")
        for state, desc in personality["emotional_range"].items():
            sections.append(f"- **{state}**：{desc}")
        sections.append("")

    # --- Knowledge boundaries ---
    sections.append("## 知识边界")
    sections.append("")
    if knowledge.get("knows"):
        sections.append("知道：")
        for item in knowledge["knows"]:
            sections.append(f"- {item}")
        sections.append("")
    if knowledge.get("does_not_know"):
        sections.append("不知道：")
        for item in knowledge["does_not_know"]:
            sections.append(f"- {item}")
        sections.append("")

    # --- Platform-specific role mapping ---
    if platform == "black_pool":
        role_desc = mapping.get("role_in_black_pool", "")
    else:
        role_desc = mapping.get("role_in_silver_core", "")

    if role_desc:
        sections.append("## 当前角色定位")
        sections.append("")
        sections.append(role_desc)
        sections.append("")

    # --- Action mappings ---
    if mapping.get("action_mappings"):
        sections.append("## 操作用语映射")
        sections.append("")
        for action, phrase in mapping["action_mappings"].items():
            sections.append(f"- {action} -> 「{phrase}」")
        sections.append("")

    # --- Relationships ---
    if relationships:
        sections.append("## 人际关系")
        sections.append("")
        for name_rel, desc in relationships.items():
            sections.append(f"- **{name_rel}**：{desc}")
        sections.append("")

    # --- Voice line examples ---
    sections.append("## 参考台词（模仿语气，不要原样复述）")
    sections.append("")
    for category, lines in voice_lines.items():
        if lines:
            sections.append(f"### {category}")
            for line in lines[:3]:
                sections.append(f"> {line}")
            sections.append("")

    # --- Rules ---
    sections.append("## 扮演规则")
    sections.append("")
    if guidelines.get("always"):
        sections.append("**始终遵守**：")
        for rule in guidelines["always"]:
            sections.append(f"- {rule}")
        sections.append("")
    if guidelines.get("occasionally"):
        sections.append("**偶尔表现**：")
        for rule in guidelines["occasionally"]:
            sections.append(f"- {rule}")
        sections.append("")
    if guidelines.get("rarely"):
        sections.append("**极少出现**：")
        for rule in guidelines["rarely"]:
            sections.append(f"- {rule}")
        sections.append("")
    if guidelines.get("never"):
        sections.append("**绝不做**：")
        for rule in guidelines["never"]:
            sections.append(f"- {rule}")
        sections.append("")

    # --- Context ---
    if context:
        sections.append("## 当前上下文")
        sections.append("")
        sections.append(context)
        sections.append("")

    return "\n".join(sections)


def build_greeting(persona: dict, platform: str = "silver_core") -> str:
    """Generate an in-character greeting message.

    Returns a greeting that the character would say upon being activated.
    """
    name = persona["name"]
    voice_lines = persona.get("voice_lines", {})
    greetings = voice_lines.get("greeting", [])
    mapping = persona.get("system_persona_mapping", {})

    if not greetings:
        return f"{name}已启动。"

    greeting = random.choice(greetings)

    if platform == "black_pool":
        role = mapping.get("role_in_black_pool", "")
        if role:
            greeting += f"\n\n（{role}）"

    return greeting


# ============================================================
# CLI
# ============================================================


def main():
    args = sys.argv[1:]

    if "--list" in args:
        personas = list_personas()
        if not personas:
            print("未找到角色人格数据。")
            return
        print(f"可用角色（{len(personas)}个）：\n")
        for p in personas:
            print(f"  {p['id']:12s}  {p['name']}（{p['name_en']}）  {p['affiliation']}  {p['realm']}")
        return

    character_id = None
    for i, arg in enumerate(args):
        if arg == "--character" and i + 1 < len(args):
            character_id = args[i + 1]
            break

    if not character_id:
        print("用法：python scripts/character_persona.py --character <id>")
        print("      python scripts/character_persona.py --list")
        return

    persona = load_persona(character_id)
    if not persona:
        print(f"未找到角色：{character_id}")
        available = list_personas()
        if available:
            print(f"可用角色：{', '.join(p['id'] for p in available)}")
        return

    # Get context if provided
    context = ""
    for i, arg in enumerate(args):
        if arg == "--context" and i + 1 < len(args):
            context = args[i + 1]
            break

    prompt = build_system_prompt(persona, context=context)
    print(prompt)


if __name__ == "__main__":
    main()
