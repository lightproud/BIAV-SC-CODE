import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from parse_voice_lines import parse_voice_lua
from parse_item_stories import parse_item_stories
from parse_cg_gallery import parse_cg_gallery
from parse_collection_hall import parse_collection_hall


def _run_on_tmp(parser, content, name="fixture.lua"):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / name
        path.write_text(content, encoding="utf-8")
        return parser(str(path))


class TestParseVoiceLua(unittest.TestCase):
    # lua_parse fields need a trailing comma after each quoted value
    LUA = (
        '[4908] = { AwakerVoiceTitle = "闲话·一", AwakerVoiceContent = "你好。", },\n'
        '[4909] = { AwakerVoiceTitle = "闲话·二", AwakerVoiceContent = "再见。", UnlockDesc = "解锁条件", },\n'
        '[4910] = { Name = "no voice content", },\n'
        '[5000] = { AwakerVoiceTitle = "问候", AwakerVoiceContent = "嗨。", },\n'
    )

    def test_entries_without_voice_content_are_skipped(self):
        result = _run_on_tmp(parse_voice_lua, self.LUA)
        self.assertEqual(result['_meta']['total_lines'], 3)

    def test_id_gap_over_50_splits_character_groups(self):
        result = _run_on_tmp(parse_voice_lua, self.LUA)
        chars = result['characters']
        self.assertEqual(len(chars), 2)
        self.assertEqual(chars[0]['id_range'], '4908-4909')
        self.assertEqual(chars[0]['line_count'], 2)
        self.assertEqual(chars[1]['id_range'], '5000-5000')

    def test_category_split_on_middle_dot(self):
        result = _run_on_tmp(parse_voice_lua, self.LUA)
        group0 = result['characters'][0]
        self.assertEqual(list(group0['categories'].keys()), ['闲话'])
        self.assertEqual(len(group0['categories']['闲话']), 2)
        # Title without a dot uses the whole title as category
        group1 = result['characters'][1]
        self.assertEqual(list(group1['categories'].keys()), ['问候'])

    def test_unlock_desc_only_present_when_in_source(self):
        result = _run_on_tmp(parse_voice_lua, self.LUA)
        lines = result['characters'][0]['categories']['闲话']
        self.assertNotIn('unlock_desc', lines[0])
        self.assertEqual(lines[1]['unlock_desc'], '解锁条件')


class TestParseItemStories(unittest.TestCase):
    LUA = (
        '[1] = { Name = "命轮甲", Desc = "这是命轮装备", StoryDesc = "一段足够长的背景故事文本。", },\n'
        '[2] = { Name = "短故事", Desc = "x", StoryDesc = "太短", },\n'
        '[3] = { Name = "无故事", Desc = "x", },\n'
        '[4] = { Name = "材料碎块", Desc = "普通", StoryDesc = "另一段足够长的背景故事文本。", },\n'
        '[5] = { Name = "其他物", Desc = "说明", StoryDesc = "第三段足够长的背景故事文本。", },\n'
    )

    def test_filters_missing_and_short_stories(self):
        result = _run_on_tmp(parse_item_stories, self.LUA)
        self.assertEqual(result['_meta']['total_with_story'], 3)
        self.assertEqual([e['id'] for e in result['all_items']], [1, 4, 5])

    def test_categorization_by_desc_and_name_keywords(self):
        result = _run_on_tmp(parse_item_stories, self.LUA)
        cats = result['_meta']['category_counts']
        # Desc keyword routes to weapons; name keyword 碎块 routes to materials
        self.assertEqual(cats['weapons'], 1)
        self.assertEqual(cats['materials'], 1)
        self.assertEqual(cats['other'], 1)
        self.assertEqual(cats['artifacts'], 0)
        self.assertEqual(cats['skills'], 0)


class TestParseCgGallery(unittest.TestCase):
    MANIFEST = {
        'files': [
            {'path': 'cg/c01/b.png', 'name': 'b', 'size': 2},
            {'path': 'cg/c01/a.png', 'name': 'a', 'size': 1},
            {'path': 'cg/c99/z.png', 'name': 'z', 'size': 3},
            {'path': 'cg/cg_sd/s.png', 'name': 's', 'size': 4},
            {'path': 'other/x.png', 'name': 'x', 'size': 5},
        ]
    }

    def _parse(self):
        return _run_on_tmp(
            parse_cg_gallery, json.dumps(self.MANIFEST), name='manifest.json')

    def test_only_cg_prefixed_paths_counted(self):
        result = self._parse()
        self.assertEqual(result['_meta']['total_cg'], 4)

    def test_chapters_sorted_and_named(self):
        result = self._parse()
        chapters = result['chapters']
        self.assertEqual([c['chapter_id'] for c in chapters], ['01', '99'])
        self.assertEqual(chapters[0]['chapter_name'], 'Arc 1 - Ch.1 东区秘事')
        # Unknown chapter ids fall back to a generic label
        self.assertEqual(chapters[1]['chapter_name'], 'Chapter 99')

    def test_images_sorted_by_name_within_chapter(self):
        result = self._parse()
        names = [i['name'] for i in result['chapters'][0]['images']]
        self.assertEqual(names, ['a', 'b'])

    def test_non_chapter_cg_grouped_as_special(self):
        result = self._parse()
        self.assertEqual(len(result['special']), 1)
        sg = result['special'][0]
        self.assertEqual(sg['group_id'], 'cg_sd')
        self.assertEqual(sg['group_name'], 'SD / Chibi CG (Q版CG)')
        self.assertEqual(sg['image_count'], 1)


class TestParseCollectionHall(unittest.TestCase):
    LUA = (
        '[1] = { Title = "维度裂隙", Desc = "关于维度的描述", },\n'
        '[2] = { Title = "弥萨格大学", },\n'
        '[3] = { Title = "血狼", Desc = "凶猛", LockTip = "通关第一章", },\n'
        '[4] = { Title = "无名词条", },\n'
        '[5] = { Desc = "no title -> skipped", },\n'
    )

    def test_entries_without_title_are_skipped(self):
        result = _run_on_tmp(parse_collection_hall, self.LUA)
        self.assertEqual(result['_meta']['total_entries'], 4)

    def test_meta_counts_desc_and_lock(self):
        result = _run_on_tmp(parse_collection_hall, self.LUA)
        self.assertEqual(result['_meta']['with_description'], 2)
        self.assertEqual(result['_meta']['with_lock_condition'], 1)

    def test_keyword_categorization(self):
        result = _run_on_tmp(parse_collection_hall, self.LUA)
        by_cat = result['by_category']
        self.assertEqual([e['title'] for e in by_cat['concepts']], ['维度裂隙'])
        self.assertEqual([e['title'] for e in by_cat['locations']], ['弥萨格大学'])
        self.assertEqual([e['title'] for e in by_cat['creatures']], ['血狼'])
        self.assertEqual([e['title'] for e in by_cat['uncategorized']], ['无名词条'])


if __name__ == '__main__':
    unittest.main()
