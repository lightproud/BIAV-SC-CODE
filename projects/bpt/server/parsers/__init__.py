"""
Unified parsing entry point for BPT Server.

Routes file paths to the appropriate parser based on extension.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List


@dataclass
class ParseResult:
    """Result returned by all parsers."""
    text: str = ""
    metadata: Dict[str, object] = field(default_factory=dict)
    chunks: List[str] = field(default_factory=list)


# Extension -> parser module mapping (lazy loaded)
_EXTENSION_MAP: Dict[str, str] = {
    # Text
    ".md": "text",
    ".txt": "text",
    # Code
    ".cs": "code",
    ".lua": "code",
    ".py": "code",
    ".js": "code",
    ".ts": "code",
    # Config / data
    ".csv": "config_parser",
    ".json": "config_parser",
    # Office
    ".docx": "office",
    ".xlsx": "office",
    ".pptx": "office",
    ".pdf": "office",
}


def parse_file(file_path: str) -> ParseResult:
    """
    Route to the appropriate parser based on file extension.

    Args:
        file_path: Absolute or relative path to the file.

    Returns:
        ParseResult with extracted text, metadata, and chunks.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the file extension is not supported.
    """
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = path.suffix.lower()
    parser_module_name = _EXTENSION_MAP.get(ext)

    if parser_module_name is None:
        raise ValueError(f"Unsupported file extension: {ext} (file: {file_path})")

    # Lazy import the parser module
    if parser_module_name == "text":
        from .text import parse_text
        return parse_text(file_path)
    elif parser_module_name == "code":
        from .code import parse_code
        return parse_code(file_path)
    elif parser_module_name == "config_parser":
        from .config_parser import parse_config
        return parse_config(file_path)
    elif parser_module_name == "office":
        from .office import parse_office
        return parse_office(file_path)
    else:
        raise ValueError(f"Unknown parser module: {parser_module_name}")


def supported_extensions() -> set[str]:
    """Return the set of file extensions this parser system supports."""
    return set(_EXTENSION_MAP.keys())
