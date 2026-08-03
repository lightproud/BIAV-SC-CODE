"""按可执行路径杀进程（bpa-dev 部署件，纯标准库 ctypes 直调 Win32）。

存在理由：deploy 轮换最常见的顽固占用者是部署目录内的自家后端进程
（python.exe / hermes.exe），按镜像名杀会误伤机器上其他同名进程，
按路径杀的 wmic 在新版 Windows 已被移除——本器用 EnumProcesses +
QueryFullProcessImageNameW 精确匹配「可执行文件位于目标目录下」的
进程并终止，绝不越界。

用法：python kill_by_path.py <目录>   （终止所有 exe 路径在该目录下的进程）
非 Windows 平台直接空跑退出 0（供测试面校验）。
"""
from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: kill_by_path.py <dir>", file=sys.stderr)
        return 2
    if sys.platform != "win32":
        print("non-windows: no-op")
        return 0

    import ctypes
    from ctypes import wintypes

    root = sys.argv[1].replace("/", "\\").rstrip("\\").lower() + "\\"
    psapi = ctypes.WinDLL("psapi")
    kernel32 = ctypes.WinDLL("kernel32")

    arr = (wintypes.DWORD * 4096)()
    needed = wintypes.DWORD()
    if not psapi.EnumProcesses(arr, ctypes.sizeof(arr), ctypes.byref(needed)):
        print("EnumProcesses failed", file=sys.stderr)
        return 1
    count = needed.value // ctypes.sizeof(wintypes.DWORD)
    me = kernel32.GetCurrentProcessId()

    PROCESS_TERMINATE = 0x0001
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    killed = 0
    for pid in arr[:count]:
        if not pid or pid == me:
            continue
        h = kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, False, pid
        )
        if not h:
            continue
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(len(buf))
            if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                path = buf.value.lower()
                if path.startswith(root):
                    if kernel32.TerminateProcess(h, 1):
                        killed += 1
                        print(f"killed pid={pid} {buf.value}")
        finally:
            kernel32.CloseHandle(h)
    print(f"done: {killed} process(es) under {sys.argv[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
