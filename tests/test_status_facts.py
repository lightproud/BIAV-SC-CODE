"""状态档机器事实块守卫 —— 「会变的数字不许手抄」的执行层。

对应 `scripts/build_status_facts.py`。守两件事：块存在且与权威源同步（不同步即红并给出
重算命令），以及块内数字确实来自权威源而非被人手改。

本组的存在理由是当天的实测：`memory/project-status.md` 的 SDK 行曾停在 v0.63.1 而包已
0.76.0（滞后 13 个次版本）；同日两个会话各自手抄一遍本地实测数，得出 3216+5/197 与
3215+6/196 两组不同数字。手抄多少遍就会分叉多少次——所以静态事实一律生成。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import build_status_facts as bsf  # noqa: E402


def _doc() -> str:
    return bsf.STATUS_DOC.read_text(encoding="utf-8")


def test_block_is_present() -> None:
    doc = _doc()
    assert bsf.BEGIN in doc and bsf.END in doc, (
        "project-status.md 缺机器生成事实块：跑 `python3 scripts/build_status_facts.py`"
    )


def test_block_is_in_sync_with_the_authoritative_sources() -> None:
    """块必须是仓库当前状态的纯函数——不同步说明有人手改了数字，或权威源变了没重算。"""
    assert bsf.apply(check_only=True) == 0, (
        "机器事实块与权威源不同步：跑 `python3 scripts/build_status_facts.py` 重算后提交"
    )


def test_versions_in_the_block_match_package_json() -> None:
    """独立复核一遍（不经生成器）：守卫自身若跟生成器同错，就什么也没守住。"""
    doc = _doc()
    block = doc.split(bsf.BEGIN, 1)[1].split(bsf.END, 1)[0]
    for path in (REPO / "projects" / "silver-core-sdk", REPO / "projects" / "silver-core-maestro-sdk"):
        version = json.loads((path / "package.json").read_text(encoding="utf-8"))["version"]
        assert f"`{version}`" in block, f"块内缺 {path.name} 的真实版本 {version}"


def test_family_lockstep_holds() -> None:
    """两包锁步同号是 2026-07-18 裁定的家族纪律；号不同则块里的「锁步」是假话。"""
    versions = {
        name: json.loads((path / "package.json").read_text(encoding="utf-8"))["version"]
        for name, path in bsf.PACKAGES.items()
        if name != "silver-core-testbed"
    }
    assert len(set(versions.values())) == 1, f"家族版本钟脱锁: {versions}"
