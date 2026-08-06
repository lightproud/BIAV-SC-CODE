"""黑池金浅色盘的配色红线守卫（memory/style-guide.md v3.0「浅底校验规则」机械化）。

为什么要这道守卫：浅色盘栽过两次。初版底 `#f7f3ea` 被守密人判「整体偏黄、金不凸显」，
2026-08-04 又做过一次「降饱和」——把黄调调淡，色相同源的病根没动，守密人 2026-08-05
判定仍不合格。两次都是靠肉眼发现的，而肉眼看不出「底色与金色色相同为 44°」这种结构问题。
v3.0 定稿把它化成了可算的判词：**金要凸显，靠的不是金更黄，而是其余一切去黄提灰**——
其余一切的饱和度必须压到金以下一个数量级，金是画面唯一高饱和暖色。那是能算的，于是算。

本守卫直接从 build/rebrand.py 的主题注入体解析色值，不留硬编码副本——改配色即被接住。
"""
import importlib.util
import math
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REBRAND = REPO / "projects" / "black-pool-agent" / "build" / "rebrand.py"

# 金三件承载品牌，饱和度纪律豁免的正是它们；destructive 是语义红，同样不在「去黄提灰」射程。
GOLD_KEYS = {"accentForeground", "composerRing", "midground", "primary", "ring"}
SEMANTIC_KEYS = {"destructive", "destructiveForeground"}
# 非金色色度上限。v3.0 原文写 <= 0.10；当前实现最大约 0.015，地板留在 0.05——
# 能接住「整片退回黄调」这类真实故障，又不会因为一次一两个点的微调就误报。
MAX_NEUTRAL_CHROMA = 0.05


def _load_rebrand():
    spec = importlib.util.spec_from_file_location("bpa_rebrand_palette", REBRAND)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_palette(ts_block: str, field: str) -> dict:
    """从主题 TS 注入体里抠出 colors / darkColors 的键值对。"""
    m = re.search(rf"\b{field}:\s*\{{(.*?)\n  \}}", ts_block, re.S)
    assert m, f"主题注入体里找不到 {field} 块"
    return dict(re.findall(r"(\w+):\s*'(#[0-9A-Fa-f]{6})'", m.group(1)))


def _hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(h):
    r, g, b = (_linear(c) for c in _hex_to_rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg, bg):
    lo, hi = sorted((_luminance(fg), _luminance(bg)))
    return (hi + 0.05) / (lo + 0.05)


def _chroma(h):
    """OKLCH 色度。用感知均匀空间而非 HSL——HSL 的 saturation 会把浅底的微黄算得虚高。"""
    r, g, b = (_linear(c) for c in _hex_to_rgb(h))
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return math.hypot(a, b2)


def _light():
    return _parse_palette(_load_rebrand().BLACK_POOL_THEME_TS, "colors")


def _dark():
    return _parse_palette(_load_rebrand().BLACK_POOL_THEME_TS, "darkColors")


def test_neutrals_stay_desaturated():
    """金以外的一切须去黄提灰——这是 v3.0 判词的可算形式，也是两次翻车的真因。"""
    light = _light()
    offenders = {
        k: round(_chroma(v), 4)
        for k, v in light.items()
        if k not in GOLD_KEYS and k not in SEMANTIC_KEYS and _chroma(v) > MAX_NEUTRAL_CHROMA
    }
    assert not offenders, (
        f"非金色饱和度超标（上限 {MAX_NEUTRAL_CHROMA}）：{offenders}。"
        "金要凸显靠的是其余一切去黄提灰，不是金更黄。"
    )


def test_gold_is_the_only_saturated_color():
    """金须是画面唯一高饱和暖色：最淡的金也要明显高过最艳的中性色。"""
    light = _light()
    weakest_gold = min(_chroma(light[k]) for k in GOLD_KEYS if k in light)
    strongest_neutral = max(
        _chroma(v) for k, v in light.items()
        if k not in GOLD_KEYS and k not in SEMANTIC_KEYS
    )
    assert weakest_gold > strongest_neutral * 3, (
        f"金与中性色的饱和度没拉开：最淡的金 {weakest_gold:.4f} vs "
        f"最艳的中性 {strongest_neutral:.4f}。金与底只剩明度差、没有色相差，正是旧盘的病。"
    )


def test_light_contrast_floors():
    """v3.0 浅底校验规则：正文 >= 7:1，标题/强调 >= 4.5:1，标签装饰 >= 3:1。"""
    light = _light()
    bg = light["background"]
    floors = {
        "accentForeground": 4.5,
        "destructive": 4.5,
        "foreground": 7.0,
        "midground": 3.0,
        "mutedForeground": 3.0,
        "primary": 4.5,
        "ring": 3.0,
        "secondaryForeground": 4.5,
    }
    bad = {
        k: (round(_contrast(light[k], bg), 2), floor)
        for k, floor in floors.items()
        if k in light and _contrast(light[k], bg) < floor
    }
    assert not bad, f"浅底对比度不达标 {{键: (实测, 地板)}}：{bad}"


def test_filled_surfaces_carry_readable_foregrounds():
    """填面色上的文字要能读。

    这项接住过一次真实错误：v3.0 的主金 #9A7A28 是给线条/标签的（地板 3:1），
    起初被误用作按钮填面底，只有 3.84:1，低于填面文字要的 4.5:1。深金才撑得起填面。
    """
    light = _light()
    for surface, fg in (("primary", "primaryForeground"), ("destructive", "destructiveForeground")):
        ratio = _contrast(light[fg], light[surface])
        assert ratio >= 4.5, f"{fg} 落在 {surface} 上只有 {ratio:.2f}:1，低于 4.5:1"


def test_elevation_direction_matches_each_mode():
    """两貌的层级方向刻意相反，且各有各的道理——不是笔误，所以分别钉死。

    深色：底够暗，卡片往亮里抬即为「浮起」。
    浅色（甲案）：底已近白，往上抬无处可去，只能靠比底暗的凹面分层。
    任一方向被改回去，界面的层次线索就会塌掉，故两条都要接住。
    """
    dark = _dark()
    assert _luminance(dark["card"]) > _luminance(dark["background"]), (
        "深色模式的 card 应亮于 background（凸面浮起）"
    )
    light = _light()
    assert _luminance(light["card"]) < _luminance(light["background"]), (
        "浅色模式的 card 应暗于 background（甲案凹面分层；底已近白，抬无可抬）"
    )


def test_dark_gold_is_lighter_than_light_gold():
    """深浅转换时金色角色互换：深底用亮金、浅底用深金。反了说明改动搞混了两貌。"""
    light, dark = _light(), _dark()
    assert _luminance(dark["primary"]) > _luminance(light["primary"]), (
        "深色模式的金应亮于浅色模式的金（深底亮金做标题、浅底深金做标题）"
    )
