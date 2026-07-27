"""直跑场景的路径引导——测试档目录知识的**唯一真相源**（T72，2026-07-27）。

## 为什么还需要它（pyproject 不是已经管了吗）

`pyproject.toml` 的 `[tool.pytest.ini_options] pythonpath` 只在 **pytest 驱动**时
生效。本仓 70 个测试档带 `if __name__ == "__main__"` 入口，`python tests/test_x.py`
直跑时 pytest 和 conftest 都不参与——那条路仍需要档内自报路径。

所以两条路各有其管道，谁也替不了谁：

    pytest tests/            → pyproject.toml pythonpath
    python tests/test_x.py   → 本模块（档首 `import _paths`）

## 它取代了什么

原先每个测试档自己写 1–3 行 `sys.path.insert(0, str(Path(__file__)...))`，全仓
127 处，且写法各异（`REPO /` vs `Path(__file__).resolve().parent.parent /`、字面量
vs 变量 vs for 循环）。**行数从来不是重点——重点是「三个源目录在哪」这件事被复述了
127 遍。** 2026-07-27 迁一次目录就漏改 8 处，而且全量测试照绿（pytest 共享
sys.path，先收集的档替后面的铺了路），直到逐档单跑才暴露。

现在移动目录只改这里一行。

## 用法

    import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

放在其他仓内 import 之前。导入即生效（副作用式），刻意不提供函数——需要显式调用
就又多了一个会被忘记的步骤。

小学生比喻：原先 127 个人各自默背仓库地址，搬一次家就得挨个通知，漏掉谁只有他
自己上门时才发现；现在地址只写在门口这块牌子上，搬家改一次。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

#: 与 pyproject.toml 的 `pythonpath` 保持一致——两条路径必须看到同一组目录，
#: 否则「pytest 绿而直跑挂」的老毛病会换个方向复发。
#: `"."`（仓库根）让 `from projects.news.scripts.x import ...` 这种包路径形态可解析，
#: mutmut 的 twin 测试靠它对齐运行时键与文件路径键（见 setup.cfg）。
SOURCE_DIRS = (
    ".",
    "scripts",
    "projects/news/scripts",
    "projects/wiki/scripts",
)

for _rel in SOURCE_DIRS:
    _abs = str((REPO / _rel).resolve())
    if _abs not in sys.path:
        sys.path.insert(0, _abs)
