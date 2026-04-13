"""
BPT Server configuration module.

All settings can be overridden via environment variables prefixed with BPT_.
"""

import os
from pathlib import Path

# -- Paths ------------------------------------------------------------------

# Root directory to scan for indexing.
# Override: BPT_DATA_ROOT=/path/to/project
DATA_ROOT: str = os.environ.get(
    "BPT_DATA_ROOT",
    str(Path(__file__).resolve().parent.parent),  # defaults to projects/bpt/
)

# Directory where index files are stored.
# Override: BPT_INDEX_DIR=/path/to/indexes
INDEX_DIR: str = os.environ.get(
    "BPT_INDEX_DIR",
    str(Path(__file__).resolve().parent / "indexes"),
)

# Python executable path (used for embedding calls if needed).
# Override: BPT_PYTHON_PATH=/usr/bin/python3
PYTHON_PATH: str = os.environ.get("BPT_PYTHON_PATH", "python3")

# -- Limits -----------------------------------------------------------------

# Maximum number of facts in the fact store.
MAX_FACTS: int = int(os.environ.get("BPT_MAX_FACTS", "500"))

# Auto-rebuild threshold: if index files are older than this, rebuild on search.
INDEX_MAX_AGE_HOURS: int = int(os.environ.get("BPT_INDEX_MAX_AGE_HOURS", "24"))

# TF-IDF vocabulary cap.
VOCAB_CAP: int = int(os.environ.get("BPT_VOCAB_CAP", "15000"))

# Number of top dimensions to retain per sparse vector (for storage efficiency).
TOP_DIMS_PER_VEC: int = int(os.environ.get("BPT_TOP_DIMS_PER_VEC", "50"))

# -- File scanning -----------------------------------------------------------

# File extensions to index (lowercase, with leading dot).
INDEXABLE_EXTENSIONS: set[str] = {
    # Text / documentation
    ".md", ".txt",
    # Code
    ".cs", ".lua", ".py", ".js", ".ts",
    # Config / data
    ".csv", ".json",
    # Office
    ".docx", ".xlsx", ".pptx", ".pdf",
}

# Directories to skip during scanning (relative names).
SKIP_DIRS: set[str] = {
    ".git", ".svn", "__pycache__", "node_modules",
    ".venv", "venv", ".tox", "dist", "build",
    "indexes",
}

# Maximum single file size to parse (bytes). Files larger than this are skipped.
MAX_FILE_SIZE: int = int(os.environ.get("BPT_MAX_FILE_SIZE", str(50 * 1024 * 1024)))  # 50 MB

# -- Derived helpers ---------------------------------------------------------


def index_path(filename: str) -> str:
    """Return the full path for an index file inside INDEX_DIR."""
    return str(Path(INDEX_DIR) / filename)


def ensure_index_dir() -> None:
    """Create INDEX_DIR if it does not exist."""
    Path(INDEX_DIR).mkdir(parents=True, exist_ok=True)
