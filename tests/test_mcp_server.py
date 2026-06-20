"""Unit tests for scripts/mcp_server.py (BIAV-SC Memory MCP Server).

The server imports `mcp.server.fastmcp.FastMCP` at module load; when the `mcp`
package is absent it prints tool definitions and calls sys.exit(0). To make the
tool handlers importable and testable in any environment, we inject a stub
`mcp.server.fastmcp` module into sys.modules BEFORE importing mcp_server. The
stub's FastMCP.tool() is an identity decorator, so every handler stays a plain
callable function.

All knowledge-layer dependencies are loaded lazily inside each handler via
`from <module> import <fn>`, which gives a clean seam: we patch the real module
attributes (the modules live under scripts/, already on sys.path) so no real
memory/ or assets/ files are touched.
"""

import json
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))


def _install_mcp_stub():
    """Install a minimal stub for the `mcp` package so mcp_server imports
    cleanly with an identity tool() decorator."""
    if "mcp.server.fastmcp" in sys.modules:
        return

    class _StubFastMCP:
        def __init__(self, *args, **kwargs):
            self.name = args[0] if args else kwargs.get("name", "")

        def tool(self, *args, **kwargs):
            def decorator(fn):
                return fn

            return decorator

        def run(self, *args, **kwargs):  # pragma: no cover - not exercised
            return None

    pkg = types.ModuleType("mcp")
    server = types.ModuleType("mcp.server")
    fastmcp = types.ModuleType("mcp.server.fastmcp")
    fastmcp.FastMCP = _StubFastMCP
    server.fastmcp = fastmcp
    pkg.server = server
    sys.modules["mcp"] = pkg
    sys.modules["mcp.server"] = server
    sys.modules["mcp.server.fastmcp"] = fastmcp


_install_mcp_stub()

import mcp_server  # noqa: E402


class TestMemorySearch(unittest.TestCase):
    def test_no_results_returns_message(self):
        with mock.patch("memory_search.search", return_value=[]), \
                mock.patch("memory_search.synthesize", return_value=None):
            out = json.loads(mcp_server.memory_search("黑池"))
        self.assertEqual(out["results"], [])
        self.assertIn("黑池", out["message"])

    def test_results_formatted_with_preview_truncated(self):
        long_preview = "x" * 500
        results = [{
            "file": "memory/decisions.md",
            "final_score": 0.87,
            "preview": long_preview,
            "scores": {"semantic": 0.9},
        }]
        with mock.patch("memory_search.search", return_value=results), \
                mock.patch("memory_search.synthesize", return_value=None):
            out = json.loads(mcp_server.memory_search("决策", top_k=3))
        self.assertEqual(out["query"], "决策")
        self.assertEqual(len(out["results"]), 1)
        r = out["results"][0]
        self.assertEqual(r["file"], "memory/decisions.md")
        self.assertEqual(r["score"], 0.87)
        self.assertEqual(len(r["preview"]), 200)  # truncated to [:200]
        self.assertEqual(r["scores"], {"semantic": 0.9})
        self.assertNotIn("synthesis", out)

    def test_score_falls_back_to_plain_score(self):
        results = [{"file": "a.md", "score": 0.4}]
        with mock.patch("memory_search.search", return_value=results), \
                mock.patch("memory_search.synthesize", return_value=None):
            out = json.loads(mcp_server.memory_search("q"))
        self.assertEqual(out["results"][0]["score"], 0.4)
        self.assertEqual(out["results"][0]["preview"], "")

    def test_synthesis_attached_when_present(self):
        results = [{"file": "a.md", "final_score": 0.5}]
        with mock.patch("memory_search.search", return_value=results), \
                mock.patch("memory_search.synthesize", return_value="跨文档综合"):
            out = json.loads(mcp_server.memory_search("q"))
        self.assertEqual(out["synthesis"], "跨文档综合")


class TestGraphQuery(unittest.TestCase):
    def test_missing_graph_returns_error(self):
        with mock.patch("knowledge_graph.load_graph", return_value=None):
            out = json.loads(mcp_server.graph_query("黑池"))
        self.assertIn("error", out)
        self.assertIn("rebuild_indexes", out["error"])

    def test_entity_not_found(self):
        with mock.patch("knowledge_graph.load_graph", return_value={"nodes": []}), \
                mock.patch("knowledge_graph.find_node", return_value=[]):
            out = json.loads(mcp_server.graph_query("不存在实体"))
        self.assertIn("error", out)
        self.assertIn("不存在实体", out["error"])

    def test_found_entity_with_neighbors(self):
        node = {"id": "system:黑池", "name": "黑池", "type": "System", "properties": {"k": "v"}}
        neighbors = {
            "neighbors": [
                {"node": {"id": "n1", "name": "洛水", "type": "Character"},
                 "edge_type": "related", "direction": "out", "depth": 1},
            ]
        }
        with mock.patch("knowledge_graph.load_graph", return_value={"x": 1}), \
                mock.patch("knowledge_graph.find_node", return_value=[{"node": node}]), \
                mock.patch("knowledge_graph.get_neighbors", return_value=neighbors) as gn:
            out = json.loads(mcp_server.graph_query("黑池", depth=5))
        # depth clamped to 3
        self.assertEqual(gn.call_args.kwargs["depth"], 3)
        self.assertEqual(out["entity"]["name"], "黑池")
        self.assertEqual(out["entity"]["properties"], {"k": "v"})
        self.assertEqual(out["total_neighbors"], 1)
        self.assertEqual(out["neighbors"][0]["name"], "洛水")
        self.assertEqual(out["neighbors"][0]["edge"], "related")

    def test_neighbor_name_falls_back_to_id(self):
        node = {"id": "system:黑池", "name": "黑池", "type": "System"}
        neighbors = {"neighbors": [
            {"node": {"id": "bare_id"}, "edge_type": "e", "direction": "in", "depth": 1},
        ]}
        with mock.patch("knowledge_graph.load_graph", return_value={"x": 1}), \
                mock.patch("knowledge_graph.find_node", return_value=[{"node": node}]), \
                mock.patch("knowledge_graph.get_neighbors", return_value=neighbors):
            out = json.loads(mcp_server.graph_query("黑池"))
        self.assertEqual(out["neighbors"][0]["name"], "bare_id")
        self.assertEqual(out["neighbors"][0]["type"], "?")


class TestGraphRelatedFiles(unittest.TestCase):
    def test_missing_graph_error(self):
        with mock.patch("knowledge_graph.load_graph", return_value=None):
            out = json.loads(mcp_server.graph_related_files("洛水"))
        self.assertIn("error", out)

    def test_returns_top_ten_related(self):
        related = [f"file{i}.md" for i in range(20)]
        with mock.patch("knowledge_graph.load_graph", return_value={"x": 1}), \
                mock.patch("knowledge_graph.find_related_files", return_value=related) as fr:
            out = json.loads(mcp_server.graph_related_files("洛水", max_depth=9))
        # max_depth clamped to 3
        self.assertEqual(fr.call_args.kwargs["max_depth"], 3)
        self.assertEqual(out["entity"], "洛水")
        self.assertEqual(len(out["related_files"]), 10)


class TestMemoryUtility(unittest.TestCase):
    def test_rankings_sorted_desc_and_capped(self):
        utility = {
            "low.md": {"utility": 0.1, "trend": "declining", "access_count": 1, "insight_citations": 0},
            "high.md": {"utility": 0.9, "trend": "rising", "access_count": 5, "insight_citations": 3},
            "mid.md": {"utility": 0.5, "trend": "stable", "access_count": 2, "insight_citations": 1},
        }
        with mock.patch("memrl.compute_utility", return_value=utility):
            out = json.loads(mcp_server.memory_utility(top_n=2))
        self.assertEqual(out["total_files"], 3)
        self.assertEqual(len(out["rankings"]), 2)
        self.assertEqual(out["rankings"][0]["file"], "high.md")
        self.assertEqual(out["rankings"][1]["file"], "mid.md")

    def test_empty_utility(self):
        with mock.patch("memrl.compute_utility", return_value={}):
            out = json.loads(mcp_server.memory_utility())
        self.assertEqual(out["rankings"], [])
        self.assertEqual(out["total_files"], 0)


class TestCheckCache(unittest.TestCase):
    def test_hit(self):
        with mock.patch("dream.check_cache", return_value={"answer": "42"}):
            out = json.loads(mcp_server.check_cache("生命的意义"))
        self.assertTrue(out["hit"])
        self.assertEqual(out["entry"], {"answer": "42"})

    def test_miss(self):
        with mock.patch("dream.check_cache", return_value=None):
            out = json.loads(mcp_server.check_cache("冷门问题"))
        self.assertFalse(out["hit"])
        self.assertIn("memory_search", out["message"])


class TestRecommendContext(unittest.TestCase):
    def test_uses_context_manager_when_available(self):
        with mock.patch("context_manager.recommend_context",
                        return_value={"recommended_files": ["a.md"]}) as rec:
            out = json.loads(mcp_server.recommend_context("话题", role="Code-wiki", max_files=3))
        rec.assert_called_once_with("话题", role="Code-wiki", max_files=3)
        self.assertEqual(out["recommended_files"], ["a.md"])

    def test_falls_back_to_search_on_import_error(self):
        # Force the `from context_manager import recommend_context` to raise.
        real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

        def fake_import(name, *args, **kwargs):
            if name == "context_manager":
                raise ImportError("no context_manager")
            return real_import(name, *args, **kwargs)

        search_results = [{"file": "f.md", "final_score": 0.6}]
        with mock.patch("builtins.__import__", side_effect=fake_import), \
                mock.patch("memory_search.search", return_value=search_results):
            out = json.loads(mcp_server.recommend_context("话题", max_files=2))
        self.assertEqual(out["query"], "话题")
        self.assertEqual(out["recommended_files"][0]["file"], "f.md")
        self.assertEqual(out["recommended_files"][0]["reason"], "semantic_match")


class TestRebuildIndexes(unittest.TestCase):
    def test_all_three_succeed(self):
        idx = {"vectors": {"a": 1, "b": 2}, "vocabulary": {"x": 1}}
        graph = {"meta": {"node_count": 10, "edge_count": 20}}
        with mock.patch("memory_search.build_index", return_value=idx), \
                mock.patch("knowledge_graph.build_graph", return_value=graph), \
                mock.patch("memrl.compute_utility", return_value={"f.md": {}}):
            out = json.loads(mcp_server.rebuild_indexes())
        self.assertEqual(out["vector_index"]["status"], "ok")
        self.assertEqual(out["vector_index"]["chunks"], 2)
        self.assertEqual(out["vector_index"]["vocabulary"], 1)
        self.assertEqual(out["knowledge_graph"]["nodes"], 10)
        self.assertEqual(out["knowledge_graph"]["edges"], 20)
        self.assertEqual(out["memory_utility"]["files_scored"], 1)

    def test_partial_failure_captured_per_section(self):
        with mock.patch("memory_search.build_index", side_effect=RuntimeError("idx boom")), \
                mock.patch("knowledge_graph.build_graph", return_value={"meta": {"node_count": 1, "edge_count": 0}}), \
                mock.patch("memrl.compute_utility", side_effect=ValueError("util boom")):
            out = json.loads(mcp_server.rebuild_indexes())
        self.assertEqual(out["vector_index"]["status"], "error")
        self.assertIn("idx boom", out["vector_index"]["message"])
        self.assertEqual(out["knowledge_graph"]["status"], "ok")
        self.assertEqual(out["memory_utility"]["status"], "error")
        self.assertIn("util boom", out["memory_utility"]["message"])

    def test_graph_build_failure_captured(self):
        idx = {"vectors": {}, "vocabulary": {}}
        with mock.patch("memory_search.build_index", return_value=idx), \
                mock.patch("knowledge_graph.build_graph", side_effect=KeyError("meta")), \
                mock.patch("memrl.compute_utility", return_value={}):
            out = json.loads(mcp_server.rebuild_indexes())
        self.assertEqual(out["knowledge_graph"]["status"], "error")
        self.assertEqual(out["vector_index"]["status"], "ok")


class TestStoreFacts(unittest.TestCase):
    def test_json_array_passed_through(self):
        items_in = [{"content": "FTS5 换 MeiliSearch", "category": "decision"}]
        store_result = [{"action": "added", "fact": {"content": "FTS5 换 MeiliSearch"}, "similarity": None}]
        with mock.patch("fact_store.store_multiple_facts", return_value=store_result) as smf:
            out = json.loads(mcp_server.store_facts(json.dumps(items_in)))
        smf.assert_called_once_with(items_in)
        self.assertEqual(out["added"], 1)
        self.assertEqual(out["details"][0]["content"], "FTS5 换 MeiliSearch")

    def test_json_string_wrapped_as_single_discovery(self):
        with mock.patch("fact_store.store_multiple_facts", return_value=[]) as smf:
            mcp_server.store_facts('"裸字符串事实"')
        smf.assert_called_once_with([{"content": "裸字符串事实", "category": "discovery"}])

    def test_json_object_wrapped_in_list(self):
        obj = {"content": "单个对象", "category": "context"}
        with mock.patch("fact_store.store_multiple_facts", return_value=[]) as smf:
            mcp_server.store_facts(json.dumps(obj))
        smf.assert_called_once_with([obj])

    def test_plain_text_invalid_json_treated_as_single_fact(self):
        with mock.patch("fact_store.store_multiple_facts", return_value=[]) as smf:
            mcp_server.store_facts("这不是 JSON, 只是一句话")
        smf.assert_called_once_with(
            [{"content": "这不是 JSON, 只是一句话", "category": "discovery"}]
        )

    def test_summary_counts_and_merged_content_fallback(self):
        # merged entry has no "fact"; content falls back to "existing"
        store_result = [
            {"action": "added", "fact": {"content": "新事实"}, "similarity": None},
            {"action": "merged", "existing": "已存在的旧事实", "similarity": 0.8},
            {"action": "duplicate", "existing": "重复", "similarity": 0.95},
        ]
        with mock.patch("fact_store.store_multiple_facts", return_value=store_result):
            out = json.loads(mcp_server.store_facts("[]"))
        self.assertEqual(out["added"], 1)
        self.assertEqual(out["merged"], 1)
        self.assertEqual(out["duplicate"], 1)
        merged_detail = next(d for d in out["details"] if d["action"] == "merged")
        self.assertEqual(merged_detail["content"], "已存在的旧事实")
        self.assertEqual(merged_detail["similarity"], 0.8)


class TestMemoryWriteback(unittest.TestCase):
    def test_passes_dry_run_flag(self):
        with mock.patch("memory_writeback.run_writeback",
                        return_value={"status": "ok", "facts": 3}) as rw:
            out = json.loads(mcp_server.memory_writeback(dry_run=True))
        rw.assert_called_once_with(dry_run=True)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["facts"], 3)


class TestSessionBriefing(unittest.TestCase):
    def test_returns_markdown_and_sections(self):
        briefing = {
            "sections": {"last_session": "回顾"},
            "generated_at": "2026-06-19T00:00:00",
        }
        with mock.patch("session_briefing.generate_briefing", return_value=briefing) as gb, \
                mock.patch("session_briefing.render_markdown", return_value="# 简报"):
            out = json.loads(mcp_server.session_briefing(role="Code-news"))
        gb.assert_called_once_with(role="Code-news")
        self.assertEqual(out["briefing_markdown"], "# 简报")
        self.assertEqual(out["sections"], {"last_session": "回顾"})
        self.assertEqual(out["generated_at"], "2026-06-19T00:00:00")


class TestCharacterPersona(unittest.TestCase):
    def test_list_action(self):
        personas = [{"id": "erica"}, {"id": "other"}]
        with mock.patch("character_persona.list_personas", return_value=personas):
            out = json.loads(mcp_server.character_persona(action="list"))
        self.assertEqual(out["total"], 2)
        self.assertEqual(out["available_personas"], personas)

    def test_unknown_character_returns_error_with_available(self):
        with mock.patch("character_persona.load_persona", return_value=None), \
                mock.patch("character_persona.list_personas",
                           return_value=[{"id": "erica"}]):
            out = json.loads(mcp_server.character_persona(character="ghost"))
        self.assertIn("error", out)
        self.assertIn("ghost", out["error"])
        self.assertEqual(out["available"], ["erica"])

    def test_greeting_action(self):
        persona = {"name": "艾瑞卡"}
        with mock.patch("character_persona.load_persona", return_value=persona), \
                mock.patch("character_persona.build_greeting", return_value="艾瑞卡，待命。") as bg:
            out = json.loads(mcp_server.character_persona(character="erica", action="greeting"))
        bg.assert_called_once_with(persona, platform="silver_core")
        self.assertEqual(out["name"], "艾瑞卡")
        self.assertEqual(out["greeting"], "艾瑞卡，待命。")

    def test_default_prompt_action(self):
        persona = {"name": "艾瑞卡"}
        with mock.patch("character_persona.load_persona", return_value=persona), \
                mock.patch("character_persona.build_system_prompt",
                           return_value="你是艾瑞卡") as bsp:
            out = json.loads(mcp_server.character_persona(character="erica", context="测试上下文"))
        bsp.assert_called_once_with(persona, context="测试上下文", platform="silver_core")
        self.assertEqual(out["system_prompt"], "你是艾瑞卡")
        self.assertIn("usage", out)


class TestSilverMemoryTools(unittest.TestCase):
    def test_recall_session(self):
        payload = {"matches": [{"session_id": "s1", "score": 0.7}]}
        with mock.patch("silver_memory_tools.recall_session", return_value=payload) as rs:
            out = json.loads(mcp_server.recall_session("关键词", k=3))
        rs.assert_called_once_with("关键词", 3)
        self.assertEqual(out, payload)

    def test_current_continuity(self):
        payload = {"last_session_file": "x.md", "topics_hint": ["a"]}
        with mock.patch("silver_memory_tools.current_continuity", return_value=payload) as cc:
            out = json.loads(mcp_server.current_continuity())
        cc.assert_called_once_with()
        self.assertEqual(out, payload)

    def test_record_decision(self):
        with mock.patch("silver_memory_tools.record_decision",
                        return_value={"status": "ok", "line_added": "..."}) as rd:
            out = json.loads(mcp_server.record_decision("摘要", "全局", rationale="理由"))
        rd.assert_called_once_with("摘要", "全局", "理由")
        self.assertEqual(out["status"], "ok")

    def test_record_lesson(self):
        with mock.patch("silver_memory_tools.record_lesson",
                        return_value={"status": "ok", "lesson_id": "L99"}) as rl:
            out = json.loads(mcp_server.record_lesson("教训摘要", context="场景"))
        rl.assert_called_once_with("教训摘要", "场景")
        self.assertEqual(out["lesson_id"], "L99")

    def test_session_progress(self):
        with mock.patch("silver_memory_tools.session_progress",
                        return_value={"events": [{"t": 1}]}) as sp:
            out = json.loads(mcp_server.session_progress("sess-1"))
        sp.assert_called_once_with("sess-1")
        self.assertEqual(out["events"], [{"t": 1}])


if __name__ == "__main__":
    unittest.main()
