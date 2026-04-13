"""
Character persona loader and prompt generator.

Loads character persona definitions from JSON files and generates
system prompts, greetings, and persona listings for BPT terminal.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional


# Path to character persona data directory (relative to server/)
_PERSONA_DIR = Path(__file__).resolve().parent.parent / "data" / "character-personas"


# -- Persona loading ----------------------------------------------------------


def load_persona(character: str = "erica") -> Optional[Dict[str, Any]]:
    """
    Load a character persona from its JSON file.

    Args:
        character: Character identifier (filename without extension).

    Returns:
        Parsed JSON dict, or None if the file is not found or invalid.
    """
    # Sanitize character name (prevent path traversal)
    safe_name = Path(character).name
    persona_path = _PERSONA_DIR / f"{safe_name}.json"

    if not persona_path.exists():
        return None

    try:
        with open(persona_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        return None
    except (json.JSONDecodeError, OSError):
        return None


# -- Prompt generation --------------------------------------------------------


def generate_prompt(
    character: str = "erica",
    context: str = "",
) -> Dict[str, Any]:
    """
    Generate a system prompt from a character persona.

    Builds a prompt using the persona's name, personality, speech patterns,
    and background information. Optional context is appended.

    Args:
        character: Character identifier.
        context: Additional context to include in the prompt.

    Returns:
        Dict with 'character', 'name', and 'system_prompt'.
        Returns an error dict if the persona is not found.
    """
    persona = load_persona(character)

    if persona is None:
        return {
            "character": character,
            "name": character,
            "system_prompt": f"Character persona '{character}' not found.",
        }

    name = persona.get("name", character)
    personality = persona.get("personality", "")
    speech_patterns = persona.get("speech_patterns", [])
    background = persona.get("background", "")

    # Build system prompt
    parts: List[str] = []

    parts.append(f"You are {name}.")
    parts.append("")

    if personality:
        parts.append(f"Personality: {personality}")
        parts.append("")

    if speech_patterns:
        if isinstance(speech_patterns, list):
            patterns_text = "; ".join(str(p) for p in speech_patterns)
        else:
            patterns_text = str(speech_patterns)
        parts.append(f"Speech patterns: {patterns_text}")
        parts.append("")

    if background:
        parts.append(f"Background: {background}")
        parts.append("")

    # Include any additional persona fields
    for key in ("traits", "quirks", "knowledge", "tone"):
        value = persona.get(key)
        if value:
            if isinstance(value, list):
                value_text = ", ".join(str(v) for v in value)
            else:
                value_text = str(value)
            parts.append(f"{key.capitalize()}: {value_text}")
            parts.append("")

    if context:
        parts.append(f"Current context: {context}")
        parts.append("")

    parts.append("Stay in character at all times. Respond as this character would.")

    system_prompt = "\n".join(parts)

    return {
        "character": character,
        "name": name,
        "system_prompt": system_prompt,
    }


# -- Greeting -----------------------------------------------------------------


def generate_greeting(character: str = "erica") -> Dict[str, Any]:
    """
    Generate a greeting from a character persona.

    Args:
        character: Character identifier.

    Returns:
        Dict with 'character', 'name', and 'greeting' text.
    """
    persona = load_persona(character)

    if persona is None:
        return {
            "character": character,
            "name": character,
            "greeting": f"Character persona '{character}' not found.",
        }

    name = persona.get("name", character)
    greeting = persona.get("greeting", "")

    if not greeting:
        # Generate a default greeting from persona data
        personality = persona.get("personality", "")
        if personality:
            greeting = f"[{name}] {personality[:100]}..."
        else:
            greeting = f"[{name}] ..."

    return {
        "character": character,
        "name": name,
        "greeting": greeting,
    }


# -- Listing ------------------------------------------------------------------


def list_personas() -> Dict[str, Any]:
    """
    List all available character personas.

    Scans the character-personas directory for JSON files.

    Returns:
        Dict with 'available_personas' list, each containing 'id' and 'name'.
    """
    personas: List[Dict[str, str]] = []

    if not _PERSONA_DIR.exists():
        return {"available_personas": personas}

    for entry in sorted(_PERSONA_DIR.iterdir()):
        if entry.suffix.lower() != ".json":
            continue
        if entry.name.startswith("."):
            continue

        char_id = entry.stem
        # Try to load name from the file
        try:
            with open(entry, "r", encoding="utf-8") as f:
                data = json.load(f)
            name = data.get("name", char_id) if isinstance(data, dict) else char_id
        except (json.JSONDecodeError, OSError):
            name = char_id

        personas.append({
            "id": char_id,
            "name": name,
        })

    return {"available_personas": personas}
