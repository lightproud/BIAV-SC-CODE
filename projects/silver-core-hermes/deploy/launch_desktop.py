"""便携整包 desktop 监督式启动器（launcher.cmd 步骤 4 后端，stdlib-only）。

治「黑屏结束」类静默失败（守密人 2026-08-02 实机反馈）：旧步骤 4 用 `start`
fire-and-forget——desktop 进程一经拉起即脱管，Electron / Chromium 级早夭
（GPU / 沙箱 0x80000003、缺 DLL、策略拦截未签名 exe）没有任何输出留痕，
用户面 = 黑窗一闪即终。本监督器补三件事：

1. **确定性后端**：注入 HERMES_DESKTOP_HERMES_ROOT / HERMES_DESKTOP_PYTHON
   直指包内 app/ 源树与 venv 解释器——desktop 六级后端解析阶梯第 1 级即命中，
   跳过全部冷启动探针（实测单针可达 10 秒级），且绝不落入 PowerShell
   bootstrap（受限环境的死路）。
2. **捕获 + 探活**：desktop stdout/stderr 追加落 home/logs/desktop-stdout.log
   （Chromium FATAL 只上 stderr，`start` 路径下直接丢失）；启动后守窗
   WAIT_SECONDS 秒，早退即察觉；退出但同名映像仍在（单实例转交 / 沙箱回退
   自重启）经 tasklist 复核判成功，不误报。
3. **软渲染重试 + 取证输出**：首试早夭自动带 --disable-gpu --no-sandbox +
   HERMES_DESKTOP_DISABLE_GPU=1 重试一次（上游 #38216 GPU / 沙箱类死因的
   已知解）；仍死则把两份日志尾部打印到控制台并非零退出，launcher.cmd 停窗。

用法：python launch_desktop.py <整包根目录>
环境旋钮：SILVER_CORE_LAUNCH_WAIT（守窗秒数，默认 25）。
所有输出同时打控制台与 <root>/launcher.log（与 launcher.cmd 共用一本日志）。
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import time

DEFAULT_WAIT_SECONDS = 25
TAIL_LINES = 40


def pick_desktop_exe(root: pathlib.Path) -> pathlib.Path | None:
    """desktop/ 下的主 exe：win-unpacked 形态只有一个顶层 exe，取字典序第一个。"""
    exes = sorted((root / "desktop").glob("*.exe"))
    return exes[0] if exes else None


def build_env(root: pathlib.Path, base_env: dict, disable_gpu: bool = False) -> dict:
    """desktop 进程环境：HERMES_HOME 指包内 + 确定性后端两针 + venv 前置 PATH。"""
    env = dict(base_env)
    env["HERMES_HOME"] = str(root / "home")
    env["HERMES_DESKTOP_HERMES_ROOT"] = str(root / "app")
    env["HERMES_DESKTOP_PYTHON"] = str(root / "venv" / "Scripts" / "python.exe")
    env["PATH"] = str(root / "venv" / "Scripts") + os.pathsep + env.get("PATH", "")
    if disable_gpu:
        env["HERMES_DESKTOP_DISABLE_GPU"] = "1"
    return env


def has_motw(path: pathlib.Path) -> bool:
    """NTFS Zone.Identifier ADS（Mark-of-the-Web）：有则 SmartScreen / 策略可能拦。"""
    try:
        with open(f"{path}:Zone.Identifier", encoding="utf-8", errors="ignore"):
            return True
    except OSError:
        return False


def tail(path: pathlib.Path, n: int = TAIL_LINES) -> list[str]:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return lines[-n:]


def image_running(image_name: str) -> bool:
    """tasklist 复核同名映像是否存活（单实例转交 / 自重启场景防误报）。"""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image_name}", "/NH"],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return image_name.lower() in out.lower()


class Reporter:
    """控制台 + launcher.log 双写（与 launcher.cmd 共用一本日志）。"""

    def __init__(self, log_path: pathlib.Path):
        self.log_path = log_path

    def line(self, msg: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        text = f"[{stamp}] {msg}"
        print(text, flush=True)
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(text + "\n")
        except OSError:
            pass


def attempt(exe: pathlib.Path, env: dict, extra_args: list[str],
            stdout_log: pathlib.Path, wait_seconds: int, report: Reporter) -> bool:
    """拉起一次并守窗：存活 / 转交 = True，早夭 = False。"""
    stdout_log.parent.mkdir(parents=True, exist_ok=True)
    with open(stdout_log, "a", encoding="utf-8") as sink:
        sink.write(f"\n===== attempt {time.strftime('%Y-%m-%d %H:%M:%S')} "
                   f"args={extra_args} =====\n")
        sink.flush()
        proc = subprocess.Popen(
            [str(exe), *extra_args],
            cwd=str(exe.parent), env=env,
            stdout=sink, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            code = proc.poll()
            if code is not None:
                # 早退不等于失败：单实例锁转交 / 沙箱回退 relaunch 都会父退子存，
                # 以同名映像是否仍在为准。
                time.sleep(2)
                if image_running(exe.name):
                    report.line(f"desktop 进程已转交（父进程退出码 {code}，"
                                f"同名映像 {exe.name} 仍在运行）")
                    return True
                report.line(f"desktop 早夭：退出码 {code}（守窗内退出且无存活映像）")
                return False
            time.sleep(1)
    report.line(f"desktop 存活满 {wait_seconds} 秒，判定启动成功")
    return True


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    report = Reporter(root / "launcher.log")
    wait_seconds = int(os.environ.get("SILVER_CORE_LAUNCH_WAIT", DEFAULT_WAIT_SECONDS))

    exe = pick_desktop_exe(root)
    if exe is None:
        report.line(f"[FAIL] {root / 'desktop'} 下未找到任何 exe")
        return 1
    report.line(f"desktop exe = {exe}")

    if has_motw(exe):
        report.line("[warn] desktop exe 带 Mark-of-the-Web（来自下载的 zip 解压）。"
                    "若启动被 SmartScreen / 策略拦截：右键 zip → 属性 → 解除锁定后重新解压。")

    stdout_log = root / "home" / "logs" / "desktop-stdout.log"

    report.line(f"第 1 次启动（守窗 {wait_seconds} 秒）...")
    if attempt(exe, build_env(root, os.environ), [], stdout_log, wait_seconds, report):
        return 0

    report.line("首试早夭，带软渲染参数重试（--disable-gpu --no-sandbox，#38216 类死因）...")
    if attempt(exe, build_env(root, os.environ, disable_gpu=True),
               ["--disable-gpu", "--no-sandbox"], stdout_log, wait_seconds, report):
        return 0

    report.line("[FAIL] 两次启动均早夭。以下为取证日志尾部：")
    for label, p in (("desktop-stdout.log（Chromium/Electron 原始输出）", stdout_log),
                     ("desktop.log（应用主进程取证）", root / "home" / "logs" / "desktop.log")):
        report.line(f"---- {label} ----")
        lines = tail(p)
        if not lines:
            report.line("（空 / 不存在）")
        for line in lines:
            report.line(f"| {line}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
