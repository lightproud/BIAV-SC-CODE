#!/usr/bin/env python3
"""session_watch.py —— PostToolUse hook：实时追加会话工具调用事件到 progress.jsonl。

本档案为 Claude Code 的 PostToolUse hook 目标脚本，每次工具调用
（Read / Edit / Write / Bash / Grep ...）结束后由宿主进程以 stdin 喂入
hook JSON，再由本脚本解析并追加一行 JSONL 到：

    memory/session-digests/{session_id}.progress.jsonl

艾瑞卡稍后会在 .claude/settings.json 注册：

    {
      "hooks": {
        "PostToolUse": [
          {"command": "python3 scripts/session_watch.py"}
        ]
      }
    }

权限：艾瑞卡稍后 `chmod +x scripts/session_watch.py`。

失败策略：任何异常均静默（stderr 单行报错），决不抛错阻塞 hook 链路。
"""

from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
DIGESTS_DIR = REPO_ROOT / "memory" / "session-digests"

MAX_SNIPPET = 500  # 单条 input/output 截断到 500 字符
MAX_SUMMARY = 200  # summary 上限 200 字


def _safe_str(value: Any, limit: int) -> str:
    """把任意值安全转成字符串并截断。"""
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            text = json.dumps(value, ensure_ascii=False)
        except Exception:
            text = str(value)
    else:
        text = str(value)
    text = text.replace("\r", " ").replace("\n", " ")
    if len(text) > limit:
        text = text[:limit] + "..."
    return text


def _build_summary(tool: str, tool_input: dict) -> str:
    """为常见工具合成一行 <200 字摘要。"""
    try:
        if tool == "Bash":
            desc = tool_input.get("description") or ""
            cmd = tool_input.get("command") or ""
            head = desc or cmd[:80]
            return _safe_str(f"{tool}: {head}", MAX_SUMMARY)
        if tool in ("Read", "Edit", "Write"):
            fp = tool_input.get("file_path") or "?"
            return _safe_str(f"{tool}: {fp}", MAX_SUMMARY)
        if tool in ("Grep", "Glob"):
            pat = tool_input.get("pattern") or ""
            return _safe_str(f"{tool}: pattern={pat}", MAX_SUMMARY)
        if tool == "TodoWrite":
            todos = tool_input.get("todos") or []
            return _safe_str(f"{tool}: {len(todos)} items", MAX_SUMMARY)
        # Generic fallback
        keys = list(tool_input.keys())[:4] if isinstance(tool_input, dict) else []
        return _safe_str(f"{tool}: ({', '.join(keys)})", MAX_SUMMARY)
    except Exception:
        return _safe_str(tool, MAX_SUMMARY)


def main() -> int:
    # 1. 读取 stdin hook JSON
    try:
        raw = sys.stdin.read()
    except Exception as exc:
        print(f"[session_watch] stdin 读取失败: {exc}", file=sys.stderr)
        return 0

    if not raw or not raw.strip():
        # 空输入：hook 以无数据触发，直接静默返回
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"[session_watch] JSON 解析失败: {exc}", file=sys.stderr)
        return 0

    if not isinstance(payload, dict):
        print("[session_watch] hook payload 非 dict，跳过", file=sys.stderr)
        return 0

    session_id = payload.get("session_id") or "unknown"
    tool_name = payload.get("tool_name") or payload.get("tool") or "Unknown"
    tool_input = payload.get("tool_input") or payload.get("input") or {}
    tool_output = payload.get("tool_output")
    if tool_output is None:
        # Claude Code 另一种字段命名：tool_response
        tool_output = payload.get("tool_response")

    if not isinstance(tool_input, dict):
        tool_input = {"raw": tool_input}

    # 2. 构造事件
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "tool": str(tool_name),
        "summary": _build_summary(str(tool_name), tool_input),
        "input_snippet": _safe_str(tool_input, MAX_SNIPPET),
        "output_snippet": _safe_str(tool_output, MAX_SNIPPET),
    }

    # 3. 写入 progress.jsonl（静默失败）
    try:
        DIGESTS_DIR.mkdir(parents=True, exist_ok=True)
        target = DIGESTS_DIR / f"{session_id}.progress.jsonl"
        with target.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"[session_watch] 写入 progress.jsonl 失败: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
