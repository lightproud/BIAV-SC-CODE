"""silver_memory_tools.py —— 银芯记忆增强工具集

银芯记忆增强工具集 —— 面向黑池记忆（需求 4）的银芯自建实现。对标 claude-mem 能力但保持 MIT。

本模块为纯 Python 函数库，不携带 MCP 装饰器。艾瑞卡主控台稍后会将其中函数
注册到 scripts/mcp_server.py，供 Claude Code / claw 调用。

导出函数（5 个）：
    recall_session(query, k)        —— 语义搜索 memory/session-digests/ 内相关 session
    current_continuity()            —— 读取 memory/session-continuity.json 连续性链
    record_decision(summary, scope) —— 追加一行到 memory/decisions.md 当前有效决策表格
    record_lesson(summary, context) —— 追加一条到 memory/lessons-learned.md 末尾
    session_progress(session_id)    —— 读取 session 的 progress.jsonl 增量事件流

依赖：仅 Python 标准库 + 同目录下的 memory_search.py（间接调用，不修改）。
"""

from __future__ import annotations

import json
import re
import sys
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

# 保证 memory_search 可导入（不修改其源码）
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


# ============================================================
# 工具 1：recall_session —— session 语义搜索
# ============================================================

def recall_session(query: str, k: int = 5) -> dict:
    """档案回溯 —— 在 memory/session-digests/ 内语义搜索相关 session。

    艾瑞卡调用 scripts/memory_search.py 的 search() 接口对全量知识库检索，
    再过滤出 digest 命中项（文件路径含 'session-digests/' 且以 .md 结尾）。

    Args:
        query: 自然语言查询（支持中英文）
        k:     返回的 session 命中数上限，默认 5

    Returns:
        {
          "matches": [
            {
              "session_id": "<短 ID，从文件名后 8 位解析>",
              "digest_path": "<绝对路径或 repo 相对路径>",
              "score": <float, 重排序后的最终分>,
              "excerpt": "<digest 预览片段 ≤ 400 字>"
            },
            ...
          ],
          "query": "<原查询>",
          "total": <int>
        }
    """
    result: dict[str, Any] = {"query": query, "matches": [], "total": 0}
    if not query or not query.strip():
        return result

    try:
        from memory_search import search  # 延迟导入，避免模块级失败
    except Exception as exc:
        result["error"] = f"memory_search 导入失败: {exc}"
        return result

    # 多取一些候选再过滤，防止 digest 命中不足 k 条
    try:
        raw = search(query, top_k=max(k * 4, 20))
    except Exception as exc:
        result["error"] = f"search() 调用异常: {exc}"
        return result

    matches: list[dict[str, Any]] = []
    for item in raw or []:
        fp = item.get("file", "")
        if not fp:
            continue
        # 只保留 session-digests 下的 Markdown digest
        if "session-digests" not in fp.replace("\\", "/"):
            continue
        if not fp.endswith(".md"):
            continue

        sid = _parse_session_id_from_digest(Path(fp).name)
        score = float(item.get("final_score", item.get("score", 0.0)) or 0.0)
        excerpt = (item.get("preview") or "")[:400]

        matches.append({
            "session_id": sid,
            "digest_path": fp,
            "score": round(score, 4),
            "excerpt": excerpt,
        })
        if len(matches) >= k:
            break

    result["matches"] = matches
    result["total"] = len(matches)
    return result


def _parse_session_id_from_digest(filename: str) -> str:
    """从 digest 文件名 `YYYYMMDD-HHMMSS-<sid8>.md` 解析短 session ID。"""
    stem = filename[:-3] if filename.endswith(".md") else filename
    parts = stem.split("-")
    if len(parts) >= 3:
        return parts[-1]
    return stem


# ============================================================
# 工具 2：current_continuity —— 会话连续性链
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
# 工具 3：record_decision —— 追加决策到 decisions.md
# ============================================================

def record_decision(summary: str, scope: str, rationale: str = "") -> dict:
    """档案写入 —— 追加一行到 memory/decisions.md 的「当前有效决策」末尾。

    定位策略：找到 `## 当前有效决策` 与下一个 `## ` 标题之间的最后一个表格行，
    在该表格的最后一行后面插入新行。表格格式：`| 决策 | 影响范围 |`。

    若 rationale 非空，则以「因为 …」拼接到 summary 末尾形成决策正文。

    Args:
        summary:   决策正文（简短陈述）
        scope:     影响范围（如 "全局"、"bpt-next"、"黑池建设"）
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

    new_line = f"| {body} | {scope.strip()} |"

    try:
        text = DECISIONS_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"status": "error", "line_added": new_line,
                "message": f"档案不存在: {DECISIONS_FILE}"}
    except Exception as exc:
        return {"status": "error", "line_added": new_line,
                "message": f"读取失败: {exc}"}

    lines = text.splitlines()
    section_start = None
    section_end = None

    for idx, line in enumerate(lines):
        if line.strip() == "## 当前有效决策":
            section_start = idx
            continue
        if section_start is not None and line.startswith("## "):
            section_end = idx
            break

    if section_start is None:
        return {"status": "error", "line_added": new_line,
                "message": "未找到「## 当前有效决策」段落"}
    if section_end is None:
        section_end = len(lines)

    # 从 section 末尾向前找最后一个表格行（以 '|' 开头）
    insert_at = None
    for idx in range(section_end - 1, section_start, -1):
        if lines[idx].lstrip().startswith("|"):
            insert_at = idx + 1
            break

    if insert_at is None:
        return {"status": "error", "line_added": new_line,
                "message": "「当前有效决策」段落内未找到表格"}

    lines.insert(insert_at, new_line)
    try:
        DECISIONS_FILE.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""),
                                  encoding="utf-8")
    except Exception as exc:
        return {"status": "error", "line_added": new_line,
                "message": f"写入失败: {exc}"}

    return {"status": "ok", "line_added": new_line, "file": str(DECISIONS_FILE)}


# ============================================================
# 工具 4：record_lesson —— 追加教训到 lessons-learned.md
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
# 工具 5：session_progress —— 读取 progress.jsonl
# ============================================================

def session_progress(session_id: str) -> dict:
    """档案追溯 —— 读取 memory/session-digests/{sid}.progress.jsonl 事件流。

    progress.jsonl 由 scripts/session_watch.py PostToolUse hook 每次工具调用后
    追加一行。本函数全量读取并按时间序返回。

    Args:
        session_id: 会话 ID（短或全 ID 均可，按文件名前缀匹配）

    Returns:
        {
          "session_id": "<传入值>",
          "file": "<定位到的 progress 文件绝对路径，未找到则空>",
          "events": [ {ts, tool, summary, input_snippet, output_snippet}, ... ],
          "total": <int>,
          "exists": <bool>
        }
    """
    result: dict[str, Any] = {
        "session_id": session_id,
        "file": "",
        "events": [],
        "total": 0,
        "exists": False,
    }
    if not session_id:
        result["error"] = "session_id 不能为空"
        return result

    if not DIGESTS_DIR.exists():
        result["error"] = f"目录不存在: {DIGESTS_DIR}"
        return result

    # 优先精确匹配 {sid}.progress.jsonl，否则按前缀扫描
    exact = DIGESTS_DIR / f"{session_id}.progress.jsonl"
    target: Path | None = None
    if exact.exists():
        target = exact
    else:
        try:
            candidates = sorted(DIGESTS_DIR.glob(f"*{session_id}*.progress.jsonl"))
            if candidates:
                target = candidates[-1]
        except Exception:
            target = None

    if target is None or not target.exists():
        return result

    result["file"] = str(target)
    result["exists"] = True

    events: list[dict[str, Any]] = []
    try:
        with target.open("r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    events.append(json.loads(raw))
                except json.JSONDecodeError:
                    continue
    except Exception as exc:
        result["error"] = f"读取 progress 文件失败: {exc}"
        return result

    result["events"] = events
    result["total"] = len(events)
    return result


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
