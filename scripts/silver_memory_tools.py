"""silver_memory_tools.py —— 银芯记忆增强工具集

银芯记忆增强工具集 —— 面向黑池记忆（需求 4）的银芯自建实现。对标 claude-mem 能力但保持 MIT。

本模块为纯 Python 函数库，不携带 MCP 装饰器，函数由 scripts/mcp_server.py 注册。

导出函数（3 个）：
    current_continuity()            —— 读取 memory/session-continuity.json 连续性链
    record_decision(summary, scope) —— 追加一行到 memory/decisions.md 当前有效决策表格
    record_lesson(summary, context) —— 追加一条到 memory/lessons-learned.md 末尾

历史：recall_session / session_progress 随自动记忆子系统于 2026-06-20 退役删除
（守密人裁定，见 memory/decisions.md），其依赖的 memory_search / session-digests /
progress.jsonl 已一并移除。

依赖：仅 Python 标准库。
"""

from __future__ import annotations

import json
import re
from datetime import datetime, UTC
from pathlib import Path
from typing import Any

# ------------------------------------------------------------
# 路径锚点
# ------------------------------------------------------------

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
MEMORY_DIR = REPO_ROOT / "memory"
DIGESTS_DIR = MEMORY_DIR / "session-digests"
CONTINUITY_FILE = MEMORY_DIR / "session-continuity.json"
DECISIONS_FILE = MEMORY_DIR / "decisions.md"
LESSONS_FILE = MEMORY_DIR / "lessons-learned.md"


# ============================================================
# 工具 1：current_continuity —— 会话连续性链
# ============================================================

def current_continuity() -> dict:
    """档案调取 —— 返回 memory/session-continuity.json 当前内容 + 辅助字段。

    艾瑞卡在新会话启动时读取此档案，获取上次会话的话题、决策、待办事项。
    额外补充 last_session_file（上次 session 对应的 digest 文件路径）和
    topics_hint（话题动量 Top5 的串联字符串，供 prompt injection 使用）。

    Returns:
        {
          "last_session": {...},        # 原 JSON 内容
          "recent_sessions": [...],
          "momentum": {...},
          "updated_at": "...",
          "last_session_file": "<digest 文件绝对路径，若能定位>",
          "topics_hint": "话题1, 话题2, ..."
        }
    """
    base: dict[str, Any] = {
        "last_session": None,
        "recent_sessions": [],
        "momentum": {},
        "last_session_file": "",
        "topics_hint": "",
    }

    if not CONTINUITY_FILE.exists():
        base["error"] = f"连续性档案不存在: {CONTINUITY_FILE}"
        return base

    try:
        data = json.loads(CONTINUITY_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        base["error"] = f"连续性档案解析失败: {exc}"
        return base

    base.update(data)

    # 推导 last_session_file
    last = data.get("last_session") or {}
    sid_short = (last.get("id") or "").strip()
    if sid_short and DIGESTS_DIR.exists():
        try:
            candidates = sorted(DIGESTS_DIR.glob(f"*-{sid_short}.md"))
            if candidates:
                base["last_session_file"] = str(candidates[-1])
        except OSError:  # 目录不可读；别的异常不该静默
            pass

    # 推导 topics_hint
    momentum = data.get("momentum") or {}
    weights: dict = momentum.get("topic_weights") or {}
    if weights:
        top = sorted(weights.items(), key=lambda kv: kv[1], reverse=True)[:5]
        base["topics_hint"] = ", ".join(t for t, _ in top)

    return base


# ============================================================
# 工具 2：record_decision —— 追加决策到 decisions.md
# ============================================================

DECISIONS_INSERT_ANCHOR = "<!-- DECISIONS-INSERT-ANCHOR -->"


def _one_line(s: str) -> str:
    """折成单行：换行 / 制表 / 连续空白一律并成一个空格。

    写入面吃的是自由文本（MCP 工具入参）。带换行的 summary 经 `lines.insert`
    落盘后会**在表格 / 标题中间劈出新行**——3 列表被截断、后半截漂在表外，
    档案结构就此损坏且无任何报错。
    """
    return " ".join(str(s).split())


def _cell(s: str) -> str:
    """markdown 表格单元格转义：折单行 + 转义 `|`。

    summary 里一个裸 `|`（如「A|B 二选一」）会把 3 列行撑成 4 列，
    与 check_decisions_consistency C2 锁定的 schema 脱节（该检查只验表头，
    不会发现被撑坏的数据行）。
    """
    return _one_line(s).replace("|", "\\|")


def record_decision(summary: str, scope: str, rationale: str = "") -> dict:
    """档案写入 —— 追加一行到 memory/decisions.md 的「当前有效决策 / 全局」表末尾。

    定位策略（v2，2026-06-21 重构）：优先定位显式插入锚点
    `<!-- DECISIONS-INSERT-ANCHOR -->`（置于「### 全局」表末行之后），在锚点行
    **之前**插入新决策行。无锚点时回退为「锚定『### 全局』子表末行」——而非旧逻辑
    「『## 当前有效决策』段落内最后一个表格行」。旧逻辑在档案新增 ARCH-01 等
    后续子表后会把新行误插进平台表中间并污染列数（见 decisions.md 2026-06-21 治理）。

    表格 schema：`| 决策 | 影响范围 | 覆盖 |`（覆盖列默认填 `—` 表示不覆盖前条）。

    若 rationale 非空，则以「因为 …」拼接到 summary 末尾形成决策正文。

    Args:
        summary:   决策正文（简短陈述）
        scope:     影响范围（如 "全局"、"wiki"、"黑池建设"）
        rationale: 决策理由，可选；若给出则附加到 summary 末尾

    Returns:
        {
          "status": "ok" | "error",
          "line_added": "<追加的原始行文本>",
          "file": "<decisions.md 路径>",
          "message": "<异常说明，仅 error 状态下有>"
        }
    """
    if not summary or not summary.strip():
        return {"status": "error", "line_added": "", "message": "summary 不能为空"}
    if not scope or not scope.strip():
        return {"status": "error", "line_added": "", "message": "scope 不能为空"}

    body = summary.strip()
    if rationale.strip():
        body = f"{body}（因为 {rationale.strip()}）"

    new_line = f"| {_cell(body)} | {_cell(scope)} | — |"

    try:
        text = DECISIONS_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"status": "error", "line_added": new_line,
                "message": f"档案不存在: {DECISIONS_FILE}"}
    except Exception as exc:
        return {"status": "error", "line_added": new_line,
                "message": f"读取失败: {exc}"}

    lines = text.splitlines()
    insert_at = None

    # 首选：显式插入锚点（置于「### 全局」表末行之后）。
    for idx, line in enumerate(lines):
        if DECISIONS_INSERT_ANCHOR in line:
            insert_at = idx
            break

    # 回退：锚定「### 全局」子表末行（不再用整段最后一个表格，避免误插后续子表）。
    if insert_at is None:
        section_start = None
        for idx, line in enumerate(lines):
            if line.strip() == "### 全局":
                section_start = idx
                break
        if section_start is None:
            return {"status": "error", "line_added": new_line,
                    "message": "未找到插入锚点，且未找到「### 全局」子表"}
        section_end = len(lines)
        for idx in range(section_start + 1, len(lines)):
            if lines[idx].startswith("### ") or lines[idx].startswith("## "):
                section_end = idx
                break
        for idx in range(section_end - 1, section_start, -1):
            if lines[idx].lstrip().startswith("|"):
                insert_at = idx + 1
                break
        if insert_at is None:
            return {"status": "error", "line_added": new_line,
                    "message": "「### 全局」子表内未找到表格行"}

    lines.insert(insert_at, new_line)
    try:
        DECISIONS_FILE.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""),
                                  encoding="utf-8")
    except Exception as exc:
        return {"status": "error", "line_added": new_line,
                "message": f"写入失败: {exc}"}

    return {"status": "ok", "line_added": new_line, "file": str(DECISIONS_FILE)}


# ============================================================
# 工具 3：record_lesson —— 追加教训到 lessons-learned.md
# ============================================================

_LESSON_HEADING_RE = re.compile(r"^##\s+(\d+)\.\s+")
# 维护说明里的记账行「下一条 = #K」。它是 memory_freshness --gate 的硬不变量
# （K 必须 = 当前最高号 + 1），也是人工落笔时唯一会照抄的号码来源。
_NEXT_NUM_RE = re.compile(r"(下一条\s*=\s*#)(\d+)")


def record_lesson(summary: str, context: str = "",
                  principle: str = "", guard: str = "") -> dict:
    """档案写入 —— 追加一条教训到 memory/lessons-learned.md 末尾。

    编号策略：扫描现有 `## <N>. <title>` 条目，取最大 N + 1 作为新教训 ID。
    插入位置：文件末尾的「维护说明」引言之前（若存在），否则文件末尾。

    教训格式遵循守密人 2026-07-12 裁定的「准则清单体」：每条 = **坑**（本质一句）
    + **准则**（触发信号 → 动作）+ **防护/案卷**（指针，如有）。summary 落坑句，
    context（触发场景，可选）折进坑句，principle / guard（可选）直填准则 / 防护行；
    principle 缺省时留「（待守密人补充）」，guard 缺省时不落该行。

    Args:
        summary:   坑本质（教训标题 + 问题陈述一句）
        context:   触发场景描述，可选；给出则折进坑句
        principle: 准则（触发信号 → 动作），可选；缺省留待守密人补充
        guard:     防护措施 / 案卷指针，可选；缺省不落该行

    Returns:
        {
          "status": "ok" | "error",
          "lesson_id": "<新教训编号字符串>",
          "file": "<lessons-learned.md 路径>",
          "message": "<异常说明>"
        }
    """
    if not summary or not summary.strip():
        return {"status": "error", "lesson_id": "", "message": "summary 不能为空"}

    try:
        text = LESSONS_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"status": "error", "lesson_id": "",
                "message": f"档案不存在: {LESSONS_FILE}"}
    except Exception as exc:
        return {"status": "error", "lesson_id": "",
                "message": f"读取失败: {exc}"}

    lines = text.splitlines()

    # 计算新编号
    max_id = 0
    for line in lines:
        m = _LESSON_HEADING_RE.match(line)
        if m:
            try:
                n = int(m.group(1))
                max_id = max(max_id, n)
            except ValueError:
                continue
    new_id = max_id + 1

    # 一律折单行：带换行的 summary 会把 `## N. 标题` 劈成「标题 + 漂在外面的正文」，
    # 若其中恰含 `## 99. …` 形状的行，下次 record_lesson 的编号扫描还会跟着跳号
    # （CLAUDE.md §5.3「编号持续追加不重用」的台账就此错位）。
    title_line = f"## {new_id}. {_one_line(summary)}"

    # 守密人 2026-07-12 格式裁定：坑 / 准则 / 防护（防护行仅在给出时落）。
    trap_line = _one_line(summary)
    if context.strip():
        trap_line = f"{trap_line}（触发场景：{_one_line(context)}）"
    principle_line = _one_line(principle) or "（待守密人补充）"

    block = [
        "",
        title_line,
        "",
        f"- **坑**：{trap_line}",
        f"- **准则**：{principle_line}",
    ]
    if guard.strip():
        block.append(f"- **防护/案卷**：{_one_line(guard)}")
    block.append("")

    # 定位「维护说明」引言块（以 `> **维护说明**` 开头）
    insert_at = len(lines)
    for idx in range(len(lines) - 1, -1, -1):
        line = lines[idx]
        if line.startswith(("> **维护说明**", "> 维护说明")):
            # 向上回退到最近的非空行之后
            j = idx - 1
            while j >= 0 and lines[j].strip() == "":
                j -= 1
            # 再看是否有 `---` 分隔线
            insert_at = j if j >= 0 and lines[j].strip() == "---" else idx
            break

    # 插入块（去掉首个多余空行若紧接已是空行）
    if insert_at > 0 and lines[insert_at - 1].strip() == "":
        block = block[1:]

    for offset, new_line in enumerate(block):
        lines.insert(insert_at + offset, new_line)

    # 记账行同步：只追条目不改「下一条 = #K」，写完当场把 K 留在**刚用掉的号**上——
    # memory_freshness --gate（随 required test 每 PR 把门）立刻判编号对账漂移，
    # 而照着那行落笔的下一条会重用本号，与「编号持续追加不重用」直接相悖。
    for idx, line in enumerate(lines):
        if _NEXT_NUM_RE.search(line):
            lines[idx] = _NEXT_NUM_RE.sub(rf"\g<1>{new_id + 1}", line, count=1)
            break

    try:
        LESSONS_FILE.write_text(
            "\n".join(lines) + ("\n" if text.endswith("\n") else ""),
            encoding="utf-8",
        )
    except Exception as exc:
        return {"status": "error", "lesson_id": str(new_id),
                "message": f"写入失败: {exc}"}

    return {
        "status": "ok",
        "lesson_id": str(new_id),
        "file": str(LESSONS_FILE),
        "line_added": title_line,
    }


# ============================================================
# 本模块自检（便于手工运行验证）
# ============================================================

def _self_check() -> None:
    """手工运行时打印各工具的探测结果。"""
    now = datetime.now(UTC).isoformat()
    print(f"[silver_memory_tools] self-check @ {now}")
    print(f"  REPO_ROOT     = {REPO_ROOT}")
    print(f"  DIGESTS_DIR   = {DIGESTS_DIR} (exists={DIGESTS_DIR.exists()})")
    print(f"  CONTINUITY    = {CONTINUITY_FILE} (exists={CONTINUITY_FILE.exists()})")
    print(f"  DECISIONS     = {DECISIONS_FILE} (exists={DECISIONS_FILE.exists()})")
    print(f"  LESSONS       = {LESSONS_FILE} (exists={LESSONS_FILE.exists()})")

    cont = current_continuity()
    print(f"  continuity.last_session.id = "
          f"{(cont.get('last_session') or {}).get('id', '(none)')}")
    print(f"  continuity.topics_hint     = {cont.get('topics_hint', '')}")


if __name__ == "__main__":
    _self_check()
