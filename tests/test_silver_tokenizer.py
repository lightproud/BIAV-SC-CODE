"""silver_tokenizer 的纯函数单测。

silver_tokenizer 是 build_community_index 与 build_story_index 共用的分词地基
（领域词典 FMM + bigram 回落），覆盖率审计中为 0%（高杠杆盲区，优先级 1）。
本档案锁定其确定性契约：拉丁词切分 / 停用词去噪 / CJK 正向最大匹配 / bigram 回落 /
领域词典自举不变量。纯词典 + 算术，零网络、零 ML，断言全部可复现。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import silver_tokenizer as st
from silver_tokenizer import tokenize, domain_dict, _seg_cjk, _walk_strings


class TestTokenizeLatin(unittest.TestCase):
    def test_empty_and_none_return_empty(self):
        self.assertEqual(tokenize(""), [])
        # `if not text` 同时挡住 None，不应抛 AttributeError
        self.assertEqual(tokenize(None), [])

    def test_lowercases(self):
        self.assertIn("erica", tokenize("ERICA"))

    def test_stopwords_filtered(self):
        # the / is / and 均在 _STOP 中，应被滤掉
        self.assertEqual(tokenize("the cat is here and there"), ["cat"])

    def test_pure_digits_dropped(self):
        # 正则要求首字符是字母，纯数字根本不入候选；带字母的保留
        self.assertEqual(tokenize("2026 v2 abc"), ["v2", "abc"])

    def test_single_letter_token_excluded(self):
        # 正则 [a-z][a-z0-9']{1,} 最短两字符，单字母不成词
        self.assertEqual(tokenize("a bb"), ["bb"])

    def test_apostrophe_kept_inside_word(self):
        self.assertIn("don't", tokenize("don't"))


class TestSegCjkPure(unittest.TestCase):
    """_seg_cjk 用受控词典，验证 FMM 与回落，不依赖真实数据档案。"""

    def test_longest_match_preferred(self):
        dic = frozenset({"忘却", "忘却前夜"})
        # 最大匹配应整词切出 4 字，而非先吃 2 字「忘却」
        self.assertEqual(_seg_cjk("忘却前夜", dic, 4), ["忘却前夜"])

    def test_fallback_bigram_when_unknown(self):
        # 词典空 → 全部 overlapping bigram，逐字推进
        self.assertEqual(_seg_cjk("守密人", frozenset(), 8), ["守密", "密人"])

    def test_single_trailing_char_not_emitted_alone(self):
        # 末位单字无法成 bigram，应被丢弃（i+1<n 为假）
        self.assertEqual(_seg_cjk("守", frozenset(), 8), [])

    def test_mixed_known_and_unknown(self):
        dic = frozenset({"唤醒体"})
        toks = _seg_cjk("唤醒体很强", dic, 3)
        self.assertEqual(toks[0], "唤醒体")
        # 「很强」词典未覆盖 → bigram
        self.assertIn("很强", toks)


class TestTokenizeCjk(unittest.TestCase):
    def test_domain_term_kept_whole(self):
        # 「忘却前夜」是固定世界观术语，应整词出现而非碎成 bigram
        self.assertIn("忘却前夜", tokenize("忘却前夜的剧情"))

    def test_cjk_stopword_filtered(self):
        # 「什么」在 _STOP 中，bigram 命中后应被滤掉
        self.assertNotIn("什么", tokenize("这是什么"))

    def test_mixed_latin_cjk(self):
        toks = tokenize("erica 是 唤醒体")
        self.assertIn("erica", toks)
        self.assertIn("唤醒体", toks)


class TestDomainDict(unittest.TestCase):
    def test_shape(self):
        dic, maxlen = domain_dict()
        self.assertIsInstance(dic, frozenset)
        self.assertIsInstance(maxlen, int)
        self.assertGreater(len(dic), 0)

    def test_hardcoded_worldview_terms_present(self):
        # §4 世界观固定术语为硬编码，必入词典，与数据档案无关
        dic, _ = domain_dict()
        for w in ("忘却前夜", "守密人", "唤醒体", "缸中之脑", "弥萨格大学"):
            self.assertIn(w, dic)

    def test_all_terms_pure_cjk_2_to_8(self):
        dic, maxlen = domain_dict()
        for t in dic:
            self.assertRegex(t, r"^[一-鿿]{2,8}$")
        # maxlen 必须等于词典中最长词长度，FMM 才不会漏切长词
        self.assertEqual(maxlen, max(len(t) for t in dic))

    def test_lru_cached_identity(self):
        # @lru_cache(maxsize=1)：二次调用应返回同一对象
        self.assertIs(domain_dict(), domain_dict())


class TestWalkStrings(unittest.TestCase):
    def test_collects_dict_keys_and_values(self):
        acc: list[str] = []
        _walk_strings({"key": "value"}, acc)
        self.assertEqual(sorted(acc), ["key", "value"])

    def test_recurses_nested_list_and_dict(self):
        acc: list[str] = []
        _walk_strings({"a": ["x", {"b": "y"}]}, acc)
        self.assertCountEqual(acc, ["a", "x", "b", "y"])

    def test_non_string_scalars_ignored(self):
        acc: list[str] = []
        _walk_strings({"n": 1, "f": 2.0, "ok": True, "s": "keep"}, acc)
        # 数字 / 布尔不是 str，不入 acc；键名仍收
        self.assertCountEqual(acc, ["n", "f", "ok", "s", "keep"])


if __name__ == "__main__":
    unittest.main()
