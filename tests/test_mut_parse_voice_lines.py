"""Mutation-testing twin for parse_voice_lines.

Package-path imports so mutmut's runtime trampoline keys (derived from the
file path `scripts/parse_voice_lines.py`) line up, while the second sys.path
entry lets the module's bare `from lua_parse import parse_lua_blocks` resolve.
Uses the REAL parse_lua_blocks against tmp Lua files.

Asserts: AwakerVoiceContent-required filter, optional unlock_desc, id sort,
character grouping by consecutive-id gap > 50 (boundary at exactly 50 vs 51),
category split on '·', id_range string, line_count, and character_groups count.
"""
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))
sys.path.insert(0, str(_REPO / "scripts"))

from scripts.parse_voice_lines import parse_voice_lua  # noqa: E402


def _write(tmp_path, lua_text):
    p = tmp_path / "in.lua"
    p.write_text(lua_text, encoding="utf-8")
    return str(p)


# --- AwakerVoiceContent-required filter ---
def test_entry_without_voice_content_is_skipped(tmp_path):
    lua = (
        '[1] = { AwakerVoiceTitle = "问候", AwakerVoiceContent = "你好。", },\n'
        '[2] = { Name = "no voice content", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    assert result['_meta']['total_lines'] == 1


def test_title_defaults_to_empty(tmp_path):
    # Missing AwakerVoiceTitle -> '' via .get.
    lua = '[1] = { AwakerVoiceContent = "你好。", },\n'
    result = parse_voice_lua(_write(tmp_path, lua))
    line = result['characters'][0]['categories']['']
    assert line[0]['title'] == ''
    assert line[0]['content'] == '你好。'


# --- optional unlock_desc ---
def test_unlock_desc_present_only_when_in_source(tmp_path):
    lua = (
        '[1] = { AwakerVoiceTitle = "闲话·一", AwakerVoiceContent = "你好。", },\n'
        '[2] = { AwakerVoiceTitle = "闲话·二", AwakerVoiceContent = "再见。", UnlockDesc = "解锁条件", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    lines = result['characters'][0]['categories']['闲话']
    assert 'unlock_desc' not in lines[0]
    assert lines[1]['unlock_desc'] == '解锁条件'


# --- sort by id ---
def test_entries_sorted_by_id(tmp_path):
    lua = (
        '[3] = { AwakerVoiceTitle = "丙", AwakerVoiceContent = "c", },\n'
        '[1] = { AwakerVoiceTitle = "甲", AwakerVoiceContent = "a", },\n'
        '[2] = { AwakerVoiceTitle = "乙", AwakerVoiceContent = "b", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    # one group (all within gap), id_range proves sort order
    assert result['characters'][0]['id_range'] == '1-3'


# --- grouping by gap boundary ---
def test_gap_exactly_50_stays_in_one_group(tmp_path):
    # 100 -> 150 is a gap of exactly 50; 50 > 50 is False -> same group.
    lua = (
        '[100] = { AwakerVoiceTitle = "甲", AwakerVoiceContent = "a", },\n'
        '[150] = { AwakerVoiceTitle = "乙", AwakerVoiceContent = "b", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    chars = result['characters']
    assert len(chars) == 1
    assert chars[0]['id_range'] == '100-150'
    assert chars[0]['line_count'] == 2
    assert result['_meta']['character_groups'] == 1


def test_gap_51_splits_groups(tmp_path):
    # 100 -> 151 is a gap of 51; 51 > 50 is True -> split.
    lua = (
        '[100] = { AwakerVoiceTitle = "甲", AwakerVoiceContent = "a", },\n'
        '[151] = { AwakerVoiceTitle = "乙", AwakerVoiceContent = "b", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    chars = result['characters']
    assert len(chars) == 2
    assert chars[0]['id_range'] == '100-100'
    assert chars[1]['id_range'] == '151-151'
    assert result['_meta']['character_groups'] == 2


def test_multiple_groups_with_mixed_gaps(tmp_path):
    lua = (
        '[1] = { AwakerVoiceTitle = "甲", AwakerVoiceContent = "a", },\n'
        '[2] = { AwakerVoiceTitle = "乙", AwakerVoiceContent = "b", },\n'   # gap 1 -> same
        '[60] = { AwakerVoiceTitle = "丙", AwakerVoiceContent = "c", },\n'  # gap 58 -> split
        '[110] = { AwakerVoiceTitle = "丁", AwakerVoiceContent = "d", },\n' # gap 50 -> same as 丙
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    chars = result['characters']
    assert len(chars) == 2
    assert chars[0]['id_range'] == '1-2'
    assert chars[0]['line_count'] == 2
    assert chars[1]['id_range'] == '60-110'
    assert chars[1]['line_count'] == 2


# --- category split on '·' vs whole title ---
def test_category_before_dot(tmp_path):
    lua = (
        '[1] = { AwakerVoiceTitle = "闲话·一", AwakerVoiceContent = "a", },\n'
        '[2] = { AwakerVoiceTitle = "闲话·二", AwakerVoiceContent = "b", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    cats = result['characters'][0]['categories']
    assert list(cats.keys()) == ['闲话']
    assert len(cats['闲话']) == 2


def test_category_whole_title_when_no_dot(tmp_path):
    lua = '[1] = { AwakerVoiceTitle = "问候", AwakerVoiceContent = "嗨。", },\n'
    result = parse_voice_lua(_write(tmp_path, lua))
    assert list(result['characters'][0]['categories'].keys()) == ['问候']


def test_multiple_categories_within_group(tmp_path):
    lua = (
        '[1] = { AwakerVoiceTitle = "闲话·一", AwakerVoiceContent = "a", },\n'
        '[2] = { AwakerVoiceTitle = "战斗·开始", AwakerVoiceContent = "b", },\n'
        '[3] = { AwakerVoiceTitle = "闲话·二", AwakerVoiceContent = "c", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    cats = result['characters'][0]['categories']
    assert set(cats.keys()) == {'闲话', '战斗'}
    assert len(cats['闲话']) == 2
    assert len(cats['战斗']) == 1


def test_category_only_first_segment_before_dot(tmp_path):
    # split('·')[0] takes only the first segment even with multiple dots.
    lua = '[1] = { AwakerVoiceTitle = "闲话·一·补充", AwakerVoiceContent = "a", },\n'
    result = parse_voice_lua(_write(tmp_path, lua))
    assert list(result['characters'][0]['categories'].keys()) == ['闲话']


# --- line contents preserved in categories ---
def test_line_objects_carry_all_fields(tmp_path):
    lua = '[1] = { AwakerVoiceTitle = "闲话·一", AwakerVoiceContent = "你好。", UnlockDesc = "u", },\n'
    result = parse_voice_lua(_write(tmp_path, lua))
    line = result['characters'][0]['categories']['闲话'][0]
    assert line == {
        'id': 1, 'title': '闲话·一', 'content': '你好。', 'unlock_desc': 'u',
    }


# --- meta and aggregate ---
def test_meta_total_and_groups_aggregate(tmp_path):
    lua = (
        '[4908] = { AwakerVoiceTitle = "闲话·一", AwakerVoiceContent = "你好。", },\n'
        '[4909] = { AwakerVoiceTitle = "闲话·二", AwakerVoiceContent = "再见。", UnlockDesc = "解锁条件", },\n'
        '[4910] = { Name = "no voice content", },\n'
        '[5000] = { AwakerVoiceTitle = "问候", AwakerVoiceContent = "嗨。", },\n'
    )
    result = parse_voice_lua(_write(tmp_path, lua))
    meta = result['_meta']
    assert meta['total_lines'] == 3
    assert meta['character_groups'] == 2
    assert meta['source'] == 'Voice.lua (runtime memory extraction)'
    assert meta['generated'] == '2026-04-12'
    chars = result['characters']
    assert chars[0]['id_range'] == '4908-4909'
    assert chars[0]['line_count'] == 2
    assert chars[1]['id_range'] == '5000-5000'
    assert chars[1]['line_count'] == 1


def test_empty_input(tmp_path):
    result = parse_voice_lua(_write(tmp_path, ''))
    assert result['_meta']['total_lines'] == 0
    assert result['_meta']['character_groups'] == 0
    assert result['characters'] == []
