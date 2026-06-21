#!/usr/bin/env python3
"""银芯静态索引共用分词器:领域词典 + 正向最大匹配（FMM）。

为什么不用 jieba：本环境 jieba 编译失败；且通用分词器对《忘却前夜》的专名
（角色名 / 阵营 / 卡牌术语 / 剧情单元）反而不如「自家词典」准。本模块用银芯
权威知识源自举一份领域词典，对 CJK 文本跑正向最大匹配——专名整词切出，不再
碎成 bigram；词典未覆盖的散串回落 bigram（保留旧行为，不丢召回）。

红线：纯词典匹配 + 算术，确定性、零 ML、零运行时。即守密人说的「词典法」本尊。

被 scripts/build_community_index.py 与 build_story_index.py 共用，避免分词逻辑漂移。
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

_LATIN = re.compile(r"[a-z][a-z0-9']{1,}")
_CJK_CHAR = re.compile(r"[一-鿿぀-ヿ가-힣]")
_CJK_RUN = re.compile(r"[一-鿿぀-ヿ가-힣]{2,}")
_PURE_CJK = re.compile(r"^[一-鿿]{2,8}$")

# 停用词词典（确定性去噪；英文功能词在多语语料量级巨大，不滤则 top_terms 全是 to/is）。
_STOP = {
    "the", "a", "an", "and", "or", "but", "if", "of", "at", "by", "for", "with",
    "about", "to", "from", "in", "on", "off", "out", "up", "down", "over", "under",
    "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did",
    "have", "has", "had", "having", "can", "could", "will", "would", "shall",
    "should", "may", "might", "must", "i", "me", "my", "we", "us", "our", "you",
    "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their",
    "this", "that", "these", "those", "what", "which", "who", "whom", "whose",
    "as", "so", "than", "too", "very", "just", "now", "then", "here", "there",
    "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "also", "get", "got", "like",
    "go", "going", "one", "two", "im", "dont", "didnt", "cant", "ive",
    "yeah", "ok", "okay", "lol", "oh", "well", "really", "much", "even", "still",
    "https", "http", "com", "www", "amp", "gt", "lt", "nbsp", "html",
    "其实", "也是", "就是", "这个", "那个", "什么", "怎么", "可以", "没有", "我们",
    "他们", "因为", "所以", "但是", "如果", "一个", "自己", "这样", "那样", "时候",
    "现在", "已经", "还是", "应该", "感觉", "觉得", "知道", "这种", "或者", "不过",
    "然后", "这么", "那么", "不是", "真的", "一下", "有点", "比较", "东西",
    "简介", "标题", "介绍", "title",   # lore 结构性章节词 / 残留富文本标签
}


def _walk_strings(obj, acc: list[str]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str):
                acc.append(k)
            _walk_strings(v, acc)
    elif isinstance(obj, list):
        for x in obj:
            _walk_strings(x, acc)
    elif isinstance(obj, str):
        acc.append(obj)


@lru_cache(maxsize=1)
def domain_dict() -> tuple[frozenset[str], int]:
    """从银芯权威源自举领域词典（纯 CJK 2-8 字）。构建期算一次，缓存。"""
    terms: set[str] = set()

    def add(s: str) -> None:
        s = (s or "").strip()
        if _PURE_CJK.match(s):
            terms.add(s)

    # 1) 72 角色名 + 称号
    cf = REPO / "projects/wiki/data/processed/characters.json"
    if cf.exists():
        for c in json.loads(cf.read_text(encoding="utf-8")).get("characters", []):
            add(c.get("name", ""))
            add(c.get("title", ""))

    # 2) 卡牌系统术语 + 玩家黑话别名
    kf = REPO / "assets/data/card-system.json"
    if kf.exists():
        acc: list[str] = []
        _walk_strings(json.loads(kf.read_text(encoding="utf-8")), acc)
        for t in acc:
            add(t)

    # 3) 剧情单元名 / 简称
    uf = REPO / "projects/wiki/data/processed/story/story_units.json"
    if uf.exists():
        for u in json.loads(uf.read_text(encoding="utf-8")).get("units", []):
            add(u.get("short_name", ""))
            # 单元全名常含「」括注，剥出引号内专名
            for m in re.findall(r"[一-鿿]{2,8}", str(u.get("unit", ""))):
                add(m)

    # 4) 世界观固定术语
    for w in ("忘却前夜", "意识潜游", "调查行动", "缸中之脑", "弥萨格大学", "弥萨格",
              "星辰篇", "忘却篇", "守密人", "唤醒体", "自动人偶", "至高意志", "特遣纪录"):
        add(w)

    maxlen = max((len(t) for t in terms), default=2)
    return frozenset(terms), maxlen


def _seg_cjk(run: str, dic: frozenset[str], maxlen: int) -> list[str]:
    """对一段连续 CJK 跑正向最大匹配；命中词典则整词，否则回落 bigram。"""
    toks: list[str] = []
    i, n = 0, len(run)
    while i < n:
        hit = None
        for L in range(min(maxlen, n - i), 1, -1):
            w = run[i:i + L]
            if w in dic:
                hit = w
                break
        if hit:
            toks.append(hit)
            i += len(hit)
        else:
            # 词典未覆盖：保留 bigram（overlapping），逐字推进，不丢召回
            if i + 1 < n:
                toks.append(run[i:i + 2])
            i += 1
    return toks


def tokenize(text: str) -> list[str]:
    """确定性词法切分：拉丁词 + CJK 领域词典 FMM（回落 bigram）。"""
    if not text:
        return []
    low = text.lower()
    toks = [t for t in _LATIN.findall(low) if t not in _STOP and not t.isdigit()]
    dic, maxlen = domain_dict()
    for run in _CJK_RUN.findall(low):
        for t in _seg_cjk(run, dic, maxlen):
            if t not in _STOP:
                toks.append(t)
    return toks
