"""test_claude_md_dates.py —— 裁定日期跨档对账哨兵（思路 B）

背景：CLAUDE.md 大量嵌死「守密人 YYYY-MM-DD 裁定」式引用，与 memory/decisions.md /
decisions-archive.md 是两套人工台账，靠人记得双向同步。CLAUDE.md §5.3 定了仲裁规则
「冲突以日期新者为准并双向同步」，但全凭人肉，迟早漂移。本哨兵把「同步」从承诺变成保障：

  从 CLAUDE.md 抽出所有「裁定类」日期引用（日期近旁带 裁定/裁决/采纳 等决策语义关键词），
  校验每个日期在 decisions.md ∪ decisions-archive.md 文本里能找到同名日期（该裁定有据可查）。
  找不到 = 「悬空裁定引用」，fail。

边界（与既有哨兵分工）：
  - tests/test_claude_md.py 管「CLAUDE.md 引用的路径是否存在」；
  - scripts/check_decisions_consistency.py 管「decisions 层内部硬不变量」；
  - 本哨兵管「CLAUDE.md ↔ decisions 的裁定日期跨档对账」，不重叠。

误报控制：CLAUDE.md 里很多日期是阶段窗口（Phase 2「2026-04-27 → 07-19」）、版本日期
（OKF v0.1 2026-06-12）、退役时点、量能断崖（2026-02/03）、lesson 引用等，不对应一条决策。
只校验「裁定类」（靠日期近旁关键词区分）。残余误报走 ALLOWLIST 豁免。

纯标准库：unittest + pathlib + re。
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLAUDE_MD = ROOT / "CLAUDE.md"
DECISIONS = ROOT / "memory" / "decisions.md"
ARCHIVE = ROOT / "memory" / "decisions-archive.md"

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

# 「裁定类」判定：日期近旁（前后各 RADIUS 字窗口）出现以下任一关键词，即视为引用了一条决策。
# 「裁定/裁决」是守密人下达决策的标准动词；「采纳」用于「XX 采纳」式（卡帕西原则、信息分类法则等）。
# 「定性」收 2026-06-21「守密人定性」采集三层这类。
RULING_KEYWORDS = ("裁定", "裁决", "采纳", "定性")
# 关键词相对日期的搜索半径（字符）。守密人修饰词通常在日期前（「守密人 2026-06-11 裁定」），
# 关键词在日期后；两侧都给窗口，覆盖「2026-04-26 起」式后置与「守密人 X 裁定」式跨日期。
# 取 20 是为容下「YYYY-MM-DD 守密人裁定」这类日期与关键词间夹了修饰词的形态
#（RADIUS=12 会漏掉「2026-06-15 守密人裁定整层清空」——实测过的真实漏报）。
RADIUS = 20

# 豁免清单：确属裁定语义但「按设计」或「按权限」不在 decisions 台账逐字落同名日期的情形。
# 每条必须写明理由——空 allowlist 是目标，任何新增都得是经核实的「哨兵已知盲区」而非「懒得修」。
# 形态：{ "YYYY-MM-DD": "豁免理由" }
ALLOWLIST = {
    # 真实跨档漂移（哨兵 2026-06-21 首跑抓出）：CLAUDE.md §1.4 与 project-status.md 均载
    # 「2026-06-15 守密人裁定整层清空 wiki 结构化层」，但 decisions.md ∪ decisions-archive.md
    # 零命中——该裁定从未落进决策台账。补录 decisions 属守密人专属权限（CLAUDE.md §3.1
    # 「修改决策档案仅守密人权限」），艾瑞卡无权代劳，故暂豁免并上报，待守密人补台账后移除本条。
    "2026-06-15": "decisions 台账缺录(真实漂移)；补录属守密人权限 §3.1，已上报待裁，补后移除",
}


def _ledger_text():
    parts = []
    for p in (DECISIONS, ARCHIVE):
        if p.exists():
            parts.append(p.read_text(encoding="utf-8"))
    return "\n".join(parts)


def ruling_dates():
    """抽出 CLAUDE.md 中「裁定类」日期引用（去重）。

    判定：日期 match 的前后 RADIUS 字窗口内出现任一 RULING_KEYWORDS。
    """
    text = CLAUDE_MD.read_text(encoding="utf-8")
    found = set()
    for m in DATE_RE.finditer(text):
        lo = max(0, m.start() - RADIUS)
        hi = min(len(text), m.end() + RADIUS)
        window = text[lo:hi]
        if any(k in window for k in RULING_KEYWORDS):
            found.add(m.group(0))
    return found


class TestClaudeMdRulingDates(unittest.TestCase):
    def test_extraction_not_empty(self):
        """抽取逻辑别退化成空集——空集会让对账校验永远通过，等于哨兵失效。"""
        dates = ruling_dates()
        self.assertGreaterEqual(
            len(dates), 4,
            f"裁定日期抽取疑似失效（仅 {len(dates)} 条），关键词/正则可能被改坏",
        )

    def test_no_dangling_ruling_dates(self):
        """每个裁定日期都应在 decisions.md ∪ decisions-archive.md 里有据可查。"""
        ledger = _ledger_text()
        self.assertTrue(ledger, "决策台账为空或缺失，无法对账")

        dangling = sorted(
            d for d in ruling_dates()
            if d not in ALLOWLIST and d not in ledger
        )
        self.assertEqual(
            dangling, [],
            "CLAUDE.md 含悬空裁定引用（日期在决策台账里查无此条，疑跨档漂移）："
            f"{dangling}。修法：在 decisions.md/decisions-archive.md 补录该裁定，"
            "或经核实后加入 ALLOWLIST（须写理由）。",
        )


if __name__ == "__main__":
    unittest.main()
