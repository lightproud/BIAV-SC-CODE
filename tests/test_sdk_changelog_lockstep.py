"""锁步空转条目的措辞守卫（T70，守密人 2026-07-26 裁定）。

两包锁步同版，代价实测：锁步纪元里 agent 22%、maestro 38% 的版本条目是「本包零改动，
只是家族对端发版了」。消费方按 tarball 版本 pin，于是每个空转版本都是一次无内容的
重新 pin 判断。`scripts/sdk_substantive_versions.py` 自动产出「对你有实质变更的版本」
清单来省掉这一步——**而它靠的是空转条目的措辞可被机器认出**。

本组守的就是那条约定。要紧的是它挡的**不是**「写得不好看」：

    用新措辞写一条空转条目 → 脚本认不出 → 清单把一个什么都没变的版本报成实质变更
    → 消费方白 pin 一次 → **而清单看起来完全正常**。

首次跑这道守卫即抓到两条真实漂移（agent 0.72.0 / 0.70.0 写的是「Lockstep alignment
**with** …」加句尾「No agent-side changes.」，内容确是空转、措辞非规范），已同批订正。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
import sdk_substantive_versions as ssv  # noqa: E402

SCRIPT = REPO / "scripts" / "sdk_substantive_versions.py"


def test_no_lockstep_wording_drift_in_either_changelog() -> None:
    violations = ssv.format_violations()
    assert violations == [], "空转条目措辞漂移：\n  " + "\n  ".join(violations)


def test_the_guard_is_not_vacuous() -> None:
    """负控：把一条规范空转条目改成非规范措辞，守卫必须咬。

    没有这一条，上面那个断言可能只是因为正则永远匹配不到任何东西而恒绿。
    """
    body = "## 9.9.9 — 2026-01-01\n\nBumped alongside the other package. No agent-side changes.\n\n"
    marks = list(ssv._HEADING.finditer(body))
    assert marks, "测试夹具本身解析不出版本标题"
    assert any(rx.search(body) for rx in ssv._NOOP_HINTS), "空转线索正则认不出这条，守卫是聋的"
    first = next(ln.strip() for ln in body[marks[0].end():].splitlines() if ln.strip())
    assert not first.startswith(ssv.LOCKSTEP_PREFIX), "夹具应当是非规范措辞"


def test_canonical_wording_is_NOT_flagged() -> None:
    """反向负控：规范措辞不得被误伤，否则守卫会逼人放弃这条约定。"""
    body = f"{ssv.LOCKSTEP_PREFIX} — no agent-side changes. The family clock advanced.\n"
    first = body.splitlines()[0].strip()
    assert first.startswith(ssv.LOCKSTEP_PREFIX)


def test_every_lockstep_entry_is_recognized_by_the_parser() -> None:
    """解析器认得出的空转条目数必须 > 0——为零说明约定名存实亡（或解析器坏了）。"""
    for key in ssv.CHANGELOGS:
        entries = ssv.parse(ssv.CHANGELOGS[key])
        assert entries, f"{key}: CHANGELOG 解析不出任何版本条目"
        assert any(e.lockstep_only for e in entries), (
            f"{key}: 一条空转条目都认不出——锁步纪元实测两侧都有，故这是解析器坏了"
        )


def test_substantive_list_excludes_the_no_ops() -> None:
    """清单的正事：空转版本不得出现在「对你有实质变更」里。"""
    for key in ssv.CHANGELOGS:
        entries = ssv.parse(ssv.CHANGELOGS[key])
        substantive = [e.version for e in entries if not e.lockstep_only]
        noop = [e.version for e in entries if e.lockstep_only]
        assert not (set(substantive) & set(noop))
        assert len(substantive) + len(noop) == len(entries)


def test_cli_check_mode_exits_zero_on_a_clean_tree() -> None:
    """CLI 是给 CI / 人用的入口，别只测库函数。"""
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"],
        capture_output=True, text=True, cwd=REPO, timeout=60,
    )
    assert proc.returncode == 0, f"--check 非零退出：\n{proc.stderr}"


def test_cli_json_output_is_wellformed() -> None:
    import json

    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "maestro", "--json"],
        capture_output=True, text=True, cwd=REPO, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    data = json.loads(proc.stdout)
    assert data["package"] == "maestro"
    assert data["total"] == data["substantive"] + data["lockstep_only"]
    assert data["lockstep_only"] > 0, "maestro 侧实测有空转版本，报 0 说明识别失效"
