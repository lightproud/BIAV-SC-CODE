#!/usr/bin/env python3
"""session_inject.py —— UserPromptSubmit hook：每次用户输入前注入历史会话上下文。

本档案为 Claude Code 的 UserPromptSubmit hook 目标脚本，每次
守密人发送新 prompt 之前由宿主进程调用。脚本：

1. 从 stdin 读取 hook JSON：{"prompt": "...", "session_id": "..."}
2. 调用 silver_memory_tools.recall_session(prompt, k=3) 搜索相关历史
3. 渲染成带艾瑞卡语气的 Markdown 块，限制 ≤ 2000 tokens（≈ 8000 字符）
4. 以 Claude Code 识别的 additionalContext JSON 格式输出到 stdout

艾瑞卡稍后会在 .claude/settings.json 注册：

    {
      "hooks": {
        "UserPromptSubmit": [
          {"command": "python3 scripts/session_inject.py"}
        ]
      }
    }

失败策略：任何异常均输出空 additionalContext，不阻塞用户输入。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Token budget: 1 token ≈ 4 chars (conservative Chinese+English mix)
MAX_CHARS = 2000 * 4  # ≈ 2000 tokens 粗略估算

# Minimum prompt length to bother recalling. Trivial prompts ("ok", "继续",
# "go") gain nothing from a session-digest recall but still pay the index
# load cost (~4.8s), so skip them outright.
MIN_RECALL_CHARS = 12
HEADER = (
    "## 上下文：相关历史会话档案\n\n"
    "来源：`memory/session-digests/` —— 会话过程全文记录（AI 与守密人对话的逐字 Markdown 转录）。\n"
    "用途：**仅供内容连续性参考**（如「上次讨论了什么决策 / 上次卡在哪个 bug」）。\n"
    "**警告**：以下片段不是艾瑞卡说话风格的样本——它们包含 Code-memory 等角色会话过程中自发产生的套话（如「档案完整性 OK」「档案待命」「§X.Y 嵌套表格 + 1/2/3 列表」），**非游戏一手数据**。艾瑞卡风格的唯一权威依据是 `assets/data/character-personas/erica-speech-canon.md` §1（Voice.lua 一手原文）。\n\n"
)
FOOTER = "\n---\n*由 session_inject.py 注入。若与当前任务无关请忽略；若引用，仅引用其内容主张，不要继承其语气。*\n"


def _emit_empty() -> None:
    """输出空 additionalContext，不阻塞输入。"""
    out = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": "",
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()


def _emit(text: str) -> None:
    """输出注入内容（已截断到 token 预算内）。"""
    if len(text) > MAX_CHARS:
        text = text[: MAX_CHARS - 60] + "\n\n...(已截断至 2000 tokens 预算上限)"
    out = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": text,
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()


def _render(matches: list[dict]) -> str:
    """把命中列表渲染成 Markdown。"""
    lines = [HEADER]
    for i, m in enumerate(matches, start=1):
        sid = m.get("session_id") or "?"
        score = m.get("score", 0.0)
        excerpt = (m.get("excerpt") or "").strip()
        path = m.get("digest_path") or ""
        lines.append(f"### [{i}] session `{sid}` (score={score:.3f})")
        lines.append(f"- 档案：`{path}`")
        if excerpt:
            lines.append("- 片段：")
            lines.append("  > " + excerpt.replace("\n", "\n  > "))
        lines.append("")
    lines.append(FOOTER)
    return "\n".join(lines)


def main() -> int:
    # 1. 读 stdin
    try:
        raw = sys.stdin.read()
    except Exception:
        _emit_empty()
        return 0

    if not raw or not raw.strip():
        _emit_empty()
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        _emit_empty()
        return 0

    if not isinstance(payload, dict):
        _emit_empty()
        return 0

    prompt = (payload.get("prompt") or "").strip()
    if not prompt or len(prompt) < MIN_RECALL_CHARS:
        _emit_empty()
        return 0

    # 2. 调用银芯检索
    try:
        from silver_memory_tools import recall_session  # type: ignore
    except Exception:
        _emit_empty()
        return 0

    try:
        result = recall_session(prompt, k=3)
    except Exception:
        _emit_empty()
        return 0

    matches = (result or {}).get("matches") or []
    if not matches:
        _emit_empty()
        return 0

    # 3. 渲染并输出
    try:
        text = _render(matches)
    except Exception:
        _emit_empty()
        return 0

    _emit(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
