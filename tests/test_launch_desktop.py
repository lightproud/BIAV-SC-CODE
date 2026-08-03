"""desktop 监督式启动器（deploy/launch_desktop.py）纯函数守卫。

监督器本体只能在 Windows 实机 / CI 冒烟里全链路验证（tasklist / ADS / 真 exe），
本档守它的跨平台纯部分：exe 选取、环境注入（确定性后端两针）、日志尾读、双写。
坏一处即用户面回到「黑屏一闪无痕」——这些函数是取证链的地基。
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO / "projects" / "black-pool-agent" / "deploy" / "launch_desktop.py"

_spec = importlib.util.spec_from_file_location("launch_desktop", MODULE_PATH)
launch_desktop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(launch_desktop)


def test_pick_desktop_exe_first_sorted(tmp_path):
    (tmp_path / "desktop").mkdir()
    (tmp_path / "desktop" / "b tool.exe").touch()
    (tmp_path / "desktop" / "Silver Core.exe").touch()
    picked = launch_desktop.pick_desktop_exe(tmp_path)
    assert picked is not None
    assert picked.name == "Silver Core.exe"  # 字典序：大写 S < 小写 b


def test_pick_desktop_exe_none_when_empty(tmp_path):
    (tmp_path / "desktop").mkdir()
    assert launch_desktop.pick_desktop_exe(tmp_path) is None
    assert launch_desktop.pick_desktop_exe(tmp_path / "absent-root") is None


def test_build_env_injects_deterministic_backend(tmp_path):
    env = launch_desktop.build_env(tmp_path, {"PATH": "/usr/bin", "KEEP": "1"})
    assert env["HERMES_HOME"] == str(tmp_path / "home")
    assert env["HERMES_DESKTOP_HERMES_ROOT"] == str(tmp_path / "app")
    assert env["HERMES_DESKTOP_PYTHON"] == str(
        tmp_path / "venv" / "Scripts" / "python.exe")
    assert env["PATH"].startswith(str(tmp_path / "venv" / "Scripts") + os.pathsep)
    assert env["PATH"].endswith("/usr/bin")
    assert env["KEEP"] == "1"
    assert "HERMES_DESKTOP_DISABLE_GPU" not in env


def test_build_env_disable_gpu_flag(tmp_path):
    env = launch_desktop.build_env(tmp_path, {}, disable_gpu=True)
    assert env["HERMES_DESKTOP_DISABLE_GPU"] == "1"


def test_build_env_does_not_mutate_base(tmp_path):
    base = {"PATH": "x"}
    launch_desktop.build_env(tmp_path, base)
    assert base == {"PATH": "x"}


def test_tail_missing_and_truncation(tmp_path):
    assert launch_desktop.tail(tmp_path / "absent.log") == []
    log = tmp_path / "some.log"
    log.write_text("\n".join(f"line{i}" for i in range(100)), encoding="utf-8")
    got = launch_desktop.tail(log, n=40)
    assert len(got) == 40
    assert got[0] == "line60" and got[-1] == "line99"


def test_reporter_dual_writes(tmp_path, capsys):
    rep = launch_desktop.Reporter(tmp_path / "launcher.log")
    rep.line("hello 取证")
    out = capsys.readouterr().out
    assert "hello 取证" in out
    assert "hello 取证" in (tmp_path / "launcher.log").read_text(encoding="utf-8")


def test_reporter_survives_cp1252_pipe(tmp_path):
    # run 8 实证死因：CI 管道 stdout 是 cp1252，打印中文进度即 UnicodeEncodeError。
    # 子进程强制 PYTHONIOENCODING=cp1252 复现管道形态，force_utf8_stdio 必须救回。
    import subprocess
    import sys
    code = (
        "import importlib.util, pathlib\n"
        f"spec = importlib.util.spec_from_file_location('ld', {str(MODULE_PATH)!r})\n"
        "ld = importlib.util.module_from_spec(spec); spec.loader.exec_module(ld)\n"
        "ld.force_utf8_stdio()\n"
        f"ld.Reporter(pathlib.Path({str(tmp_path / 'l.log')!r})).line('第 1 次启动（守窗）')\n"
    )
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    r = subprocess.run([sys.executable, "-c", code],
                       capture_output=True, text=False, env=env, timeout=60)
    assert r.returncode == 0, r.stderr.decode(errors="replace")
    assert "守窗".encode() in r.stdout  # UTF-8 原文到达管道
    assert "守窗" in (tmp_path / "l.log").read_text(encoding="utf-8")


def test_reporter_survives_unwritable_log(tmp_path, capsys):
    # 日志写不进（目录不存在）不应让监督器崩——控制台输出仍在
    rep = launch_desktop.Reporter(tmp_path / "no-such-dir" / "launcher.log")
    rep.line("still alive")
    assert "still alive" in capsys.readouterr().out


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
