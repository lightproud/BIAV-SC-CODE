"""test_report_render_unit.py —— report_render 纯函数 + main 路径单测。

parse_frontmatter 纯逻辑全覆盖；render 需 markdown+weasyprint，importorskip 守护。
main 的 argparse / frontmatter 拼装路径用 monkeypatch 替掉重 render。
"""

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import report_render as rr  # noqa: E402


# ---------- parse_frontmatter ----------

def test_parse_frontmatter_no_frontmatter():
    raw = "# 标题\n正文\n"
    fm, body = rr.parse_frontmatter(raw)
    assert fm == {}
    assert body == raw


def test_parse_frontmatter_basic():
    raw = "---\ntitle: 银芯报告\nsubtitle: 副标题\n---\n正文开始\n"
    fm, body = rr.parse_frontmatter(raw)
    assert fm["title"] == "银芯报告"
    assert fm["subtitle"] == "副标题"
    assert body == "正文开始\n"


def test_parse_frontmatter_strips_quotes():
    raw = '---\ntitle: "带引号"\nauthor: \'艾瑞卡\'\n---\nx\n'
    fm, _ = rr.parse_frontmatter(raw)
    assert fm["title"] == "带引号"
    assert fm["author"] == "艾瑞卡"


def test_parse_frontmatter_value_with_colon():
    raw = "---\ngenerated: 2026-06-21 12:30\n---\nbody\n"
    fm, _ = rr.parse_frontmatter(raw)
    # only first colon splits key/value
    assert fm["generated"] == "2026-06-21 12:30"


def test_parse_frontmatter_ignores_lines_without_colon():
    raw = "---\ntitle: T\njust a line\n---\nb\n"
    fm, _ = rr.parse_frontmatter(raw)
    assert fm == {"title": "T"}


# ---------- main (render monkeypatched) ----------

def _write_md(path: Path, fm_lines, body="## §0 引言\n正文\n"):
    fm = "---\n" + "\n".join(fm_lines) + "\n---\n" if fm_lines else ""
    path.write_text(fm + body, encoding="utf-8")


def test_main_uses_frontmatter_title_and_meta(tmp_path, monkeypatch, capsys):
    src = tmp_path / "r.md"
    _write_md(src, ["title: FM标题", "subtitle: FM副", "basis: 基于X",
                    "author: 艾瑞卡", "generated: 2026-06-21"])

    captured = {}

    def fake_render(s, title, subtitle, meta, cover_note):
        captured.update(title=title, subtitle=subtitle, meta=meta, note=cover_note)
        return ("out.html", "out.pdf", 3, 4096)

    monkeypatch.setattr(rr, "render", fake_render)
    monkeypatch.setattr(sys, "argv", ["report_render.py", str(src)])
    rr.main()

    assert captured["title"] == "FM标题"
    assert captured["subtitle"] == "FM副"
    # meta assembled from basis + 产出：author · generated
    assert "基于X" in captured["meta"]
    assert "产出：艾瑞卡 · 2026-06-21" in captured["meta"]
    out = capsys.readouterr().out
    assert "out.pdf" in out and "4096 bytes" in out


def test_main_cli_overrides_take_precedence(tmp_path, monkeypatch):
    src = tmp_path / "r2.md"
    _write_md(src, ["title: FM标题"])

    captured = {}
    monkeypatch.setattr(rr, "render",
                        lambda s, t, sub, m, n: captured.update(
                            title=t, subtitle=sub, meta=m, note=n) or ("h", "p", 0, 1))
    monkeypatch.setattr(sys, "argv", [
        "report_render.py", str(src),
        "--title", "CLI标题",
        "--subtitle", "CLI副",
        "--meta", "CLI落款",
        "--cover-note", "署名行",
    ])
    rr.main()
    assert captured["title"] == "CLI标题"
    assert captured["subtitle"] == "CLI副"
    assert captured["meta"] == "CLI落款"
    assert captured["note"] == "署名行"


def test_main_defaults_when_frontmatter_empty(tmp_path, monkeypatch):
    src = tmp_path / "r3.md"
    _write_md(src, [], body="## §0 节\n内容\n")

    captured = {}
    monkeypatch.setattr(rr, "render",
                        lambda s, t, sub, m, n: captured.update(
                            title=t, subtitle=sub, meta=m) or ("h", "p", 0, 1))
    monkeypatch.setattr(sys, "argv", ["report_render.py", str(src)])
    rr.main()
    assert captured["title"] == "银芯报告"   # default
    assert captured["subtitle"] == ""
    assert captured["meta"] == ""           # no basis/author/generated → empty


# ---------- render (heavy deps guarded) ----------

def test_render_produces_html_and_toc(tmp_path):
    pytest.importorskip("markdown")
    pytest.importorskip("weasyprint")

    src = tmp_path / "doc.md"
    src.write_text(
        "---\ntitle: T\n---\n"
        "# 大标题\n\n"
        "## §0 第一章\n\n正文一 ◇ ◇ ◇ 分隔。\n\n"
        "## §1 第二章\n\n正文二\n",
        encoding="utf-8",
    )
    out_html, out_pdf, n_toc, size = rr.render(
        str(src), "标题", "副标题", "落款")
    assert Path(out_html).exists()
    assert Path(out_pdf).exists()
    assert n_toc == 2
    assert size > 0
    html = Path(out_html).read_text(encoding="utf-8")
    assert "section-title" in html
    assert "标题" in html
