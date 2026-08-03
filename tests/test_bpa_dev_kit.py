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


@pytest.mark.parametrize("name", ["assemble.cmd", "verify.cmd", "deploy.cmd", "rollback.cmd",
                                  "apply_patch.py", "bpa_lifecycle.py"])
def test_kit_has_zero_intranet_values(name):
    """通用件纪律：脚本内不得出现网络端点/内网值（文书裁 5 切面化）。"""
    text = (KIT / name).read_text(encoding="utf-8").lower()
    for marker in ("http://", "https://", "idealab", "api_key", "token="):
        assert marker not in text, f"{name} 含疑似内网值/端点标记: {marker}"


def test_kit_files_complete():
    for name in ["assemble.cmd", "verify.cmd", "deploy.cmd", "rollback.cmd", "apply_patch.py",
                 "RUNBOOK.md", "launcher.cmd", "launch_desktop.py", "fix_venv_path.py",
                 "make-shortcut.vbs", "kill_by_path.py", "bpa_lifecycle.py"]:
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


@pytest.mark.parametrize("name", ["launcher.cmd", "assemble.cmd", "verify.cmd",
                                  "deploy.cmd", "rollback.cmd"])
def test_cmd_rem_lines_are_ascii_short(name):
    """chcp 65001 解析器错位野战回归（两案实证）：套件 cmd 的 rem 行必须 ASCII 短行。"""
    for line in (KIT / name).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.lower().startswith("rem"):
            assert s.isascii(), f"{name} rem 行含非 ASCII（65001 错位风险）: {s[:60]}"
            assert len(s) <= 100, f"{name} rem 行超长: {s[:60]}"


def test_native_launcher_source_present_and_wired():
    """无感原生外壳（守密人 2026-08-03 诉求）：C# 源在位且两条装配线都有编译步。"""
    cs = KIT.parent / "build" / "black-pool-launcher.cs"
    assert cs.is_file() and "winexe" in cs.read_text(encoding="utf-8")
    for wf in ("assemble-black-pool-bundle.yml", "assemble-black-pool-public.yml"):
        text = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert "black-pool-launcher.cs" in text and "win32icon" in text, f"{wf} 缺编译步"
    launcher = (KIT / "launcher.cmd").read_text(encoding="utf-8")
    assert "BPA_SILENT" in launcher and "%PAUSE_C%" in launcher, "launcher 静默模式缺失"


def test_kill_by_path_noop_on_non_windows(tmp_path):
    """路径杀进程器：非 Windows 空跑退出 0（管线可验）；Windows 行为靠野战。"""
    r = subprocess.run([sys.executable, str(KIT / "kill_by_path.py"), str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "no-op" in r.stdout


@pytest.mark.parametrize("cmd", ["status", "graceful"])
def test_bpa_lifecycle_noop_on_non_windows(tmp_path, cmd):
    """生命周期探测器：非 Windows 空跑退出 0（管线可验）；Windows 行为靠野战。"""
    r = subprocess.run([sys.executable, str(KIT / "bpa_lifecycle.py"), cmd, str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "no-op" in r.stdout


def test_bpa_lifecycle_usage_error():
    """缺子命令/目录参数须响亮失败（退出码 2），不静默空跑。"""
    r = subprocess.run([sys.executable, str(KIT / "bpa_lifecycle.py"), "status"],
                       capture_output=True, text=True)
    assert r.returncode == 2 and "usage" in r.stderr


def test_deploy_restart_ux_flow_present():
    """部署体验五项（守密人 2026-08-03 裁定）文本守卫：提示重启 / 忙时等待或确认 /
    优雅退出先于强杀 / 完成后自动重启。Windows 交互行为靠野战。"""
    text = (KIT / "deploy.cmd").read_text(encoding="utf-8")
    assert "将重启 Black Pool" in text, "缺部署前重启提示"
    assert "choice /c" in text, "缺确认交互"
    assert 'bpa_lifecycle.py" status' in text, "缺运行/忙探测"
    assert ":wait_idle" in text, "缺忙时等待循环"
    assert 'bpa_lifecycle.py" graceful' in text, "缺优雅退出步"
    assert text.index('bpa_lifecycle.py" graceful') < text.index("kill_by_path.py"), (
        "优雅退出必须先于强杀"
    )
    assert "WAS_RUNNING" in text and 'start "" "%LNK_TARGET%"' in text, "缺自动重启"
    assert '"/y"' in text, "缺无人值守 /y 通道"


def test_verify_never_touches_deploy_target():
    """组装验证与部署分离（守密人 2026-08-03 裁定）：verify.cmd 只碰 staging，
    零杀进程、零部署位引用。"""
    text = (KIT / "verify.cmd").read_text(encoding="utf-8")
    lower = text.lower()
    for banned in ("taskkill", "kill_by_path", "bpa_dir", "deploy-target", "wm_close"):
        assert banned not in lower, f"verify.cmd 不得含部署位/杀进程引用: {banned}"
    assert "staging\\BlackPool" in text and "import hermes_cli" in text
