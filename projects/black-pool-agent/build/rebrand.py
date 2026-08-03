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
BRAND_AUMID = "com.biav.blackpool"

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
BARE_WORD_DIRS = ("apps", "web", "ui-tui/src")
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
BLACK_POOL_THEME_TS = """/** Black Pool（黑池）— 鎏金双貌：暖黑之金与米白之金（守密人 2026-08-03 配色裁定）。 */
export const blackPoolTheme: DesktopTheme = {
  name: 'black-pool',
  label: 'Black Pool',
  description: '黑池金 — 暖黑与米白双貌',
  colors: {
    background: '#F7F1E1',
    foreground: '#332B18',
    card: '#FCF8EC',
    cardForeground: '#332B18',
    muted: '#EFE7D2',
    mutedForeground: '#8C8063',
    popover: '#FBF6E9',
    popoverForeground: '#332B18',
    primary: '#C9A857',
    primaryForeground: '#241C07',
    secondary: '#F0E6CC',
    secondaryForeground: '#4A3F24',
    accent: '#EEE1BE',
    accentForeground: '#4A3C1C',
    border: '#DDD1AE',
    input: '#D6C89F',
    ring: '#B08E35',
    midground: '#8F6F26',
    composerRing: '#B08E35',
    destructive: '#B4372E',
    destructiveForeground: '#FEF2F2',
    sidebarBackground: '#F2EBD6',
    sidebarBorder: '#E0D5B2',
    userBubble: '#F1E8CE',
    userBubbleBorder: '#DECFA3'
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
        "            {'B.I.A.V. Studio 出品 · 基于 Hermes Agent'"
        " + (version?.appVersion ? ` ${version.appVersion}` : '')"
        " + ' 定制'}\n"
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
    # featuredPitch 归还 Hermes（守密人 2026-08-03 裁定「别说是 Black Pool 推荐，
    # 这是 Hermes 官方的，跟我们无关」）：裸词规则误把 Nous 自家服务的宣传语
    # 换上了黑池名——五语种逐条还原（该句描述的是对方订阅服务）。
    (
        "featuredPitch: 'One subscription, 300+ frontier models — the recommended way to run Black Pool',",
        "featuredPitch: 'One subscription, 300+ frontier models — the recommended way to run Hermes',",
    ),
    (
        "featuredPitch: '一个订阅，300+ 前沿模型 — 运行 Black Pool 的推荐方式',",
        "featuredPitch: '一个订阅，300+ 前沿模型 — 运行 Hermes 的推荐方式',",
    ),
    (
        "featuredPitch: '一個訂閱，300+ 前沿模型 — 執行 Black Pool 的建議方式',",
        "featuredPitch: '一個訂閱，300+ 前沿模型 — 執行 Hermes 的建議方式',",
    ),
    (
        "featuredPitch: '1 つのサブスクリプションで 300 以上の最先端モデル — Black Pool を実行するための推奨方法',",
        "featuredPitch: '1 つのサブスクリプションで 300 以上の最先端モデル — Hermes を実行するための推奨方法',",
    ),
    (
        "featuredPitch: 'اشتراك واحد، أكثر من 300 نموذج متقدم — الطريقة الموصى بها لتشغيل Black Pool',",
        "featuredPitch: 'اشتراك واحد، أكثر من 300 نموذج متقدم — الطريقة الموصى بها لتشغيل Hermes',",
    ),
    # 品牌字体加载修复（守密人 2026-08-03 实机发现字标回退无衬线；装配日志实锤
    # "didn't resolve at build time"）：上游 CSS 按 monorepo 根 node_modules 写
    # 路径、官方从根装依赖故可解析；本装配只在 apps/desktop 里 npm ci——改指
    # 应用自己的 node_modules，构建期即内嵌字体。
    (
        "url('../../../node_modules/@nous-research/ui/dist/fonts/Collapse-Bold.woff2')",
        "url('../node_modules/@nous-research/ui/dist/fonts/Collapse-Bold.woff2')",
    ),
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
    (
        "export const DEFAULT_LOCALE: Locale = 'en'\n",
        "export const DEFAULT_LOCALE: Locale = 'zh'\n",
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
    (
        "    route = resolve_billing_route(model_name, provider=provider, base_url=base_url)\n"
        '    if route.billing_mode == "subscription_included":\n',
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
        '          {false && <div className="mt-6 text-xs text-muted-foreground">\n'
        "            {copy.installTo}{' '}\n"
        '            <code className="font-mono text-(--ui-text-secondary)">{state.setupChoice.activeRoot}</code>\n'
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
        if any(m in line for m in LINE_SKIP_MARKERS):
            out_lines.append(line)
            continue
        for old, new in GENERIC_RULES:
            line = line.replace(old, new)
        if bare_word:
            line = BARE_WORD_RE.sub(BRAND, line)
        out_lines.append(line)
    text = "".join(out_lines)
    for old, new in BRAND_POST_RULES:
        text = text.replace(old, new)
    return text


def transform_intranet(text: str) -> str:
    """私有版叠加变换：内网/便携适配（在公版之后应用）。"""
    for old, new in INTRANET_POST_RULES:
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


def apply_brand_tree(root: Path) -> int:
    """对 root 就地应用公版（品牌层）变换 + 图标覆盖，返回改动文件数。"""
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
    """对（已应用公版的）root 叠加私有版内网层变换，返回改动文件数。"""
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
                                  capture_output=True, text=True, check=True)
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
        return brand_diff, intranet_diff


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", metavar="DEST")
    ap.add_argument("--edition", choices=["public", "private"], default="private",
                    help="--apply 时选版：public=仅品牌层（公版）；private=品牌+内网层（默认）")
    args = ap.parse_args()

    if args.apply:
        dest = Path(args.apply).resolve()
        n = apply_brand_tree(dest)
        if args.edition == "private":
            n += apply_intranet_tree(dest)
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
