"""kb_anchor 先锚后扩合流的单测（零网络、确定性、stub 后端）。

关键回归（对抗 critique 致命洞）：扩腿 embed 的任何垮法（voyage 索引 + 运行时
无 key / 无包、kb_vector.search 整体抛异常、索引缺失）都必须**函数内降级**——
锚 + 别名照常返回，绝不把脊柱托底一起带崩。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import kb_anchor  # noqa: E402
import kb_vector as kv  # noqa: E402


def _stub_index(path: Path, texts: list[str]) -> None:
    vecs = kv.embed_stub(texts)
    items = [{"ref": f"discord:2026-01-0{i}", "source": "discord",
              "date": f"2026-01-0{i}", "preview": t, "vec": v}
             for i, (t, v) in enumerate(zip(texts, vecs), 1)]
    kv.write_index(path, items, {"backend": "stub", "model": "stub",
                                 "dim": kv._STUB_DIM, "count": len(items),
                                 "data_layer": "full_archive"})
    kv.load_index.cache_clear()


def _voyage_index(path: Path) -> None:
    """模拟 CI 建的 voyage 索引（meta.backend='voyage'），vec 用桩填充。"""
    vecs = kv.embed_stub(["msg one", "msg two"])
    items = [{"ref": f"discord:{i}", "source": "discord", "date": f"2026-01-0{i}",
              "preview": t, "vec": v}
             for i, (t, v) in enumerate(zip(["msg one", "msg two"], vecs), 1)]
    kv.write_index(path, items, {"backend": "voyage", "model": "voyage-3-lite",
                                 "dim": kv._STUB_DIM, "count": 2,
                                 "data_layer": "full_archive"})
    kv.load_index.cache_clear()


# ---------- 先锚：脊柱 + 别名 ----------

def test_anchor_carries_aliases_and_expansion_terms(tmp_path):
    """别名查询（融朵）应锚定到角色概念，且已确认别名进扩词集。"""
    _stub_index(tmp_path / "v.gz", ["打融朵攻略", "unrelated chatter"])
    res = kb_anchor.anchor_expand("融朵", path=str(tmp_path / "v.gz"), backend="stub")
    ids = [a["id"] for a in res["anchors"]]
    assert "/characters/15602.md" in ids, "别名 融朵 应锚定到 熔毁·朵尔"
    dorr = next(a for a in res["anchors"] if a["id"] == "/characters/15602.md")
    assert {r["alias"] for r in dorr["aliases"] if r["confirmed"]} >= {"融朵", "熔朵"}
    assert "融朵" in res["expansion_terms"]
    assert not res["spine_degraded"]


def test_unconfirmed_alias_returned_but_not_expanded(tmp_path):
    """未确认别名（潘迪娅）随锚返回但不进扩词集（压权重墙）。"""
    _stub_index(tmp_path / "v.gz", ["some text"])
    res = kb_anchor.anchor_expand("潘狄娅", path=str(tmp_path / "v.gz"), backend="stub")
    pandia = next((a for a in res["anchors"] if a["id"] == "/characters/15560.md"), None)
    assert pandia is not None
    flags = {r["alias"]: r["confirmed"] for r in pandia["aliases"]}
    assert flags.get("潘迪娅") is False
    assert "潘迪娅" not in res["expansion_terms"]
    assert "Pandia" in res["expansion_terms"]  # 已确认的进扩词


# ---------- 后扩 + 据锚去杂 ----------

def test_tail_anchored_results_ranked_first(tmp_path):
    _stub_index(tmp_path / "v.gz", ["完全无关的闲聊内容", "今天打融朵翻车了"])
    res = kb_anchor.anchor_expand("融朵", path=str(tmp_path / "v.gz"), backend="stub")
    results = res["tail"]["results"]
    assert results and results[0]["anchored"] is True
    assert "融朵" in results[0]["anchor_matched"]
    # 未命中锚词的降序不删（不擅自丢召回）
    assert any(not r["anchored"] for r in results)


# ---------- 降级契约（致命洞回归）----------

def test_voyage_index_without_key_returns_anchors(tmp_path, monkeypatch):
    """有真 voyage 索引 + 运行时无 key/无包：tail 降级，锚 + 别名照常返回。"""
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    _voyage_index(tmp_path / "v.gz")

    def boom(*a, **k):
        raise ImportError("No module named 'voyageai'")

    monkeypatch.setattr(kv, "embed", boom)
    res = kb_anchor.anchor_expand("融朵", path=str(tmp_path / "v.gz"))
    assert res["tail"]["degraded"] is True
    assert [a for a in res["anchors"] if a["id"] == "/characters/15602.md"], \
        "扩腿垮掉不得带崩脊柱锚"
    assert "融朵" in res["expansion_terms"]


def test_vector_search_hard_crash_swallowed_in_function(tmp_path, monkeypatch):
    """kb_vector.search 整体抛异常（比内部降级更糟的垮法）也必须函数内吞掉。"""
    def hard_boom(*a, **k):
        raise RuntimeError("catastrophic vector failure")

    monkeypatch.setattr(kv, "search", hard_boom)
    res = kb_anchor.anchor_expand("融朵")
    assert res["tail"]["degraded"] is True
    assert "catastrophic" in res["tail"]["reason"]
    assert [a for a in res["anchors"] if a["id"] == "/characters/15602.md"]


def test_missing_vector_index_degrades_tail_only():
    kv.load_index.cache_clear()
    res = kb_anchor.anchor_expand("融朵", path="/nonexistent/v.gz", backend="stub")
    assert res["tail"]["degraded"] is True
    assert res["anchors"], "索引缺失只降级 tail，不降级锚"


# ---------- 消费失败喂料（§8.4 锚不到 → 自动喂候选）----------

def test_zero_anchor_feeds_alias_gap(tmp_path, monkeypatch):
    import extract_aliases
    import kb_navigator
    gaps = tmp_path / "alias_gaps.jsonl"
    monkeypatch.setattr(extract_aliases, "GAPS_PATH", gaps)
    # 脊柱零命中（bigram 兜底让纯造词也常有弱命中，故直接钉零）
    monkeypatch.setattr(kb_navigator, "search",
                        lambda q, limit=8, type_filter=None: {"results": []})
    kv.load_index.cache_clear()
    q = "某个脊柱完全锚不到的黑话"
    res = kb_anchor.anchor_expand(q, path="/nonexistent/v.gz", backend="stub")
    assert res["anchors"] == []
    assert gaps.exists() and q in gaps.read_text(encoding="utf-8")


def test_feed_gap_failure_never_raises(monkeypatch):
    """喂料本身垮掉也不许抛（best-effort）。"""
    import extract_aliases
    import kb_navigator
    monkeypatch.setattr(extract_aliases, "feed_gap",
                        lambda q: (_ for _ in ()).throw(OSError("disk full")))
    monkeypatch.setattr(kb_navigator, "search",
                        lambda q, limit=8, type_filter=None: {"results": []})
    kv.load_index.cache_clear()
    res = kb_anchor.anchor_expand("锚不到的词", path="/nonexistent/v.gz",
                                  backend="stub")
    assert res["anchors"] == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
