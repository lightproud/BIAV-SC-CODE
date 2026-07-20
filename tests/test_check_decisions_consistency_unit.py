"""test_check_decisions_consistency_unit.py —— check_decisions_consistency 分支覆盖。

不改动现有 tests/test_decisions_consistency.py。这里用 monkeypatch 把模块级路径
指向合成档案，逐条触发 C0-C5 失败分支 + _active_section + main() 两个出口。
"""

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import check_decisions_consistency as cdc  # noqa: E402


# ---------- _active_section ----------

def test_active_section_truncates_at_archive_marker():
    text = "有效内容\n## 决策历史归档\n归档内容"
    assert cdc._active_section(text) == "有效内容\n"


def test_active_section_returns_all_when_no_marker():
    text = "全是有效内容\n无归档标记"
    assert cdc._active_section(text) == text


# ---------- helpers ----------

def _good_decisions_text():
    return (
        f"{cdc.ANCHOR}\n"
        f"{cdc.GLOBAL_TABLE_HEADER}\n"
        "|---|---|---|\n"
        "当前有效区内容\n"
        "## 决策历史归档\n"
        "归档区可以放 projects/bpt-next/ 等旧路径\n"
    )


def _good_claude_text():
    return "银芯为公开信息层（整层公开）。"


def _setup(monkeypatch, tmp_path, dtext=None, ctext=None,
           make_decisions=True, make_archive=True, make_claude=True):
    decisions = tmp_path / "decisions.md"
    archive = tmp_path / "decisions-archive.md"
    claude = tmp_path / "CLAUDE.md"
    if make_decisions:
        decisions.write_text(dtext if dtext is not None else _good_decisions_text(),
                             encoding="utf-8")
    if make_archive:
        archive.write_text("archive", encoding="utf-8")
    if make_claude:
        claude.write_text(ctext if ctext is not None else _good_claude_text(),
                          encoding="utf-8")
    monkeypatch.setattr(cdc, "DECISIONS", decisions)
    monkeypatch.setattr(cdc, "ARCHIVE", archive)
    monkeypatch.setattr(cdc, "CLAUDE_MD", claude)


# ---------- check(): all-pass synthetic ----------

def test_check_all_pass_synthetic(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    assert cdc.check() == []


# ---------- C0 ----------

def test_c0_decisions_missing(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, make_decisions=False)
    errors = cdc.check()
    assert len(errors) == 1
    assert errors[0].startswith("C0")


# ---------- C1 ----------

def test_c1_anchor_missing(monkeypatch, tmp_path):
    dtext = (f"{cdc.GLOBAL_TABLE_HEADER}\n内容\n## 决策历史归档\n")
    _setup(monkeypatch, tmp_path, dtext=dtext)
    assert any(e.startswith("C1") for e in cdc.check())


def test_c1_anchor_duplicated(monkeypatch, tmp_path):
    dtext = (f"{cdc.ANCHOR}\n{cdc.ANCHOR}\n{cdc.GLOBAL_TABLE_HEADER}\n"
             "内容\n## 决策历史归档\n")
    _setup(monkeypatch, tmp_path, dtext=dtext)
    assert any("2 次" in e for e in cdc.check())


# ---------- C2 ----------

def test_c2_global_table_header_missing(monkeypatch, tmp_path):
    dtext = f"{cdc.ANCHOR}\n没有表头\n## 决策历史归档\n"
    _setup(monkeypatch, tmp_path, dtext=dtext)
    assert any(e.startswith("C2") for e in cdc.check())


# ---------- C3 ----------

def test_c3_archive_missing(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, make_archive=False)
    assert any(e.startswith("C3") for e in cdc.check())


# ---------- C4 ----------

def test_c4_claude_missing_positioning(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, ctext="银芯定位说明（无关键词）")
    assert any(e.startswith("C4") and "未声明" in e for e in cdc.check())


def test_c4_claude_md_file_missing(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, make_claude=False)
    assert any(e.startswith("C4") and "不存在" in e for e in cdc.check())


def test_c4_decisions_residual_restricted_layer(monkeypatch, tmp_path):
    dtext = (f"{cdc.ANCHOR}\n{cdc.GLOBAL_TABLE_HEADER}\n"
             "残留 银芯（受限/非公开层） 旧定位\n## 决策历史归档\n")
    _setup(monkeypatch, tmp_path, dtext=dtext)
    assert any("受限/非公开层" in e for e in cdc.check())


# ---------- C5 ----------

def test_c5_deleted_path_in_active_region(monkeypatch, tmp_path):
    dtext = (f"{cdc.ANCHOR}\n{cdc.GLOBAL_TABLE_HEADER}\n"
             "当前有效区误含 projects/bpt-next/ 路径\n"
             "## 决策历史归档\n")
    _setup(monkeypatch, tmp_path, dtext=dtext)
    errors = cdc.check()
    assert any(e.startswith("C5") and "bpt-next" in e for e in errors)


# ---------- main() ----------

def test_main_returns_zero_when_clean(monkeypatch, tmp_path, capsys):
    _setup(monkeypatch, tmp_path)
    rc = cdc.main()
    assert rc == 0
    assert "全部通过" in capsys.readouterr().out


def test_main_returns_one_when_errors(monkeypatch, tmp_path, capsys):
    _setup(monkeypatch, tmp_path, make_archive=False)
    rc = cdc.main()
    assert rc == 1
    out = capsys.readouterr().out
    assert "失败" in out
