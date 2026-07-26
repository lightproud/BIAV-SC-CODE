"""产出↔消费对账单测 —— 守的是「判据别太松也别太紧」。

本审计的价值全在判据的**校准**：太紧则把经解析器读的路径全诬告成无人读，太松则把
一切吸收成「有人读」、信号归零。首版两头都撞过——无限上溯父路径时，零消费从 7 件
变 0 件（任何路径的祖先里总有个被代码提到的项目目录）。故本组重点钉四条：

1. 生产者自引不算消费（自己写自己不叫有人读）；
2. 代码消费 > 档案提及（只有 md 提到 = doc-only 弱信号，不是 consumed）；
3. 解析器盲区**只回溯一级**（覆盖真实形态，不吞掉信号）；
4. 报告必须携带盲区声明（静态图看不见的三类消费，不许悄悄省掉）。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import consumption_audit as ca  # noqa: E402


def _fake_grep(mapping: dict[str, list[str]]):
    return lambda needle: mapping.get(needle, [])


class TestVerdicts:
    def test_producer_self_reference_is_not_consumption(self, monkeypatch):
        """产出路径只在生产它的工作流里出现 = 无人消费。"""
        monkeypatch.setattr(ca, "_grep", _fake_grep({
            "out/thing.json": [".github/workflows/maker.yml:12: git add out/thing.json"],
        }))
        assert ca.audit_one("out/thing.json", ["maker.yml"])["verdict"] == "orphan"

    def test_code_reference_counts_as_consumed(self, monkeypatch):
        monkeypatch.setattr(ca, "_grep", _fake_grep({
            "out/thing.json": ["scripts/reader.py:3: open('out/thing.json')"],
        }))
        assert ca.audit_one("out/thing.json", ["maker.yml"])["verdict"] == "consumed"

    def test_doc_only_mention_is_a_weaker_verdict(self, monkeypatch):
        """档案提到 ≠ 有人读。这一档单列，供人判「是真引用还是历史残句」。"""
        monkeypatch.setattr(ca, "_grep", _fake_grep({
            "out/thing.json": ["memory/notes.md:9: 见 out/thing.json"],
        }))
        assert ca.audit_one("out/thing.json", ["maker.yml"])["verdict"] == "doc-only"

    def test_resolver_mediated_path_is_credited_via_parent(self, monkeypatch):
        """经 archive_layout 取路径的消费者不会写字面量子路径——不能因此诬告成无人读。"""
        monkeypatch.setattr(ca, "_grep", _fake_grep({
            "Record/Community/discord/jp": [],
            "Record/Community/discord": ["projects/news/scripts/archive_layout.py:40: discord"],
        }))
        entry = ca.audit_one("Record/Community/discord/jp", ["archiver.yml"])
        assert entry["verdict"] == "parent-consumed"
        assert entry["consumed_via_parent"] == "Record/Community/discord"

    def test_parent_walk_stops_at_one_level(self, monkeypatch):
        """只回溯一级——无限上溯会把一切吸收成「有人读」，信号归零（首版真踩过）。"""
        monkeypatch.setattr(ca, "_grep", _fake_grep({
            "projects/wiki/docs/public/feed.xml": [],
            "projects/wiki/docs/public": [],
            # 祖父级有代码引用，但不得据此赦免
            "projects/wiki/docs": ["scripts/build.py:1: projects/wiki/docs"],
            "projects/wiki": ["scripts/build.py:2: projects/wiki"],
        }))
        assert ca.audit_one("projects/wiki/docs/public/feed.xml", ["w.yml"])["verdict"] == "orphan"


class TestProducerParsing:
    def test_bare_flags_are_skipped(self, tmp_path, monkeypatch):
        """`git add -A` 范围不明，无从对账——跳过而不是当成一件叫「-A」的产物。"""
        wf = tmp_path / "workflows"
        wf.mkdir()
        (wf / "a.yml").write_text("    git add -A\n    git add out/real.json\n", encoding="utf-8")
        monkeypatch.setattr(ca, "WORKFLOW_DIR", wf)
        assert list(ca.produced_paths()) == ["out/real.json"]

    def test_release_tag_is_captured_whole(self, tmp_path, monkeypatch):
        """带连字符的 tag 必须整取——首版正则把 community-assets 截成 `-assets`。"""
        wf = tmp_path / "workflows"
        wf.mkdir()
        (wf / "b.yml").write_text(
            "  gh release upload community-assets okf/x.gz --clobber\n", encoding="utf-8"
        )
        monkeypatch.setattr(ca, "WORKFLOW_DIR", wf)
        assert list(ca.produced_releases()) == ["community-assets"]


def test_report_carries_its_blind_spots(monkeypatch):
    """盲区声明是报告的一部分——省掉它，读者会把「零消费」当成「确实没人要」。"""
    monkeypatch.setattr(ca, "produced_paths", lambda: {})
    monkeypatch.setattr(ca, "produced_releases", lambda: {})
    report = ca.build_report()
    assert report["method"] == "static-reference-graph"
    assert len(report["blind_spots"]) == 3
    assert any("黑池" in b for b in report["blind_spots"])
