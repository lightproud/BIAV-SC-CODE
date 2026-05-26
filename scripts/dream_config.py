"""Shared configuration constants for the dream.py memory-consolidation system.

Extracted from dream.py so its sub-modules (dream_archive, ...) and the
orchestrator share one source of paths, thresholds and scan rules without
circular imports. dream_config.py lives next to dream.py, so REPO resolves to
the same repository root.
"""

import re
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TODAY = date.today()
DREAMS_DIR = REPO / "memory" / "dreams"
INSIGHTS_FILE = DREAMS_DIR / "insights.json"
ACCESS_LOG_DIR = DREAMS_DIR / "access-log"
ACCESS_LOG_LEGACY = DREAMS_DIR / "access-log.json"
SEMANTIC_INDEX = REPO / "assets" / "data" / "semantic-index.json"
SENTINEL_BASELINE = REPO / "assets" / "data" / "sentinel-baseline.json"
ALERTS_FILE = REPO / "projects" / "news" / "output" / "alerts.json"
NEWS_OUTPUT = REPO / "projects" / "news" / "output"
ARCHIVE_INTEGRITY_FILE = REPO / "assets" / "data" / "archive-integrity.json"
CACHE_FILE = REPO / "assets" / "data" / "precomputed-cache.json"

# Archive integrity scan — whitelist and rules
ARCHIVE_INTEGRITY_ROOT_FILES = [
    "CLAUDE.md",
    "BIAV-SC.md",
    "README.md",
    "assets/index.md",
]
ARCHIVE_INTEGRITY_GLOBS = [
    "memory/*.md",
    "projects/*/CONTEXT.md",
]
# Paths or glob patterns whose content is NOT scanned AND whose existence is NOT
# validated when referenced elsewhere (treated as archived/frozen).
# Rationale:
#   - session-digests / deliverables — historical snapshots
#   - task-wiki-data-audit / bpt-master-plan — historical diagnostic docs
#   - blackpool-* / bpt-* / silver-to-blackpool — cross-system (BPT) design
#     documents whose `projects/bpt-*/` references intentionally point to the
#     Black Pool repo, not Silver Core (see CLAUDE.md: BPT removed 2026-04-19).
ARCHIVE_INTEGRITY_SKIP_PATTERNS = [
    "memory/session-digests/",
    "deliverables/",
    "memory/task-wiki-data-audit-2026-04.md",
    "memory/bpt-master-plan.md",
    "memory/blackpool-architecture.md",
    "memory/bpt-next-design.md",
    "memory/bpt-next-build-verification.md",
    "memory/bpt-desktop-design-spec-ref.md",
    "memory/bpt-guidance-protocol.md",
    "memory/silver-to-blackpool-migration.md",
    "memory/black-pool-design.md",
    "memory/phase-d-plan.md",
]
# Placeholder tokens in docs — references containing any are docs/templates,
# not real path references.
ARCHIVE_INTEGRITY_PLACEHOLDER_TOKENS = (
    "<", ">", "你的", "xxx", "XXX", "YYYY", "yyyy", "{", "}",
)
# Reference prefixes that the extractor treats as repo-relative paths.
ARCHIVE_INTEGRITY_PATH_PREFIXES = (
    "projects/", "memory/", "assets/", ".github/", "scripts/", "deliverables/",
)
# Single-file root whitelist (references like `CLAUDE.md` without a directory).
ARCHIVE_INTEGRITY_ROOT_WHITELIST = {
    "CLAUDE.md", "BIAV-SC.md", "README.md", "LICENSE",
}
# Pending markers — references in lines containing any of these tokens (or the
# ⚠ symbol) are treated as intentionally pending, not broken.
ARCHIVE_INTEGRITY_PENDING_MARKERS = (
    "⚠", "尚未建立", "待自举", "phase 2 w1", "self-bootstrap",
    "运行时生成", "运行时产出", "gitignored", "runtime-generated",
)
# Backtick-wrapped path reference — allow anything except backticks/whitespace.
# Intentionally permissive so malformed inputs (e.g. paths with spaces) are
# extracted then filtered by the prefix check rather than crashing the regex.
ARCHIVE_INTEGRITY_REF_RE = re.compile(r"`([^`\n]+?)`")

# Sentinel layer — thresholds for alert levels
SENTINEL_THRESHOLDS = {
    "red": 3.0,     # 3x deviation from baseline → red alert
    "orange": 2.0,  # 2x deviation → orange alert
    "yellow": 1.5,  # 1.5x deviation → yellow alert
}

# Negative keywords to track (Chinese + English)
NEGATIVE_KEYWORDS = [
    "退款", "bug", "闪退", "崩溃", "卡死", "差评", "垃圾", "骗钱",
    "refund", "crash", "broken", "scam", "unplayable", "worst",
]
