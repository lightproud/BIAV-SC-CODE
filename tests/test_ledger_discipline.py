"""台账纪律机器守卫 —— 「班规贴在墙上没人念，就等于没有」。

`memory/todo.md` 开篇写死了自己的纪律（形式定死、清单可增），但**没有一行代码在判**，
于是 2026-07-26 审视会话一次性发现两类违规：两条同号 T60（违反「编号持续追加不重用」）、
9 条已清行赖在开账表里（违反「清账不删行：状态改已清并移入已清节」）。两类都是
**机器完全可判定**的，属抗漂移提案（`Public-Info-Pool/Resource/proposal/
drift-resistant-architecture-20260726.md`）§2 招二：一次性投入、永久免修。

守的是台账的**结构不变量**，不是内容好坏——不判「这条账该不该开」，只判
「同一个号是不是被用了两次」「已清的行还在不在开账表里」这类形式问题。

诚实边界：本组只守 `memory/todo.md` 一档。`decisions.md` 的「覆盖」列是自由文本（多为
条目标题或「—」）、不是编号，机器判不了指向，故本组不碰——不做够不着的承诺。
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TODO = REPO / "memory" / "todo.md"

ROW = re.compile(r"^\|\s*([TC]\d+)\s*\|")


def _sections() -> tuple[list[str], list[str]]:
    """返回（开账段行, 已清段行）。分段锚点即台账自己的两个二级标题。"""
    text = TODO.read_text(encoding="utf-8")
    body = text.split("## 开账", 1)[1]
    open_part, closed_part = body.split("## 已清", 1)
    return open_part.split("\n"), closed_part.split("\n")


def _ids(lines: list[str]) -> list[str]:
    return [m.group(1) for m in (ROW.match(l) for l in lines) if m]


def _row_blocks(lines: list[str]) -> list[tuple[str, str]]:
    """(ID, 整行块) —— 部分账目（如 T62）跨多行，类别/状态落在续行上，
    按行切会误判「缺类别」。块从 ID 行起、到下一条 ID 行前止。"""
    blocks: list[tuple[str, str]] = []
    current_id: str | None = None
    buf: list[str] = []
    for line in lines:
        m = ROW.match(line)
        if m:
            if current_id:
                blocks.append((current_id, "\n".join(buf)))
            current_id, buf = m.group(1), [line]
        elif current_id:
            buf.append(line)
    if current_id:
        blocks.append((current_id, "\n".join(buf)))
    return blocks


def test_ids_are_unique_within_each_table() -> None:
    """同一张表内不得重号。"""
    for name, lines in zip(("开账", "已清"), _sections()):
        ids = _ids(lines)
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        assert not dupes, f"{name}表内重号: {dupes}"


def test_ids_are_not_reused_across_tables() -> None:
    """编号持续追加、不重用——跨表撞号是 2026-07-26 T60 那次的原形。"""
    open_ids, closed_ids = (_ids(x) for x in _sections())
    clash = sorted(set(open_ids) & set(closed_ids))
    assert not clash, f"开账与已清撞号: {clash}（编号不重用；开着的账让号、已清账保号防断链）"


def test_closed_rows_do_not_linger_in_the_open_table() -> None:
    """清账不删行，但要移入已清节——留在开账表里就是「看起来还欠着」。"""
    open_lines, _ = _sections()
    lingering = []
    for ident, block in _row_blocks(open_lines):
        # 状态列 = 块内最后一个非空单元格（跨行账目的状态落在续行末尾）
        cells = [c.strip() for c in block.replace("\n", " ").split("|")]
        status = next((c for c in reversed(cells) if c), "")
        if status.startswith("已清"):
            lingering.append(ident)
    assert not lingering, (
        f"以下已清行仍在开账表内，应移入「已清」节: {lingering}"
    )


def test_open_rows_carry_a_category_and_a_source_pointer() -> None:
    """每条：ID / 账目 / 类别 / 源出处 / 状态——缺类别或源出处的账日后无从追。"""
    open_lines, _ = _sections()
    CATEGORIES = {"裁定", "预算", "观察", "黑池输入"}
    bad = []
    for ident, block in _row_blocks(open_lines):
        cells = [c.strip() for c in block.replace("\n", " ").split("|") if c.strip()]
        if not any(c in CATEGORIES for c in cells):
            bad.append(ident)
    assert not bad, f"以下开账行无合法类别（{sorted(CATEGORIES)}）: {bad}"


def test_no_placeholder_ids() -> None:
    """占位号（T0 / C0）不是账，出现即为模板残留。"""
    for name, lines in zip(("开账", "已清"), _sections()):
        placeholders = [i for i in _ids(lines) if i in {"T0", "C0"}]
        assert not placeholders, f"{name}表含占位编号: {placeholders}"
