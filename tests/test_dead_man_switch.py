"""死手开关单测 —— 守卫自己也得被守。

覆盖三块：cron 字段展开与期望间隔推导（阈值的唯一来源，算错则全盘误报）、
沉默判定（ok / stale / never / skipped 四态与两道宽限）、状态产出形态。

全部注入式：不碰网络、不读真 Actions API——守卫必须能在无凭据环境下跑（元规则之二）。
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import dead_man_switch as dms  # noqa: E402

NOW = datetime(2026, 7, 26, 0, 0, tzinfo=timezone.utc)


class TestCronFields:
    def test_star_expands_to_full_range(self):
        assert dms.parse_field("*", 0, 5) == {0, 1, 2, 3, 4, 5}

    def test_step_and_list_and_range(self):
        assert dms.parse_field("*/3", 0, 23) == {0, 3, 6, 9, 12, 15, 18, 21}
        assert dms.parse_field("1,5", 0, 59) == {1, 5}
        assert dms.parse_field("2-4", 0, 59) == {2, 3, 4}
        assert dms.parse_field("0-6/2", 0, 6) == {0, 2, 4, 6}

    @pytest.mark.parametrize("bad", ["*/0", "99", "5-1", "60"])
    def test_illegal_specs_raise(self, bad):
        with pytest.raises(ValueError):
            dms.parse_field(bad, 0, 59)


class TestExpectedInterval:
    """真实节拍必须算对——这些正是仓内在用的 cron。"""

    @pytest.mark.parametrize(
        "cron,hours",
        [
            ("0 */3 * * *", 3.0),      # update-news
            ("40 * * * *", 1.0),       # backfill-media
            ("15 7 * * *", 24.0),      # store-patrol
            ("43 5 * * 1", 168.0),     # sdk-mutation-ratchet
            ("23 4 3 * *", 744.0),     # community-platform-backup（月度，需 >31 天采样窗）
        ],
    )
    def test_single_cron(self, cron, hours):
        assert dms.expected_interval_hours([cron], NOW) == pytest.approx(hours, abs=1.0)

    def test_multi_cron_takes_the_widest_gap_of_the_union(self):
        """discord-archive 同时有每日与每月两条：并集的最大间隔仍是 24h。

        取最大而非平均——平均会得出一个没有任何一条 cron 真正满足的阈值。
        """
        assert dms.expected_interval_hours(["0 7 * * *", "0 6 1 * *"], NOW) == pytest.approx(24.0)

    def test_five_fields_required(self):
        with pytest.raises(ValueError):
            dms.expected_interval_hours(["0 7 * *"], NOW)


class TestClassify:
    def _entry(self, **over):
        base = {"expected_interval_h": 24.0, "state": "active"}
        base.update(over)
        return base

    def test_recent_success_is_ok(self):
        entry = self._entry(last_success=(NOW - timedelta(hours=20)).isoformat())
        assert dms.classify(entry, NOW)[0] == "ok"

    def test_silence_beyond_threshold_is_stale(self):
        """store-patrol 的形态：日更工作流，最近一次成功在 8 天前。"""
        entry = self._entry(last_success=(NOW - timedelta(days=8)).isoformat())
        state, note = dms.classify(entry, NOW)
        assert state == "stale"
        assert "超阈值" in note

    def test_within_factor_two_is_still_ok(self):
        """×2 + 宽限：日更工作流漏一轮不报，漏两轮才报——GitHub 定时本就会延迟。"""
        entry = self._entry(last_success=(NOW - timedelta(hours=40)).isoformat())
        assert dms.classify(entry, NOW)[0] == "ok"

    def test_never_succeeded_past_grace_is_never(self):
        """community-platform-backup 的形态：建好即坏、从未成功过。"""
        entry = self._entry(created_at=(NOW - timedelta(days=30)).isoformat(), last_success=None)
        state, note = dms.classify(entry, NOW)
        assert state == "never"
        assert "从无一次成功" in note

    def test_brand_new_workflow_is_not_reported(self):
        """新建工作流在首个 cron 到期 + 一个周期内不报——否则每加一个新件就红一次。"""
        entry = self._entry(created_at=(NOW - timedelta(hours=6)).isoformat(), last_success=None)
        assert dms.classify(entry, NOW)[0] == "ok"

    def test_disabled_workflow_is_skipped_not_accused(self):
        entry = self._entry(state="disabled_manually", last_success=None)
        assert dms.classify(entry, NOW)[0] == "skipped"

    def test_unknown_when_no_evidence_at_all(self):
        assert dms.classify(self._entry(last_success=None, created_at=None), NOW)[0] == "unknown"


class TestBuildStatus:
    def test_status_shape_and_findings_count(self, tmp_path):
        wf = tmp_path / "workflows"
        wf.mkdir()
        (wf / "daily.yml").write_text("on:\n  schedule:\n    - cron: '0 7 * * *'\n", encoding="utf-8")
        (wf / "manual.yml").write_text("on:\n  workflow_dispatch:\n", encoding="utf-8")

        def fetch(name):
            return {
                "created_at": (NOW - timedelta(days=90)).isoformat(),
                "state": "active",
                "last_success": (NOW - timedelta(days=9)).isoformat(),
            }

        status = dms.build_status(fetch, NOW, workflow_dir=wf)
        # 纯 dispatch 的不纳入：它本就不该定期出声
        assert status["watched"] == 1
        assert status["findings"] == 1
        assert status["entries"][0]["workflow"] == "daily.yml"
        assert status["entries"][0]["state"] == "stale"
        assert status["generated_at"] == NOW.isoformat()

    def test_api_failure_degrades_to_unknown_not_to_silence(self, tmp_path):
        """查不到 ≠ 没事：降级为 unknown 并留痕，绝不悄悄算作 ok。"""
        wf = tmp_path / "workflows"
        wf.mkdir()
        (wf / "daily.yml").write_text("on:\n  schedule:\n    - cron: '0 7 * * *'\n", encoding="utf-8")

        def boom(name):
            raise OSError("network down")

        status = dms.build_status(boom, NOW, workflow_dir=wf)
        assert status["entries"][0]["state"] == "unknown"
        assert status["findings"] == 0


def test_real_workflows_all_yield_a_threshold():
    """仓内 24 个带 cron 的工作流必须条条能推导出间隔——推不出即阈值缺失、静默漏守。"""
    found = dms.scheduled_workflows()
    assert len(found) >= 20, f"带 cron 工作流仅 {len(found)} 个，疑似解析失效"
    for name, crons in found.items():
        assert dms.expected_interval_hours(crons, NOW) > 0, f"{name} 无法推导期望间隔"
