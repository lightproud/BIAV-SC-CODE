import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from generate_wiki_pages import _voice_category

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


if __name__ == '__main__':
    unittest.main()
