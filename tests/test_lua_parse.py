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


if __name__ == "__main__":
    unittest.main()
