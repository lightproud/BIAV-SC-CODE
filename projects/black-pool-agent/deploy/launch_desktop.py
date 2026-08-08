"""便携整包 desktop 监督式启动器（launcher.cmd 步骤 4 后端，stdlib-only）。

治「黑屏结束」类静默失败（守密人 2026-08-02 实机反馈）：旧步骤 4 用 `start`
fire-and-forget——desktop 进程一经拉起即脱管，Electron / Chromium 级早夭
（GPU / 沙箱 0x80000003、缺 DLL、策略拦截未签名 exe）没有任何输出留痕，
用户面 = 黑窗一闪即终。本监督器补四件事：

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
4. **完整性预检 + 主进程异常判死**（守密人 2026-08-04 实机反馈：ESM 解析
   app.asar 内 node-pty 失败弹「A JavaScript error occurred」对话框）：
   起飞前先验 desktop/resources 关键件在位（app.asar 与 app.asar.unpacked
   下的主进程 bundle / node-pty 全套）——拷贝链丢 app.asar.unpacked 类断料
   在此响亮失败，不再把用户送进 Electron 错误框；守窗期同步扫描捕获日志，
   出现主进程 Uncaught Exception / 加载错误标记即判死——该对话框会让进程
   存活满守窗，旧「存活即成功」判据对它是假绿（CI 冒烟同一漏洞）。

用法：python launch_desktop.py <整包根目录>
环境旋钮：BLACK_POOL_LAUNCH_WAIT（守窗秒数，默认 25）。
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

# desktop/resources 关键件（相对整包根）：electron-builder 把 dist/** 全量
# asarUnpack——asar 本体只存指路条目，真身在 app.asar.unpacked。任何一件缺失，
# 主进程要么起不来、要么 import 'node-pty' 时 ESM 解析失败弹错误框。
INTEGRITY_FILES = (
    "desktop/resources/app.asar",
    "desktop/resources/app.asar.unpacked/dist/electron-main.mjs",
    "desktop/resources/app.asar.unpacked/dist/node_modules/node-pty/package.json",
    "desktop/resources/app.asar.unpacked/dist/node_modules/node-pty/lib/index.js",
    "desktop/resources/app.asar.unpacked/dist/node_modules/node-pty/prebuilds/win32-x64/pty.node",
)

# 主进程致命标记：Electron 主进程未捕获异常 / 主脚本加载失败在弹对话框前后
# 都会写 stderr（已并入捕获日志）。对话框把进程钉在存活态，必须按内容判死。
FATAL_LOG_MARKERS = (
    "A JavaScript error occurred in the main process",
    "App threw an error during load",
    "Uncaught Exception:",
)


def check_desktop_integrity(root: pathlib.Path) -> list[str]:
    """返回缺失关键件的相对路径清单（全在位 = 空表）。"""
    return [rel for rel in INTEGRITY_FILES if not (root / rel).is_file()]


def find_fatal_marker(log_path: pathlib.Path, offset: int) -> str | None:
    """从 offset 起扫捕获日志，命中任一致命标记即返回该标记。"""
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(offset)
            chunk = f.read()
    except OSError:
        return None
    for marker in FATAL_LOG_MARKERS:
        if marker in chunk:
            return marker
    return None


def force_utf8_stdio() -> None:
    """stdout/stderr 强制 UTF-8：控制台外的管道（CI / 重定向）默认 locale 编码
    （cp1252 / GBK），打印中文进度即 UnicodeEncodeError——run 8 实证死在第一行。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def pick_desktop_exe(root: pathlib.Path) -> pathlib.Path | None:
    """desktop/ 下的主 exe：win-unpacked 形态只有一个顶层 exe，取字典序第一个。"""
    exes = sorted((root / "desktop").glob("*.exe"))
    return exes[0] if exes else None


def build_env(root: pathlib.Path, base_env: dict, disable_gpu: bool = False) -> dict:
    """desktop 进程环境：HERMES_HOME 指包内 + 确定性后端两针 + venv 前置 PATH。"""
    env = dict(base_env)
    env["HERMES_HOME"] = str(root / "home")
    # 应用显示名（上游官方旋钮）：main.ts 兜底 'Hermes' 的 APP_NAME 行被换装规则
    # 跳线保留（含 HERMES_），经环境针覆盖——launcher.cmd 已设，此处兜 CI 冒烟
    # 与直跑本脚本的路径。setdefault：守密人显式设过则不抢。
    env.setdefault("HERMES_DESKTOP_APP_NAME", "Black Pool")
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
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError, UnicodeDecodeError):
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
        scan_offset = sink.tell()
        proc = subprocess.Popen(
            [str(exe), *extra_args],
            cwd=str(exe.parent), env=env,
            stdout=sink, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            # 主进程未捕获异常的对话框会把进程钉在存活态——按日志内容判死，
            # 不给「弹框存活」留假绿通道（CI 冒烟与用户面同一判据）。
            marker = find_fatal_marker(stdout_log, scan_offset)
            if marker is not None:
                report.line(f"desktop 主进程报致命错误（{marker}），判定启动失败并结束进程")
                proc.kill()
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
                return False
            code = proc.poll()
            if code is not None:
                # 早退不等于失败：单实例锁转交 / 沙箱回退 relaunch 都会父退子存，
                # 以同名映像是否仍在为准。
                time.sleep(2)
                if find_fatal_marker(stdout_log, scan_offset) is not None:
                    report.line(f"desktop 早夭且日志含主进程致命错误：退出码 {code}")
                    return False
                if image_running(exe.name):
                    report.line(f"desktop 进程已转交（父进程退出码 {code}，"
                                f"同名映像 {exe.name} 仍在运行）")
                    return True
                report.line(f"desktop 早夭：退出码 {code}（守窗内退出且无存活映像）")
                return False
            time.sleep(1)
    marker = find_fatal_marker(stdout_log, scan_offset)
    if marker is not None:
        report.line(f"desktop 存活但主进程报致命错误（{marker}），判定启动失败并结束进程")
        proc.kill()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            pass
        return False
    report.line(f"desktop 存活满 {wait_seconds} 秒，判定启动成功")
    return True


def main() -> int:
    force_utf8_stdio()
    root = pathlib.Path(sys.argv[1]).resolve()
    report = Reporter(root / "launcher.log")
    wait_seconds = int(os.environ.get("BLACK_POOL_LAUNCH_WAIT", DEFAULT_WAIT_SECONDS))

    exe = pick_desktop_exe(root)
    if exe is None:
        report.line(f"[FAIL] {root / 'desktop'} 下未找到任何 exe")
        return 1
    report.line(f"desktop exe = {exe}")

    missing = check_desktop_integrity(root)
    if missing:
        report.line("[FAIL] desktop 关键件缺失，拒绝起飞（缺料启动只会弹 Electron 错误框）：")
        for rel in missing:
            report.line(f"  缺 {rel}")
        report.line("多为拷贝/同步链丢了 app.asar.unpacked（有些同步工具默认跳过"
                    " node_modules 目录）。处置：整目录重新部署（deploy.cmd），"
                    "或换用不过滤目录的拷贝方式后重试。")
        return 1

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
