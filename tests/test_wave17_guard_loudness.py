"""审计第十七波 · 三个守卫的「失明必须出声」（consumption_audit / dead_man_switch / memory_freshness）。

三个守卫共一个病根：**它们都能在什么都没查到的情况下报平安**。波次十七逐个补上出声路径，
本档钉的就是这些出声路径本身——守卫的信誉是一次性的，一次假绿就永久不值钱了。

| 守卫 | 原先的假绿 | 本档钉的观察点 |
|---|---|---|
| `consumption_audit` | `git grep` 退出码 ≥2（检索垮了）与 =1（确实没人读）合流成同一个空清单，于是每件产出都被判死件，一份伪造的退役清单盖在上一轮的真账上 | `SearchUnavailable` 抛出 / 报告一个字不写 / 退出码 2 |
| `dead_man_switch` | judged=0（token 失效、名单为空）时退 0，而它自己也在被看守名单里、判据正是「最近一次成功」——于是它给自己发了健康证明 | judged=0 必须退 1 |
| `memory_freshness` | 一条保鲜规则匹配不到任何档案时被静默跳过，报告照打「全部在保鲜期内」 | 落空规则必须单列上报 |

外加两处同型漏网面：GitHub 视 `.yml` 与 `.yaml` 等价，只认前者时整个工作流从名单里蒸发，
而摘要行照报 watched=N / 产出 N 件——看不出缺口。

全程零网络、零真实 CLI：`git grep`、Actions API、`git log` 一律打桩；文件全在 tmp_path。

小学生比喻：查寝的人手电筒坏了，回来还是喊「全员在铺」——这三处修的都是让他改喊
「我这灯不亮，今晚没查成」。
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
from datetime import datetime, timedelta, UTC
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import consumption_audit as ca  # noqa: E402
import dead_man_switch as dms  # noqa: E402
import memory_freshness as mf  # noqa: E402

NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


# ════════════════════════════════════════════════════════════════════════════
# 一、consumption_audit —— 「检索垮了」≠「确实没人读」
# ════════════════════════════════════════════════════════════════════════════

class _Completed:
    def __init__(self, returncode: int, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _fake_run(result):
    def run(*args, **kwargs):  # noqa: ARG001  与 subprocess.run 签名对齐
        if isinstance(result, BaseException):
            raise result
        return result
    return run


class TestGrepExitCodes:
    """git grep 的三档退出码必须分辨得清：0 命中 / 1 没命中 / ≥2 检索失败。"""

    def test_exit_zero_returns_hits(self, monkeypatch):
        monkeypatch.setattr(ca.subprocess, "run", _fake_run(
            _Completed(0, stdout="scripts/reader.py:3:open('out/x.json')\n")
        ))
        assert ca._grep("out/x.json") == ["scripts/reader.py:3:open('out/x.json')"]

    def test_exit_one_is_an_honest_empty_result(self, monkeypatch):
        """跑成了但零命中——这一档必须**照常返回空**，不许跟着一起判失败。"""
        monkeypatch.setattr(ca.subprocess, "run", _fake_run(_Completed(1)))
        assert ca._grep("out/nobody-reads-this.json") == []

    def test_exit_two_raises_search_unavailable(self, monkeypatch):
        """≥2 = 检索没跑成（非 git 目录 / tarball 导出 / 丢了 .git 的容器）。"""
        monkeypatch.setattr(ca.subprocess, "run", _fake_run(
            _Completed(128, stderr="fatal: not a git repository")
        ))
        with pytest.raises(ca.SearchUnavailable, match=r"退出码 128.*任何「零消费」结论都是假的"):
            ca._grep("out/x.json")

    def test_oserror_raises_search_unavailable(self, monkeypatch):
        """git 不在 PATH 同理——异常也不许被吞成空清单。"""
        monkeypatch.setattr(ca.subprocess, "run", _fake_run(FileNotFoundError("git")))
        with pytest.raises(ca.SearchUnavailable, match=r"git grep 没能执行"):
            ca._grep("out/x.json")

    def test_timeout_raises_search_unavailable(self, monkeypatch):
        monkeypatch.setattr(ca.subprocess, "run", _fake_run(
            subprocess.TimeoutExpired(cmd="git grep", timeout=60)
        ))
        with pytest.raises(ca.SearchUnavailable, match=r"git grep 没能执行"):
            ca._grep("out/x.json")

    def test_binary_file_lines_are_discarded(self, monkeypatch):
        """`Binary file <path> matches` 没有 path:line 形态，冒充路径会让真实消费关系蒸发。"""
        monkeypatch.setattr(ca.subprocess, "run", _fake_run(_Completed(
            0, stdout="Binary file assets/images/a.png matches\nscripts/r.py:1:x\n"
        )))
        assert ca._grep("okf") == ["scripts/r.py:1:x"]


class TestSearchFailureIsNotAReport:
    def test_main_writes_nothing_and_exits_two(self, tmp_path, monkeypatch, capsys):
        """检索垮掉时：上一轮的真账必须原封不动，退出码 2。"""
        out = tmp_path / "consumption.json"
        honest = {"artifacts": 25, "orphans": 1, "entries": []}
        out.write_text(json.dumps(honest), encoding="utf-8")

        def boom():
            raise ca.SearchUnavailable("git grep 退出码 128")

        monkeypatch.setattr(ca, "build_report", boom)
        rc = ca.main(["--out", str(out)])

        assert rc == 2
        assert json.loads(out.read_text(encoding="utf-8")) == honest, (
            "宁可什么都不说，也不许拿一份「全是死件」的假账盖住上一轮的真账"
        )
        assert "产出↔消费对账中止" in capsys.readouterr().err

    def test_main_writes_the_report_on_success(self, tmp_path, monkeypatch, capsys):
        """对照臂：检索正常时报告照写、退 0（否则上一条可能只是「总是 2」）。"""
        out = tmp_path / "nested" / "consumption.json"
        monkeypatch.setattr(ca, "produced_paths", lambda: {"out/thing.json": ["maker.yml"]})
        monkeypatch.setattr(ca, "produced_releases", lambda: {"community-data": ["up.yml"]})
        monkeypatch.setattr(ca, "_grep", lambda needle: [])  # noqa: ARG005  一律零命中
        rc = ca.main(["--out", str(out)])

        assert rc == 0
        report = json.loads(out.read_text(encoding="utf-8"))
        assert report["artifacts"] == 2
        assert report["orphans"] == 2
        assert report["blind_spots"], "盲区声明不许悄悄省掉"
        stdout = capsys.readouterr().out
        assert "ORPHAN" in stdout
        assert "候选清单供人裁，不是退役触发器" in stdout

    def test_dry_run_does_not_write(self, tmp_path, monkeypatch):
        out = tmp_path / "consumption.json"
        monkeypatch.setattr(ca, "produced_paths", dict)
        monkeypatch.setattr(ca, "produced_releases", dict)
        assert ca.main(["--out", str(out), "--dry-run"]) == 0
        assert not out.exists()


class TestYamlProducersAreDiscovered:
    """`.yaml` 与 `.yml` 等价——只认前者时，那个工作流的产出整件从对账里蒸发。"""

    @staticmethod
    def _workflows(tmp_path, monkeypatch):
        wf = tmp_path / "workflows"
        wf.mkdir()
        (wf / "alpha.yml").write_text(
            "jobs:\n  a:\n    steps:\n      - run: |\n          git add out/from-yml.json\n",
            encoding="utf-8",
        )
        (wf / "beta.yaml").write_text(
            "jobs:\n  b:\n    steps:\n      - run: |\n"
            "          git add out/from-yaml.json\n"
            "          gh release upload nightly-data blob.tar.gz\n",
            encoding="utf-8",
        )
        (wf / "notes.md").write_text("          git add out/not-a-workflow.json\n", encoding="utf-8")
        monkeypatch.setattr(ca, "WORKFLOW_DIR", wf)
        return wf

    def test_both_suffixes_are_collected(self, tmp_path, monkeypatch):
        self._workflows(tmp_path, monkeypatch)
        assert [p.name for p in ca._workflow_files()] == ["alpha.yml", "beta.yaml"]

    def test_produced_paths_covers_the_yaml_workflow(self, tmp_path, monkeypatch):
        self._workflows(tmp_path, monkeypatch)
        produced = ca.produced_paths()
        assert produced["out/from-yml.json"] == ["alpha.yml"]
        assert produced["out/from-yaml.json"] == ["beta.yaml"], (
            "`.yaml` 里的产出漏收 = 报告仍报「产出 N 件」，缺口看不出来"
        )
        assert "out/not-a-workflow.json" not in produced

    def test_produced_releases_covers_the_yaml_workflow(self, tmp_path, monkeypatch):
        self._workflows(tmp_path, monkeypatch)
        assert ca.produced_releases() == {"nightly-data": ["beta.yaml"]}

    def test_flags_and_variables_are_skipped(self, tmp_path, monkeypatch):
        """`git add -A` 范围不明、`$VAR` 无从对账——两者都不许冒充产出路径。"""
        wf = tmp_path / "wf"
        wf.mkdir()
        (wf / "x.yml").write_text(
            "    steps:\n      - run: |\n"
            "          git add -A ${GITHUB_WORKSPACE} out/real.json\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(ca, "WORKFLOW_DIR", wf)
        assert list(ca.produced_paths()) == ["out/real.json"]


class TestClassify:
    @pytest.mark.parametrize(
        ("path", "kind"),
        [
            (".github/workflows/a.yml", "workflow"),
            ("tests/test_x.py", "test"),
            ("scripts/x.py", "script"),
            ("projects/x/src/y.mjs", "script"),
            ("memory/notes.md", "doc"),
            ("data/blob.bin", "other"),
        ],
    )
    def test_buckets(self, path, kind):
        assert ca._classify(path) == kind


# ════════════════════════════════════════════════════════════════════════════
# 二、dead_man_switch —— judged=0 必须判红（它自己也在名单里）
# ════════════════════════════════════════════════════════════════════════════

class TestJudgedZeroIsRed:
    @staticmethod
    def _neutral_argv(tmp_path, monkeypatch):
        monkeypatch.setenv("GH_TOKEN", "")
        monkeypatch.setenv("GITHUB_TOKEN", "")
        return ["--repo", "owner/repo", "--out", str(tmp_path / "status.json")]

    def test_empty_watchlist_exits_non_zero(self, tmp_path, monkeypatch, capsys):
        """看守名单为空（稀疏检出裁掉 .github/workflows）：在什么都没查的情况下不许报平安。"""
        monkeypatch.setattr(dms, "scheduled_workflows", lambda workflow_dir=None: {})  # noqa: ARG005
        rc = dms.main(self._neutral_argv(tmp_path, monkeypatch))
        assert rc == 1, "watched=0 退 0 就是给自己发了一张健康证明"
        assert "judged=0" in capsys.readouterr().out

    def test_all_queries_failing_exits_non_zero(self, tmp_path, monkeypatch, capsys):
        """token 失效 / Actions API 不通：watched=1 judged=0 unknown=1 findings=0 —— 仍是红。"""
        monkeypatch.setattr(
            dms, "scheduled_workflows", lambda workflow_dir=None: {"a.yml": ["0 * * * *"]}  # noqa: ARG005
        )

        def fetcher(repo, token):  # noqa: ARG001
            def fetch(name):  # noqa: ARG001
                raise urllib.error.URLError("api unreachable")
            return fetch

        monkeypatch.setattr(dms, "github_fetcher", fetcher)
        out = tmp_path / "status.json"
        rc = dms.main(["--repo", "o/r", "--out", str(out)])

        assert rc == 1
        status = json.loads(out.read_text(encoding="utf-8"))
        assert (status["watched"], status["judged"], status["findings"]) == (1, 0, 0)
        assert "findings=0 在此不代表健康" in capsys.readouterr().out

    def test_healthy_watchlist_exits_zero(self, tmp_path, monkeypatch):
        """对照臂：真判过且都新鲜才允许退 0。"""
        monkeypatch.setattr(
            dms, "scheduled_workflows", lambda workflow_dir=None: {"a.yml": ["0 * * * *"]}  # noqa: ARG005
        )
        fresh = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
        monkeypatch.setattr(dms, "github_fetcher", lambda repo, token: lambda name: {  # noqa: ARG005
            "created_at": "2026-01-01T00:00:00+00:00", "state": "active", "last_success": fresh,
        })
        out = tmp_path / "status.json"
        assert dms.main(["--out", str(out)]) == 0
        assert json.loads(out.read_text(encoding="utf-8"))["judged"] == 1

    def test_findings_exit_non_zero(self, tmp_path, monkeypatch, capsys):
        """有沉默件时照旧退 1（本次修复不许把 findings 那条路踩坏）。"""
        monkeypatch.setattr(
            dms, "scheduled_workflows", lambda workflow_dir=None: {"stale.yml": ["0 * * * *"]}  # noqa: ARG005
        )
        old = (datetime.now(UTC) - timedelta(days=7)).isoformat()
        monkeypatch.setattr(dms, "github_fetcher", lambda repo, token: lambda name: {  # noqa: ARG005
            "created_at": "2026-01-01T00:00:00+00:00", "state": "active", "last_success": old,
        })
        assert dms.main(["--out", str(tmp_path / "s.json"), "--dry-run"]) == 1
        assert "[STALE" in capsys.readouterr().out

    def test_dry_run_writes_nothing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(dms, "scheduled_workflows", lambda workflow_dir=None: {})  # noqa: ARG005
        out = tmp_path / "status.json"
        dms.main(["--out", str(out), "--dry-run"])
        assert not out.exists()


class TestYamlCronsAreWatched:
    def test_both_suffixes_enter_the_watchlist(self, tmp_path):
        """一个 `nightly.yaml` 里的定时件不许从名单里整件蒸发。"""
        (tmp_path / "daily.yml").write_text(
            "on:\n  schedule:\n    - cron: '0 7 * * *'\n", encoding="utf-8"
        )
        (tmp_path / "nightly.yaml").write_text(
            'on:\n  schedule:\n    - cron: "30 3 * * *"\n', encoding="utf-8"
        )
        (tmp_path / "manual.yml").write_text("on:\n  workflow_dispatch:\n", encoding="utf-8")
        found = dms.scheduled_workflows(tmp_path)
        assert found == {"daily.yml": ["0 7 * * *"], "nightly.yaml": ["30 3 * * *"]}


class TestFetcherAndIntervalEdges:
    def test_github_fetcher_shapes_the_api_payload(self, monkeypatch):
        """Actions API 打桩（零网络）：meta + runs 两次查询压成一条记录。"""
        payloads = {
            "workflows/a.yml": {"created_at": "2026-01-01T00:00:00Z", "state": "active"},
            "workflows/a.yml/runs?status=success&per_page=1": {
                "workflow_runs": [{"updated_at": "2026-07-28T00:00:00Z"}]
            },
        }

        class _Resp:
            def __init__(self, body: bytes):
                self._body = body

            def read(self):
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return False

        def fake_urlopen(request, timeout=None):  # noqa: ARG001
            url = request.get_full_url()
            key = next(k for k in sorted(payloads, key=len, reverse=True) if url.endswith(k))
            return _Resp(json.dumps(payloads[key]).encode())

        monkeypatch.setattr(dms.urllib.request, "urlopen", fake_urlopen)
        record = dms.github_fetcher("owner/repo", "tok")("a.yml")
        assert record == {
            "created_at": "2026-01-01T00:00:00Z",
            "state": "active",
            "last_success": "2026-07-28T00:00:00Z",
        }

    def test_empty_workflow_dir_yields_an_empty_watchlist(self, tmp_path):
        """目录里没有工作流档：watched=0（main 会据此判红，见上一组）。"""
        status = dms.build_status(
            lambda name: pytest.fail(f"不该查询 {name}——名单是空的"),
            NOW,
            workflow_dir=tmp_path,
        )
        assert status["watched"] == 0

    def test_interval_derivation_failure_marks_unknown(self, monkeypatch, tmp_path):
        """采样窗内触发不足两次（2 月 29 日）：判 unknown 并跳过查询，绝不冒充 ok。"""
        (tmp_path / "leap.yml").write_text(
            "on:\n  schedule:\n    - cron: 0 0 29 2 *\n", encoding="utf-8"
        )
        monkeypatch.setattr(
            dms, "scheduled_workflows", lambda workflow_dir=None: {"leap.yml": ["0 0 29 2 *"]}  # noqa: ARG005
        )
        status = dms.build_status(
            lambda name: pytest.fail(f"不该查询 {name}——间隔都推不出来"), NOW
        )
        assert status["entries"][0]["state"] == "unknown"
        assert "cron 间隔无法推导" in status["entries"][0]["note"]


# ════════════════════════════════════════════════════════════════════════════
# 三、memory_freshness —— 落空的保鲜规则必须单列上报
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def fake_repo(tmp_path, monkeypatch):
    """把巡检器整个搬进 tmp：绝不读真实 memory/ 与真实 git。"""
    (tmp_path / "memory").mkdir()
    monkeypatch.setattr(mf, "REPO", tmp_path)
    monkeypatch.setattr(mf, "LESSONS", tmp_path / "memory" / "lessons-learned.md")
    monkeypatch.setattr(mf, "ARCHIVE", tmp_path / "memory" / "lessons-archive.md")
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(tmp_path / "data-lake"))
    return tmp_path


class TestStalenessRuleDropout:
    def test_rule_matching_nothing_is_reported_as_dropped(self, fake_repo, monkeypatch):
        """规则一件都没匹配上 = 它已经不覆盖任何东西——不许静默省掉。"""
        (fake_repo / "memory" / "here.md").write_text("x", encoding="utf-8")
        monkeypatch.setattr(mf, "STALENESS_RULES", [
            ("memory/here.md", 30),
            ("memory/project-status-*.md", 30),   # 拆分/改名后落空的那种
            ("projects/*/CONTEXT.md", 120),       # 目录整个不在
        ])
        monkeypatch.setattr(mf, "_git_age_days", lambda path: 1)  # noqa: ARG005

        report = mf.staleness()
        dropped = [line for line in report if line.startswith("[规则落空]")]
        assert len(dropped) == 1, "落空规则必须单列，而不是混进「全部在保鲜期内」"
        assert "2 条保鲜规则匹配不到任何档案" in dropped[0]
        assert "memory/project-status-*.md（阈值 30 天）" in dropped[0]
        assert "projects/*/CONTEXT.md（阈值 120 天）" in dropped[0]

    def test_all_rules_covered_reports_nothing(self, fake_repo, monkeypatch):
        """对照臂：规则全都命中且都新鲜时报告为空（否则上一条测的只是「总在喊」）。"""
        (fake_repo / "memory" / "here.md").write_text("x", encoding="utf-8")
        monkeypatch.setattr(mf, "STALENESS_RULES", [("memory/here.md", 30)])
        monkeypatch.setattr(mf, "_git_age_days", lambda path: 3)  # noqa: ARG005
        assert mf.staleness() == []

    def test_unmeasurable_age_is_listed_separately_from_fresh(self, fake_repo, monkeypatch):
        """测不出龄 ≠ 新鲜——同一病根的上一层，一并钉住。"""
        for name in ("a.md", "b.md"):
            (fake_repo / "memory" / name).write_text("x", encoding="utf-8")
        monkeypatch.setattr(mf, "STALENESS_RULES", [("memory/*.md", 30)])
        monkeypatch.setattr(mf, "_git_age_days", lambda path: None)  # noqa: ARG005
        report = mf.staleness()
        assert any(line.startswith("[未测龄]") and "2 份档案" in line for line in report)

    def test_overdue_file_is_reported(self, fake_repo, monkeypatch):
        (fake_repo / "memory" / "old.md").write_text("x", encoding="utf-8")
        monkeypatch.setattr(mf, "STALENESS_RULES", [("memory/old.md", 30)])
        monkeypatch.setattr(mf, "_git_age_days", lambda path: 99)  # noqa: ARG005
        assert any("已 99 天未更新（阈值 30 天）" in line for line in mf.staleness())


class TestGateInvariants:
    @staticmethod
    def _write(fake_repo, lessons: str, archive: str = ""):
        mf.LESSONS.write_text(lessons, encoding="utf-8")
        mf.ARCHIVE.write_text(archive, encoding="utf-8")

    def test_missing_archive_file_is_red(self, fake_repo):
        mf.LESSONS.write_text("## 1. 甲\n", encoding="utf-8")
        assert mf.gate_problems() == [f"档案缺失：{mf.ARCHIVE}"]

    def test_unparseable_lessons_is_red_not_silently_green(self, fake_repo):
        """条目解析为零时每项检查都空跑——守卫不许无声降级为零覆盖。"""
        self._write(fake_repo, "### 40. 标题层级被改过\n")
        problems = mf.gate_problems()
        assert len(problems) == 1
        assert "解析不出任何" in problems[0]

    def test_merged_pointer_must_name_and_hit_an_active_entry(self, fake_repo):
        self._write(
            fake_repo,
            "## 1. 甲（已并入）\n"
            "## 2. 乙（已并入 #99）\n"
            "## 3. 丙（已并入 #4）\n"
            "## 4. 丁（已迁档）\n"
            "维护说明：下一条 = #5\n",
            archive="## 4. 丁\n",
        )
        problems = mf.gate_problems()
        assert "#1 标「已并入」但未写目标编号" in problems
        assert "#2 已并入 #99，但主档无 #99" in problems
        assert any("#3 已并入 #4，但 #4 非在役条目" in p for p in problems)

    def test_archived_entry_needs_full_text_in_the_archive(self, fake_repo):
        self._write(fake_repo, "## 7. 己（已毕业）\n维护说明：下一条 = #8\n", archive="（空）")
        assert any("lessons-archive.md 无 ## 7. 全文" in p for p in mf.gate_problems())

    def test_casefile_pointer_must_not_dangle(self, fake_repo):
        self._write(
            fake_repo,
            "## 5. 庚\n正文见案卷 #5。\n维护说明：下一条 = #6\n",
            archive="### 案卷 #50\n（编号前缀不许冒充）\n",
        )
        assert any("引用「案卷 #5」" in p for p in mf.gate_problems())

    def test_numbering_ledger_drift_is_red(self, fake_repo):
        self._write(fake_repo, "## 9. 辛\n维护说明：下一条 = #9\n", archive="")
        assert any("编号对账漂移" in p for p in mf.gate_problems())

    def test_missing_ledger_line_is_red(self, fake_repo):
        self._write(fake_repo, "## 9. 辛\n（没有记账行）\n", archive="")
        assert "维护说明缺「下一条 = #K」记账行" in mf.gate_problems()

    def test_clean_ledger_is_green(self, fake_repo):
        self._write(
            fake_repo,
            "## 9. 辛\n正文引用案卷 #9。\n维护说明：下一条 = #10\n",
            archive="### 案卷 #9\n全文\n",
        )
        assert mf.gate_problems() == []


class TestReportLevelChecks:
    def test_missing_paths_skips_annotated_history_lines(self, fake_repo):
        mf.ARCHIVE.write_text("", encoding="utf-8")
        mf.LESSONS.write_text(
            "## 1. 甲\n"
            "在役引用 `memory/nowhere.md` 必须报。\n"
            "⚠ 历史引用 `memory/deleted.md` 跳过。\n"
            "通配 `memory/*.md` 与外链 `https://x/y` 跳过。\n"
            "存在的 `memory/lessons-learned.md` 不报。\n",
            encoding="utf-8",
        )
        out = mf.missing_paths()
        assert len(out) == 1
        assert "memory/nowhere.md" in out[0]

    def test_header_date_drift(self, fake_repo, monkeypatch):
        (fake_repo / "memory" / "drift.md").write_text("最后更新：2026-07-01\n", encoding="utf-8")
        (fake_repo / "memory" / "bad.md").write_text("最后更新：2026-13-45\n", encoding="utf-8")
        (fake_repo / "memory" / "none.md").write_text("（无头部日期）\n", encoding="utf-8")
        monkeypatch.setattr(mf, "_git_last_date", lambda path: NOW.date())  # noqa: ARG005
        out = mf.header_date_drift()
        assert any("drift.md" in line and "相差 >3 天" in line for line in out)
        assert any("bad.md" in line and "头部日期非法" in line for line in out)
        assert not any("none.md" in line for line in out)

    def test_git_helpers_return_none_outside_a_repo(self, fake_repo):
        """tmp 不是 git 仓：两个取龄助手必须双双回落 None，而不是抛出去。"""
        probe = fake_repo / "memory" / "probe.md"
        probe.write_text("x", encoding="utf-8")
        assert mf._git_age_days(probe) is None
        assert mf._git_last_date(probe) is None


class TestFreshnessCli:
    def test_gate_mode_returns_one_when_red(self, fake_repo, monkeypatch, capsys):
        mf.LESSONS.write_text("### 层级被改过\n", encoding="utf-8")
        mf.ARCHIVE.write_text("", encoding="utf-8")
        monkeypatch.setattr(sys, "argv", ["memory_freshness.py", "--gate"])
        assert mf.main() == 1
        assert "gate: RED" in capsys.readouterr().out

    def test_gate_mode_returns_zero_when_green(self, fake_repo, monkeypatch, capsys):
        mf.LESSONS.write_text("## 1. 甲\n维护说明：下一条 = #2\n", encoding="utf-8")
        mf.ARCHIVE.write_text("", encoding="utf-8")
        monkeypatch.setattr(sys, "argv", ["memory_freshness.py", "--gate"])
        assert mf.main() == 0
        assert "gate: GREEN" in capsys.readouterr().out

    def test_full_report_names_every_section(self, fake_repo, monkeypatch, capsys):
        mf.LESSONS.write_text("## 1. 甲\n维护说明：下一条 = #2\n", encoding="utf-8")
        mf.ARCHIVE.write_text("", encoding="utf-8")
        monkeypatch.setattr(mf, "STALENESS_RULES", [("memory/gone-*.md", 30)])
        monkeypatch.setattr(mf, "_git_age_days", lambda path: 1)  # noqa: ARG005
        monkeypatch.setattr(mf, "_git_last_date", lambda path: None)  # noqa: ARG005
        monkeypatch.setattr(sys, "argv", ["memory_freshness.py"])
        assert mf.main() == 0
        out = capsys.readouterr().out
        for section in ("门禁级不变量", "引用路径存在性", "超龄档案", "头部日期错位"):
            assert section in out
        assert "[规则落空]" in out, "报告体里也必须看得见落空的规则"


if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-v"]))
