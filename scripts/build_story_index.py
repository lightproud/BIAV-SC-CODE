#!/usr/bin/env python3
"""Build a static story/lore search index over the unpacked story layer.

支撑守密人高频分析「对剧情怎么看」——把 1026 条 lore 的全文从「ripgrep 手扫」
升级为倒排检索（词→lore），并把角色↔剧情↔单元的路标聚合到一处。

设计红线（同 build_community_index.py，守密人 2026-06-21 裁定合规）：
  * 构建期一次性生成物，确定性、零 ML（分词复用社区索引器的词法切分）。
  * 跟随解包/剧情层重建。覆盖式产出。
  * 放指针不放本体：lore 正文权威仍在 lore_entries.json，本 index 只持 id +
    标题 + 倒排表（term -> [lore_id]），全文取用回落到本体。

源（解包结构层，机器可读）：
  * lore_entries.json        1026 lore（id/title/desc/story_unit/category）
  * story_units.json         31 剧情单元脊柱
  * character_story_links.json  55 角色↔lore 链
  * index.json               单元↔lore↔角色聚合

用法：  python3 scripts/build_story_index.py
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STORY = REPO / "projects/wiki/data/processed/story"
OUT = STORY / "story_search_index.json"
TODAY = date.today().isoformat()

# 复用共享分词器（领域词典 FMM），避免分词逻辑漂移。
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from silver_tokenizer import tokenize  # noqa: E402


def _load(name: str, key: str) -> list:
    p = STORY / name
    if not p.exists():
        return []
    d = json.loads(p.read_text(encoding="utf-8"))
    return d.get(key, []) if isinstance(d, dict) else d


# lore desc 含游戏富文本标记 <Title:物质维度> / <OrangeQuality:深渊通信>：
# 标签名（Title/WhiteQuality…）是噪声，内含专名才是内容——剥标签留内容。
_MARKUP = re.compile(r"<[A-Za-z]+:|>")


def _clean(text: str) -> str:
    return _MARKUP.sub(" ", text or "")


def build() -> dict:
    entries = _load("lore_entries.json", "entries")
    units = _load("story_units.json", "units")
    links = _load("character_story_links.json", "links")

    inverted: dict[str, set] = defaultdict(set)
    lore_meta: dict[str, dict] = {}
    unit_terms: dict[str, Counter] = defaultdict(Counter)
    with_desc = 0

    for e in entries:
        lid = str(e.get("id"))
        title = str(e.get("title", ""))
        desc = str(e.get("desc", ""))
        unit = str(e.get("story_unit", ""))
        if desc:
            with_desc += 1
        lore_meta[lid] = {
            "title": title,
            "unit": unit,
            "category": e.get("category", ""),
            "has_desc": bool(desc),
        }
        # 倒排表收录 title+desc+lock_tip（可按解锁条件检索）；但单元画像只用
        # title+desc 内容词，剔除 lock_tip 的模板样板（「可于…中解锁」会污染画像）。
        content_toks = tokenize(_clean(f"{title} {desc}"))
        all_toks = content_toks + tokenize(_clean(str(e.get("lock_tip", ""))))
        for t in set(all_toks):      # 倒排：每 lore 对每词计一次
            inverted[t].add(lid)
        if unit:
            unit_terms[unit].update(content_toks)

    # 角色 -> lore 路标（复用现成链）
    char_links: dict[str, list] = defaultdict(list)
    for lk in links:
        char_links[str(lk.get("character", ""))].append({
            "bio_lore_id": lk.get("bio_lore_id"),
            "unit": lk.get("story_unit"),
            "unlock": lk.get("unlock_condition"),
        })

    unit_profiles = {
        u: {"top_terms": c.most_common(20)} for u, c in unit_terms.items()
    }

    return {
        "_meta": {
            "generated": TODAY,
            "data_layer": "full_archive",
            "source_root": "projects/wiki/data/processed/story/",
            "lore_count": len(entries),
            "lore_with_desc": with_desc,
            "unit_count": len(units),
            "term_count": len(inverted),
            "method": "deterministic lexical inverted index; tokenizer = domain-dict FMM "
                      "(self-bootstrapped from characters/cards/story; bigram fallback)",
            "drilldown": "lore 正文权威在 lore_entries.json；本 index 持 id + 倒排表，"
                         "正文取用回落本体（放指针不放本体）。",
        },
        # 倒排表：term -> 排序后的 lore id 列表（确定性）
        "inverted": {t: sorted(ids) for t, ids in sorted(inverted.items())},
        "lore_meta": lore_meta,
        "unit_profiles": dict(sorted(unit_profiles.items())),
        "character_links": dict(sorted(char_links.items())),
    }


def main() -> None:
    index = build()
    OUT.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    m = index["_meta"]
    print(f"story index -> {OUT.relative_to(REPO)}")
    print(f"  lore: {m['lore_count']} (with desc: {m['lore_with_desc']})  "
          f"units: {m['unit_count']}  terms: {m['term_count']}")
    print(f"  size: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
