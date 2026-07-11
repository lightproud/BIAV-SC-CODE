"""kb_eval CLI 入口 / 记分卡渲染冒烟（评判体系 #1 的 main() 路径）。

核心打分逻辑已由 tests/test_kb_golden.py 覆盖；本档案只焊 main() 的两条出口：
人读记分卡（_print_scorecard）与机读 --json（per_question 剔除）。跑在真实仓库
索引（okf/kb_index.json）上，零网络、确定性。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_eval  # noqa: E402


def test_main_prints_scorecard(monkeypatch, capsys):
    """main() 默认路径：记分卡各节齐（总分 / distinctive / 按能力 / 逐题）。"""
    monkeypatch.setattr(sys, "argv", ["kb_eval.py"])
    kb_eval.main()
    out = capsys.readouterr().out
    assert "KB 有效性记分卡" in out
    assert "总 hit_rate" in out and "MRR" in out
    assert "distinctive" in out and "按能力：" in out
    # 逐题行有 OK/MISS 标记
    assert "[OK ]" in out or "[MISS]" in out


def test_main_json_omits_per_question(monkeypatch, capsys):
    """--json 机读路径：汇总字段齐、逐题明细剔除（供遥测/追踪消费）。"""
    monkeypatch.setattr(sys, "argv", ["kb_eval.py", "--json"])
    kb_eval.main()
    rep = json.loads(capsys.readouterr().out)
    assert "per_question" not in rep
    assert set(rep) >= {"n", "k", "hits", "hit_rate", "mrr",
                        "by_capability", "distinctive"}
    assert 0.0 <= rep["hit_rate"] <= 1.0
    assert rep["n"] >= 15  # 黄金集非平凡（与 test_kb_golden 同门槛）


def test_scorecard_lists_misses_as_gaps(capsys):
    """记分卡对 miss 题打「缺口」清单（不隐藏改进目标）；无 miss 时不打该节。"""
    rep = kb_eval.evaluate()
    kb_eval._print_scorecard(rep)
    out = capsys.readouterr().out
    misses = [p["q"] for p in rep["per_question"] if not p["hit"]]
    if misses:
        assert "缺口" in out and misses[0] in out
    else:
        assert "缺口" not in out


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
