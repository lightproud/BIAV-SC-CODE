"""Hermes 周更例程的机械守卫（守密人 2026-08-09 四项裁定落地）。

守什么：例程会话每周一 00:00（北京）开机时只有 CLAUDE.md 与手册两样东西，
所以**手册的指针必须全部指得实**、**引擎对台账的读写必须往返无损**。
这两条一旦断，例程不会响亮失败——它会安静地把台账写歪或照着死链空转。

全部离线：不碰网络、不碰 upstream/ 快照本体，只测纯函数与档案形态。
"""
import importlib.util
import re
import shutil
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "black-pool-agent"
ENGINE = SUB / "build" / "sync_upstream.py"
RUNBOOK = SUB / "WEEKLY-UPDATE.md"
UPSTREAM_MD = SUB / "UPSTREAM.md"


def _load():
    """按路径载入引擎（build/ 不是包，与顶层 scripts/ 同名风险隔离，同 charter 守卫做法）。"""
    spec = importlib.util.spec_from_file_location("bpa_sync_upstream", ENGINE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


eng = _load()


# ---------------------------------------------------------------- 台账往返


def test_read_pin_reads_the_real_ledger():
    """台账 pin 行是引擎的输入端。改坏形态 = 例程当场瞎，故拿真档案测。"""
    pin = eng.read_pin()
    assert re.fullmatch(r"v\d+\.\d+\.\d+(?:\.\d+)?", pin["tag"]), pin
    assert re.fullmatch(r"[0-9a-f]{40}", pin["sha"]), "pin 应记全 sha（回溯与 changelog 起点靠它）"
    assert re.fullmatch(r"\d+\.\d+\.\d+", pin["engine"]), pin


def test_write_pin_round_trip(tmp_path, monkeypatch):
    """写回后必须还能读出来，且**只动机器所有区**。

    三条不变量：① 当前 pin 表三行被换新；② 移 pin 史既有行一字不改、新行追加在表尾；
    ③ 表与后续小标题之间的空行不被吃掉（早期 `\\s*$` 正则把换行连着空行一起吞，
    表和下一个标题粘成一坨，markdown 渲染当场垮）。
    """
    fake = tmp_path / "UPSTREAM.md"
    shutil.copy(UPSTREAM_MD, fake)
    monkeypatch.setattr(eng, "UPSTREAM_MD", fake)

    before = fake.read_text(encoding="utf-8")
    old_hist_rows = [l for l in before.splitlines()
                     if re.match(r"^\| \d{4}-\d{2}-\d{2} \| `v", l)]

    eng.write_pin(tag="v2099.1.1", sha="a" * 40, tag_date="2099-01-01", engine="9.9.9",
                  files=1234, size="99MB", note="守卫用例")

    after = fake.read_text(encoding="utf-8")
    pin = eng.read_pin(after)
    assert pin["tag"] == "v2099.1.1" and pin["engine"] == "9.9.9" and pin["sha"] == "a" * 40
    assert "| 快照规模 | 1,234 文件 / 99MB |" in after
    assert re.search(r"^\| 入仓日 \| \d{4}-\d{2}-\d{2} \|$", after, re.M)

    new_hist_rows = [l for l in after.splitlines()
                     if re.match(r"^\| \d{4}-\d{2}-\d{2} \| `v", l)]
    assert new_hist_rows[:len(old_hist_rows)] == old_hist_rows, "既有移 pin 史被改动"
    assert new_hist_rows[-1].startswith("| ") and "`v2099.1.1`" in new_hist_rows[-1]
    assert "守卫用例" in new_hist_rows[-1]

    assert "|\n## 移 pin 史" not in after, "表与后续标题之间的空行被吃掉（\\s*$ 复发）"
    assert re.search(r"^\| 入仓日 \|[^\n]*\|\n\n", after, re.M), "入仓日行后应留空行"


def test_write_pin_refuses_a_mangled_ledger(tmp_path, monkeypatch):
    """台账形态被改坏时**抛错**，不得模糊匹配硬写——写歪比不写更坏。"""
    fake = tmp_path / "UPSTREAM.md"
    fake.write_text("# 台账\n\n这里没有任何表。\n", encoding="utf-8")
    monkeypatch.setattr(eng, "UPSTREAM_MD", fake)
    with pytest.raises(eng.SyncError):
        eng.write_pin(tag="v1.2.3", sha="b" * 40, tag_date="2099-01-01", engine="1.0.0",
                      files=1, size="1MB", note="x")


def test_version_constants_are_reachable_and_consistent(tmp_path, monkeypatch):
    """两处版本硬编码点必须存在，且**当前值与台账一致**。

    漏改是移 pin 的经典静默坑：About 出身行挂着上一版号继续渲染，
    补丁照样干净应用、守卫照样绿，穿帮要等用户点开关于页。
    """
    engine_ver = eng.read_pin()["engine"]
    assert f'UPSTREAM_VERSION = "{engine_ver}"' in eng.REBRAND.read_text(encoding="utf-8"), \
        "rebrand.py 的 UPSTREAM_VERSION 与台账 pin 对不上（移 pin 漏同步）"
    assert f"基于 Hermes Agent {engine_ver} 定制" in eng.CHARTER_TEST.read_text(encoding="utf-8"), \
        "charter 守卫的出身行哨兵与台账 pin 对不上"

    reb, chart = tmp_path / "rebrand.py", tmp_path / "charter.py"
    shutil.copy(eng.REBRAND, reb)
    shutil.copy(eng.CHARTER_TEST, chart)
    monkeypatch.setattr(eng, "REBRAND", reb)
    monkeypatch.setattr(eng, "CHARTER_TEST", chart)
    touched = eng.sync_version_constants("9.9.9")
    assert len(touched) == 2, touched
    assert 'UPSTREAM_VERSION = "9.9.9"' in reb.read_text(encoding="utf-8")
    assert "基于 Hermes Agent 9.9.9 定制" in chart.read_text(encoding="utf-8")


# ---------------------------------------------------------------- 撞面判定


def _created_by_patch(patch: Path) -> set[str]:
    """补丁**新建**的文件（`new file mode` 紧跟在 diff --git 之后）。

    这些路径当然不在旧快照里——它们是补丁自己造的（如成本面板的 usage-ledger.ts）。
    但它们仍属补丁面：上游哪天自己新建同名文件，补丁就当场撞车。
    """
    created, pending = set(), None
    for line in patch.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^diff --git a/(.+?) b/", line)
        if m:
            pending = m.group(1)
        elif line.startswith("new file mode") and pending:
            created.add(pending)
            pending = None
    return created


def test_patch_surfaces_are_real_paths():
    """补丁面是「撞不撞」的地面真相，路径坐标系必须与上游提交一致（相对 upstream 根）。

    坐标系错位不会报错，只会让撞面判定**恒为空**——一条高风险都不报，
    读起来像「本周特别干净」。故逐条核到快照里真有这个文件。
    """
    surfaces = eng.patch_target_files()
    assert set(eng.GENERATED_PATCHES) <= set(surfaces), "规则引擎两张补丁不在册"
    feature = {n: f for n, f in surfaces.items() if n not in eng.GENERATED_PATCHES}
    assert feature, "一张手维护特性补丁都没有——白名单变了就同步改本守卫"
    for name, files in surfaces.items():
        assert files, f"{name} 解不出任何目标文件（补丁格式变了？）"
        created = _created_by_patch(SUB / "patches" / name)
        existing = files - created
        assert existing, f"{name} 全是新建文件，坐标系无从校验"
        for f in files:
            assert not f.startswith("/") and ".." not in f, f"{name} 路径形态异常: {f}"
        for f in existing:
            assert (eng.UPSTREAM / f).exists(), f"{name} 指向快照里不存在的文件: {f}"


def test_changelog_flags_only_real_surface_hits():
    """撞面判定走**文件交集**，不许退回关键词猜。

    关键词法在 0.19.1→0.20.0 区间把 945 提交里的 257 条报成高风险（27%），
    等于没报；文件交集报 38 条且正中当次真需人工重放的那个文件。
    """
    surfaces = eng.patch_target_files()
    feature_name = next(n for n in surfaces if n not in eng.GENERATED_PATCHES)
    target = sorted(surfaces[feature_name])[0]

    commits = [
        {"sha": "aaaaaaaa", "subject": "fix(x): touches our patch surface", "kind": "fix",
         "scope": "x", "files": [target], "author": "a", "date": "2026-08-09"},
        # 标题里塞满旧关键词、但一个补丁面文件都没动 —— 必须**不**报高风险
        {"sha": "bbbbbbbb", "subject": "test(update): desktop theme billing cloud update",
         "kind": "test", "scope": "update", "files": ["README.md"], "author": "b",
         "date": "2026-08-09"},
    ]
    md = eng.changelog_markdown(commits, from_tag="v1.0.0", to_tag="v1.0.1")
    assert "aaaaaaaa" in md, "真撞面的提交没被列出"
    assert "bbbbbbbb" not in md.split("### 撞特性补丁面")[1].split("### 撞品牌换装覆盖面")[0], \
        "关键词吓人但没撞面的提交被误报"
    assert "撞特性补丁面" in md and "撞品牌换装覆盖面" in md


def test_changelog_is_honest_about_an_empty_range():
    """空区间 ≠ 上游没改（回钉 / 旁支 / 起点 sha 失效都会空），必须明说算不出来。"""
    md = eng.changelog_markdown([], from_tag="v2.0.0", to_tag="v1.0.0")
    assert "区间为空" in md and "算不出来" in md
    assert "不等于" in md


def test_tag_ordering_picks_the_真_latest():
    """tag 排序按数值元组，不按字典序——字典序会把 v2026.8.3 排在 v2026.7.30 前面。"""
    names = ["v2026.7.7", "v2026.7.7.2", "v2026.7.30", "v2026.8.3", "nightly", "v2026.8.3-rc1"]
    keyed = sorted((tuple(int(g) for g in m.groups() if g is not None), n)
                   for n in names if (m := eng.TAG_RE.match(n)))
    assert [n for _, n in keyed] == ["v2026.7.7", "v2026.7.7.2", "v2026.7.30", "v2026.8.3"]
    assert keyed[-1][1] == "v2026.8.3"


# ---------------------------------------------------------------- 手册指针


def test_runbook_pointers_all_resolve():
    """手册里点名的每个仓内路径都必须真存在——例程会开机照着它敲命令。"""
    text = RUNBOOK.read_text(encoding="utf-8")
    referenced = set(re.findall(r"`((?:projects|scripts|tests|Public-Info-Pool)/[\w./-]+)`", text))
    assert referenced, "手册一个仓内路径都没点名，指针守卫失去意义"
    missing = [p for p in referenced if not (REPO / p).exists()]
    assert not missing, f"手册指向不存在的路径: {missing}"


def test_runbook_carries_the_four_rulings():
    """守密人 2026-08-09 四项裁定必须在手册里可查，否则未来会话会照默认习惯办事。"""
    text = RUNBOOK.read_text(encoding="utf-8")
    for phrase in ("周一 00:00", "0 16 * * 0", "直推 main", "assemble-black-pool-bundle.yml",
                   "black-pool-win64.zip"):
        assert phrase in text, f"手册缺裁定要素: {phrase}"
    assert "black-pool-public-win64.zip" not in text.split("## 6.")[1].split("## 7.")[0], \
        "第 6 步不得触发公版（裁定：只出私有版）"


def test_runbook_and_engine_agree_on_exit_codes():
    """退出码是例程分流的唯一依据，手册与引擎的语义必须逐条对上。"""
    doc = ENGINE.read_text(encoding="utf-8").split('"""')[1]
    assert "3  **特性补丁在新基底上冲突**" in doc
    run = RUNBOOK.read_text(encoding="utf-8")
    assert "退出码" in run and "`3`" in run and "`2`" in run


def test_ledger_routine_section_points_at_the_engine():
    """`UPSTREAM.md` 同步例程是引擎行为的地面真相——两者必须互相指得到。

    手办与自动跑必须是同一条例程；台账不提引擎，下一个手办的人就会走出第二套流程。
    """
    text = UPSTREAM_MD.read_text(encoding="utf-8")
    assert "WEEKLY-UPDATE.md" in text and "build/sync_upstream.py" in text
    assert "## 移 pin 史" in text, "机器追加区标题被改，引擎会当场抛错"
    assert "机器追加区" in text, "追加区的守护注释被删（下一个人会手改表尾）"


def test_engine_never_commits_or_pushes():
    """引擎的射程边界：只改工作树，绝不代人提交/推送/触发组装。

    越界即意味着「守卫还没跑就已经推上去了」——判定门在守卫，不在引擎。
    """
    src = ENGINE.read_text(encoding="utf-8")
    for forbidden in ('"commit"', '"push"', '"gh"', "workflow run"):
        assert forbidden not in src, f"引擎里出现越界动作: {forbidden}"
    assert '"add", "-f", "-A"' in src, "暂存是算文件级变更账的前置，不该被删"
