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

    def fake_render(s, title, subtitle, meta, cover_note, mobile=False, theme='dark'):
        captured.update(title=title, subtitle=subtitle, meta=meta, note=cover_note,
                        mobile=mobile, theme=theme)
        return ("out.html", "out.pdf", 3, 4096)

    monkeypatch.setattr(rr, "render", fake_render)
    monkeypatch.setattr(sys, "argv", ["report_render.py", str(src)])
    rr.main()

    assert captured["title"] == "FM标题"
    assert captured["subtitle"] == "FM副"
    # meta assembled from basis + 产出：author · generated
    assert "基于X" in captured["meta"]
    assert "产出：艾瑞卡 · 2026-06-21" in captured["meta"]
    assert captured["mobile"] is False and captured["theme"] == "dark"  # CLI 默认
    out = capsys.readouterr().out
    assert "out.pdf" in out and "4096 bytes" in out


def test_main_cli_overrides_take_precedence(tmp_path, monkeypatch):
    src = tmp_path / "r2.md"
    _write_md(src, ["title: FM标题"])

    captured = {}
    monkeypatch.setattr(rr, "render",
                        lambda s, t, sub, m, n, mobile=False, theme='dark': captured.update(
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
                        lambda s, t, sub, m, n, mobile=False, theme='dark': captured.update(
                            title=t, subtitle=sub, meta=m) or ("h", "p", 0, 1))
    monkeypatch.setattr(sys, "argv", ["report_render.py", str(src)])
    rr.main()
    assert captured["title"] == "银芯报告"   # default
    assert captured["subtitle"] == ""
    assert captured["meta"] == ""           # no basis/author/generated → empty


# ---------- 纯函数层（P4 拆分产物：零依赖，CI 恒跑） ----------

def test_slice_body_cuts_h1_starts_at_section_zero():
    body = "# 大标题\n\n引言废话\n\n## §0 第一章\n正文\n"
    assert rr.slice_body(body) == "## §0 第一章\n正文\n"


def test_slice_body_falls_back_to_first_h2():
    body = "# 大标题\n\n## 无编号章\n正文\n"
    assert rr.slice_body(body) == "## 无编号章\n正文\n"


def test_slice_body_no_h2_keeps_body():
    body = "没有章节的正文\n"
    assert rr.slice_body(body) == body


def test_slice_body_replaces_divider_with_placeholder():
    out = rr.slice_body("## §0 章\n上文\n\n◇ ◇ ◇\n\n下文\n")
    assert "<DIVIDER>" in out
    assert "◇ ◇ ◇" not in out


def test_decorate_body_html_builds_anchored_toc():
    html, toc = rr.decorate_body_html("<h2>§0 甲</h2><p>x</p><h2>§1 乙</h2>")
    assert toc == [("sec0", "§0 甲"), ("sec1", "§1 乙")]
    assert '<h2 class="section-title" id="sec0">§0 甲</h2>' in html
    assert html.count('<hr class="section-rule">') == 2


def test_decorate_body_html_divider_placeholder_to_ornament():
    html, toc = rr.decorate_body_html("<p><DIVIDER></p>")
    assert html == '<hr class="ornament">'
    assert toc == []


def test_decorate_body_html_no_h2_empty_toc():
    html, toc = rr.decorate_body_html("<p>纯段落</p>")
    assert toc == []
    assert "section-rule" not in html


def test_build_document_assembles_cover_toc_content():
    doc = rr.build_document("<p>正文</p>", [("sec0", "§0 甲")],
                            "主标题", "副标题", "落款<br>二行", "署名")
    assert doc.startswith("<!DOCTYPE html>")
    assert "<h1>主标题</h1>" in doc
    assert '<div class="sub">副标题</div>' in doc
    assert '<div class="meta">落款<br>二行</div>' in doc
    assert '<div class="erica">署名</div>' in doc
    assert '<div class="toc-item">§0 甲</div>' in doc
    assert '<div class="content"><p>正文</p></div>' in doc


def test_build_document_empty_toc_still_renders_toc_page():
    doc = rr.build_document("<p>x</p>", [], "T", "", "", "N")
    assert "目 录" in doc


# ---------- build_html（仅需轻依赖 markdown） ----------

def test_build_html_end_to_end_structure():
    pytest.importorskip("markdown")
    body_md = ("# 大标题\n\n## §0 第一章\n\n正文一\n\n◇ ◇ ◇\n\n"
               "## §1 第二章\n\n正文二\n")
    doc, n_toc = rr.build_html(body_md, "标题", "副", "落款", "署名")
    assert n_toc == 2
    assert "大标题" not in doc          # h1 被封面取代
    assert 'id="sec0">§0 第一章' in doc
    assert 'id="sec1">§1 第二章' in doc
    assert '<hr class="ornament">' in doc
    assert "<DIVIDER>" not in doc


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
