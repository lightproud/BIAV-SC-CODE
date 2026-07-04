"""图驱动黄金集回归（评判 #1 扩容）。

守密人 2026-07-04「黄金集数量太少」→ 从图自动生成（边即真值）。断言：规模够大、distinctive
够多、且**在规模上稳稳复现 KB vs grep 的差距**（联想题 grep 结构上塌，非 4 道的噪声）。

诚实注：生成的联想题对 KB 是「送分题」（activate 顺边走必中），故本集测的是**grep-gap 与覆盖
在规模上稳不稳**，非刁难 KB；真难题靠遥测零命中回流（评判 #2）。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_golden_gen as gen  # noqa: E402


def test_generator_scales_the_set():
    g = gen.generate()
    qs = g["questions"]
    assert len(qs) >= 150, f"生成题量偏少（{len(qs)}）——生成器疑退化"
    dist = sum(1 for q in qs if q["distinctive"])
    assert dist >= 80, f"distinctive 题偏少（{dist}）——应远超手写的个位数"
    # 每题结构完整 + 已标能力
    for q in qs:
        assert q.get("q") and q.get("expect") and q.get("capability")


def test_generated_grep_gap_holds_at_scale():
    """规模化反事实：联想题上 grep 结构上塌、KB 远胜（Δ 大且稳）。"""
    import kb_ab

    g = gen.generate()
    ab = kb_ab.ab_evaluate(g)
    assert ab["delta"] >= 0.30, f"规模化 Δ 偏小（{ab['delta']}）——grep-gap 未复现"
    act = ab["by_mode"].get("activate")
    assert act and act["n"] >= 50, "联想题样本不足以统计"
    # 联想题上 KB 命中率应远高于 grep（grep 在 token 脱节题上近乎 0）
    assert act["kb"] >= 3 * max(act["grep"], 1), (
        f"联想题 KB 未压倒 grep（KB={act['kb']} grep={act['grep']}）"
    )


def test_generated_kb_reaches_own_structure():
    """KB 在自生成题上命中高（送分题：activate 顺边走应基本全中）——生成/索引未断裂的健全性。"""
    import kb_eval

    g = gen.generate()
    ev = kb_eval.evaluate(g)
    assert ev["distinctive"]["hit_rate"] >= 0.90, (
        f"KB 自生成 distinctive 命中偏低（{ev['distinctive']['hit_rate']}）——图/索引/activate 疑断裂"
    )


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
