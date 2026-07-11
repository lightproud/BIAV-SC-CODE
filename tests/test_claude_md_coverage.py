"""Reverse drift sentinel: guard against core scripts that no authority doc ever mentions.

`test_claude_md.py` checks the *forward* direction (does a path CLAUDE.md cites still
exist?). It cannot catch *reverse* drift: a new core component lands on disk but neither
CLAUDE.md nor any authoritative status doc ever names it — so the human/AI entry layer
silently loses track of it. Real case: `archive_engine.py` (the 2026-06-21 declarative
archival engine) once sat un-mentioned by any entry doc.

This test scans the core script dirs, decides which `.py` files are *core components*
(see core_components), and fails if a core component's stem appears in NONE of the
authority docs — either as a literal word or via a declared prefix convention
(e.g. `parse_*`, `backfill_*`), which the docs use deliberately instead of enumerating
every file. A small explicit allowlist exempts known files that need not be named.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Core script dirs scanned for orphan components.
CORE_SCRIPT_DIRS = ("scripts", "projects/news/scripts")

# The "authority doc union" — the human/AI entry layer + the status/decision sources of
# truth. A core component named in NONE of these is a reverse-drift orphan. Missing files
# are tolerated (only the ones that actually exist are read).
AUTHORITY_DOCS = (
    "CLAUDE.md",
    "memory/project-status.md",
    "memory/decisions.md",
    "memory/decisions-archive.md",
    "RELEASES.md",
)

# Files that need NOT be named by any authority doc, each with a reason. These are real
# coverage gaps the sentinel surfaced on first run (2026-06-21) — kept GREEN here by
# explicit, justified exemption rather than by weakening the detector. Revisit when the
# docs grow to mention them, or drop the entry to re-assert the requirement.
ALLOWLIST = {
    # CI-internal tooling: invoked only by its own workflow, not a knowledge component.
    "build_capability_registry": "CI internal; driven by build-capability-registry.yml",
    "check_decisions_consistency": "CI/dev lint helper for decision docs; not user-facing",
    "discord_list_guilds": "one-off discovery utility; driven by discord-discover-guilds.yml",
    "playwright_collectors": "collector backend exercised only by test-collectors.yml",
    "report_render": "internal render helper for the in-session report flow",
    "silent_sources_audit": "diagnostic sub-step of update-news.yml; not a standalone component",
    "data_quality": "internal QA helper run ad hoc; not a standalone entry point",
    # Docs name the *platform* ("TapTap, needs key") but never the collector stem; it is
    # a per-platform collector backend, same class as playwright_collectors. Surfaced by
    # this sentinel on first run (a plain grep for 'taptap' false-matched the platform).
    "taptap_collector": "per-platform collector backend; platform named in docs, stem not",
}


def authority_text():
    """Concatenated plain text of every authority doc that exists."""
    chunks = []
    for rel in AUTHORITY_DOCS:
        path = ROOT / rel
        if path.exists():
            chunks.append(path.read_text(encoding="utf-8"))
    return "\n".join(chunks)


def prefix_conventions(text):
    """Prefix wildcards the docs declare in backticks, e.g. `parse_*` -> 'parse_'.

    The docs deliberately de-enumerate families of scripts (CLAUDE.md §7.3 'parse_*',
    §1.4 'backfill_*') with 'precise list per `ls`'. Treat such a convention as covering
    every stem that starts with the prefix, so the sentinel honors that design intent
    instead of flagging each member as an orphan.
    """
    return {m[:-1] for m in re.findall(r"`([a-z][a-z0-9_]*_)\*`", text)}


def core_components():
    """Yield the core-component `.py` files under CORE_SCRIPT_DIRS.

    A file is a *core component* iff it is a non-test, non-__init__, non-private `.py`
    that has a `__main__` entry point. Rationale: a script you can run standalone is a
    component the entry docs should be able to point at; an import-only helper/library
    module (no __main__) is a 'part', not a 'component', and need not be named. The walk
    sees the worktree; tests/CI run on a clean tree, so this tracks committed files.
    """
    for d in CORE_SCRIPT_DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for py in sorted(base.glob("*.py")):
            name = py.name
            stem = py.stem
            if name.startswith("test_") or stem.endswith("_test"):
                continue
            if name == "__init__.py" or stem.startswith("_"):
                continue
            if "__main__" not in py.read_text(encoding="utf-8"):
                continue  # import-only helper/library, not a standalone component
            yield py


def is_covered(stem, text, prefixes):
    if stem in ALLOWLIST:
        return True
    if re.search(r"\b" + re.escape(stem) + r"\b", text):
        return True
    return any(stem.startswith(p) for p in prefixes)


class TestClaudeMdCoverage(unittest.TestCase):
    def test_finds_a_meaningful_sample(self):
        comps = list(core_components())
        self.assertGreaterEqual(
            len(comps), 15, "core-component detection likely broken (too few found)"
        )

    def test_allowlist_does_not_rot(self):
        """An allowlist entry that no longer matches any core component is dead weight —
        prune it so the exemption list stays honest."""
        stems = {p.stem for p in core_components()}
        stale = sorted(set(ALLOWLIST) - stems)
        self.assertEqual(stale, [], f"ALLOWLIST has stale entries (remove them): {stale}")

    def test_every_core_component_is_documented(self):
        text = authority_text()
        prefixes = prefix_conventions(text)
        orphans = sorted(
            p.relative_to(ROOT).as_posix()
            for p in core_components()
            if not is_covered(p.stem, text, prefixes)
        )
        self.assertEqual(
            orphans,
            [],
            "core components named by NO authority doc (reverse drift). "
            "Document each in CLAUDE.md / project-status.md, or add to ALLOWLIST "
            f"with a reason: {orphans}",
        )


if __name__ == "__main__":
    unittest.main()
