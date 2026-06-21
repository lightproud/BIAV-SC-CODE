"""Unit tests for generate_rss.py (wiki RSS/Atom feed generator)."""

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects/wiki/scripts"))

import generate_rss as gr  # noqa: E402


class TestLoadJson:
    def test_missing_returns_empty(self, tmp_path):
        assert gr.load_json(tmp_path / "nope.json") == {}

    def test_loads_existing(self, tmp_path):
        p = tmp_path / "v.json"
        p.write_text('{"versions": []}', encoding="utf-8")
        assert gr.load_json(p) == {"versions": []}


class TestGitLogEntries:
    def test_parses_pipe_format(self, monkeypatch):
        out = "HASH1|2026-01-01T00:00:00+00:00|Alice|fix data\nbadline\nH2|2026-02-02T00:00:00+00:00|Bob|more"
        fake = mock.MagicMock(returncode=0, stdout=out)
        monkeypatch.setattr(gr.subprocess, "run", lambda *a, **k: fake)
        entries = gr.get_git_log_entries(Path("/x"))
        assert len(entries) == 2
        assert entries[0]["hash"] == "HASH1"
        assert entries[0]["author"] == "Alice"

    def test_nonzero_returncode(self, monkeypatch):
        fake = mock.MagicMock(returncode=1, stdout="")
        monkeypatch.setattr(gr.subprocess, "run", lambda *a, **k: fake)
        assert gr.get_git_log_entries(Path("/x")) == []

    def test_git_missing(self, monkeypatch):
        def _boom(*a, **k):
            raise FileNotFoundError()
        monkeypatch.setattr(gr.subprocess, "run", _boom)
        assert gr.get_git_log_entries(Path("/x")) == []

    def test_timeout(self, monkeypatch):
        import subprocess
        def _boom(*a, **k):
            raise subprocess.TimeoutExpired("git", 30)
        monkeypatch.setattr(gr.subprocess, "run", _boom)
        assert gr.get_git_log_entries(Path("/x")) == []


class TestBuildItems:
    def test_version_items_reversed(self):
        data = {"versions": [
            {"version": "1.0", "title": "First", "period": "2025", "highlights": ["a"]},
            {"version": "2.0"},
        ]}
        items = gr.build_version_items(data)
        assert items[0]["guid"] == "morimens-version-2.0"
        assert items[1]["guid"] == "morimens-version-1.0"
        assert "<li>a</li>" in items[1]["description"]

    def test_wiki_items(self):
        entries = [{"hash": "abc123def456gh", "date": "2026-01-01T00:00:00+00:00",
                    "author": "Alice", "subject": "update"}]
        items = gr.build_wiki_items(entries)
        assert items[0]["guid"] == "morimens-wiki-commit-abc123def456"
        assert "[Wiki]" in items[0]["title"]


class TestDateHelpers:
    def test_parse_iso(self):
        dt = gr.parse_fuzzy_date("2026-01-02T03:04:05+00:00")
        assert dt.year == 2026 and dt.month == 1

    def test_parse_year_only(self):
        dt = gr.parse_fuzzy_date("2025")
        assert dt.year == 2025 and dt.tzinfo == timezone.utc

    def test_parse_garbage_returns_now(self):
        dt = gr.parse_fuzzy_date("not a date at all")
        assert dt.tzinfo == timezone.utc

    def test_parse_none(self):
        dt = gr.parse_fuzzy_date(None)
        assert isinstance(dt, datetime)

    def test_rfc822_naive_gets_utc(self):
        s = gr.format_rfc822(datetime(2026, 1, 1, 12, 0, 0))
        assert "2026" in s

    def test_rfc3339_naive_gets_utc(self):
        s = gr.format_rfc3339(datetime(2026, 1, 1, 12, 0, 0))
        assert s.endswith("+00:00")


class TestGenerateFeeds:
    def _items(self):
        return [{
            "title": "[Game] v1.0", "link": "http://x", "guid": "g1",
            "description": "<p>hi</p>", "category": "game-version", "pub_date": "2025",
        }]

    def test_generate_rss(self, tmp_path):
        out = tmp_path / "feed.xml"
        gr.generate_rss(self._items(), out)
        text = out.read_text(encoding="utf-8")
        assert "<rss" in text
        assert "<item>" in text
        assert text.startswith("<?xml")

    def test_generate_atom(self, tmp_path):
        out = tmp_path / "atom.xml"
        gr.generate_atom(self._items(), out)
        text = out.read_text(encoding="utf-8")
        assert "<feed" in text
        assert "<entry>" in text


class TestMain:
    def test_main_end_to_end(self, tmp_path, monkeypatch):
        versions = tmp_path / "versions.json"
        versions.write_text(
            '{"versions": [{"version": "1.0", "title": "T", "period": "2025", "highlights": []}]}',
            encoding="utf-8")
        feed_dir = tmp_path / "feeds"
        monkeypatch.setattr(gr, "VERSIONS_PATH", versions)
        monkeypatch.setattr(gr, "FEED_DIR", feed_dir)
        monkeypatch.setattr(gr, "get_git_log_entries", lambda *a, **k: [
            {"hash": "a" * 14, "date": "2026-01-01T00:00:00+00:00", "author": "A", "subject": "s"}])
        rc = gr.main()
        assert rc == 0
        assert (feed_dir / "feed.xml").exists()
        assert (feed_dir / "atom.xml").exists()
