"""Hermes 施工边界文书（bpt-hermes-charter-20260802）的机械可查红线守卫。

弱约定（文书）升硬门禁（测试）。patches/ 启用史：文书禁 1 原定「当前必须为空」；
守密人 2026-08-02 需求 #1（品牌换装 Silver Core）裁定「开 patches/ 全量抹净」，
本守卫同 PR 从「必须为空」改为「白名单 + 三红线」——启用留痕于本 diff 与 gaps.md。
"""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "silver-core-hermes"

# patches/ 白名单：每个补丁须在此具名登记（防无名补丁悄悄入库）。
ALLOWED_PATCHES = {
    "silver-core-rebrand.patch",  # 需求 #1 品牌换装，deploy/rebrand.py 规则引擎生成
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
    """补丁必须能干净打在当前 pin 的 upstream/ 上——移 pin 忘了重生成即红。"""
    for name in ALLOWED_PATCHES:
        patch = SUB / "patches" / name
        assert patch.is_file(), f"登记的补丁不存在: {name}"
        r = subprocess.run(
            ["git", "apply", "--check",
             "--directory=projects/silver-core-hermes/upstream", str(patch)],
            cwd=REPO, capture_output=True, text=True,
        )
        assert r.returncode == 0, (
            f"{name} 不能干净应用于 upstream/（多半是移 pin 后未重生成，"
            f"跑 python3 deploy/rebrand.py）: {r.stderr[:500]}"
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


def test_charter_skeleton_present():
    for name in ["plugins", "skills", "deploy"]:
        assert (SUB / name).is_dir(), f"§2.2 骨架目录缺失: {name}/"
    assert (SUB / "gaps.md").is_file(), "gaps.md 一等产出缺失（文书 §6.6）"
    assert (SUB / "UPSTREAM.md").is_file(), "UPSTREAM.md pin 台账缺失"
