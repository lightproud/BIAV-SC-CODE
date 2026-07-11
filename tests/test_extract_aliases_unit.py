"""extract_aliases 厚锚别名生成期工作面的单测（零网络、确定性）。

覆盖生成侧全链路：候选落表（add）/ 确认与撤回（confirm / revoke）/ 列表（list）/
证据核查（grep-evidence）/ 喂料收割（feed_gap / harvest）/ CLI main() 派发。

三墙在生成侧的落地形状是本档案的核心断言：
  - 出身牌：每条写出的条目必带 provenance 四件套（source / ref / quote / inferred_by）；
  - 可撤回：revoke 直接删条，读取层随之无痕；
  - 惰性确认态：新条目一律 confirmed=false（未确认压权重），confirm 才翻真。

写读往返回归：extract_aliases 写出的侧表须能被运行时消费方 silver_aliases
（97% 覆盖的读取层）按既有 schema 读回——未确认不进 alias_map 默认面，
confirm 后才进白盒消费面。所有 fixture 全走 tmp_path，绝不碰真实侧表。
"""
import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import extract_aliases as ea  # noqa: E402
import silver_aliases as sa  # noqa: E402


# ---------- 夹具：全部路径重定向 tmp_path，隔离真实数据 ----------

@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """把侧表 / 角色基线 / 喂料 / 社区档案四个落点全部指进 tmp_path。"""
    aliases_path = tmp_path / "processed" / "aliases.json"
    characters_path = tmp_path / "characters.json"
    gaps_path = tmp_path / "rough" / "alias_gaps.jsonl"
    community_dir = tmp_path / "community"
    community_dir.mkdir()
    monkeypatch.setattr(sa, "ALIASES_PATH", aliases_path)
    monkeypatch.setattr(ea, "CHARACTERS", characters_path)
    monkeypatch.setattr(ea, "GAPS_PATH", gaps_path)
    monkeypatch.setattr(ea, "COMMUNITY", community_dir)
    sa.cache_clear()
    yield {
        "aliases": aliases_path,
        "characters": characters_path,
        "gaps": gaps_path,
        "community": community_dir,
    }
    sa.cache_clear()


def _write_characters(path: Path, ids):
    path.write_text(
        json.dumps({"characters": [{"id": i} for i in ids]}, ensure_ascii=False),
        encoding="utf-8")


def _add_args(**over):
    """cmd_add 的最小合法参数集（出身牌四件套齐全）。"""
    base = dict(concept_id="15602", alias="融朵", source="bilibili",
                ref="Record/Community/bilibili/2026-07-01.jsonl",
                quote="打融朵攻略来了", inferred_by="session-test")
    base.update(over)
    import argparse
    return argparse.Namespace(**base)


# ---------- _read_table：缺表给默认骨架，不炸 ----------

def test_read_table_missing_returns_skeleton(sandbox):
    data = ea._read_table()
    assert data["aliases"] == []
    assert data["_meta"]["version"] == 1


def test_read_table_existing_roundtrip(sandbox):
    ea._write_table({"_meta": {"version": 1}, "aliases": [
        {"concept_id": "1", "alias": "甲"}]})
    data = ea._read_table()
    assert [r["alias"] for r in data["aliases"]] == ["甲"]


def test_write_table_clears_reader_cache(sandbox):
    """写侧表后必须清读取层缓存，消费方立刻看到新数据（不是旧快照）。"""
    assert sa.load() == []
    ea._write_table({"_meta": {}, "aliases": [
        {"concept_id": "1", "alias": "乙", "confirmed": True}]})
    assert [r["alias"] for r in sa.load()] == ["乙"]


# ---------- _known_concept_ids：基线门卫 ----------

def test_known_concept_ids_reads_baseline(sandbox):
    _write_characters(sandbox["characters"], [15602, 15603])
    assert ea._known_concept_ids() == {"15602", "15603"}


def test_known_concept_ids_missing_file_returns_empty(sandbox):
    assert ea._known_concept_ids() == set()


def test_known_concept_ids_corrupt_file_returns_empty(sandbox):
    sandbox["characters"].write_text("{broken", encoding="utf-8")
    assert ea._known_concept_ids() == set()


# ---------- cmd_add：落表 + 三墙 schema ----------

def test_add_rejects_unknown_concept_id(sandbox, capsys):
    _write_characters(sandbox["characters"], [15602])
    rc = ea.cmd_add(_add_args(concept_id="99999"))
    assert rc == 1
    assert "拒绝" in capsys.readouterr().err
    assert not sandbox["aliases"].exists()  # 拒绝即不落盘


def test_add_writes_entry_with_three_walls(sandbox):
    _write_characters(sandbox["characters"], [15602])
    assert ea.cmd_add(_add_args()) == 0
    data = json.loads(sandbox["aliases"].read_text(encoding="utf-8"))
    assert len(data["aliases"]) == 1
    row = data["aliases"][0]
    # 墙一：出身牌四件套一件不缺
    prov = row["provenance"]
    assert prov == {"source": "bilibili",
                    "ref": "Record/Community/bilibili/2026-07-01.jsonl",
                    "quote": "打融朵攻略来了",
                    "inferred_by": "session-test"}
    # 墙三：新条目一律未确认（压权重）
    assert row["confirmed"] is False
    assert row["added"] == date.today().isoformat()
    assert row["concept_id"] == "15602"
    assert row["alias"] == "融朵"


def test_add_idempotent_skip(sandbox, capsys):
    """同 alias 同 concept_id 重复 add 幂等跳过，不落重复条。"""
    _write_characters(sandbox["characters"], [15602])
    assert ea.cmd_add(_add_args()) == 0
    assert ea.cmd_add(_add_args(quote="另一条引文")) == 0
    assert "幂等跳过" in capsys.readouterr().out
    data = json.loads(sandbox["aliases"].read_text(encoding="utf-8"))
    assert len(data["aliases"]) == 1
    assert data["aliases"][0]["provenance"]["quote"] == "打融朵攻略来了"  # 原条不被覆盖


def test_add_same_alias_different_concept_allowed(sandbox):
    """同名别名指向不同角色是合法多义，不算重复。"""
    _write_characters(sandbox["characters"], [1, 2])
    assert ea.cmd_add(_add_args(concept_id="1", alias="小甲")) == 0
    assert ea.cmd_add(_add_args(concept_id="2", alias="小甲")) == 0
    data = json.loads(sandbox["aliases"].read_text(encoding="utf-8"))
    assert len(data["aliases"]) == 2


def test_add_without_baseline_file_skips_gate(sandbox):
    """基线缺失时门卫降级放行（known 为空集不拦），仍照常落表。"""
    assert ea.cmd_add(_add_args()) == 0
    assert sandbox["aliases"].exists()


# ---------- 写读往返：生成侧输出符合运行时读取层 schema ----------

def test_roundtrip_written_table_readable_by_silver_aliases(sandbox):
    """extract_aliases 写、silver_aliases 读——消费契约的往返回归。"""
    _write_characters(sandbox["characters"], [15602, 15603])
    ea.cmd_add(_add_args())
    ea.cmd_add(_add_args(concept_id="15603", alias="潘迪娅", source="discord"))
    rows = sa.load()
    assert len(rows) == 2
    for r in rows:
        # 出身牌：读取层看到的每条都带完整 provenance
        for key in ("source", "ref", "quote", "inferred_by"):
            assert r["provenance"].get(key)
        # 未确认标记：读取层据此压权重
        assert r["confirmed"] is False
    # 未确认全面压下：不进 confirmed / alias_map 默认面 / domain_dict 吸收面
    assert sa.confirmed() == []
    assert sa.alias_map() == {}
    assert sa.confirmed_cjk_aliases() == []
    # 未确认条目只在显式 include 面可见，且带 confirmed=False 供 LLM 掂量
    assert sa.aliases_for("15602", include_unconfirmed=True) == [
        {"alias": "融朵", "confirmed": False}]
    assert sa.aliases_for("15602") == []


def test_roundtrip_confirm_promotes_to_whitebox(sandbox):
    """confirm 翻真后才进白盒消费面（alias_map / confirmed_cjk_aliases）。"""
    ea.cmd_add(_add_args())
    assert ea._flip("融朵", remove=False) == 0
    assert sa.alias_map() == {"融朵": "15602"}
    assert sa.confirmed_cjk_aliases() == ["融朵"]
    row = json.loads(sandbox["aliases"].read_text(encoding="utf-8"))["aliases"][0]
    assert row["confirmed"] is True
    assert row["provenance"]["source"] == "bilibili"  # 确认不抹出身牌


# ---------- _flip：确认 / 撤回 ----------

def test_revoke_removes_entry(sandbox):
    """墙二：撤回即删条，读取层随之无痕。"""
    ea.cmd_add(_add_args())
    ea.cmd_add(_add_args(alias="拉蒙娜"))
    assert ea._flip("融朵", remove=True) == 0
    rows = sa.load()
    assert [r["alias"] for r in rows] == ["拉蒙娜"]


def test_flip_unknown_alias_returns_error(sandbox, capsys):
    ea.cmd_add(_add_args())
    assert ea._flip("不存在", remove=False) == 1
    assert ea._flip("不存在", remove=True) == 1
    assert "未找到别名" in capsys.readouterr().err


def test_confirm_flips_all_rows_of_same_alias(sandbox):
    """同名多义别名 confirm 一次全翻（按 alias 匹配，不按 concept_id）。"""
    ea.cmd_add(_add_args(concept_id="1", alias="小甲"))
    ea.cmd_add(_add_args(concept_id="2", alias="小甲"))
    assert ea._flip("小甲", remove=False) == 0
    assert all(r["confirmed"] for r in sa.load())


# ---------- cmd_list ----------

def test_list_empty_table(sandbox, capsys):
    assert ea.cmd_list() == 0
    assert "侧表为空" in capsys.readouterr().out


def test_list_shows_state_and_provenance(sandbox, capsys):
    ea.cmd_add(_add_args())
    ea._flip("融朵", remove=False)
    ea.cmd_add(_add_args(alias="拉蒙娜"))
    assert ea.cmd_list() == 0
    out = capsys.readouterr().out
    assert "已确认  融朵 → 15602" in out
    assert "未确认  拉蒙娜 → 15602" in out
    assert "[bilibili]" in out          # 出身牌来源可见
    assert "共 2 条（已确认 1）" in out


# ---------- cmd_grep_evidence：档案核证据 ----------

def test_grep_evidence_hit(sandbox, capsys):
    (sandbox["community"] / "2026-07-01.jsonl").write_text(
        '{"content": "今天打融朵好难"}\n', encoding="utf-8")
    assert ea.cmd_grep_evidence("融朵") == 0
    out = capsys.readouterr().out
    assert "融朵" in out
    assert "命中 1 处" in out


def test_grep_evidence_zero_hit_blocks_entry(sandbox, capsys):
    """档案零命中 = 证据不存在 → 返回非零，禁止落表（防伪造出身牌）。"""
    assert ea.cmd_grep_evidence("查无此名") == 1
    assert "证据不存在" in capsys.readouterr().out


def test_grep_evidence_respects_limit(sandbox, capsys):
    for i in range(5):
        (sandbox["community"] / f"f{i}.jsonl").write_text(
            '{"content": "热词重复"}\n', encoding="utf-8")
    assert ea.cmd_grep_evidence("热词", limit=2) == 0
    out = capsys.readouterr().out
    assert "命中 2 处（上限 2）" in out


# ---------- feed_gap / cmd_harvest：消费失败喂料闭环 ----------

def test_feed_gap_appends_jsonl(sandbox):
    ea.feed_gap("锚不到的黑话")
    ea.feed_gap("锚不到的黑话")
    ea.feed_gap("另一个查询")
    lines = sandbox["gaps"].read_text(encoding="utf-8").splitlines()
    assert len(lines) == 3
    rec = json.loads(lines[0])
    assert rec["query"] == "锚不到的黑话"
    assert rec["added"] == date.today().isoformat()


def test_feed_gap_never_raises(sandbox, monkeypatch):
    """best-effort 铁律：落盘失败也绝不抛穿运行时消费方。"""
    monkeypatch.setattr(ea, "GAPS_PATH", Path("/proc/nonexistent/gaps.jsonl"))
    ea.feed_gap("任意查询")  # 不抛即通过


def test_harvest_missing_file(sandbox, capsys):
    assert ea.cmd_harvest() == 0
    assert "无消费失败喂料" in capsys.readouterr().out


def test_harvest_counts_and_skips_garbage(sandbox, capsys):
    ea.feed_gap("高频词")
    ea.feed_gap("高频词")
    ea.feed_gap("低频词")
    with sandbox["gaps"].open("a", encoding="utf-8") as fh:
        fh.write("{broken json\n")          # 坏行跳过
        fh.write('{"query": "  "}\n')       # 空查询跳过
    assert ea.cmd_harvest() == 0
    out = capsys.readouterr().out
    assert out.index("高频词") < out.index("低频词")  # 按频次降序
    assert "   2  高频词" in out
    assert "2 个零锚查询候选" in out


# ---------- main()：CLI 派发全路径 ----------

def _run_cli(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["extract_aliases.py", *argv])
    return ea.main()


def test_cli_add_confirm_list_revoke_flow(sandbox, monkeypatch, capsys):
    """CLI 全流程：add → confirm → list → revoke，落盘与读取层同步演进。"""
    _write_characters(sandbox["characters"], [15602])
    assert _run_cli(monkeypatch, "add", "--concept-id", "15602",
                    "--alias", "融朵", "--source", "bilibili",
                    "--ref", "r.jsonl", "--quote", "真实原文",
                    "--inferred-by", "session-x") == 0
    assert sa.alias_map(confirmed_only=False) == {"融朵": "15602"}
    assert _run_cli(monkeypatch, "confirm", "融朵") == 0
    assert sa.alias_map() == {"融朵": "15602"}
    assert _run_cli(monkeypatch, "list") == 0
    assert "已确认" in capsys.readouterr().out
    assert _run_cli(monkeypatch, "revoke", "融朵") == 0
    assert sa.load() == []


def test_cli_grep_evidence_and_harvest(sandbox, monkeypatch, capsys):
    (sandbox["community"] / "a.jsonl").write_text("证据原文\n", encoding="utf-8")
    assert _run_cli(monkeypatch, "grep-evidence", "证据原文", "--limit", "3") == 0
    ea.feed_gap("候选")
    assert _run_cli(monkeypatch, "harvest") == 0
    assert "候选" in capsys.readouterr().out


def test_cli_requires_subcommand(sandbox, monkeypatch):
    with pytest.raises(SystemExit):
        _run_cli(monkeypatch)
