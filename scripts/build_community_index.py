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

数据层纪律（§4.1 / lesson #30）：本 index 读**全量档案层**——现行根
Public-Info-Pool/Record/Community/（2026-06-21 BPT 4R 迁入；旧 projects/news/data/
布局仅作回落），产物 _meta 显式标 data_layer:full_archive，绝不与输出层样本混用。

用法：
    python3 scripts/build_community_index.py
    python3 scripts/build_community_index.py --max-files N   # 抽样自检用
"""
from __future__ import annotations

import argparse
import json
import os
import re
import calendar
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from silver_tokenizer import tokenize  # noqa: E402  共享领域词典 FMM 分词
from news_bridge import archive_layout  # noqa: E402  归档布局单一真相源（冷热分层统一开档）

REPO = Path(__file__).resolve().parent.parent
# 社区源根：迁移后为 BPT 4R 的 Record/Community（各源摊平）；迁移前回落旧布局。
COMMUNITY_NEW = archive_layout.community_root()  # 分仓桥接：env BIAV_SC_DATA_ROOT 或在树默认
DATA_OLD = REPO / "projects/news/data"
OUT = REPO / "projects/news/index/community_index.json"
# 「今天」= 北京日期（archive_layout 是全仓日期基准 SSOT）。原 date.today() 取的是
# **容器本地日期**：CI 在 UTC、守密人在 UTC+8，同一次重建在两处会盖出不同的
# generated 戳记——生成物本该是确定性的。
TODAY = archive_layout.archive_today().isoformat()

TOP_TERMS = 40          # 每 (平台×月) / 每月保留的高频词数
PRUNE_EVERY = 500_000   # 处理多少条后裁剪一次计数器（限内存）
PRUNE_KEEP = 8_000      # 裁剪时每个计数器保留的词数

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
        return declared.split("-", maxsplit=1)[0].lower()
    if re.search(r"[぀-ゟ゠-ヿ]", text):
        return "ja"
    if re.search(r"[가-힣]", text):
        return "ko"
    if re.search(r"[一-鿿]", text):
        return "zh"
    if re.search(r"[a-zA-Z]", text):
        return "en"
    return "und"


# --- 记录流：把异构原文件统一成 (platform, day, text, lang, engagement) ----------

def _ymd(ts: str) -> str | None:
    """抽完整日期 YYYY-MM-DD（用于采集覆盖统计；月份取前 7 位即可）。"""
    if not ts or len(ts) < 7:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(ts))
    if m:
        return m.group(0)
    m = re.match(r"(\d{4})-(\d{2})", str(ts))    # 只到月：补 -01 占位
    return f"{m.group(0)}-01" if m else None


def _source_root_label() -> str:
    """_meta.source_root：实际读取根（新布局优先，与 _sources 同判据）。"""
    root = (COMMUNITY_NEW
            if COMMUNITY_NEW.exists() and any(COMMUNITY_NEW.iterdir())
            else DATA_OLD)
    try:
        return str(root.relative_to(REPO)) + "/"
    except ValueError:  # 测试环境 monkeypatch 到 REPO 外的 tmp 目录
        return str(root) + "/"


def _sources():
    """产出 (源名, 目录) 对。迁移后用 Record/Community 摊平布局；否则回落旧布局。"""
    if COMMUNITY_NEW.exists() and any(COMMUNITY_NEW.iterdir()):
        for d in sorted(COMMUNITY_NEW.iterdir()):
            if d.is_dir():
                yield d.name, d
        return
    if (DATA_OLD / "discord").exists():
        yield "discord", DATA_OLD / "discord"
    pl = DATA_OLD / "platforms"
    if pl.exists():
        for d in sorted(pl.iterdir()):
            if d.is_dir():
                yield d.name, d


# ── 跳档台账（扫描修复 2026-07-28）────────────────────────────────────────────
# 三个 emitter 原本对读不动的档案一律 `except: continue` —— 整份文件被静默丢弃。
# 本索引的全部价值在**完整性**（_meta.data_layer=full_archive，§4.1 长窗口分析 /
# 完整性审计的取数层），静默丢档意味着 total 少了没人知道：既不报错，也不在产物里
# 留任何痕迹，下游把缩水后的数字当全量用。故改为「照旧不中断，但响亮计数」：
# 跳过的档案计入 SKIPPED 并落进产物 _meta.skipped_files，构建时 stderr 亦告警。
SKIPPED: list[dict] = []


def _note_skip(path, exc: BaseException) -> None:
    SKIPPED.append({"file": str(path), "error": f"{type(exc).__name__}: {exc}"[:200]})


def _emit_discord(d):
    """discord：channels/ 与 guilds/ 下 *.jsonl[.gz]，{content,timestamp,reactions}。
    冷热分层（2026-07-12 甲案）：冷月为 .gz，经 archive_layout 统一开档透明读。"""
    for f in sorted(list(d.rglob("*.jsonl")) + list(d.rglob("*.jsonl.gz"))):
        try:
            with archive_layout.open_archive_text(f) as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        it = json.loads(line)
                    except json.JSONDecodeError:  # 只挡坏行
                        continue
                    text = str(it.get("content", ""))
                    reacts = it.get("reactions", "[]")
                    eng = len(reacts) if isinstance(reacts, list) else 0
                    yield _ymd(it.get("timestamp", "")), text, lang_of(text), eng
        except Exception as exc:
            _note_skip(f, exc)
            continue


def _emit_comments(d):
    """*_comments：*.jsonl[.gz]，{text,published,likes}。"""
    for f in sorted(list(d.glob("*.jsonl")) + list(d.glob("*.jsonl.gz"))):
        try:
            with archive_layout.open_archive_text(f) as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        it = json.loads(line)
                    except json.JSONDecodeError:  # 只挡坏行
                        continue
                    text = str(it.get("text", ""))
                    likes = it.get("likes", 0)
                    eng = likes if isinstance(likes, (int, float)) else 0
                    yield _ymd(it.get("published") or it.get("time", "")), text, lang_of(text), eng
        except Exception as exc:
            _note_skip(f, exc)
            continue


def _emit_platform(d):
    """平台：dated *.json[.gz]，{items:[{time,lang,title,summary,engagement}]}。"""
    for f in sorted(list(d.rglob("*.json")) + list(d.rglob("*.json.gz"))):
        try:
            with archive_layout.open_archive_text(f) as fh:
                doc = json.load(fh)
        except Exception as exc:
            _note_skip(f, exc)
            continue
        items = doc.get("items", doc) if isinstance(doc, dict) else doc
        if not isinstance(items, list):
            continue
        ddate = doc.get("date", "") if isinstance(doc, dict) else ""
        for it in items:
            if not isinstance(it, dict):
                continue
            text = " ".join(str(it.get(k, "")) for k in ("title", "summary", "content", "text"))
            eng = it.get("engagement", 0)
            eng = eng if isinstance(eng, (int, float)) else 0
            yield (_ymd(it.get("time") or it.get("published") or ddate),
                   text, lang_of(text, str(it.get("lang", ""))), eng)


def iter_records(max_files: int | None = None):
    for seen, (name, d) in enumerate(_sources()):
        if max_files and seen >= max_files:
            return
        if name == "discord":
            emitter = _emit_discord(d)
        elif name.endswith("_comments"):
            emitter = _emit_comments(d)
        else:
            emitter = _emit_platform(d)
        for day, text, lang, eng in emitter:
            yield name, day, text, lang, eng


# --- 聚合 ---------------------------------------------------------------------

def build(max_files: int | None = None) -> dict:
    # 每 (platform, ym) 的统计
    counts: dict[tuple[str, str], int] = defaultdict(int)
    eng_sum: dict[tuple[str, str], float] = defaultdict(float)
    langs: dict[tuple[str, str], Counter] = defaultdict(Counter)
    senti: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    terms: dict[tuple[str, str], Counter] = defaultdict(Counter)
    month_terms: dict[str, Counter] = defaultdict(Counter)
    days: dict[tuple[str, str], set] = defaultdict(set)   # 采集覆盖：distinct 日期
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

    for platform, day, text, lang, eng in iter_records(max_files):
        if not day:
            continue
        ym = day[:7]
        key = (platform, ym)
        counts[key] += 1
        eng_sum[key] += eng
        langs[key][lang] += 1
        days[key].add(day)
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
        y, mo = int(ym[:4]), int(ym[5:7])
        days_in_month = calendar.monthrange(y, mo)[1]
        active = len(days[(platform, ym)])
        pdat["by_month"][ym] = {
            "count": cnt,
            "engagement": round(eng_sum[(platform, ym)], 1),
            "langs": dict(langs[(platform, ym)].most_common()),
            "sentiment": {"pos": senti[(platform, ym)][0], "neg": senti[(platform, ym)][1]},
            # 采集覆盖：本月有数据的天数 / 当月总天数。低覆盖 = 采集缺口，
            # 量级骤降未必是社区静默（防 2026-02/03 断崖误读）。
            "coverage": {"active_days": active, "month_days": days_in_month,
                         "ratio": round(active / days_in_month, 2)},
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
    # 量异常指数：本月总量 / 前 6 个月中位数。远离 1 = 该月量反常，
    # 量级骤降应先怀疑采集异常而非「社区静默」（防 2026-02/03 断崖误读）。
    # 注意：与 per-platform 的 coverage（按天，抓整天断档）互补——本指数抓
    # 「天天有数据但单日量塌缩」那种 coverage 看不出的异常。
    sorted_months = sorted(timeline)
    for i, ym in enumerate(sorted_months):
        prior = [timeline[m]["count"] for m in sorted_months[max(0, i - 6):i]]
        med = statistics.median(prior) if prior else 0
        timeline[ym]["vol_index"] = round(timeline[ym]["count"] / med, 2) if med else None
    timeline = {m: timeline[m] for m in sorted_months}

    top_by_month = {m: month_terms[m].most_common(TOP_TERMS) for m in sorted(month_terms)}

    return {
        "_meta": {
            "generated": TODAY,
            "data_layer": "full_archive",
            "source_root": _source_root_label(),
            "total_records": total,
            "platform_count": len(platforms),
            "method": "deterministic lexical aggregate; tokenizer = domain-dict FMM "
                      "(self-bootstrapped from characters/cards/story; bigram fallback); "
                      "sentiment = seed-lexicon polarity (coarse, NOT semantic/ML)",
            "signals": "per-platform coverage = 当月有数据天数/总天数（抓整天断档）；"
                       "timeline vol_index = 本月量/前6月中位数（抓单日量塌缩，"
                       "如 2026-02/03 天天有数据但量崩 30 倍）。二者互补判采集异常。",
            "drilldown": "全文钻取回落到 by_month 指向的 dated 原文件 ripgrep；"
                         "本 index 是路标，非全文本体（放指针不放本体）。",
            # 订正（扫描修复 2026-07-28）：原 data_note 两处与现状矛盾——
            #   (1) 写「永驻 git（Record/Community/discord/）」，但 T62 P2-5 §7甲
            #       已于 2026-07-20 把数据湖迁出 code 仓，现经 BIAV_SC_DATA_ROOT 读；
            #   (2) 写「community-data release 已退役删除」，而 CLAUDE.md §6.3 把该
            #       Release 明列为仅剩三张抢救网之一（删任一即等同永久丢失）。
            #       产物元数据说它没了，是会直接导致误删的错误记载。
            "data_note": "discord 全量历史驻 BIAV-SC-DATA 数据仓 Record/Community/discord/，"
                         "经环境变量 BIAV_SC_DATA_ROOT 解析读取（T62 §7甲，2026-07-20 迁出 code 仓）；"
                         "community-data / community-assets Release 为在役抢救网之一"
                         "（CLAUDE.md §6.3），未退役、不得删除。",
            # 完整性披露：读不动而被跳过的档案在此点名，不静默缩水（§4.1）
            "skipped_file_count": len(SKIPPED),
            "skipped_files": SKIPPED[:50],
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
    # 原子替换：本索引是全量分析取数层，直写若被中断即留下半截 JSON,
    # 消费方（艾瑞卡 / 周报生产线）读到的是不可解析的残档。
    tmp = OUT.with_suffix(OUT.suffix + ".tmp")
    tmp.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, OUT)
    m = index["_meta"]
    print(f"community index -> {OUT.relative_to(REPO)}")
    print(f"  records: {m['total_records']}  platforms: {m['platform_count']}")
    print(f"  months: {len(index['timeline'])}  size: {OUT.stat().st_size} bytes")
    if SKIPPED:
        # 响亮而非静默：完整性缺口必须在构建日志里现身（原先整份丢档零痕迹）
        print(f"  WARNING: {len(SKIPPED)} 个档案读取失败被跳过（已记入 _meta.skipped_files）",
              file=sys.stderr)
        for s in SKIPPED[:10]:
            print(f"    - {s['file']}: {s['error']}", file=sys.stderr)


if __name__ == "__main__":
    main()
