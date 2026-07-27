"""合并前门禁的清单守卫 —— 「派生链断了要有人喊」。

`scripts/premerge_gate.py` 把「CI 会跑什么」从凭记忆升格为从工作流 yaml 算出来。
派生的价值全在**与 CI 同解释**——解释错了，派生比手抄还坏，因为它看起来更权威。
脚本首跑就自证了这一点：它漏读工作流级 `defaults.run.working-directory`，于是
`npm run typecheck` 跑到仓根、报出一片假红。本组把那次教训钉成断言。

守什么：
- 五个 required 检查名都解析得到真 job（改名 / 删 job 即红）；
- 工作目录三层继承正确（工作流级 defaults 不许再被漏读）；
- 分类不塌（至少认出 version-bump guard 与依赖方向守卫这两条**曾经漏跑过**的）；
- 缺仓外对照臂的步骤不被当普通门禁跑（跑它会产出假红）。

零执行：只读 committed 的 yaml，不跑任何 CI 步骤。
"""
from __future__ import annotations

from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

REPO = Path(__file__).resolve().parent.parent

pytest.importorskip("yaml")

from premerge_gate import (  # noqa: E402
    REQUIRED_CHECKS,
    _default_workdir,
    _jobs_by_check_name,
    collect_steps,
)


def test_every_required_check_resolves_to_a_real_job() -> None:
    """REQUIRED_CHECKS 是全脚本唯一的手抄清单（GitHub 规则集无 API 可读）。
    手抄的东西会过期——job 改名后脚本会静默少跑一整个检查的步骤。"""
    steps, missing = collect_steps()
    assert not missing, (
        f"required 检查 {missing} 在 .github/workflows/ 里找不到对应 job："
        f"要么 job 被改名（同步改 REQUIRED_CHECKS），要么清单过期。"
    )
    assert steps, "一条门禁步骤都没派生出来——派生链断了"


def test_workflow_level_working_directory_is_inherited() -> None:
    """**首跑教训条**：`silver-core-sdk.yml` 把 `working-directory` 写在**工作流顶层**，
    只读步骤级会让每条命令跑到仓根。那次产出了 13 条假红。"""
    resolved = _jobs_by_check_name()
    check = "Silver Core Agent SDK / unit tests"
    assert check in resolved, "SDK unit 检查未解析——先看上一条"
    _wf, _jid, _job, wd = resolved[check]
    assert wd == "projects/silver-core-sdk", (
        f"SDK 门禁步骤的工作目录解析为 {wd!r}，应继承工作流级 defaults "
        f"`projects/silver-core-sdk`；跑错目录会报满屏假红"
    )
    steps = [s for s in collect_steps()[0] if s.check == check and s.kind == "gate"]
    assert steps and all(s.workdir == "projects/silver-core-sdk" for s in steps), (
        f"SDK 门禁步骤的 workdir 未落到包内: {[(s.name, s.workdir) for s in steps]}"
    )


def test_default_workdir_precedence() -> None:
    """三层就近覆盖：工作流级 → job 级 → （步骤级在 collect_steps 里处理）。"""
    assert _default_workdir({}, {}) == "."
    assert _default_workdir({"defaults": {"run": {"working-directory": "a"}}}, {}) == "a"
    assert _default_workdir(
        {"defaults": {"run": {"working-directory": "a"}}},
        {"defaults": {"run": {"working-directory": "b"}}},
    ) == "b", "job 级 defaults 必须盖过工作流级"


# 曾经真的漏跑过、因而必须一直在清单里的门禁步骤。
# version-bump guard: #835 手工验证漏了它，合并后 main 红约一小时（2026-07-27）。
# dependency direction: 与它同属「pytest/vitest 跑不到」的一类，一并钉住。
SENTINEL_STEPS = ["check-version-bump.mjs", "check-dep-direction.mjs"]


@pytest.mark.parametrize("needle", SENTINEL_STEPS)
def test_known_blind_spots_are_in_the_derived_list(needle: str) -> None:
    """这两条正是「对话内判定门跑不到、于是被漏掉」的实例。它们必须**被派生出来
    且被判为要跑**——只要它们从清单里消失，同一个坑就会原样复发。"""
    steps, _ = collect_steps()
    hits = [s for s in steps if needle in s.run]
    assert hits, f"派生清单里找不到 {needle}——它是已知盲区，不许掉出清单"
    assert any(s.kind == "gate" for s in hits), (
        f"{needle} 被判为 {[s.kind for s in hits]}，不会被执行；它必须是 gate"
    )


def test_steps_needing_an_out_of_repo_arm_are_not_plain_gates() -> None:
    """缺 `--no-save` 临时对照臂时，conformance 差分与棘轮会报 58 条环境固有的「回归」。
    **假红比不跑更坏**——它教人无视门禁。故这类步骤须单独归类、默认跳过并点名。"""
    steps, _ = collect_steps()
    conformance = [s for s in steps if s.check.endswith("conformance") and s.kind != "plumbing"]
    assert conformance, "conformance 检查一条步骤都没派生出来"
    assert all(s.kind != "gate" for s in conformance), (
        f"conformance 步骤被当普通门禁: {[(s.name, s.kind) for s in conformance if s.kind == 'gate']}"
    )
    assert any(s.kind == "needs-arm" for s in conformance), "needs-arm 分类未生效"


def test_nothing_is_dropped_without_a_named_kind() -> None:
    """每条派生出来的步骤都必须有已知归类——未知归类会被静默丢掉，那就是无声上限。"""
    known = {"gate", "setup", "plumbing", "unsupported", "needs-arm"}
    steps, _ = collect_steps()
    unknown = {s.kind for s in steps} - known
    assert not unknown, f"出现未知步骤归类: {unknown}"


def test_required_checks_matches_the_documented_set() -> None:
    """CLAUDE.md §7.6 是这份手抄清单的来源；两边分叉时脚本会守错一组检查。"""
    doc = (REPO / "CLAUDE.md").read_text(encoding="utf-8")
    for check in REQUIRED_CHECKS:
        needle = check if check != "test" else "`test`（Python）"
        assert needle in doc, f"CLAUDE.md 未提及 required 检查 {check!r}——文档与脚本已分叉"
