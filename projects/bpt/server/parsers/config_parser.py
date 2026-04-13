"""
Parser for config / data files (.csv, .json, .lua table configs).

Chunking strategy:
  - CSV:  chunk by N rows (default 50)
  - JSON: chunk by top-level keys
  - Lua:  regex split on top-level table assignments (e.g. `Config.X = {`)
"""

import csv
import io
import json
import re
from pathlib import Path
from typing import Any, Dict, List

from . import ParseResult

# Default number of rows per CSV chunk.
_CSV_CHUNK_ROWS = 50


def _chunk_csv(text: str) -> List[str]:
    """Split CSV content into chunks of _CSV_CHUNK_ROWS rows each."""
    reader = csv.reader(io.StringIO(text))
    rows: List[List[str]] = []
    try:
        for row in reader:
            rows.append(row)
    except csv.Error:
        # Malformed CSV -- return whole text as one chunk
        return [text.strip()] if text.strip() else []

    if not rows:
        return []

    chunks: List[str] = []
    header = rows[0] if rows else []

    for start in range(1, len(rows), _CSV_CHUNK_ROWS):
        end = min(start + _CSV_CHUNK_ROWS, len(rows))
        batch = rows[start:end]

        # Reconstruct CSV text with header
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(header)
        writer.writerows(batch)
        chunk_text = output.getvalue().strip()
        if chunk_text:
            chunks.append(chunk_text)

    # If only header exists or all data fits in one chunk
    if not chunks and text.strip():
        chunks = [text.strip()]

    return chunks


def _chunk_json(text: str) -> List[str]:
    """
    Split JSON content by top-level keys.

    For objects: each top-level key becomes a chunk.
    For arrays: each element becomes a chunk (up to a limit).
    For primitives: the whole value is one chunk.
    """
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Not valid JSON -- return as single chunk
        return [text.strip()] if text.strip() else []

    chunks: List[str] = []

    if isinstance(data, dict):
        for key, value in data.items():
            chunk_text = json.dumps({key: value}, ensure_ascii=False, indent=2)
            chunks.append(chunk_text)
    elif isinstance(data, list):
        for i, item in enumerate(data):
            chunk_text = json.dumps(item, ensure_ascii=False, indent=2)
            # Add index annotation
            chunks.append(f"[{i}] {chunk_text}")
    else:
        # Primitive value
        chunks.append(json.dumps(data, ensure_ascii=False))

    return chunks


# Pattern for Lua top-level table assignments:
#   Config.Something = {
#   local Something = {
#   Something = {
_LUA_TABLE_PATTERN = re.compile(
    r"^(?:local\s+)?\w+(?:\.\w+)*\s*=\s*\{",
    re.MULTILINE,
)


def _chunk_lua_tables(text: str) -> List[str]:
    """Split Lua config files on top-level table assignments."""
    matches = list(_LUA_TABLE_PATTERN.finditer(text))

    if not matches:
        stripped = text.strip()
        return [stripped] if stripped else []

    chunks: List[str] = []
    for i, match in enumerate(matches):
        start = match.start()
        if i + 1 < len(matches):
            end = matches[i + 1].start()
        else:
            end = len(text)

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

    # Content before the first table assignment
    preamble = text[:matches[0].start()].strip()
    if preamble:
        chunks.insert(0, preamble)

    return chunks


def _detect_lua_config(file_path: str, text: str) -> bool:
    """
    Determine if a .lua file is a table config (vs. code).

    Heuristics: file is in a directory with 'config', 'data', 'table' in name,
    or content is dominated by table assignments rather than function definitions.
    """
    path_lower = file_path.lower()
    if any(hint in path_lower for hint in ("config", "data", "table", "setting")):
        return True

    # Count table assignments vs function definitions
    table_count = len(_LUA_TABLE_PATTERN.findall(text))
    func_count = len(re.findall(r"^(?:local\s+)?function\s+", text, re.MULTILINE))

    return table_count > func_count


def parse_config(file_path: str) -> ParseResult:
    """
    Parse a config / data file into text, metadata, and chunks.

    Routes based on extension:
      .csv  -> CSV parser
      .json -> JSON parser
      .lua  -> Lua table config parser (only if detected as config)

    Args:
        file_path: Path to the config file.

    Returns:
        ParseResult with full text, file metadata, and content chunks.
    """
    path = Path(file_path)
    text = path.read_text(encoding="utf-8", errors="replace")
    ext = path.suffix.lower()

    metadata: Dict[str, Any] = {
        "file": str(path),
        "extension": ext,
        "size_bytes": path.stat().st_size,
        "format": "config",
    }

    if ext == ".csv":
        chunks = _chunk_csv(text)
        metadata["parser"] = "csv"
    elif ext == ".json":
        chunks = _chunk_json(text)
        metadata["parser"] = "json"
    elif ext == ".lua":
        if _detect_lua_config(file_path, text):
            chunks = _chunk_lua_tables(text)
            metadata["parser"] = "lua_table"
        else:
            # Delegate to code parser for non-config Lua files
            from .code import parse_code
            return parse_code(file_path)
    else:
        chunks = [text.strip()] if text.strip() else []
        metadata["parser"] = "fallback"

    metadata["chunk_count"] = len(chunks)

    return ParseResult(
        text=text,
        metadata=metadata,
        chunks=chunks,
    )
