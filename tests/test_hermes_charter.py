"""Hermes 施工边界文书（bpt-hermes-charter-20260802）的机械可查红线守卫。

弱约定（文书）升硬门禁（测试）。patches/ 启用史：文书禁 1 原定「当前必须为空」；
守密人 2026-08-02 需求 #1（品牌换装）裁定「开 patches/ 全量抹净」，本守卫同 PR 从
「必须为空」改为「白名单 + 三红线」。2026-08-03 定名裁定：品牌名黑池（Black Pool）
v0.1.0，补丁分**公版**（black-pool-rebrand.patch，纯品牌）与**私有版**
（black-pool-intranet.patch，内网/便携适配叠加层）两张，装配按序应用。
"""
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "black-pool-agent"
PATCH_BRAND = SUB / "patches" / "black-pool-rebrand.patch"
PATCH_INTRANET = SUB / "patches" / "black-pool-intranet.patch"

# patches/ 白名单：每个补丁须在此具名登记（防无名补丁悄悄入库）。
ALLOWED_PATCHES = {
    "black-pool-rebrand.patch",   # 公版：品牌换装（deploy/rebrand.py 规则引擎生成）
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


def test_patches_apply_cleanly_to_upstream():
    """补丁必须能干净打在当前 pin 的 upstream/ 上——移 pin 忘了重生成即红。

    私有版是公版的叠加层，单独对 pristine 上游不保证可应用——按装配真实顺序
    「公版 → 私有版」一次性 --check（git apply 多补丁按序原子校验）。
    """
    for args in (
        [str(PATCH_BRAND)],
        [str(PATCH_BRAND), str(PATCH_INTRANET)],
        [str(SUB / "patches" / "conversation-cost-panel.patch")],
    ):
        r = subprocess.run(
            ["git", "apply", "--check",
             "--directory=projects/black-pool-agent/upstream", *args],
            cwd=REPO, capture_output=True, text=True,
        )
        assert r.returncode == 0, (
            f"补丁序列 {[Path(a).name for a in args]} 不能干净应用于 upstream/"
            f"（多半是移 pin 后未重生成，跑 python3 deploy/rebrand.py）: {r.stderr[:500]}"
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


def test_brand_patch_sentinels():
    """公版（品牌层）规则不得因移 pin 锚点失配而无声失效。

    POST_RULES 是纯文本锚定替换——上游结构变了替换会无声 no-op，
    对应 hunk 从补丁消失。哨兵逐条点名。
    """
    text = PATCH_BRAND.read_text(encoding="utf-8")
    sentinels = {
        "品牌名 + 版本号声明（About 出身声明）": "Black Pool（黑池）0.1.0",
        "Hermes Agent 对应 Black Pool Agent": "Black Pool Agent",
        "APP_NAME 兜底统一（userData 脑裂）": "|| 'Black Pool'",
        "relay 默认名两名并收": 'value in ("Black Pool Agent", "Hermes Agent")',
        "AUMID 中性化": "com.biav.blackpool",
        "唤醒词帮助中性化": "toggle the wake word listener [on|off|status]",
        "CLI 面板残留品牌收尾": "⚕ Black Pool",
    }
    missing = [k for k, v in sentinels.items() if v not in text]
    assert not missing, f"公版规则从补丁消失（锚点失配）: {missing}"


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
    }
    missing = [k for k, v in sentinels.items() if v not in text]
    assert not missing, f"私有版规则从补丁消失（锚点失配）: {missing}"


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


def test_charter_skeleton_present():
    for name in ["plugins", "skills", "deploy"]:
        assert (SUB / name).is_dir(), f"§2.2 骨架目录缺失: {name}/"
    assert (SUB / "gaps.md").is_file(), "gaps.md 一等产出缺失（文书 §6.6）"
    assert (SUB / "UPSTREAM.md").is_file(), "UPSTREAM.md pin 台账缺失"
