"""换装后回归网「已知环境缺口」受控豁免闸门的守卫（守密人 2026-09-18 裁定）。

由来：2026-09-13 周更例程撞上 `voice-prefs.test.ts` 两条用例在本沙箱 jsdom/vitest
版本组合下恒红——既非银芯补丁引入，也非上游实现缺陷，但当时闸门是纯二元，没有放行
口子，闭环整条卡死、pin 未移（gaps.md 2026-09-13 条 (b) 项）。守密人裁定给回归网开
一道**受控**豁免口。

本档守的是那个「受控」：豁免口一旦松成「自动无视」，验证网就等于没有。故这里把闸门的
四条前提逐条钉死，并对台账本身设形式门禁（逐条具名 / 用例级 / 带裁定出处）。
"""
import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "black-pool-agent"
VERIFY = SUB / "build" / "verify.py"
GAPS_LEDGER = SUB / "build" / "desktop-env-gaps.json"
GAPS_DOC = SUB / "gaps.md"


def _load_verify():
    spec = importlib.util.spec_from_file_location("bpa_verify_test", VERIFY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _entry(nodeid="src/x.test.ts > suite > case"):
    return {nodeid: {"nodeid": nodeid, "cluster": "E 测试环境 API 伪影",
                     "reason": "沙箱 jsdom 版本的 spy 拦截缺陷，最小复现已实证",
                     "source": "gaps.md 2026-09-13 条",
                     "decided_on": "2026-09-18", "decided_by": "守密人"}}


# ---------------------------------------------------------------- 台账形式门禁


def test_ledger_is_valid_json_with_discipline_doc():
    data = json.loads(GAPS_LEDGER.read_text(encoding="utf-8"))
    assert isinstance(data.get("entries"), list), "台账须有 entries 数组"
    doc = "\n".join(data.get("_doc", []))
    for must in ("只由人工增补", "逐条点名", "精确", "decided_on"):
        assert must in doc, f"台账纪律段缺「{must}」——纪律写不出来的台账就是免死金牌"


def test_every_ledger_entry_carries_a_keeper_ruling():
    """每条豁免都是拿守密人裁定换来的：缺任一出处字段即不许在册。"""
    data = json.loads(GAPS_LEDGER.read_text(encoding="utf-8"))
    for e in data["entries"]:
        for field in ("nodeid", "cluster", "reason", "source", "decided_on", "decided_by"):
            assert e.get(field), f"台账条目缺 {field}：{e.get('nodeid', '<空>')}"
        assert " > " in e["nodeid"], f"台账条目须为用例级（含 ' > '）：{e['nodeid']}"
        assert "*" not in e["nodeid"], f"台账不认通配：{e['nodeid']}"


def test_ledger_entries_are_traceable_in_gaps_doc():
    """在册条目必须能在 gaps.md 找到落档——台账只放指针，长叙事在 gaps.md。"""
    data = json.loads(GAPS_LEDGER.read_text(encoding="utf-8"))
    if not data["entries"]:
        pytest.skip("台账为空（尚无豁免），无可追溯项")
    doc = GAPS_DOC.read_text(encoding="utf-8")
    for e in data["entries"]:
        stem = e["nodeid"].split(" > ")[0].split("/")[-1]
        assert stem in doc, f"在册条目 {e['nodeid']} 在 gaps.md 无落档"


def test_loader_refuses_entry_without_ruling(tmp_path, monkeypatch):
    verify = _load_verify()
    bad = tmp_path / "gaps.json"
    bad.write_text(json.dumps({"entries": [
        {"nodeid": "a.test.ts > s > c", "reason": "r", "source": "s"}]}), encoding="utf-8")
    monkeypatch.setattr(verify, "DESKTOP_GAPS", bad)
    with pytest.raises(verify.VerifyError, match="decided_on"):
        verify.load_desktop_gaps()


def test_loader_refuses_file_level_entry(tmp_path, monkeypatch):
    """整档崩不可豁免：连入册都不许，不必等到判定那一步。"""
    verify = _load_verify()
    bad = tmp_path / "gaps.json"
    bad.write_text(json.dumps({"entries": [
        {"nodeid": "a.test.ts", "cluster": "E", "reason": "r", "source": "s",
         "decided_on": "2026-09-18", "decided_by": "守密人"}]}), encoding="utf-8")
    monkeypatch.setattr(verify, "DESKTOP_GAPS", bad)
    with pytest.raises(verify.VerifyError, match="用例级"):
        verify.load_desktop_gaps()


def test_missing_ledger_means_zero_exemption(tmp_path, monkeypatch):
    """缺档 = 回到纯二元闸门，而不是报错跑不动，更不是默默放行。"""
    verify = _load_verify()
    monkeypatch.setattr(verify, "DESKTOP_GAPS", tmp_path / "nope.json")
    assert verify.load_desktop_gaps() == {}
    r = verify.evaluate_desktop_net(1, {"failed": 1, "passed": 9},
                                    ["src/x.test.ts > suite > case"])
    assert r["passed"] is False and r["gated"] is False


# ---------------------------------------------------------------- 闸门四条前提


def test_gate_lets_through_only_registered_failures():
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    r = verify.evaluate_desktop_net(1, {"failed": 1, "passed": 9}, [nid], _entry(nid))
    assert r["passed"] and r["gated"], "全部在册 + 计数对得上 → 放行"
    assert [e["nodeid"] for e in r["known"]] == [nid], "在册者须逐条点名回传（豁免不等于隐身）"


def test_gate_halts_on_any_unregistered_failure():
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    r = verify.evaluate_desktop_net(1, {"failed": 2, "passed": 9},
                                    [nid, "src/y.test.ts > suite > other"], _entry(nid))
    assert not r["passed"] and not r["gated"], "台账外一条都不许放行"
    assert [e["nodeid"] for e in r["unknown"]] == ["src/y.test.ts > suite > other"]


def test_gate_halts_when_counts_disagree_with_parse():
    """解析漂了的正确反应是不放行——数字对不上不是结论，是警报。"""
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    r = verify.evaluate_desktop_net(1, {"failed": 3, "passed": 9}, [nid], _entry(nid))
    assert not r["passed"] and not r["parse_consistent"]


def test_gate_halts_on_whole_file_crash():
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    r = verify.evaluate_desktop_net(1, {"failed": 1, "passed": 9},
                                    [nid, "src/boom.test.ts"], _entry(nid))
    assert not r["passed"] and r["file_level_failures"] == ["src/boom.test.ts"]


def test_gate_halts_when_red_but_no_case_level_failure():
    """红着却抓不出用例条目 = 说不清是什么红，不放行。"""
    verify = _load_verify()
    r = verify.evaluate_desktop_net(1, {"failed": 0, "passed": 9}, [], _entry())
    assert not r["passed"] and not r["gated"]


def test_green_run_needs_no_gate():
    verify = _load_verify()
    r = verify.evaluate_desktop_net(0, {"failed": 0, "passed": 9784, "skipped": 3}, [], {})
    assert r["passed"] and not r["gated"]


def test_stale_entries_are_reported_for_human_pruning():
    verify = _load_verify()
    r = verify.evaluate_desktop_net(0, {"failed": 0, "passed": 9}, [], _entry())
    assert r["stale"] == ["src/x.test.ts > suite > case"], "死条目须点名供人工清理"


# ---------------------------------------------------------------- 解析与渲染


def test_vitest_parser_separates_case_and_file_level():
    verify = _load_verify()
    log = (" FAIL  src/store/voice-prefs.test.ts > voice prefs > migrates once\n"
           " FAIL  src/store/voice-prefs.test.ts > voice prefs > migrates once\n"
           " FAIL  src/boom.test.ts\n")
    assert verify.parse_vitest_failures(log) == [
        "src/boom.test.ts",
        "src/store/voice-prefs.test.ts > voice prefs > migrates once"], "须去重并规范空白"


def test_render_names_every_exempted_case():
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    r = verify.evaluate_desktop_net(1, {"failed": 1, "passed": 9}, [nid], _entry(nid))
    r.update({"leg": "desktop-net", "run_seconds": 300})
    text = verify.render(r)
    assert nid in text and "闸门放行" in text and "2026-09-18" in text


def test_pin_note_tells_gated_from_all_green():
    """§4.2 R3：放行不许写成全绿——移 pin 史的措辞必须能区分两者。"""
    src = (SUB / "build" / "sync_upstream.py").read_text(encoding="utf-8")
    assert "闭环绿；" in src and "已知环境缺口经受控闸门放行" in src
