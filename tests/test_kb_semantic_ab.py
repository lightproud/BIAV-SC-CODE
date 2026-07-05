"""kb_semantic_ab（向量腿语义铁证 harness）的零网络回归。

真·语义胜负数字需 Voyage（CI，见 kb-semantic-proof.yml）；本档案用 **stub 后端**焊住
harness 的诚实性与管线契约，断言全部零网络、可复现（不触 Voyage）：

  1. **诚实性不变量（核心守门）**：黄金集对 grep / grep_strong / spine 三臂**恒 0 命中**——
     证明该集是「只有语义能赢」的公平测试（零共享 token + 概念脊柱到不了）。curator 若手滑
     写了与 target 共享 token 的 query，grep 臂立命中→本测试立红，逼其改真改写。
  2. **stub 赢不大**：stub=词法哈希袋（无语义），vector_exclusive_win_rate 只在 chance 附近、
     远够不到 Voyage 应有的高分——证「CI 里任何高胜率纯来自语义、非管线假象」。
  3. 管线确定性 + 字段齐 + rate∈[0,1]。
  4. 白盒 schema（每条出身牌 provenance + confirmed）+ §1.1-HC 防火墙（target 只来自
     公开社区档案，无黑池/内网路径）。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import kb_semantic_ab as sab


class TestGoldenSchemaAndFirewall(unittest.TestCase):
    def setUp(self):
        self.rows = sab.load_golden()

    def test_nonempty(self):
        self.assertGreaterEqual(len(self.rows), 5, "语义黄金集过小")

    def test_required_fields_and_provenance(self):
        for r in self.rows:
            for f in ("id", "query", "target_text", "target_ref", "capability"):
                self.assertIn(f, r, f"缺字段 {f}: {r.get('id')}")
            prov = r.get("provenance", {})
            self.assertIn("confirmed", prov, f"缺出身牌 confirmed: {r['id']}")
            self.assertIn("harvested_from", prov, f"缺出身牌 harvested_from: {r['id']}")

    def test_firewall_targets_from_public_archive_only(self):
        # §1.1-HC：target 只许来自公开社区档案；杜绝黑池/内网路径混入。
        BANNED = ("BIAV-BP", "black", "黑池", "svn", "qoder", "internal", "/intranet")
        for r in self.rows:
            ref = r.get("target_ref", "")
            self.assertTrue(ref.startswith(sab._ARCHIVE_PREFIX),
                            f"target_ref 越界（非公开社区档案）: {r['id']} → {ref}")
            low = (ref + " " + r.get("provenance", {}).get("harvested_from", "")).lower()
            for b in BANNED:
                self.assertNotIn(b.lower(), low, f"疑黑池/内网路径: {r['id']}")


class TestHonestyInvariant(unittest.TestCase):
    """核心守门：黄金集对 grep/grep_strong/spine 恒 0——只有语义能赢。"""

    def test_grep_and_spine_cannot_find(self):
        rep = sab.evaluate(backend="stub")
        self.assertEqual(rep["grep_hit_rate"], 0.0,
                         "grep 命中了 target → 黄金集有共享 token，非真改写")
        self.assertEqual(rep["grep_strong_hit_rate"], 0.0,
                         "最强 grep 命中了 target → 黄金集词法可达，非真改写")
        self.assertEqual(rep["spine_hit_rate"], 0.0,
                         "白盒脊柱（kb_activate 扩词）命中了 target → 非脊柱不可达题")


class TestStubNegativeControl(unittest.TestCase):
    """stub（词法袋、无语义）赢不大——证 CI 里的高胜率纯来自 Voyage 语义。"""

    def test_stub_win_rate_stays_low(self):
        rep = sab.evaluate(backend="stub")
        wr = rep["vector_exclusive_win_rate"]
        # stub 有 _STUB_DIM 哈希碰撞噪声（略高于 chance），但绝到不了语义级高分。
        # 用宽松上界证「无语义→赢不大」；真语义胜（CI voyage）应远超此。
        self.assertLess(wr, 0.6, f"stub 胜率 {wr} 过高——疑管线泄露词法/结构线索给向量臂")
        self.assertIn("chance_floor", rep)


class TestPipeline(unittest.TestCase):
    def test_fields_and_ranges(self):
        rep = sab.evaluate(backend="stub")
        for key in ("vector_hit_rate", "grep_hit_rate", "grep_strong_hit_rate",
                    "spine_hit_rate", "vector_exclusive_win_rate", "vector_mrr"):
            self.assertIn(key, rep)
            self.assertGreaterEqual(rep[key], 0.0)
            self.assertLessEqual(rep[key], 1.0)
        self.assertEqual(rep["corpus_size"],
                         len(sab.build_corpus(sab.load_golden())))

    def test_deterministic(self):
        r1 = sab.evaluate(backend="stub")
        r2 = sab.evaluate(backend="stub")
        self.assertEqual(r1["vector_exclusive_win_rate"], r2["vector_exclusive_win_rate"])
        self.assertEqual([p["id"] for p in r1["per_question"]],
                         [p["id"] for p in r2["per_question"]])


if __name__ == "__main__":
    unittest.main()
