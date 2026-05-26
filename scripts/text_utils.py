"""Shared text tokenization for the memory system.

Chinese: sliding-window bigrams (2-char pairs) to handle unsegmented text.
English: whole words of 3+ chars, lowercased.
Callers pass their own stop-word set (the memory and fact-store layers
historically diverged on stop words, so it stays a caller-supplied parameter).
"""
import re


def tokenize(text: str, stop_words: frozenset[str] | set[str] = frozenset()) -> list[str]:
    words = []
    for m in re.finditer(r"[a-zA-Z]{3,}", text.lower()):
        words.append(m.group())
    for run in re.findall(r"[一-鿿]+", text):
        if len(run) >= 2:
            for i in range(len(run) - 1):
                words.append(run[i : i + 2])
    return [w for w in words if w not in stop_words and len(w) > 1]
