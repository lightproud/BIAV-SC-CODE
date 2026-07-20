"""KB vs 朴素 grep 反事实 A/B 回归（北极星评判体系 #3）。

守密人 2026-07-04 #3 反事实（检索层可确定性复现的那半；LLM 答题反事实见人工协议）。
断言两条：
1. **KB 不得劣于朴素 grep**（同语料同目标）——否则 KB 的检索机器没挣到自己的位置。
2. **联想题上 KB 严格胜 grep**——KB 的价值不在关键词（那维度和 grep 打平），在 grep
   结构上到不了的 token 脱节联想召回；此断言把「OKF ≠ 搜索」锁成数据事实。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import kb_ab  # noqa: E402


def test_kb_not_worse_than_grep():
    rep = kb_ab.ab_evaluate()
    assert rep["kb_hit_rate"] >= rep["grep_hit_rate"], (
        f"KB 检索劣于朴素 grep（KB={rep['kb_hit_rate']:.2f} < grep={rep['grep_hit_rate']:.2f}）"
        "——结构化检索没挣到位置，查 `python3 scripts/kb_ab.py`"
    )


def test_kb_strictly_wins_on_associative():
    """联想（activate）题上 KB 命中严格多于 grep——grep 无从遍历 token 脱节的边。"""
    rep = kb_ab.ab_evaluate()
    act = rep["by_mode"].get("activate")
    assert act and act["n"] >= 2, "联想题样本过少，无法验证 KB 结构优势"
    assert act["kb"] > act["grep"], (
        f"联想题上 KB 未胜 grep（KB={act['kb']} ≤ grep={act['grep']}）——"
        "KB 的结构价值（扩散激活/遍历）未体现"
    )


def test_kb_wins_associative_even_vs_strongest_grep():
    """反稻草人：即便把 grep 放到最强（整串短语+标题字段+TF），联想题上 KB 仍严格胜——
    证明 KB 的优势是**结构**（顺边遍历），非拿弱基线凑出来的。"""
    rep = kb_ab.ab_evaluate()
    act = rep["by_mode"].get("activate")
    assert act and act["n"] >= 2, "联想题样本过少"
    assert act["kb"] > act["grep_strong"], (
        f"联想题上 KB 未胜最强 grep（KB={act['kb']} ≤ strong={act['grep_strong']}）——"
        "KB 的结构优势疑为弱基线假象，查 `python3 scripts/kb_ab.py`"
    )


def test_ab_shape():
    rep = kb_ab.ab_evaluate()
    assert set(rep) >= {"kb_hit_rate", "grep_hit_rate", "grep_strong_hit_rate",
                        "delta", "delta_strong", "verdicts", "by_mode"}
    assert sum(rep["verdicts"].values()) == rep["n"]


# ---------- CLI 入口 / 报告渲染冒烟（main + _print） ----------

def test_main_prints_ab_table(monkeypatch, capsys):
    """main() 默认路径：A/B 对照表各节齐（三臂命中率 / 裁决 / 分模式）。"""
    monkeypatch.setattr(sys, "argv", ["kb_ab.py"])
    kb_ab.main()
    out = capsys.readouterr().out
    assert "KB vs grep 反事实 A/B" in out
    assert "grep 朴素" in out and "grep 最强" in out
    assert "裁决" in out and "分模式" in out
    # 联想模式行带结构差距注解
    assert "联想/结构题，grep 无从遍历" in out


def test_main_json_omits_per_question(monkeypatch, capsys):
    """--json 机读路径：汇总字段齐、逐题明细剔除。"""
    import json

    monkeypatch.setattr(sys, "argv", ["kb_ab.py", "--json"])
    kb_ab.main()
    rep = json.loads(capsys.readouterr().out)
    assert "per_question" not in rep
    assert set(rep) >= {"kb_hit_rate", "grep_hit_rate", "grep_strong_hit_rate",
                        "delta", "delta_strong", "verdicts", "by_mode"}
    assert sum(rep["verdicts"].values()) == rep["n"]


def test_print_lists_kb_exclusive_wins(capsys):
    """_print 对 KB 独胜题打清单（grep 做不到的那些）；无独胜时不打该节。"""
    rep = kb_ab.ab_evaluate()
    kb_ab._print(rep)
    out = capsys.readouterr().out
    wins = [p["q"] for p in rep["per_question"] if p["verdict"] == "KB_win"]
    if wins:
        assert "KB 独胜" in out and wins[0] in out
    else:
        assert "KB 独胜" not in out


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
