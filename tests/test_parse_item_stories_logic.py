"""Logic tests for parse_item_stories.

Asserts: StoryDesc-required filter, placeholder skips (exact '', '未完成',
'测试', '临时文本' and len < 10), id sort, the if/elif categorization PRIORITY
(weapons > artifacts > skills > materials > other), and total_with_story. Uses
the REAL parse_lua_blocks against tmp Lua files; the second sys.path entry lets
the module's bare `from lua_parse import` resolve.

NOT under the mutmut gate: keyword-list constants would need exhaustive
per-keyword assertions to kill (pins data, not logic) — see setup.cfg.
"""
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))
sys.path.insert(0, str(_REPO / "scripts"))

from scripts.parse_item_stories import parse_item_stories  # noqa: E402


def _write(tmp_path, lua_text):
    p = tmp_path / "in.lua"
    p.write_text(lua_text, encoding="utf-8")
    return str(p)


_LONG = "一段足够长的背景故事文本。"  # >= 10 chars


# --- StoryDesc-required filter ---
def test_entry_without_storydesc_is_skipped(tmp_path):
    lua = (
        f'[1] = {{ Name = "甲", Desc = "x", StoryDesc = "{_LONG}", }},\n'
        '[2] = { Name = "乙", Desc = "x", },\n'
    )
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 1
    assert [e['id'] for e in result['all_items']] == [1]


# --- placeholder skips: exact strings ---
def test_placeholder_未完成_skipped(tmp_path):
    lua = '[1] = { Name = "甲", Desc = "x", StoryDesc = "未完成", },\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 0


def test_placeholder_测试_skipped(tmp_path):
    lua = '[1] = { Name = "甲", Desc = "x", StoryDesc = "测试", },\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 0


def test_placeholder_临时文本_skipped(tmp_path):
    lua = '[1] = { Name = "甲", Desc = "x", StoryDesc = "临时文本", },\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 0


def test_empty_storydesc_skipped(tmp_path):
    lua = '[1] = { Name = "甲", Desc = "x", StoryDesc = "", },\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 0


# --- length filter: < 10 skipped, exactly boundary ---
def test_story_shorter_than_10_skipped(tmp_path):
    # 9 chars -> skipped
    lua = '[1] = { Name = "甲", Desc = "x", StoryDesc = "123456789", },\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 0


def test_story_exactly_10_chars_kept(tmp_path):
    # 10 chars -> kept (len < 10 is the skip condition)
    lua = '[1] = { Name = "甲", Desc = "x", StoryDesc = "1234567890", },\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 1
    assert result['all_items'][0]['story'] == '1234567890'


# --- entry shape with Name/Desc defaults ---
def test_entry_fields_and_missing_defaults(tmp_path):
    # Missing Name and Desc default to '' (via .get).
    lua = f'[1] = {{ StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    entry = result['all_items'][0]
    assert entry == {'id': 1, 'name': '', 'desc': '', 'story': _LONG}


# --- Sort by id ---
def test_entries_sorted_by_id(tmp_path):
    lua = (
        f'[30] = {{ Name = "丙", Desc = "d", StoryDesc = "{_LONG}", }},\n'
        f'[10] = {{ Name = "甲", Desc = "d", StoryDesc = "{_LONG}", }},\n'
        f'[20] = {{ Name = "乙", Desc = "d", StoryDesc = "{_LONG}", }},\n'
    )
    result = parse_item_stories(_write(tmp_path, lua))
    assert [e['id'] for e in result['all_items']] == [10, 20, 30]


# --- Categorization buckets ---
def test_weapons_by_命轮_in_desc(tmp_path):
    lua = f'[1] = {{ Name = "刀", Desc = "这是命轮装备", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['weapons'] == 1


def test_weapons_by_属性为_in_desc(tmp_path):
    lua = f'[1] = {{ Name = "刀", Desc = "属性为火", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['weapons'] == 1


def test_artifacts_by_密契_in_desc(tmp_path):
    lua = f'[1] = {{ Name = "物", Desc = "密契道具", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['artifacts'] == 1


def test_artifacts_by_主属性从_in_desc(tmp_path):
    lua = f'[1] = {{ Name = "物", Desc = "主属性从甲变乙", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['artifacts'] == 1


def test_skills_by_钥令_in_desc(tmp_path):
    lua = f'[1] = {{ Name = "物", Desc = "钥令解锁", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['skills'] == 1


def test_materials_by_材料_in_desc(tmp_path):
    lua = f'[1] = {{ Name = "物", Desc = "升级材料", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['materials'] == 1


def test_materials_by_碎块_in_name(tmp_path):
    # materials also matches 碎块 in NAME (not desc).
    lua = f'[1] = {{ Name = "材料碎块", Desc = "普通", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['materials'] == 1


def test_materials_by_精华_in_name(tmp_path):
    lua = f'[1] = {{ Name = "灵魂精华", Desc = "普通", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['category_counts']['materials'] == 1


def test_other_bucket(tmp_path):
    lua = f'[1] = {{ Name = "普通物", Desc = "无关键词说明", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    cats = result['_meta']['category_counts']
    assert cats['other'] == 1
    assert cats['weapons'] == 0
    assert cats['artifacts'] == 0
    assert cats['skills'] == 0
    assert cats['materials'] == 0


# --- if/elif PRIORITY proofs ---
def test_priority_weapons_over_artifacts(tmp_path):
    # Desc has both 命轮(weapons) and 密契(artifacts) -> weapons wins (first if).
    lua = f'[1] = {{ Name = "物", Desc = "命轮密契", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    cats = result['_meta']['category_counts']
    assert cats['weapons'] == 1
    assert cats['artifacts'] == 0


def test_priority_artifacts_over_skills(tmp_path):
    # 密契(artifacts) + 钥令(skills) -> artifacts wins (elif order).
    lua = f'[1] = {{ Name = "物", Desc = "密契钥令", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    cats = result['_meta']['category_counts']
    assert cats['artifacts'] == 1
    assert cats['skills'] == 0


def test_priority_skills_over_materials(tmp_path):
    # 钥令(skills) in desc + 碎块(materials) in name -> skills wins.
    lua = f'[1] = {{ Name = "碎块", Desc = "钥令技能", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    cats = result['_meta']['category_counts']
    assert cats['skills'] == 1
    assert cats['materials'] == 0


def test_priority_materials_over_other(tmp_path):
    # 材料(materials) present but no higher keyword -> materials, not other.
    lua = f'[1] = {{ Name = "物", Desc = "材料用途", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    cats = result['_meta']['category_counts']
    assert cats['materials'] == 1
    assert cats['other'] == 0


# --- aggregate: counts and total ---
def test_total_and_category_counts_aggregate(tmp_path):
    lua = (
        f'[1] = {{ Name = "命轮甲", Desc = "这是命轮装备", StoryDesc = "{_LONG}", }},\n'
        '[2] = { Name = "短故事", Desc = "x", StoryDesc = "太短", },\n'
        '[3] = { Name = "无故事", Desc = "x", },\n'
        f'[4] = {{ Name = "材料碎块", Desc = "普通", StoryDesc = "{_LONG}", }},\n'
        f'[5] = {{ Name = "其他物", Desc = "说明", StoryDesc = "{_LONG}", }},\n'
    )
    result = parse_item_stories(_write(tmp_path, lua))
    assert result['_meta']['total_with_story'] == 3
    assert [e['id'] for e in result['all_items']] == [1, 4, 5]
    cats = result['_meta']['category_counts']
    assert cats == {
        'weapons': 1, 'artifacts': 0, 'skills': 0, 'materials': 1, 'other': 1,
    }


def test_meta_static_fields(tmp_path):
    lua = f'[1] = {{ Name = "甲", Desc = "x", StoryDesc = "{_LONG}", }},\n'
    result = parse_item_stories(_write(tmp_path, lua))
    meta = result['_meta']
    assert meta['source'] == 'Item.lua (runtime memory extraction)'
    assert meta['generated'] == '2026-04-12'


def test_empty_input(tmp_path):
    result = parse_item_stories(_write(tmp_path, ''))
    assert result['_meta']['total_with_story'] == 0
    assert result['all_items'] == []
