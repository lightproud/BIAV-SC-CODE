"""银芯 MCP graphify 桥接模块 —— 面向黑池索引（需求 3）

艾瑞卡的说明（自动人偶 / 弥萨格大学数据库终端）：

本档案将上游 graphify（MIT，vendored 于 ``projects/graphify-ext/``）封装为
纯 Python 函数层，供银芯 MCP 服务器 ``scripts/mcp_server.py`` 注册调用。
本模块不携带 MCP 装饰器，由艾瑞卡稍后在主控台完成编排整合。

三项对外导出：

* ``graphify_index``  —— 对指定目录构建知识图谱（生成 ``graphify-out/``）。
* ``graphify_query``  —— 读取档案内已构建的图谱，执行关键词检索。
* ``graphify_report`` —— 读取 ``GRAPH_REPORT.md``，解析 God Nodes 与
  Suggested Questions 段落并返回结构化数据。

执行策略（双通道）：

1. 首选 Python API 通道：动态追加 ``projects/graphify-ext`` 至 ``sys.path``，
   直接调用 ``graphify.watch._rebuild_code`` 等内部函数完成无 LLM 构建。
2. 回退 subprocess 通道：以 ``python -m graphify update <path>`` 形式启动
   子进程，隔离 import 污染。两种通道任一成功即视为数据归档成功。

所有异常统一捕获并归一化为 ``{"status": "error", "error": "..."}``，
绝不向调用方抛出未处理错误——艾瑞卡遵守"终端永不崩溃"守则。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Path bootstrap: locate vendored graphify-ext and make it importable.
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent
_GRAPHIFY_EXT = _REPO_ROOT / "projects" / "graphify-ext"


def _ensure_graphify_on_path() -> bool:
    """Prepend graphify-ext to sys.path if not already present. Idempotent."""
    if not _GRAPHIFY_EXT.exists():
        return False
    p = str(_GRAPHIFY_EXT)
    if p not in sys.path:
        sys.path.insert(0, p)
    return True


# Default subprocess timeouts (seconds)
_TIMEOUT_INDEX = 300
_TIMEOUT_QUERY = 30
_TIMEOUT_REPORT = 30


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def graphify_index(path: str, output_dir: str | None = None) -> dict:
    """Build a knowledge graph for ``path`` using graphify.

    Produces ``<path>/graphify-out/{graph.json, GRAPH_REPORT.md, graph.html?}``.
    If ``output_dir`` is supplied, the canonical graphify-out is relocated to
    that directory via a post-build copy (graphify itself hard-codes
    ``graphify-out`` under the target path).

    Args:
        path: Target source tree to index (absolute or relative).
        output_dir: Optional destination for graph artefacts. When omitted,
            artefacts stay in ``<path>/graphify-out/``.

    Returns:
        Dict with keys ``status`` (``"ok"`` or ``"error"``), ``graph_json``,
        ``report_md``, ``html`` (may be empty if graph too large), ``stdout``,
        ``stderr``. On error: ``status="error"`` and ``error`` key populated.
    """
    stdout_buf = ""
    stderr_buf = ""
    try:
        target = Path(path).resolve()
        if not target.exists():
            return {"status": "error", "error": f"path not found: {target}"}
        if not target.is_dir():
            return {"status": "error", "error": f"path is not a directory: {target}"}

        out_dir = target / "graphify-out"

        # Channel 1: native Python API (preferred — avoids subprocess cost).
        api_ok = False
        if _ensure_graphify_on_path():
            try:
                # Local imports so subprocess fallback still works if deps missing.
                from graphify.watch import _rebuild_code  # type: ignore
                from graphify.export import to_html, to_json  # type: ignore
                from graphify.build import build_from_json  # type: ignore
                from graphify.cluster import cluster  # type: ignore

                # _rebuild_code prints progress; capture into stdout buffer.
                import io
                import contextlib
                sink = io.StringIO()
                with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                    api_ok = bool(_rebuild_code(target))
                stdout_buf = sink.getvalue()

                # Attempt HTML export post-build (optional, may fail for large graphs).
                if api_ok:
                    graph_json_path = out_dir / "graph.json"
                    if graph_json_path.exists():
                        try:
                            raw = json.loads(graph_json_path.read_text(encoding="utf-8"))
                            G = build_from_json(raw)
                            communities = cluster(G)
                            to_html(G, communities, str(out_dir / "graph.html"))
                        except Exception as html_exc:  # noqa: BLE001
                            stderr_buf += f"[html export skipped] {html_exc}\n"
            except Exception as api_exc:  # noqa: BLE001
                stderr_buf += f"[python api] {api_exc}\n"
                api_ok = False

        # Channel 2: subprocess fallback.
        if not api_ok:
            cmd = [sys.executable, "-m", "graphify", "update", str(target)]
            env = os.environ.copy()
            env["PYTHONPATH"] = str(_GRAPHIFY_EXT) + os.pathsep + env.get("PYTHONPATH", "")
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=_TIMEOUT_INDEX,
                env=env,
                cwd=str(_REPO_ROOT),
            )
            stdout_buf += proc.stdout or ""
            stderr_buf += proc.stderr or ""
            if proc.returncode != 0:
                return {
                    "status": "error",
                    "error": f"graphify update exit={proc.returncode}",
                    "stdout": stdout_buf,
                    "stderr": stderr_buf,
                }

        # Guard: subprocess may report exit=0 but skip rebuild silently
        # (e.g. missing optional dep like networkx / tree-sitter), leaving
        # out_dir non-existent. Surface a clear error instead of crashing
        # on iterdir() below.
        if not out_dir.exists():
            return {
                "status": "error",
                "error": (
                    f"graphify produced no output directory at {out_dir}. "
                    "This usually means graphify's rebuild step failed "
                    "silently (e.g. missing Python dependency). Inspect "
                    "stdout/stderr below and ensure "
                    "`pip install -e projects/graphify-ext/` has run."
                ),
                "stdout": stdout_buf,
                "stderr": stderr_buf,
            }

        # Optional relocate to caller-supplied output_dir.
        final_out = out_dir
        if output_dir:
            import shutil
            dst = Path(output_dir).resolve()
            dst.mkdir(parents=True, exist_ok=True)
            for item in out_dir.iterdir():
                target_item = dst / item.name
                if target_item.exists():
                    if target_item.is_dir():
                        shutil.rmtree(target_item)
                    else:
                        target_item.unlink()
                shutil.move(str(item), str(target_item))
            final_out = dst

        graph_json = final_out / "graph.json"
        report_md = final_out / "GRAPH_REPORT.md"
        html = final_out / "graph.html"

        if not graph_json.exists():
            return {
                "status": "error",
                "error": f"graph.json missing after build: {graph_json}",
                "stdout": stdout_buf,
                "stderr": stderr_buf,
            }

        return {
            "status": "ok",
            "graph_json": str(graph_json),
            "report_md": str(report_md) if report_md.exists() else "",
            "html": str(html) if html.exists() else "",
            "stdout": stdout_buf,
            "stderr": stderr_buf,
        }

    except subprocess.TimeoutExpired as exc:
        return {
            "status": "error",
            "error": f"index timeout after {_TIMEOUT_INDEX}s",
            "stdout": stdout_buf,
            "stderr": str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "stdout": stdout_buf,
            "stderr": stderr_buf,
        }


def graphify_query(graph_json_path: str, query: str, limit: int = 10) -> dict:
    """Query an existing graph.json for nodes matching ``query`` keywords.

    Uses graphify's own ``_score_nodes`` helper (diacritic-insensitive label +
    source_file substring match). Falls back to a naive substring scan if the
    helper cannot be imported.

    Args:
        graph_json_path: Absolute path to ``graph.json``.
        query: Free-form search string; split on whitespace into terms.
        limit: Max matches to return (default 10).

    Returns:
        Dict with keys ``status`` and ``matches`` (list of
        ``{node, kind, score, context}``). On error: ``status="error"``.
    """
    try:
        gj = Path(graph_json_path)
        if not gj.exists():
            return {"status": "error", "error": f"graph.json not found: {gj}", "matches": []}

        raw = json.loads(gj.read_text(encoding="utf-8"))
        nodes = raw.get("nodes", [])
        terms = [t.lower() for t in query.split() if t.strip()]
        if not terms:
            return {"status": "ok", "matches": []}

        # Try the native scorer first for fidelity with graphify's own query CLI.
        scored: list[tuple[float, dict]] = []
        native_used = False
        if _ensure_graphify_on_path():
            try:
                from graphify.serve import _strip_diacritics  # type: ignore
                norm_terms = [_strip_diacritics(t).lower() for t in terms]
                for node in nodes:
                    label = node.get("label") or node.get("id") or ""
                    norm_label = _strip_diacritics(str(label)).lower()
                    source = str(node.get("source_file") or "").lower()
                    score = sum(1 for t in norm_terms if t in norm_label) \
                        + sum(0.5 for t in norm_terms if t in source)
                    if score > 0:
                        scored.append((score, node))
                native_used = True
            except Exception:
                native_used = False

        if not native_used:
            # Naive fallback: simple substring match.
            for node in nodes:
                label = str(node.get("label") or node.get("id") or "").lower()
                source = str(node.get("source_file") or "").lower()
                score = sum(1 for t in terms if t in label) \
                    + sum(0.5 for t in terms if t in source)
                if score > 0:
                    scored.append((score, node))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        top = scored[: max(0, int(limit))]

        matches = []
        for score, node in top:
            matches.append({
                "node": node.get("label") or node.get("id") or "",
                "kind": node.get("kind") or node.get("node_type") or node.get("file_type") or "",
                "score": float(score),
                "context": (
                    f"{node.get('source_file', '')}"
                    f"{':' + str(node.get('source_location')) if node.get('source_location') else ''}"
                ).strip(),
            })

        return {"status": "ok", "matches": matches}

    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "matches": [],
        }


def graphify_report(graph_out_dir: str) -> dict:
    """Read GRAPH_REPORT.md and extract God Nodes + Suggested Questions.

    Args:
        graph_out_dir: Directory containing ``GRAPH_REPORT.md`` (typically
            ``<project>/graphify-out/``).

    Returns:
        Dict with keys ``status``, ``report`` (full markdown string),
        ``god_nodes`` (list of strings), ``suggested_questions`` (list of
        strings). On error: ``status="error"``.
    """
    try:
        out_dir = Path(graph_out_dir)
        report_path = out_dir / "GRAPH_REPORT.md"
        if not report_path.exists():
            return {
                "status": "error",
                "error": f"GRAPH_REPORT.md not found: {report_path}",
                "report": "",
                "god_nodes": [],
                "suggested_questions": [],
            }

        text = report_path.read_text(encoding="utf-8")

        god_nodes = _extract_section_items(text, r"^##\s+God Nodes[^\n]*$")
        questions = _extract_section_items(text, r"^##\s+Suggested Questions[^\n]*$")

        return {
            "status": "ok",
            "report": text,
            "god_nodes": god_nodes,
            "suggested_questions": questions,
        }

    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
            "report": "",
            "god_nodes": [],
            "suggested_questions": [],
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_section_items(markdown: str, header_regex: str) -> list[str]:
    """Return list items from the markdown section whose header matches regex.

    Section ends at the next ``## `` header or end of document.
    Recognises leading ``- ``, ``* ``, or ``1. ``/``2. `` style bullets.
    """
    lines = markdown.splitlines()
    header_re = re.compile(header_regex, re.MULTILINE)

    start_idx = None
    for i, line in enumerate(lines):
        if header_re.match(line):
            start_idx = i + 1
            break
    if start_idx is None:
        return []

    end_idx = len(lines)
    for j in range(start_idx, len(lines)):
        if lines[j].startswith("## ") and not lines[j].startswith("### "):
            end_idx = j
            break

    items: list[str] = []
    bullet_re = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$")
    for line in lines[start_idx:end_idx]:
        m = bullet_re.match(line)
        if m:
            items.append(m.group(1))
    return items


# ---------------------------------------------------------------------------
# CLI entry (manual smoke test harness)
# ---------------------------------------------------------------------------


def _cli(argv: list[str]) -> int:
    usage = (
        "Usage:\n"
        "  python scripts/graphify_bridge.py index <path> [--out <dir>]\n"
        "  python scripts/graphify_bridge.py query <graph.json> <query> [--limit N]\n"
        "  python scripts/graphify_bridge.py report <graph_out_dir>\n"
        "  python scripts/graphify_bridge.py --help\n"
    )
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(usage)
        return 0

    cmd = argv[0]
    try:
        if cmd == "index":
            if len(argv) < 2:
                print(usage, file=sys.stderr)
                return 2
            path = argv[1]
            out = None
            if "--out" in argv:
                i = argv.index("--out")
                if i + 1 < len(argv):
                    out = argv[i + 1]
            result = graphify_index(path, output_dir=out)
        elif cmd == "query":
            if len(argv) < 3:
                print(usage, file=sys.stderr)
                return 2
            graph_json = argv[1]
            q = argv[2]
            limit = 10
            if "--limit" in argv:
                i = argv.index("--limit")
                if i + 1 < len(argv):
                    limit = int(argv[i + 1])
            result = graphify_query(graph_json, q, limit=limit)
        elif cmd == "report":
            if len(argv) < 2:
                print(usage, file=sys.stderr)
                return 2
            result = graphify_report(argv[1])
        else:
            print(f"unknown command: {cmd}\n{usage}", file=sys.stderr)
            return 2

        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("status") == "ok" else 1

    except Exception as exc:  # noqa: BLE001
        print(json.dumps({
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
        }, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
