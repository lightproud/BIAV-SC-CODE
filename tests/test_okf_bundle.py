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


# CI 硬门禁走 sparse checkout（2026-07-02 P0-2）：重量档案层被排除时，
# 指向其中的指针无法在 CI 校验存在性——跳过而非放水；全量环境仍全程执法。
_SPARSE_EXCLUDED = ("Public-Info-Pool/Record/", "Public-Info-Pool/Reference/")
_ARCHIVE_PRESENT = (REPO / "Public-Info-Pool" / "Record" / "Community").exists()


@pytest.mark.parametrize("path", _concept_files(), ids=lambda p: str(p.relative_to(REPO)))
def test_resource_pointer_resolves(path: Path):
    """放指针不放本体：每个 repo-relative ``resource`` 指针必须落到实存本体。

    Guards the lesson surfaced 2026-06-21: source-health 注册但未落盘的平台
    曾生成指向不存在目录的指针。Fragment (``#id``) 锚点只校验其宿主文件存在。
    """
    fields = _parse_frontmatter(path.read_text(encoding="utf-8"))
    res = (fields or {}).get("resource", "").strip().strip('"')
    if not res.startswith("/"):  # 仅校验仓内绝对指针；外部 URI / 空值跳过
        return
    rel = res.lstrip("/").split("#", 1)[0]
    if not _ARCHIVE_PRESENT and rel.startswith(_SPARSE_EXCLUDED):
        pytest.skip("archive layer absent (sparse checkout) — pointer target excluded")
    target = REPO / rel
    assert target.exists(), f"{path} resource pointer dangles: {res}"


def test_character_concepts_count():
    """Sanity: character layer is one-concept-per-file."""
    chars = [p for p in (BUNDLE / "characters").glob("*.md") if p.name not in RESERVED]
    assert len(chars) >= 70, f"expected ~72 character concepts, got {len(chars)}"


def test_visualizer_self_contained():
    """Consumer: visualizer.html inlines its data (no backend, no placeholder)."""
    html_path = BUNDLE / "visualizer.html"
    assert html_path.exists(), "visualizer.html missing — run scripts/build_okf_bundle.py"
    html = html_path.read_text(encoding="utf-8")
    assert "__GRAPH_DATA__" not in html, "graph data placeholder not substituted"
    assert "const G = " in html, "inlined graph data not found"


def test_graph_integrity():
    """graph.json edges reference existing nodes."""
    import json

    graph = json.loads((BUNDLE / "graph.json").read_text(encoding="utf-8"))
    ids = {n["id"] for n in graph["nodes"]}
    assert graph["nodes"], "graph has no nodes"
    for e in graph["edges"]:
        assert e["source"] in ids, f"edge source {e['source']} not a node"
        assert e["target"] in ids, f"edge target {e['target']} not a node"
