"""专有名词热词桥:把银芯领域词典喂给转录后端,提高《忘却前夜》专名识别率。

数据源不自造——复用 scripts/silver_tokenizer.domain_dict()(72 唤醒体名/称号 +
卡牌术语 + 剧情单元 + 世界观固定词的自举集合),故仓库知识长、热词表跟着长。

三种消费口(按后端能力选):
- hotword_list():全量热词表,供支持「词表」的后端(如 FunASR 热词);
- bias_prompt(max_chars):按预算截断的偏置串,供 whisper 系 initial_prompt(约 224
  token 上限,故按字符预算优先塞高优先词);
- write_hotwords_file(dest):落 sherpa-onnx `hotwords_file`(中文每词空格分字,
  cjkchar 建模单元约定),供流式 sherpa 后端上下文热词(contextual biasing)。

优先级:世界观固定词 → 角色名/称号 → 其余词典词。口语里最常出现、最易被误识的
专名排前面,确保预算有限时先保住它们。全程确定性、零 ML。
"""
from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

# 世界观固定术语:口语最常出现且短、易误识,优先级最高(与 silver_tokenizer 第 4 组对齐)
WORLDVIEW_TERMS: tuple[str, ...] = (
    "忘却前夜", "意识潜游", "调查行动", "缸中之脑", "弥萨格大学", "弥萨格",
    "星辰篇", "忘却篇", "守密人", "唤醒体", "自动人偶", "至高意志", "特遣纪录",
)

_PURE_CJK = re.compile(r"^[一-鿿]{2,8}$")


@lru_cache(maxsize=1)
def _domain_terms() -> frozenset[str]:
    """借用 scripts/silver_tokenizer.domain_dict();不可用时回落世界观最小集(不崩)。"""
    scripts = REPO / "scripts"
    try:
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        from silver_tokenizer import domain_dict  # type: ignore

        terms, _ = domain_dict()
        return frozenset(terms)
    except Exception:
        return frozenset(WORLDVIEW_TERMS)


@lru_cache(maxsize=1)
def _character_names() -> tuple[str, ...]:
    """角色名 + 称号(第二优先级);读不到基线时回落空。"""
    cf = REPO / "projects/wiki/data/processed/characters.json"
    names: list[str] = []
    if cf.exists():
        try:
            for c in json.loads(cf.read_text(encoding="utf-8")).get("characters", []):
                for key in ("name", "title"):
                    s = (c.get(key) or "").strip()
                    if _PURE_CJK.match(s):
                        names.append(s)
        except Exception:
            pass
    return tuple(dict.fromkeys(names))  # 去重保序


@lru_cache(maxsize=1)
def hotword_list() -> list[str]:
    """全量热词表,按优先级去重保序:世界观 → 角色名 → 其余词典词(字典序)。"""
    ordered: list[str] = []
    seen: set[str] = set()

    def push(seq) -> None:
        for t in seq:
            if t and t not in seen:
                seen.add(t)
                ordered.append(t)

    push(WORLDVIEW_TERMS)
    push(_character_names())
    push(sorted(_domain_terms()))
    return ordered


def bias_prompt(max_chars: int = 200) -> str:
    """按字符预算把高优先热词打成 whisper 系 initial_prompt 偏置串。

    预算耗尽即停,保证高优先专名先入选。max_chars<=0 或无词时返回空串。
    """
    if max_chars <= 0:
        return ""
    picked: list[str] = []
    used = 0
    sep = "、"
    for t in hotword_list():
        add = len(t) + (len(sep) if picked else 0)
        if used + add > max_chars:
            break
        picked.append(t)
        used += add
    if not picked:
        return ""
    return "以下为可能出现的专有名词:" + sep.join(picked) + "。"


def sherpa_hotwords_lines(modeling_unit: str = "cjkchar") -> list[str]:
    """把专名转成 sherpa-onnx 热词文件的行。

    sherpa cjkchar 建模单元约定:每行一个热词,词内 token(汉字)以空格分隔,
    如「潘狄娅」→「潘 狄 娅」。含拉丁/数字的词按此简化实现仅切 CJK,故只收纯 CJK 词
    (与 hotword_list 的领域词典本就以纯 CJK 专名为主,拉丁词交给模型本身)。
    """
    if modeling_unit != "cjkchar":
        raise ValueError(f"暂只支持 modeling_unit=cjkchar,收到 {modeling_unit!r}")
    lines: list[str] = []
    for term in hotword_list():
        if _PURE_CJK.match(term):
            lines.append(" ".join(term))  # 逐字空格分隔
    return lines


def write_hotwords_file(dest, modeling_unit: str = "cjkchar"):
    """把热词落成 sherpa-onnx `hotwords_file`,返回 Path。确定性、零 ML,云端可测。"""
    from pathlib import Path as _Path

    dest = _Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    lines = sherpa_hotwords_lines(modeling_unit)
    dest.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return dest
