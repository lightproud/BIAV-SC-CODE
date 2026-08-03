"""bpa-dev 组装套件守卫：补丁应用器行为 + 零内网值纪律。"""
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
KIT = REPO / "projects" / "black-pool-agent" / "deploy"


def _apply(root: Path, patch: str, check: bool = False) -> subprocess.CompletedProcess:
    p = root / "_t.patch"
    p.write_text(patch, encoding="utf-8")
    args = [sys.executable, str(KIT / "apply_patch.py"), "--root", str(root)]
    if check:
        args.append("--check")
    return subprocess.run([*args, str(p)], capture_output=True, text=True)


MOD_PATCH = """diff --git a/x.py b/x.py
--- a/x.py
+++ b/x.py
@@ -1,3 +1,3 @@
 a = 1
-b = 2
+b = 20
 c = 3
"""


def test_modify_applies(tmp_path):
    (tmp_path / "x.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "x.py").read_text(encoding="utf-8") == "a = 1\nb = 20\nc = 3\n"


def test_context_mismatch_fails_loud_and_writes_nothing(tmp_path):
    original = "a = 1\nb = 999\nc = 3\n"
    (tmp_path / "x.py").write_text(original, encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 1
    assert "上下文匹配失败" in r.stderr
    assert (tmp_path / "x.py").read_text(encoding="utf-8") == original


def test_drifted_context_found_within_window(tmp_path):
    pad = "".join(f"pad{i} = 0\n" for i in range(10))
    (tmp_path / "x.py").write_text(pad + "a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 0, r.stderr
    assert "b = 20" in (tmp_path / "x.py").read_text(encoding="utf-8")


def test_new_file_creation(tmp_path):
    patch = """diff --git a/new.py b/new.py
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+x = 1
+y = 2
"""
    r = _apply(tmp_path, patch)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "new.py").read_text(encoding="utf-8") == "x = 1\ny = 2\n"


def test_crlf_target_preserved(tmp_path):
    with (tmp_path / "x.py").open("w", encoding="utf-8", newline="") as fh:
        fh.write("a = 1\r\nb = 2\r\nc = 3\r\n")
    r = _apply(tmp_path, MOD_PATCH)
    assert r.returncode == 0, r.stderr
    with (tmp_path / "x.py").open(encoding="utf-8", newline="") as fh:
        raw = fh.read()
    assert raw == "a = 1\r\nb = 20\r\nc = 3\r\n"


def test_check_mode_does_not_write(tmp_path):
    (tmp_path / "x.py").write_text("a = 1\nb = 2\nc = 3\n", encoding="utf-8")
    r = _apply(tmp_path, MOD_PATCH, check=True)
    assert r.returncode == 0, r.stderr
    assert "b = 2\n" in (tmp_path / "x.py").read_text(encoding="utf-8")


def test_multi_hunk_all_or_nothing(tmp_path):
    """第二 hunk 匹配失败时第一 hunk 也不得落盘（先全量 check 再写）。"""
    original = "a = 1\nb = 2\nc = 3\nd = 4\ne = XXX\nf = 6\n"
    (tmp_path / "x.py").write_text(original, encoding="utf-8")
    patch = """diff --git a/x.py b/x.py
--- a/x.py
+++ b/x.py
@@ -1,3 +1,3 @@
 a = 1
-b = 2
+b = 20
 c = 3
@@ -4,3 +4,3 @@
 d = 4
-e = 5
+e = 50
 f = 6
"""
    r = _apply(tmp_path, patch)
    assert r.returncode == 1
    assert (tmp_path / "x.py").read_text(encoding="utf-8") == original


@pytest.mark.parametrize("name", ["assemble.cmd", "deploy.cmd", "rollback.cmd", "apply_patch.py"])
def test_kit_has_zero_intranet_values(name):
    """通用件纪律：脚本内不得出现网络端点/内网值（文书裁 5 切面化）。"""
    text = (KIT / name).read_text(encoding="utf-8").lower()
    for marker in ("http://", "https://", "idealab", "api_key", "token="):
        assert marker not in text, f"{name} 含疑似内网值/端点标记: {marker}"


def test_kit_files_complete():
    for name in ["assemble.cmd", "deploy.cmd", "rollback.cmd", "apply_patch.py",
                 "RUNBOOK.md", "launcher.cmd", "launch_desktop.py", "fix_venv_path.py"]:
        assert (KIT / name).is_file(), f"bpa-dev 套件缺件: {name}"


def test_fix_venv_path_derives_old_root_without_stamp(tmp_path):
    """2026-08-03 内网首部署野战回归：bundle-root.txt 印章缺失时，旧根必须能从
    editable 指针文件反推——否则自愈整段跳过、导入自检必挂。"""
    (tmp_path / "python" / "cpython-3.11.14-test").mkdir(parents=True)
    site = tmp_path / "venv" / "Lib" / "site-packages"
    site.mkdir(parents=True)
    (tmp_path / "venv" / "pyvenv.cfg").write_text(
        "home = C:\\old\\python\nversion = 3.11\n", encoding="utf-8")
    (site / "x.pth").write_text("D:\\a\\ws\\BlackPool\\app\n", encoding="utf-8")
    (site / "__editable__.hermes.py").write_text(
        "M = {'hermes_cli': 'D:\\\\a\\\\ws\\\\BlackPool\\\\app\\\\hermes_cli'}\n",
        encoding="utf-8")
    r = subprocess.run([sys.executable, str(KIT / "fix_venv_path.py"), str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "derived from editable pointers" in r.stdout
    assert "BlackPool" not in (site / "x.pth").read_text(encoding="utf-8")
    assert "BlackPool" not in (site / "__editable__.hermes.py").read_text(encoding="utf-8")
    assert (tmp_path / "bundle-root.txt").read_text(encoding="utf-8").strip() == str(tmp_path)
    r2 = subprocess.run([sys.executable, str(KIT / "fix_venv_path.py"), str(tmp_path)],
                        capture_output=True, text=True)
    assert r2.returncode == 0, "二跑必须幂等直通"


def test_launcher_kit_mode_dispatch_present():
    """车间双模入口（守密人 2026-08-03 诉求）：kit 里双击 launcher 须能经
    deploy-target.txt 转发到部署位，且 kit 模式零写入（vendor 外链只读）。"""
    text = (KIT / "launcher.cmd").read_text(encoding="utf-8")
    assert "deploy-target.txt" in text and ":in_bundle" in text, (
        "launcher.cmd 车间转发模式缺失"
    )


def test_launcher_rem_lines_are_ascii_short():
    """chcp 65001 解析器错位野战回归：launcher.cmd 的 rem 行必须 ASCII 且不超长。"""
    for line in (KIT / "launcher.cmd").read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.lower().startswith("rem"):
            assert s.isascii(), f"launcher.cmd rem 行含非 ASCII（65001 错位风险）: {s[:60]}"
            assert len(s) <= 100, f"launcher.cmd rem 行超长: {s[:60]}"
