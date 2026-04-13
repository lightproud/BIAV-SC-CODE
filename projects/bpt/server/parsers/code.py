"""
Parser for code files (.cs, .lua, .py, .js, .ts).

Chunking strategy (regex-based):
  - C#:    split on `class ` and method signatures
  - Lua:   split on `function `
  - Python: split on `def ` and `class `
  - JS/TS: split on `function `, `class `, `export `

Each chunk includes up to 5 lines of context before the split point.
"""

import re
from pathlib import Path
from typing import Dict, List, Pattern

from . import ParseResult

# -- Per-language split patterns ---------------------------------------------

# C#: class declarations and method signatures
_CS_PATTERN = re.compile(
    r"^(?:"
    r"\s*(?:public|private|protected|internal|static|abstract|sealed|partial)\s+)*"
    r"(?:class\s+\w+"
    r"|(?:(?:public|private|protected|internal)\s+)"
    r"(?:static\s+)?(?:async\s+)?"
    r"(?:void|int|string|bool|float|double|Task|IEnumerator|var|object)\s+\w+\s*\()",
    re.MULTILINE,
)

# Lua: function declarations (both `function name` and `local function name`)
_LUA_PATTERN = re.compile(
    r"^(?:local\s+)?function\s+",
    re.MULTILINE,
)

# Python: def and class
_PY_PATTERN = re.compile(
    r"^(?:class\s+\w+|(?:async\s+)?def\s+\w+)",
    re.MULTILINE,
)

# JavaScript / TypeScript: function, class, export
_JSTS_PATTERN = re.compile(
    r"^(?:"
    r"(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+\w+"
    r"|(?:export\s+(?:default\s+)?)?class\s+\w+"
    r"|export\s+(?:const|let|var|type|interface|enum)\s+\w+"
    r")",
    re.MULTILINE,
)

_LANG_PATTERNS: Dict[str, Pattern[str]] = {
    ".cs": _CS_PATTERN,
    ".lua": _LUA_PATTERN,
    ".py": _PY_PATTERN,
    ".js": _JSTS_PATTERN,
    ".ts": _JSTS_PATTERN,
}

# Number of context lines to include before each split point.
_CONTEXT_LINES = 5


def _split_by_pattern(text: str, pattern: Pattern[str]) -> List[str]:
    """
    Split text into chunks at positions where `pattern` matches.

    Each chunk includes up to _CONTEXT_LINES of preceding content
    for better context.
    """
    lines = text.split("\n")
    # Find line indices where a pattern match starts
    split_indices: List[int] = []
    for i, line in enumerate(lines):
        if pattern.search(line):
            split_indices.append(i)

    if not split_indices:
        # No splits found -- return whole file as one chunk
        stripped = text.strip()
        return [stripped] if stripped else []

    chunks: List[str] = []

    # Content before the first split point
    first_split = split_indices[0]
    context_start = max(0, first_split - _CONTEXT_LINES)
    if context_start > 0:
        preamble = "\n".join(lines[:context_start]).strip()
        if preamble:
            chunks.append(preamble)

    for idx, split_line in enumerate(split_indices):
        # Start with context lines before the split point
        chunk_start = max(0, split_line - _CONTEXT_LINES)

        # Don't overlap with the previous chunk's main content
        if idx > 0:
            prev_split = split_indices[idx - 1]
            chunk_start = max(chunk_start, prev_split)

        # End at the next split's context start, or end of file
        if idx + 1 < len(split_indices):
            next_split = split_indices[idx + 1]
            chunk_end = max(next_split - _CONTEXT_LINES, split_line + 1)
            # Make sure we include at least the split line
            chunk_end = max(chunk_end, split_line + 1)
        else:
            chunk_end = len(lines)

        chunk_text = "\n".join(lines[chunk_start:chunk_end]).strip()
        if chunk_text:
            chunks.append(chunk_text)

    # If the last split didn't cover to end of file, capture the tail
    if split_indices:
        last_split = split_indices[-1]
        last_chunk_end = len(lines)
        # Check if we already captured everything
        if last_split < len(lines) - 1:
            tail_start = last_split
            tail = "\n".join(lines[tail_start:last_chunk_end]).strip()
            # Only add if not already captured in the last chunk
            if tail and (not chunks or tail != chunks[-1]):
                chunks[-1] = tail  # Extend the last chunk to cover the tail

    return chunks


def parse_code(file_path: str) -> ParseResult:
    """
    Parse a code file into text, metadata, and chunks.

    Args:
        file_path: Path to the code file.

    Returns:
        ParseResult with full text, file metadata, and code chunks.
    """
    path = Path(file_path)
    text = path.read_text(encoding="utf-8", errors="replace")
    ext = path.suffix.lower()

    metadata = {
        "file": str(path),
        "extension": ext,
        "size_bytes": path.stat().st_size,
        "lines": text.count("\n") + 1,
        "format": "code",
        "language": _ext_to_language(ext),
    }

    pattern = _LANG_PATTERNS.get(ext)
    if pattern is not None:
        chunks = _split_by_pattern(text, pattern)
    else:
        # Fallback: whole file as one chunk
        chunks = [text.strip()] if text.strip() else []

    metadata["chunk_count"] = len(chunks)

    return ParseResult(
        text=text,
        metadata=metadata,
        chunks=chunks,
    )


def _ext_to_language(ext: str) -> str:
    """Map file extension to language name."""
    mapping = {
        ".cs": "csharp",
        ".lua": "lua",
        ".py": "python",
        ".js": "javascript",
        ".ts": "typescript",
    }
    return mapping.get(ext, "unknown")
