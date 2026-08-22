"""Data-discipline semantic tests (test-hardening recommendation #4).

CLAUDE.md §4 mandates that sampled data never be passed off as the full archive:

    FULL ARCHIVE layer   Record/Community/ (BIAV-SC-DATA)  真实完整数据 —— 唯一取数面
    RUN-TIME intermediate  archive_layout.news_run_root()  过滤选样（抽样），不进 git

The second row used to be the committed 输出展示层 `projects/news/output/`; 守密人
2026-08-21 裁定整层删除，中间产物退回运行期工作根、单轮内被归档步吃掉。The ``data_layer``
stamp still rides on those run-time payloads, so the invariants below are unchanged.

Lesson #30: 16 sampled Discord messages were once treated as if they were the
full 5,455 — a SEMANTIC error that high line-coverage does NOT catch. The tests
below assert the *semantics* of layer separation and the ``data_layer`` tagging
that guards it, by DRIVING the real builder functions with synthetic inputs (not
by inspecting pre-built artifacts, which may be absent in a light checkout).

Three invariants are exercised against real code:

  A. build_okf_bundle tags news-source pointers ``data_layer:full_archive`` and
     points ``resource`` at the archive layer — never the output layer.
  B. build_community_index stamps ``_meta.data_layer == "full_archive"`` on the
     full-analysis index it produces from full-archive inputs.
  (C. split_output 的抽样子集不变量已随该模块 2026-08-22 退役，见文件末尾说明。原文：output
     layer never claims a count larger than the archive it came from, and every
     id/url emitted into output exists in the input (lesson-#30 guard).

All tests are deterministic and do zero network I/O; every file write is routed
into ``tmp_path`` via monkeypatch, never into real ``projects/news`` data.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
NEWS_SCRIPTS = REPO / "projects" / "news" / "scripts"

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import build_okf_bundle  # noqa: E402
import build_community_index  # noqa: E402
from datetime import UTC


# Minimal frontmatter parser mirroring the bundle's own (top-level keys only).
_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _parse_frontmatter(text: str) -> dict:
    m = _FM_RE.match(text)
    fields: dict = {}
    if not m:
        return fields
    for line in m.group(1).splitlines():
        if not line.strip() or line.startswith(" ") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            fields[key] = [v.strip().strip('"') for v in val[1:-1].split(",") if v.strip()]
        else:
            fields[key] = val.strip('"')
    return fields


# ---------------------------------------------------------------------------
# A. build_okf_bundle.build_sources — source pointers tag the FULL ARCHIVE layer
# ---------------------------------------------------------------------------

class TestOkfSourceLayerTagging:
    """A full-archive source pointer must be tagged data_layer:full_archive and
    point its `resource` at the archive layer — never the output/display layer.
    """

    def _drive_build_sources(self, tmp_path, monkeypatch, platforms):
        """Run build_okf_bundle.build_sources against synthetic inputs.

        - source-health.json is synthesized in tmp_path (drives platform list).
        - REPO is redirected so the archive-existence gate resolves against a
          synthetic full-archive tree we lay down in tmp_path.
        - BUNDLE is redirected so concept files are written into tmp_path.
        Returns {platform_name: frontmatter_fields}.
        """
        fake_repo = tmp_path / "repo"
        bundle = tmp_path / "okf"
        # source-health.json must live under REPO: build_sources() emits an
        # index that calls SOURCE_HEALTH.relative_to(REPO).
        health = fake_repo / "projects/news/data/source-health.json"
        health.parent.mkdir(parents=True, exist_ok=True)
        health.write_text(
            json.dumps({"updated_at": "2026-06-21T00:00:00+00:00",
                        "platforms": platforms}),
            encoding="utf-8",
        )
        # Lay down the full-archive bodies the existence-gate checks for. Post
        # T62 split the archive lives under the Record/Community data lake, which
        # build_sources resolves via archive_layout.community_root() — driven here
        # to the fixture through BIAV_SC_DATA_ROOT (env root), NOT the REPO monkeypatch.
        community = fake_repo / "Public-Info-Pool" / "Record" / "Community"
        for name in platforms:
            (community / name).mkdir(parents=True, exist_ok=True)

        monkeypatch.setenv("BIAV_SC_DATA_ROOT", str(fake_repo / "Public-Info-Pool"))
        monkeypatch.setattr(build_okf_bundle, "REPO", fake_repo)
        monkeypatch.setattr(build_okf_bundle, "BUNDLE", bundle)
        monkeypatch.setattr(build_okf_bundle, "SOURCE_HEALTH", health)

        count = build_okf_bundle.build_sources()
        assert count == len(platforms)

        out = {}
        for name in platforms:
            concept = bundle / "sources" / f"{name}.md"
            assert concept.exists(), f"no concept emitted for {name}"
            out[name] = _parse_frontmatter(concept.read_text(encoding="utf-8"))
        return out

    def test_archive_source_tagged_full_archive_not_output(self, tmp_path, monkeypatch):
        fm = self._drive_build_sources(
            tmp_path, monkeypatch,
            {"reddit": {"total_items": 5455, "level": "active"},
             "discord": {"total_items": 7668192, "level": "active"}},
        )
        for name, fields in fm.items():
            tags = fields.get("tags", [])
            assert isinstance(tags, list), f"{name} tags not a list: {tags!r}"
            # The whole point of lesson #30: pointer declares the FULL ARCHIVE layer...
            assert "data_layer:full_archive" in tags, (
                f"{name} not tagged full_archive: {tags}")
            # ...and is NEVER mislabeled as the output/display (sampled) layer.
            assert "data_layer:output" not in tags, (
                f"{name} wrongly tagged as output layer: {tags}")
            assert not any(t.endswith(":output") and t.startswith("data_layer")
                           for t in tags), f"{name} carries an output data_layer tag: {tags}"

    def test_resource_points_at_archive_layer_not_output(self, tmp_path, monkeypatch):
        fm = self._drive_build_sources(
            tmp_path, monkeypatch,
            {"reddit": {"total_items": 5455, "level": "active"}},
        )
        resource = fm["reddit"].get("resource", "")
        # resource is the layer the consumer is steered to for analysis: the full
        # archive lake (post T62 split = Record/Community, logical pointer path).
        assert "/Record/Community/" in resource, (
            f"reddit pointer does not target the archive layer: {resource!r}")
        assert "/projects/news/output/" not in resource, (
            f"reddit pointer leaks into the output/display layer: {resource!r}")

    def test_every_okf_dataset_pointer_declares_a_data_layer(self, tmp_path, monkeypatch):
        """No `dataset`-typed source pointer may be silent about its layer —
        an untagged dataset is exactly the ambiguity lesson #30 punishes."""
        fm = self._drive_build_sources(
            tmp_path, monkeypatch,
            {"reddit": {"total_items": 5455, "level": "active"},
             "steam": {"total_items": 4966, "level": "degraded"}},
        )
        for name, fields in fm.items():
            if fields.get("type") == "dataset":
                tags = fields.get("tags", [])
                assert any(t.startswith("data_layer:") for t in tags), (
                    f"{name} dataset pointer has no data_layer:* tag: {tags}")


# ---------------------------------------------------------------------------
# B. build_community_index.build — the full-analysis index declares itself
#    full_archive (never output) when built from full-archive inputs.
# ---------------------------------------------------------------------------

class TestCommunityIndexDeclaresFullArchive:

    def _drive_build(self, tmp_path, monkeypatch):
        """Run build_community_index.build() over a synthetic full-archive tree."""
        data_root = tmp_path / "data"
        (data_root / "platforms" / "reddit").mkdir(parents=True)
        (data_root / "platforms" / "reddit" / "2026-05.json").write_text(
            json.dumps({"items": [
                {"time": "2026-05-01T00:00:00Z", "title": "great game",
                 "summary": "love it", "lang": "en", "engagement": 10},
                {"time": "2026-05-02T00:00:00Z", "title": "boring bug",
                 "summary": "hate it", "lang": "en", "engagement": 2},
            ]}),
            encoding="utf-8",
        )
        # Post-#333 the data root split into COMMUNITY_NEW (Public-Info-Pool) +
        # DATA_OLD (legacy projects/news/data). Point COMMUNITY_NEW at a missing
        # path and DATA_OLD at the synthetic archive so build() reads the legacy
        # platforms/ layer we seeded. (DATA_OLD/"discord" absent -> yields nothing.)
        monkeypatch.setattr(build_community_index, "COMMUNITY_NEW",
                            data_root / "__no_such_new__")
        monkeypatch.setattr(build_community_index, "DATA_OLD", data_root)
        return build_community_index.build()

    def test_meta_stamps_full_archive(self, tmp_path, monkeypatch):
        index = self._drive_build(tmp_path, monkeypatch)
        # The constant under test: the analysis index brands itself full_archive.
        assert index["_meta"]["data_layer"] == "full_archive"
        # And explicitly never the output/display layer.
        assert index["_meta"]["data_layer"] != "output"

    def test_meta_source_root_is_archive_layer(self, tmp_path, monkeypatch):
        index = self._drive_build(tmp_path, monkeypatch)
        # Provenance points at the archive layer actually read (2026-07-02:
        # source_root is computed from the live root, no longer hardcoded).
        # In this synthetic setup that is the DATA_OLD legacy tree; in prod
        # it is Public-Info-Pool/Record/Community/. Never output/.
        assert index["_meta"]["source_root"].rstrip("/").endswith("data")
        assert "output" not in index["_meta"]["source_root"]

    def test_meta_source_root_prefers_new_layout(self, tmp_path, monkeypatch):
        """When the Public-Info-Pool root exists, provenance must name it."""
        community = tmp_path / "Public-Info-Pool" / "Record" / "Community"
        (community / "reddit").mkdir(parents=True)
        (community / "reddit" / "2026-05.json").write_text(
            json.dumps({"items": [
                {"time": "2026-05-01T00:00:00Z", "title": "great game",
                 "summary": "love it", "lang": "en", "engagement": 10},
            ]}),
            encoding="utf-8",
        )
        monkeypatch.setattr(build_community_index, "COMMUNITY_NEW", community)
        monkeypatch.setattr(build_community_index, "DATA_OLD",
                            tmp_path / "__no_such_old__")
        index = build_community_index.build()
        assert index["_meta"]["source_root"].rstrip("/").endswith(
            "Public-Info-Pool/Record/Community")
        assert "output" not in index["_meta"]["source_root"]

    def test_records_actually_aggregated_from_full_archive(self, tmp_path, monkeypatch):
        """Guard the claim isn't vacuous: the index really counted the archive."""
        index = self._drive_build(tmp_path, monkeypatch)
        assert index["_meta"]["total_records"] == 2
        assert "reddit" in index["platforms"]
        assert index["platforms"]["reddit"]["total"] == 2


# ---------------------------------------------------------------------------
# C. 输出层子集不变量 —— 2026-08-22 随 split_output 一并退役
# ---------------------------------------------------------------------------
# 原 C 段驱动 split_output.main()，断言输出层是输入档案的严格抽样子集、且每份产物
# 自带 data_layer:"output" 戳记。守密人 2026-08-21 删除输出展示层、2026-08-22 裁定
# 「采集 → 直接入湖」删除 split_output 本身之后，这条不变量已无对象可测：管线不再
# 产出任何抽样层，采集条目由 collect_global 校验后直接交 archive_platforms 落全量
# 档案层。lesson #30 的防线因此从「戳记 + 测试」前移为「结构上不存在第二个层」。
# A / B 两段（档案层指针必须标 full_archive、分析索引自报全量）继续在役。
