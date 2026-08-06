"""Hermes 施工边界文书（bpt-hermes-charter-20260802）的机械可查红线守卫。

弱约定（文书）升硬门禁（测试）。patches/ 启用史：文书禁 1 原定「当前必须为空」；
守密人 2026-08-02 需求 #1（品牌换装）裁定「开 patches/ 全量抹净」，本守卫同 PR 从
「必须为空」改为「白名单 + 三红线」。2026-08-03 定名裁定：品牌名黑池（Black Pool）
v0.1.0，补丁分**公版**（black-pool-rebrand.patch，纯品牌）与**私有版**
（black-pool-intranet.patch，内网/便携适配叠加层）两张，装配按序应用。
"""
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "black-pool-agent"
REBRAND = SUB / "build" / "rebrand.py"
PATCH_BRAND = SUB / "patches" / "black-pool-rebrand.patch"
PATCH_INTRANET = SUB / "patches" / "black-pool-intranet.patch"


def _load_rebrand():
    """按路径载入规则引擎（build/ 不是包，且与顶层 scripts/ 同名风险隔离）。"""
    spec = importlib.util.spec_from_file_location("bpa_rebrand", REBRAND)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

# patches/ 白名单：每个补丁须在此具名登记（防无名补丁悄悄入库）。
ALLOWED_PATCHES = {
    "black-pool-rebrand.patch",   # 公版：品牌换装（build/rebrand.py 规则引擎生成）
    "black-pool-intranet.patch",  # 私有版：内网/便携适配叠加层（同一引擎生成，叠加于公版后）
    "conversation-cost-panel.patch",  # 需求 #2 对话成本面板（手维护特性补丁，上下文零品牌词故可叠加于换装后）
}


def test_patches_are_whitelisted():
    patches = SUB / "patches"
    assert patches.is_dir(), "patches/ 目录缺失（文书 §2.2）"
    extras = [p.name for p in patches.iterdir()
              if p.name not in ALLOWED_PATCHES | {".gitkeep"}]
    assert not extras, (
        f"patches/ 出现未登记补丁: {extras}。新补丁须经守密人裁定，"
        "同 PR 登记进 ALLOWED_PATCHES 并在 gaps.md 留档。"
    )


def test_patches_apply_cleanly_to_upstream(tmp_path):
    """补丁必须能干净打在当前 pin 的 upstream/ 上——移 pin 忘了重生成即红。

    私有版是公版的**叠加层**：git apply --check 对多补丁只各自对照原始树，
    不串联结果（2026-08-03 实证翻车）——故按装配真实顺序在临时树上**实打**
    公版后再校验私有版。
    """
    for args in ([str(PATCH_BRAND)], [str(SUB / "patches" / "conversation-cost-panel.patch")]):
        r = subprocess.run(
            ["git", "apply", "--check",
             "--directory=projects/black-pool-agent/upstream", *args],
            cwd=REPO, capture_output=True, text=True,
        )
        assert r.returncode == 0, (
            f"{Path(args[0]).name} 不能干净应用于 upstream/"
            f"（多半是移 pin 后未重生成，跑 python3 build/rebrand.py）: {r.stderr[:500]}"
        )
    import shutil
    work = tmp_path / "seq"
    shutil.copytree(SUB / "upstream", work,
                    ignore=shutil.ignore_patterns(".venv", "node_modules", "__pycache__"))
    for name, check in ((PATCH_BRAND, False), (PATCH_INTRANET, True)):
        cmd = ["git", "apply", "--unsafe-paths"] + (["--check"] if check else []) + [str(name)]
        r = subprocess.run(cmd, cwd=work, capture_output=True, text=True)
        assert r.returncode == 0, (
            f"序贯应用失败于 {Path(str(name)).name}: {r.stderr[:500]}"
        )


def test_patches_never_touch_license_or_copyright():
    """三红线之一：品牌换装不得触碰 LICENSE / 版权行（MIT + 文书裁 10）。"""
    for name in ALLOWED_PATCHES:
        text = (SUB / "patches" / name).read_text(encoding="utf-8")
        for line in text.splitlines():
            if line.startswith("diff --git"):
                assert "LICENSE" not in line, f"{name} 含 LICENSE 文件 hunk: {line}"
            if line.startswith("-") and not line.startswith("---"):
                low = line.lower()
                assert "copyright" not in low and "spdx-license" not in low, (
                    f"{name} 删改了版权行: {line[:120]}"
                )


def test_rebrand_never_breaks_functional_identifiers():
    """红线延伸（lesson #57，2026-08-02 生产事故）：显示词换装不得误伤连字符标识符。

    `X-Hermes-Session-Token` 曾被裸词正则换成含空格非法头名，desktop 设置页全线
    ERR_INVALID_HTTP_TOKEN 崩加载。哨兵：补丁任何一行都不得产出被打断的头名/UA/文件名。
    """
    text = PATCH_BRAND.read_text(encoding="utf-8")
    assert "X-Black Pool" not in text, "HTTP 头名被换装打断（lesson #57 复发）"
    bad = [l for l in text.splitlines()
           if l.startswith("+") and re.search(r"Black Pool-(Session|Setup|Desktop)", l)]
    assert not bad, f"连字符标识符被换装打断: {bad[:3]}"


def test_bare_word_scope_safety():
    """裸词换装铺到 Python 后端（agent/，2026-08-05）后的功能面守卫。

    前端三处目录的风险面已由上一条守着；agent/ 入列带来的是 Python 侧的新风险：
    产物路径（`Hermes.app`/`.exe`）、URL、环境变量名、import 语句里若含裸词，
    换成含空格的品牌名即坏功能。入列前逐条核过为零命中，此测锁住这个状态——
    下一层（hermes_cli / gateway / tools）铺开时，这些模式会真的出现，届时必须
    先加豁免再入列，而不是让它无声打断。
    """
    added = [l for l in PATCH_BRAND.read_text(encoding="utf-8").splitlines()
             if l.startswith("+") and not l.startswith("+++")]
    patterns = {
        # `.exe`/`.app`/`.desktop` 刻意不在列：electron-builder 的 productName /
        # executableName 已随换装改为 "Black Pool"，产出的就是 `Black Pool.exe`，
        # 那些 path.join 是与产物名对齐的正确写法，不是被打断的标识符。
        "源码/数据文件路径被换": re.compile(r"Black Pool\.(py|json|ya?ml|db|tsx?|mjs)\b"),
        "URL 内被换": re.compile(r"https?://[^\s\"']*Black Pool"),
        "环境变量/常量名被换": re.compile(r"Black Pool[_-][A-Z]"),
        "import 语句被换": re.compile(r"^\+\s*(?:import|from)\s+Black Pool\b"),
    }
    hits = {why: [l.strip()[:110] for l in added if rx.search(l)][:3]
            for why, rx in patterns.items()}
    hits = {k: v for k, v in hits.items() if v}
    assert not hits, f"裸词换装打断了功能标识: {hits}"


def test_agent_prompt_text_rebranded():
    """系统提示词是模型自述的直接来源——留着上游品牌即当场穿帮。

    守密人 2026-08-05 现场反馈「后端对话还有不少内容是 hermes」的根因：裸词此前
    只扫前端，而 `You are chatting inside the Hermes desktop app` 一类句子就写在
    agent/prompt_builder.py 里，逐字进模型上下文。
    """
    text = PATCH_BRAND.read_text(encoding="utf-8")
    for phrase in (
        "You run on Black Pool Agent (by B.I.A.V. Studio).",
        "You are running in the Black Pool terminal UI (TUI).",
        "You are chatting inside the Black Pool desktop app",
        "You are in the Black Pool WebUI",
    ):
        assert phrase in text, f"提示词换装缺失: {phrase!r}"
    # 归因口径：自述句不报上游母公司名（SPECIAL_RULES 既有裁定的延伸）。
    added = [l for l in text.splitlines() if l.startswith("+") and not l.startswith("+++")]
    assert not any("You run on" in l and "Nous Research" in l for l in added), (
        "自述句仍报 Nous Research——归因口径未归一"
    )


def test_brand_patch_sentinels():
    """公版（品牌层）规则不得因移 pin 锚点失配而无声失效。

    POST_RULES 是纯文本锚定替换——上游结构变了替换会无声 no-op，
    对应 hunk 从补丁消失。哨兵逐条点名。
    """
    text = PATCH_BRAND.read_text(encoding="utf-8")
    sentinels = {
        "About 主版本行渲染黑池版本": "a.version('0.1.0')",
        "About 出身行（上游版本静态陈述）": "B.I.A.V. Studio 出品 · 基于 Hermes Agent 0.20.0 定制",
        "产品版本一井换水（后端 __version__）": '__version__ = "0.1.0"',
        "Hermes Agent 对应 Black Pool Agent": "Black Pool Agent",
        "APP_NAME 兜底统一（userData 脑裂）": "|| 'Black Pool'",
        "relay 默认名两名并收": 'value in ("Black Pool Agent", "Hermes Agent")',
        "AUMID 中性化": "com.biav.blackpool",
        "唤醒词帮助中性化": "toggle the wake word listener [on|off|status]",
        "CLI 面板残留品牌收尾": "⚕ Black Pool",
        "默认语言简体中文（前端缺省，测试态钉 en）": "MODE === 'test' ? 'en' : 'zh'",
        "默认语言简体中文（后端真源头）": '"language": "zh",',
        "默认外观深色（缺省兜底）": "'system' ? value : 'dark'",
        "默认外观深色（契约用例同步翻面）": "fallback: 'dark', a: 'light'",
        "品牌字体路径修复（Collapse 构建期内嵌）": "url('../node_modules/@nous-research/ui",
        "黑池默认主题（鎏金双貌）": "DEFAULT_SKIN_NAME = 'black-pool'",
        "默认皮肤后端真源头": '"skin": "black-pool"',
        "黑池主题定义在位": "blackPoolTheme",
        "Nous Portal 卡保持官方原版图标": "nous-portal-icon.png",
        "状态栏版本芯片显示黑池版本": "desktopVersion?.appVersion ? '0.1.0'",
    }
    missing = [k for k, v in sentinels.items() if v not in text]
    assert not missing, f"公版规则从补丁消失（锚点失配）: {missing}"
    # featuredPitch 砍后半句（正向 + 负向哨兵；负向只查新增行——删除行含原文属正常）
    assert "featuredPitch: 'One subscription, 300+ frontier models'," in text
    added = [l for l in text.splitlines() if l.startswith("+")]
    assert not any("the recommended way to run" in l for l in added)
    assert not any("的推荐方式" in l for l in added)


def test_intranet_patch_sentinels():
    """私有版（内网/便携适配层）规则不得静默失效——自更新三入口 + 云绑定面。"""
    text = PATCH_INTRANET.read_text(encoding="utf-8")
    sentinels = {
        "About 自更新区隐藏": "{false && (<>",
        "About Danger zone 隐藏": "{false && <UninstallSection />}",
        "后台更新轮询 no-op": "便携包禁自更新",
        "hermes update 便携硬门禁": "Self-update is disabled in the portable bundle",
        "Billing 入口隐藏": "Billing 入口隐藏",
        "Billing 深路由封死": "-  'billing',",
        "Help 菜单更新项摘除": "Help>Check for Updates 菜单整项摘除",
        "Cloud 连接模式隐藏": "Cloud 连接模式隐藏",
        "Telegram Quick setup 列隐藏": "Quick setup 列隐藏",
        "首启服务商引导跳过": "首启引导跳过（服务商在设置页配）",
        "本地安装卡隐藏": "本地安装卡隐藏",
        "后端契约横幅静默": "契约横幅整只静默",
        "自定义模型价格表注入": "model-prices.json",
        "Nous Portal 推荐徽标摘除": "内网无推荐位",
        "推荐光效摘除": "arc-nous",
        "版本芯片降为纯展示（更新覆盖层入口摘除）": "-      onSelect: () => openUpdateOverlayFor('client'),",
        "版本芯片纯展示变体": "+      variant: 'text'",
        "单测期望对齐私有版（自更新收口哨兵）": "the portable edition disables self-update",
        "服务商列表默认展开": "SHOW_ALL_KEY) !== \'0\'",
    }
    missing = [k for k, v in sentinels.items() if v not in text]
    assert not missing, f"私有版规则从补丁消失（锚点失配）: {missing}"
    # 锚点唯一性回归（2026-08-04 野战：裸体锚匹配 3 处，把 return user_entry 注进
    # 返回 CostResult 的 estimate_usage_cost，.amount_usd 崩死 BPA）：价格钩子
    # 只许注入 get_pricing_entry 一处。
    added = [l for l in text.splitlines() if l.startswith("+")]
    hooks = [l for l in added if "user_entry = _user_pricing_entry" in l]
    assert len(hooks) == 1, f"价格钩子注入点应恰为 1 处，实为 {len(hooks)}（锚点撞车复发）"


def test_editions_are_cleanly_separated():
    """两版分界纪律：公版不得混入内网适配内容，私有版不得混入品牌换装内容。

    公版补丁出现帘子隐藏/更新门禁 = 分层漏了；私有版补丁出现品牌词替换删除行
    （删 Hermes 显示词）= 品牌规则漏进内网层。
    """
    brand = PATCH_BRAND.read_text(encoding="utf-8")
    assert "Self-update is disabled" not in brand and "{false && (<>" not in brand, (
        "内网适配规则混入公版补丁——检查 rebrand.py 两层规则表归属"
    )
    intranet = PATCH_INTRANET.read_text(encoding="utf-8")
    bad = [l for l in intranet.splitlines()
           if l.startswith("-") and not l.startswith("---") and "Hermes Agent" in l]
    assert not bad, f"品牌换装规则混入私有版补丁: {bad[:3]}"


def test_rebrand_check_matches_committed_patches():
    """规则引擎 ↔ 已入库补丁不得静默分叉（2026-08-04 审视 H-8，本轮补网）。

    引擎自带 `--check` 漂移检测，却在 tests/ 与 .github/workflows/ 里零调用：
    组装工作流用 `--apply`（规则引擎实时算），而 test_patches_apply_cleanly
    校验的是**补丁文件**——两条路可以各走各的，谁也不会红。此测试即那道缺失的
    对账，是本仓唯一把二者钉在一起的地方（约 17 秒，值这个价）。
    """
    r = subprocess.run([sys.executable, str(REBRAND), "--check"],
                       cwd=SUB, capture_output=True, text=True)
    assert r.returncode == 0, (
        "规则引擎输出与 patches/ 已入库补丁不一致——"
        f"跑 python3 build/rebrand.py 重生成: {r.stdout[-400:]}{r.stderr[-400:]}"
    )


def test_plugin_author_attribution_never_rewritten():
    """归属行豁免（守密人 2026-08-04 裁定「回退」）：`author:` 不进换装射程。

    上游 plugins/**/plugin.yaml 的 author 字段含真实第三方贡献者姓名
    （fireworks / vertex 两个 provider 插件）。MIT 未要求改写署名，改了即把
    他人作品记到自己名下——与「不抹来源事实」红线同源。
    """
    rb = _load_rebrand()
    for line in ("author: Hermes Agent\n",
                 "author: Alex Jestin Taylor (@alex-fireworks) + Hermes Agent\n",
                 "author: Steve Lawton (@slawt), Hermes Agent\n",
                 "author: Hermes Agent contributors\n"):
        assert rb.transform_brand(line, bare_word=True) == line, f"归属行被改写: {line!r}"
    # 正向：非归属行照常换装（豁免规则不得误伤正常文案）
    assert "Black Pool" in rb.transform_brand("    authorizeThere: 'Authorize Hermes there.',\n",
                                              bare_word=True)
    for text in (PATCH_BRAND.read_text(encoding="utf-8"),
                 PATCH_INTRANET.read_text(encoding="utf-8")):
        bad = [l for l in text.splitlines() if re.match(r"^[-+]\s*author\s*:", l)]
        assert not bad, f"补丁改动了归属行: {bad[:4]}"


def test_rebrand_refuses_repeat_application(tmp_path):
    """两层变换均非幂等，必须拒绝打在已变换的树上（2026-08-04 审视 H-1）。

    公版第二遍会把 About 出身行「基于 Hermes Agent 0.20.0 定制」（MIT 归因
    唯一的 UI 承载面）吃成「基于 Black Pool Agent」；私有版第二遍把价格表
    注入体逐层套娃（实测 +66 行/遍，无上限）。
    """
    rb = _load_rebrand()
    brand_tree = tmp_path / "b" / "agent"
    brand_tree.mkdir(parents=True)
    (brand_tree / "x.py").write_text("# Hermes Agent runtime\n", encoding="utf-8")
    assert rb.apply_brand_tree(brand_tree.parent) == 1
    assert "Black Pool Agent" in (brand_tree / "x.py").read_text(encoding="utf-8")
    with pytest.raises(rb.RebrandError, match="已换过装"):
        rb.apply_brand_tree(brand_tree.parent)

    intranet_tree = tmp_path / "i" / "agent"
    intranet_tree.mkdir(parents=True)
    (intranet_tree / "usage_pricing.py").write_text(
        "def get_pricing_entry(\n", encoding="utf-8")
    assert rb.apply_intranet_tree(intranet_tree.parent) == 1
    once = (intranet_tree / "usage_pricing.py").read_text(encoding="utf-8")
    with pytest.raises(rb.RebrandError, match="已叠加内网层"):
        rb.apply_intranet_tree(intranet_tree.parent)
    assert (intranet_tree / "usage_pricing.py").read_text(encoding="utf-8") == once


@pytest.mark.parametrize("dest,reason", [
    ("__no_such_dir__", "目标树不存在"),
    ("upstream", "vendor 快照"),
    (".", "祖先目录"),
])
def test_rebrand_apply_validates_dest(dest, reason):
    """`--apply` 指错地方必须 rc=2，不得「0 files changed」+ rc=0（审视 H-6）。

    原实现只 resolve 不校验：目录不存在时什么也不扫，照报成功——组装脚本据此
    判定换装完成，出厂即未换装包。upstream/ 自身与其祖先另属红线（vendor
    快照逐字节纯净）。
    """
    r = subprocess.run([sys.executable, str(REBRAND), "--apply", dest],
                       cwd=SUB, capture_output=True, text=True)
    assert r.returncode == 2, f"应拒绝 {dest!r}，实得 rc={r.returncode}: {r.stdout}"
    assert reason in r.stderr, r.stderr


def test_charter_skeleton_present():
    for name in ["plugins", "skills", "deploy"]:
        assert (SUB / name).is_dir(), f"§2.2 骨架目录缺失: {name}/"
    assert (SUB / "gaps.md").is_file(), "gaps.md 一等产出缺失（文书 §6.6）"
    assert (SUB / "UPSTREAM.md").is_file(), "UPSTREAM.md pin 台账缺失"
