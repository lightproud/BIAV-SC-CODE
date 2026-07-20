"""Logic tests for parse_collection_hall.

Asserts every behaviour: Title-required filter, optional Desc/LockTip inclusion
gated on truthiness, id sort, the keyword categorization PRIORITY
(concept > location > creature > uncategorized), the with_description /
with_lock_condition rollups, and category_counts. Uses the REAL parse_lua_blocks
against tmp Lua files; the second sys.path entry lets the module's bare
`from lua_parse import` resolve.

NOT under the mutmut gate: this module carries large keyword-list constants
whose string mutants would require exhaustively asserting every keyword (pins
data, not logic) — see setup.cfg. These value assertions are the standing guard.
"""
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO))                 # resolves `scripts.<module>` key
sys.path.insert(0, str(_REPO / "scripts"))     # resolves bare `from lua_parse import`

from scripts.parse_collection_hall import parse_collection_hall  # noqa: E402


def _write(tmp_path, lua_text):
    p = tmp_path / "in.lua"
    p.write_text(lua_text, encoding="utf-8")
    return str(p)


# --- Title-required filter ---
def test_entry_without_title_is_skipped(tmp_path):
    lua = (
        '[1] = { Title = "维度裂隙", },\n'
        '[2] = { Desc = "no title here", },\n'
    )
    result = parse_collection_hall(_write(tmp_path, lua))
    assert result['_meta']['total_entries'] == 1
    assert [e['id'] for e in result['all_entries']] == [1]


def test_entry_with_title_is_kept(tmp_path):
    lua = '[1] = { Title = "无名词条", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    assert result['all_entries'][0]['title'] == '无名词条'


# --- Optional Desc / LockTip only when truthy ---
def test_desc_and_lock_included_when_truthy(tmp_path):
    lua = '[1] = { Title = "无名词条甲", Desc = "有描述", LockTip = "需通关", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    entry = result['all_entries'][0]
    assert entry['desc'] == '有描述'
    assert entry['lock_tip'] == '需通关'


def test_empty_desc_and_lock_excluded(tmp_path):
    # Empty string values are falsy -> keys must NOT be added.
    lua = '[1] = { Title = "无名词条乙", Desc = "", LockTip = "", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    entry = result['all_entries'][0]
    assert 'desc' not in entry
    assert 'lock_tip' not in entry


def test_missing_desc_and_lock_keys_absent(tmp_path):
    lua = '[1] = { Title = "无名词条丙", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    entry = result['all_entries'][0]
    assert 'desc' not in entry
    assert 'lock_tip' not in entry


# --- Sort by id ---
def test_entries_sorted_by_id(tmp_path):
    lua = (
        '[30] = { Title = "丙词条", },\n'
        '[10] = { Title = "甲词条", },\n'
        '[20] = { Title = "乙词条", },\n'
    )
    result = parse_collection_hall(_write(tmp_path, lua))
    assert [e['id'] for e in result['all_entries']] == [10, 20, 30]


# --- Categorization buckets ---
def test_concept_bucket(tmp_path):
    lua = '[1] = { Title = "维度裂隙", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    by_cat = result['by_category']
    assert [e['title'] for e in by_cat['concepts']] == ['维度裂隙']
    assert by_cat['locations'] == []
    assert by_cat['creatures'] == []
    assert by_cat['uncategorized'] == []


def test_location_bucket(tmp_path):
    lua = '[1] = { Title = "弥萨格大学", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    assert [e['title'] for e in result['by_category']['locations']] == ['弥萨格大学']


def test_creature_bucket(tmp_path):
    lua = '[1] = { Title = "血狼", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    assert [e['title'] for e in result['by_category']['creatures']] == ['血狼']


def test_uncategorized_bucket(tmp_path):
    lua = '[1] = { Title = "平凡名字", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    assert [e['title'] for e in result['by_category']['uncategorized']] == ['平凡名字']


# --- concept matches in DESC (not just title) ---
def test_concept_keyword_in_desc_routes_to_concepts(tmp_path):
    # Title is plain; concept keyword lives in Desc -> still concepts.
    lua = '[1] = { Title = "平凡条目", Desc = "提及深渊", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    assert [e['title'] for e in result['by_category']['concepts']] == ['平凡条目']


# --- location keyword only checked in TITLE, not desc ---
def test_location_keyword_in_desc_only_does_not_route_to_locations(tmp_path):
    # location keywords are matched against title ONLY; a '城' only in desc
    # must fall through to uncategorized (not locations).
    lua = '[1] = { Title = "平凡条目地", Desc = "提到城市", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    by_cat = result['by_category']
    assert by_cat['locations'] == []
    assert [e['title'] for e in by_cat['uncategorized']] == ['平凡条目地']


# --- creature keyword in desc DOES route ---
def test_creature_keyword_in_desc_routes_to_creatures(tmp_path):
    lua = '[1] = { Title = "平凡条目兽", Desc = "一只怪物", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    assert [e['title'] for e in result['by_category']['creatures']] == ['平凡条目兽']


# --- PRIORITY proofs ---
def test_priority_concept_over_location(tmp_path):
    # '深渊'(concept) + '城'(location) both present -> concept wins.
    lua = '[1] = { Title = "深渊之城", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    by_cat = result['by_category']
    assert [e['title'] for e in by_cat['concepts']] == ['深渊之城']
    assert by_cat['locations'] == []


def test_priority_concept_over_creature(tmp_path):
    # '混沌'(concept) + '狼'(creature) -> concept wins.
    lua = '[1] = { Title = "混沌之狼", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    by_cat = result['by_category']
    assert [e['title'] for e in by_cat['concepts']] == ['混沌之狼']
    assert by_cat['creatures'] == []


def test_priority_location_over_creature(tmp_path):
    # '城'(location) + '狼'(creature), no concept -> location wins
    # (location checked before creature).
    lua = '[1] = { Title = "狼城", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    by_cat = result['by_category']
    assert [e['title'] for e in by_cat['locations']] == ['狼城']
    assert by_cat['creatures'] == []


# --- counts and rollups ---
def test_with_description_and_lock_counts(tmp_path):
    lua = (
        '[1] = { Title = "维度裂隙", Desc = "关于维度的描述", },\n'
        '[2] = { Title = "弥萨格大学", },\n'
        '[3] = { Title = "血狼", Desc = "凶猛", LockTip = "通关第一章", },\n'
        '[4] = { Title = "无名词条", },\n'
        '[5] = { Desc = "no title -> skipped", },\n'
    )
    result = parse_collection_hall(_write(tmp_path, lua))
    meta = result['_meta']
    assert meta['total_entries'] == 4
    assert meta['with_description'] == 2   # entries 1 and 3
    assert meta['with_lock_condition'] == 1  # entry 3


def test_category_counts_match_buckets(tmp_path):
    lua = (
        '[1] = { Title = "维度裂隙", },\n'      # concept
        '[2] = { Title = "弥萨格大学", },\n'    # location
        '[3] = { Title = "血狼", },\n'          # creature
        '[4] = { Title = "无名词条", },\n'      # uncategorized
        '[5] = { Title = "深渊之城", },\n'      # concept (priority over location)
    )
    result = parse_collection_hall(_write(tmp_path, lua))
    counts = result['_meta']['category_counts']
    assert counts == {
        'locations': 1,
        'creatures': 1,
        'concepts': 2,
        'uncategorized': 1,
    }
    by_cat = result['by_category']
    assert len(by_cat['concepts']) == 2
    assert len(by_cat['locations']) == 1
    assert len(by_cat['creatures']) == 1
    assert len(by_cat['uncategorized']) == 1


def test_meta_static_fields(tmp_path):
    lua = '[1] = { Title = "维度裂隙", },\n'
    result = parse_collection_hall(_write(tmp_path, lua))
    meta = result['_meta']
    assert meta['source'] == 'CollectionHall.lua (runtime memory extraction)'
    assert meta['generated'] == '2026-04-12'


def test_empty_input(tmp_path):
    result = parse_collection_hall(_write(tmp_path, ''))
    assert result['_meta']['total_entries'] == 0
    assert result['all_entries'] == []
    assert result['_meta']['category_counts'] == {
        'locations': 0, 'creatures': 0, 'concepts': 0, 'uncategorized': 0,
    }
