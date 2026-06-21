"""Unit tests for scripts/build_capability_registry.py.

Pure helpers (strip_emoji, first_doc_line, ref/import extraction, graph
traversal) are tested with synthetic inputs. The scan/build/render pipeline is
exercised against a synthetic repo tree by monkeypatching the module ROOT and
derived path constants, so the real memory/*.json files are NEVER written.
"""

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import build_capability_registry as bcr  # noqa: E402


# ============================================================
# Pure helpers
# ============================================================

def test_strip_emoji():
    assert bcr.strip_emoji("hello 🚀 world") == "hello  world"
    assert bcr.strip_emoji("  纯文本  ") == "纯文本"


def test_first_doc_line():
    text = '"""\n\n  第一行内容  \n第二行\n"""\nrest'
    assert bcr.first_doc_line(text) == "第一行内容"


def test_first_doc_line_no_docstring():
    assert bcr.first_doc_line("x = 1\n") == ""


def test_first_doc_line_empty_docstring():
    assert bcr.first_doc_line('"""\n\n\n"""') == ""


def test_py_refs():
    known = {"foo", "bar"}
    text = "run: python foo.py then bar.py and unknown.py"
    assert bcr.py_refs(text, known) == {"foo", "bar"}


def test_import_refs():
    known = {"foo", "bar", "baz"}
    text = "import foo\nfrom bar import x\n    import baz as b\nimport other"
    assert bcr.import_refs(text, known) == {"foo", "bar", "baz"}


def test_reachable_from():
    graph = {"a": {"b"}, "b": {"c"}, "c": set(), "d": {"d"}}
    assert bcr.reachable_from({"a"}, graph) == {"a", "b", "c"}
    # self-loop handled
    assert bcr.reachable_from({"d"}, graph) == {"d"}
    # missing node tolerated
    assert bcr.reachable_from({"z"}, graph) == {"z"}


def test_build_import_graph_discards_self():
    texts = {
        "a": "import a\nimport b",
        "b": "import c",
        "c": "x = 1",
    }
    known = {"a", "b", "c"}
    graph = bcr.build_import_graph(texts, known)
    assert graph["a"] == {"b"}  # self 'a' discarded
    assert graph["b"] == {"c"}
    assert graph["c"] == set()


# ============================================================
# Synthetic repo for scan / build / render
# ============================================================

@pytest.fixture
def fake_repo(tmp_path, monkeypatch):
    root = tmp_path
    # scripts/
    scripts = root / "scripts"
    scripts.mkdir()
    (scripts / "mcp_server.py").write_text(
        '"""MCP server entrypoint."""\n'
        "import livehelper\n"
        "@mcp.tool()\n"
        "def my_tool(x):\n"
        '    """My tool does a thing."""\n'
        "    return x\n",
        encoding="utf-8",
    )
    (scripts / "livehelper.py").write_text(
        '"""A helper imported by the mcp server."""\nimport deephelper\n',
        encoding="utf-8",
    )
    (scripts / "deephelper.py").write_text(
        '"""Deep helper reached transitively."""\nx = 1\n',
        encoding="utf-8",
    )
    (scripts / "cli_tool.py").write_text(
        '"""A CLI tool."""\n'
        'if __name__ == "__main__":\n    pass\n',
        encoding="utf-8",
    )
    (scripts / "tested_only.py").write_text(
        '"""Only referenced by tests."""\nx = 2\n', encoding="utf-8"
    )
    (scripts / "orphan.py").write_text(
        '"""Nobody references me."""\nx = 3\n', encoding="utf-8"
    )
    (scripts / "__init__.py").write_text("", encoding="utf-8")

    # news + wiki script dirs (empty but present)
    (root / "projects" / "news" / "scripts").mkdir(parents=True)
    (root / "projects" / "wiki" / "scripts").mkdir(parents=True)

    # workflows
    wf = root / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "build.yml").write_text(
        "name: 🚀 Build It\n"
        "on:\n"
        "  schedule:\n    - cron: '0 0 * * *'\n"
        "  push:\n  pull_request:\n  workflow_dispatch:\n"
        "jobs:\n  run:\n    steps:\n      - run: python cli_tool.py\n",
        encoding="utf-8",
    )

    # .mcp.json referencing mcp_server.py
    (root / ".mcp.json").write_text(
        json.dumps({"cmd": "python scripts/mcp_server.py"}), encoding="utf-8"
    )

    # commands
    cmds = root / ".claude" / "commands"
    cmds.mkdir(parents=True)
    (cmds / "do-thing.md").write_text(
        "# Title\nRuns the orphan via python orphan.py:\nmore\n", encoding="utf-8"
    )

    # settings.json (no hooks)
    (root / ".claude" / "settings.json").write_text("{}", encoding="utf-8")

    # skills
    sk = root / ".claude" / "skills" / "myskill"
    sk.mkdir(parents=True)
    (sk / "SKILL.md").write_text(
        "---\nname: myskill\ndescription: Does skilled things.\n---\nBody\n",
        encoding="utf-8",
    )
    # a skill dir without SKILL.md should be skipped
    (root / ".claude" / "skills" / "empty").mkdir()

    # projects with CONTEXT.md
    proj = root / "projects" / "news"
    (proj / "CONTEXT.md").write_text("# news\n\n采集器子项目。\n", encoding="utf-8")
    (root / "projects" / "wiki" / "CONTEXT.md").write_text(
        "# wiki\n\nWiki 子项目。\n", encoding="utf-8"
    )
    # a non-dir entry under projects should be skipped
    (root / "projects" / "README.txt").write_text("x", encoding="utf-8")

    # tests dir referencing tested_only
    tdir = root / "tests"
    tdir.mkdir()
    (tdir / "test_x.py").write_text("import tested_only\n", encoding="utf-8")

    # annotations
    mem = root / "memory"
    mem.mkdir()
    (mem / "capability-annotations.json").write_text(
        json.dumps({"scripts_top": {"orphan.py": "中文用途说明"}}), encoding="utf-8"
    )

    # Repoint module constants
    monkeypatch.setattr(bcr, "ROOT", root)
    monkeypatch.setattr(bcr, "REGISTRY", mem / "capability-registry.json")
    monkeypatch.setattr(bcr, "ANNOTATIONS", mem / "capability-annotations.json")
    monkeypatch.setattr(bcr, "INDEX_MD", mem / "capability-index.md")
    return root


def test_index_scripts(fake_repo):
    paths, texts = bcr.index_scripts()
    assert "mcp_server" in paths
    assert "__init__" not in paths
    assert paths["mcp_server"] == "scripts/mcp_server.py"
    assert "MCP server" in texts["mcp_server"]


def test_collect_roots(fake_repo):
    known = {"mcp_server", "livehelper", "deephelper", "cli_tool", "orphan", "tested_only"}
    roots = bcr.collect_roots(known)
    assert "workflow" in roots["cli_tool"]      # run: python cli_tool.py
    assert "mcp" in roots["mcp_server"]          # .mcp.json py_ref
    assert "mcp" in roots["livehelper"]          # imported by mcp_server
    assert "command" in roots["orphan"]          # mentioned in slash command


def test_test_refs(fake_repo):
    known = {"tested_only", "orphan"}
    assert bcr.test_refs(known) == {"tested_only"}


def test_analyze_orchestration(fake_repo):
    orch, paths = bcr.analyze_orchestration()
    # cli_tool: workflow root + cli plane -> live
    assert orch["cli_tool"]["status"] == "live"
    assert "workflow" in orch["cli_tool"]["planes"]
    assert "cli" in orch["cli_tool"]["planes"]
    # livehelper reachable via import from mcp -> live (direct root via mcp)
    assert orch["livehelper"]["status"] == "live"
    # deephelper only reachable transitively -> import plane
    assert orch["deephelper"]["status"] == "live"
    assert orch["deephelper"]["planes"] == ["import"]
    # tested_only -> test-only
    assert orch["tested_only"]["status"] == "test-only"
    assert orch["tested_only"]["planes"] == ["test"]
    # orphan is referenced by a command -> live, not orphaned
    assert orch["orphan"]["status"] == "live"


def test_scan_workflows(fake_repo):
    out = bcr.scan_workflows()
    assert len(out) == 1
    wf = out[0]
    assert wf["name"] == "Build It"  # emoji stripped
    assert set(wf["triggers"]) == {"schedule", "push", "pull_request", "manual"}


def test_scan_python_dir(fake_repo):
    orch, _ = bcr.analyze_orchestration()
    out = bcr.scan_python_dir("scripts", orch)
    ids = {e["id"] for e in out}
    assert "mcp_server.py" in ids
    assert "__init__.py" not in ids
    entry = next(e for e in out if e["id"] == "deephelper.py")
    assert entry["summary"] == "Deep helper reached transitively."
    assert entry["status"] == "live"


def test_scan_python_dir_missing_dir(fake_repo):
    assert bcr.scan_python_dir("does/not/exist", {}) == []


def test_scan_mcp_tools(fake_repo):
    out = bcr.scan_mcp_tools()
    assert any(t["id"] == "my_tool" for t in out)


def test_scan_commands(fake_repo):
    out = bcr.scan_commands()
    assert out[0]["id"] == "do-thing"
    # first non-# line, trailing colon stripped
    assert out[0]["summary"] == "Runs the orphan via python orphan.py"


def test_scan_skills(fake_repo):
    out = bcr.scan_skills()
    ids = {s["id"] for s in out}
    assert "myskill" in ids
    assert "empty" not in ids
    s = next(s for s in out if s["id"] == "myskill")
    assert s["name"] == "myskill"
    assert s["summary"] == "Does skilled things."


def test_scan_projects(fake_repo):
    out = bcr.scan_projects()
    ids = {p["id"] for p in out}
    assert "news" in ids
    assert "wiki" in ids
    assert "README.txt" not in ids
    news = next(p for p in out if p["id"] == "news")
    assert news["summary"] == "采集器子项目。"


def test_merge_annotations():
    registry = {
        "meta": {"x": 1},
        "scripts_top": [{"id": "a.py"}, {"id": "b.py"}],
    }
    annotations = {"scripts_top": {"a.py": "注释A"}}
    merged = bcr.merge_annotations(registry, annotations)
    assert merged["scripts_top"][0]["note_zh"] == "注释A"
    assert "note_zh" not in merged["scripts_top"][1]


def test_build_full(fake_repo):
    registry = bcr.build()
    assert registry["meta"]["counts"]["total"] > 0
    assert "reachability" in registry["meta"]
    reach = registry["meta"]["reachability"]
    assert reach["live"] >= 1
    assert reach["test-only"] == 1
    # annotation merged for orphan.py
    orphan_entry = next(e for e in registry["scripts_top"] if e["id"] == "orphan.py")
    assert orphan_entry.get("note_zh") == "中文用途说明"


def test_render_markdown(fake_repo):
    registry = bcr.build()
    md = bcr.render_markdown(registry)
    assert md.startswith("# 银芯功能目录")
    assert "## 总览" in md
    assert "## 动态编排与可达性" in md
    assert "### 仅测试可达脚本" in md
    assert "tested_only.py" in md


def test_render_markdown_with_orphans(fake_repo, monkeypatch):
    # Force an orphan by removing the command that references orphan.py
    (fake_repo / ".claude" / "commands" / "do-thing.md").write_text(
        "# Title\nnothing referenced here\n", encoding="utf-8"
    )
    registry = bcr.build()
    md = bcr.render_markdown(registry)
    assert "孤儿脚本" in md
    assert "orphan.py" in md
    assert "中文用途说明" in md  # note_zh used as description


# ============================================================
# main()
# ============================================================

def test_main_writes_files(fake_repo, capsys):
    rc = bcr.main()
    assert rc == 0
    assert bcr.REGISTRY.exists()
    assert bcr.INDEX_MD.exists()
    assert "功能目录已重生成" in capsys.readouterr().out


def test_main_check_stale_then_fresh(fake_repo, monkeypatch, capsys):
    # Fresh build first
    assert bcr.main() == 0
    capsys.readouterr()
    # --check should now report consistent
    monkeypatch.setattr(sys, "argv", ["prog", "--check"])
    rc = bcr.main()
    assert rc == 0
    assert "一致" in capsys.readouterr().out


def test_main_check_stale_returns_one(fake_repo, monkeypatch, capsys):
    # No registry written yet -> stale
    monkeypatch.setattr(sys, "argv", ["prog", "--check"])
    rc = bcr.main()
    assert rc == 1
    assert "已过期" in capsys.readouterr().out
