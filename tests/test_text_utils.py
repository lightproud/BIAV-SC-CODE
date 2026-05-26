import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from text_utils import tokenize


class TestTokenize(unittest.TestCase):
    def test_english_words_lowercased_and_min_length(self):
        # 3+ char latin runs only, lowercased; "ab" is too short to match
        self.assertEqual(tokenize("Hello WORLD ab"), ["hello", "world"])

    def test_chinese_sliding_bigrams(self):
        self.assertEqual(tokenize("银芯系统"), ["银芯", "芯系", "系统"])

    def test_single_chinese_char_dropped(self):
        self.assertEqual(tokenize("一 二 三"), [])

    def test_stop_words_filtered(self):
        self.assertEqual(tokenize("the cat", stop_words={"the"}), ["cat"])

    def test_default_keeps_all_non_short_tokens(self):
        self.assertEqual(tokenize("the cat"), ["the", "cat"])

    def test_mixed_script(self):
        # "AI" is 2 latin chars (below the 3-char floor); the Chinese run yields one bigram
        self.assertEqual(tokenize("AI很强"), ["很强"])

    def test_empty(self):
        self.assertEqual(tokenize(""), [])

    def test_delegation_from_memory_search(self):
        import memory_search
        self.assertEqual(memory_search.tokenize("银芯"), ["银芯"])

    def test_delegation_from_fact_store(self):
        import fact_store
        self.assertEqual(fact_store.tokenize("银芯"), ["银芯"])


if __name__ == "__main__":
    unittest.main()
