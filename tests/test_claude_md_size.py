"""CLAUDE.md 体积封顶 —— 「路由器不许长成目录」。

CLAUDE.md **每会话强制加载**，它的长度直接从每个会话的上下文预算里扣。它自己 §5 开篇
就写着「本节是路由器，不是目录」（2026-07-05 守密人裁定，OKF 取代逐文件枚举）——本组
把那句自我要求从**自觉**变成**门禁**。

2026-07-26 实测 515 行，且当天又长了一节。上限设 550：给现状留 35 行余量，够写一节
新硬约束，不够把一份清单抄进来。撞线时的正确动作**不是抬上限**，而是把内容下沉到
`memory/` 或 OKF bundle 再留一行指针——抬上限等于承认路由器可以变目录。

同样封顶的还有两份**每次动手前必读**的子项目 CONTEXT：它们是 CLAUDE.md 的同类，
只是作用域小一层。
"""
from __future__ import annotations

from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

# {档案: (行数上限, 撞线时该往哪儿下沉)}
# 上限锚在**各自当前体量 + 约 30 行余量**，不是一个统一数字：设成低于现状会让 CI 当场
# 红在没人要求整理的内容上，那是拿门禁逼人加班，不是治理。余量够写一节新硬约束，
# 不够把一份清单抄进来——这正是要卡的那条线。
CAPS = {
    "CLAUDE.md": (550, "下沉到 memory/ 或 OKF bundle，正文只留一行指针"),
    # 2026-07-26 瘦身：472 → 138 行（发布编年史下沉 CHANGELOG）。上限随之从 500 收到
    # 200——**瘦完不收上限，等于给回涨预留了 360 行的空间**，那次瘦身也就白做了。
    "projects/silver-core-sdk/CONTEXT.md": (200, "发布叙述交给 CHANGELOG.md；设计理由进 docs/"),
    "projects/silver-core-maestro-sdk/CONTEXT.md": (200, "下沉到该包 docs/ 或 CHANGELOG"),
    # 2026-07-27 治理精简（守密人「全套」裁定）：1,123 → 477 行。SDK 一节独占 685 行
    # （全档 61%）的发布编年史下沉 `memory/archive/sdk-status-chronicle-20260727.md`，
    # 因为发布史的唯一权威本就是该包 CHANGELOG。它是**每会话要读的状态权威**——权威档
    # 不该是全仓最长的档。上限 520 给 43 行余量：够写一个新子项目节，不够再长回一部编年史。
    "memory/project-status.md": (520, "逐版叙述交给各包 CHANGELOG；历史轮次进 memory/archive/"),
}


@pytest.mark.parametrize("rel", sorted(CAPS))
def test_entry_docs_stay_under_cap(rel: str) -> None:
    cap, remedy = CAPS[rel]
    path = REPO / rel
    lines = len(path.read_text(encoding="utf-8").splitlines())
    assert lines <= cap, (
        f"{rel} {lines} 行，超上限 {cap}。**不要抬上限**——{remedy}。"
        f"（抬上限等于承认路由器可以变目录；上限本身的调整需守密人裁定）"
    )


def test_caps_target_files_that_exist() -> None:
    """上限清单里的死条目会让本组变成摆设——档案改名时必须同步。"""
    missing = sorted(rel for rel in CAPS if not (REPO / rel).exists())
    assert not missing, f"上限清单指向不存在的档案: {missing}"
