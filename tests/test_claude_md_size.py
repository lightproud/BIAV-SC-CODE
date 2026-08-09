"""入口档体积封顶 —— 「路由器不许长成目录」。

CLAUDE.md **每会话强制加载**，它的体积直接从每个会话的上下文预算里扣。它自己 §5 开篇
就写着「本节是路由器，不是目录」（2026-07-05 守密人裁定，OKF 取代逐文件枚举）——本组
把那句自我要求从**自觉**变成**门禁**。

同样封顶的还有两份**每次动手前必读**的子项目 CONTEXT，以及**状态唯一权威**
`memory/project-status.md`：它们是 CLAUDE.md 的同类，只是作用域小一层。

## 度量为何是「字符」而不是「行」（守密人 2026-08-08 裁定，覆盖 07-26 初版）

初版按**行数**封顶，2026-08-08 核账发现该度量与它想防的成本**脱钩**：上下文预算扣的是
token，而一行能装 53 个字也能装 478 个字——实测四档字符/行在 53–478 间浮动 **9 倍**，
不受行数约束的 `memory/todo.md` 更长到 478 字符/行（一行将近一页）。于是行数上限唯一
确定的效果，是让**行变长**：受限的 `silver-core-sdk/CONTEXT.md` 字符/行是同类档的 2.3 倍。

更直接的实证：当日一次 4 行 → 1 行的压缩里，真正因「合并行」省下的只有几个 `> ` 前缀
和换行符（约 10 字符），其余降幅全靠**删信息**。也就是说，同一份内容只要不换行就能过关。
字符度量对换行与否**天然免疫**，堵的正是这个洞。

诚实边界：字符数仍是 token 的**近似**而非精确计数（精确计数要引 tokenizer 依赖，且各模型
口径不一）。它不精确，但它与真实成本**同向**——这已经比行数强，而行数是**正交**的。

## 上限怎么定

锚在**各自当日实测字符数 + 约 18% 余量**，取整到 500 的倍数，不是一个统一数字：设成低于
现状会让 CI 当场红在没人要求整理的内容上，那是拿门禁逼人加班，不是治理。

余量为何从初版的「约 30 行」放宽到 18%：初版余量实测**撑不过两周**——`project-status.md`
2026-07-27 瘦到 477 行、上限设 520（余 43 行），到 08-08 已吃光，且 git 记录显示它
**连续 4 次改动恰好停在 520**，即连着 4 个会话撞墙后各自挪腾。余量归零后，门禁奖励的
是「把自己新写的三行挤成一行」（成本低），而不是「把旧内容读懂、判断该沉去哪、改好指针」
（成本高）——**与设计意图相反**，且把治理成本转嫁给了完全无关的会话。

撞线时的正确动作**仍然不是抬上限**，而是把内容下沉到 `memory/` 或 OKF bundle 再留一行
指针——抬上限等于承认路由器可以变目录。上限本身的调整需守密人裁定。
"""
from __future__ import annotations

import warnings
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

# 余量剩下不足这个比例时打印警告（但不判红）：让撞线**可预见**，
# 而不是突袭下一个碰这份档的无关会话——那正是行数版的病灶。
WARN_THRESHOLD = 0.10

# {档案: (字符上限, 撞线时该往哪儿下沉)}
# 上限 = 2026-08-08 实测字符数 + 约 18%，取整到 500 的倍数。
CAPS = {
    # 实测 31,589 字符（547 行）
    "CLAUDE.md": (37_500, "下沉到 memory/ 或 OKF bundle，正文只留一行指针"),
    # 2026-07-26 瘦身：472 → 138 行（发布编年史下沉 CHANGELOG）。实测 23,271 字符。
    # **瘦完不收上限，等于给回涨预留空间**，那次瘦身也就白做了。
    "projects/silver-core-sdk/CONTEXT.md": (27_500, "发布叙述交给 CHANGELOG.md；设计理由进 docs/"),
    # 实测 10,531 字符
    "projects/silver-core-maestro-sdk/CONTEXT.md": (12_500, "下沉到该包 docs/ 或 CHANGELOG"),
    # 2026-07-27 治理精简（守密人「全套」裁定）：1,123 → 477 行。SDK 一节独占 685 行
    # （全档 61%）的发布编年史下沉 `memory/archive/sdk-status-chronicle-20260727.md`，
    # 因为发布史的唯一权威本就是该包 CHANGELOG。它是**每会话要读的状态权威**——权威档
    # 不该是全仓最长的档。实测 47,084 字符（**比每会话强制加载的 CLAUDE.md 还大 49%**，
    # 而它并非每会话加载；这处比例失衡记档待日后一并整理）。
    "memory/project-status.md": (56_000, "逐版叙述交给各包 CHANGELOG；历史轮次进 memory/archive/"),
}


@pytest.mark.parametrize("rel", sorted(CAPS))
def test_entry_docs_stay_under_cap(rel: str) -> None:
    cap, remedy = CAPS[rel]
    path = REPO / rel
    size = len(path.read_text(encoding="utf-8"))
    assert size <= cap, (
        f"{rel} {size:,} 字符，超上限 {cap:,}。**不要抬上限**——{remedy}。"
        f"（抬上限等于承认路由器可以变目录；上限本身的调整需守密人裁定）"
    )
    headroom = (cap - size) / cap
    if headroom < WARN_THRESHOLD:
        warnings.warn(
            f"{rel} 余量仅剩 {headroom:.1%}（{cap - size:,} / {cap:,} 字符）——"
            f"该整理了：{remedy}。趁早下沉，别等撞线时突袭无关会话。",
            stacklevel=2,
        )


def test_caps_target_files_that_exist() -> None:
    """上限清单里的死条目会让本组变成摆设——档案改名时必须同步。"""
    missing = sorted(rel for rel in CAPS if not (REPO / rel).exists())
    assert not missing, f"上限清单指向不存在的档案: {missing}"


def test_every_capped_doc_currently_has_room() -> None:
    """本组自身的健全性：上限设定当日，四档必须都还有余量。

    设成低于现状会让 CI 红在没人要求整理的内容上；本例把那条自我要求也钉死，
    防止日后有人把上限往下调却忘了先做瘦身——**门禁不该由它自己制造红灯**。
    """
    stuck = {
        rel: (len((REPO / rel).read_text(encoding="utf-8")), cap)
        for rel, (cap, _) in CAPS.items()
        if len((REPO / rel).read_text(encoding="utf-8")) > cap
    }
    assert not stuck, f"上限低于现状，门禁在自造红灯: {stuck}"
