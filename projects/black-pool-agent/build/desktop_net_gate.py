#!/usr/bin/env python3
"""换装后回归网的 CI 侧入口——与周更闭环**共用同一道闸门**。

为什么需要它（2026-09-19 发现的判定链断裂）：守密人 2026-09-18 裁定的受控豁免闸门
落在 `build/verify.py`，只有会话侧的 `sync_upstream.py run` 会经过它；而组装线
`assemble-black-pool-bundle.yml` 的回归网 job 跑的是裸 `npx vitest run`，退出码直接
决定成败。同一棵换装树、同一套用例，两条链判词可以相反——闭环放行、组装线卡死，
包还是出不来。本脚本把 CI 那一步接到同一个判定函数与同一本台账上。

**不放宽任何一条**：放行仍须 `verify.evaluate_desktop_net` 的四条前提同时成立
（全部在册 / 确有用例级失败 / 无整档崩 / 解析条数与 vitest 汇总 failed 逐个对上），
在册条目逐条点名打印。台账外失败一律红。
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_verify():
    spec = importlib.util.spec_from_file_location("bpa_verify_gate", HERE / "verify.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="跑桌面端回归网并经受控豁免闸门判定")
    ap.add_argument("--desktop", required=True, help="组装树里 apps/desktop 的路径")
    ap.add_argument("--log", help="把 vitest 原始输出另存一份到此路径")
    args = ap.parse_args(argv)

    desktop = Path(args.desktop).resolve()
    if not (desktop / "package.json").is_file():
        print(f"错误：{desktop} 不像 apps/desktop（没有 package.json）", file=sys.stderr)
        return 2

    verify = load_verify()
    r = subprocess.run(["npx", "vitest", "run"], cwd=desktop,
                       capture_output=True, text=True, errors="replace")
    log = r.stdout + r.stderr
    print(log)
    if args.log:
        Path(args.log).write_text(log, encoding="utf-8")

    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?", log)
    counts = {}
    if m:
        counts = {"failed": int(m.group(1) or 0), "passed": int(m.group(2)),
                  "skipped": int(m.group(3) or 0)}
    elif r.returncode == 0:
        # 与 verify.run_desktop_net 同款纪律：读不出计数就不许当绿
        print("退出码 0 但读不出计数——vitest 输出形态变了，先修解析再信结论", file=sys.stderr)
        return 1

    result = {"leg": "desktop-net", "run_seconds": 0,
              **verify.evaluate_desktop_net(r.returncode, counts,
                                            verify.parse_vitest_failures(log))}
    print(verify.render(result))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
