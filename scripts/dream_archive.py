"""Archive integrity scan — detect broken path references in repo docs.

Extracted from dream.py. Used by dream.sentinel_scan().
"""

import json
from datetime import datetime
from pathlib import Path

from dream_config import (
    ARCHIVE_INTEGRITY_FILE,
    ARCHIVE_INTEGRITY_GLOBS,
    ARCHIVE_INTEGRITY_PATH_PREFIXES,
    ARCHIVE_INTEGRITY_PENDING_MARKERS,
    ARCHIVE_INTEGRITY_PLACEHOLDER_TOKENS,
    ARCHIVE_INTEGRITY_REF_RE,
    ARCHIVE_INTEGRITY_ROOT_FILES,
    ARCHIVE_INTEGRITY_ROOT_WHITELIST,
    ARCHIVE_INTEGRITY_SKIP_PATTERNS,
    REPO,
)


def _archive_should_skip(rel_path: str) -> bool:
    """Return True if a repo-relative path is in the archive skip list."""
    norm = rel_path.replace("\\", "/")
    for pat in ARCHIVE_INTEGRITY_SKIP_PATTERNS:
        if pat.endswith("/"):
            if norm.startswith(pat):
                return True
        elif norm == pat:
            return True
    return False


def _archive_collect_sources() -> list[Path]:
    """Resolve the archive scan source set (files whose content gets parsed)."""
    sources: list[Path] = []
    for name in ARCHIVE_INTEGRITY_ROOT_FILES:
        fp = REPO / name
        if fp.exists() and fp.is_file():
            sources.append(fp)
    for glob_pat in ARCHIVE_INTEGRITY_GLOBS:
        for fp in sorted(REPO.glob(glob_pat)):
            if not fp.is_file():
                continue
            rel = str(fp.relative_to(REPO)).replace("\\", "/")
            if _archive_should_skip(rel):
                continue
            sources.append(fp)
    # Deduplicate while preserving order.
    seen: set[str] = set()
    uniq: list[Path] = []
    for fp in sources:
        key = str(fp.resolve())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(fp)
    return uniq


def _extract_path_refs(text: str) -> list[tuple[str, int, str]]:
    """Extract (ref_path, line_no, line_text) triples from markdown text.

    Only backtick-wrapped tokens that look like repo-relative paths are kept.
    Line numbers are 1-based. Tolerates malformed backtick groups by falling
    back to regex-level isolation; never raises.
    """
    results: list[tuple[str, int, str]] = []
    lines = text.splitlines()
    for idx, line in enumerate(lines, start=1):
        for m in ARCHIVE_INTEGRITY_REF_RE.finditer(line):
            raw = m.group(1).strip()
            if not raw:
                continue
            # Trim common trailing punctuation attached to the path.
            ref = raw.rstrip(".,;:!?)")
            if " " in ref:
                # Backtick-wrapped phrases with spaces are prose, not paths.
                continue
            if any(tok in ref for tok in ARCHIVE_INTEGRITY_PLACEHOLDER_TOKENS):
                # Template/doc placeholders like `projects/<子项目>/...`.
                continue
            if ref.startswith(ARCHIVE_INTEGRITY_PATH_PREFIXES):
                results.append((ref, idx, line))
            elif ref in ARCHIVE_INTEGRITY_ROOT_WHITELIST:
                results.append((ref, idx, line))
    return results


def _archive_is_pending(lines: list[str], line_idx: int) -> bool:
    """Return True if the reference line (or its neighbours) is pending-marked.

    line_idx is 0-based here. Checks current line plus +/-1 neighbours for any
    pending marker (case-insensitive for latin markers).
    """
    lo = max(0, line_idx - 1)
    hi = min(len(lines), line_idx + 2)
    window = " ".join(lines[lo:hi]).lower()
    for marker in ARCHIVE_INTEGRITY_PENDING_MARKERS:
        if marker.lower() in window:
            return True
    return False


def _archive_ref_exists(ref: str) -> bool:
    """Check whether a reference resolves to an existing path inside the repo."""
    target = REPO / ref
    if target.exists():
        return True
    # Fallback: allow glob-style patterns (e.g. `memory/*.md`).
    try:
        return any(REPO.glob(ref))
    except (OSError, ValueError):
        return False


def archive_integrity_scan() -> list[dict]:
    """Scan repo archives for broken path references.

    Emits yellow alerts for any backticked `projects/...`, `memory/...`, etc.
    reference that fails to resolve. Pending whitelisted references (lines with
    ⚠ / 尚未建立 / 待自举 / Phase 2 W1 / self-bootstrap) are recorded but not
    flagged as broken. Writes a standalone report to
    `assets/data/archive-integrity.json` regardless of alert count.
    """
    alerts: list[dict] = []
    broken: list[dict] = []
    pending: list[dict] = []
    total_refs = 0
    sources = _archive_collect_sources()

    for fp in sources:
        rel_src = str(fp.relative_to(REPO)).replace("\\", "/")
        try:
            text = fp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        text_lines = text.splitlines()
        seen_in_file: set[tuple[str, int]] = set()
        for ref, line_no, line_text in _extract_path_refs(text):
            key = (ref, line_no)
            if key in seen_in_file:
                continue
            seen_in_file.add(key)
            total_refs += 1

            # Skip references pointing to archived/frozen regions entirely —
            # neither flag as broken nor as pending.
            if _archive_should_skip(ref):
                continue

            if _archive_ref_exists(ref):
                continue

            if _archive_is_pending(text_lines, line_no - 1):
                pending.append({
                    "ref_path": ref,
                    "source_file": rel_src,
                    "line_no": line_no,
                    "line_text": line_text.strip()[:200],
                })
                continue

            record = {
                "ref_path": ref,
                "source_file": rel_src,
                "line_no": line_no,
                "line_text": line_text.strip()[:200],
            }
            broken.append(record)
            alerts.append({
                "level": "yellow",
                "source": "archive_integrity",
                "metric": "broken_reference",
                "message": f"断裂引用：{ref}（在 {rel_src}:{line_no}）",
                "ref_path": ref,
                "source_file": rel_src,
                "line_no": line_no,
            })

    if len(pending) > 20:
        alerts.append({
            "level": "yellow",
            "source": "archive_integrity",
            "metric": "pending_backlog",
            "message": (
                f"Phase 2 自举待办堆积：{len(pending)} 条 pending 白名单引用"
                "（超过 20 条阈值）"
            ),
            "pending_count": len(pending),
        })

    # Always write the standalone report, even when everything is clean.
    report = {
        "scanned_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_references": total_refs,
        "broken": broken,
        "pending_whitelisted": pending,
        "summary": {
            "broken_count": len(broken),
            "pending_count": len(pending),
            "scanned_files": len(sources),
        },
    }
    try:
        ARCHIVE_INTEGRITY_FILE.parent.mkdir(parents=True, exist_ok=True)
        ARCHIVE_INTEGRITY_FILE.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError:
        pass

    return alerts
