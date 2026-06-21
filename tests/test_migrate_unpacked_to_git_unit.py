"""test_migrate_unpacked_to_git_unit.py —— migrate_unpacked_to_git 纯函数 / 解包逻辑单测。

测 _is_text_member / _asset_urls（monkeypatch list_assets）/ migrate（monkeypatch download）。
"""

import sys
import tarfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_unpacked_to_git as mug  # noqa: E402


# ---------- _is_text_member ----------

def test_is_text_member_plain_txt():
    assert mug._is_text_member("gamescript/foo.txt") is True


def test_is_text_member_json_kept():
    assert mug._is_text_member("sdk/data.json") is True


def test_is_text_member_luac_rejected():
    assert mug._is_text_member("config/bar.luac") is False


def test_is_text_member_luac_case_insensitive():
    assert mug._is_text_member("config/BAR.LUAC") is False


def test_is_text_member_config_binary_dir_rejected():
    assert mug._is_text_member("config/config_binary/x.txt") is False


def test_is_text_member_config_debug_dir_rejected():
    assert mug._is_text_member("config/config_debug/y.txt") is False


def test_is_text_member_hook_capture_dir_rejected():
    assert mug._is_text_member("config/hook_capture/z.txt") is False


# ---------- _asset_urls ----------

def test_asset_urls_uses_api_when_available(monkeypatch):
    api_assets = [
        {"name": "morimens-gamescript.tar.gz", "browser_download_url": "https://api/gs"},
        {"name": "morimens-text-data.tar.gz", "browser_download_url": "https://api/td"},
        {"name": "unrelated.tar.gz", "browser_download_url": "https://api/u"},
    ]
    monkeypatch.setattr(mug, "list_assets", lambda tag: api_assets)
    out = mug._asset_urls()
    names = [n for n, _ in out]
    # only the TEXT_ASSETS present in the API response, in TEXT_ASSETS order
    assert names == ["morimens-gamescript.tar.gz", "morimens-text-data.tar.gz"]
    urls = dict(out)
    assert urls["morimens-gamescript.tar.gz"] == "https://api/gs"


def test_asset_urls_falls_back_to_download_host(monkeypatch, capsys):
    def boom(tag):
        raise OSError("api blocked")

    monkeypatch.setattr(mug, "list_assets", boom)
    out = mug._asset_urls()
    assert [n for n, _ in out] == mug.TEXT_ASSETS
    for name, url in out:
        assert url == f"{mug.DOWNLOAD}/{mug.TAG}/{name}"
    assert "unreachable" in capsys.readouterr().out


# ---------- migrate (download monkeypatched) ----------

def _build_mixed_tgz(path: Path):
    """Archive with text + binary members under a scratch dir."""
    src = path.parent / "_msrc"
    src.mkdir(parents=True, exist_ok=True)
    files = {
        "gamescript/a.txt": b"text",
        "config/config_binary/b.txt": b"bin",
        "config/c.luac": b"\x00\x01",
        "data/d.json": b"{}",
    }
    for rel, data in files.items():
        p = src / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    with tarfile.open(path, "w:gz") as tar:
        # explicit directory member to exercise the isdir() skip branch
        di = tarfile.TarInfo("gamescript")
        di.type = tarfile.DIRTYPE
        tar.addfile(di)
        for rel in files:
            tar.add(src / rel, arcname=rel)


def test_migrate_filters_binary_members(tmp_path, monkeypatch):
    archive = tmp_path / "asset.tar.gz"
    _build_mixed_tgz(archive)

    # single asset to process
    monkeypatch.setattr(mug, "_asset_urls",
                        lambda: [("morimens-gamescript.tar.gz", "https://x/dl")])

    def fake_download(url, dest_path):
        dest_path.write_bytes(archive.read_bytes())

    monkeypatch.setattr(mug, "download", fake_download)

    dest = tmp_path / "out"
    files, skipped = mug.migrate(dest)
    assert files == 2          # a.txt + d.json
    assert skipped == 2        # config_binary/b.txt + c.luac
    assert (dest / "gamescript" / "a.txt").exists()
    assert (dest / "data" / "d.json").exists()
    assert not (dest / "config" / "config_binary" / "b.txt").exists()
    assert not (dest / "config" / "c.luac").exists()


def test_main_invokes_migrate_with_default_dest(tmp_path, monkeypatch):
    captured = {}

    def fake_migrate(dest):
        captured["dest"] = dest
        return (0, 0)

    monkeypatch.setattr(mug, "migrate", fake_migrate)
    monkeypatch.setattr(sys, "argv", ["migrate_unpacked_to_git.py"])
    mug.main()
    assert captured["dest"] == Path("Public-Info-Pool/game-unpacked-data")


def test_main_invokes_migrate_with_custom_dest(monkeypatch):
    captured = {}
    monkeypatch.setattr(mug, "migrate", lambda dest: captured.setdefault("dest", dest) or (0, 0))
    monkeypatch.setattr(sys, "argv", ["migrate_unpacked_to_git.py", "--dest", "some/where"])
    mug.main()
    assert captured["dest"] == Path("some/where")
