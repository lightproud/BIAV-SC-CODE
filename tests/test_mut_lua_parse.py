"""Mutation-testing twin for lua_parse (see setup.cfg [mutmut]).

Package-path imports (`scripts.lua_parse`) so mutmut's runtime trampoline keys
match the keys it derives from the file path. lua_parse is a self-contained
pure module (only `import re`) with dense logic — a brace-depth scanner, a
string-state machine, regex field extraction, and \\" / \\n unescaping — which
is exactly where mutation testing earns its keep: a flipped comparison or a
dropped guard that line coverage waves through must turn these red.

Comprehensive on purpose (mutmut only credits the tests it runs), and also a
normal fast pytest module.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.lua_parse import parse_lua_blocks, _scan_block_body  # noqa: E402


# --- parse_lua_blocks: happy paths ---
def test_single_block_single_field():
    assert parse_lua_blocks('[1] = { Name = "a", }') == [(1, {"Name": "a"})]


def test_id_is_parsed_as_int():
    (entry_id, _), = parse_lua_blocks('[4908] = { K = "v", }')
    assert entry_id == 4908 and isinstance(entry_id, int)


def test_multiple_fields_and_blocks():
    content = '[1] = { A = "x", B = "y", }\n[2] = { C = "z", }'
    assert parse_lua_blocks(content) == [
        (1, {"A": "x", "B": "y"}),
        (2, {"C": "z"}),
    ]


# --- string-state machine: braces inside quoted values must not truncate ---
def test_closing_brace_inside_string_value_does_not_truncate():
    # the `}` lives inside the quoted value; the block must keep going to D.
    res = parse_lua_blocks('[1] = { Text = "a}b", D = "ok", }')
    assert res == [(1, {"Text": "a}b", "D": "ok"})]


def test_structural_nested_braces_balanced_by_depth():
    # an inner `{ ... }` must be consumed by depth, not end the block early.
    res = parse_lua_blocks('[1] = { Sub = "s", Inner = "{x}", Last = "L", }')
    assert res == [(1, {"Sub": "s", "Inner": "{x}", "Last": "L"})]


# --- unescaping ---
def test_escaped_quote_unescaped():
    res = parse_lua_blocks(r'[1] = { Q = "say \"hi\"", }')
    assert res == [(1, {"Q": 'say "hi"'})]


def test_escaped_newline_unescaped():
    res = parse_lua_blocks(r'[1] = { N = "line1\nline2", }')
    assert res == [(1, {"N": "line1\nline2"})]


def test_backslash_escape_does_not_end_string_early():
    # the \" must be skipped (i += 2) so the string spans to the real closing ".
    res = parse_lua_blocks(r'[1] = { P = "a\"b", Next = "n", }')
    assert res == [(1, {"P": 'a"b', "Next": "n"})]


# --- header-inside-body guard ---
def test_header_inside_previous_block_body_is_skipped():
    # a `[2] = {` sequence sitting INSIDE block 1's string value must not be
    # parsed as a second block (the `pos` guard / m.start() < pos branch).
    content = '[1] = { Note = "see [2] = { here", }\n[3] = { Z = "z", }'
    res = parse_lua_blocks(content)
    ids = [eid for eid, _ in res]
    assert ids == [1, 3]  # NOT [1, 2, 3]


# --- unterminated block: body runs to end of content ---
def test_unterminated_block_returns_body_to_end():
    # no closing brace -> _scan_block_body falls through to (body, n).
    res = parse_lua_blocks('[1] = { K = "v",')
    assert res == [(1, {"K": "v"})]


# --- _scan_block_body directly ---
def test_scan_block_body_returns_body_and_index_past_close():
    content = '{ ab }X'
    body, end = _scan_block_body(content, 0)
    assert body == ' ab '
    assert end == content.index('X')  # index just past the closing brace


def test_scan_block_body_unterminated_string_runs_to_end():
    content = '{ "no close'
    body, end = _scan_block_body(content, 0)
    assert end == len(content)
    # exact body pins the fallthrough slice content[start+1:] (start+/-1 mutants)
    assert body == ' "no close'


def test_escaped_quote_then_brace_in_string_across_blocks():
    # Value contains an escaped quote immediately followed by a `}`: only correct
    # backslash-skip + string tracking keeps that `}` inside the string, so block
    # 1 ends at its real `}` and block 2 is parsed separately. A broken backslash
    # branch (no-skip, or break instead of continue) either truncates block 1 or
    # swallows block 2 — both change the id list. Kills the string-state-machine
    # blind spots line coverage waved through.
    content = '[1] = { A = "x\\"}", }\n[2] = { B = "b", }'
    res = parse_lua_blocks(content)
    ids = [eid for eid, _ in res]
    assert ids == [1, 2]
    assert res[0][1] == {"A": 'x"}'}
    assert res[1][1] == {"B": "b"}
