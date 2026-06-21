"""Integration round-trip tests for scripts/silver_memory_tools.py.

Recommendation #3 of the test-hardening effort: the MCP smoke test
(test_mcp_server.py) deliberately skips the WRITE tools "to avoid mutating the
curated archives", so the real file-IO write+parse path of record_decision /
record_lesson / current_continuity was never exercised. These tests do the real
round-trip:

  - redirect DECISIONS_FILE / LESSONS_FILE / CONTINUITY_FILE module globals into
    tmp_path (monkeypatch),
  - actually call the write function,
  - read the file back FROM DISK and assert the record landed,
  - for continuity, write JSON to disk and parse it back, asserting equality.

No file IO is mocked. The real memory/*.md files are never referenced; a guard
test asserts they remain byte-identical across the run.
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
sys.path.insert(0, str(SCRIPTS))

import silver_memory_tools as smt  # noqa: E402


# Minimal but structurally faithful decisions.md: a "### 全局" subtable plus the
# explicit insert anchor record_decision targets first.
_DECISIONS_SKELETON = """# 决策日志

## 当前有效决策

### 全局

| 决策 | 影响范围 | 覆盖 |
|------|----------|------|
| 既有决策一 | 全局 | — |
<!-- DECISIONS-INSERT-ANCHOR -->

### 子项目

| 决策 | 影响范围 | 覆盖 |
|------|----------|------|
| 子项目决策 | wiki | — |
"""

# Minimal lessons-learned.md with two numbered entries + the 维护说明 trailer.
_LESSONS_SKELETON = """# 踩坑记录

## 1. 第一个坑

- **Context**：ctx1
- **Problem**：prob1

## 2. 第二个坑

- **Context**：ctx2
- **Problem**：prob2

---

> **维护说明**：遇到新的坑时立即追加。格式保持统一。
"""


def _seed(tmp_path, monkeypatch):
    """Write skeleton archives into tmp_path and redirect module globals there."""
    mem = tmp_path / "memory"
    mem.mkdir()
    decisions = mem / "decisions.md"
    lessons = mem / "lessons-learned.md"
    continuity = mem / "session-continuity.json"
    decisions.write_text(_DECISIONS_SKELETON, encoding="utf-8")
    lessons.write_text(_LESSONS_SKELETON, encoding="utf-8")
    monkeypatch.setattr(smt, "MEMORY_DIR", mem)
    monkeypatch.setattr(smt, "DECISIONS_FILE", decisions)
    monkeypatch.setattr(smt, "LESSONS_FILE", lessons)
    monkeypatch.setattr(smt, "CONTINUITY_FILE", continuity)
    monkeypatch.setattr(smt, "DIGESTS_DIR", mem / "session-digests")
    return decisions, lessons, continuity


def test_record_decision_roundtrip(tmp_path, monkeypatch):
    decisions, _, _ = _seed(tmp_path, monkeypatch)

    result = smt.record_decision(
        "采用集成测试覆盖真实依赖路径", "全局", rationale="单元 sweep 过度 mock"
    )

    assert result["status"] == "ok", result
    # Real disk read-back: the row must be present in the file.
    on_disk = decisions.read_text(encoding="utf-8")
    assert result["line_added"] in on_disk
    assert "采用集成测试覆盖真实依赖路径" in on_disk
    assert "（因为 单元 sweep 过度 mock）" in on_disk

    # The new row must sit in the 「### 全局」 subtable, BEFORE the anchor, and
    # must NOT have leaked into the 「### 子项目」 subtable.
    lines = on_disk.splitlines()
    anchor_idx = next(i for i, l in enumerate(lines) if smt.DECISIONS_INSERT_ANCHOR in l)
    new_idx = next(i for i, l in enumerate(lines) if "采用集成测试覆盖真实依赖路径" in l)
    subproj_idx = next(i for i, l in enumerate(lines) if l.strip() == "### 子项目")
    assert new_idx < anchor_idx < subproj_idx


def test_record_lesson_roundtrip(tmp_path, monkeypatch):
    _, lessons, _ = _seed(tmp_path, monkeypatch)

    result = smt.record_lesson("第三个坑：未测真实写盘", context="集成测试缺口")

    assert result["status"] == "ok", result
    # Max existing id was 2 -> new id must be 3.
    assert result["lesson_id"] == "3"
    on_disk = lessons.read_text(encoding="utf-8")
    assert "## 3. 第三个坑：未测真实写盘" in on_disk
    assert "集成测试缺口" in on_disk
    # New entry must be inserted ABOVE the 维护说明 trailer.
    lines = on_disk.splitlines()
    new_idx = next(i for i, l in enumerate(lines) if l.startswith("## 3."))
    trailer_idx = next(i for i, l in enumerate(lines) if l.startswith("> **维护说明**"))
    assert new_idx < trailer_idx


def test_continuity_roundtrip(tmp_path, monkeypatch):
    """Write a continuity JSON to disk, then parse it back via the real reader."""
    _, _, continuity = _seed(tmp_path, monkeypatch)

    payload = {
        "last_session": {"id": "abcd1234"},
        "recent_sessions": [{"id": "abcd1234"}],
        "momentum": {"topic_weights": {"集成测试": 9, "schema": 5, "记忆": 2}},
        "updated_at": "2026-06-21T00:00:00+00:00",
    }
    continuity.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    out = smt.current_continuity()
    assert "error" not in out, out
    assert out["last_session"] == {"id": "abcd1234"}
    # topics_hint must be derived (Top-N by weight) from the on-disk data.
    assert out["topics_hint"].startswith("集成测试")
    assert "schema" in out["topics_hint"]


def test_record_decision_empty_summary_rejected(tmp_path, monkeypatch):
    _seed(tmp_path, monkeypatch)
    result = smt.record_decision("", "全局")
    assert result["status"] == "error"


def test_real_memory_files_untouched(tmp_path, monkeypatch):
    """Guard: running the real write path against redirected globals must leave
    the production memory/*.md archives byte-identical."""
    real_decisions = REPO / "memory" / "decisions.md"
    real_lessons = REPO / "memory" / "lessons-learned.md"
    before = {
        p: p.read_bytes() for p in (real_decisions, real_lessons) if p.exists()
    }

    _seed(tmp_path, monkeypatch)
    smt.record_decision("guard 写入", "全局")
    smt.record_lesson("guard 教训")

    for p, original in before.items():
        assert p.read_bytes() == original, f"REAL file mutated: {p}"
