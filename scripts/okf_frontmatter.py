"""okf_frontmatter.py — OKF frontmatter 读写单一真相源（import-only 库）。

OKF concept = 一份带 YAML frontmatter 的 markdown。「怎么把 fields 写成 frontmatter」
与「怎么把 frontmatter 读回 fields」这两件事，原先在三个生成器里各抄了一份：

- `build_okf_bundle.py`：`_yaml_scalar` / `frontmatter` / `write_concept` / `write_plain` / `_read_frontmatter`
- `okf_pointer_layers.py`：同上前四个（原注释写「刻意自持，避免循环 import」——
  真正的解法是把公共部分下沉到本模块，而不是让被 import 的一方再抄一遍）
- `build_kb_index.py`：`_read_frontmatter`（注释自陈「same shape as build_okf_bundle」）

三份抄写意味着 frontmatter 的转义规则一改就要人工同步三处；漏一处即写方与读方
对不上，而 bundle 是生成物、对不上不会立刻报错，只会静默产出坏 YAML。故收敛到此处。

本模块为纯函数、零依赖、确定性，供 bundle 生成器与索引构建器共同 import。
"""
from __future__ import annotations

import re
from pathlib import Path

# 一段 markdown 开头的 frontmatter 块（`---` 包裹，DOTALL 跨行）。
_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)

# OKF spec 的字段优先顺序；其余字段按原序追加在后。
_FIELD_ORDER = ["type", "title", "description", "resource", "tags", "timestamp"]


def _yaml_scalar(value: str) -> str:
    """Quote a scalar so it round-trips through any YAML parser."""
    s = str(value).replace("\r", " ").replace("\n", " ").strip()
    # Always double-quote; escape backslash and quote.
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def frontmatter(fields: dict) -> str:
    """Emit a YAML frontmatter block. ``type`` is required by OKF."""
    assert fields.get("type"), "OKF concept frontmatter MUST carry a non-empty 'type'"
    lines = ["---"]
    for key in _FIELD_ORDER + [k for k in fields if k not in _FIELD_ORDER]:
        if key not in fields:
            continue
        val = fields[key]
        if val is None or val == "" or val == []:
            continue
        if isinstance(val, list):
            inner = ", ".join(_yaml_scalar(v) for v in val)
            lines.append(f"{key}: [{inner}]")
        else:
            lines.append(f"{key}: {_yaml_scalar(val)}")
    lines.append("---")
    return "\n".join(lines)


def write_concept(path: Path, fields: dict, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter(fields) + "\n\n" + body.rstrip() + "\n", encoding="utf-8")


def write_plain(path: Path, body: str) -> None:
    """Reserved files (index.md / log.md) carry NO frontmatter."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.rstrip() + "\n", encoding="utf-8")


def _read_frontmatter(text: str) -> dict:
    """Minimal flat-YAML frontmatter parser (the inverse of ``frontmatter``).

    非 frontmatter 开头的正文返回空 dict（读方按「无元信息」处理，不抛）。
    """
    m = _FM_RE.match(text)
    fields: dict = {}
    if not m:
        return fields
    for line in m.group(1).splitlines():
        if not line.strip() or line.startswith(" ") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            fields[key] = [v.strip().strip('"') for v in val[1:-1].split(",") if v.strip()]
        else:
            fields[key] = val.strip('"')
    return fields
