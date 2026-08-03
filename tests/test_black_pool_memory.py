"""blackpool 记忆插件守卫：中文分词确定性 + 插件完备性 + 端到端中文召回。

守密人 2026-08-03 裁定立项：黑池记忆层走「Holographic 中文化壳」路线——
零上游侵入（纯子类 + 兄弟插件位），分词确定性（FMM + bigram 回落，索引/查询
同一分词器故召回不依赖语言学正确性）。
"""
import importlib.util
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SUB = REPO / "projects" / "black-pool-agent"
PLUGIN = SUB / "plugins" / "memory" / "blackpool"
UPSTREAM = SUB / "upstream"


def _load_zh_seg():
    spec = importlib.util.spec_from_file_location("bp_zh_seg", PLUGIN / "zh_seg.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# 分词器（纯函数，零依赖）
# ---------------------------------------------------------------------------

def test_zh_seg_dict_hit_whole_word():
    seg = _load_zh_seg()
    toks = seg.tokenize("守密人喜欢黑池")
    assert "守密人" in toks, "词典词须整词切出"
    assert "黑池" in toks


def test_zh_seg_bigram_fallback_covers_uncovered_runs():
    seg = _load_zh_seg()
    toks = seg.tokenize("鎏金主题")
    # 鎏金 在词典；主题 不在 → bigram 覆盖，任意相邻二字可查
    assert "鎏金" in toks
    assert "主题" in toks or ("金主" in toks and "题" not in toks)


def test_zh_seg_latin_passthrough_and_mixed():
    seg = _load_zh_seg()
    toks = seg.tokenize("deploy 黑池 v2 bundle")
    assert "deploy" in toks and "bundle" in toks and "黑池" in toks


def test_zh_seg_deterministic_and_consistent():
    """核心契约：索引侧与查询侧同一分词器 → 子串查询的词元必在全文词元集内。"""
    seg = _load_zh_seg()
    content_toks = set(seg.tokenize("今天在部署位启用了鎏金主题"))
    query_toks = set(seg.tokenize("鎏金主题"))
    assert query_toks, "查询不得切空"
    assert query_toks & content_toks, "同一分词器下查询词元必须与内容词元相交"
    assert seg.tokenize("守密人喜欢黑池") == seg.tokenize("守密人喜欢黑池")


def test_zh_seg_empty_and_seg_join():
    seg = _load_zh_seg()
    assert seg.tokenize("") == []
    assert seg.seg_join("") == ""
    assert " " in seg.seg_join("守密人喜欢黑池")


# ---------------------------------------------------------------------------
# 插件完备性（结构守卫）
# ---------------------------------------------------------------------------

def test_plugin_files_complete():
    for name in ("__init__.py", "zh_seg.py", "plugin.yaml", "README.md", "dict.txt"):
        assert (PLUGIN / name).is_file(), f"blackpool 插件缺件: {name}"


def test_plugin_discoverable_by_upstream_heuristic():
    """上游 _is_memory_provider_dir 用文本扫描（前 8192 字节）认插件。"""
    head = (PLUGIN / "__init__.py").read_text(encoding="utf-8")[:8192]
    assert "MemoryProvider" in head and "register_memory_provider" in head


def test_plugin_dir_name_importable():
    assert PLUGIN.name.isidentifier(), "目录名必须是合法模块名（importlib 导入）"


def test_plugin_zero_intranet_values():
    for name in ("__init__.py", "zh_seg.py", "plugin.yaml", "README.md"):
        text = (PLUGIN / name).read_text(encoding="utf-8").lower()
        for marker in ("http://", "https://", "idealab", "api_key", "token="):
            assert marker not in text, f"{name} 含疑似内网值/端点标记: {marker}"


def test_dict_terms_are_cjk_multichar():
    lines = (PLUGIN / "dict.txt").read_text(encoding="utf-8").splitlines()
    terms = [t.strip() for t in lines if t.strip()]
    assert len(terms) >= 100, "随行词典异常缩水"
    assert all(len(t) >= 2 for t in terms)


# ---------------------------------------------------------------------------
# 端到端：中文事实入库后能被中文关键词召回（可跳过：依赖上游导入链）
# ---------------------------------------------------------------------------

def _fts5_available() -> bool:
    try:
        sqlite3.connect(":memory:").execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        return True
    except sqlite3.OperationalError:
        return False


@pytest.mark.skipif(not _fts5_available(), reason="本环境 SQLite 无 FTS5")
def test_chinese_fact_roundtrip_and_stock_negative_control(tmp_path):
    """子进程内跑上游导入链（不污染本进程 sys.path / sys.modules）：
    blackpool store 存中文事实 → 中文关键词三路检索命中；
    负控：同库 stock facts_fts 对同一查询 MATCH 不到（证明修的就是这条缝）。"""
    script = r"""
import json, sys
from pathlib import Path
upstream, plugin_parent, home, db = sys.argv[1:5]
sys.path.insert(0, upstream)
try:
    import hermes_constants  # noqa: F401  (upstream import chain probe)
    from plugins.memory.holographic.retrieval import FactRetriever
except Exception as e:
    print("SKIP:" + repr(e)); sys.exit(42)
import os
os.environ["HERMES_HOME"] = home
sys.path.insert(0, plugin_parent)
import importlib.util
spec = importlib.util.spec_from_file_location(
    "plugins.memory.blackpool", Path(plugin_parent) / "blackpool" / "__init__.py",
    submodule_search_locations=[str(Path(plugin_parent) / "blackpool")])
mod = importlib.util.module_from_spec(spec)
sys.modules["plugins.memory.blackpool"] = mod
spec.loader.exec_module(mod)
store = mod.ZhMemoryStore(db_path=db, default_trust=0.5)
# 负控素材刻意零标点：CJK 引号/标点本身是 FTS 分隔符，会让 stock 索引意外切词
fid = store.add_fact("守密人喜欢鎏金主题的黑池终端", category="user_pref")
r = mod.ZhFactRetriever(store=store)
hits = r.search("鎏金 主题")
assert hits and hits[0]["fact_id"] == fid, "中文关键词未召回: %r" % hits
# 实体抽取：CJK 引号
ents = store._extract_entities("守密人喜欢「鎏金」主题")
assert "鎏金" in ents, ents
# 负控：stock FTS 表对同一分词后查询无命中（未分词索引）
q = FactRetriever._sanitize_fts_query("鎏金 主题")
rows = store._conn.execute(
    "SELECT rowid FROM facts_fts WHERE facts_fts MATCH ?", (q,)).fetchall()
assert not rows, "stock FTS 竟然命中——负控失效，检查前提"
store.close()
print("OK")
"""
    r = subprocess.run(
        [sys.executable, "-c", script, str(UPSTREAM),
         str(PLUGIN.parent), str(tmp_path), str(tmp_path / "m.db")],
        capture_output=True, text=True)
    if r.returncode == 42:
        pytest.skip(f"上游导入链在本环境不可用: {r.stdout.strip()[:200]}")
    assert r.returncode == 0, f"stdout={r.stdout[-800:]}\nstderr={r.stderr[-800:]}"
    assert "OK" in r.stdout
