import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from lua_parse import parse_lua_blocks


class TestParseLuaBlocks(unittest.TestCase):
    def test_basic_block(self):
        content = '[1] = { Title = "hello", Desc = "world", },'
        self.assertEqual(
            parse_lua_blocks(content),
            [(1, {"Title": "hello", "Desc": "world"})],
        )

    def test_unescapes_quote_and_newline(self):
        content = r'[7] = { Title = "a\"b", Note = "line1\nline2", },'
        (entry_id, fields), = parse_lua_blocks(content)
        self.assertEqual(entry_id, 7)
        self.assertEqual(fields["Title"], 'a"b')
        self.assertEqual(fields["Note"], "line1\nline2")

    def test_multiple_blocks_preserve_order(self):
        content = '[1] = { Title = "x", } [2] = { Title = "y", }'
        self.assertEqual([b[0] for b in parse_lua_blocks(content)], [1, 2])

    def test_no_blocks(self):
        self.assertEqual(parse_lua_blocks("nothing here"), [])

    def test_brace_in_value_keeps_both_fields(self):
        # SCR-01 regression: a `}` inside a quoted value must not truncate the
        # block — both fields after the brace stay intact.
        content = '[1] = { Name = "a}b", Desc = "hello", },'
        self.assertEqual(
            parse_lua_blocks(content),
            [(1, {"Name": "a}b", "Desc": "hello"})],
        )

    def test_nested_table_does_not_split_block(self):
        # A nested `{ ... }` inside the block body must be brace-balanced, so
        # the trailing field after the inner table is still captured.
        content = '[2] = { Name = "x", Inner = { foo = 1, }, Desc = "y", },'
        (entry_id, fields), = parse_lua_blocks(content)
        self.assertEqual(entry_id, 2)
        self.assertEqual(fields["Name"], "x")
        self.assertEqual(fields["Desc"], "y")

    def test_escaped_quote_inside_value(self):
        # An escaped quote must not prematurely close the string scan, so a `}`
        # that follows inside the same value is still treated as in-string.
        content = r'[3] = { Name = "say \"hi}\" now", Desc = "ok", },'
        (entry_id, fields), = parse_lua_blocks(content)
        self.assertEqual(entry_id, 3)
        self.assertEqual(fields["Name"], 'say "hi}" now')
        self.assertEqual(fields["Desc"], "ok")


if __name__ == "__main__":
    unittest.main()
