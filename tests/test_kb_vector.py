"""kb_vector 向量检索腿的离线单测（桩后端、零网络、可复现）。

kb_vector 是 §八「厚锚撑向量」的银芯参照实现（守密人 2026-07-05 裁定(A) 解除零 ML
红线后落地）。真·语义召回质量只有 Voyage 后端有，需 API key；本档案用**确定性桩
后端**（token 哈希袋）锁定管线契约：嵌入确定性 / 归一化 / 索引读写往返 / 余弦排序 /
缺索引优雅降级。断言全部零网络、可复现（不触 Voyage）。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import kb_vector as kv


class TestEmbedStub(unittest.TestCase):
    def test_deterministic(self):
        a = kv.embed_stub(["达芙妮 冰系奶妈"])
        b = kv.embed_stub(["达芙妮 冰系奶妈"])
        self.assertEqual(a, b)  # 同输入必得同向量

    def test_l2_normalized(self):
        (v,) = kv.embed_stub(["some tokens here"])
        norm = sum(x * x for x in v) ** 0.5
        self.assertAlmostEqual(norm, 1.0, places=6)

    def test_shared_tokens_more_similar(self):
        # 共享 token 的两段应比无共享的更相似（桩是词法袋，非语义）
        base = kv.embed_stub(["alpha beta gamma"])[0]
        near = kv.embed_stub(["alpha beta delta"])[0]
        far = kv.embed_stub(["zeta eta theta"])[0]
        sim_near = kv._cosine_prenorm(base, near)
        sim_far = kv._cosine_prenorm(base, far)
        self.assertGreater(sim_near, sim_far)

    def test_empty_text_safe(self):
        (v,) = kv.embed_stub([""])
        self.assertEqual(len(v), kv._STUB_DIM)


class TestDefaultBackend(unittest.TestCase):
    def test_stub_when_no_key(self, ):
        import os
        saved = os.environ.pop("VOYAGE_API_KEY", None)
        try:
            self.assertEqual(kv.default_backend(), "stub")
        finally:
            if saved is not None:
                os.environ["VOYAGE_API_KEY"] = saved


class TestIndexRoundtrip(unittest.TestCase):
    def _build(self, path, texts):
        vecs = kv.embed_stub(texts)
        items = [
            {"ref": f"src:2026-01-0{i}", "source": "discord",
             "date": f"2026-01-0{i}", "preview": t, "vec": v}
            for i, (t, v) in enumerate(zip(texts, vecs), start=1)
        ]
        kv.write_index(path, items, {"backend": "stub", "model": "stub",
                                     "dim": kv._STUB_DIM, "count": len(items),
                                     "data_layer": "full_archive"})
        kv.load_index.cache_clear()

    def test_write_then_search_ranks_shared_tokens_first(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "vec.json.gz"
            self._build(p, ["alpha beta gamma", "zeta eta theta",
                            "alpha beta delta"])
            res = kv.search("alpha beta", limit=3, path=str(p), backend="stub")
            self.assertFalse(res["degraded"])
            self.assertEqual(res["total_indexed"], 3)
            # top 命中应是与查询共享 token 的两条之一
            self.assertIn("alpha", res["results"][0]["preview"])
            # 指针与数据层标签在位（放指针不放本体 + 防 lesson #30）
            self.assertTrue(res["results"][0]["ref"])
            self.assertEqual(res["results"][0]["data_layer"], "full_archive")

    def test_results_deterministic(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "vec.json.gz"
            self._build(p, ["one two", "two three", "three four"])
            r1 = kv.search("two three", limit=3, path=str(p), backend="stub")
            kv.load_index.cache_clear()
            r2 = kv.search("two three", limit=3, path=str(p), backend="stub")
            self.assertEqual([x["ref"] for x in r1["results"]],
                             [x["ref"] for x in r2["results"]])


class TestGracefulDegrade(unittest.TestCase):
    def test_missing_index_degrades_not_raises(self):
        kv.load_index.cache_clear()
        res = kv.search("anything", path="/nonexistent/vec.json.gz",
                        backend="stub")
        self.assertTrue(res["degraded"])
        self.assertEqual(res["results"], [])
        self.assertIn("fallback", res)  # 指引调用方转 kb_search 白盒回退


class TestWriteDeterminism(unittest.TestCase):
    """同 rows 两次写出必须字节相同——否则索引入 git 会每次 CI 平白 churn。"""

    def test_same_rows_byte_identical(self):
        import tempfile
        vecs = kv.embed_stub(["one two", "three four", "five six"])
        items = [{"ref": f"s:{i}", "source": "discord", "date": f"d{i}",
                  "preview": p, "vec": v}
                 for i, (p, v) in enumerate(zip(["a", "b", "c"], vecs))]
        meta = {"backend": "stub", "model": "stub", "dim": kv._STUB_DIM,
                "count": 3, "data_layer": "full_archive"}
        with tempfile.TemporaryDirectory() as d:
            p1, p2 = Path(d) / "a.gz", Path(d) / "b.gz"
            kv.write_index(p1, items, meta)
            kv.write_index(p2, items, meta)
            self.assertEqual(p1.read_bytes(), p2.read_bytes())


class TestQueryEmbedDegrade(unittest.TestCase):
    """查询嵌入失败（运行时无 voyageai 包 / 无 VOYAGE_API_KEY）须就地降级、不抛穿。

    这是「有真 voyage 索引 + 运行时无 key」的真实降级场景——脊柱托底依赖此处
    不把异常穿透（§八 8.3）。用 monkeypatch 强制 embed 抛异常，确定性、零网络。
    """

    def _voyage_meta_index(self, path):
        # 模拟 CI 建的 voyage-backed 索引（meta.backend='voyage'），vec 用桩填充。
        vecs = kv.embed_stub(["msg one", "msg two"])
        items = [{"ref": f"discord:{i}", "source": "discord", "date": f"2026-01-0{i}",
                  "preview": t, "vec": v}
                 for i, (t, v) in enumerate(zip(["msg one", "msg two"], vecs), 1)]
        kv.write_index(path, items, {"backend": "voyage", "model": "voyage-3-lite",
                                     "dim": kv._STUB_DIM, "count": 2,
                                     "data_layer": "full_archive"})
        kv.load_index.cache_clear()

    def test_embed_failure_degrades_not_raises(self):
        import tempfile
        orig = kv.embed
        try:
            def boom(*a, **k):
                raise ImportError("No module named 'voyageai'")
            kv.embed = boom
            with tempfile.TemporaryDirectory() as d:
                p = Path(d) / "vec.json.gz"
                self._voyage_meta_index(p)
                # 索引后端=voyage → q_backend 默认取 meta 'voyage' → embed 抛 → 须降级
                res = kv.search("任何查询", path=str(p))
                self.assertTrue(res["degraded"])
                self.assertEqual(res["results"], [])
                self.assertIn("voyageai", res["reason"])
                self.assertIn("VOYAGE_API_KEY", res["reason"])
        finally:
            kv.embed = orig
            kv.load_index.cache_clear()


if __name__ == "__main__":
    unittest.main()
