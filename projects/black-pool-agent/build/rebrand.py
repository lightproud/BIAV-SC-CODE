#!/usr/bin/env python3
"""Black Pool（黑池）品牌换装补丁生成器（守密人 2026-08-02 需求 #1；2026-08-03 定名裁定）。

品牌与版本（守密人 2026-08-03 裁定）：品牌名**黑池（Black Pool）**，
`Hermes Agent` 对应 `Black Pool Agent`；发布版本号 **0.1.0**。

两版体系（同日裁定）：
- **公版（public）** = 纯品牌换装，不含内网/便携适配 → `patches/black-pool-rebrand.patch`
- **私有版（private）** = 公版之上叠加内网/便携适配层 → `patches/black-pool-intranet.patch`
  （自更新三入口封堵 / Billing / Cloud / Telegram 托管配对等云绑定面摘除）
组装台默认出私有版（两补丁依序应用）；只打第一张即公版。

定位：patches/ 里的补丁**不手写**——本脚本持有替换规则与排除谓词，
对 upstream/ 快照的临时副本做确定性变换，产出可审计的统一 diff。
移 pin 后重跑本脚本即重生成补丁，不存在「手改补丁追上游」的维护深渊。

红线（与施工边界文书裁 10 / MIT 一致，机械守卫 tests/test_hermes_charter.py）：
- LICENSE / 版权行 / 上游 URL / HERMES_* 环境变量名 / X-Client-Name 遥测头
  / 配置键 / 路径（~/.hermes）一律不碰——只换「用户感知的显示名」，
  不抹来源事实。
- upstream/ 本体零修改：补丁只在部署组装期应用（见 deploy/README.md），
  vendor 快照与官方测试基线保持逐字节纯净。

用法：
  python3 build/rebrand.py                    # 重生成两张补丁
  python3 build/rebrand.py --check            # 校验两张补丁与规则输出一致（漂移守卫）
  python3 build/rebrand.py --apply DEST                    # 应用私有版（公版+内网层）
  python3 build/rebrand.py --apply DEST --edition public   # 只应用公版
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUB = HERE.parent
UPSTREAM = SUB / "upstream"
PATCH_BRAND = SUB / "patches" / "black-pool-rebrand.patch"
PATCH_INTRANET = SUB / "patches" / "black-pool-intranet.patch"

BRAND = "Black Pool"
BRAND_AGENT = "Black Pool Agent"
BRAND_VERSION = "0.1.0"
UPSTREAM_VERSION = "0.20.1"  # 上游引擎版本（About 出身行静态渲染；移 pin 同步，哨兵守卫）
BRAND_AUMID = "com.biav.blackpool"


class RebrandError(Exception):
    """换装前置条件不成立——响亮失败，不做「尽力而为」的部分变换。"""


# 幂等哨兵（2026-08-04 守密人裁定「先修静默错打链」）：两层变换均**只能打在
# 未变换的树上**。规则表是全文 replace，重复应用会自食其果——
#   · 公版：About 出身行「基于 Hermes Agent 0.20.0 定制」是 MIT 归因唯一的 UI
#     承载面，第二遍被通用规则吃成「基于 Black Pool Agent」，来源事实当场蒸发；
#   · 私有版：价格表注入体自带锚点尾巴 `def get_pricing_entry(`，每重跑一遍
#     多套一层（实测 +66 行/遍，无上限）。
# 上游快照零出现这两个串，故用作「已换装」指纹；命中即拒绝整棵树。
BRAND_SENTINEL = BRAND_AGENT              # 公版换装后必现
INTRANET_SENTINEL = "_user_pricing_entry"  # 私有版注入体专名（公版树零出现）

# 锚点点火台账（2026-08-16 移 pin v2026.8.13 事故后加）：POST_RULES 是纯文本锚定替换，
# 上游改了被锚定的那块代码，`text.replace` 就静默 no-op——补丁少一个 hunk，
# `--check` 照样绿（它只比「补丁 == 规则输出」，不问「规则有没有匹配上」），
# 守卫照样绿，红要等 90 分钟后的组装线回归网才报。0.20.1 那次正是这样漏的：
# 上游把 `reportBackendContract(5)` 改成 `(6)`、onboarding 用例加了两行 Fireworks 断言，
# 两条测试对齐规则当场哑火，上游原用例留在树里、与「已静默/已摘折叠」的实现对不上，六红。
# 治法：每条规则至少要在全树命中一次，一条没命中即在生成期响亮失败。
_RULES_FIRED: set[tuple[str, int]] = set()

# 扫描范围：用户可感知的 runtime 面（白名单目录）。
# apps/（desktop 为内部主要消费面，守密人 2026-08-02 补充情报）与 web/（desktop
# 所包 UI）在列；website/docs 等纯站点面不扫（残留清单见 BRANDING.md）。
RUNTIME_DIRS = ["agent", "hermes_cli", "gateway", "tools", "plugins",
                "ui-tui/src", "apps", "web"]

# 裸词换装目录：display 密集面（UI / i18n / 桌面壳）。裸词 "Hermes" 以词边界
# 正则替换——`updateHermes`（i18n 键）/ `HermesClient`（类名）等标识符因前后
# 紧邻字母数字下划线而免疫；小写 `hermes`（npm 包名 / 路径 / scheme）从不触碰。
# 连字符同列免疫边界（2026-08-02 生产事故订正）：`X-Hermes-Session-Token` 是
# HTTP 头名（功能标识符），被换成含空格的品牌名即非法头名，
# desktop 全部设置页（Providers / Tools & Keys / Model）随之 ERR_INVALID_HTTP_TOKEN
# 崩加载。代价：德/荷式连字复合词（"Hermes-Plugins"）留在残留清单——保护优先于净度。
#
# agent/ 于 2026-08-05 入列（守密人「后端对话还有不少内容是 hermes」现场反馈，
# 分层铺开第一层）。此前裸词只扫前端三处，Python 后端一处没换——`Hermes Agent`
# 一类词组归 GENERIC_RULES 换掉了，单独的 `Hermes` 全留着，而**系统提示词就在
# agent/ 里**：「You are chatting inside the Hermes desktop app」「You are running
# in the Hermes terminal UI」这些直接进模型上下文，模型照着自述即冒出上游品牌；
# `prompt_builder.py` 的自述句更是前半已换、后半没换，一句话里两个名字打架。
# 入列前逐条核过 agent/ 的 399 处裸词：92 处在字符串字面量、其余为注释与
# docstring；字面量里仅两处短串，一为 MCP 工具描述兜底文案（该换），一为
# anthropic_adapter 的提示词消毒器条目（换了才对——它要消毒的正是新品牌名）。
# 功能面因此为零风险：无 HTTP 头名、无 `HERMES_` 环境变量（大写不匹配裸词）、
# 无 `.app`/`.exe` 产物路径（那些在 hermes_cli/，尚未入列）。
# 守卫见 tests/test_hermes_charter.py::test_bare_word_scope_safety。
# 下一层（hermes_cli / gateway / tools / plugins / skills）挂账未铺——那几处含
# 皮肤名 `Hermes Teal`、MCP server 名、桌面产物路径等真功能标识，需先定豁免名单。
BARE_WORD_DIRS = ("apps", "web", "ui-tui/src", "agent")
BARE_WORD_RE = re.compile(r"(?<![A-Za-z0-9_-])Hermes(?![A-Za-z0-9_-])")
# .html 在列（2026-08-02 补漏）：desktop/web/bootstrap-installer 的 <title> 是
# 任务栏 / Alt-Tab 显示名的实际来源（Electron 加载页面后 document.title 覆盖窗口题）。
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".sh", ".yaml", ".yml", ".json",
                 ".html", ".css"}  # .css 2026-08-03 补入：字体路径修复规则的载体

# ============================= 公版（品牌层） =============================

# 特例规则（先于通用规则与跳线谓词，整句替换）：
# 兜底身份句——SOUL.md 缺席时的产品自述。品牌换 Black Pool Agent；
# 「created by Nous Research」不保留在自述里（来源事实由 LICENSE 与
# 合规口径「基于 MIT 开源组件二次开发」承载，见文书裁 10）。
SPECIAL_RULES = [
    (
        "You are Hermes Agent, an intelligent AI assistant created by Nous Research. ",
        f"You are {BRAND_AGENT}, an intelligent AI assistant. ",
    ),
]

# 跳线谓词：含以下片段的行不做任何替换（保 URL / 环境变量 / 遥测 / 版权）。
LINE_SKIP_MARKERS = [
    "http://", "https://", "HERMES_", "X-Client-Name",
    "Copyright", "copyright", "SPDX-License-Identifier",
]

# 归属行豁免（守密人 2026-08-04 裁定「回退」）：plugins/**/plugin.yaml 的
# `author:` 是上游贡献者署名，其中两处为真实第三方姓名（fireworks / vertex
# 两个 provider 插件）。MIT 未要求改写署名，改了即等于把他人作品记到自己名下；
# 红线原则「只换用户感知的显示名、不抹来源事实」在此同样适用。整行跳过。
# 用锚定行首的正则而非子串 marker：避免误伤 `authorizeThere:` 一类正常文案。
ATTRIBUTION_LINE_RE = re.compile(r"^\s*(?:#\s*)?author\s*:", re.IGNORECASE)

# 通用规则（逐行、按序应用）。刻意不把裸词 "Hermes"/"hermes" 入规则——
# 那会波及模块名 / 路径 / 配置键（功能标识符），属 fork 级改动。
GENERIC_RULES = [
    ("Hermes Agent", BRAND_AGENT),
    ("Hermes profile", f"{BRAND} profile"),
    ("hermes-tui", "black-pool-tui"),
    # 全大写字标（2026-08-02 补漏）：desktop 对话空态 / bootstrap-installer 欢迎页
    # 的巨幅 wordmark 是 'HERMES AGENT'，大小写敏感的前三条全部漏网。
    ("HERMES AGENT", BRAND_AGENT.upper()),
]

# 公版后置全文规则（逐行规则之后对全文应用）：纯品牌一致性修复——
# 插入体里允许保留 "Hermes" 字样（来源事实陈述），不会被后续规则二次换装。
# 自定义价格表注入体（agent/usage_pricing.py，见内网层规则）
BLACK_POOL_PRICES_PY = '_USER_PRICES_CACHE: Optional[tuple] = None\n\n\ndef _load_user_price_table() -> dict:\n    """Intranet price injection: HERMES_HOME/model-prices.json (costs per million tokens).\n\n    Shape: {"models": {"<model-substring>": {"input": 4.0, "output": 12.0,\n    "cache_read": 0.4, "cache_write": 0}}}. Missing or invalid file -> {}\n    (silent; pricing falls through to upstream resolution).\n    """\n    global _USER_PRICES_CACHE\n    import json as _json\n    import os as _os\n\n    path = _os.path.join(\n        _os.environ.get("HERMES_HOME", _os.path.expanduser("~/.hermes")),\n        "model-prices.json",\n    )\n    try:\n        mtime = _os.path.getmtime(path)\n    except OSError:\n        return {}\n    if _USER_PRICES_CACHE and _USER_PRICES_CACHE[0] == mtime:\n        return _USER_PRICES_CACHE[1]\n    try:\n        with open(path, encoding="utf-8") as fh:\n            data = _json.load(fh)\n        models = data.get("models") or {}\n        if not isinstance(models, dict):\n            models = {}\n    except (OSError, ValueError):\n        models = {}\n    _USER_PRICES_CACHE = (mtime, models)\n    return models\n\n\ndef _user_pricing_entry(model_name: str) -> Optional[PricingEntry]:\n    table = _load_user_price_table()\n    if not table:\n        return None\n    name = (model_name or "").lower()\n    best = None\n    best_len = -1\n    for key, spec in table.items():\n        k = str(key).lower()\n        if (k == name or k in name) and len(k) > best_len and isinstance(spec, dict):\n            best, best_len = spec, len(k)\n    if best is None:\n        return None\n\n    def _d(value: Any) -> Optional[Decimal]:\n        try:\n            return Decimal(str(value)) if value is not None else None\n        except Exception:  # noqa: BLE001 - bad cell must not break pricing\n            return None\n\n    return PricingEntry(\n        input_cost_per_million=_d(best.get("input")),\n        output_cost_per_million=_d(best.get("output")),\n        cache_read_cost_per_million=_d(best.get("cache_read")),\n        cache_write_cost_per_million=_d(best.get("cache_write")),\n        source="user_override",\n        pricing_version="model-prices.json",\n    )\n\n\ndef get_pricing_entry('

# Black Pool 内建主题 TS 体（注入 themes/presets.ts，见下方配色规则）
BLACK_POOL_THEME_TS = """/** Black Pool（黑池）— 鎏金双貌：暖黑之金与纸白之金。
 *
 * 深色为默认外观（守密人 2026-08-05 裁定），darkColors 自 2026-08-03 配色裁定起未动。
 *
 * 浅色于 2026-08-05 整体重设计为「甲 · 纸白中性」（守密人自三方案中裁定）。此前两版
 * （2026-08-03 米白、2026-08-04 降饱和）都在同一个坑里：底 / 卡 / 墨全落在 44° 黄调，
 * 与金只剩明度差、没有色相差，于是金不凸显、整体发土——与 style-guide v3.0
 * 2026-07-12 对 #f7f3ea 的判词逐字相同，desktop 主题当时未跟上那次裁定。
 *
 * 甲案纪律：金以外的一切去黄提灰，金是画面唯一高饱和暖色。表面层退到中性灰白
 * （色相残留 40° 上下、感知色度贴近纸张），金三件改走深金以在近白底上挣得对比
 * （primary 4.8:1 / ring 3.8:1 / 墨 13.6:1 / 辅助 6.2:1，均对 background 测）。
 * 层级方向亦随之翻转：卡片 / 侧栏 / 状态栏由「比底亮」改为「比底暗」的凹面——
 * 底已近白，再往上抬无处可去，凹面才分得出层。 */
export const blackPoolTheme: DesktopTheme = {
  name: 'black-pool',
  label: 'Black Pool',
  description: '黑池金 — 暖黑与纸白双貌',
  colors: {
    background: '#FAF9F6',
    foreground: '#2B2A27',
    card: '#F1EFE9',
    cardForeground: '#2B2A27',
    muted: '#E9E6DE',
    mutedForeground: '#605D55',
    popover: '#F1EFE9',
    popoverForeground: '#2B2A27',
    primary: '#8C6A15',
    primaryForeground: '#FDFCF9',
    secondary: '#EDEBE4',
    secondaryForeground: '#3D3A33',
    accent: '#EAE7DF',
    accentForeground: '#8C6A15',
    border: '#DCDAD3',
    input: '#CFCCC3',
    ring: '#9A7A28',
    midground: '#9A7A28',
    composerRing: '#9A7A28',
    destructive: '#B4372E',
    destructiveForeground: '#FEF2F2',
    sidebarBackground: '#F1EFE9',
    sidebarBorder: '#DCDAD3',
    userBubble: '#E9E6DE',
    userBubbleBorder: '#D6D2C6'
  },
  darkColors: {
    background: '#171310',
    foreground: '#E9E0C9',
    card: '#1E1913',
    cardForeground: '#E9E0C9',
    muted: '#262015',
    mutedForeground: '#9C9074',
    popover: '#211B14',
    popoverForeground: '#E9E0C9',
    primary: '#D6B877',
    primaryForeground: '#241C07',
    secondary: '#2A2314',
    secondaryForeground: '#D9CDA8',
    accent: '#2E2716',
    accentForeground: '#E2D4A8',
    border: '#332B1A',
    input: '#2A2416',
    ring: '#D6B877',
    midground: '#D9B96A',
    composerRing: '#D6B877',
    destructive: '#C0473A',
    destructiveForeground: '#FEF2F2',
    sidebarBackground: '#120F0A',
    sidebarBorder: '#292214',
    userBubble: '#231D11',
    userBubbleBorder: '#3B3220'
  }
}

export const BUILTIN_THEMES: Record<string, DesktopTheme> = {
  'black-pool': blackPoolTheme,
  nous: nousTheme,"""

BRAND_POST_RULES = [
    # About 页出身声明 + 品牌版本号（守密人 2026-08-02 裁定「直接说明定制版本」；
    # 2026-08-03 裁定加发布版本号 0.1.0）：锚定 about-settings.tsx 版本行 JSX，
    # 上游版本取运行时 appVersion 动态渲染，移 pin 后无需改词。
    # About 版本区（守密人 2026-08-03 两问对齐裁定：标题维持 Black Pool Desktop、
    # 黑池版本为主）：主版本行渲染品牌版本 0.1.0（借 i18n version 模板各语种自适），
    # 上游版本只在出身行出现一次（动态渲染，移 pin 无需改词）。
    (
        "            {version?.appVersion ? a.version(version.appVersion)"
        " : a.versionUnavailable}\n          </p>\n",
        f"            {{a.version('{BRAND_VERSION}')}}\n          </p>\n"
        "          <p className=\"mt-1 text-xs text-muted-foreground\">\n"
        f"            {{'B.I.A.V. Studio 出品 · 基于 Hermes Agent {UPSTREAM_VERSION} 定制'}}\n"
        "          </p>\n",
    ),
    # APP_NAME 兜底统一：该行含 HERMES_ 被跳线保留，兜底值 'Hermes' 与已换装的
    # productName 分裂——electron userData 路径在 app.setName 前后按不同名字解析，
    # 绕过 launcher 直启 exe 时配置会写进两个目录（脑裂）。环境变量名原样保留。
    (
        "const APP_NAME = process.env.HERMES_DESKTOP_APP_NAME || 'Hermes'\n",
        f"const APP_NAME = process.env.HERMES_DESKTOP_APP_NAME || '{BRAND}'\n",
    ),
    # 钉钉 relay 默认名抑制加固：旧持久化配置里存的可能仍是换装前的
    # "Hermes Agent"，只比对新名会漏抑制、回复前缀泄漏旧品牌名。两名并收。
    (
        f'        if value == "{BRAND_AGENT}":\n'
        '            value = ""\n',
        f'        if value in ("{BRAND_AGENT}", "Hermes Agent"):\n'
        '            value = ""\n',
    ),
    # AUMID / appId 品牌中性化：com.nousresearch.hermes 全小写躲过裸词规则，
    # 无安装器部署时 Windows 通知设置会直接显示该原始串。两处成对同改。
    (
        "app.setAppUserModelId('com.nousresearch.hermes')",
        f"app.setAppUserModelId('{BRAND_AUMID}')",
    ),
    (
        '"appId": "com.nousresearch.hermes",',
        f'"appId": "{BRAND_AUMID}",',
    ),
    # 唤醒词帮助文案中性化：裸词规则会把 'Hey Hermes' 教成 'Hey <品牌名>'，
    # 但 openwakeword 声学模型只认 "hey hermes"——UI 教的短语对模型无效。
    # 改为不含短语的中性描述（桌面侧本就动态读真实短语渲染）。
    (
        f"toggle the 'Hey {BRAND}' wake word listener [on|off|status]",
        "toggle the wake word listener [on|off|status]",
    ),
    # CLI 响应面板残留品牌：'⚕ Hermes'（裸词 + hermes_cli 不在裸词目录）
    # 在 Rich Panel 标题直接可见。通用规则跑完后剩下的都是裸词形态，统一收尾。
    (
        "⚕ Hermes",
        f"⚕ {BRAND}",
    ),
    # Nous Portal 账号卡图标保持官方原版（守密人 2026-08-03 裁定）：
    # 品牌覆盖吃掉了 apple-touch-icon，而该卡表示的是对方服务——改用
    # 组装期预存的官方原版专名（见 overlay_assets）。
    (
        "<img alt=\"\" className=\"size-5 shrink-0 rounded\" src={assetPath('apple-touch-icon.png')} />",
        "<img alt=\"\" className=\"size-5 shrink-0 rounded\" src={assetPath('nous-portal-icon.png')} />",
    ),
    # featuredPitch 砍后半句（守密人 2026-08-03 两裁：先「别说是 Black Pool 推荐」、
    # 后「去掉后半段话就好」）：五语种统一只留「一个订阅，300+ 前沿模型」，
    # 推荐措辞整段不留。
    (
        "featuredPitch: 'One subscription, 300+ frontier models — the recommended way to run Black Pool',",
        "featuredPitch: 'One subscription, 300+ frontier models',",
    ),
    (
        "featuredPitch: '一个订阅，300+ 前沿模型 — 运行 Black Pool 的推荐方式',",
        "featuredPitch: '一个订阅，300+ 前沿模型',",
    ),
    (
        "featuredPitch: '一個訂閱，300+ 前沿模型 — 執行 Black Pool 的建議方式',",
        "featuredPitch: '一個訂閱，300+ 前沿模型',",
    ),
    (
        "featuredPitch: '1 つのサブスクリプションで 300 以上の最先端モデル — Black Pool を実行するための推奨方法',",
        "featuredPitch: '1 つのサブスクリプションで 300 以上の最先端モデル',",
    ),
    (
        "featuredPitch: 'اشتراك واحد، أكثر من 300 نموذج متقدم — الطريقة الموصى بها لتشغيل Black Pool',",
        "featuredPitch: 'اشتراك واحد، أكثر من 300 نموذج متقدم',",
    ),
    # 状态栏版本芯片显示黑池版本（守密人 2026-08-03「右下角版本号是 0.19.1」；
    # 与 About 同口径：黑池版本为主）。unknown 态判定沿用原 undefined 语义。
    (
        "      version: desktopVersion?.appVersion\n    })\n",
        f"      version: desktopVersion?.appVersion ? '{BRAND_VERSION}' : undefined\n    }})\n",
    ),
    # 产品版本一井换水（守密人 2026-08-03「还有很多地方是 0.19.1」）：托盘 /
    # 网关弹窗 / 状态栏 / About 主行全消费后端 hermes_cli.__version__——源头换成
    # 黑池版本，全桌面面自然归一。pyproject 刻意不动（uv sync --locked 校验会破）；
    # 上游真版本由 About 出身行静态陈述（UPSTREAM_VERSION 常量，移 pin 同步）。
    (
        f'__version__ = "{UPSTREAM_VERSION}"',
        f'__version__ = "{BRAND_VERSION}"',
    ),
    # 【勿再加「品牌字体路径修复」规则】2026-08-03 曾在此加一条把
    # url('../../../node_modules/…/Collapse-Bold.woff2') 改写成 '../node_modules/…' 的规则，
    # 判词是「本装配只在 apps/desktop 里 npm ci，故依赖在应用自己的 node_modules」——
    # 判词错，该规则本身就是字标回退无衬线的成因（2026-08-08 容器内实证）：
    # apps/desktop 无自己的 package-lock.json，`npm ci` 在此目录会被 npm 的 workspace
    # 检测上溯到仓根，整个 workspace 装进**仓根** node_modules，apps/desktop/node_modules
    # 只留一个 ignore 的去重例外。上游自己的 apps/desktop/scripts/assert-root-install.mjs
    # （校验 <仓根>/node_modules/vite 在位）即此事实的书面确认。故上游的 '../../../'
    # 本就正确，改成 '../' 反指向不存在的目录 → Vite 报
    # "didn't resolve at build time, it will remain unchanged" → 字体不进 dist/assets。
    # 不变量守卫：tests/test_hermes_charter.py::test_desktop_font_asset_path_matches_install_root
    # 默认配色方案（守密人 2026-08-03 裁定：对标黑池终端的鎏金双貌）：
    # 新增内建主题 black-pool（浅 = 金×米白 / 深 = 金×暖黑）并设为默认皮肤；
    # 上游六款主题保留可选。取色自守密人参考图。
    (
        "export const BUILTIN_THEMES: Record<string, DesktopTheme> = {\n  nous: nousTheme,",
        BLACK_POOL_THEME_TS,
    ),
    (
        "export const DEFAULT_SKIN_NAME = 'nous'",
        "export const DEFAULT_SKIN_NAME = 'black-pool'",
    ),
    # 默认语言简体中文（守密人 2026-08-03 裁定）：desktop 全局缺省 locale 单一
    # 真相源改 'zh'——无系统语言探测，配置未设时生效；用户已设语言不受影响。
    # 归基座层：公私两版同得简中缺省（语言偏好属产品定制，非内网适配）。
    #
    # 测试态钉回 'en'（守密人 2026-08-05 裁定「装配线接上 desktop 单测」的前置）：
    # 上游 4297 项单测按英文文案定位元素，缺省一改简中即有 128 项红在语种上——
    # 真回归会被这堆噪声淹没，等于白接。单测只该验行为、不该验界面语种，故让
    # 缺省在 MODE==='test' 时取 'en'。刻意用 import.meta.env 编译期常量而非
    # vitest.setup 的 vi.mock：mock 只换得掉常量、换不掉同模块的 normalizeLocale，
    # 两者当场撕裂（实测 i18n 自身 5 项因此转红）；编译期分支则恒自洽，
    # 且 vite 生产构建把它折成 'zh' 后摇树抹平，出厂产物里不留测试痕迹。
    (
        "export const DEFAULT_LOCALE: Locale = 'en'\n",
        "export const DEFAULT_LOCALE: Locale = import.meta.env.MODE === 'test' ? 'en' : 'zh'\n",
    ),
    # 默认语言真源头（2026-08-03 实机复盘：desktop 启动从后端取 display.language，
    # 其显式默认 "en" 压过前端 DEFAULT_LOCALE——改在真上游，CLI/网关静态文案一并简中；
    # 用户显式改过语言者不受影响）。
    (
        '        # Supported: en, zh, ja, de, es, fr, tr, uk.  Unknown values fall back to en.\n'
        '        "language": "en",\n',
        '        # Supported: en, zh, ja, de, es, fr, tr, uk.  Unknown values fall back to en.\n'
        '        "language": "zh",\n',
    ),
    # 默认皮肤真源头（守密人 2026-08-03「新部署没自动选黑池金」）：desktop 经
    # backend-sync 从后端 display.skin 取皮肤、盖过前端 DEFAULT_SKIN_NAME——后端默认
    # "default" 被推下来即回落 nous。改后端默认为 black-pool（desktop 有该内建主题，
    # 直接上金；CLI/TUI 无此皮肤名，load_skin 优雅回落 default 仅一条 warning，不崩）。
    (
        '        "skin": "default",',
        '        "skin": "black-pool",',
    ),
    # 默认深色（守密人 2026-08-05 裁定「默认配色要黑池金，深色」）：外观偏好未设时
    # 上游兜底 'light'，新部署因此开在浅色——而黑池金的立意是「暖黑之上金作点缀」，
    # 浅色只是备选貌。三处兜底一并改：normalizeMode（未设/脏值的唯一收口）、
    # ThemeContext 默认值（Provider 外的兜底）、无 window 时的首绘兜底。
    # 归基座层：公私两版同得（外观缺省属产品定制，非内网适配）。
    # 已显式选过浅色的用户不受影响——per-profile 偏好读到合法值即照旧。
    (
        "const normalizeMode = (value: string | null): ThemeMode =>\n"
        "  value === 'light' || value === 'dark' || value === 'system' ? value : 'light'\n",
        "const normalizeMode = (value: string | null): ThemeMode =>\n"
        "  value === 'light' || value === 'dark' || value === 'system' ? value : 'dark'\n",
    ),
    (
        "  theme: nousTheme,\n"
        "  themeName: DEFAULT_SKIN_NAME,\n"
        "  mode: 'light',\n"
        "  resolvedMode: 'light',\n"
        "  renderedMode: 'light',\n",
        "  theme: nousTheme,\n"
        "  themeName: DEFAULT_SKIN_NAME,\n"
        "  mode: 'dark',\n"
        "  resolvedMode: 'dark',\n"
        "  renderedMode: 'dark',\n",
    ),
    (
        "    typeof window === 'undefined' ? 'light' : modePref.resolve(readBootProfileKey())\n",
        "    typeof window === 'undefined' ? 'dark' : modePref.resolve(readBootProfileKey())\n",
    ),
    # 对应用例翻面：per-profile 契约测试把「缺省」参数化成 fallback，缺省一改它就红
    # （2026-08-05 实测：装配线新接的单测当场接住 2 项——这道网的第一次真实交付）。
    # `a` 同时从 'dark' 换成 'light'：它是「与缺省不同的显式值」，缺省占了 dark 之后
    # 必须让位，否则用例区分不出「显式设过」与「回落缺省」。
    (
        "  { name: 'mode', pref: modePref as unknown as Pref, fallback: 'light',"
        " a: 'dark', b: 'system', junk: 'dusk' }\n",
        "  { name: 'mode', pref: modePref as unknown as Pref, fallback: 'dark',"
        " a: 'light', b: 'system', junk: 'dusk' }\n",
    ),
    # 自述句归因口径归一（守密人 2026-08-05 裁定「by B.I.A.V. Studio」）：
    # SPECIAL_RULES 早有裁定——自述句不保留「created by Nous Research」（来源事实由
    # LICENSE 与合规口径「基于 MIT 开源组件二次开发」承载）。但那条只换掉了
    # 「You are Hermes Agent, ... created by Nous Research」一句，本句
    # 「You run on ... (by Nous Research)」漏网：模型自述产品出身时仍报上游母公司名，
    # 与 About 出身行 / CLI 面的口径对不上。锚点全树唯一（消毒器里的 "Nous Research"
    # 是另一处、刻意不动——它要把品牌名替成 Claude Code 以绕开服务端内容过滤）。
    (
        "You run on Black Pool Agent (by Nous Research). ",
        f"You run on {BRAND_AGENT} (by B.I.A.V. Studio). ",
    ),
    # 裸词换装的一处自伤（守密人 2026-08-05「装配线接上 desktop 单测」时暴露）：
    # windows-user-env 的用例喂给 mock 的注册表行含 `HERMES_HOME`，整行命中
    # LINE_SKIP_MARKERS 被跳过，值里的 `%DRIVE%\Hermes` 原样留着；而下面那句断言
    # 不含跳线标记，裸词规则照改不误——同一个用例的输入与期望就此对不上。
    # 这里测的是 `%VAR%` 展开逻辑，与品牌无关，故把期望改回与 mock 输入一致。
    (
        "  assert.equal(value, 'F:\\\\Black Pool')\n",
        "  assert.equal(value, 'F:\\\\Hermes')\n",
    ),
]

# ========================= 私有版（内网/便携适配层） =========================
# 云绑定面摘除与自更新封堵——公版不含，叠加于公版之上（守密人 2026-08-03
# 「无内网版视为公版，内网版补丁视为私有版」裁定）。
INTRANET_POST_RULES = [
    # About 自更新区整块隐藏（守密人 2026-08-02 裁定；与文书 §2.4「生产禁用
    # hermes update、更新只有换 tag 重测」同向）。{false && (<>...</>)} 包裹而非
    # 删除：对上游 diff 最小、移 pin 冲突面最小。哨兵防静默复活见守卫测试。
    (
        "      <div className=\"mx-auto mt-4 w-full max-w-2xl\">\n"
        "        <SectionHeading icon={RefreshCw} title={a.updates} />\n",
        "      <div className=\"mx-auto mt-4 w-full max-w-2xl\">\n"
        "        {/* 便携包生产禁用自更新（文书 §2.4）——About 隐藏该区（2026-08-02 裁定） */}\n"
        "        {false && (<>\n"
        "        <SectionHeading icon={RefreshCw} title={a.updates} />\n",
    ),
    (
        "          title={a.automaticUpdates}\n"
        "        />\n"
        "\n"
        "        <UninstallSection />\n",
        "          title={a.automaticUpdates}\n"
        "        />\n"
        "        </>)}\n"
        "\n"
        "        {/* 便携包无安装器——Danger zone 整区隐藏（守密人 2026-08-02 裁定） */}\n"
        "        {false && <UninstallSection />}\n",
    ),
    # 后台更新轮询整只 no-op：便携包更新通道 = 换 tag 重测（文书 §2.4），
    # 轮询（挂载 + 每 30 分钟 + 窗口聚焦）只会反复报「isn't a git checkout」。
    (
        "export function startUpdatePoller(): void {\n"
        "  if (pollerStarted || typeof window === 'undefined') {\n",
        "export function startUpdatePoller(): void {\n"
        "  // 便携包禁自更新（文书 §2.4）——后台轮询只产错误噪音，整只 no-op。\n"
        "  if (true as boolean) {\n"
        "    return\n"
        "  }\n"
        "\n"
        "  if (pollerStarted || typeof window === 'undefined') {\n",
    ),
    # Billing 入口隐藏：Hermes Cloud 订阅/额度页，内网便携包用自有 Providers，
    # 该页无对象。spread-空数组帘子，保留代码结构。
    (
        "      {\n"
        "        active: activeView === 'billing',\n"
        "        icon: BarChart3,\n"
        "        id: 'billing',\n"
        "        label: t.settings.nav.billing,\n"
        "        onSelect: () => setActiveView('billing')\n"
        "      },\n",
        "      // 内网便携包无 Hermes Cloud 订阅——Billing 入口隐藏（2026-08-02 审计轮）\n"
        "      ...(false\n"
        "        ? [\n"
        "            {\n"
        "              active: activeView === 'billing',\n"
        "              icon: BarChart3,\n"
        "              id: 'billing',\n"
        "              label: t.settings.nav.billing,\n"
        "              onSelect: () => setActiveView('billing')\n"
        "            }\n"
        "          ]\n"
        "        : []),\n",
    ),
    # hermes update 便携硬门禁：无 .git 的 win32 树本就是便携包形态，原 ZIP
    # 兜底会从公网拉未换装上游整树覆盖本地——字面撤销全部品牌补丁。文书 §2.4
    # 「生产禁用 hermes update」原本只有文档约束力，此处升格为代码门禁。
    (
        "    if not git_dir.exists():\n"
        '        if sys.platform == "win32":\n'
        "            use_zip_update = True\n",
        "    if not git_dir.exists():\n"
        '        if sys.platform == "win32":\n'
        "            # Portable bundle (no .git): self-update is disabled — the ZIP\n"
        "            # fallback would overwrite the tree with unbranded upstream.\n"
        '            print("\\u2717 Self-update is disabled in the portable bundle.")\n'
        '            print("  Update channel: replace the whole bundle with a new release zip.")\n'
        "            sys.exit(1)\n"
        "            use_zip_update = True\n",
    ),
    # Billing 深路由封死：入口帘子只遮了侧栏，?tab=billing 与计费故障自动
    # 跳转仍能整页打开 Nous Cloud 订阅页。从 SETTINGS_VIEWS 白名单摘除后
    # enum 路由参数直接拒收、回落默认页。
    (
        "  'notifications',\n  'billing',\n  'plugins',\n",
        "  'notifications',\n  'plugins',\n",
    ),
    # Help > Check for Updates 菜单整项摘除：三处自更新入口中最后一处未堵
    # 的（About 区已隐藏、后台轮询已 no-op），点击仍开完整更新覆盖层。
    (
        "  template.push({\n"
        "    label: 'Help',\n"
        "    role: 'help',\n"
        "    submenu: [checkForUpdatesItem]\n"
        "  })\n",
        "  // 便携包禁自更新——Help>Check for Updates 菜单整项摘除（审计轮二）\n",
    ),
    # Gateway Cloud 连接模式隐藏：卡片驱动 portal.nousresearch.com OAuth，
    # 内网无对象（与 Billing 同理）。
    (
        "          <ModeCard\n"
        "            active={state.mode === 'cloud'}\n"
        "            description={g.cloudDesc}\n"
        "            disabled={state.envOverride}\n"
        "            icon={Cloud}\n"
        "            onSelect={() => setState(current => ({ ...current, mode: 'cloud' }))}\n"
        "            title={g.cloudTitle}\n"
        "          />\n",
        "          {/* 内网无 Nous Cloud——Cloud 连接模式隐藏（审计轮二） */}\n"
        "          {false && (\n"
        "          <ModeCard\n"
        "            active={state.mode === 'cloud'}\n"
        "            description={g.cloudDesc}\n"
        "            disabled={state.envOverride}\n"
        "            icon={Cloud}\n"
        "            onSelect={() => setState(current => ({ ...current, mode: 'cloud' }))}\n"
        "            title={g.cloudTitle}\n"
        "          />\n"
        "          )}\n",
    ),
    # Telegram「Quick setup / Create with QR」列隐藏：托管 Bot 配对固定代理
    # Nous 自营 SaaS（setup.hermes-agent.nousresearch.com），内网必然打不通，
    # 却挂 recommended 徽标压过真正可用的 Manual setup。
    (
        '      <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-border">\n'
        '        <div className="grid content-start gap-3 sm:pr-4">\n',
        '      <div className="mt-4 grid gap-4">\n'
        "        {/* 内网无 Nous 托管 Bot SaaS——Quick setup 列隐藏（审计轮二） */}\n"
        '        {false && <div className="grid content-start gap-3 sm:pr-4">\n',
    ),
    (
        "          </Button>\n"
        "        </div>\n"
        "\n"
        '        <div className="grid content-start gap-3 border-t border-border pt-4 sm:border-t-0 sm:pl-4 sm:pt-0">\n',
        "          </Button>\n"
        "        </div>}\n"
        "\n"
        '        <div className="grid content-start gap-3">\n',
    ),
    # 首启服务商引导整环节跳过（守密人 2026-08-03 裁定「首次部署推荐肯定不合适」）：
    # 引导头牌是 Nous Portal 云订阅（内网无对象）。readCachedSkipped 只喂首启
    # 自动弹层（firstRunSkipped 初始态），恒真即「视同已点过稍后再选」；
    # 设置页手动配服务商走 manual 通道，不受影响。
    # 自定义模型价格表（守密人 2026-08-03「缺模型对应价格配置？」诊断确认后补机制）：
    # 上游定价只认公网模型/provider 自报，内网端点模型永无价、成本恒「—」。
    # 注入 HERMES_HOME/model-prices.json 读取口（最长子串匹配、每百万 token 四价、
    # 改档热生效、缺档静默回落上游）；单价真值内网侧填写，不进银芯。
    (
        "def get_pricing_entry(",
        BLACK_POOL_PRICES_PY,
    ),
    # ⚠ 锚点必须含签名尾「-> Optional[PricingEntry]」：函数体首两行在本档案出现 3 次
    # （get_pricing_entry / estimate_usage_cost / has_pricing 类布尔查询），引擎是全文
    # replace——裸体锚会把 return user_entry 注进返回 CostResult 的函数，调用方取
    # .amount_usd 即 AttributeError（2026-08-04 野战实证：BPA 每轮计费崩死）。
    (
        ") -> Optional[PricingEntry]:\n"
        "    route = resolve_billing_route(model_name, provider=provider, base_url=base_url)\n"
        '    if route.billing_mode == "subscription_included":\n',
        ") -> Optional[PricingEntry]:\n"
        "    user_entry = _user_pricing_entry(model_name)\n"
        "    if user_entry:\n"
        "        return user_entry\n"
        "    route = resolve_billing_route(model_name, provider=provider, base_url=base_url)\n"
        '    if route.billing_mode == "subscription_included":\n',
    ),
    # Nous Portal 卡去特殊化续两刀（守密人 2026-08-03「光效和图标都去掉」）：
    # 推荐光效边框整行删；卡上图标整行删（公版仍保官方图标——分层各表）。
    (
        '      <span aria-hidden className="arc-border arc-reverse arc-nous" />\n',
        "",
    ),
    (
        '          <img alt="" className="size-5 shrink-0 rounded" src={assetPath(\'nous-portal-icon.png\')} />\n',
        "",
    ),
    # 服务商列表默认全展开（守密人 2026-08-03「默认展开这一页所有选项」）：
    # 未持久化偏好时视为展开；用户点收起仍持久化为 '0' 得到尊重。
    (
        "    return window.localStorage.getItem(SHOW_ALL_KEY) === '1'\n",
        "    return window.localStorage.getItem(SHOW_ALL_KEY) !== '0'\n",
    ),
    # Nous Portal 推荐徽标摘除（守密人 2026-08-03 裁定「取消推荐 UI」）：
    # 内网无推荐位——未登录态不再挂「推荐」徽标，已连接标记保留。
    (
        "          {loggedIn ? (\n"
        "            <ConnectedTag />\n"
        "          ) : (\n"
        '            <span className="inline-flex items-center gap-1.5 bg-primary px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-primary-foreground">\n'
        '              <span aria-hidden="true" className="dither inline-block size-2 shrink-0" />\n'
        "              {t.onboarding.recommended}\n"
        "            </span>\n"
        "          )}\n",
        "          {/* 内网无推荐位——徽标摘除（审计轮三） */}\n"
        "          {loggedIn ? <ConnectedTag /> : null}\n",
    ),
    # 状态栏版本芯片点击不再开更新覆盖层（自更新入口第六、七处；便携包更新
    # 通道 = 换包）：client / backend 两枚芯片降为纯展示标签。
    #
    # 原实现只把 onSelect 换成空函数，却留着 variant: 'action' 与可点样式——
    # 芯片看着能点、按下去什么也不发生（守密人 2026-08-05 实机反馈「点了没反应」）。
    # 上游本就备了 'text' 变体作纯展示用（statusbar-controls.tsx 的渲染分支要求
    # variant === 'text' 且无 onSelect/to/href，且刻意不带 hover/transition），
    # 故整条删掉 onSelect 并改判 'text'：不可点即不再骗手，版本号照常显示。
    (
        "      onSelect: () => openUpdateOverlayFor('client'),\n"
        "      title: status.tooltip,\n"
        "      toggleLabel: copy.toggleVersion,\n"
        "      variant: 'action'\n",
        "      title: status.tooltip,\n"
        "      toggleLabel: copy.toggleVersion,\n"
        "      variant: 'text'\n",
    ),
    (
        "      onSelect: () => openUpdateOverlayFor('backend'),\n"
        "      title: status.tooltip,\n"
        "      toggleLabel: copy.toggleBackendVersion,\n"
        "      variant: 'action'\n",
        "      title: status.tooltip,\n"
        "      toggleLabel: copy.toggleBackendVersion,\n"
        "      variant: 'text'\n",
    ),
    # 上面两刀删掉了该文件仅有的两处 openUpdateOverlayFor 调用，import 随之悬空
    # （vite build 不跑 tsc 故不报，但 eslint 会，且留着即误导下一个读码的人）。
    (
        "  $updateStatus,\n"
        "  openUpdateOverlayFor\n"
        "} from '@/store/updates'\n",
        "  $updateStatus\n"
        "} from '@/store/updates'\n",
    ),
    # 后端契约横幅静默（守密人 2026-08-03 实机反馈「Backend out of date」）：
    # 便携包 desktop 与后端同树出包、契约恒配对，横幅只在连到旧后端残留进程时
    # 出现，而其「Update」按钮走 git 式更新在便携形态是坏路——整只静默；
    # 版本对齐唯一正道 = 整包替换（RUNBOOK 已载）。
    (
        "export function reportBackendContract(contract: number | undefined): void {\n"
        "  if ((contract ?? 0) >= REQUIRED_BACKEND_CONTRACT) {\n",
        "export function reportBackendContract(contract: number | undefined): void {\n"
        "  // 便携包版本随包恒配对，Update 按钮为坏路——契约横幅整只静默（审计轮三）\n"
        "  if (true as boolean) {\n"
        "    return\n"
        "  }\n"
        "\n"
        "  if ((contract ?? 0) >= REQUIRED_BACKEND_CONTRACT) {\n",
    ),
    # 本地安装卡隐藏（守密人 2026-08-03「安装默认地址还没品牌化」实机反馈）：
    # 真实安装路径是功能标识（小写 hermes 目录，红线不碰、显示造假更不可）；
    # 便携包后端随包自带，「本地安装」整卡无对象且会拉未换装上游——整卡摘除，
    # 路径行随卡消失；「连接到现有网关」保留。
    (
        '            </button>\n'
        '\n'
        '            <button\n'
        '              className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-4 text-left transition hover:bg-(--chrome-action-hover) disabled:cursor-wait disabled:opacity-60"\n'
        '              disabled={localStarting}\n',
        '            </button>\n'
        '\n'
        '            {/* 便携包后端随包自带——本地安装卡隐藏（审计轮三） */}\n'
        '            {false && (\n'
        '            <button\n'
        '              className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-4 text-left transition hover:bg-(--chrome-action-hover) disabled:cursor-wait disabled:opacity-60"\n'
        '              disabled={localStarting}\n',
    ),
    (
        '              <p className="mt-2 text-sm leading-5 text-muted-foreground">{copy.installLocalDesc}</p>\n'
        '            </button>\n'
        '          </div>\n',
        '              <p className="mt-2 text-sm leading-5 text-muted-foreground">{copy.installLocalDesc}</p>\n'
        '            </button>\n'
        '            )}\n'
        '          </div>\n',
    ),
    (
        '          <div className="mt-6 text-xs text-muted-foreground">\n'
        "            {copy.installTo}{' '}\n"
        '            <code className="font-mono text-(--ui-text-secondary)">{state.setupChoice.activeRoot}</code>\n'
        '          </div>\n',
        # 可选链非洁癖：上游这段的非空收窄来自外层 `{state.setupChoice && (`，
        # 而那个外层已被本层另一条规则 `{false && (` 死代码化——收窄一起没了，
        # 解引用却还在。运行时 `false &&` 短路不炸，但 tsc 照查死代码（TS18047），
        # 于是私有版 typecheck 长红、typecheck 也就没法接进装配线门禁。
        # 守密人 2026-08-05 裁定「现在修」。
        '          {false && <div className="mt-6 text-xs text-muted-foreground">\n'
        "            {copy.installTo}{' '}\n"
        '            <code className="font-mono text-(--ui-text-secondary)">{state.setupChoice?.activeRoot}</code>\n'
        '          </div>}\n',
    ),
    (
        "function readCachedSkipped(): boolean {\n"
        "  if (typeof window === 'undefined') {\n"
        "    return false\n"
        "  }\n",
        "function readCachedSkipped(): boolean {\n"
        "  // 内网私有版：首启引导跳过（服务商在设置页配）——审计轮三\n"
        "  if (true as boolean) {\n"
        "    return true\n"
        "  }\n"
        "\n"
        "  if (typeof window === 'undefined') {\n"
        "    return false\n"
        "  }\n",
    ),
    # ---- 单测期望对齐私有版行为（守密人 2026-08-05 裁定「接上，同时修齐测试期望」）----
    #
    # 以下规则改的是上游**测试文件**。原则：私有版故意关停的功能，其用例不删而是
    # 翻面成「收口哨兵」——上游验「该功能能用」，私有版验「该入口确已关掉」。这样
    # 关停被谁改回去都会当场红，比加豁免名单诚实（名单只会把新伤一起盖住）。
    #
    # 后台更新轮询三项（见本档「后台更新轮询整只 no-op」条）：上游分验挂载 /
    # 每 30 分钟 / 窗口聚焦各触发一次 checkUpdates，入口关停后一次也不该有。
    (
        "  it('calls checkUpdates() on startup so the version pill populates immediately', async () => {\n"
        "    startUpdatePoller()\n"
        "\n"
        "    // checkUpdates() is async — flush microtasks without advancing the 30-min interval.\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "\n"
        "    expect(checkMock).toHaveBeenCalled()\n"
        "    expect($updateStatus.get()?.behind).toBe(5)\n"
        "  })\n",
        "  it('never checks on startup: the portable edition disables self-update', async () => {\n"
        "    startUpdatePoller()\n"
        "\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "\n"
        "    expect(checkMock).not.toHaveBeenCalled()\n"
        "    expect($updateStatus.get()).toBeNull()\n"
        "  })\n",
    ),
    (
        "  it('calls checkUpdates() on each interval tick', async () => {\n"
        "    startUpdatePoller()\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "    checkMock.mockClear()\n"
        "\n"
        "    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)\n"
        "\n"
        "    expect(checkMock).toHaveBeenCalled()\n"
        "  })\n",
        "  it('never checks on an interval tick either', async () => {\n"
        "    startUpdatePoller()\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "    checkMock.mockClear()\n"
        "\n"
        "    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)\n"
        "\n"
        "    expect(checkMock).not.toHaveBeenCalled()\n"
        "  })\n",
    ),
    (
        "  it('calls checkUpdates() when the window regains focus', async () => {\n"
        "    startUpdatePoller()\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "    checkMock.mockClear()\n"
        "\n"
        "    // Invoke the registered focus handler directly (the mock window doesn't\n"
        "    // propagate DOM events, so call the stored listener).\n"
        "    listeners['focus']?.()\n"
        "\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "\n"
        "    expect(checkMock).toHaveBeenCalled()\n"
        "  })\n",
        "  it('registers no focus listener to check on, either', async () => {\n"
        "    startUpdatePoller()\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "    checkMock.mockClear()\n"
        "\n"
        "    // The no-op returns before the listener is ever registered, so there is\n"
        "    // nothing to invoke — the optional call is what proves it.\n"
        "    listeners['focus']?.()\n"
        "\n"
        "    await vi.advanceTimersByTimeAsync(0)\n"
        "\n"
        "    expect(listeners['focus']).toBeUndefined()\n"
        "    expect(checkMock).not.toHaveBeenCalled()\n"
        "  })\n",
    ),
    # 后端契约横幅五项（见本档「后端契约横幅静默」条）：上游逐一验落后即警告 /
    # 冷却 / 消警，整只静默后一次也不该弹。合并为一条哨兵，覆盖三种入参。
    (
        "  it('dismisses the toast when the backend meets the contract', () => {\n"
        "    reportBackendContract(6)\n"
        "    expect(dismissSpy).toHaveBeenCalledWith('backend-contract-skew')\n"
        "    expect(notifySpy).not.toHaveBeenCalled()\n"
        "  })\n"
        "\n"
        "  it('warns when the backend is behind (or reports no contract)', () => {\n"
        "    reportBackendContract(undefined)\n"
        "    expect(notifySpy).toHaveBeenCalledTimes(1)\n"
        "    reportBackendContract(1)\n"
        "    expect(notifySpy).toHaveBeenCalledTimes(2)\n"
        "  })\n"
        "\n"
        "  it('stays quiet on later session opens once the user closed it', () => {\n"
        "    reportBackendContract(1)\n"
        "    lastToast().onDismiss() // user closes it → cooldown starts\n"
        "    notifySpy.mockClear()\n"
        "\n"
        "    // Opening another pre-existing session re-runs the check within cooldown.\n"
        "    reportBackendContract(1)\n"
        "    expect(notifySpy).not.toHaveBeenCalled()\n"
        "  })\n"
        "\n"
        "  it('reminds again after the cooldown elapses', () => {\n"
        "    vi.useFakeTimers()\n"
        "    vi.setSystemTime(0)\n"
        "\n"
        "    reportBackendContract(1)\n"
        "    lastToast().onDismiss()\n"
        "    notifySpy.mockClear()\n"
        "\n"
        "    vi.setSystemTime(25 * 60 * 60 * 1000) // > 24h cooldown\n"
        "    reportBackendContract(1)\n"
        "    expect(notifySpy).toHaveBeenCalledTimes(1)\n"
        "  })\n"
        "\n"
        "  it('clears the snooze once the backend catches up, so a regression warns again', () => {\n"
        "    reportBackendContract(1)\n"
        "    lastToast().onDismiss()\n"
        "    notifySpy.mockClear()\n"
        "\n"
        "    reportBackendContract(6) // backend updated → satisfied, snooze cleared\n"
        "    reportBackendContract(5) // a later regression must warn immediately\n"
        "    expect(notifySpy).toHaveBeenCalledTimes(1)\n"
        "  })\n",
        "  it('never warns: the portable edition silences the contract banner', () => {\n"
        "    // Behind, ahead, and no-contract-at-all all take the early return.\n"
        "    reportBackendContract(5)\n"
        "    reportBackendContract(undefined)\n"
        "    reportBackendContract(1)\n"
        "\n"
        "    expect(notifySpy).not.toHaveBeenCalled()\n"
        "    expect(dismissSpy).not.toHaveBeenCalled()\n"
        "  })\n",
    ),
    # 首启本地安装四项 -> 一条哨兵（入口已隐藏，见上）。
    (
        "  it('continues local bootstrap only when Install Black Pool locally is selected', async () => {\n"
        '    const desktop = installDesktopMock(\n'
        '      bootstrapState({\n'
        "        setupChoice: { platform: 'win32', activeRoot: 'C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\hermes\\\\hermes-agent' }\n"
        '      })\n'
        '    )\n'
        '\n'
        '    render(<DesktopInstallOverlay />)\n'
        '\n'
        "    fireEvent.click(await screen.findByText('Install Black Pool locally'))\n"
        '\n'
        '    expect(desktop.continueBootstrapLocal).toHaveBeenCalledTimes(1)\n'
        "    expect(screen.getByText('Set up Black Pool Desktop')).toBeTruthy()\n"
        '\n'
        '    act(() => {\n'
        "      desktop.emitBootstrapEvent({ type: 'manifest', protocolVersion: 1, stages: [] })\n"
        '    })\n'
        '\n'
        "    await waitFor(() => expect(screen.queryByText('Set up Black Pool Desktop')).toBeNull())\n"
        '    expect(screen.getByText(/Fetching installer manifest/i)).toBeTruthy()\n'
        '  })\n'
        '\n'
        "  it('surfaces a recoverable error when the local-bootstrap bridge is unavailable', async () => {\n"
        '    const desktop = installDesktopMock(\n'
        '      bootstrapState({\n'
        "        setupChoice: { platform: 'win32', activeRoot: 'C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\hermes\\\\hermes-agent' }\n"
        '      })\n'
        '    )\n'
        '\n'
        '    desktop.continueBootstrapLocal = undefined as never\n'
        '    render(<DesktopInstallOverlay />)\n'
        '\n'
        "    const install = (await screen.findByText('Install Black Pool locally')).closest('button') as HTMLButtonElement\n"
        '    fireEvent.click(install)\n'
        '\n'
        '    expect(\n'
        "      await screen.findByText('Local installation could not start. Restart Black Pool Desktop and try again.')\n"
        '    ).toBeTruthy()\n'
        '    expect(install.disabled).toBe(false)\n'
        '  })\n'
        '\n'
        "  it('keeps the local-start error when the first snapshot commits under the click', async () => {\n"
        '    const desktop = installDesktopMock(\n'
        '      bootstrapState({\n'
        "        setupChoice: { platform: 'win32', activeRoot: 'C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\hermes\\\\hermes-agent' }\n"
        '      })\n'
        '    )\n'
        '\n'
        '    desktop.continueBootstrapLocal = undefined as never\n'
        '    render(<DesktopInstallOverlay />)\n'
        '\n'
        '    // Click the instant the choice paints, before React drains the passive\n'
        '    // effect that reacts to the first snapshot. A loaded runner hits this\n'
        '    // window by accident; observing the DOM directly hits it every time.\n'
        "    const install = (await whenPresent('Install Black Pool locally')).closest('button') as HTMLButtonElement\n"
        '    fireEvent.click(install)\n'
        '\n'
        '    await act(async () => {\n'
        '      await Promise.resolve()\n'
        '    })\n'
        '\n'
        "    expect(screen.queryByText('Local installation could not start. Restart Black Pool Desktop and try again.')).toBeTruthy()\n"
        '  })\n'
        '\n'
        "  it('clears a stale local-start error when a repair presents a different root', async () => {\n"
        '    const desktop = installDesktopMock(\n'
        '      bootstrapState({\n'
        "        setupChoice: { platform: 'win32', activeRoot: 'C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\hermes\\\\hermes-agent' }\n"
        '      })\n'
        '    )\n'
        '\n'
        '    desktop.continueBootstrapLocal = undefined as never\n'
        '    render(<DesktopInstallOverlay />)\n'
        '\n'
        "    fireEvent.click((await screen.findByText('Install Black Pool locally')).closest('button') as HTMLButtonElement)\n"
        '    expect(\n'
        "      await screen.findByText('Local installation could not start. Restart Black Pool Desktop and try again.')\n"
        '    ).toBeTruthy()\n'
        '\n'
        '    act(() => {\n'
        '      desktop.emitBootstrapEvent({\n'
        "        type: 'setup-choice',\n"
        '        active: false,\n'
        "        platform: 'win32',\n"
        "        activeRoot: 'C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\hermes\\\\hermes-agent-repaired'\n"
        '      })\n'
        '    })\n'
        '\n'
        "    expect(screen.queryByText('Local installation could not start. Restart Black Pool Desktop and try again.')).toBeNull()\n"
        '  })\n'
        '\n',
        '  // 便携包后端随包自带，首启的本地安装卡与安装路径行整块隐藏（见本档\n'
        '  // desktop-install-overlay 帘子条）。上游此处原有四项围绕本地 bootstrap 的用例\n'
        '  // （点击起装、桥缺失报错、快照抢跑保留错、修复换根清错），入口既已摘除即无从\n'
        '  // 触发——合并为一条收口哨兵：入口重新出现即说明隐藏被改回去了，那四项也该还原。\n'
        "  it('offers no local install entry: the portable edition ships its own backend', async () => {\n"
        '    installDesktopMock(\n'
        '      bootstrapState({\n'
        "        setupChoice: { platform: 'win32', activeRoot: 'C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\hermes\\\\hermes-agent' }\n"
        '      })\n'
        '    )\n'
        '\n'
        '    render(<DesktopInstallOverlay />)\n'
        '\n'
        "    expect(await screen.findByText('Set up Black Pool Desktop')).toBeTruthy()\n"
        "    expect(screen.queryByText('Install Black Pool locally')).toBeNull()\n"
        '  })\n'
        '\n',
    ),
    # 首启选择页只剩「连到已有后端」一张卡——标题与断言同步收缩。
    (
        "  it('shows the remote/local choice without installer progress', async () => {\n",
        "  it('shows the remote choice without installer progress', async () => {\n",
    ),
    (
        "    expect(screen.getByText('Connect to existing Black Pool')).toBeTruthy()\n"
        "    expect(screen.getByText('Install Black Pool locally')).toBeTruthy()\n",
        "    expect(screen.getByText('Connect to existing Black Pool')).toBeTruthy()\n",
    ),
    # 从远端连接表单返回后，落回的选择页同样只该剩远端那张卡。
    (
        "    expect(await screen.findByText('Set up Black Pool Desktop')).toBeTruthy()\n"
        "    expect(screen.getByText('Install Black Pool locally')).toBeTruthy()\n"
        "  })\n",
        "    expect(await screen.findByText('Set up Black Pool Desktop')).toBeTruthy()\n"
        "    expect(screen.getByText('Connect to existing Black Pool')).toBeTruthy()\n"
        "  })\n",
    ),
    # 首启服务商引导两项（见本档「推荐徽标摘除」「服务商列表默认全展开」两条）：
    # 内网无推荐位、也没有「先藏起来再让人点开」的道理，故徽标不该在、
    # 「Other providers」折叠钮不该在，而原本藏在折叠后的服务商应当直接可见。
    (
        "  it('features Nous Portal and hides other providers behind a disclosure', () => {\n",
        "  it('features Nous Portal with every provider listed up front', () => {\n",
    ),
    (
        "    expect(screen.getByText('Nous Portal')).toBeTruthy()\n"
        "    expect(screen.getByText('Recommended')).toBeTruthy()\n",
        "    expect(screen.getByText('Nous Portal')).toBeTruthy()\n"
        "    expect(screen.queryByText('Recommended')).toBeNull()\n",
    ),
    (
        # 0.20.1 起上游在折叠前后各加了一行 Fireworks 断言（原锚点只含 Anthropic 两行，
        # 失配后整条规则静默 no-op，上游原用例留在树里、与「已摘折叠」的实现对不上 →
        # 回归网六红。锚点必须跟着上游这块的真实形态走）。
        "    // Fireworks stays behind the disclosure with the other alternatives; only\n"
        "    // Nous Portal is visible before the user expands the list.\n"
        "    expect(screen.queryByText('Fireworks AI')).toBeNull()\n"
        "    expect(screen.queryByText('Anthropic API Key')).toBeNull()\n"
        "\n"
        "    fireEvent.click(screen.getByRole('button', { name: 'Other providers' }))\n"
        "\n"
        "    expect(screen.getByText('Fireworks AI')).toBeTruthy()\n"
        "    expect(screen.getByText('Anthropic API Key')).toBeTruthy()\n"
        "    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy()\n",
        "    // The portable edition drops the disclosure, so every alternative is\n"
        "    // listed up front — there is nothing left to expand.\n"
        "    expect(screen.getByText('Fireworks AI')).toBeTruthy()\n"
        "    expect(screen.getByText('Anthropic API Key')).toBeTruthy()\n"
        "    expect(screen.queryByRole('button', { name: 'Other providers' })).toBeNull()\n"
        "    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy()\n",
    ),
    (
        "    render(<Picker ctx={ctx} />)\n"
        "    fireEvent.click(screen.getByRole('button', { name: 'Other providers' }))\n",
        "    render(<Picker ctx={ctx} />)\n",
    ),
]

# 二进制品牌资产覆盖（公版层；图标是二进制，文本规则到不了）：
# 源在 build/brand-assets/（由 build/gen_brand_assets.py 从单一源图生成，
# 守密人换图 = 换源图重跑生成器再重生成补丁），覆盖进组装树的消费点。
# mac 的 assets/icon.icns 刻意不覆盖（便携包只出 win，残留清单见 BRANDING.md）。
ASSET_OVERLAYS = [
    ("icon.png", "apps/desktop/assets/icon.png"),          # electron-builder 图标基座
    ("icon.ico", "apps/desktop/assets/icon.ico"),          # win exe / 任务栏 / 托盘
    ("apple-touch-icon.png", "apps/desktop/public/apple-touch-icon.png"),  # 运行时窗口图标 + favicon
    ("brand-tile.jpg", "apps/desktop/public/nous-girl.jpg"),  # About 页 BrandMark 品牌位
]

# 文件级排除：测试 / LICENSE / 锁文件 / 文档。
def _skip_file(rel: Path) -> bool:
    s = rel.as_posix()
    name = rel.name
    if "LICENSE" in name or name.endswith((".md", ".lock", ".min.js")):
        return True
    if name in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock"):
        return True
    if "/tests/" in f"/{s}" or name.startswith("test_") or name.endswith("_test.py"):
        return True
    return rel.suffix not in TEXT_SUFFIXES


def transform_brand(text: str, bare_word: bool = False) -> str:
    """公版变换：品牌显示名换装 + 品牌一致性修复。"""
    for old, new in SPECIAL_RULES:
        text = text.replace(old, new)
    out_lines = []
    for line in text.splitlines(keepends=True):
        if any(m in line for m in LINE_SKIP_MARKERS) or ATTRIBUTION_LINE_RE.match(line):
            out_lines.append(line)
            continue
        for old, new in GENERIC_RULES:
            line = line.replace(old, new)
        if bare_word:
            line = BARE_WORD_RE.sub(BRAND, line)
        out_lines.append(line)
    text = "".join(out_lines)
    for i, (old, new) in enumerate(BRAND_POST_RULES):
        if old in text:
            _RULES_FIRED.add(("brand", i))
        text = text.replace(old, new)
    return text


def transform_intranet(text: str) -> str:
    """私有版叠加变换：内网/便携适配（在公版之后应用）。"""
    for i, (old, new) in enumerate(INTRANET_POST_RULES):
        if old in text:
            _RULES_FIRED.add(("intranet", i))
        text = text.replace(old, new)
    return text


def overlay_assets(root: Path) -> int:
    """把 build/brand-assets/ 的品牌二进制资产覆盖进组装树，返回覆盖文件数。"""
    src_dir = HERE / "brand-assets"
    replaced = 0
    # Nous Portal 账号卡保持官方原版图标（守密人 2026-08-03 裁定：那是对方服务，
    # 不戴我们的面具）：覆盖 apple-touch-icon 前先把上游原版存为专用名，
    # 卡片经公版规则改用之。
    orig = root / "apps" / "desktop" / "public" / "apple-touch-icon.png"
    keep = root / "apps" / "desktop" / "public" / "nous-portal-icon.png"
    if orig.is_file() and not keep.exists():
        shutil.copyfile(orig, keep)
        replaced += 1
    for src_name, dest_rel in ASSET_OVERLAYS:
        src = src_dir / src_name
        dest = root / dest_rel
        if not src.is_file():
            print(f"[warn] brand asset missing, skip: {src}", file=sys.stderr)
            continue
        if not dest.parent.is_dir():
            continue
        shutil.copyfile(src, dest)
        replaced += 1
    return replaced


def _walk_files(root: Path):
    for d in RUNTIME_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root)
            if _skip_file(rel):
                continue
            yield p, rel


def _find_sentinel(root: Path, marker: str) -> str | None:
    """在扫描范围内找「已变换」指纹，返回首个命中文件的相对路径。"""
    for p, rel in _walk_files(root):
        try:
            if marker in p.read_text(encoding="utf-8"):
                return rel.as_posix()
        except (UnicodeDecodeError, OSError):
            continue
    return None


def apply_brand_tree(root: Path) -> int:
    """对 root 就地应用公版（品牌层）变换 + 图标覆盖，返回改动文件数。

    前置：root 必须是**未换装**的树（幂等哨兵守卫，见 BRAND_SENTINEL）。
    """
    hit = _find_sentinel(root, BRAND_SENTINEL)
    if hit is not None:
        raise RebrandError(
            f"目标树已换过装（在 {hit} 命中 {BRAND_SENTINEL!r}）——重复应用会吃掉 "
            "About 出身行的 MIT 归因。请对未换装的干净树应用。"
        )
    changed = 0
    for p, rel in _walk_files(root):
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        bare = rel.as_posix().startswith(BARE_WORD_DIRS)
        new = transform_brand(text, bare_word=bare)
        if new != text:
            p.write_text(new, encoding="utf-8")
            changed += 1
    changed += overlay_assets(root)
    return changed


def apply_intranet_tree(root: Path) -> int:
    """对（已应用公版的）root 叠加私有版内网层变换，返回改动文件数。

    前置：root 必须尚未叠加内网层（幂等哨兵守卫，见 INTRANET_SENTINEL）。
    """
    hit = _find_sentinel(root, INTRANET_SENTINEL)
    if hit is not None:
        raise RebrandError(
            f"目标树已叠加内网层（在 {hit} 命中 {INTRANET_SENTINEL!r}）——"
            "重复应用会把价格表注入体逐层套娃。请对只打过公版的树应用。"
        )
    changed = 0
    for p, rel in _walk_files(root):
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        new = transform_intranet(text)
        if new != text:
            p.write_text(new, encoding="utf-8")
            changed += 1
    return changed


def generate_patches() -> tuple[str, str]:
    """在临时 git 仓里分两段变换，产出（公版, 私有版叠加）两张统一 diff。"""
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "w"
        shutil.copytree(UPSTREAM, work, symlinks=False,
                        ignore=shutil.ignore_patterns(".venv", "__pycache__"))
        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run(["git", "-C", str(work), *args],
                                  capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", check=True)
        run("init", "-q")
        run("config", "user.email", "rebrand@black-pool.local")
        run("config", "user.name", "rebrand")
        run("add", "-A")
        run("commit", "-qm", "pristine")
        n1 = apply_brand_tree(work)
        # --binary：图标类品牌资产覆盖以 GIT binary patch 形式入补丁，
        # git apply 路径与 --apply 路径保持效果等同（deploy/README.md 二选一承诺）。
        brand_diff = run("diff", "--binary").stdout
        run("add", "-A")
        run("commit", "-qm", "brand (public edition)")
        n2 = apply_intranet_tree(work)
        intranet_diff = run("diff", "--binary").stdout
        print(f"transformed files: brand={n1} intranet={n2}", file=sys.stderr)
        _assert_every_rule_fired()
        return brand_diff, intranet_diff


def _assert_every_rule_fired() -> None:
    """全树跑完后，每条 POST 规则都必须至少命中一次——否则响亮失败。

    只在**生成期**校验（两版都跑过全树）：`--apply --edition public` 只跑品牌层，
    内网规则本就不该点火，那里查会误报。

    失败即意味着上游改了该规则锚定的那块代码。处置不是删规则，是**按上游新形态重锚**
    （删规则等于悄悄丢掉一处内网适配 / 换装，比红着更坏）。
    """
    dead = []
    for kind, rules in (("brand", BRAND_POST_RULES), ("intranet", INTRANET_POST_RULES)):
        for i, (old, _new) in enumerate(rules):
            if (kind, i) not in _RULES_FIRED:
                probe = next((l.strip() for l in old.splitlines() if l.strip()), old[:60])
                dead.append(f"{kind}#{i}: {probe[:100]}")
    if dead:
        raise RebrandError(
            "以下规则的锚点在当前 upstream 快照上一次也没命中（上游改了那块代码，"
            "替换已静默失效）——按新形态重锚，不要删规则：\n  " + "\n  ".join(dead)
        )


def _validate_apply_dest(dest: Path) -> None:
    """`--apply DEST` 的前置校验：路径不存在 / 指错地方一律响亮失败。

    原实现只 resolve 不校验：目录不存在时 `_walk_files` 什么也不 yield，
    脚本照打「0 files changed」并 rc=0（2026-08-04 审视实证）——组装脚本据此
    判定「换装成功」，出厂即未换装包。
    """
    if not dest.is_dir():
        raise RebrandError(f"目标树不存在或不是目录: {dest}")
    # vendor 快照零修改（文书裁 10 红线）：DEST 落在 upstream/ 之内或之上都会
    # 就地改写 pin 的快照，逐字节纯净性当场破裂，且无声。
    if dest == UPSTREAM or UPSTREAM in dest.parents:
        raise RebrandError(
            f"拒绝就地改写 vendor 快照（upstream/ 本体零修改红线）: {dest}"
        )
    if dest in UPSTREAM.parents:
        raise RebrandError(
            f"DEST 是 upstream/ 的祖先目录，会连快照与扩展层一起改: {dest}"
        )
    if not [d for d in RUNTIME_DIRS if (dest / d).is_dir()]:
        raise RebrandError(
            f"不像 Hermes 源树（{RUNTIME_DIRS} 一个都不存在）: {dest}"
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", metavar="DEST")
    ap.add_argument("--edition", choices=["public", "private"], default="private",
                    help="--apply 时选版：public=仅品牌层（公版）；private=品牌+内网层（默认）")
    args = ap.parse_args()

    if args.apply:
        dest = Path(args.apply).resolve()
        try:
            _validate_apply_dest(dest)
            n = apply_brand_tree(dest)
            if args.edition == "private":
                n += apply_intranet_tree(dest)
            if n == 0:
                raise RebrandError(
                    f"变换零改动: {dest}——真实 Hermes 源树不可能一处不改，"
                    "多半指错了目录或树已被改过。"
                )
        except RebrandError as e:
            print(f"✗ {e}", file=sys.stderr)
            return 2
        print(f"applied {args.edition} edition to {args.apply}: {n} files changed")
        return 0

    brand_diff, intranet_diff = generate_patches()
    if args.check:
        ok = True
        for path, diff in ((PATCH_BRAND, brand_diff), (PATCH_INTRANET, intranet_diff)):
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            if current != diff:
                print(f"DRIFT: {path.name} 与规则输出不一致，"
                      "跑 python3 build/rebrand.py 重生成", file=sys.stderr)
                ok = False
        if ok:
            print("patches are in sync with rules")
        return 0 if ok else 1
    PATCH_BRAND.write_text(brand_diff, encoding="utf-8")
    PATCH_INTRANET.write_text(intranet_diff, encoding="utf-8")
    print(f"wrote {PATCH_BRAND} ({len(brand_diff.splitlines())} diff lines)")
    print(f"wrote {PATCH_INTRANET} ({len(intranet_diff.splitlines())} diff lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
