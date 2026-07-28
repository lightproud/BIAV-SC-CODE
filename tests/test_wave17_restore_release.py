"""审计第十七波 · 抢救网的「绿色只许有一种含义」（`scripts/restore_release_data.py`）。

本档只钉一件事：**§6.3 三张抢救网之一在什么情况下允许退 0**。波次十七给还原器补了三条
恢复路径，三条都是「原先静默成功、实际什么都没救回来」：

1. **零匹配 = 失败**——`restore()` 的返回值原先被丢弃，`main()` 一律退 0。tag 改名 /
   资产改后缀 / pattern 打错三种都让链式调用 `restore && build_index` 照常往下走，
   在一个空目录上建索引。
2. **短读 = 失败且不留半截**——urllib 的 `read()` 在连接被提前关闭时**返回空串而不抛
   异常**，`while chunk :=` 于是正常收尾。非 tarball 资产（`kb_vectors.json.gz`）会被
   逐字拷进 dest 并宣布还原成功。故按 Content-Length 核对，短读即删文件 + 抛错。
3. **一件失败不许拖垮其余**——原先第一件抛出即整轮中止，33 个月的历史缺一个月就再也
   拿不到它后面的 28 个月，现场只留一份 traceback。改为逐件记账、跑完统一判红。

`tests/test_restore_release_data_unit.py` 已覆盖成功路径与 tar 加固主分支，本档**只补
失败面**，不重复既有断言。全程零网络：`urlopen` / `list_assets` / `download` 均打桩。

小学生比喻：救生圈扔下去必须真的捞上来人才算数——捞了个空、捞上来半截、或者第一次
没捞着就收工不干了，这三种都不许报「救援完成」。
"""
from __future__ import annotations

import io
import sys
import tarfile
from pathlib import Path

import pytest

import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）

import restore_release_data as rrd  # noqa: E402


# ── 桩：假响应体（零网络）────────────────────────────────────────────────────

class _Resp:
    """最小假响应：可声明 Content-Length，可在 `deliver` 字节后提前「断连」。

    断连模拟的是 CPython http.client 的真实行为——它在这种情形下返回 b'' 而不是抛
    IncompleteRead（源码里自己注着 "Ideally, we would raise"）。测试若改成抛异常，
    测的就不再是本次修复要挡的那件事。
    """

    def __init__(self, body: bytes, declared: int | None = None, deliver: int | None = None):
        self._buf = io.BytesIO(body if deliver is None else body[:deliver])
        self._declared = declared

    def getheader(self, name: str) -> str | None:
        if name == "Content-Length" and self._declared is not None:
            return str(self._declared)
        return None

    def read(self, n: int = -1) -> bytes:
        return self._buf.read() if n == -1 else self._buf.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class _RespNoHeaders(_Resp):
    """连 getheader 都没有的响应对象（既有单测的假响应就是这形态）。

    契约：拿不到声明长度就跳过核对——加固不许把老桩打死。
    """

    getheader = None  # type: ignore[assignment]

    def __getattribute__(self, name):
        if name == "getheader":
            raise AttributeError(name)
        return object.__getattribute__(self, name)


def _urlopen_returning(resp):
    def fake_urlopen(req, timeout=None):  # noqa: ARG001  与真实签名对齐
        return resp
    return fake_urlopen


# ── 1. 短读检测（Content-Length 核对 + 删半截文件）──────────────────────────

class TestTruncatedDownload:
    def test_short_read_raises_and_deletes_the_partial_file(self, tmp_path, monkeypatch):
        """声明 4096 字节、实收 10 字节：必须抛错，且 dest 上不许留下那 10 字节。"""
        body = b"Z" * 4096
        monkeypatch.setattr(
            rrd.urllib.request, "urlopen", _urlopen_returning(_Resp(body, declared=4096, deliver=10))
        )
        out = tmp_path / "kb_vectors.json.gz"
        with pytest.raises(OSError, match=r"下载不完整.*声明 4096 字节，实收 10 字节"):
            rrd.download("https://example/dl", out)
        assert not out.exists(), "半截文件比没有更坏：它会被下游当成完整档案读"

    def test_complete_download_matching_content_length_is_kept(self, tmp_path, monkeypatch):
        """长度对得上就照常落位——核对不许把正常路径误伤成失败。"""
        body = b"Y" * 2048
        monkeypatch.setattr(
            rrd.urllib.request, "urlopen", _urlopen_returning(_Resp(body, declared=2048))
        )
        out = tmp_path / "ok.bin"
        rrd.download("https://example/dl", out)
        assert out.read_bytes() == body

    def test_response_without_getheader_skips_the_check(self, tmp_path, monkeypatch):
        """无 getheader 的响应对象：跳过核对，不改既有契约（不许因此抛 AttributeError）。"""
        body = b"W" * 32
        monkeypatch.setattr(
            rrd.urllib.request, "urlopen", _urlopen_returning(_RespNoHeaders(body))
        )
        out = tmp_path / "legacy.bin"
        rrd.download("https://example/dl", out)
        assert out.read_bytes() == body


# ── 2. 逐件兜住：一件失败不许吞掉其余 ────────────────────────────────────────

class TestPartialRestore:
    @staticmethod
    def _assets(*names):
        return [
            {"name": n, "size": 1.0, "browser_download_url": f"https://example/{n}"}
            for n in names
        ]

    def test_one_failure_does_not_abort_the_remaining_assets(self, tmp_path, monkeypatch):
        """中间一件失败：前后两件仍须落地，且失败者被逐件点名、整轮判红。"""
        names = ["a-2026-01.json.gz", "b-2026-02.json.gz", "c-2026-03.json.gz"]
        monkeypatch.setattr(rrd, "list_assets", lambda tag: self._assets(*names))  # noqa: ARG005

        attempted: list[str] = []

        def fake_download(url, dest_path):
            attempted.append(dest_path.name)
            if dest_path.name.startswith("b-"):
                raise OSError("connection reset by peer")
            dest_path.write_bytes(b"payload:" + dest_path.name.encode())

        monkeypatch.setattr(rrd, "download", fake_download)
        dest = tmp_path / "out"

        with pytest.raises(SystemExit, match=r"1/3 件未还原.*部分还原.*b-2026-02\.json\.gz"):
            rrd.restore("community-data", "*-*.json.gz", dest, force=False)

        assert attempted == names, "第一件失败后，后续资产必须继续尝试"
        assert (dest / "a-2026-01.json.gz").exists()
        assert (dest / "c-2026-03.json.gz").exists()
        assert not (dest / "b-2026-02.json.gz").exists()

    def test_tar_read_error_is_recorded_not_raised_bare(self, tmp_path, monkeypatch):
        """坏 tarball：以 SystemExit 点名收场，而不是把 tarfile 的 traceback 摔给调用方。"""
        monkeypatch.setattr(
            rrd, "list_assets", lambda tag: self._assets("broken-2026-01.tar.gz")  # noqa: ARG005
        )

        def fake_download(url, dest_path):
            dest_path.write_bytes(b"this is not a gzip stream")

        monkeypatch.setattr(rrd, "download", fake_download)
        with pytest.raises(SystemExit, match=r"1/1 件未还原.*broken-2026-01\.tar\.gz"):
            rrd.restore("community-data", "*.tar.gz", tmp_path / "out2", force=False)

    def test_dest_outside_repo_still_prints_and_succeeds(self, tmp_path, monkeypatch, capsys):
        """仓外 dest：`relative_to(REPO)` 抛 ValueError，只许影响打印，不许变成假失败。"""
        monkeypatch.setattr(
            rrd, "list_assets", lambda tag: self._assets("one.json.gz")  # noqa: ARG005
        )
        monkeypatch.setattr(rrd, "download", lambda url, p: p.write_bytes(b"x"))
        dest = tmp_path / "outside-the-repo"
        assert rrd.restore("community-assets", "one.json.gz", dest, force=False) == 1
        assert str(dest) in capsys.readouterr().out


# ── 3. 零匹配 = 失败（退出码语义）──────────────────────────────────────────

class TestExitCodeSemantics:
    def test_zero_matches_exits_non_zero_and_names_the_likely_cause(
        self, tmp_path, monkeypatch, capsys
    ):
        """pattern 对不上任何资产：必须非零退出，并指向 --tag / --pattern 这个真实病因。"""
        monkeypatch.setattr(rrd, "list_assets", lambda tag: [{"name": "unrelated.zip"}])  # noqa: ARG005
        monkeypatch.setattr(sys, "argv", [
            "restore_release_data.py",
            "--tag", "community-data",
            "--pattern", "discord-archive-*.tar.gz",
            "--dest", str(tmp_path / "empty-dest"),
        ])
        rc = rrd.main()
        out = capsys.readouterr().out
        assert rc == 1, "一件都没匹配上不是成功——链式调用会在空目录上建索引"
        assert "未还原任何资产" in out
        assert "--tag" in out and "--pattern" in out

    def test_successful_restore_exits_zero(self, tmp_path, monkeypatch):
        """对照臂：真还原到东西才允许退 0（否则上一条测的可能只是「总是红」）。"""
        monkeypatch.setattr(rrd, "list_assets", lambda tag: [  # noqa: ARG005
            {"name": "kb_vectors.json.gz", "size": 1.0, "browser_download_url": "https://e/x"},
        ])
        monkeypatch.setattr(rrd, "download", lambda url, p: p.write_bytes(b"blob"))
        dest = tmp_path / "okf"
        monkeypatch.setattr(sys, "argv", [
            "restore_release_data.py",
            "--tag", "community-assets",
            "--pattern", "kb_vectors.json.gz",
            "--dest", str(dest),
        ])
        assert rrd.main() == 0
        assert (dest / "kb_vectors.json.gz").read_bytes() == b"blob"


# ── 4. tar 加固回退分支：链接 / 特殊成员（3.11.3 及更早那条路）───────────────

def _fallback_extract(tmp_path, build_members, monkeypatch):
    """强制走「无 filter= 参数」的自实现校验分支，返回是否被拒绝。"""
    tgz = tmp_path / "x.tar.gz"
    with tarfile.open(tgz, "w:gz") as tar:
        build_members(tar)
    dest = tmp_path / "dest"
    dest.mkdir()

    real_extractall = tarfile.TarFile.extractall

    def no_filter(self, *args, **kwargs):
        if "filter" in kwargs:
            raise TypeError("extractall() got an unexpected keyword argument 'filter'")
        return real_extractall(self, *args, **kwargs)

    monkeypatch.setattr(tarfile.TarFile, "extractall", no_filter)
    with tarfile.open(tgz, "r:gz") as tar:
        rrd._safe_extractall(tar, dest)


def test_fallback_rejects_symlink_member(tmp_path, monkeypatch):
    """链接成员能把后续写入重定向到任意路径——回退分支必须一样拒绝。"""
    def build(tar):
        info = tarfile.TarInfo("evil-link")
        info.type = tarfile.SYMTYPE
        info.linkname = "/etc/passwd"
        tar.addfile(info)

    with pytest.raises(SystemExit, match=r"拒绝解压链接成员"):
        _fallback_extract(tmp_path, build, monkeypatch)


def test_fallback_rejects_special_file_member(tmp_path, monkeypatch):
    """字符设备等特殊成员同理：既不是文件也不是目录，一律拒。"""
    def build(tar):
        info = tarfile.TarInfo("evil-dev")
        info.type = tarfile.CHRTYPE
        tar.addfile(info)

    with pytest.raises(SystemExit, match=r"拒绝解压特殊文件成员"):
        _fallback_extract(tmp_path, build, monkeypatch)


def test_fallback_accepts_plain_file(tmp_path, monkeypatch):
    """对照臂：普通文件成员在回退分支照常解出（守卫不许一刀切）。"""
    def build(tar):
        info = tarfile.TarInfo("channels/aa/2026-01.jsonl")
        payload = b'{"id":"1"}\n'
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))

    _fallback_extract(tmp_path, build, monkeypatch)
    assert (tmp_path / "dest" / "channels" / "aa" / "2026-01.jsonl").exists()


if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-v"]))
