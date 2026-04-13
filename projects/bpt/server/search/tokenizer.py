"""
Chinese bigram + English word dual tokenizer for TF-IDF search.

Strategy:
  - Chinese characters: overlapping bigrams (e.g. "击率" -> ["击率"])
    Full example: "暴击率" -> ["暴击", "击率"]
  - English / ASCII words: split on non-alphanumeric, lowercased
  - Numbers: kept as-is
  - Common stopwords stripped for both languages
"""

import re
import unicodedata
from typing import List

# -- Stopwords ---------------------------------------------------------------

CHINESE_STOPWORDS: set[str] = {
    "的", "了", "是", "在", "和", "有", "就", "不", "人", "都",
    "一", "个", "上", "也", "很", "到", "说", "要", "去", "你",
    "会", "着", "没有", "看", "好", "自己", "这", "他", "她", "它",
    "们", "我", "那", "被", "从", "把", "对", "与", "让", "向",
    "可以", "这个", "那个", "什么", "怎么", "为什么", "如果", "因为",
    "所以", "但是", "而且", "或者", "以及", "还是", "已经", "可能",
    "应该", "需要", "能够",
}

ENGLISH_STOPWORDS: set[str] = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "and", "but", "or", "if", "while", "because", "until", "about",
    "it", "its", "this", "that", "these", "those", "i", "me", "my",
    "we", "our", "you", "your", "he", "him", "his", "she", "her",
    "they", "them", "their", "what", "which", "who", "whom",
}

ALL_STOPWORDS: set[str] = CHINESE_STOPWORDS | ENGLISH_STOPWORDS

# -- Character classification ------------------------------------------------

# CJK Unified Ideographs range (covers most Chinese characters).
_CJK_RANGES = [
    (0x4E00, 0x9FFF),    # CJK Unified Ideographs
    (0x3400, 0x4DBF),    # CJK Unified Ideographs Extension A
    (0xF900, 0xFAFF),    # CJK Compatibility Ideographs
    (0x20000, 0x2A6DF),  # CJK Unified Ideographs Extension B
    (0x2A700, 0x2B73F),  # CJK Unified Ideographs Extension C
    (0x2B740, 0x2B81F),  # CJK Unified Ideographs Extension D
]


def _is_cjk(char: str) -> bool:
    """Return True if the character is a CJK ideograph."""
    cp = ord(char)
    for start, end in _CJK_RANGES:
        if start <= cp <= end:
            return True
    return False


# -- Tokenizer ---------------------------------------------------------------

# Regex for splitting English / number tokens.
_WORD_SPLIT_RE = re.compile(r"[^a-zA-Z0-9]+")


def _extract_chinese_bigrams(text: str) -> List[str]:
    """Extract overlapping bigrams from consecutive CJK character runs."""
    bigrams: List[str] = []
    cjk_run: List[str] = []

    for char in text:
        if _is_cjk(char):
            cjk_run.append(char)
        else:
            # End of a CJK run -- emit bigrams
            if len(cjk_run) >= 2:
                for i in range(len(cjk_run) - 1):
                    bigrams.append(cjk_run[i] + cjk_run[i + 1])
            elif len(cjk_run) == 1:
                # Single CJK character -- keep as unigram
                bigrams.append(cjk_run[0])
            cjk_run = []

    # Flush remaining CJK run
    if len(cjk_run) >= 2:
        for i in range(len(cjk_run) - 1):
            bigrams.append(cjk_run[i] + cjk_run[i + 1])
    elif len(cjk_run) == 1:
        bigrams.append(cjk_run[0])

    return bigrams


def _extract_words(text: str) -> List[str]:
    """Extract lowercased English words and numbers from text."""
    # Strip CJK characters first to avoid partial matches
    cleaned = ""
    for char in text:
        if _is_cjk(char):
            cleaned += " "
        else:
            cleaned += char

    parts = _WORD_SPLIT_RE.split(cleaned)
    tokens: List[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        lowered = part.lower()
        tokens.append(lowered)
    return tokens


def tokenize(text: str) -> List[str]:
    """
    Tokenize text into a list of tokens suitable for TF-IDF indexing.

    - Chinese characters are decomposed into overlapping bigrams.
    - English words and numbers are split on non-alphanumeric boundaries
      and lowercased.
    - Common stopwords (Chinese and English) are removed.

    Args:
        text: Input text (may contain mixed Chinese and English).

    Returns:
        List of string tokens.
    """
    if not text:
        return []

    # Normalize unicode (NFC form for consistent CJK handling)
    text = unicodedata.normalize("NFC", text)

    # Extract both token types
    bigrams = _extract_chinese_bigrams(text)
    words = _extract_words(text)

    # Combine and filter stopwords
    all_tokens = bigrams + words
    filtered = [t for t in all_tokens if t not in ALL_STOPWORDS and len(t) > 0]

    return filtered
