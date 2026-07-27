"""Shared parser for runtime-extracted Lua table dumps.

Matches `[<id>] = { <fields> }` blocks and the quoted `Key = "value",`
fields inside each block, unescaping \\" and \\n. Each caller applies its
own required-field filter and entry-building on top of the raw (id, fields)
pairs returned here.
"""
import re

_HEADER = re.compile(r'\[(\d+)\]\s*=\s*\{')
_FIELD = re.compile(r'(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*,')


def _scan_block_body(content: str, start: int) -> tuple[str, int]:
    """Return (body, end) for the brace block opening at `start` (the `{`).

    Scans for the matching `}` while skipping braces inside quoted string
    values, so a `}` in a field value (story text / emoji) no longer
    truncates the block. `end` is the index just past the closing `}`.
    """
    depth = 0
    in_str = False
    i = start
    n = len(content)
    while i < n:
        c = content[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return content[start + 1:i], i + 1
        i += 1
    return content[start + 1:], n


def parse_lua_blocks(content: str) -> list[tuple[int, dict[str, str]]]:
    results = []
    pos = 0
    for m in _HEADER.finditer(content):
        if m.start() < pos:
            continue  # header sat inside a previous block's body
        entry_id = int(m.group(1))
        body, pos = _scan_block_body(content, m.end() - 1)
        fields = {}
        for fm in _FIELD.finditer(body):
            fields[fm.group(1)] = fm.group(2).replace('\\"', '"').replace('\\n', '\n')
        results.append((entry_id, fields))
    return results
