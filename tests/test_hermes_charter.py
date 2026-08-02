"""Hermes 施工边界文书（bpt-hermes-charter-20260802）的机械可查红线守卫。

弱约定（文书）升硬门禁（测试）：文书禁 1「patches/ 当前必须为空」与 §2.2 骨架
完整性由本档钉死——patches/ 里出现任何补丁文件即红，骨架目录/一等产出缺失即红。
未来守密人裁定启用补丁时，同 PR 修改本守卫（等于把「启用」留痕在 diff 里）。
"""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "silver-core-hermes"


def test_patches_dir_must_be_empty():
    patches = SUB / "patches"
    assert patches.is_dir(), "patches/ 预留目录缺失（文书 §2.2）"
    extras = [p.name for p in patches.iterdir() if p.name != ".gitkeep"]
    assert not extras, (
        f"patches/ 当前必须为空（文书禁 1），发现: {extras}。"
        "若守密人已裁定启用补丁，须同 PR 修改本守卫并在 gaps.md 留档。"
    )


def test_charter_skeleton_present():
    for name in ["plugins", "skills", "deploy"]:
        assert (SUB / name).is_dir(), f"§2.2 骨架目录缺失: {name}/"
    assert (SUB / "gaps.md").is_file(), "gaps.md 一等产出缺失（文书 §6.6）"
    assert (SUB / "UPSTREAM.md").is_file(), "UPSTREAM.md pin 台账缺失"
