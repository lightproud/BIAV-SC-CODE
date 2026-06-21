#!/usr/bin/env python3
"""Build a static community-discussion analysis index over the FULL archive.

银芯使命#1（黑池信息入口）支撑工具。回答守密人高频分析「社区这一年有什么
变化」「对剧情怎么看」——这类查询属 CLAUDE.md §4.1 全量档案层任务，ripgrep
（子串、16s/词、无时序/无聚合）服务不了。

设计红线（守密人 2026-06-20 退役运行时自动召回环；2026-06-21 裁定本工具合规）：
  * 构建期一次性生成物（非运行时常驻、不注入会话）。
  * 确定性、可审计、零 ML / 零向量（分词为词典无关的词法切分；情感为种子
    词典极性，明确标注为「词法粗粒度」而非语义）。
  * 跟随采集 CI 重建（数据变更→重算）。覆盖式产出。
  * 放指针不放本体：聚合产物小而可提交；全文钻取仍回落到 dated 原文件
    （本 index 的 by_month 即「该回哪些日期文件 ripgrep」的路标）。

数据层纪律（§4.1 / lesson #30）：本 index 读**全量档案层** projects/news/data/，
产物 _meta 显式标 data_layer:full_archive，绝不与输出层 168 条样本混用。

用法：
    python3 scripts/build_community_index.py
    python3 scripts/build_community_index.py --max-files N   # 抽样自检用
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "projects/news/data"
OUT = REPO / "projects/news/index/community_index.json"
TODAY = date.today().isoformat()

TOP_TERMS = 40          # 每 (平台×月) / 每月保留的高频词数
PRUNE_EVERY = 500_000   # 处理多少条后裁剪一次计数器（限内存）
PRUNE_KEEP = 8_000      # 裁剪时每个计数器保留的词数

# --- 词法切分（确定性、词典无关、多语）---------------------------------------
# 拉丁词（>=2 字符，非纯数字）+ CJK 双字（中日韩文本无空格，bigram 近似词）。
_LATIN = re.compile(r"[a-z][a-z0-9']{1,}")
_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힣]")
# 停用词词典（确定性、词典法去噪）。英文功能词在多语语料里量级巨大，不滤则
# top_terms 全是 to/is/it/of；故收录标准英文停用词 + 中文高频虚词 + 平台噪声。
_STOP = {
    # --- English function words (standard stoplist) ---
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
    "go", "going", "one", "two", "im", "its", "dont", "didnt", "cant", "ive",
    "yeah", "ok", "okay", "lol", "oh", "well", "really", "much", "even", "still",
    # --- platform / url noise ---
    "https", "http", "com", "www", "amp", "gt", "lt", "nbsp", "html",
    # --- Chinese high-frequency function words ---
    "其实", "也是", "就是", "这个", "那个", "什么", "怎么", "可以", "没有", "我们",
    "他们", "因为", "所以", "但是", "如果", "一个", "自己", "这样", "那样", "时候",
    "现在", "已经", "还是", "应该", "感觉", "觉得", "知道", "这种", "或者", "不过",
    "然后", "这么", "那么", "不是", "就是", "真的", "一下", "有点", "比较", "东西",
}


def tokenize(text: str) -> list[str]:
    if not text:
        return []
    low = text.lower()
    toks = [t for t in _LATIN.findall(low) if t not in _STOP and not t.isdigit()]
    cjk = _CJK.findall(low)
    for i in range(len(cjk) - 1):
        bg = cjk[i] + cjk[i + 1]
        if bg not in _STOP:
            toks.append(bg)
    return toks


# --- 情感：种子词典极性（词法粗粒度，非语义；明确标注）------------------------
_POS = {"good", "great", "love", "nice", "best", "amazing", "fun", "cool", "awesome",
        "喜欢", "好玩", "厉害", "期待", "不错", "支持", "强势", "好看", "好评"}
_NEG = {"bad", "worst", "hate", "bug", "broken", "boring", "lag", "trash", "broke",
        "垃圾", "失望", "无聊", "退游", "差评", "坑钱", "卡顿", "崩溃", "难受"}


def polarity(tokens: list[str]) -> tuple[int, int]:
    pos = sum(1 for t in tokens if t in _POS)
    neg = sum(1 for t in tokens if t in _NEG)
    return pos, neg


def lang_of(text: str, declared: str = "") -> str:
    if declared:
        return declared.split("-")[0].lower()
    if re.search(r"[぀-ゟ゠-ヿ]", text):
        return "ja"
    if re.search(r"[가-힣]", text):
        return "ko"
    if re.search(r"[一-鿿]", text):
        return "zh"
    if re.search(r"[a-zA-Z]", text):
        return "en"
    return "und"


# --- 记录流：把异构原文件统一成 (platform, ym, text, lang, engagement) ----------

def _ym(ts: str) -> str | None:
    if not ts or len(ts) < 7:
        return None
    m = re.match(r"(\d{4})-(\d{2})", str(ts))
    return f"{m.group(1)}-{m.group(2)}" if m else None


def iter_records(max_files: int | None = None):
    seen = 0
    # 1) platforms/*.json —— 已归一化 {items:[{time,lang,title,summary,engagement}]}
    for f in sorted((DATA / "platforms").rglob("*.json")):
        if max_files and seen >= max_files:
            return
        seen += 1
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        platform = f.relative_to(DATA / "platforms").parts[0]
        items = d.get("items", d) if isinstance(d, dict) else d
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            ym = _ym(it.get("time") or it.get("published") or d.get("date", ""))
            text = " ".join(str(it.get(k, "")) for k in ("title", "summary", "content", "text"))
            eng = it.get("engagement", 0)
            eng = eng if isinstance(eng, (int, float)) else 0
            yield platform, ym, text, lang_of(text, str(it.get("lang", ""))), eng

    # 2) discord/channels/**/*.jsonl —— {content,timestamp,author_name}
    for f in sorted((DATA / "discord").rglob("*.jsonl")):
        if max_files and seen >= max_files:
            return
        seen += 1
        try:
            with f.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        it = json.loads(line)
                    except Exception:
                        continue
                    ym = _ym(it.get("timestamp", ""))
                    text = str(it.get("content", ""))
                    reacts = it.get("reactions", "[]")
                    eng = len(reacts) if isinstance(reacts, list) else 0
                    yield "discord", ym, text, lang_of(text), eng
        except Exception:
            continue

    # 3) *_comments/*.jsonl（youtube_comments 等）—— {text,published,likes}
    for f in sorted(DATA.glob("platforms/*_comments/*.jsonl")):
        if max_files and seen >= max_files:
            return
        seen += 1
        platform = f.relative_to(DATA / "platforms").parts[0]
        try:
            with f.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        it = json.loads(line)
                    except Exception:
                        continue
                    ym = _ym(it.get("published") or it.get("time", ""))
                    text = str(it.get("text", ""))
                    likes = it.get("likes", 0)
                    eng = likes if isinstance(likes, (int, float)) else 0
                    yield platform, ym, text, lang_of(text), eng
        except Exception:
            continue


# --- 聚合 ---------------------------------------------------------------------

def build(max_files: int | None = None) -> dict:
    # 每 (platform, ym) 的统计
    counts: dict[tuple[str, str], int] = defaultdict(int)
    eng_sum: dict[tuple[str, str], float] = defaultdict(float)
    langs: dict[tuple[str, str], Counter] = defaultdict(Counter)
    senti: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    terms: dict[tuple[str, str], Counter] = defaultdict(Counter)
    month_terms: dict[str, Counter] = defaultdict(Counter)
    total = 0

    def prune():
        for c in terms.values():
            if len(c) > PRUNE_KEEP:
                for k, _ in c.most_common()[PRUNE_KEEP:]:
                    del c[k]
        for c in month_terms.values():
            if len(c) > PRUNE_KEEP:
                for k, _ in c.most_common()[PRUNE_KEEP:]:
                    del c[k]

    for platform, ym, text, lang, eng in iter_records(max_files):
        if not ym:
            continue
        key = (platform, ym)
        counts[key] += 1
        eng_sum[key] += eng
        langs[key][lang] += 1
        toks = tokenize(text)
        p, n = polarity(toks)
        senti[key][0] += p
        senti[key][1] += n
        terms[key].update(toks)
        month_terms[ym].update(toks)
        total += 1
        if total % PRUNE_EVERY == 0:
            prune()

    # 组装
    platforms: dict[str, dict] = {}
    for (platform, ym), cnt in counts.items():
        pdat = platforms.setdefault(platform, {"total": 0, "by_month": {}})
        pdat["total"] += cnt
        pdat["by_month"][ym] = {
            "count": cnt,
            "engagement": round(eng_sum[(platform, ym)], 1),
            "langs": dict(langs[(platform, ym)].most_common()),
            "sentiment": {"pos": senti[(platform, ym)][0], "neg": senti[(platform, ym)][1]},
            "top_terms": terms[(platform, ym)].most_common(TOP_TERMS),
        }
    for pdat in platforms.values():
        months = sorted(pdat["by_month"])
        pdat["first_month"] = months[0] if months else None
        pdat["last_month"] = months[-1] if months else None
        pdat["by_month"] = {m: pdat["by_month"][m] for m in months}

    timeline: dict[str, dict] = {}
    for (platform, ym), cnt in counts.items():
        t = timeline.setdefault(ym, {"count": 0, "by_platform": {}})
        t["count"] += cnt
        t["by_platform"][platform] = cnt
    timeline = {m: timeline[m] for m in sorted(timeline)}

    top_by_month = {m: month_terms[m].most_common(TOP_TERMS) for m in sorted(month_terms)}

    return {
        "_meta": {
            "generated": TODAY,
            "data_layer": "full_archive",
            "source_root": "projects/news/data/",
            "total_records": total,
            "platform_count": len(platforms),
            "method": "deterministic lexical aggregate (CJK-bigram + latin word); "
                      "sentiment = seed-lexicon polarity (coarse, NOT semantic/ML)",
            "drilldown": "全文钻取回落到 by_month 指向的 dated 原文件 ripgrep；"
                         "本 index 是路标，非全文本体（放指针不放本体）。",
        },
        "platforms": dict(sorted(platforms.items())),
        "timeline": timeline,
        "top_terms_by_month": top_by_month,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Build 银芯 community full-archive analysis index.")
    ap.add_argument("--max-files", type=int, default=None, help="抽样自检：只读前 N 个文件")
    args = ap.parse_args()

    index = build(args.max_files)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    m = index["_meta"]
    print(f"community index -> {OUT.relative_to(REPO)}")
    print(f"  records: {m['total_records']}  platforms: {m['platform_count']}")
    print(f"  months: {len(index['timeline'])}  size: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
