"""Black Pool 交互卡顿分诊器（stdlib-only，diagnose.cmd 后端）。

治「界面每个交互都要等 5-10 秒」类现场问题（守密人 2026-08-04 反馈）：卡顿的
候选源分散在互不相干的几层——部署位磁盘形态（网络盘 / 同步盘）、杀软对散文件
与子进程的实时扫描、MOTW（Mark-of-the-Web）触发的逐件核查、网关早夭重启循环
把桌面主进程钉在同步探针里、localhost 的 IPv6 回退、代理环境变量误吞回环地址。
远程无法复现，只能上实机分层测量。本器把每层各测一刀，输出判读提示，全文
落 <root>/lag-report.txt 供回传银芯。

第 8 节读**应用自身的延迟埋点**（interaction-latency-trace 补丁烧入的那套）：
网关侧逐条 RPC 计时（慢的写 gateway.log，标明是内联 lane 还是线程池 lane）、
渲染端往返计时与主线程阻塞（写 desktop.log），加上启动器落的渲染模式档。
前 7 节量的是环境，第 8 节量的是应用内部——两者合起来才能把「每个交互
5-10 秒」定到具体一层，而不是继续猜。

用法：python diagnose_lag.py <整包根目录>
只读部署位（写入仅 lag-report.txt 一件）；kit 模式由 diagnose.cmd 解析部署位后转入。
"""
from __future__ import annotations

import os
import pathlib
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

READ_SAMPLE_MAX_FILES = 300
READ_SAMPLE_MAX_BYTES = 30 * 1024 * 1024
MOTW_SAMPLE_MAX = 400
HTTP_ROUNDS = 5
HTTP_TIMEOUT = 6.0

_LINES: list[str] = []


def force_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass


def say(msg: str = "") -> None:
    print(msg, flush=True)
    _LINES.append(msg)


def section(title: str) -> None:
    say("")
    say(f"==== {title} ====")


def run_capture(args: list[str], timeout: int = 30) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True,
                              timeout=timeout).stdout or ""
    except (OSError, subprocess.SubprocessError):
        return ""


def drive_kind(root: pathlib.Path) -> str:
    """部署位落在什么盘上：UNC / 网络映射盘 / 本地盘 / 可移动盘。"""
    raw = str(root)
    if raw.startswith("\\\\"):
        return "UNC 网络路径"
    if os.name != "nt":
        return "非 Windows（本器按只读降级跑）"
    try:
        import ctypes
        drive = os.path.splitdrive(raw)[0] + "\\"
        kind = ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(drive))
        return {2: "可移动盘", 3: "本地固定盘", 4: "网络映射盘",
                5: "光驱", 6: "RAM 盘"}.get(kind, f"未知类型 {kind}")
    except Exception:  # noqa: BLE001 - 判型失败不挡分诊
        return "判型失败"


def check_env(root: pathlib.Path) -> list[str]:
    hints: list[str] = []
    section("1. 环境事实")
    kind = drive_kind(root)
    say(f"部署位: {root}")
    say(f"盘类型: {kind}")
    if "网络" in kind or "UNC" in kind:
        hints.append("部署位在网络盘/共享目录——所有文件访问走 SMB，整体卡顿的首要嫌疑。"
                     "处置：整目录拷到本地固定盘再跑（RUNBOOK 绿色版二次拷贝纪律）。")
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
                "http_proxy", "https_proxy", "no_proxy"):
        val = os.environ.get(key)
        if val:
            say(f"{key} = {val}")
    proxy_on = any(os.environ.get(k) for k in
                   ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"))
    no_proxy = (os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or "").lower()
    if proxy_on and not ("127.0.0.1" in no_proxy or "localhost" in no_proxy):
        hints.append("设了代理但 NO_PROXY 未豁免 127.0.0.1/localhost——回环流量可能被"
                     "错送代理。处置：config\\env.cmd 里补 set NO_PROXY=127.0.0.1,localhost。")
    return hints


def census(root: pathlib.Path) -> tuple[dict[str, str], list[str]]:
    """进程普查：pid→映像名全表 + python/desktop 计数提示。"""
    hints: list[str] = []
    section("2. 进程普查")
    pid_image: dict[str, str] = {}
    out = run_capture(["tasklist", "/NH", "/FO", "CSV"])
    for line in out.splitlines():
        cells = [c.strip('"') for c in line.split('","')]
        if len(cells) >= 2:
            pid_image[cells[1]] = cells[0]
    py_count = sum(1 for v in pid_image.values() if v.lower() == "python.exe")
    exes = sorted((root / "desktop").glob("*.exe")) if (root / "desktop").is_dir() else []
    desk_name = exes[0].name if exes else "(desktop exe 未找到)"
    desk_count = sum(1 for v in pid_image.values() if v.lower() == desk_name.lower())
    say(f"python.exe 进程数: {py_count}")
    say(f"{desk_name} 进程数: {desk_count}")
    if py_count >= 4:
        hints.append(f"python.exe 多达 {py_count} 个——若日志同时显示反复 attempt/respawn，"
                     "指向网关早夭重启循环（主进程被同步探针反复钉住 = 整个界面逐次卡秒级）。")
    return pid_image, hints


def gateway_ports(pid_image: dict[str, str]) -> list[tuple[int, str, str]]:
    """netstat 找回环监听端口，标注属主映像。返回 (port, pid, image)。"""
    found: list[tuple[int, str, str]] = []
    out = run_capture(["netstat", "-ano", "-p", "TCP"])
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0].upper() == "TCP" and "LISTENING" in line.upper():
            m = re.match(r"^127\.0\.0\.1:(\d+)$", parts[1])
            if m:
                pid = parts[-1]
                found.append((int(m.group(1)), pid, pid_image.get(pid, "?")))
    return found


def time_connect(host: str, port: int) -> float | None:
    t0 = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=HTTP_TIMEOUT):
            return time.perf_counter() - t0
    except OSError:
        return None


def probe_gateway(pid_image: dict[str, str]) -> list[str]:
    hints: list[str] = []
    section("3. 网关往返（回环监听端口逐个测时）")
    ports = gateway_ports(pid_image)
    candidates = [(p, pid, img) for p, pid, img in ports if img.lower() == "python.exe"]
    if not candidates:
        say("未发现 python.exe 的回环监听端口（网关可能已死或以其他形态运行）。")
        say(f"全部回环监听: {[(p, img) for p, _, img in ports][:20]}")
        hints.append("找不到存活网关端口——若桌面端仍在跑，指向网关早夭；"
                     "对照第 7 节日志取证的 attempt 计数。")
        return hints
    for port, pid, img in candidates[:6]:
        say(f"-- 端口 {port}（pid {pid} / {img}）--")
        v4 = time_connect("127.0.0.1", port)
        vlocal = time_connect("localhost", port)
        say(f"TCP 连接 127.0.0.1: {v4 * 1000:.0f} ms" if v4 is not None else
            "TCP 连接 127.0.0.1: 失败")
        say(f"TCP 连接 localhost: {vlocal * 1000:.0f} ms" if vlocal is not None else
            "TCP 连接 localhost: 失败")
        if v4 is not None and vlocal is not None and vlocal - v4 > 0.5:
            hints.append(f"端口 {port}: localhost 比 127.0.0.1 慢 "
                         f"{(vlocal - v4) * 1000:.0f} ms——IPv6 (::1) 回退迟滞，"
                         "每个请求都要先撞一次空门再退回 IPv4。")
        laps: list[float] = []
        for _ in range(HTTP_ROUNDS):
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/",
                                            timeout=HTTP_TIMEOUT):
                    pass
            except urllib.error.HTTPError:
                pass  # 401/404 也算完成一次往返，测的就是耗时
            except (urllib.error.URLError, OSError):
                laps.append(-1.0)
                continue
            laps.append(time.perf_counter() - t0)
        ok = sorted(x for x in laps if x >= 0)
        if ok:
            med = ok[len(ok) // 2]
            say(f"HTTP 往返 x{len(ok)}: 最快 {ok[0] * 1000:.0f} ms / "
                f"中位 {med * 1000:.0f} ms / 最慢 {ok[-1] * 1000:.0f} ms")
            if med > 1.0:
                hints.append(f"端口 {port}: HTTP 中位往返 {med * 1000:.0f} ms——"
                             "网关本身响应慢，嫌疑在后端侧（磁盘/杀软拖 Python）。")
            elif med < 0.2:
                say("判读: 网关往返健康——若界面仍卡，嫌疑在桌面主进程/渲染层，不在后端。")
        else:
            say("HTTP 往返: 全部失败")
    return hints


def sample_read(root: pathlib.Path) -> list[str]:
    hints: list[str] = []
    section("4. 磁盘读采样（散文件区，杀软/网络盘放大器）")
    base = root / "desktop" / "resources" / "app.asar.unpacked" / "dist"
    if not base.is_dir():
        say(f"跳过：{base} 不存在")
        return hints
    n_files = 0
    n_bytes = 0
    t0 = time.perf_counter()
    for path in base.rglob("*"):
        if n_files >= READ_SAMPLE_MAX_FILES or n_bytes >= READ_SAMPLE_MAX_BYTES:
            break
        if path.is_file():
            try:
                n_bytes += len(path.read_bytes())
                n_files += 1
            except OSError:
                continue
    elapsed = time.perf_counter() - t0
    if n_files:
        per_file = elapsed / n_files * 1000
        say(f"读 {n_files} 件 / {n_bytes / 1048576:.1f} MiB，共 {elapsed:.2f} s"
            f"（均 {per_file:.1f} ms/件）")
        if per_file > 20:
            hints.append(f"散文件读取均 {per_file:.0f} ms/件（健康值 <5ms）——"
                         "杀软实时扫描或网络盘在放大所有文件访问；"
                         "处置：给部署目录加杀软排除项 / 拷回本地盘。")
    return hints


def sample_spawn(root: pathlib.Path) -> list[str]:
    hints: list[str] = []
    section("5. 子进程冷启采样（杀软对 spawn 的拦截）")
    py = root / "venv" / "Scripts" / "python.exe"
    if not py.is_file():
        say(f"跳过：{py} 不存在")
        return hints
    laps = []
    for tag in ("首启", "复启"):
        t0 = time.perf_counter()
        try:
            subprocess.run([str(py), "-c", "pass"], capture_output=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            say(f"{tag}: 失败")
            return hints
        laps.append(time.perf_counter() - t0)
        say(f"{tag} python -c pass: {laps[-1]:.2f} s")
    if laps and laps[-1] > 3.0:
        hints.append(f"python 复启仍要 {laps[-1]:.1f} s（健康值 <0.5s）——杀软在逐次"
                     "扫描子进程；界面上每个会 spawn 子进程的交互（终端/git/补全）都会吃这笔账。")
    return hints


def motw_scan(root: pathlib.Path) -> list[str]:
    hints: list[str] = []
    section("6. MOTW 普查（Zone.Identifier 下载标记）")
    if os.name != "nt":
        say("跳过：非 Windows")
        return hints
    hit = 0
    seen = 0
    for base in (root / "desktop", root / "venv" / "Scripts", root / "app"):
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if seen >= MOTW_SAMPLE_MAX:
                break
            if not path.is_file():
                continue
            seen += 1
            try:
                with open(f"{path}:Zone.Identifier", encoding="utf-8",
                          errors="ignore"):
                    hit += 1
            except OSError:
                pass
    say(f"抽样 {seen} 件，带 MOTW 标记 {hit} 件")
    if hit:
        hints.append(f"{hit}/{seen} 抽样文件带 MOTW——SmartScreen/杀软对每件都要额外核查。"
                     "处置：右键 zip → 属性 → 解除锁定后重新解压部署；"
                     "或对已部署树 powershell 不可用时用 streams.exe / 重新整拷。")
    return hints


def log_forensics(root: pathlib.Path) -> list[str]:
    hints: list[str] = []
    section("7. 日志取证（重启循环 / 致命标记）")
    stdout_log = root / "home" / "logs" / "desktop-stdout.log"
    attempts = 0
    fatal = 0
    if stdout_log.is_file():
        try:
            text = stdout_log.read_text(encoding="utf-8", errors="replace")
            attempts = text.count("===== attempt")
            fatal = sum(text.count(m) for m in (
                "A JavaScript error occurred in the main process",
                "Uncaught Exception:"))
        except OSError:
            pass
        say(f"desktop-stdout.log: attempt 段 {attempts} 个 / 致命标记 {fatal} 处")
    else:
        say("desktop-stdout.log 不存在")
    interesting = re.compile(r"respawn|serve|probe|exited|spawn|backend", re.IGNORECASE)
    for name in ("launcher.log", os.path.join("home", "logs", "desktop.log")):
        path = root / name
        if not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        picked = [ln for ln in lines if interesting.search(ln)][-12:]
        say(f"-- {name} 尾部相关行（{len(picked)} 条）--")
        for ln in picked:
            say(f"| {ln}")
        respawnish = sum(1 for ln in lines if re.search(r"respawn|exited", ln, re.IGNORECASE))
        if respawnish >= 5:
            hints.append(f"{name} 含 {respawnish} 条 respawn/exited——网关子进程在反复死亡重启，"
                         "桌面主进程每轮都被同步探针（单针可达 10 秒级）钉住 = 整界面逐次卡顿。")
    return hints


_SLOW_RPC_RE = re.compile(
    r"slow rpc method=(\S+) lane=(\S+) ms=(\d+) queue_ms=(\d+)")
_CLIENT_RPC_RE = re.compile(
    r"\[lag\] gateway rpc method=(\S+) ms=(\d+) outcome=(\S+)")
_BLOCKED_RE = re.compile(r"\[lag\] renderer main thread blocked ms=(\d+)")
_UNRESPONSIVE = "webContents became unresponsive"


def _median(values: list[int]) -> int:
    return sorted(values)[len(values) // 2] if values else 0


def _top(counter: dict[str, list[int]], n: int = 3) -> list[str]:
    ranked = sorted(counter.items(), key=lambda kv: (-max(kv[1]), -len(kv[1])))
    return [f"{name} x{len(v)} 最慢 {max(v)}ms 中位 {_median(v)}ms"
            for name, v in ranked[:n]]


def analyze_app_logs(gateway_text: str, desktop_text: str,
                     render_mode_text: str) -> tuple[list[str], list[str]]:
    """把三份日志读成「哪一层慢」的结论。纯函数，供单测直接喂文本。

    返回 (报告行, 判读提示)。
    """
    out: list[str] = []
    hints: list[str] = []

    mode = ""
    for line in render_mode_text.splitlines():
        if line.startswith("mode="):
            mode = line.split("=", 1)[1].strip()
    if mode:
        out.append(f"渲染模式: {mode}")
        if mode == "software":
            hints.append(
                "本次以**软渲染**起飞（启动器首试早夭后带 --disable-gpu 重试成功）——"
                "界面绘制全落 CPU，交互慢是必然结果，且每次启动都会重演。"
                "处置：先修首试早夭（看 desktop-stdout.log 上一段 attempt），"
                "或设 BLACK_POOL_FORCE_GPU=1 复跑确认回退确实在生效。")
    else:
        out.append("渲染模式: 未记录（启动器版本较旧或未经 launcher 启动）")

    server: dict[str, list[int]] = {}
    inline_hits = 0
    queue_hits = 0
    for m in _SLOW_RPC_RE.finditer(gateway_text):
        method, lane, ms, queue_ms = m.group(1), m.group(2), int(m.group(3)), int(m.group(4))
        server.setdefault(f"{method}({lane})", []).append(ms)
        if lane == "inline":
            inline_hits += 1
        if queue_ms >= 800:
            queue_hits += 1

    client: dict[str, list[int]] = {}
    reconnects = 0
    for m in _CLIENT_RPC_RE.finditer(desktop_text):
        method, ms, outcome = m.group(1), int(m.group(2)), m.group(3)
        client.setdefault(method, []).append(ms)
        if outcome == "reconnected":
            reconnects += 1

    blocked = [int(m.group(1)) for m in _BLOCKED_RE.finditer(desktop_text)]
    unresponsive = desktop_text.count(_UNRESPONSIVE)
    ws_accepts = gateway_text.count("ws accepted peer=")
    ws_closes = gateway_text.count("ws closed peer=")

    out.append(f"网关慢 RPC 记录: {sum(len(v) for v in server.values())} 条"
               f"（内联 lane {inline_hits} 条 / 排队超阈 {queue_hits} 条）")
    for line in _top(server):
        out.append(f"  · {line}")
    out.append(f"渲染端慢往返: {sum(len(v) for v in client.values())} 条"
               f"（其中触发重连 {reconnects} 条）")
    for line in _top(client):
        out.append(f"  · {line}")
    out.append(f"渲染端主线程阻塞: {len(blocked)} 次"
               f"（最长 {max(blocked) if blocked else 0}ms）；"
               f"主进程判定无响应 {unresponsive} 次")
    out.append(f"WS 连接: 接受 {ws_accepts} 次 / 关闭 {ws_closes} 次")

    if not server and not client and not blocked and not mode:
        hints.append(
            "三处埋点都没有任何记录：要么本次跑得很顺（那卡顿不在这三层），"
            "要么整包早于 interaction-latency-trace 补丁——"
            "先确认包内 BUILD.md 的烧入补丁清单里有它，再复跑一次交互后重测。")
        return out, hints

    if blocked:
        hints.append(
            f"渲染端主线程被阻塞 {len(blocked)} 次、最长 {max(blocked)}ms——"
            "卡顿在**界面层**（绘制 / JS 长任务 / 软渲染），不在网关。"
            "配合上面的渲染模式行判读：software 即先治软渲染。")
    if unresponsive:
        hints.append(f"主进程记录到 {unresponsive} 次渲染进程无响应——同上，界面层。")
    if reconnects:
        hints.append(
            f"{reconnects} 次交互是在**重连之后**才完成的——网关连接在反复掉线，"
            "每次交互都要先重建连接（这正是「每个交互都要等几秒」的典型形态）。"
            "对照第 7 节 respawn 计数与本节 WS 接受次数：接受数远大于 1 = 掉线风暴。")
    if inline_hits:
        inline_only = {k: v for k, v in server.items() if k.endswith("(inline)")}
        hints.append(
            f"网关有 {inline_hits} 条**内联 lane** 慢 RPC——内联处理器执行期间"
            "整条 WS 读循环停摆，排在它后面的每个请求都跟着等。"
            f"点名最慢者：{'; '.join(_top(inline_only, 2)) or '见上表'}。")
    if queue_hits:
        hints.append(
            f"网关有 {queue_hits} 条 RPC 在线程池里**排队**超过阈值——池被占满，"
            "提高 HERMES_TUI_RPC_POOL_WORKERS 或查是谁长期占着 worker。")
    if client and not server and not blocked:
        hints.append(
            "渲染端往返慢、网关侧却没有慢处理器记录——时间花在**传输与事件循环**"
            "（回环 / IPv6 回退 / 事件循环被阻塞），对照第 3 节回环测时。")
    return out, hints


def app_forensics(root: pathlib.Path) -> list[str]:
    section("8. 应用内延迟埋点（网关 RPC / 渲染端往返 / 主线程阻塞）")
    logs = root / "home" / "logs"

    def read_all(patterns: tuple[str, ...]) -> str:
        chunks: list[str] = []
        for pattern in patterns:
            for path in sorted(logs.glob(pattern)):
                try:
                    chunks.append(path.read_text(encoding="utf-8", errors="replace"))
                except OSError:
                    continue
        return "\n".join(chunks)

    gateway_text = read_all(("gateway.log", "gateway.log.*"))
    desktop_text = read_all(("desktop.log", "desktop.log.*"))
    try:
        render_mode_text = (logs / "render-mode.txt").read_text(
            encoding="utf-8", errors="replace")
    except OSError:
        render_mode_text = ""

    lines, hints = analyze_app_logs(gateway_text, desktop_text, render_mode_text)
    for line in lines:
        say(line)
    return hints


def main() -> int:
    force_utf8_stdio()
    if len(sys.argv) < 2:
        say("用法: python diagnose_lag.py <整包根目录>")
        return 2
    root = pathlib.Path(sys.argv[1]).resolve()
    say(f"Black Pool 交互卡顿分诊 @ {time.strftime('%Y-%m-%d %H:%M:%S')}")
    say(f"目标: {root}")

    hints: list[str] = []
    hints += check_env(root)
    pid_image, h = census(root)
    hints += h
    hints += probe_gateway(pid_image)
    hints += sample_read(root)
    hints += sample_spawn(root)
    hints += motw_scan(root)
    hints += log_forensics(root)
    hints += app_forensics(root)

    section("9. 判读提示")
    if hints:
        for i, hint in enumerate(hints, 1):
            say(f"[{i}] {hint}")
    else:
        say("各层实测均未见异常——卡顿源可能在渲染层本身或未覆盖的环节；"
            "请把本报告连同 home\\logs\\ 一并回传银芯继续排查。")

    report = root / "lag-report.txt"
    try:
        report.write_text("\n".join(_LINES) + "\n", encoding="utf-8")
        say("")
        say(f"报告已落盘: {report}")
    except OSError as exc:
        say(f"[warn] 报告写入失败: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
