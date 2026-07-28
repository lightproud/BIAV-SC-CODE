"""build_okf_bundle 纯函数与构建逻辑单测（_unit 后缀，避免与 test_okf_bundle.py 冲突）。

锁定 frontmatter / concept 写入 / 各层 build / graph 扫描 / tarball 导出的确定性契约。
所有 BUNDLE 写入重定向到 tmp_path，不污染仓内 okf/。零网络、零 ML。
"""
from __future__ import annotations

import sys
import tarfile
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import build_kb_index as bki
import build_okf_bundle as bok
import okf_frontmatter as okfm
import okf_pointer_layers as opl


# --- _yaml_scalar -----------------------------------------------------------

def test_yaml_scalar_quotes_and_escapes():
    assert okfm._yaml_scalar("abc") == '"abc"'
    # backslash + quote escaped
    assert okfm._yaml_scalar('a"b') == '"a\\"b"'
    assert okfm._yaml_scalar("a\\b") == '"a\\\\b"'


def test_yaml_scalar_strips_newlines_and_cr():
    out = okfm._yaml_scalar("line1\nline2\r more")
    assert "\n" not in out and "\r" not in out
    assert out.startswith('"') and out.endswith('"')


def test_yaml_scalar_coerces_non_str():
    assert okfm._yaml_scalar(123) == '"123"'


# --- frontmatter ------------------------------------------------------------

def test_frontmatter_requires_type():
    with pytest.raises(AssertionError):
        okfm.frontmatter({"title": "x"})
    with pytest.raises(AssertionError):
        okfm.frontmatter({"type": ""})


def test_frontmatter_orders_known_keys_first():
    fm = okfm.frontmatter({
        "timestamp": "2026-01-01",
        "type": "character",
        "title": "Erica",
    })
    lines = fm.splitlines()
    assert lines[0] == "---" and lines[-1] == "---"
    # type appears before timestamp because of priority order
    keys = [ln.split(":")[0] for ln in lines[1:-1]]
    assert keys.index("type") < keys.index("timestamp")
    assert keys.index("type") < keys.index("title")


def test_frontmatter_emits_list_as_inline_array():
    fm = okfm.frontmatter({"type": "t", "tags": ["a", "b"]})
    assert 'tags: ["a", "b"]' in fm


def test_frontmatter_skips_empty_values():
    fm = okfm.frontmatter({"type": "t", "title": "", "description": None, "tags": []})
    assert "title" not in fm
    assert "description" not in fm
    assert "tags" not in fm


def test_frontmatter_includes_unknown_keys_after_known():
    fm = okfm.frontmatter({"type": "t", "custom_key": "v"})
    assert 'custom_key: "v"' in fm


# --- write_concept / write_plain --------------------------------------------

def test_write_concept_roundtrips(tmp_path):
    p = tmp_path / "sub" / "c.md"
    bok.write_concept(p, {"type": "character", "title": "Z"}, "body text")
    text = p.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    assert "body text" in text
    assert text.endswith("\n")


def test_write_plain_has_no_frontmatter(tmp_path):
    p = tmp_path / "index.md"
    bok.write_plain(p, "# Title\n\ncontent")
    text = p.read_text(encoding="utf-8")
    assert not text.startswith("---")
    assert text.endswith("\n")


# --- _read_frontmatter ------------------------------------------------------

def test_read_frontmatter_parses_scalars_and_lists():
    text = '---\ntype: "character"\ntags: ["a", "b"]\ntitle: "Hi"\n---\n\nbody'
    fm = bok._read_frontmatter(text)
    assert fm["type"] == "character"
    assert fm["tags"] == ["a", "b"]
    assert fm["title"] == "Hi"


def test_read_frontmatter_no_block_returns_empty():
    assert bok._read_frontmatter("no frontmatter here") == {}


def test_read_frontmatter_skips_indented_and_colonless():
    text = '---\ntype: "t"\n  indented: x\nnocolon\n---\n\nbody'
    fm = bok._read_frontmatter(text)
    assert fm == {"type": "t"}


# --- layer builders (redirect BUNDLE to tmp_path) ---------------------------

@pytest.fixture
def bundle(tmp_path, monkeypatch):
    b = tmp_path / "okf"
    b.mkdir()
    monkeypatch.setattr(bok, "BUNDLE", b)
    return b


def test_build_characters_writes_concepts_and_index(bundle):
    n = bok.build_characters()
    assert n >= 70
    idx = (bundle / "characters" / "index.md").read_text(encoding="utf-8")
    assert idx.startswith("# 唤醒体角色")
    concepts = list((bundle / "characters").glob("*.md"))
    # at least one non-index concept
    assert len([p for p in concepts if p.name != "index.md"]) == n
    # a concept carries a type
    sample = next(p for p in concepts if p.name != "index.md")
    fm = bok._read_frontmatter(sample.read_text(encoding="utf-8"))
    assert fm["type"] == "character"


def test_build_sources_writes_pointers_with_data_layer(bundle):
    if not (bok.REPO / "Public-Info-Pool" / "Record" / "Community").exists():
        pytest.skip("archive layer absent (sparse checkout) — 指针落点无从核验")
    n = bok.build_sources()
    assert n >= 1
    for p in (bundle / "sources").glob("*.md"):
        if p.name == "index.md":
            continue
        fm = bok._read_frontmatter(p.read_text(encoding="utf-8"))
        assert fm["type"] == "dataset"
        assert any("data_layer" in t for t in fm["tags"])


def test_build_memory_writes_pointers(bundle):
    n = bok.build_memory()
    assert n >= 1
    idx = (bundle / "memory" / "index.md").read_text(encoding="utf-8")
    assert "银芯记忆层指针" in idx


def test_build_story_writes_pointers(bundle):
    n = bok.build_story()
    assert n >= 1
    for p in (bundle / "story").glob("*.md"):
        if p.name == "index.md":
            continue
        fm = bok._read_frontmatter(p.read_text(encoding="utf-8"))
        # story 层扩展（2026-07-04 全仓知识组织）：结构层 json→dataset、研究/TODO→research、README→documentation
        assert fm["type"] in ("dataset", "research", "documentation")


def test_build_root_writes_index_log_readme(bundle):
    counts = {"characters": 5, "sources": 2, "memory": 3, "story": 4}
    bok.build_root(counts)
    idx = (bundle / "index.md").read_text(encoding="utf-8")
    assert "银芯 OKF Bundle" in idx
    log = (bundle / "log.md").read_text(encoding="utf-8")
    assert log.startswith("# 变更史")
    assert bok.TODAY in log
    readme = (bundle / "README.md").read_text(encoding="utf-8")
    assert readme.startswith("---\n")  # readme carries frontmatter


def test_build_root_dedupes_same_day_log(bundle):
    counts = {"characters": 1, "sources": 1, "memory": 1, "story": 1}
    bok.build_root(counts)
    bok.build_root(counts)  # re-run same day
    log = (bundle / "log.md").read_text(encoding="utf-8")
    assert log.count(f"## {bok.TODAY}") == 1


def test_build_root_preserves_prior_date_log(bundle):
    log_path = bundle / "log.md"
    log_path.write_text("# 变更史\n\n## 2025-01-01\n\n- old entry\n", encoding="utf-8")
    bok.build_root({"characters": 1, "sources": 1, "memory": 1, "story": 1})
    log = log_path.read_text(encoding="utf-8")
    assert "2025-01-01" in log
    assert bok.TODAY in log


# --- build_graph / build_visualizer -----------------------------------------

def test_build_graph_and_visualizer(bundle):
    bok.build_characters()
    bok.build_sources()
    graph = bok.build_graph()
    assert graph["stats"]["nodes"] == len(graph["nodes"])
    assert graph["stats"]["edges"] == len(graph["edges"])
    ids = {n["id"] for n in graph["nodes"]}
    for e in graph["edges"]:
        assert e["source"] in ids and e["target"] in ids
    bok.build_visualizer(graph)
    html = (bundle / "visualizer.html").read_text(encoding="utf-8")
    assert "__GRAPH_DATA__" not in html
    assert (bundle / "graph.json").exists()
    # click-through + typed-edge UX is present
    assert "EDGE_STYLE" in html
    assert "window.open" in html
    assert "点击查看档案" in html


def test_build_graph_typed_grounded_edges(bundle):
    """Edges are typed & grounded (variant/lore/cv/link); the painter noise-star
    (all 72 角色同画师，零区分度) is deliberately dropped."""
    bok.build_characters()
    graph = bok.build_graph()
    assert graph["edges"], "no edges derived from real character data"
    rel_types = {e.get("rel_type") for e in graph["edges"]}
    assert rel_types <= {"variant", "lore", "cv", "link"}
    assert all(e.get("rel_type") for e in graph["edges"]), "every edge must carry a type"
    assert not any((e.get("rel") or "").startswith("画师") for e in graph["edges"]), \
        "painter edges must be dropped (single-painter noise star)"
    variants = [e for e in graph["edges"] if e.get("rel_type") == "variant"]
    assert variants, "no variant (base↔variant) edges derived"
    for e in variants:
        assert e["source"].startswith("/characters/")
        assert e["target"].startswith("/characters/")


def test_build_graph_node_deeplinks(bundle):
    """Character nodes with a live wiki page carry a site-relative click-through url."""
    bok.build_characters()
    graph = bok.build_graph()
    linked = [n for n in graph["nodes"]
              if n["id"].startswith("/characters/") and n.get("url")]
    assert linked, "no character deep-links (expected 58/72 with wiki pages)"
    assert all(n["url"].startswith("wiki/zh/awakeners/") for n in linked)


def test_build_graph_link_edges(bundle):
    bok.write_concept(bundle / "a.md", {"type": "t", "title": "A"},
                      "see [B](/b.md)")
    bok.write_concept(bundle / "b.md", {"type": "t", "title": "B"}, "body")
    graph = bok.build_graph()
    link_edges = [e for e in graph["edges"] if e["rel"] == "link"]
    assert any(e["source"] == "/a.md" and e["target"] == "/b.md" for e in link_edges)


# --- export_tarball ---------------------------------------------------------

def test_export_tarball(bundle, tmp_path):
    (bundle / "index.md").write_text("# x\n", encoding="utf-8")
    dest = tmp_path / "out" / "bundle.tar.gz"
    res = bok.export_tarball(dest)
    assert res == dest and dest.exists()
    with tarfile.open(dest, "r:gz") as tar:
        names = tar.getnames()
    assert any(n.startswith("okf") for n in names)


# --- main() with BUNDLE redirected to tmp (real okf/ untouched) -------------
#
# 这三个 main() 测试都显式带 `--allow-missing-archive`（2026-07-26 新增守卫）。
# 它们测的是**构建器机制**（重定向、tarball、不碰真 okf/），跑在 sparse / 无数据湖的
# 环境里；而守卫默认拒绝「社区归档数据源整体缺席」的生成，正是为了挡住本地会话静默
# 删掉 17 个 community 概念。**这里显式放行而不是把守卫调松**：测试环境的缺席是已知
# 且无害的，写成旗标就把这个事实留在了调用点上，而不是让守卫为了迁就测试变弱。

def _repo_tmp_bundle():
    """A unique bundle dir under REPO (main() prints BUNDLE.relative_to(REPO))."""
    import tempfile
    repo = Path(__file__).resolve().parent.parent
    return Path(tempfile.mkdtemp(prefix="_unit_okf_", dir=repo)) / "okf"


def _redirect_bundle(monkeypatch, b):
    """Point every module that writes into the bundle at `b`.

    `bok.BUNDLE` alone is not enough: okf_pointer_layers and build_kb_index each
    hold their own `REPO / "okf"` (deliberately self-contained to avoid a circular
    import), and `bok.main()` drives both. Patching only `bok.BUNDLE` sent the four
    native layers to tmp while every pointer layer + kb_index.json was written
    straight into the tracked okf/ tree — and with the community data lake absent
    (no BIAV_SC_DATA_ROOT) that rewrite silently dropped 17 platform concepts.
    """
    monkeypatch.setattr(bok, "BUNDLE", b)
    monkeypatch.setattr(opl, "BUNDLE", b)
    monkeypatch.setattr(bki, "BUNDLE", b)
    monkeypatch.setattr(bki, "INDEX_PATH", b / "kb_index.json")


def test_main_builds_full_bundle(monkeypatch, capsys):
    import shutil
    b = _repo_tmp_bundle()
    _redirect_bundle(monkeypatch, b)
    monkeypatch.setattr(sys, "argv", ["build_okf_bundle.py", "--allow-missing-archive"])
    try:
        bok.main()
        assert (b / "index.md").exists()
        assert (b / "log.md").exists()
        assert (b / "README.md").exists()
        assert (b / "graph.json").exists()
        assert (b / "visualizer.html").exists()
        assert (b / "characters" / "index.md").exists()
        out = capsys.readouterr().out
        assert "OKF bundle built" in out
    finally:
        shutil.rmtree(b.parent, ignore_errors=True)


def test_main_leaves_the_tracked_bundle_untouched(monkeypatch, capsys):
    """main() under redirection must not write one byte into the tracked okf/.

    Regression guard for the leak this helper closes. Without it the pointer
    layers landed in the real tree, and running the suite in an environment
    without the community data lake rewrote them into a lossy state that the
    stop hook then invited you to commit.
    """
    import shutil
    real = Path(__file__).resolve().parent.parent / "okf"
    if not real.is_dir():
        pytest.skip("tracked okf/ absent (sparse checkout) — 无从核验污染")

    def snapshot():
        return {p: (p.stat().st_mtime_ns, p.stat().st_size)
                for p in sorted(real.rglob("*")) if p.is_file()}

    before = snapshot()
    assert before, "tracked okf/ unexpectedly empty — guard would be vacuous"

    b = _repo_tmp_bundle()
    _redirect_bundle(monkeypatch, b)
    monkeypatch.setattr(sys, "argv", ["build_okf_bundle.py", "--allow-missing-archive"])
    try:
        bok.main()
        capsys.readouterr()
        # The pointer layers really ran — they just landed in the redirected dir.
        # (Asserting only "real/ unchanged" would also pass if opl never ran.)
        assert (b / "assets" / "index.md").exists()
        assert (b / "kb_index.json").exists()
        assert snapshot() == before, "build_okf_bundle wrote into the tracked okf/"
    finally:
        shutil.rmtree(b.parent, ignore_errors=True)


def test_main_with_tarball(tmp_path, monkeypatch):
    import shutil
    b = _repo_tmp_bundle()
    _redirect_bundle(monkeypatch, b)
    tarball = tmp_path / "out.tar.gz"
    monkeypatch.setattr(sys, "argv",
                        ["build_okf_bundle.py", "--allow-missing-archive",
                         "--tarball", str(tarball)])
    try:
        bok.main()
        assert tarball.exists()
        with tarfile.open(tarball, "r:gz") as tar:
            assert any(n.startswith("okf") for n in tar.getnames())
    finally:
        shutil.rmtree(b.parent, ignore_errors=True)
