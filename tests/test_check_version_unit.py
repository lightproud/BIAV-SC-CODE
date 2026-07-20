"""Unit tests for check_version.py (Morimens version update tracker).

All network calls go through fetch_json, which we monkeypatch; no real HTTP.
"""

import json
import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects/wiki/scripts"))

import check_version as cv  # noqa: E402


class TestFetchJson:
    def test_success(self, monkeypatch):
        class _Resp:
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return b'{"ok": 1}'
        monkeypatch.setattr(cv.urllib.request, "urlopen", lambda *a, **k: _Resp())
        assert cv.fetch_json("http://x") == {"ok": 1}

    def test_url_error_returns_none(self, monkeypatch):
        def _boom(*a, **k):
            raise cv.urllib.error.URLError("down")
        monkeypatch.setattr(cv.urllib.request, "urlopen", _boom)
        assert cv.fetch_json("http://x") is None

    def test_bad_json_returns_none(self, monkeypatch):
        class _Resp:
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return b'{bad'
        monkeypatch.setattr(cv.urllib.request, "urlopen", lambda *a, **k: _Resp())
        assert cv.fetch_json("http://x") is None


class TestCheckSteam:
    def test_fetch_failed(self, monkeypatch):
        monkeypatch.setattr(cv, "fetch_json", lambda *a, **k: None)
        r = cv.check_steam_version()
        assert r["status"] == "fetch_failed"

    def test_api_returned_failure(self, monkeypatch):
        monkeypatch.setattr(cv, "fetch_json", lambda *a, **k: {cv.STEAM_APP_ID: {"success": False}})
        r = cv.check_steam_version()
        assert r["status"] == "api_returned_failure"

    def test_ok_with_news(self, monkeypatch):
        def fake(url, *a, **k):
            if "appdetails" in url:
                return {cv.STEAM_APP_ID: {"success": True, "data": {
                    "name": "Morimens", "short_description": "d",
                    "release_date": {"date": "2025", "coming_soon": False}}}}
            return {"appnews": {"newsitems": [{"title": "v1.5 update", "date": 0, "url": "u"}]}}
        monkeypatch.setattr(cv, "fetch_json", fake)
        r = cv.check_steam_version()
        assert r["status"] == "ok"
        assert r["name"] == "Morimens"
        assert r["recent_news"][0]["title"] == "v1.5 update"


class TestCheckFandom:
    def test_fetch_failed(self, monkeypatch):
        monkeypatch.setattr(cv, "fetch_json", lambda *a, **k: None)
        assert cv.check_fandom_changes()["status"] == "fetch_failed"

    def test_ok(self, monkeypatch):
        monkeypatch.setattr(cv, "fetch_json", lambda *a, **k: {"query": {"recentchanges": [
            {"title": "Page", "timestamp": "t", "user": "u", "comment": "c"}]}})
        r = cv.check_fandom_changes()
        assert r["status"] == "ok"
        assert r["change_count"] == 1


class TestDetectVersion:
    def test_finds_version_marker(self):
        steam = {"recent_news": [{"title": "无版本号"}, {"title": "版本 2.3 来了"}]}
        assert cv.detect_version_from_news(steam) == "2.3"

    def test_v_prefix(self):
        assert cv.detect_version_from_news({"recent_news": [{"title": "v1.2.3 patch"}]}) == "1.2.3"

    def test_bare_decimal_ignored(self):
        assert cv.detect_version_from_news({"recent_news": [{"title": "5.5 星好评"}]}) is None

    def test_no_news(self):
        assert cv.detect_version_from_news({}) is None


class TestLoaders:
    def test_load_versions_missing(self, monkeypatch, tmp_path):
        monkeypatch.setattr(cv, "VERSIONS_PATH", tmp_path / "nope.json")
        assert cv.load_versions() == {"versions": []}

    def test_load_versions_present(self, monkeypatch, tmp_path):
        p = tmp_path / "versions.json"
        p.write_text('{"versions": [{"version": "1.0"}]}', encoding="utf-8")
        monkeypatch.setattr(cv, "VERSIONS_PATH", p)
        assert cv.load_versions()["versions"][0]["version"] == "1.0"

    def test_load_meta_missing(self, monkeypatch, tmp_path):
        monkeypatch.setattr(cv, "META_PATH", tmp_path / "nope.json")
        assert cv.load_meta() == {}

    def test_load_meta_present(self, monkeypatch, tmp_path):
        p = tmp_path / "meta.json"
        p.write_text('{"current_version": "2.0"}', encoding="utf-8")
        monkeypatch.setattr(cv, "META_PATH", p)
        assert cv.load_meta()["current_version"] == "2.0"

    def test_get_known_versions(self):
        assert cv.get_known_versions({"versions": [{"version": "1.0"}, {"version": "2.0"}]}) == {"1.0", "2.0"}


class TestStubAndSave:
    def test_create_stub(self):
        stub = cv.create_stub_version("3.0", "steam_news")
        assert stub["version"] == "3.0"
        assert stub["_auto_detected"] is True
        assert stub["_source"] == "steam_news"

    def test_save_versions(self, tmp_path, monkeypatch):
        p = tmp_path / "versions.json"
        monkeypatch.setattr(cv, "VERSIONS_PATH", p)
        cv.save_versions({"versions": [{"version": "1.0"}]})
        assert json.loads(p.read_text())["versions"][0]["version"] == "1.0"

    def test_save_result(self, tmp_path, monkeypatch):
        out = tmp_path / "sub" / "result.json"
        monkeypatch.setattr(cv, "OUTPUT_PATH", out)
        cv.save_result({"a": 1})
        assert json.loads(out.read_text())["a"] == 1


class TestMain:
    def _patch_common(self, monkeypatch, tmp_path, version_in_news=None):
        monkeypatch.setattr(cv, "VERSIONS_PATH", tmp_path / "versions.json")
        monkeypatch.setattr(cv, "META_PATH", tmp_path / "meta.json")
        monkeypatch.setattr(cv, "OUTPUT_PATH", tmp_path / "out" / "result.json")
        news = [{"title": f"版本 {version_in_news}"}] if version_in_news else []
        monkeypatch.setattr(cv, "check_steam_version", lambda: {"status": "ok", "recent_news": news})
        monkeypatch.setattr(cv, "check_fandom_changes", lambda: {"status": "ok"})

    def test_main_no_new_version(self, monkeypatch, tmp_path):
        self._patch_common(monkeypatch, tmp_path)
        monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
        rc = cv.main()
        assert rc == 0
        result = json.loads((tmp_path / "out" / "result.json").read_text())
        assert result["new_version_found"] is False

    def test_main_new_version_writes_stub_and_github_output(self, monkeypatch, tmp_path):
        self._patch_common(monkeypatch, tmp_path, version_in_news="9.9")
        gh_out = tmp_path / "gh_out"
        monkeypatch.setenv("GITHUB_OUTPUT", str(gh_out))
        rc = cv.main()
        assert rc == 0
        versions = json.loads((tmp_path / "versions.json").read_text())
        assert any(v["version"] == "9.9" for v in versions["versions"])
        assert "new_version=true" in gh_out.read_text()

    def test_main_no_new_version_github_output(self, monkeypatch, tmp_path):
        self._patch_common(monkeypatch, tmp_path)
        gh_out = tmp_path / "gh_out"
        monkeypatch.setenv("GITHUB_OUTPUT", str(gh_out))
        rc = cv.main()
        assert rc == 0
        assert "new_version=false" in gh_out.read_text()
