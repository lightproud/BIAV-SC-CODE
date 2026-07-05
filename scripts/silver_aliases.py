"""silver_aliases.py — 厚锚别名侧表读取层（import-only 库）。

§八 8.2 节 6「厚锚词表 AI 自动识别」的银芯参照实现（守密人 2026-07-05 裁定 chunk3）。
侧表本体在 ``projects/wiki/data/processed/aliases.json``（sibling，不改 characters.json），
每条守三墙：出身牌（provenance）+ 可单条撤回 + 惰性确认态（confirmed）。

消费方与权重规则（「未确认压权重」的落地形状）：
  - ``silver_tokenizer.domain_dict``：只吸收 **confirmed 且纯 CJK** 别名（FMM 整词
    只对 CJK 有意义；混合英数拿不到整词切分，claim 收窄为「纯 CJK 已确认别名」）。
  - ``build_okf_bundle.build_graph``：只用 **confirmed** 别名建 mention 边（未确认
    别名不进白盒骨架——错认别名不能污染图）。
  - ``kb_anchor.anchor_expand``：confirmed 别名作扩词；未确认别名只随锚返回、标记
    ``confirmed: false`` 供 LLM 自行掂量，不进扩词集。

防御（必做）：侧表**缺失 / 空 / 损坏一律优雅返空**——本模块被 build bundle 与
tokenizer 在构建期 import，侧表建前或损坏时绝不能炸穿。

本模块**无 __main__**（import-only 部件）；写入 / 确认 / 撤回走
``scripts/extract_aliases.py`` CLI。
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ALIASES_PATH = REPO / "projects" / "wiki" / "data" / "processed" / "aliases.json"

_PURE_CJK = re.compile(r"^[一-鿿]{2,8}$")


@lru_cache(maxsize=2)
def _load_cached(path_str: str) -> tuple:
    p = Path(path_str)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ()
    rows = data.get("aliases", [])
    if not isinstance(rows, list):
        return ()
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        alias = (r.get("alias") or "").strip()
        cid = str(r.get("concept_id") or "").strip()
        if alias and cid:
            out.append(r)
    return tuple(out)


def load(path: Path | str | None = None) -> list[dict]:
    """全部别名条目（含未确认）。缺失 / 空 / 损坏 → 空列表，绝不抛。"""
    return list(_load_cached(str(path or ALIASES_PATH)))


def confirmed(path: Path | str | None = None) -> list[dict]:
    """仅已确认条目（进白盒：domain_dict / mention 边）。"""
    return [r for r in load(path) if r.get("confirmed") is True]


def confirmed_cjk_aliases(path: Path | str | None = None) -> list[str]:
    """confirmed 且纯 CJK（2-8 字）的别名串——domain_dict 唯一吸收面。"""
    return [r["alias"] for r in confirmed(path) if _PURE_CJK.match(r["alias"])]


def alias_map(confirmed_only: bool = True,
              path: Path | str | None = None) -> dict[str, str]:
    """{alias: concept_id} 映射。默认只含已确认（mention 边消费面）。"""
    rows = confirmed(path) if confirmed_only else load(path)
    return {r["alias"]: str(r["concept_id"]) for r in rows}


def aliases_for(concept_id: str, include_unconfirmed: bool = False,
                path: Path | str | None = None) -> list[dict]:
    """某角色的别名条目（{alias, confirmed} 摘要），供锚附带别名返回。"""
    cid = str(concept_id)
    out = []
    for r in load(path):
        if str(r["concept_id"]) != cid:
            continue
        if not include_unconfirmed and r.get("confirmed") is not True:
            continue
        out.append({"alias": r["alias"], "confirmed": bool(r.get("confirmed"))})
    return out


def cache_clear() -> None:
    """测试 / 写侧表后清缓存。"""
    _load_cached.cache_clear()
