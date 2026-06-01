"""Shared parser for runtime-extracted Lua table dumps.

Matches `[<id>] = { <fields> }` blocks and the quoted `Key = "value",`
fields inside each block, unescaping \\" and \\n. Each caller applies its
own required-field filter and entry-building on top of the raw (id, fields)
pairs returned here.
"""
import re

_BLOCK = re.compile(r'\[(\d+)\]\s*=\s*\{(.*?)\}', re.DOTALL)
_FIELD = re.compile(r'(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*,')


def parse_lua_blocks(content: str) -> list[tuple[int, dict[str, str]]]:
    results = []
    for m in _BLOCK.finditer(content):
        entry_id = int(m.group(1))
        fields = {}
        for fm in _FIELD.finditer(m.group(2)):
            fields[fm.group(1)] = fm.group(2).replace('\\"', '"').replace('\\n', '\n')
        results.append((entry_id, fields))
    return results
