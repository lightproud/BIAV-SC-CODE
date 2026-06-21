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
from datetime import datetime, timezone
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
        except Exception:
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

    new_line = f"| {body} | {scope.strip()} | — |"

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


def record_lesson(summary: str, context: str = "") -> dict:
    """档案写入 —— 追加一条教训到 memory/lessons-learned.md 末尾。

    编号策略：扫描现有 `## <N>. <title>` 条目，取最大 N + 1 作为新教训 ID。
    插入位置：文件末尾的「维护说明」引言之前（若存在），否则文件末尾。

    教训格式遵循现有约定：Context / Problem / Fix / Impact 四段。本函数仅填
    Context 与 Problem（由 summary / context 提供），Fix 与 Impact 由守密人
    日后手动补全。

    Args:
        summary: 教训标题 + 问题陈述
        context: 触发场景描述，可选

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
                if n > max_id:
                    max_id = n
            except ValueError:
                continue
    new_id = max_id + 1

    title_line = f"## {new_id}. {summary.strip()}"
    context_block = context.strip() if context.strip() else "（待守密人补充）"

    block = [
        "",
        title_line,
        "",
        f"- **Context**：{context_block}",
        f"- **Problem**：{summary.strip()}",
        "- **Fix**：（待补充）",
        "- **Impact**：（待补充）",
        "",
    ]

    # 定位「维护说明」引言块（以 `> **维护说明**` 开头）
    insert_at = len(lines)
    for idx in range(len(lines) - 1, -1, -1):
        line = lines[idx]
        if line.startswith("> **维护说明**") or line.startswith("> 维护说明"):
            # 向上回退到最近的非空行之后
            j = idx - 1
            while j >= 0 and lines[j].strip() == "":
                j -= 1
            # 再看是否有 `---` 分隔线
            if j >= 0 and lines[j].strip() == "---":
                insert_at = j
            else:
                insert_at = idx
            break

    # 插入块（去掉首个多余空行若紧接已是空行）
    if insert_at > 0 and lines[insert_at - 1].strip() == "":
        block = block[1:]

    for offset, new_line in enumerate(block):
        lines.insert(insert_at + offset, new_line)

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
    now = datetime.now(timezone.utc).isoformat()
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
