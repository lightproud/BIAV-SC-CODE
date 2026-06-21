"""Unit tests for scripts/silver_memory_tools.py.

All file-writing functions are redirected to tmp_path via monkeypatching the
module path constants, so the real memory/*.md archives are NEVER touched.
"""

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import silver_memory_tools as smt  # noqa: E402


# ------------------------------------------------------------
# Path redirection fixture — guards the real archives.
# ------------------------------------------------------------

@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    mem = tmp_path / "memory"
    mem.mkdir()
    digests = mem / "session-digests"
    monkeypatch.setattr(smt, "MEMORY_DIR", mem)
    monkeypatch.setattr(smt, "DIGESTS_DIR", digests)
    monkeypatch.setattr(smt, "CONTINUITY_FILE", mem / "session-continuity.json")
    monkeypatch.setattr(smt, "DECISIONS_FILE", mem / "decisions.md")
    monkeypatch.setattr(smt, "LESSONS_FILE", mem / "lessons-learned.md")
    return mem


# ============================================================
# current_continuity
# ============================================================

def test_continuity_missing_file(sandbox):
    out = smt.current_continuity()
    assert "error" in out
    assert "不存在" in out["error"]
    assert out["last_session"] is None


def test_continuity_bad_json(sandbox):
    smt.CONTINUITY_FILE.write_text("{not json", encoding="utf-8")
    out = smt.current_continuity()
    assert "解析失败" in out["error"]


def test_continuity_basic(sandbox):
    data = {
        "last_session": {"id": "abc123"},
        "recent_sessions": [{"id": "x"}],
        "momentum": {"topic_weights": {"wiki": 5, "news": 9, "site": 1, "a": 2, "b": 3, "c": 4}},
        "updated_at": "2026-06-21",
    }
    smt.CONTINUITY_FILE.write_text(json.dumps(data), encoding="utf-8")
    out = smt.current_continuity()
    assert out["last_session"]["id"] == "abc123"
    assert out["updated_at"] == "2026-06-21"
    # topics_hint = top 5 by weight desc
    assert out["topics_hint"] == "news, wiki, c, b, a"


def test_continuity_resolves_digest_file(sandbox):
    smt.DIGESTS_DIR.mkdir()
    (smt.DIGESTS_DIR / "2026-06-20-abc123.md").write_text("x", encoding="utf-8")
    (smt.DIGESTS_DIR / "2026-06-21-abc123.md").write_text("y", encoding="utf-8")
    data = {"last_session": {"id": "abc123"}, "momentum": {}}
    smt.CONTINUITY_FILE.write_text(json.dumps(data), encoding="utf-8")
    out = smt.current_continuity()
    assert out["last_session_file"].endswith("2026-06-21-abc123.md")


def test_continuity_no_momentum_no_hint(sandbox):
    data = {"last_session": {"id": ""}, "momentum": {}}
    smt.CONTINUITY_FILE.write_text(json.dumps(data), encoding="utf-8")
    out = smt.current_continuity()
    assert out["topics_hint"] == ""
    assert out["last_session_file"] == ""


# ============================================================
# record_decision
# ============================================================

DECISIONS_WITH_ANCHOR = """# 决策日志

## 当前有效决策

### 全局

| 决策 | 影响范围 | 覆盖 |
|------|------|------|
| 旧决策一 | 全局 | — |
<!-- DECISIONS-INSERT-ANCHOR -->

### ARCH-01 子表

| 决策 | 影响范围 | 覆盖 |
|------|------|------|
| 架构决策 | arch | — |
"""

DECISIONS_NO_ANCHOR = """# 决策日志

## 当前有效决策

### 全局

| 决策 | 影响范围 | 覆盖 |
|------|------|------|
| 旧决策一 | 全局 | — |
| 旧决策二 | 全局 | — |

### ARCH-01 子表

| 决策 | 影响范围 | 覆盖 |
|------|------|------|
| 架构决策 | arch | — |
"""


def test_record_decision_empty_summary(sandbox):
    out = smt.record_decision("", "全局")
    assert out["status"] == "error"
    assert "summary" in out["message"]


def test_record_decision_empty_scope(sandbox):
    out = smt.record_decision("内容", "  ")
    assert out["status"] == "error"
    assert "scope" in out["message"]


def test_record_decision_missing_file(sandbox):
    out = smt.record_decision("内容", "全局")
    assert out["status"] == "error"
    assert "档案不存在" in out["message"]


def test_record_decision_with_anchor(sandbox):
    smt.DECISIONS_FILE.write_text(DECISIONS_WITH_ANCHOR, encoding="utf-8")
    out = smt.record_decision("新决策", "全局", rationale="有理由")
    assert out["status"] == "ok"
    assert out["line_added"] == "| 新决策（因为 有理由） | 全局 | — |"
    text = smt.DECISIONS_FILE.read_text(encoding="utf-8")
    lines = text.splitlines()
    anchor_idx = next(i for i, l in enumerate(lines) if smt.DECISIONS_INSERT_ANCHOR in l)
    # new line inserted immediately before the anchor
    assert lines[anchor_idx - 1] == "| 新决策（因为 有理由） | 全局 | — |"
    # ARCH sub-table not polluted
    assert "| 架构决策 | arch | — |" in text


def test_record_decision_no_rationale(sandbox):
    smt.DECISIONS_FILE.write_text(DECISIONS_WITH_ANCHOR, encoding="utf-8")
    out = smt.record_decision("纯决策", "wiki")
    assert out["line_added"] == "| 纯决策 | wiki | — |"


def test_record_decision_fallback_to_global_table(sandbox):
    smt.DECISIONS_FILE.write_text(DECISIONS_NO_ANCHOR, encoding="utf-8")
    out = smt.record_decision("回退决策", "全局")
    assert out["status"] == "ok"
    lines = smt.DECISIONS_FILE.read_text(encoding="utf-8").splitlines()
    # Should be inserted right after the last row of the 全局 sub-table,
    # i.e. after "旧决策二", before the blank line preceding ARCH-01.
    idx = lines.index("| 旧决策二 | 全局 | — |")
    assert lines[idx + 1] == "| 回退决策 | 全局 | — |"
    # ARCH sub-table untouched
    assert "| 架构决策 | arch | — |" in smt.DECISIONS_FILE.read_text(encoding="utf-8")


def test_record_decision_no_global_section(sandbox):
    smt.DECISIONS_FILE.write_text("# 决策日志\n\n没有任何子表\n", encoding="utf-8")
    out = smt.record_decision("孤决策", "全局")
    assert out["status"] == "error"
    assert "全局" in out["message"]


def test_record_decision_global_section_no_rows(sandbox):
    smt.DECISIONS_FILE.write_text("### 全局\n\n（暂无表格）\n\n## 下一段\n", encoding="utf-8")
    out = smt.record_decision("无行决策", "全局")
    assert out["status"] == "error"
    assert "未找到表格行" in out["message"]


# ============================================================
# record_lesson
# ============================================================

LESSONS_WITH_MAINTENANCE = """# 踩坑记录

## 1. 第一条教训

- **Context**：略
- **Problem**：略

## 30. 第三十条教训

- **Context**：略
- **Problem**：略

---

> **维护说明**：编号持续递增。
"""

LESSONS_NO_MAINTENANCE = """# 踩坑记录

## 5. 第五条

- **Context**：略
- **Problem**：略
"""


def test_record_lesson_empty_summary(sandbox):
    out = smt.record_lesson("")
    assert out["status"] == "error"
    assert "summary" in out["message"]


def test_record_lesson_missing_file(sandbox):
    out = smt.record_lesson("新教训")
    assert out["status"] == "error"
    assert "档案不存在" in out["message"]


def test_record_lesson_increments_id_before_maintenance(sandbox):
    smt.LESSONS_FILE.write_text(LESSONS_WITH_MAINTENANCE, encoding="utf-8")
    out = smt.record_lesson("抽样率失真", context="把输出层当全量")
    assert out["status"] == "ok"
    assert out["lesson_id"] == "31"
    text = smt.LESSONS_FILE.read_text(encoding="utf-8")
    assert "## 31. 抽样率失真" in text
    assert "- **Context**：把输出层当全量" in text
    assert "- **Problem**：抽样率失真" in text
    # Inserted before the maintenance block / separator
    lines = text.splitlines()
    new_idx = lines.index("## 31. 抽样率失真")
    sep_idx = next(i for i, l in enumerate(lines) if l.strip() == "---")
    maint_idx = next(i for i, l in enumerate(lines) if l.startswith("> **维护说明**"))
    assert new_idx < sep_idx < maint_idx


def test_record_lesson_default_context(sandbox):
    smt.LESSONS_FILE.write_text(LESSONS_NO_MAINTENANCE, encoding="utf-8")
    out = smt.record_lesson("只有标题")
    assert out["lesson_id"] == "6"
    text = smt.LESSONS_FILE.read_text(encoding="utf-8")
    assert "（待守密人补充）" in text


def test_record_lesson_empty_file_starts_at_one(sandbox):
    smt.LESSONS_FILE.write_text("", encoding="utf-8")
    out = smt.record_lesson("第一条")
    assert out["lesson_id"] == "1"
    assert "## 1. 第一条" in smt.LESSONS_FILE.read_text(encoding="utf-8")


def test_record_lesson_appends_at_end_without_maintenance(sandbox):
    smt.LESSONS_FILE.write_text(LESSONS_NO_MAINTENANCE, encoding="utf-8")
    smt.record_lesson("末尾追加")
    text = smt.LESSONS_FILE.read_text(encoding="utf-8")
    # New heading appears after the existing one
    assert text.index("## 5. 第五条") < text.index("## 6. 末尾追加")


# ============================================================
# _self_check (smoke)
# ============================================================

def test_self_check_runs(sandbox, capsys):
    smt._self_check()
    out = capsys.readouterr().out
    assert "self-check" in out
    assert "REPO_ROOT" in out


# ============================================================
# Extra branch coverage
# ============================================================

LESSONS_MAINT_NO_SEP = """# 踩坑记录

## 7. 第七条

- **Context**：略

> **维护说明**：紧贴无分隔线。
"""


def test_record_lesson_maintenance_without_separator(sandbox):
    smt.LESSONS_FILE.write_text(LESSONS_MAINT_NO_SEP, encoding="utf-8")
    out = smt.record_lesson("无分隔追加")
    assert out["lesson_id"] == "8"
    lines = smt.LESSONS_FILE.read_text(encoding="utf-8").splitlines()
    new_idx = lines.index("## 8. 无分隔追加")
    maint_idx = next(i for i, l in enumerate(lines) if l.startswith("> **维护说明**"))
    assert new_idx < maint_idx


def test_record_lesson_non_numeric_heading_skipped(sandbox):
    # A heading shaped like "## N." but with a non-int group is impossible via the
    # regex (\d+), but headings with huge/odd numbers and unrelated "##" lines must
    # not break numbering. Mix in a normal max id of 12.
    smt.LESSONS_FILE.write_text(
        "# 踩坑\n\n## 12. 正常\n\n## 标题没有编号\n", encoding="utf-8"
    )
    out = smt.record_lesson("接续")
    assert out["lesson_id"] == "13"


def test_record_decision_read_error_directory(sandbox):
    # Point DECISIONS_FILE at a directory -> read_text raises a generic Exception
    # (IsADirectoryError), exercising the non-FileNotFoundError read branch.
    (sandbox / "decisions.md").mkdir()
    out = smt.record_decision("内容", "全局")
    assert out["status"] == "error"
    assert "读取失败" in out["message"]


def test_record_lesson_read_error_directory(sandbox):
    (sandbox / "lessons-learned.md").mkdir()
    out = smt.record_lesson("内容")
    assert out["status"] == "error"
    assert "读取失败" in out["message"]


def test_record_decision_write_failure(sandbox, monkeypatch):
    smt.DECISIONS_FILE.write_text(DECISIONS_WITH_ANCHOR, encoding="utf-8")
    monkeypatch.setattr(
        type(smt.DECISIONS_FILE), "write_text",
        lambda self, *a, **k: (_ for _ in ()).throw(OSError("disk full")),
    )
    out = smt.record_decision("内容", "全局")
    assert out["status"] == "error"
    assert "写入失败" in out["message"]


def test_record_lesson_write_failure(sandbox, monkeypatch):
    smt.LESSONS_FILE.write_text(LESSONS_NO_MAINTENANCE, encoding="utf-8")
    monkeypatch.setattr(
        type(smt.LESSONS_FILE), "write_text",
        lambda self, *a, **k: (_ for _ in ()).throw(OSError("disk full")),
    )
    out = smt.record_lesson("内容")
    assert out["status"] == "error"
    assert "写入失败" in out["message"]


def test_continuity_digest_glob_error(sandbox, monkeypatch):
    # Force the digest glob to raise so the inner except is exercised.
    smt.DIGESTS_DIR.mkdir()
    data = {"last_session": {"id": "zzz"}, "momentum": {}}
    smt.CONTINUITY_FILE.write_text(json.dumps(data), encoding="utf-8")

    real_glob = Path.glob

    def boom(self, pattern):
        if "zzz" in pattern:
            raise OSError("boom")
        return real_glob(self, pattern)

    monkeypatch.setattr(Path, "glob", boom)
    out = smt.current_continuity()
    # error swallowed, last_session_file stays empty
    assert out["last_session_file"] == ""
