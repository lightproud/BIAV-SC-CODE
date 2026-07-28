"""顶层脚本层 → 采集层的**唯一桥**守卫（结构审视 P4，2026-07-27）。

`archive_layout` 是归档布局单一真相源，物理位置却在 `projects/news/scripts/`。
顶层脚本要用它，就得先把那个目录塞进 `sys.path`——那两行样板原先在 7 个顶层脚本
里各抄了一份，写法还各不相同（`REPO /` vs `Path(__file__).resolve().parent.parent /`）。

抄本的失效方式很难看：路径写错不会被任何静态检查抓到，只在运行时炸 ImportError，
而这些脚本多半跑在 cron CI 里——炸了没人当场看见。收敛成 `scripts/news_bridge.py`
一处之后，本档负责让抄本回不来。

小学生比喻：全班去同一个仓库取工具，原先每人自己画一张路线图；现在门口挂了一张
公用地图，本档就是那个不许再自己画图的班规。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
BRIDGE = SCRIPTS / "news_bridge.py"

#: 桥自己当然要注入采集层路径——它就是干这个的。
_EXEMPT = {"news_bridge.py"}

#: 「把采集层目录塞进 sys.path」的各种手写形态。
_NEWS_PATH_RE = re.compile(
    r"""sys\.path\.(?:insert|append)\([^)]*?["']?projects["']?\s*[/,]\s*["']?news""",
    re.VERBOSE,
)


def _top_level_scripts() -> list[Path]:
    return sorted(p for p in SCRIPTS.glob("*.py") if p.name not in _EXEMPT)


def test_bridge_exists_and_reexports_the_ssot() -> None:
    """桥必须存在，且转发的是整个模块而非一份会漂移的函数清单。"""
    assert BRIDGE.exists(), "scripts/news_bridge.py 是顶层→采集层的唯一桥，不可删"
    src = BRIDGE.read_text(encoding="utf-8")
    assert "import archive_layout" in src, "桥必须 re-export archive_layout 整模块"
    assert "__all__" in src and "archive_layout" in src


def test_no_top_level_script_hand_rolls_the_news_path() -> None:
    """顶层脚本一律经桥取采集层，不得自己拼 sys.path。

    再出现一份手写注入，就等于把 P4 收敛掉的抄本请了回来。
    """
    offenders = [
        p.name
        for p in _top_level_scripts()
        if _NEWS_PATH_RE.search(p.read_text(encoding="utf-8"))
    ]
    assert not offenders, (
        "以下顶层脚本自行注入了采集层路径，请改用 `from news_bridge import archive_layout`："
        f"{offenders}"
    )


def test_no_top_level_script_imports_archive_layout_directly() -> None:
    """裸 `import archive_layout` 只有在路径已被别处注入时才碰巧能跑——那种
    「碰巧」正是桥要消灭的东西。"""
    offenders = []
    for p in _top_level_scripts():
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Import) and any(
                    a.name == "archive_layout" for a in node.names)) or (isinstance(node, ast.ImportFrom) and node.module == "archive_layout"):
                offenders.append(p.name)
    assert not offenders, (
        f"以下顶层脚本直接 import archive_layout，请改经 news_bridge：{sorted(set(offenders))}"
    )


def test_bridge_resolves_the_real_ssot() -> None:
    """桥交付的必须是采集层那一份真身，不是同名的第二份实现。"""
    import sys

    sys.path.insert(0, str(SCRIPTS))
    from news_bridge import archive_layout  # noqa: PLC0415

    expected = REPO / "projects" / "news" / "scripts" / "archive_layout.py"
    assert Path(archive_layout.__file__).resolve() == expected.resolve()
    # 真相源的招牌函数还在（桥没有变成一个空壳）。
    assert hasattr(archive_layout, "community_root")


def test_news_layer_does_not_route_through_the_bridge() -> None:
    """采集层内部是同目录 import，绕道经桥只是多余的间接——边界写在桥的文档里，
    这里把它钉成可执行的。"""
    news = REPO / "projects" / "news" / "scripts"
    offenders = [
        p.name for p in sorted(news.glob("*.py")) if "news_bridge" in p.read_text(encoding="utf-8")
    ]
    assert not offenders, f"采集层不应经桥自取（同目录直接 import 即可）：{offenders}"
