"""test_restore_release_data_unit.py —— restore_release_data 纯函数 / 回退逻辑单测。

只测确定性逻辑：_month_range / _req / assets_from_months / restore（monkeypatch 网络层）。
"""

import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

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


# ── tar 解压加固（扫描修复 2026-07-28）────────────────────────────────────────
# 缺陷：原先直接 `tar.extractall(dest)`。extractall 默认完全信任归档内的成员名——
# `../x` 或 `/etc/x` 会照写不误（Zip Slip），链接成员还能把后续写入重定向到任意路径。
# 这条路径吃的是**从网络下载的 Release 资产**，且脚本常以仓库写权限运行：
# 「资产是我们自己传的」不构成安全边界（资产可被替换、传输可被劫持）。


def _make_tar(members, path):
    with tarfile.open(path, "w:gz") as t:
        for name, data in members:
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            t.addfile(ti, io.BytesIO(data))


def _extract(tmp_path, members, *, force_fallback=False):
    """解压一份自造 tar。返回 (dest 内文件名, dest 之外新增文件名, 是否被拒绝)。"""
    tgz = tmp_path / "a.tar.gz"
    _make_tar(members, tgz)
    dest = tmp_path / "dest"
    dest.mkdir()

    real_extractall = tarfile.TarFile.extractall

    def no_filter(self, *args, **kwargs):
        # 模拟 Python 3.11.3 及更早：extractall 不认识 filter= 参数
        if "filter" in kwargs:
            raise TypeError("extractall() got an unexpected keyword argument 'filter'")
        return real_extractall(self, *args, **kwargs)

    rejected = False
    try:
        if force_fallback:
            tarfile.TarFile.extractall = no_filter
        with tarfile.open(tgz, "r:gz") as t:
            rrd._safe_extractall(t, dest)
    except SystemExit:
        rejected = True
    finally:
        if force_fallback:
            tarfile.TarFile.extractall = real_extractall

    inside = {p.name for p in dest.rglob("*") if p.is_file()}
    escaped = {p.name for p in tmp_path.glob("*") if p.is_file() and p.name != "a.tar.gz"}
    return inside, escaped, rejected


def test_safe_extract_normal_member(tmp_path):
    inside, escaped, rejected = _extract(tmp_path, [("channels/1/a.jsonl", b"ok")])
    assert not rejected
    assert "a.jsonl" in inside
    assert escaped == set()


def test_safe_extract_path_traversal_writes_nothing_outside(tmp_path):
    """核心不变量：无论走哪条分支，dest 之外一个字节都不许落地，且以同一形态报错。"""
    inside, escaped, rejected = _extract(tmp_path, [("../escaped.txt", b"pwn")])
    assert rejected, "filter='data' 分支须与回退分支一样以 SystemExit 收场"
    assert escaped == set()
    assert "escaped.txt" not in inside


def test_safe_extract_absolute_member_stays_inside(tmp_path):
    _, escaped, _ = _extract(tmp_path, [("/tmp/pwned.txt", b"pwn")])
    assert escaped == set()


def test_safe_extract_fallback_rejects_traversal(tmp_path):
    """3.11.3 及更早无 filter= 参数时走自实现校验，行为须与 filter='data' 一致。"""
    _, escaped, rejected = _extract(tmp_path, [("../escaped.txt", b"pwn")], force_fallback=True)
    assert rejected, "回退分支必须拒绝路径穿越成员"
    assert escaped == set()


def test_safe_extract_fallback_allows_normal_member(tmp_path):
    inside, escaped, rejected = _extract(tmp_path, [("channels/1/a.jsonl", b"ok")],
                                         force_fallback=True)
    assert not rejected
    assert "a.jsonl" in inside
    assert escaped == set()
