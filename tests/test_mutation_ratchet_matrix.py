"""变异棘轮矩阵治理 —— 「没人跑的地板不是棘轮」。

2026-07-26 值班发现（todo T64 ①）：`loop-support` 的地板 94.35 自 2026-07-17 起
就躺在 `mutation-ratchet.json` 里，却**没有对应的周检矩阵腿**——从未被重新测过。
地板文件与工作流矩阵当时是两份手写清单，加靶时漏改任一份都不会有人喊。

**2026-07-26 二阶段（守密人裁定「点火，立为范例」）**：矩阵改由 `targets` job 从两份
baseline 生成（`fromJSON`），第二份清单**不再存在**——漂移从「要靠测试对账」降级为
「结构上不可能」。本组测试随之从**清单对账**转为**形态守卫**（提案 §2 招一 → 招二的
关系：能生成就别对账，对账只留作第二道保险）：

- 两个 ratchet job 的 matrix 必须仍是**派生表达式**，不得有人改回硬编码清单；
- `targets` job 必须恰好读那两份 baseline；
- 两包靶名不得互串（串了会拿错包的地板判分）。

零构建：只读 committed 的 yaml + 两个 json。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "sdk-mutation-ratchet.yml"

BASELINES = {
    "agent": REPO / "projects" / "silver-core-sdk" / "mutation-ratchet.json",
    "maestro": REPO / "projects" / "silver-core-maestro-sdk" / "mutation-ratchet.json",
}
# ratchet job 名 → 它应当消费的 targets 输出键
JOB_SOURCE = {"ratchet": "agent", "ratchet-maestro": "maestro"}


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _floor_targets(key: str) -> list[str]:
    return [t["name"] for t in json.loads(BASELINES[key].read_text(encoding="utf-8"))["targets"]]


@pytest.mark.parametrize("job_name", sorted(JOB_SOURCE))
def test_matrix_is_generated_not_hardcoded(job_name: str) -> None:
    """矩阵必须来自 baseline 派生表达式——硬编码清单即回到两份清单的老路。"""
    matrix = _workflow()["jobs"][job_name]["strategy"]["matrix"]["target"]
    assert isinstance(matrix, str), (
        f"{job_name}: matrix.target 又变回硬编码清单 {matrix!r}；"
        f"应为 ${{{{ fromJSON(needs.targets.outputs.{JOB_SOURCE[job_name]}) }}}}"
    )
    expected = f"needs.targets.outputs.{JOB_SOURCE[job_name]}"
    assert "fromJSON" in matrix and expected in matrix, (
        f"{job_name}: matrix.target 表达式未取自 {expected}，实为 {matrix!r}"
    )


@pytest.mark.parametrize("job_name", sorted(JOB_SOURCE))
def test_ratchet_jobs_depend_on_targets(job_name: str) -> None:
    """派生表达式只有在 needs 到位时才有值——漏 needs 会静默产出空矩阵（零腿全绿）。"""
    needs = _workflow()["jobs"][job_name].get("needs")
    needs = [needs] if isinstance(needs, str) else (needs or [])
    assert "targets" in needs, f"{job_name}: 缺 `needs: targets`，矩阵会解析为空"


def test_targets_job_reads_exactly_the_two_baselines() -> None:
    """真相源就是这两份 baseline；读别的文件即换了真相源。"""
    job = _workflow()["jobs"]["targets"]
    body = yaml.dump(job, allow_unicode=True)
    for key, path in BASELINES.items():
        rel = str(path.relative_to(REPO))
        assert rel in body, f"targets job 未读取 {key} 的 baseline {rel}"
    # sparse-checkout 条目带前导斜杠、run 步不带，归一后再比
    mentioned = {m.lstrip("/") for m in re.findall(r"[\w/.-]*mutation-ratchet\.json", body)}
    expected = {str(p.relative_to(REPO)) for p in BASELINES.values()}
    assert mentioned == expected, f"targets job 读了额外的 baseline: {sorted(mentioned - expected)}"


def test_the_two_packages_do_not_share_target_names() -> None:
    """两包靶名不得重叠——重叠会让单靶 dispatch 同时命中两包、拿错地板判分。"""
    agent = set(_floor_targets("agent"))
    maestro = set(_floor_targets("maestro"))
    assert not (agent & maestro), f"两包靶名重叠: {sorted(agent & maestro)}"


@pytest.mark.parametrize("key", sorted(BASELINES))
def test_every_floor_has_a_name_and_a_number(key: str) -> None:
    """生成链的输入卫生：无名靶会产出空矩阵腿，无地板靶会让检查脚本运行期才炸。"""
    for t in json.loads(BASELINES[key].read_text(encoding="utf-8"))["targets"]:
        assert t.get("name"), f"{key}: 存在无 name 的靶 {t}"
        assert isinstance(t.get("floor"), (int, float)), f"{key}: 靶 {t.get('name')} 无数值地板"


# ---------------------------------------------------------------------------
# Cadence 分档（守密人 2026-07-26 裁定，产品审视 P2）
#
# 三个 maestro 靶守的是**全仓零真实调用点**的模块（goal / delivery / 声明式加载），
# 六靶周检里三靶花在没人调用的代码上，故降为月检。这里的风险与 T64 同源、只是更轻：
# **一个月才测一次的地板，如果 cadence 值写错、或过滤器被人删掉，会重新变成「没人跑的
# 地板」而无人喊。** 故 cadence 本身也要有守卫。
# ---------------------------------------------------------------------------

VALID_CADENCE = {"weekly", "monthly"}


@pytest.mark.parametrize("key", sorted(BASELINES))
def test_cadence_values_are_from_the_closed_set(key: str) -> None:
    """拼错的 cadence（'month' / 'Monthly'）会被过滤器当成 weekly 静默通过——
    那不是错误的一边：靶照跑，只是分档没生效。所以拼写要在这里被钉死。"""
    for t in json.loads(BASELINES[key].read_text(encoding="utf-8"))["targets"]:
        cadence = t.get("cadence")
        assert cadence is None or cadence in VALID_CADENCE, (
            f"{key}: 靶 {t.get('name')} 的 cadence={cadence!r} 不在 {sorted(VALID_CADENCE)} 内"
        )


def test_the_targets_job_still_applies_a_cadence_filter() -> None:
    """过滤器被删 = 月检靶悄悄回到周检（无害）**或**周检靶被漏掉（有害）。
    不论哪一种，「baseline 写了 cadence 而生成器不看」都是两份真相源的老病复发。"""
    body = yaml.dump(_workflow()["jobs"]["targets"], allow_unicode=True)
    assert "cadence" in body, "targets job 不再读 cadence，但 baseline 里还写着——生成链与真相源脱节"
    assert "INCLUDE_MONTHLY" in body, "cadence 门控变量消失"


def test_monthly_targets_are_reachable_at_all() -> None:
    """**本组最要紧的一条**：月检靶必须真有跑得到的路径。

    降档的代价是「一个月才测一次」，不是「再也不测」——T64 的教训正是一个地板躺在
    baseline 里从未被测过。这里断言 targets job 里确实存在把 INCLUDE_MONTHLY 置 1 的
    分支（非 schedule 事件，或月初那个周一），否则月检靶就成了永不执行的死靶。
    """
    body = yaml.dump(_workflow()["jobs"]["targets"], allow_unicode=True)
    assert "INCLUDE_MONTHLY=1" in body, "没有任何把 INCLUDE_MONTHLY 置 1 的分支——月检靶永不执行"
    assert "date -u +%d" in body, "月检窗口的判据（月内日）不见了"


def test_skipped_targets_are_printed_not_silently_dropped() -> None:
    """无声上限就是撒谎:一轮没测的靶必须被点名，否则日志读起来像「全测了」。"""
    body = yaml.dump(_workflow()["jobs"]["targets"], allow_unicode=True)
    assert "SKIPPED this round" in body, "本轮跳过的靶未被打印——静默上限"


def test_not_every_target_is_monthly() -> None:
    """全员月检 = 周检工作流名存实亡；至少要有一个靶每周真跑。"""
    for key in BASELINES:
        targets = json.loads(BASELINES[key].read_text(encoding="utf-8"))["targets"]
        weekly = [t for t in targets if t.get("cadence", "weekly") != "monthly"]
        assert weekly, f"{key}: 所有靶都是月检，周检矩阵会空"
