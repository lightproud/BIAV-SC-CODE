"""OKF v0.1 conformance tests for the 银芯 bundle at ``okf/``.

Spec conformance constraints (https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf):
1. Every non-reserved ``.md`` file carries parseable YAML frontmatter.
2. Every frontmatter block has a non-empty ``type`` field.
3. Reserved filenames (``index.md``/``log.md``) carry NO frontmatter.

Plus 银芯-specific discipline: every ``sources/`` dataset pointer must label its
data layer (full_archive vs output) to prevent lesson #30 (抽样当全量).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
RESERVED = {"index.md", "log.md"}

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _parse_frontmatter(text: str) -> dict | None:
    """Minimal frontmatter parser: returns dict of top-level keys, or None."""
    m = FM_RE.match(text)
    if not m:
        return None
    fields: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.startswith(" "):
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        fields[key.strip()] = val.strip()
    return fields


def _concept_files() -> list[Path]:
    return [p for p in BUNDLE.rglob("*.md") if p.name not in RESERVED]


def _reserved_files() -> list[Path]:
    return [p for p in BUNDLE.rglob("*.md") if p.name in RESERVED]


def test_bundle_exists():
    assert BUNDLE.is_dir(), "okf/ bundle missing — run scripts/build_okf_bundle.py"
    assert (BUNDLE / "index.md").exists()
    assert (BUNDLE / "log.md").exists()


@pytest.mark.parametrize("path", _concept_files(), ids=lambda p: str(p.relative_to(REPO)))
def test_concept_has_nonempty_type(path: Path):
    """Conformance #1 + #2: parseable frontmatter with non-empty type."""
    fields = _parse_frontmatter(path.read_text(encoding="utf-8"))
    assert fields is not None, f"{path} missing YAML frontmatter"
    assert fields.get("type"), f"{path} frontmatter missing non-empty 'type'"


@pytest.mark.parametrize("path", _reserved_files(), ids=lambda p: str(p.relative_to(REPO)))
def test_reserved_files_have_no_frontmatter(path: Path):
    """Conformance #3: index.md / log.md carry no frontmatter."""
    assert _parse_frontmatter(path.read_text(encoding="utf-8")) is None, (
        f"reserved file {path} must NOT have frontmatter"
    )


def test_log_dates_iso_newest_first():
    """log.md uses ISO date headings (YYYY-MM-DD)."""
    text = (BUNDLE / "log.md").read_text(encoding="utf-8")
    dates = re.findall(r"^## (\d{4}-\d{2}-\d{2})", text, re.MULTILINE)
    assert dates, "log.md has no ISO date headings"
    assert dates == sorted(dates, reverse=True), "log.md dates not newest-first"


def test_sources_label_data_layer():
    """银芯 discipline: each sources/ dataset pointer tags its data layer."""
    src_dir = BUNDLE / "sources"
    pointers = [p for p in src_dir.glob("*.md") if p.name not in RESERVED]
    assert pointers, "no source pointer concepts generated"
    for p in pointers:
        fields = _parse_frontmatter(p.read_text(encoding="utf-8"))
        assert "data_layer" in fields.get("tags", ""), (
            f"{p} missing data_layer tag (lesson #30 guard)"
        )


def test_character_concepts_count():
    """Sanity: character layer is one-concept-per-file."""
    chars = [p for p in (BUNDLE / "characters").glob("*.md") if p.name not in RESERVED]
    assert len(chars) >= 70, f"expected ~72 character concepts, got {len(chars)}"
