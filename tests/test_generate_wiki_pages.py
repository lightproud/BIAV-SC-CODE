import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from generate_wiki_pages import _voice_category, _clean_lore_markup, _clean_title

# Mirror of the prefix list inside _voice_category; each must map to itself
KNOWN_PREFIXES = [
    '闲话', '同调率', '启灵', '获得提升', '调查', '唤醒',
    '灵知觉醒', '超限狂气爆发', '狂气爆发',
    '打击', '防御', '受击', '技能', '特殊技能',
]


class TestVoiceCategory(unittest.TestCase):
    def test_every_known_prefix_maps_to_itself(self):
        for prefix in KNOWN_PREFIXES:
            with self.subTest(prefix=prefix):
                self.assertEqual(_voice_category(prefix + '·一'), prefix)

    def test_bare_prefix_title(self):
        self.assertEqual(_voice_category('闲话'), '闲话')

    def test_chaolimit_takes_precedence_over_kuangqi(self):
        # '超限狂气爆发' is listed before '狂气爆发' so the longer prefix wins
        self.assertEqual(_voice_category('超限狂气爆发·壹'), '超限狂气爆发')
        self.assertEqual(_voice_category('狂气爆发·壹'), '狂气爆发')

    def test_special_skill_not_shadowed_by_skill(self):
        # '特殊技能' does not start with '技能', so the earlier '技能' entry
        # cannot shadow it despite list ordering
        self.assertEqual(_voice_category('特殊技能·一'), '特殊技能')

    def test_unknown_title_falls_back_to_other(self):
        self.assertEqual(_voice_category('问候'), '其他')
        self.assertEqual(_voice_category(''), '其他')


class TestCleanLoreMarkup(unittest.TestCase):
    """收藏馆富文本标记清洗——锁死曾潜伏的 <Title:>/<Quality:> 渲染 bug。"""

    def test_title_and_bold_to_markdown_bold(self):
        self.assertEqual(_clean_lore_markup('<Title:创办日期>'), '**创办日期**')
        self.assertEqual(_clean_lore_markup('<Bold:银鳕鱼24>'), '**银鳕鱼24**')

    def test_quality_tokens_to_spans(self):
        self.assertEqual(_clean_lore_markup('<OrangeQuality:维度影像>'),
                         '<span class="rarity-ssr">维度影像</span>')
        self.assertIn('#ec7063', _clean_lore_markup('<RedQuality:危险>'))
        # 白色品质退化为纯文本
        self.assertEqual(_clean_lore_markup('<WhiteQuality:银芯>'), '银芯')

    def test_stray_marker_stripped(self):
        self.assertEqual(_clean_lore_markup('来自遗忘  <▼>'), '来自遗忘')

    def test_plain_prose_untouched(self):
        prose = '逃得出手术台，逃得出济贫院吗？'
        self.assertEqual(_clean_lore_markup(prose), prose)

    def test_empty_and_none_safe(self):
        self.assertEqual(_clean_lore_markup(''), '')
        self.assertEqual(_clean_lore_markup(None), '')

    def test_no_residual_angle_markers(self):
        # 清洗后绝不残留 <Type:...> 形态标记（防 markdown 转义/HTML 吞字）
        out = _clean_lore_markup('<Title:A><OrangeQuality:B>正文<▼>')
        self.assertNotRegex(out, r'<[A-Za-z]+:')


class TestCleanTitle(unittest.TestCase):
    """标题清洗：剥掉 ** 与品质色 span（与内联 HTML 相邻会破坏加粗解析）。"""

    def test_strips_bold_markers(self):
        self.assertEqual(_clean_title('<Title:简介>'), '简介')

    def test_strips_quality_span(self):
        self.assertEqual(_clean_title('<OrangeQuality:维度影像>'), '维度影像')

    def test_strips_stray_marker(self):
        self.assertEqual(_clean_title('来自遗忘  <▼>'), '来自遗忘')

    def test_no_span_or_bold_leaks(self):
        out = _clean_title('<OrangeQuality:X>')
        self.assertNotIn('<span', out)
        self.assertNotIn('**', out)


if __name__ == '__main__':
    unittest.main()
