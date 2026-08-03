"""BPA 进程探测 / 优雅关停器（bpa-dev 部署件，纯标准库 ctypes 直调 Win32）。

deploy.cmd 部署体验层后端（守密人 2026-08-03 部署体验裁定）：部署前先探测、
先礼后兵——本器绝不 TerminateProcess，强杀始终留给 kill_by_path.py 做显式最后一步。

子命令：
  status <dir>
      枚举可执行路径位于 <dir> 下的进程并判「疑似忙」。
      双信号启发式（均为提示性质，最终由守密人在 deploy.cmd 交互里定夺）：
      (a) CPU 采样窗（1.5 秒）内累计耗时超阈；(b) home\\logs 近 60 秒有写入
      （agent 执行任务时响应流式落盘，网络等待型任务 CPU 低但日志活跃）。
      退出码：0=无进程  1=运行中（空闲）  2=运行中（疑似忙）。
  graceful <dir> [--timeout N]
      向上述进程的可见顶层窗口投递 WM_CLOSE 请求优雅退出（应用走正常
      关闭路径，会话/状态得以落盘），守窗至全部退出或超时（默认 20 秒）。
      退出码：0=全部退出  1=仍有残余（调用方自行决定是否转强杀）。

非 Windows 平台空跑退出 0（供测试面校验）。
"""
from __future__ import annotations

import pathlib
import sys
import time

CPU_SAMPLE_SECONDS = 1.5
CPU_BUSY_SECONDS = 0.3
LOG_FRESH_SECONDS = 60
DEFAULT_GRACE_TIMEOUT = 20
POLL_SECONDS = 0.5


def pids_under(root: str) -> dict[int, str]:
    """返回 {pid: exe 全路径}，仅收可执行文件位于 root 下的进程（排除自身）。"""
    import ctypes
    from ctypes import wintypes

    prefix = root.replace("/", "\\").rstrip("\\").lower() + "\\"
    psapi = ctypes.WinDLL("psapi")
    kernel32 = ctypes.WinDLL("kernel32")
    arr = (wintypes.DWORD * 4096)()
    needed = wintypes.DWORD()
    if not psapi.EnumProcesses(arr, ctypes.sizeof(arr), ctypes.byref(needed)):
        return {}
    count = needed.value // ctypes.sizeof(wintypes.DWORD)
    me = kernel32.GetCurrentProcessId()
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    found: dict[int, str] = {}
    for pid in arr[:count]:
        if not pid or pid == me:
            continue
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            continue
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(len(buf))
            if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                if buf.value.lower().startswith(prefix):
                    found[int(pid)] = buf.value
        finally:
            kernel32.CloseHandle(h)
    return found


def cpu_seconds(pids) -> float:
    """这些进程的内核+用户态 CPU 累计秒数总和（打不开的进程按 0 计）。"""
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32")

    class FILETIME(ctypes.Structure):
        _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    total = 0.0
    for pid in pids:
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            continue
        try:
            c, e, k, u = FILETIME(), FILETIME(), FILETIME(), FILETIME()
            if kernel32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e),
                                        ctypes.byref(k), ctypes.byref(u)):
                for t in (k, u):
                    total += ((t.hi << 32) | t.lo) * 1e-7
        finally:
            kernel32.CloseHandle(h)
    return total


def logs_active(root: str) -> bool:
    """home\\logs 近 LOG_FRESH_SECONDS 秒有写入 = 疑似有任务在流式落盘。"""
    log_dir = pathlib.Path(root) / "home" / "logs"
    now = time.time()
    try:
        for p in log_dir.iterdir():
            try:
                if p.is_file() and now - p.stat().st_mtime <= LOG_FRESH_SECONDS:
                    return True
            except OSError:
                continue
    except OSError:
        pass
    return False


def run_status(root: str) -> int:
    procs = pids_under(root)
    if not procs:
        print(f"not running: no process under {root}")
        return 0
    for pid, path in sorted(procs.items()):
        print(f"running pid={pid} {path}")
    before = cpu_seconds(procs)
    time.sleep(CPU_SAMPLE_SECONDS)
    delta = cpu_seconds(pids_under(root)) - before
    cpu_busy = delta >= CPU_BUSY_SECONDS
    log_busy = logs_active(root)
    if cpu_busy or log_busy:
        why = " + ".join(w for w, on in (
            (f"cpu {delta:.2f}s/{CPU_SAMPLE_SECONDS}s", cpu_busy),
            (f"logs written within {LOG_FRESH_SECONDS}s", log_busy),
        ) if on)
        print(f"busy: {why}")
        return 2
    print("idle")
    return 1


def post_close(pids) -> int:
    """向属于 pids 的可见顶层窗口投递 WM_CLOSE，返回投递窗口数。"""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32")
    WM_CLOSE = 0x0010
    targets = set(int(p) for p in pids)
    posted = 0

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def enum_cb(hwnd, _lparam):
        nonlocal posted
        wpid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value in targets and user32.IsWindowVisible(hwnd):
            user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            posted += 1
        return True

    user32.EnumWindows(enum_cb, 0)
    return posted


def run_graceful(root: str, timeout: int) -> int:
    procs = pids_under(root)
    if not procs:
        print("nothing to close")
        return 0
    posted = post_close(procs)
    print(f"WM_CLOSE posted to {posted} window(s) of {len(procs)} process(es)")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not pids_under(root):
            print("all exited gracefully")
            return 0
        time.sleep(POLL_SECONDS)
    remaining = pids_under(root)
    if not remaining:
        print("all exited gracefully")
        return 0
    for pid, path in sorted(remaining.items()):
        print(f"still running pid={pid} {path}")
    return 1


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in ("status", "graceful"):
        print("usage: bpa_lifecycle.py status|graceful <dir> [--timeout N]",
              file=sys.stderr)
        return 2
    if sys.platform != "win32":
        print("non-windows: no-op")
        return 0
    cmd, root = args[0], args[1]
    timeout = DEFAULT_GRACE_TIMEOUT
    if "--timeout" in args:
        try:
            timeout = int(args[args.index("--timeout") + 1])
        except (IndexError, ValueError):
            print("bad --timeout value", file=sys.stderr)
            return 2
    if cmd == "status":
        return run_status(root)
    return run_graceful(root, timeout)


if __name__ == "__main__":
    raise SystemExit(main())
