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
