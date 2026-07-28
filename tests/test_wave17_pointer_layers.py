"""审计第十七波 · 知识库看不见的暗物质（`scripts/okf_pointer_layers.py`）。

波次十七在这里修的是一份**写死的名单**：子项目清单原先硬编码五个名字，于是
`silver-core-maestro-sdk` 与 `silver-core-testbed` 建起来之后，两份 CONTEXT.md
（CLAUDE.md §6「动手前必读」）**从未进过知识库**——`kb_search("silver-core-maestro-sdk
子项目上下文")` 的第一名是另一个 SDK 的 CONTEXT，maestro 那份一条都够不到。名单写死时，
新子项目的上下文就是知识库永远看不见的暗物质，而且没有任何东西会为此报红。
（同波次 `kb_coverage.KNOWLEDGE_GLOBS` 的五条硬编码是同一个病根的另一张脸。）

本档把「清单从磁盘发现」钉成可验证事实：临时仓里放三个子项目，其中一个是**名单里
从来没有过的名字**，它必须照样出现在 projects 层里。

顺带覆盖两个休眠层生成器（`build_unpacked` / `build_extracted`）：它们的源目录已随
2026-07-12 裁定整层删除，因此在真实仓上恒走空返回——一旦哪天从 Releases 重解回来，
这两段代码会在**没有任何测试**的情况下重新上岗。此处用临时目录把它们跑一遍。

绝不写进真实 `okf/`：`REPO` 与 `BUNDLE` 双双改道 tmp_path（只改一个就会把真 bundle 覆盖）。

小学生比喻：点名册是手抄的，新转来的同学没抄上去——老师每天点名都「全员到齐」，
而那两个孩子从来没被叫到过。改成按座位表现点现数，才不会漏人。
"""
from __future__ import annotations

from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import okf_pointer_layers as opl  # noqa: E402


@pytest.fixture
def fake_bundle(tmp_path, monkeypatch):
    """把生成器整个搬进 tmp：读 tmp、写 tmp，真实 okf/ 一个字节都不动。"""
    monkeypatch.setattr(opl, "REPO", tmp_path)
    monkeypatch.setattr(opl, "BUNDLE", tmp_path / "okf")
    return tmp_path


def _ctx(repo: Path, name: str, blurb: str):
    d = repo / "projects" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "CONTEXT.md").write_text(f"# {name}\n\n{blurb}\n", encoding="utf-8")


class TestSubprojectDiscovery:
    def test_every_subproject_with_a_context_is_picked_up(self, fake_bundle):
        """包括名单里从来没有过的名字——这正是本次修复的全部意义。"""
        _ctx(fake_bundle, "news", "使命#1 采集层。")
        _ctx(fake_bundle, "silver-core-maestro-sdk", "钟 / 跨会话状态 / 会话装配零件。")
        _ctx(fake_bundle, "brand-new-subproject", "名单里从来没有过的新子项目。")
        (fake_bundle / "projects" / "no-context").mkdir()  # 无 CONTEXT.md 的目录不算

        written = opl.build_projects()
        ids = {e["id"] for e in written}
        assert "project-silver-core-maestro-sdk" in ids, "硬编码名单正是它此前的失踪原因"
        assert "project-brand-new-subproject" in ids
        assert "project-no-context" not in ids

    def test_discovery_is_deterministic_and_carries_the_blurb(self, fake_bundle):
        for name in ("zeta", "alpha", "mid"):
            _ctx(fake_bundle, name, f"{name} 的一句话摘要。")
        written = opl.build_projects()
        proj = [e for e in written if e["id"].startswith("project-")]
        assert [e["id"] for e in proj] == ["project-alpha", "project-mid", "project-zeta"], (
            "排序保确定性——生成物每次重跑必须逐字节可复现"
        )
        assert proj[0]["description"] == "alpha 的一句话摘要。"
        assert proj[0]["resource"] == "/projects/alpha/CONTEXT.md"
        assert "sub-project-context" in proj[0]["tags"]

    def test_missing_projects_dir_is_not_an_error(self, fake_bundle):
        (fake_bundle / "CLAUDE.md").write_text("# 入口\n\n统一入口。\n", encoding="utf-8")
        written = opl.build_projects()
        assert [e["id"] for e in written] == ["entry-claude-md"]

    def test_entry_docs_and_treasure_map_are_included(self, fake_bundle):
        (fake_bundle / "CLAUDE.md").write_text("# 入口\n\nAI 统一入口。\n", encoding="utf-8")
        (fake_bundle / "README.md").write_text("# 主入口\n\n人 + AI 共用。\n", encoding="utf-8")
        (fake_bundle / "RELEASES.md").write_text("# 藏宝图\n\n二进制本体指针。\n", encoding="utf-8")
        (fake_bundle / "memory").mkdir()
        (fake_bundle / "memory" / "testing-strategy.md").write_text(
            "# 测试策略\n\n反凑数立场。\n", encoding="utf-8"
        )
        sdk_docs = fake_bundle / "projects" / "silver-core-sdk" / "docs"
        sdk_docs.mkdir(parents=True)
        (sdk_docs / "architecture.md").write_text("# 架构\n\n两轴保真模型。\n", encoding="utf-8")
        design = fake_bundle / "projects" / "site" / "design"
        design.mkdir(parents=True)
        (design / "tokens.css").write_text(":root{--x:1}", encoding="utf-8")
        news_scripts = fake_bundle / "projects" / "news" / "scripts"
        news_scripts.mkdir(parents=True)
        (news_scripts / "archive_sources.json").write_text("{}", encoding="utf-8")

        ids = {e["id"] for e in opl.build_projects()}
        assert {
            "entry-claude-md", "entry-readme", "releases-treasure-map",
            "doc-testing-strategy", "silver-core-sdk-doc-architecture",
            "site-design-tokens", "news-archive-sources-registry",
        } <= ids

    def test_layer_files_land_in_the_redirected_bundle_only(self, fake_bundle):
        """双改道自检：真实 okf/ 不许被测试写脏（只改 REPO 会当场覆盖它）。"""
        _ctx(fake_bundle, "news", "采集层。")
        opl.build_projects()
        out_dir = fake_bundle / "okf" / "projects"
        assert (out_dir / "project-news.md").exists()
        assert (out_dir / "index.md").exists()
        assert "放指针不放本体" in (out_dir / "project-news.md").read_text(encoding="utf-8")


class TestDormantUnpackLayers:
    """两个休眠层：源目录已整层删除，恒走空返回；重解回来时这段代码要能用。"""

    def test_absent_roots_yield_empty_layers(self, fake_bundle):
        assert opl.build_unpacked() == []
        assert opl.build_extracted() == []

    def test_unpacked_layer_labels_text_and_bytecode_by_sniffing(self, fake_bundle):
        root = fake_bundle / "Public-Info-Pool" / "Reference" / "Game-Unpacked"
        (root / "游戏文本").mkdir(parents=True)
        (root / "游戏文本" / "a.txt").write_text("明文", encoding="utf-8")
        (root / "Lua表还原").mkdir(parents=True)
        (root / "Lua表还原" / "a.lua").write_bytes(b"\x1bLua\x51\x00\x01\x04")

        written = {e["id"]: e for e in opl.build_unpacked()}
        assert set(written) == {"unpacked-game-text", "unpacked-lua-tables"}
        assert "encoding:text" in written["unpacked-game-text"]["tags"]
        assert "encoding:luac" in written["unpacked-lua-tables"]["tags"]
        assert "字节码" in written["unpacked-lua-tables"]["description"]
        assert all("data_layer:full_archive" in e["tags"] for e in written.values()), (
            "解包层是全量档案层——层标签错了就会被当输出层引用（lesson #30 那类误用）"
        )

    def test_empty_dir_defaults_to_text_encoding(self, fake_bundle):
        root = fake_bundle / "Public-Info-Pool" / "Reference" / "Game-Unpacked"
        (root / "空目录").mkdir(parents=True)
        assert "encoding:text" in opl.build_unpacked()[0]["tags"]

    def test_extracted_layer_includes_the_readme_pointer(self, fake_bundle):
        root = fake_bundle / "projects" / "wiki" / "data" / "extracted"
        (root / "categorized").mkdir(parents=True)
        (root / "categorized" / "story.txt").write_text("正文", encoding="utf-8")
        (root / "README.md").write_text("# extracted\n\n解包一手层说明与数据血缘。\n",
                                        encoding="utf-8")

        written = {e["id"]: e for e in opl.build_extracted()}
        assert set(written) == {"extracted-categorized", "extracted-readme"}
        assert written["extracted-categorized"]["resource"] == (
            "/projects/wiki/data/extracted/categorized/"
        )
        assert written["extracted-readme"]["description"] == "解包一手层说明与数据血缘。"


class TestSizeAndMagnitudeHelpers:
    @pytest.mark.parametrize(
        ("n", "expected"),
        [(0, "0B"), (2048, "2.0KB"), (5 * 1024**2, "5.0MB"), (3 * 1024**3, "3.0GB")],
    )
    def test_human_size(self, n, expected):
        assert opl._human_size(n) == expected

    def test_size_of_a_directory_sums_its_files(self, tmp_path):
        (tmp_path / "a.txt").write_bytes(b"x" * 1024)
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.txt").write_bytes(b"y" * 1024)
        assert opl._size_of(tmp_path) == "2.0KB"

    def test_magnitude_is_a_coarse_bucket_not_a_count(self):
        """量级词是给人读的粗档——精确条数在别处，此处只求「量级别读错」。"""
        assert opl._magnitude(0) != opl._magnitude(10_000_000)
        assert opl._magnitude(5) == "几十条或更少"


if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-v"]))
