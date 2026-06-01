"""io_utils.py — shared atomic file write helper."""
import os
import tempfile
from pathlib import Path


def write_text_atomic(path, content, encoding="utf-8"):
    """Atomically write text to path via temp-file-then-rename (POSIX atomic)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(content)
        os.replace(tmp, str(path))
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
