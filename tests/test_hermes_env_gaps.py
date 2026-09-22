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


def test_parser_survives_ci_colour_and_project_tags():
    """真 CI 日志的形态（2026-09-21 实证）：vitest 在 runner 上照样上色，FAIL 行以转义
    序列开头；无色（本地）写 `|ui| path`，彩色剥离后写 `ui  path`。两种形态必须落到
    **同一个 nodeid**，否则台账永远对不上——组装线 run 35606424068 正是栽在这里：
    一条失败都没解析出来，在册两条被当成死条目，闸门按纪律停手、包出不来。
    """
    verify = _load_verify()
    ci = ("\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[45m ui \x1b[49m\x1b[39m "
          "src/store/voice-prefs.test.ts\x1b[2m > \x1b[22mkeeps the desktop toggle local\n"
          "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[31m2 failed\x1b[39m\x1b[22m\x1b[2m | "
          "\x1b[22m\x1b[1m\x1b[32m9879 passed\x1b[39m\x1b[22m\x1b[2m | \x1b[22m"
          "\x1b[33m6 skipped\x1b[39m\n")
    plain = (" FAIL  |ui| src/store/voice-prefs.test.ts > keeps the desktop toggle local\n"
             "      Tests  2 failed | 9879 passed | 6 skipped\n")
    expected = ["src/store/voice-prefs.test.ts > keeps the desktop toggle local"]
    assert verify.parse_vitest_failures(ci) == expected, "彩色输出必须能解析"
    assert verify.parse_vitest_failures(plain) == expected, "无色输出必须归一到同一 nodeid"
    counts = {"failed": 2, "passed": 9879, "skipped": 6}
    assert verify.parse_vitest_counts(ci) == counts
    assert verify.parse_vitest_counts(plain) == counts


def test_parser_keeps_whole_file_and_untagged_forms_intact():
    """去 project 标签不得误伤：整档崩只有路径，无目录的档名也不该被吃掉前半截。"""
    verify = _load_verify()
    assert verify.parse_vitest_failures(" FAIL  src/boom.test.ts") == ["src/boom.test.ts"]
    assert verify.parse_vitest_failures(" FAIL  voice-prefs.test.ts > a case") == [
        "voice-prefs.test.ts > a case"]


def test_ledger_ids_carry_no_project_tag():
    """台账登记的是归一后的形态——带 |ui| 前缀的条目永远匹配不上解析结果。"""
    data = json.loads(GAPS_LEDGER.read_text(encoding="utf-8"))
    for e in data["entries"]:
        assert not e["nodeid"].startswith("|"), f"台账条目带 project 标签：{e['nodeid']}"


def test_counts_parsing_has_one_implementation():
    """两条腿与 CI 入口共用同一个计数解析，别再各写各的正则。"""
    gate = (VERIFY.parent / "desktop_net_gate.py").read_text(encoding="utf-8")
    assert "parse_vitest_counts" in gate, "CI 入口须复用 verify.parse_vitest_counts"
    assert "Tests\\s+" not in gate, "CI 入口不得自带一份计数正则"


def test_render_names_every_exempted_case():
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    r = verify.evaluate_desktop_net(1, {"failed": 1, "passed": 9}, [nid], _entry(nid))
    r.update({"leg": "desktop-net", "run_seconds": 300})
    text = verify.render(r)
    assert nid in text and "闸门放行" in text and "2026-09-18" in text


def test_assembly_workflow_runs_the_regression_net_through_the_gate():
    """两条链一个判词（守密人 2026-09-19 裁定接线）。

    组装线那一步曾是裸 `npx vitest run`：闭环放行、组装线卡死，包出不来——
    2026-09-19 首次触发即实证（CI 9,879 过 / 2 红，红的正是台账在册的两条）。
    本例守的是「别改回裸 vitest」。
    """
    wf = (REPO / ".github" / "workflows" / "assemble-black-pool-bundle.yml").read_text(encoding="utf-8")
    assert "desktop_net_gate.py" in wf, "组装线的回归网必须经闸门入口，不得直接跑 vitest"
    net_step = wf[wf.index("Desktop unit tests"):]
    net_step = net_step[:net_step.index("\n  assemble:")] if "\n  assemble:" in net_step else net_step
    assert "npx vitest run" not in net_step, "回归网步骤里仍有裸 npx vitest run——判词又分叉了"


def test_gate_entry_point_reuses_the_single_verdict_function():
    """CI 入口不得自带一套判定——它只能转调 verify 的那一个纯函数。"""
    src = (VERIFY.parent / "desktop_net_gate.py").read_text(encoding="utf-8")
    assert "evaluate_desktop_net" in src, "CI 入口须复用 verify.evaluate_desktop_net"
    assert "parse_vitest_failures" in src, "CI 入口须复用同一套失败解析"
    for forbidden in ("known_map=", "gaps.md 免", "return 0  # 放行"):
        assert forbidden not in src, f"CI 入口疑似自带放行逻辑：{forbidden}"


def test_build_failure_is_never_exempted():
    """构建腿是先决条件，不在四条放行前提之列（守密人 2026-09-21 裁定纳入回归网）。

    2026-09-21 实测：上游把 compactNumber 挪进共享包后，vitest 全绿而 vite build 报
    UNLOADABLE_DEPENDENCY——构建塌了台账管不着，塌就是塌。
    """
    verify = _load_verify()
    nid = "src/x.test.ts > suite > case"
    ok = verify.evaluate_desktop_net(1, {"failed": 1, "passed": 9}, [nid], _entry(nid),
                                     build_ok=True)
    assert ok["passed"] and ok["gated"], "构建过 + 全部在册 → 照常放行"
    for rc, counts, fails in ((1, {"failed": 1, "passed": 9}, [nid]),
                              (0, {"failed": 0, "passed": 9}, [])):
        bad = verify.evaluate_desktop_net(rc, counts, fails, _entry(nid), build_ok=False)
        assert not bad["passed"], "构建塌了即整条未过，vitest 绿不绿都一样"
        assert bad["build_ok"] is False


def test_both_legs_actually_run_the_build():
    """闭环与 CI 入口都必须真跑 npm run build，别让它只活在文档里。"""
    verify_src = VERIFY.read_text(encoding="utf-8")
    assert "def run_desktop_build" in verify_src
    assert '"npm", "run", "build"' in verify_src, "构建腿须真调 npm run build"
    assert "build = run_desktop_build(desktop)" in verify_src, "闭环回归网须调用构建腿"
    gate_src = (VERIFY.parent / "desktop_net_gate.py").read_text(encoding="utf-8")
    assert "run_desktop_build" in gate_src, "CI 入口须调用同一条构建腿"
    assert "build_ok=build[" in gate_src, "CI 入口须把构建结论喂进判定"


def test_pin_note_tells_gated_from_all_green():
    """§4.2 R3：放行不许写成全绿——移 pin 史的措辞必须能区分两者。"""
    src = (SUB / "build" / "sync_upstream.py").read_text(encoding="utf-8")
    assert "闭环绿；" in src and "已知环境缺口经受控闸门放行" in src
