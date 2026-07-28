"""审计第十七波 · 台账读错处与量尺读错口径（同波次其余修复）。

前三档钉的是「写」（原子性、顺序、出声）；本档钉的是「读」——同一波里另一类缺陷：
**东西明明在，读的人看错了地方或换错了口径**，于是守卫、报告、评测各自给出一个说得通
但错误的数字。这类缺陷不会抛异常、不会红，只会让判断慢慢失真。

| 位置 | 读错在哪 | 后果 |
|---|---|---|
| `discord_archiver._archived_months` | 只看区服目录，而引擎的 `archive-log.json` 写在 **discord 根** | 「该月已在 Releases → 跳过重抓」恒不成立；45 分钟预算全耗在已有数据上，真正缺的月份永远轮不到 |
| `aggregator` 水位 | 水位在 `run()` 内、核心源失败判定**之前**推进 | reddit 被拦 30 小时期间轮轮标记成功；恢复那轮回溯窗仍是 24h，最早 6 小时整段静默丢失 |
| `aggregator_collectors._read_discord_jsonl` | 单行坏 JSON 摊在外层 `except` 下 | 一条半截行让该文件**剩下的全部消息**不读了；日报静默缩水 |
| `build_capability_registry` | `generated_at` 取当日日期 | 只要跨一天，`--check` 就在源码没动的情况下报「已过期」；写模式产出只改日期的噪声提交 |
| `kb_telemetry` | 把向量腿的档案 ref 混进「触达概念」计数 | `reach_ratio` 能冲破 100%——拿别人的借阅记录充自己的读者数 |
| `kb_golden_gen` | 期望答案落裸 stem，而判命中是子串匹配 | `community-youtube` ⊂ `community-youtube-comments`：证明「KB 分得清层与平台」的题，却在给错答案打分 |
| `kb_anchor` | 单字 CJK 锚词参与 preview 子串判定 | 「徐州」「徐徐图之」被判 anchored 排到真相关片段前面 |

零网络、零真实数据根：数据目录经 `BIAV_SC_DATA_ROOT` / `DISCORD_DATA_ROOT` 指向 tmp。

小学生比喻：账本没记错，是查账的人翻错了柜子、量身高的人把鞋跟算进去了——数字看着
都挺正常，只是没有一个是真的。
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from unittest import mock

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import aggregator as ag  # noqa: E402
import aggregator_collectors as ac  # noqa: E402
import archive_layout  # noqa: E402
import build_capability_registry as bcr  # noqa: E402
import collection_state  # noqa: E402
import discord_archiver as da  # noqa: E402
import kb_anchor  # noqa: E402
import kb_telemetry as kt  # noqa: E402


# ════════════════════════════════════════════════════════════════════════════
# 一、discord_archiver._archived_months —— 日志在 discord 根，不在区服目录
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def region_archiver(tmp_path, monkeypatch):
    """区服目录 = <lake>/discord/global，引擎日志落在 <lake>/discord/。"""
    lake = tmp_path / "lake"
    region = lake / "Record" / "Community" / "discord" / "global"
    region.mkdir(parents=True)
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(lake))
    env = {
        "DISCORD_BOT_TOKEN": "dummy",
        "DISCORD_GUILD_ID": "1131791637933199470",
        "DISCORD_DATA_ROOT": str(region),
    }
    with mock.patch.dict(os.environ, env, clear=False):
        arch = da.DiscordArchiver()
    return arch, region, archive_layout.discord_root()


def _log(*entries):
    return json.dumps(list(entries))


class TestArchivedMonths:
    def test_engine_log_at_the_discord_root_is_read(self, region_archiver):
        """方案甲把 Global 迁进 discord/global 之后，只看区服目录就再也读不到这份日志。"""
        _arch, _region, root = region_archiver
        (root / "archive-log.json").write_text(_log(
            {"source": "discord", "group": "2026-01", "uploaded_to_releases": True},
            {"source": "discord", "group": "2026-02", "uploaded_to_releases": True},
        ), encoding="utf-8")
        arch, _r, _root = region_archiver
        assert arch._archived_months() == {"2026-01", "2026-02"}

    def test_region_local_log_still_counts(self, region_archiver):
        """旧根特例 / 单测形态：区服目录里的日志照读（两处都读，不是改读一处）。"""
        arch, region, _root = region_archiver
        (region / "archive-log.json").write_text(
            _log({"month": "2025-12", "uploaded_to_releases": True}), encoding="utf-8"
        )
        assert arch._archived_months() == {"2025-12"}

    def test_not_yet_uploaded_months_are_excluded(self, region_archiver):
        arch, region, _root = region_archiver
        (region / "archive-log.json").write_text(_log(
            {"group": "2026-03", "uploaded_to_releases": False},
            {"group": "", "uploaded_to_releases": True},
        ), encoding="utf-8")
        assert arch._archived_months() == set()

    @pytest.mark.parametrize("payload", ['{ 半截', '{"not": "a list"}', '[1, "x", null]'])
    def test_malformed_log_yields_empty_not_an_exception(self, region_archiver, payload):
        """坏日志只许让守卫失效（退回重抓），绝不许把整轮跑打死。"""
        arch, region, _root = region_archiver
        (region / "archive-log.json").write_text(payload, encoding="utf-8")
        assert arch._archived_months() == set()

    def test_result_is_cached_per_run(self, region_archiver):
        arch, region, _root = region_archiver
        (region / "archive-log.json").write_text(
            _log({"group": "2026-04", "uploaded_to_releases": True}), encoding="utf-8"
        )
        assert arch._archived_months() == {"2026-04"}
        (region / "archive-log.json").unlink()
        assert arch._archived_months() == {"2026-04"}, "同一轮内只读一次（缓存）"


class TestChannelIndexAtomicity:
    def test_unreadable_index_is_rebuilt_with_a_warning(self, region_archiver, caplog):
        """坏索引会被判成 rebuilding from scratch —— 正是 498 个孤儿目录的成因。"""
        arch, region, _root = region_archiver
        (region / "channel_index.json").write_text("{ 半截", encoding="utf-8")
        with caplog.at_level(logging.WARNING):
            arch._save_channel_index([{"id": "111", "name": "general", "type": 0}])
        assert "channel_index.json unreadable" in caplog.text
        index = json.loads((region / "channel_index.json").read_text(encoding="utf-8"))
        assert index["111"]["name"] == "general"

    def test_crash_mid_write_leaves_the_previous_index_readable(
        self, region_archiver, monkeypatch
    ):
        """半截索引会被下一轮判成 unreadable → offline/orphan 全蒸发，孤儿名字永久失落。"""
        import news_common

        arch, region, _root = region_archiver
        good = {"111": {"name": "general", "dir": "111", "status": "active"},
                "222": {"name": "ex-fanart", "dir": "222", "status": "orphan"}}
        (region / "channel_index.json").write_text(json.dumps(good), encoding="utf-8")

        def half_then_die(obj, fh, **_kw):  # noqa: ARG001
            fh.write('{"half": "written…')
            raise RuntimeError("killed mid-write")

        monkeypatch.setattr(news_common.json, "dump", half_then_die)
        with pytest.raises(RuntimeError, match="killed mid-write"):
            arch._save_channel_index([{"id": "111", "name": "general", "type": 0}])

        assert json.loads((region / "channel_index.json").read_text(encoding="utf-8")) == good

    def test_offline_entries_survive_a_rewrite(self, region_archiver):
        """合并式更新：下线频道标 offline 保留，不许覆盖蒸发。"""
        arch, region, _root = region_archiver
        arch._save_channel_index([
            {"id": "111", "name": "general", "type": 0},
            {"id": "222", "name": "gone-later", "type": 0},
        ])
        arch._save_channel_index([{"id": "111", "name": "general", "type": 0}])
        index = json.loads((region / "channel_index.json").read_text(encoding="utf-8"))
        assert index["222"]["status"] == "offline"
        assert index["111"].get("status", "active") != "offline"


# ════════════════════════════════════════════════════════════════════════════
# 二、aggregator —— 水位只在整条链路都干净时推进
# ════════════════════════════════════════════════════════════════════════════

class TestCollectionWatermark:
    def test_mark_collected_advances_the_watermark(self, monkeypatch):
        seen = []

        def recorder(item_count):
            seen.append(item_count)

        monkeypatch.setattr(collection_state, "mark_collection_done", recorder)
        ag.mark_collected(41)
        assert seen == [41]

    def test_mark_collected_is_a_no_op_without_collection_state(self, monkeypatch):
        """可选依赖缺失时优雅降级——水位推进失败不许打断采集链路。"""
        monkeypatch.setitem(sys.modules, "collection_state", None)
        ag.mark_collected(7)  # 不抛即通过

    def test_watermark_is_not_advanced_inside_run(self):
        """水位推进必须在两段采集都判过之后——run() 内部不许再碰它。

        这是本次修复的形状本身：`run()` 里若还留着 mark_collection_done 调用，
        「部分成功即推进水位」就原样复发（reddit 被拦 30 小时那次的真因）。
        """
        source = Path(ag.__file__).read_text(encoding="utf-8")
        head, _, tail = source.partition("if __name__ ==")
        assert "mark_collection_done" not in head.split("def mark_collected")[0], (
            "run() 内不许推进水位"
        )
        assert "if ac_ok and gc_ok:" in tail, "水位推进必须由两段采集的联合判定把门"


class TestDiscordJsonlBadLines:
    def test_one_torn_line_does_not_abandon_the_rest_of_the_file(
        self, tmp_path, monkeypatch, caplog
    ):
        """500 条的频道日档不许因为一条半截行只剩坏行之前那几十条。"""
        lake = tmp_path / "lake"
        ch = lake / "Record" / "Community" / "discord" / "global" / "channels" / "12345678"
        ch.mkdir(parents=True)
        (ch / "2026-05-03.jsonl").write_text(
            '{"id":"1","content":"before"}\n'
            '{"id":"2","cont\n'                       # 上一轮被杀留下的半截行
            "\n"                                       # 空行照旧跳过
            '{"id":"3","content":"after"}\n',
            encoding="utf-8",
        )
        monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(lake))

        with caplog.at_level(logging.WARNING):
            msgs = ac._read_discord_jsonl("2026-05-03")

        assert [m["id"] for m in msgs] == ["1", "3"], "坏行之后的消息必须照读"
        assert "skipped 1 malformed line(s)" in caplog.text, "跳了多少行必须说出来"


# ════════════════════════════════════════════════════════════════════════════
# 三、build_capability_registry —— 日历不许自己制造「已过期」
# ════════════════════════════════════════════════════════════════════════════

class TestGeneratedAtFreeze:
    @staticmethod
    def _reg(date: str, payload: str = "a"):
        return {"meta": {"generated_at": date, "n": 1}, "items": [payload]}

    def test_unchanged_content_keeps_the_old_date(self, tmp_path, monkeypatch):
        """内容一个字没变：日期沿用旧值，`--check` 不许因为跨了一天就报过期。"""
        path = tmp_path / "capability-registry.json"
        path.write_text(json.dumps(self._reg("2026-07-01")), encoding="utf-8")
        monkeypatch.setattr(bcr, "REGISTRY", path)
        out = bcr._freeze_date_if_unchanged(self._reg("2026-07-28"))
        assert out["meta"]["generated_at"] == "2026-07-01"

    def test_changed_content_takes_the_new_date(self, tmp_path, monkeypatch):
        """内容真变了才动日期——语义收紧成「上次内容发生变化」，不是「上次跑了脚本」。"""
        path = tmp_path / "capability-registry.json"
        path.write_text(json.dumps(self._reg("2026-07-01", "a")), encoding="utf-8")
        monkeypatch.setattr(bcr, "REGISTRY", path)
        out = bcr._freeze_date_if_unchanged(self._reg("2026-07-28", "b"))
        assert out["meta"]["generated_at"] == "2026-07-28"

    def test_missing_or_corrupt_previous_registry_is_passed_through(self, tmp_path, monkeypatch):
        monkeypatch.setattr(bcr, "REGISTRY", tmp_path / "absent.json")
        assert bcr._freeze_date_if_unchanged(self._reg("2026-07-28"))["meta"]["generated_at"] == (
            "2026-07-28"
        )
        broken = tmp_path / "broken.json"
        broken.write_text("{ 半截", encoding="utf-8")
        monkeypatch.setattr(bcr, "REGISTRY", broken)
        assert bcr._freeze_date_if_unchanged(self._reg("2026-07-28"))["meta"]["generated_at"] == (
            "2026-07-28"
        )

    def test_previous_registry_without_a_date_is_passed_through(self, tmp_path, monkeypatch):
        path = tmp_path / "no-date.json"
        path.write_text(json.dumps({"meta": {}, "items": []}), encoding="utf-8")
        monkeypatch.setattr(bcr, "REGISTRY", path)
        assert bcr._freeze_date_if_unchanged(self._reg("2026-07-28"))["meta"]["generated_at"] == (
            "2026-07-28"
        )

    def test_caller_object_is_not_mutated_by_the_probe(self, tmp_path, monkeypatch):
        """深拷贝探针不许改到调用方手里的对象（否则写出去的就是探针）。"""
        path = tmp_path / "capability-registry.json"
        path.write_text(json.dumps(self._reg("2026-07-01", "a")), encoding="utf-8")
        monkeypatch.setattr(bcr, "REGISTRY", path)
        fresh = self._reg("2026-07-28", "b")
        bcr._freeze_date_if_unchanged(fresh)
        assert fresh["items"] == ["b"]


# ════════════════════════════════════════════════════════════════════════════
# 四、kb_telemetry —— 「触达概念」只能数概念
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def telemetry(tmp_path, monkeypatch):
    okf = tmp_path / "okf"
    okf.mkdir()
    (okf / "kb_index.json").write_text(json.dumps({"concepts": {
        "/characters/erica.md": {}, "/memory/decisions.md": {}, "/assets/interview.md": {},
    }}), encoding="utf-8")
    monkeypatch.setattr(kt, "REPO", tmp_path)
    log_dir = tmp_path / "kb-usage"
    log_dir.mkdir()
    return log_dir


def _calls(path: Path, *records):
    path.write_text("\n".join([*(json.dumps(r) for r in records), "", "{ 半截"]), encoding="utf-8")


class TestReachRatio:
    def test_vector_refs_do_not_inflate_the_concept_count(self, telemetry):
        """向量腿记的是长尾档案 ref，不是概念——混进来能把 reach_ratio 顶破 100%。"""
        _calls(
            telemetry / "2026-07-28.jsonl",
            {"tool": "kb_search", "n": 1, "ids": ["/characters/erica.md"]},
            {"tool": "kb_vector_search", "n": 50, "ids": [
                f"Public-Info-Pool/Record/Community/discord/global/x/{i}.jsonl:1"
                for i in range(50)
            ]},
        )
        rep = kt.summarize(telemetry)
        assert rep["total_calls"] == 2
        assert rep["distinct_concepts_reached"] == 1, "50 条档案 ref 不算 50 个概念被读过"
        assert rep["reach_ratio"] == pytest.approx(1 / 3, abs=1e-4)
        assert rep["reach_ratio"] <= 1.0

    def test_dead_concepts_are_still_a_set_difference(self, telemetry):
        _calls(telemetry / "2026-07-28.jsonl",
               {"tool": "kb_get", "n": 1, "ids": ["/characters/erica.md"]})
        rep = kt.summarize(telemetry)
        assert rep["dead_concepts_count"] == 2

    def test_missing_index_degrades_to_raw_reach(self, telemetry, monkeypatch, tmp_path):
        """没有 kb_index.json 时不许假装算得出比率。"""
        monkeypatch.setattr(kt, "REPO", tmp_path / "elsewhere")
        _calls(telemetry / "2026-07-28.jsonl",
               {"tool": "kb_search", "n": 1, "ids": ["/characters/erica.md"]})
        rep = kt.summarize(telemetry)
        assert rep["reach_ratio"] is None
        assert rep["total_concepts"] == 0

    def test_corrupt_index_is_tolerated(self, telemetry, tmp_path):
        (tmp_path / "okf" / "kb_index.json").write_text("{ 半截", encoding="utf-8")
        assert kt._all_concept_ids() == set()

    def test_zero_hit_queries_feed_the_held_out_harvest(self, telemetry):
        """零命中查询回流成难题候选——同一份记录的另一个消费口。"""
        _calls(
            telemetry / "2026-07-28.jsonl",
            {"tool": "kb_search", "n": 0, "query": "命轮怎么算", "ids": []},
            {"tool": "kb_search", "n": 0, "query": "命轮怎么算", "ids": []},
            {"tool": "kb_search", "n": 0, "query": "只问过一次", "ids": []},
            {"tool": "kb_search", "n": 0, "query": "   ", "ids": []},
        )
        out = kt.harvest_gaps(log_path=telemetry, min_count=2)
        assert [c["q"] for c in out["candidates"]] == ["命轮怎么算"]
        assert out["count"] == 1
        assert out["candidates"][0]["needs_triage"] is True


# ════════════════════════════════════════════════════════════════════════════
# 五、kb_anchor —— 单字 CJK 锚词不参与去杂判定
# ════════════════════════════════════════════════════════════════════════════

class TestSingleCjkAnchorTerm:
    @staticmethod
    def _stub(monkeypatch, title: str, previews: list[str]):
        import kb_navigator
        import kb_vector
        monkeypatch.setattr(kb_navigator, "search", lambda q, limit=3: {  # noqa: ARG005
            "results": [{"id": "/characters/xu.md", "title": title, "type": "character",
                         "resource": "/x.md", "score": 1.0}],
        })
        monkeypatch.setattr(kb_vector, "search", lambda q, limit=8, path=None, backend=None: {  # noqa: ARG005
            "degraded": False,
            "results": [{"preview": p, "source": "s", "score": 0.1} for p in previews],
        })

    def test_single_char_anchor_does_not_reorder_the_tail(self, monkeypatch):
        """「徐州」「徐徐图之」不许因为一个单字锚词被判 anchored 排到前面。"""
        self._stub(monkeypatch, "徐", ["徐州的天气", "徐徐图之"])
        out = kb_anchor.anchor_expand("徐", tail_limit=2)
        assert out["expansion_terms"] == ["徐"], "单字仍进 expanded_query（召回不丢）"
        assert all(not r.get("anchored") for r in out["tail"]["results"]), (
            "单字 CJK 不进去杂匹配面——否则等于用一个不存在的关联给长尾重排序"
        )

    def test_multi_char_anchor_still_marks_and_reorders(self, monkeypatch):
        """对照臂：二字及以上照旧标记并排前（修复不许把去杂能力一并阉掉）。"""
        self._stub(monkeypatch, "艾瑞卡", ["无关的散句", "艾瑞卡的语音原文"])
        out = kb_anchor.anchor_expand("艾瑞卡", tail_limit=2)
        results = out["tail"]["results"]
        assert results[0]["anchored"] is True
        assert results[0]["anchor_matched"] == ["艾瑞卡"]
        assert results[1]["anchored"] is False


if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-v"]))
