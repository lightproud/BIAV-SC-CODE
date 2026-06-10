import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from parse_awaker_config import (
    clean_markup,
    _unescape_lua_string,
    parse_lua_table,
    parse_lua_string_table,
    parse_lua_indexed_string_table,
)


def _parse_with(parser, content):
    """Write inline Lua content to a tmp file and run the filepath parser."""
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "fixture.lua"
        path.write_text(content, encoding="utf-8")
        return parser(str(path))


class TestCleanMarkup(unittest.TestCase):
    def test_strips_color_and_size_tags(self):
        self.assertEqual(
            clean_markup('<color=#ff0000>红</color><size=20>大</size>'),
            '红大',
        )

    def test_strips_bold_and_italic_tags(self):
        self.assertEqual(clean_markup('<b>粗</b><i>斜</i>'), '粗斜')

    def test_custom_tag_keeps_payload(self):
        # <Word:payload> custom markup is replaced by its payload text
        self.assertEqual(
            clean_markup('堆叠<RetaliateIconKeywords:反击>效果'),
            '堆叠反击效果',
        )

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(clean_markup('  text  '), 'text')


class TestUnescapeLuaString(unittest.TestCase):
    def test_doubled_backslash_escapes(self):
        # File bytes use doubled backslashes: \\n -> newline, \\t -> tab
        self.assertEqual(_unescape_lua_string(r'a\\nb\\tc'), 'a\nb\tc')

    def test_unknown_escape_char_passes_through(self):
        self.assertEqual(_unescape_lua_string(r'a\\qb'), 'aqb')

    def test_single_backslash_left_untouched(self):
        # A lone backslash pair (single-backslash \n) is not an escape here
        self.assertEqual(_unescape_lua_string('a\\nb'), 'a\\nb')


class TestParseLuaTable(unittest.TestCase):
    # Block regex requires each entry to close with newline + 4 spaces + }
    LUA = (
        'local T = {\n'
        '    [10] = {\n'
        '        Name = "潘狄娅",\n'
        '        Title = "<b>bold</b>",\n'
        '        Gi = 21.06,\n'
        '    },\n'
        '    [11] = {\n'
        '        Desc = "first",\n'
        '        Desc = "second",\n'
        '        Desc = "third",\n'
        '    },\n'
        '}\n'
    )

    def test_parses_ids_and_string_fields(self):
        data = _parse_with(parse_lua_table, self.LUA)
        self.assertEqual(sorted(data.keys()), [10, 11])
        self.assertEqual(data[10]['Name'], '潘狄娅')
        self.assertEqual(data[10]['Title'], '<b>bold</b>')

    def test_unquoted_numeric_field_is_ignored(self):
        data = _parse_with(parse_lua_table, self.LUA)
        self.assertNotIn('Gi', data[10])

    def test_duplicate_keys_collapse_to_list(self):
        data = _parse_with(parse_lua_table, self.LUA)
        self.assertEqual(data[11]['Desc'], ['first', 'second', 'third'])

    def test_flat_single_line_block_not_matched(self):
        # Without a 4-space-indented closing brace the block regex finds nothing
        data = _parse_with(parse_lua_table, '[3] = { Name = "x" }\n')
        self.assertEqual(data, {})


class TestParseLuaStringTable(unittest.TestCase):
    LUA = (
        'local PanelText = {\n'
        '    ["PanelText_Btn_A"] = "显示卡牌",\n'
        '    ["Key_Escaped"] = "line1\\\\nline2",\n'
        '}\n'
    )

    def test_parses_keyed_strings(self):
        data = _parse_with(parse_lua_string_table, self.LUA)
        self.assertEqual(data['PanelText_Btn_A'], '显示卡牌')

    def test_unescapes_doubled_newline(self):
        data = _parse_with(parse_lua_string_table, self.LUA)
        self.assertEqual(data['Key_Escaped'], 'line1\nline2')


class TestParseLuaIndexedStringTable(unittest.TestCase):
    LUA = (
        'local UpdateNotices = {\n'
        '    [1] = "公告一",\n'
        '    [2] = "line1\\\\nline2",\n'
        '}\n'
    )

    def test_parses_indexed_strings(self):
        data = _parse_with(parse_lua_indexed_string_table, self.LUA)
        self.assertEqual(data, {1: '公告一', 2: 'line1\nline2'})


if __name__ == '__main__':
    unittest.main()
