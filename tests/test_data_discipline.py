"""Data-discipline semantic tests (test-hardening recommendation #4).

CLAUDE.md §4 mandates that the project keep TWO data layers strictly separate
and never interchangeable:

    FULL ARCHIVE layer   projects/news/data/     真实完整数据
    OUTPUT/DISPLAY layer  projects/news/output/  过滤选样（抽样）

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
  C. split_output's output is a strict SAMPLE/SUBSET of its input: the output
     layer never claims a count larger than the archive it came from, and every
     id/url emitted into output exists in the input (lesson-#30 guard).

All tests are deterministic and do zero network I/O; every file write is routed
into ``tmp_path`` via monkeypatch, never into real ``projects/news`` data.
"""
from __future__ import annotations

import importlib
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
NEWS_SCRIPTS = REPO / "projects" / "news" / "scripts"

for _p in (str(SCRIPTS), str(NEWS_SCRIPTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import build_okf_bundle  # noqa: E402
import build_community_index  # noqa: E402
import split_output  # noqa: E402


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
        health = fake_repo / "projects/news/output/source-health.json"
        health.parent.mkdir(parents=True, exist_ok=True)
        health.write_text(
            json.dumps({"updated_at": "2026-06-21T00:00:00+00:00",
                        "platforms": platforms}),
            encoding="utf-8",
        )
        # Lay down the full-archive bodies the existence-gate checks for.
        for name in platforms:
            if name == "discord":
                (fake_repo / "projects/news/data/discord").mkdir(parents=True, exist_ok=True)
            else:
                (fake_repo / f"projects/news/data/platforms/{name}").mkdir(
                    parents=True, exist_ok=True)

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
        # resource is the layer the consumer is steered to for analysis: archive.
        assert "/projects/news/data/" in resource, (
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
        monkeypatch.setattr(build_community_index, "DATA", data_root)
        # iter_records also scans DATA/"discord"; the redirect above covers it
        # (no discord dir present -> simply yields nothing).
        return build_community_index.build()

    def test_meta_stamps_full_archive(self, tmp_path, monkeypatch):
        index = self._drive_build(tmp_path, monkeypatch)
        # The constant under test: the analysis index brands itself full_archive.
        assert index["_meta"]["data_layer"] == "full_archive"
        # And explicitly never the output/display layer.
        assert index["_meta"]["data_layer"] != "output"

    def test_meta_source_root_is_archive_layer(self, tmp_path, monkeypatch):
        index = self._drive_build(tmp_path, monkeypatch)
        # Provenance points at the archive layer dir, not output/.
        assert index["_meta"]["source_root"] == "projects/news/data/"
        assert "output" not in index["_meta"]["source_root"]

    def test_records_actually_aggregated_from_full_archive(self, tmp_path, monkeypatch):
        """Guard the claim isn't vacuous: the index really counted the archive."""
        index = self._drive_build(tmp_path, monkeypatch)
        assert index["_meta"]["total_records"] == 2
        assert "reddit" in index["platforms"]
        assert index["platforms"]["reddit"]["total"] == 2


# ---------------------------------------------------------------------------
# C. split_output — output layer is a strict SAMPLE/SUBSET of the input archive.
#    This is the direct lesson-#30 guard: output is a sample, never a superset
#    or substitute for the archive it derives from.
# ---------------------------------------------------------------------------

class TestOutputIsSubsetOfArchive:

    def _run_split(self, tmp_path, monkeypatch, news_items, max_age_hours=24):
        """Run split_output.main() over a synthetic news.json archive input.

        Returns (input_items, {source: payload}) where payloads are the written
        output-layer files. All IO routed into tmp_path.
        """
        out_dir = tmp_path / "output"
        out_dir.mkdir()
        input_path = out_dir / "news.json"
        input_path.write_text(
            json.dumps({"updated_at": "2026-06-21T00:00:00+00:00",
                        "news": news_items}),
            encoding="utf-8",
        )
        monkeypatch.setattr(split_output, "OUTPUT_DIR", out_dir)
        monkeypatch.setattr(split_output, "INPUT_PATH", input_path)
        monkeypatch.setattr(split_output, "MAX_AGE_HOURS", max_age_hours)
        # widen sparse-source window so the subset relation is exercised on
        # content, not on time-window edge effects.
        monkeypatch.setattr(split_output, "OFFICIAL_MAX_AGE_HOURS", max_age_hours)

        # silence the script's prints
        monkeypatch.setattr("builtins.print", lambda *a, **k: None)
        split_output.main()

        payloads = {}
        for f in out_dir.glob("*-latest.json"):
            payloads[f.stem.replace("-latest", "")] = json.loads(
                f.read_text(encoding="utf-8"))
        return news_items, payloads

    @staticmethod
    def _recent(hours_ago=1):
        from datetime import datetime, timedelta, timezone
        return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()

    def test_output_count_never_exceeds_archive(self, tmp_path, monkeypatch):
        """Every output-layer file's item_count <= the archive item count.

        Encodes: the output (sample) can never claim MORE items than the full
        archive it was sampled from. (lesson #30: don't let 16 masquerade as N.)
        """
        items = [
            {"source": "reddit", "time": self._recent(1), "title": "a", "url": "u-a"},
            {"source": "reddit", "time": self._recent(2), "title": "b", "url": "u-b"},
            {"source": "bilibili_articles", "time": self._recent(1), "title": "c",
             "url": "u-c"},
        ]
        archive, payloads = self._run_split(tmp_path, monkeypatch, items)
        n_archive = len(archive)
        for source, payload in payloads.items():
            assert payload["item_count"] <= n_archive, (
                f"{source} output count {payload['item_count']} exceeds "
                f"archive size {n_archive} — output claims to be larger than its "
                f"own source (lesson #30 violation)")
            # item_count is honest about the file it lives in.
            assert payload["item_count"] == len(payload["items"]), (
                f"{source} item_count disagrees with len(items)")

    def test_all_latest_count_equals_sum_and_bounded_by_archive(self, tmp_path, monkeypatch):
        items = [
            {"source": "reddit", "time": self._recent(1), "title": "a", "url": "u-a"},
            {"source": "reddit", "time": self._recent(2), "title": "b", "url": "u-b"},
            {"source": "mystery", "time": self._recent(1), "title": "c", "url": "u-c"},
        ]
        archive, payloads = self._run_split(tmp_path, monkeypatch, items)
        all_latest = payloads["all"]
        # the merged sample is bounded by the archive...
        assert all_latest["item_count"] <= len(archive)
        # ...and equals the sum of the per-source samples (no phantom inflation).
        per_source = sum(p["item_count"] for k, p in payloads.items() if k != "all")
        assert all_latest["item_count"] == per_source

    def test_every_output_url_exists_in_archive(self, tmp_path, monkeypatch):
        """Subset relation on identity: no output item is fabricated — every
        emitted url traces back to an item present in the archive input."""
        items = [
            {"source": "reddit", "time": self._recent(1), "title": "a", "url": "u-a"},
            {"source": "reddit", "time": self._recent(2), "title": "b", "url": "u-b"},
            {"source": "youtube", "time": self._recent(3), "title": "c", "url": "u-c"},
        ]
        archive, payloads = self._run_split(tmp_path, monkeypatch, items)
        archive_urls = {it["url"] for it in archive}
        for source, payload in payloads.items():
            for out_item in payload["items"]:
                assert out_item["url"] in archive_urls, (
                    f"{source} emitted url {out_item['url']!r} not present in the "
                    f"archive — output is not a subset of its source")

    def test_stale_items_dropped_so_output_is_proper_sample(self, tmp_path, monkeypatch):
        """Output is a FILTERED sample: stale archive items are excluded, so the
        output is a strict subset (<= archive), never the whole archive verbatim.
        """
        items = [
            {"source": "reddit", "time": self._recent(1), "title": "fresh", "url": "u-fresh"},
            {"source": "reddit", "time": self._recent(100), "title": "stale", "url": "u-stale"},
        ]
        archive, payloads = self._run_split(tmp_path, monkeypatch, items, max_age_hours=24)
        reddit = payloads["reddit"]
        # the stale item is filtered: output is a proper subset, count < archive.
        assert reddit["item_count"] == 1
        assert reddit["item_count"] < len(archive)
        emitted_urls = {it["url"] for it in reddit["items"]}
        assert emitted_urls == {"u-fresh"}
        assert "u-stale" not in emitted_urls

    def test_every_output_file_stamps_data_layer_output(self, tmp_path, monkeypatch):
        """Every split_output product must self-declare data_layer == "output".

        Closes the gap surfaced by the prior data-discipline pass: the output
        layer's "I am a sample" identity used to be convention-only, with NO
        machine-readable marker in the payload. Now each per-source file AND the
        merged all-latest.json carries a data_layer stamp, so a consumer can
        programmatically refuse to treat a sample as the full archive (lesson
        #30). Discipline moves from "humans must remember" to "code enforces".
        """
        items = [
            {"source": "reddit", "time": self._recent(1), "title": "a", "url": "u-a"},
            {"source": "youtube", "time": self._recent(2), "title": "b", "url": "u-b"},
        ]
        _, payloads = self._run_split(tmp_path, monkeypatch, items)
        assert payloads, "split produced no output files"
        for source, payload in payloads.items():
            assert payload.get("data_layer") == "output", (
                f"{source}-latest.json is missing the data_layer:output stamp "
                f"(got {payload.get('data_layer')!r}) — output identity unguarded")
            # An output-layer file must NEVER claim to be the full archive.
            assert payload["data_layer"] != "full_archive", (
                f"{source} output file masquerades as full_archive")
        # the merged file is covered too (it is the most tempting to mis-read).
        assert payloads["all"]["data_layer"] == "output"
