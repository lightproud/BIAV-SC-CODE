"""KB 需求侧有效性回归测试（北极星评判体系 #1，黄金问题集）。

守密人 2026-07-04「如何追踪评判知识库是否有效」→ #1 黄金问题集。把「有效」锁成一个
每次可重跑的分数：对真实守密人风格问题跑检索原语，断言 hit@k ≥ 门槛（回归守卫）。

- 度量**需求侧有效性**（人要的够到没），区别于覆盖哨兵的供给侧完备（该有的上架没）。
- 门槛设在**诚实基线**（非虚 100%），检索质量退化即报错。
- 缺口（当前 miss）不隐藏——记分卡列出作改进目标（`python3 scripts/kb_eval.py`）。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_eval  # noqa: E402


def test_golden_set_is_nontrivial():
    golden = kb_eval.load_golden()
    assert len(golden["questions"]) >= 15, "黄金问题集过小，度量退化为噪声"
    # 每题结构完整
    for item in golden["questions"]:
        assert item.get("q") and item.get("expect"), f"问题缺 q/expect：{item}"


def test_demand_side_hit_rate_above_threshold():
    """需求侧命中率不得跌破诚实基线门槛（检索质量回归守卫）。"""
    rep = kb_eval.evaluate()
    misses = [p["q"] for p in rep["per_question"] if not p["hit"]]
    assert rep["hit_rate"] >= rep["min_hit_rate"], (
        f"KB 需求侧有效性退化：hit@{rep['k']}={rep['hit_rate']:.2f} < 门槛 {rep['min_hit_rate']:.2f}。"
        f"当前缺口：{misses}。跑 `python3 scripts/kb_eval.py` 看记分卡。"
    )


def test_distinctive_capability_hit_rate():
    """★ KB 独门能力（distinctive=true，grep 到不了）的命中率——这才是『KB 作用』的分数，
    定制化黄金集的核心断言：KB 在自己独占的维度上必须硬。"""
    rep = kb_eval.evaluate()
    d = rep["distinctive"]
    assert d["n"] >= 3, "distinctive 题过少，无法验证 KB 独门价值"
    assert d["hit_rate"] >= rep["min_distinctive_hit_rate"], (
        f"KB 独门价值退化：distinctive hit@{rep['k']}={d['hit_rate']:.2f} "
        f"< 门槛 {rep['min_distinctive_hit_rate']:.2f}（{d['hits']}/{d['n']}）"
    )


def test_every_question_capability_tagged():
    """定制化：每题必须标 capability（否则记分卡按能力分解退化）。"""
    golden = kb_eval.load_golden()
    untagged = [q["q"] for q in golden["questions"] if not q.get("capability")]
    assert untagged == [], f"未标 capability 的题：{untagged}"


def test_scorecard_shape():
    """评分器输出结构完整（供遥测/追踪消费）。"""
    rep = kb_eval.evaluate()
    assert set(rep) >= {"n", "k", "hits", "hit_rate", "mrr", "per_question"}
    assert rep["n"] == len(rep["per_question"])
    assert 0.0 <= rep["hit_rate"] <= 1.0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
