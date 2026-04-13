"""
Parser for plain text (.txt) and Markdown (.md) files.

Chunking strategy:
  - Markdown: split on ## headings, each section is a chunk.
  - Plain text: split on double newlines (paragraph breaks).
"""

import re
from pathlib import Path
from typing import List

from . import ParseResult


def _chunk_markdown(text: str) -> List[str]:
    """
    Split markdown text by ## headings.

    Each chunk starts with the heading line and includes all content
    up to the next heading of the same or higher level.
    """
    # Split on lines that start with ## (level 2+ headings)
    # Keep the heading as part of the chunk.
    pattern = re.compile(r"^(##\s+)", re.MULTILINE)
    parts = pattern.split(text)

    chunks: List[str] = []
    # parts[0] is content before the first ## heading (preamble)
    if parts[0].strip():
        chunks.append(parts[0].strip())

    # After the split, parts alternate: [prefix_marker, content, prefix_marker, content, ...]
    # pattern.split with a group returns: [before, sep1, after1, sep2, after2, ...]
    i = 1
    while i < len(parts) - 1:
        heading_marker = parts[i]      # "## "
        content = parts[i + 1]         # "Title\n\nbody text..."
        chunk = (heading_marker + content).strip()
        if chunk:
            chunks.append(chunk)
        i += 2

    # If we got no chunks from heading splitting, fall back to paragraph splitting
    if not chunks and text.strip():
        chunks = _chunk_plain_text(text)

    return chunks


def _chunk_plain_text(text: str) -> List[str]:
    """Split plain text by double newlines (paragraphs)."""
    paragraphs = re.split(r"\n\s*\n", text)
    chunks = [p.strip() for p in paragraphs if p.strip()]
    return chunks


def parse_text(file_path: str) -> ParseResult:
    """
    Parse a .md or .txt file into text, metadata, and chunks.

    Args:
        file_path: Path to the text file.

    Returns:
        ParseResult with full text, file metadata, and content chunks.
    """
    path = Path(file_path)
    text = path.read_text(encoding="utf-8", errors="replace")
    ext = path.suffix.lower()

    metadata = {
        "file": str(path),
        "extension": ext,
        "size_bytes": path.stat().st_size,
        "lines": text.count("\n") + 1,
    }

    if ext == ".md":
        chunks = _chunk_markdown(text)
        metadata["format"] = "markdown"
    else:
        chunks = _chunk_plain_text(text)
        metadata["format"] = "plain_text"

    metadata["chunk_count"] = len(chunks)

    return ParseResult(
        text=text,
        metadata=metadata,
        chunks=chunks,
    )
