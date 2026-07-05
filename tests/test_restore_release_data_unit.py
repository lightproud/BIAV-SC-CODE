"""test_restore_release_data_unit.py —— restore_release_data 纯函数 / 回退逻辑单测。

只测确定性逻辑：_month_range / _req / assets_from_months / restore（monkeypatch 网络层）。
"""

import io
import json
import os
import sys
import tarfile
import urllib.request
from contextlib import contextmanager
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import restore_release_data as rrd  # noqa: E402


# ---------- _month_range ----------

def test_month_range_single_month():
    assert rrd._month_range("2026-03", "2026-03") == ["2026-03"]


def test_month_range_within_year():
    assert rrd._month_range("2026-01", "2026-04") == [
        "2026-01", "2026-02", "2026-03", "2026-04",
    ]


def test_month_range_crosses_year_boundary():
    assert rrd._month_range("2025-11", "2026-02") == [
        "2025-11", "2025-12", "2026-01", "2026-02",
    ]


def test_month_range_empty_when_lo_after_hi():
    assert rrd._month_range("2026-05", "2026-03") == []


def test_month_range_full_year():
    out = rrd._month_range("2026-01", "2026-12")
    assert len(out) == 12
    assert out[0] == "2026-01"
    assert out[-1] == "2026-12"


# ---------- _req ----------

def test_req_sets_accept_header_no_token(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    r = rrd._req("https://example.com/x")
    assert r.get_full_url() == "https://example.com/x"
    # header keys are capitalized by urllib
    assert r.get_header("Accept") == "application/vnd.github+json"
    assert r.get_header("Authorization") is None


def test_req_adds_bearer_from_github_token(monkeypatch):
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.setenv("GITHUB_TOKEN", "tok123")
    r = rrd._req("https://example.com/y")
    assert r.get_header("Authorization") == "Bearer tok123"


def test_req_adds_bearer_from_gh_token_fallback(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("GH_TOKEN", "ghtok")
    r = rrd._req("https://example.com/z")
    assert r.get_header("Authorization") == "Bearer ghtok"


# ---------- assets_from_months ----------

def test_assets_from_months_expands_star():
    months = ["2026-01", "2026-02"]
    out = rrd.assets_from_months("community-data", "discord-archive-*.tar.gz", months)
    assert [a["name"] for a in out] == [
        "discord-archive-2026-01.tar.gz",
        "discord-archive-2026-02.tar.gz",
    ]
    assert out[0]["size"] == 0
    assert out[0]["browser_download_url"] == (
        f"{rrd.DOWNLOAD}/community-data/discord-archive-2026-01.tar.gz"
    )


def test_assets_from_months_empty_months():
    assert rrd.assets_from_months("t", "x-*.tar.gz", []) == []


# ---------- restore (network layer monkeypatched) ----------

def _make_tgz(path: Path, inner_rel: str, content: bytes = b"hi"):
    """Create a .tar.gz at `path` containing one file at inner_rel."""
    src_dir = path.parent / "_src"
    src_dir.mkdir(parents=True, exist_ok=True)
    inner = src_dir / inner_rel
    inner.parent.mkdir(parents=True, exist_ok=True)
    inner.write_bytes(content)
    with tarfile.open(path, "w:gz") as tar:
        tar.add(inner, arcname=inner_rel)


def test_restore_no_matching_asset_returns_zero(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rrd, "list_assets", lambda tag: [{"name": "other.tar.gz"}])
    dest = tmp_path / "dest"
    n = rrd.restore("tag", "discord-*.tar.gz", dest, force=False)
    assert n == 0
    assert "no asset matches" in capsys.readouterr().out


def test_restore_downloads_and_extracts(tmp_path, monkeypatch):
    # build a real archive that "download" copies into place
    archive = tmp_path / "src-discord-2026-01.tar.gz"
    _make_tgz(archive, "channels/abc/2026-01.jsonl", b'{"x":1}\n')

    assets = [{
        "name": "discord-2026-01.tar.gz",
        "size": 1234.0,
        "browser_download_url": "https://example/dl",
    }]
    monkeypatch.setattr(rrd, "list_assets", lambda tag: assets)

    def fake_download(url, dest_path):
        dest_path.write_bytes(archive.read_bytes())

    monkeypatch.setattr(rrd, "download", fake_download)
    # point REPO at tmp so restore()'s final relative_to(REPO) print succeeds
    monkeypatch.setattr(rrd, "REPO", tmp_path)

    n = rrd.restore("community-data", "discord-*.tar.gz", Path("out"), force=False)
    assert n == 1
    extracted = tmp_path / "out" / "channels" / "abc" / "2026-01.jsonl"
    assert extracted.exists()
    assert extracted.read_bytes() == b'{"x":1}\n'


def test_restore_non_tar_asset_copied_verbatim(tmp_path, monkeypatch):
    """非 tarball 资产（如 kb_vectors.json.gz 纯 gzip JSON）须按原名平拷贝、不走 tarfile。"""
    import gzip

    blob = gzip.compress(b'{"_meta":{"backend":"voyage"},"items":[]}')
    assets = [{
        "name": "kb_vectors.json.gz",
        "size": float(len(blob)),
        "browser_download_url": "https://example/dl",
    }]
    monkeypatch.setattr(rrd, "list_assets", lambda tag: assets)

    def fake_download(url, dest_path):
        dest_path.write_bytes(blob)

    monkeypatch.setattr(rrd, "download", fake_download)
    monkeypatch.setattr(rrd, "REPO", tmp_path)

    n = rrd.restore("community-assets", "kb_vectors.json.gz", Path("okf"), force=False)
    assert n == 1
    restored = tmp_path / "okf" / "kb_vectors.json.gz"
    assert restored.exists()
    assert restored.read_bytes() == blob  # 逐字节原样落位（tarfile 解包会直接炸 ReadError）


def test_restore_api_unreachable_without_months_raises(tmp_path, monkeypatch):
    def boom(tag):
        raise OSError("api blocked")

    monkeypatch.setattr(rrd, "list_assets", boom)
    dest = tmp_path / "d"
    with pytest.raises(SystemExit):
        rrd.restore("tag", "p-*.tar.gz", dest, force=False, months=None)


def test_restore_api_unreachable_falls_back_to_months(tmp_path, monkeypatch):
    archive = tmp_path / "fallback.tar.gz"
    _make_tgz(archive, "channels/zz/2026-02.jsonl", b"data")

    def boom(tag):
        raise OSError("api blocked")

    monkeypatch.setattr(rrd, "list_assets", boom)

    def fake_download(url, dest_path):
        dest_path.write_bytes(archive.read_bytes())

    monkeypatch.setattr(rrd, "download", fake_download)
    monkeypatch.setattr(rrd, "REPO", tmp_path)

    n = rrd.restore("community-data", "discord-*.tar.gz", Path("out2"),
                    force=False, months=["2026-02"])
    assert n == 1
    assert (tmp_path / "out2" / "channels" / "zz" / "2026-02.jsonl").exists()


# ---------- list_assets / download (urlopen monkeypatched, zero network) ----------

class _FakeResp:
    def __init__(self, payload: bytes):
        self._buf = io.BytesIO(payload)

    def read(self, n=-1):
        return self._buf.read() if n == -1 else self._buf.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_list_assets_parses_json(monkeypatch):
    payload = json.dumps({"assets": [{"name": "a.tar.gz"}]}).encode()

    def fake_urlopen(req, timeout=None):
        return _FakeResp(payload)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assets = rrd.list_assets("community-data")
    assert assets == [{"name": "a.tar.gz"}]


def test_download_writes_chunks(tmp_path, monkeypatch):
    body = b"X" * (3 << 20)  # >2 MB to exercise the chunk loop

    def fake_urlopen(req, timeout=None):
        return _FakeResp(body)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = tmp_path / "blob.bin"
    rrd.download("https://example/dl", out)
    assert out.read_bytes() == body


def test_main_skip_if_exists_message(tmp_path, monkeypatch, capsys):
    """main(): existing non-empty dest (no --force) prints the idempotent notice."""
    dest = tmp_path / "existing"
    dest.mkdir()
    (dest / "already.txt").write_text("x")

    monkeypatch.setattr(sys, "argv", [
        "restore_release_data.py",
        "--tag", "community-data",
        "--pattern", "discord-*.tar.gz",
        "--dest", str(dest),
    ])
    # neutralize the real restore work
    monkeypatch.setattr(rrd, "restore", lambda *a, **k: 0)
    rrd.main()
    out = capsys.readouterr().out
    assert "non-empty" in out


def test_main_parses_months(tmp_path, monkeypatch):
    captured = {}

    def fake_restore(tag, pattern, dest, force, months):
        captured["months"] = months
        return 0

    monkeypatch.setattr(rrd, "restore", fake_restore)
    dest = tmp_path / "newdest"
    monkeypatch.setattr(sys, "argv", [
        "restore_release_data.py",
        "--tag", "community-data",
        "--pattern", "discord-*.tar.gz",
        "--dest", str(dest),
        "--months", "2026-01..2026-03",
    ])
    rrd.main()
    assert captured["months"] == ["2026-01", "2026-02", "2026-03"]
