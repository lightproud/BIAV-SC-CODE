"""变异棘轮矩阵对账 —— 「没人跑的地板不是棘轮」。

2026-07-26 值班发现（todo T64 ①）：`loop-support` 的地板 94.35 自 2026-07-17 起
就躺在 `mutation-ratchet.json` 里，却**没有对应的周检矩阵腿**——从未被重新测过。
地板文件与工作流矩阵是两份手写清单，加靶时漏改任一份都不会有人喊，于是「已上棘轮」
成了错觉。工作流注释里写着「Matrix names must match mutation-ratchet.json」，但
守卫脚本只挡「矩阵里有、地板里没有」（未知靶名响亮失败），**反方向是哑的**。

本组测试把两份清单的**双向**一致性钉成 CI 硬报错：
- 地板有靶而矩阵无腿 → 该地板永不复测（本次真实踩到的方向）；
- 矩阵有腿而地板无靶 → 守卫脚本会在运行期失败，这里提前到静态期报。

零构建：只读 committed 的 yaml + 两个 json。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "sdk-mutation-ratchet.yml"

# job 名 → 该 job 复测的 mutation-ratchet.json 所在包
JOB_BASELINES = {
    "ratchet": REPO / "projects" / "silver-core-sdk" / "mutation-ratchet.json",
    "ratchet-maestro": REPO / "projects" / "silver-core-maestro-sdk" / "mutation-ratchet.json",
}


def _matrix_targets(job_name: str) -> list[str]:
    wf = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job = wf["jobs"][job_name]
    return list(job["strategy"]["matrix"]["target"])


def _floor_targets(baseline: Path) -> list[str]:
    return [t["name"] for t in json.loads(baseline.read_text(encoding="utf-8"))["targets"]]


@pytest.mark.parametrize("job_name", sorted(JOB_BASELINES))
def test_every_floor_has_a_matrix_leg(job_name: str) -> None:
    """地板文件里的每个靶都必须有周检矩阵腿——否则它永远不会被复测。"""
    floors = set(_floor_targets(JOB_BASELINES[job_name]))
    matrix = set(_matrix_targets(job_name))
    never_measured = sorted(floors - matrix)
    assert not never_measured, (
        f"{job_name}: 这些地板没有矩阵腿、永不复测: {never_measured}. "
        f"加靶时须同时改 mutation-ratchet.json 与 sdk-mutation-ratchet.yml 的 matrix.target"
    )


@pytest.mark.parametrize("job_name", sorted(JOB_BASELINES))
def test_every_matrix_leg_has_a_floor(job_name: str) -> None:
    """矩阵腿必须在地板文件里有靶——否则该腿在运行期才炸（未知靶名）。"""
    floors = set(_floor_targets(JOB_BASELINES[job_name]))
    matrix = set(_matrix_targets(job_name))
    unknown = sorted(matrix - floors)
    assert not unknown, f"{job_name}: 矩阵腿在 mutation-ratchet.json 中无对应靶: {unknown}"


def test_the_two_jobs_do_not_share_targets() -> None:
    """两包的靶名不得互串——串了会拿错包的地板判分。"""
    agent = set(_floor_targets(JOB_BASELINES["ratchet"]))
    maestro = set(_floor_targets(JOB_BASELINES["ratchet-maestro"]))
    assert not (agent & maestro), f"两包靶名重叠: {sorted(agent & maestro)}"
