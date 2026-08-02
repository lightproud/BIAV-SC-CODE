"""合并前门禁的清单守卫 —— 「派生链断了要有人喊」。

`scripts/premerge_gate.py` 把「CI 会跑什么」从凭记忆升格为从工作流 yaml 算出来。
派生的价值全在**与 CI 同解释**——解释错了，派生比手抄还坏，因为它看起来更权威。
脚本首跑就自证了这一点：它漏读工作流级 `defaults.run.working-directory`，于是
`npm run typecheck` 跑到仓根、报出一片假红。本组把那次教训钉成断言。

2026-08-02 工程门禁拆除裁定后，required 检查收缩为单一 `test`（四个 JS 家族检查
随家族纯维稳 T78 退出，工作流降级手动触发）。原来钉住 JS 侧盲区的断言
（version-bump guard / 依赖方向 / conformance needs-arm 分类）随之退役——它们守的
step 已不在派生射程内；工作目录三层继承改用合成文档单测锁定。

守什么：
- required 检查名都解析得到真 job（改名 / 删 job 即红）；
- required 清单与 2026-08-02 拆除裁定一致（有人把 JS 检查加回来须走新裁定）；
- 工作目录三层继承正确（工作流级 defaults 不许再被漏读）；
- 每条派生步骤都有已知归类（未知归类会被静默丢掉）。

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


def test_required_set_matches_the_demolition_ruling() -> None:
    """2026-08-02 守密人裁定：工程门禁拆除，required 只剩 Python `test`。
    往清单里加回 JS 家族检查 = 推翻该裁定，须先落新决策记录再改这里。"""
    assert REQUIRED_CHECKS == ["test"], (
        f"required 清单 {REQUIRED_CHECKS} 偏离 2026-08-02 拆除裁定（应只剩 'test'）；"
        f"扩清单须新裁定 + 同步 CLAUDE.md §7.6"
    )


def test_workflow_level_working_directory_is_inherited() -> None:
    """**首跑教训条**（合成文档版）：原实例 `silver-core-sdk.yml` 把
    `working-directory` 写在工作流顶层，只读步骤级会让每条命令跑到仓根、
    产出 13 条假红。实例工作流已退出 required 清单，规则本身用合成文档钉住。"""
    doc = {"defaults": {"run": {"working-directory": "projects/x"}}}
    assert _default_workdir(doc, {}) == "projects/x", "工作流级 defaults 被漏读——首跑假红坑复发"


def test_default_workdir_precedence() -> None:
    """三层就近覆盖：工作流级 → job 级 → （步骤级在 collect_steps 里处理）。"""
    assert _default_workdir({}, {}) == "."
    assert _default_workdir({"defaults": {"run": {"working-directory": "a"}}}, {}) == "a"
    assert _default_workdir(
        {"defaults": {"run": {"working-directory": "a"}}},
        {"defaults": {"run": {"working-directory": "b"}}},
    ) == "b", "job 级 defaults 必须盖过工作流级"


def test_nothing_is_dropped_without_a_named_kind() -> None:
    """每条派生出来的步骤都必须有已知归类——未知归类会被静默丢掉，那就是无声上限。"""
    known = {"gate", "setup", "plumbing", "unsupported", "needs-arm"}
    steps, _ = collect_steps()
    unknown = {s.kind for s in steps} - known
    assert not unknown, f"出现未知步骤归类: {unknown}"


def test_pytest_suite_is_still_a_derived_gate() -> None:
    """拆除后仅剩的 required 检查必须仍派生出「跑测试」这一条 gate——
    连它都掉了，判定门就空转成「什么都不跑、什么都绿」。"""
    steps, _ = collect_steps()
    gates = [s for s in steps if s.kind == "gate" and "pytest" in s.run]
    assert gates, "test 检查没派生出 pytest 门禁步骤——判定门空转"


def test_required_checks_matches_the_documented_set() -> None:
    """CLAUDE.md §7.6 是这份手抄清单的来源；两边分叉时脚本会守错一组检查。"""
    doc = (REPO / "CLAUDE.md").read_text(encoding="utf-8")
    for check in REQUIRED_CHECKS:
        needle = check if check != "test" else "`test`（Python）"
        assert needle in doc, f"CLAUDE.md 未提及 required 检查 {check!r}——文档与脚本已分叉"
