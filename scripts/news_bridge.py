"""news_bridge.py — 顶层脚本层访问采集层模块的**唯一桥**（import-only 库）。

## 为什么需要一座桥

`archive_layout` 是**归档布局单一真相源**（P0-1，2026-07-02）：某源数据落在哪、
怎么找，全仓只有它回答。但它的物理位置在 `projects/news/scripts/`——隶属于 news
子项目，而它的消费者遍布全仓（实测 34 处：news 层 18、tests 9、**顶层 scripts 7**）。

Python 侧不是包（无 `pyproject.toml`、无 `__init__.py`），模块以裸 basename 互相
import，所以顶层脚本要用它就得先手工把 `projects/news/scripts` 塞进 `sys.path`。
那两行样板原先在 7 个顶层脚本里各抄了一份——抄本一多，「插哪个路径、用哪种写法
（`REPO /` vs `Path(__file__).resolve().parent.parent /`）」就开始各写各的，而任何
一处写错的表现都是**运行时才炸的 ImportError**，静态检查看不见。

本模块把那 7 份抄本收敛成 1 份：路径推导只有这里做一次，消费者写

    from news_bridge import archive_layout

## 为什么 re-export 整个模块，而不是逐个转发函数

转发清单会漂移——`archive_layout` 新增一个函数，桥若没跟上，消费者就以为「桥没有
就是没有」。整模块转发让桥**不可能落后于真相源**：桥只负责「能找到」，不负责
「有什么」。真相源的身份仍在 `archive_layout` 自己身上，本模块不是第二个真相源。

## 边界

本桥**只解决路径可达性**，不含任何归档逻辑。news 层内部（同目录）照旧直接
`import archive_layout`，不经本桥——同目录 import 零成本，绕道反而是多余的间接。
"""
from __future__ import annotations

import sys
from pathlib import Path

#: 采集层脚本目录（archive_layout / discord_compact 等的物理位置）。
NEWS_SCRIPTS = Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"

if str(NEWS_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(NEWS_SCRIPTS))

# 整模块 re-export（见上「为什么 re-export 整个模块」）。
import archive_layout  # noqa: E402,F401  归档布局单一真相源

__all__ = ["NEWS_SCRIPTS", "archive_layout"]
