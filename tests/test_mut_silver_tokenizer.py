"""Mutation-testing harness for silver_tokenizer (see setup.cfg [mutmut]).

This file mirrors the behavioural assertions of test_silver_tokenizer.py but
imports the module via its PACKAGE path (`scripts.silver_tokenizer`) so the
keys mutmut records at runtime match the keys it derives from the file path
`scripts/silver_tokenizer.py`. The sibling test_silver_tokenizer.py imports the
bare module name (sys.path-injected) which mutmut cannot line up — hence this
dedicated, package-qualified twin scoped by `pytest_add_cli_args_test_selection`.

It is also a normal, fast pytest module: it passes under `pytest tests/` too.
"""
import sys
from pathlib import Path

# Put the REPO ROOT on the path so `scripts` resolves as a namespace package
# in every run mode (plain `pytest`, `python -m pytest`, and mutmut's copy).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.silver_tokenizer import (  # noqa: E402
    tokenize,
    domain_dict,
    _seg_cjk,
    _walk_strings,
)


# --- latin path ---
def test_empty_and_none():
    assert tokenize("") == []
    assert tokenize(None) == []


def test_lowercases_and_filters_stopwords():
    assert tokenize("the cat is here and there") == ["cat"]
    assert "erica" in tokenize("ERICA")


def test_pure_digits_dropped_single_letter_excluded():
    assert tokenize("2026 v2 abc") == ["v2", "abc"]
    assert tokenize("a bb") == ["bb"]


# --- CJK FMM core (kills operator/constant mutants in _seg_cjk) ---
def test_longest_match_preferred():
    dic = frozenset({"忘却", "忘却前夜"})
    assert _seg_cjk("忘却前夜", dic, 4) == ["忘却前夜"]


def test_bigram_fallback_overlapping():
    assert _seg_cjk("守密人", frozenset(), 8) == ["守密", "密人"]


def test_trailing_single_char_not_emitted():
    assert _seg_cjk("守", frozenset(), 8) == []


def test_mixed_known_then_unknown():
    toks = _seg_cjk("唤醒体很强", frozenset({"唤醒体"}), 3)
    assert toks[0] == "唤醒体"
    assert "很强" in toks


def test_dict_hit_at_nonzero_offset():
    # A dict hit that lands AFTER bigram-fallback chars: exercises `i += len(hit)`
    # at i != 0 (where `i = len(hit)` would diverge / loop forever). Mutation gap.
    assert _seg_cjk("意识前夜", frozenset({"前夜"}), 4) == ["意识", "识前", "前夜"]


def test_two_char_dict_word_as_prefix_consumes_whole():
    # A 2-char dict word as the prefix of a longer run must be taken as a WHOLE
    # word (advance by 2), not fall through to overlapping bigrams. Pins the
    # inner range lower bound (`range(..., 1, -1)` must still try L=2).
    assert _seg_cjk("唤醒体", frozenset({"唤醒"}), 3) == ["唤醒"]


# --- end-to-end tokenize over CJK ---
def test_domain_term_whole_and_stopword_filtered():
    assert "忘却前夜" in tokenize("忘却前夜的剧情")
    assert "什么" not in tokenize("这是什么")


def test_mixed_latin_cjk():
    toks = tokenize("erica 是 唤醒体")
    assert "erica" in toks and "唤醒体" in toks


# --- domain_dict invariants ---
def test_domain_dict_shape_and_terms():
    dic, maxlen = domain_dict()
    assert isinstance(dic, frozenset) and len(dic) > 0
    for w in ("忘却前夜", "守密人", "唤醒体", "缸中之脑"):
        assert w in dic
    assert maxlen == max(len(t) for t in dic)


def test_domain_dict_all_pure_cjk_2_to_8():
    dic, _ = domain_dict()
    for t in dic:
        assert 2 <= len(t) <= 8


# --- _walk_strings recursion ---
def test_walk_strings_collects_keys_values_recursively():
    acc: list[str] = []
    _walk_strings({"a": ["x", {"b": "y"}]}, acc)
    assert sorted(acc) == ["a", "b", "x", "y"]


def test_walk_strings_ignores_non_string_scalars():
    acc: list[str] = []
    _walk_strings({"n": 1, "ok": True, "s": "keep"}, acc)
    assert sorted(acc) == ["keep", "n", "ok", "s"]
