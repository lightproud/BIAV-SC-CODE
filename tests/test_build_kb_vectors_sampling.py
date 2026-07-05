"""build_kb_vectors 分层采样（v2）的单测——零网络、确定性。

背景：语料极端偏斜（discord 753 万 = 99.5%，其余 16 平台合计 ~3.4 万），v1
「取前 limit 条」按源名顺序等于「discord 前缀 + 两个小平台」，其后 14 个平台
永远进不了索引（抽样失真，lesson #30 同源）。v2 = 水填配额（小源全收、大源吃
剩余）+ 源内跨步抽样（跨全频道全时间均匀落点）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_kb_vectors as bkv  # noqa: E402


# ---------- _quotas 水填配额 ----------

def test_quotas_small_sources_taken_fully_big_source_gets_rest():
    counts = {"discord": 1_000_000, "weibo": 300, "steam": 200}
    q = bkv._quotas(counts, 1000)
    assert q["weibo"] == 300 and q["steam"] == 200
    assert q["discord"] == 500
    assert sum(q.values()) == 1000


def test_quotas_limit_smaller_than_sources_splits_evenly():
    counts = {"a": 9999, "b": 9999, "c": 9999}
    q = bkv._quotas(counts, 10)
    assert sum(q.values()) == 10
    # 均分 + 余数按源名字典序发放：a=4, b=3, c=3
    assert q == {"a": 4, "b": 3, "c": 3}


def test_quotas_limit_exceeds_corpus_takes_all():
    counts = {"a": 5, "b": 7}
    q = bkv._quotas(counts, 1000)
    assert q == {"a": 5, "b": 7}


def test_quotas_zero_limit():
    q = bkv._quotas({"a": 5}, 0)
    assert sum(q.values()) == 0


def test_quotas_deterministic():
    counts = {"discord": 7_531_947, "weibo": 8_686, "steam": 5_127, "taptap": 7}
    assert bkv._quotas(counts, 60_000) == bkv._quotas(counts, 60_000)


# ---------- collect 分层 + 跨步 ----------

def _fake_records():
    """合成流：discord 1000 条（日期递增）、weibo 30 条、taptap 3 条、噪声短文本。"""
    out = []
    for i in range(1000):
        out.append(("discord", f"2026-{(i % 12) + 1:02d}-01", f"discord message number {i}", "en", 0))
    for i in range(30):
        out.append(("weibo", "2026-05-01", f"微博讨论内容第{i}条内容充足", "zh", 0))
    for i in range(3):
        out.append(("taptap", "2026-06-01", f"taptap review {i} long enough", "en", 0))
    out.append(("weibo", "2026-05-02", "短", "zh", 0))  # < min_len，不计入
    return out


def _patch_stream(monkeypatch):
    import build_community_index
    monkeypatch.setattr(build_community_index, "iter_records",
                        lambda max_files=None: iter(_fake_records()))


def test_collect_stratified_covers_all_sources(monkeypatch):
    _patch_stream(monkeypatch)
    rows = bkv.collect(limit=50, max_files=None, min_len=8)
    by_src = {}
    for r in rows:
        by_src[r["source"]] = by_src.get(r["source"], 0) + 1
    # 水填：taptap(3) 装得下全收；剩 47 由 discord/weibo 均分（水位 23，weibo 30>23
    # 只得 23、discord 拿 24）——绝不再是「discord 前缀独占」
    assert by_src["taptap"] == 3
    assert by_src["weibo"] == 23
    assert by_src["discord"] == 24
    assert sum(by_src.values()) == 50


def test_collect_discord_stride_spreads_across_corpus(monkeypatch):
    _patch_stream(monkeypatch)
    rows = bkv.collect(limit=50, max_files=None, min_len=8)
    d_idx = [int(r["preview"].rsplit(" ", 1)[1]) for r in rows if r["source"] == "discord"]
    # 跨步抽样应落点在语料首尾两端（前缀切片会全挤在 0..16）
    assert min(d_idx) < 100 and max(d_idx) > 800


def test_collect_deterministic(monkeypatch):
    _patch_stream(monkeypatch)
    a = bkv.collect(limit=40, max_files=None, min_len=8)
    _patch_stream(monkeypatch)
    b = bkv.collect(limit=40, max_files=None, min_len=8)
    assert [r["ref"] for r in a] == [r["ref"] for r in b]


def test_collect_min_len_filters(monkeypatch):
    _patch_stream(monkeypatch)
    rows = bkv.collect(limit=10_000, max_files=None, min_len=8)
    assert all(len(r["_text"]) >= 8 for r in rows)
    assert not any(r["_text"] == "短" for r in rows)


def test_collect_empty_corpus(monkeypatch):
    import build_community_index
    monkeypatch.setattr(build_community_index, "iter_records",
                        lambda max_files=None: iter(()))
    assert bkv.collect(limit=100, max_files=None, min_len=8) == []
