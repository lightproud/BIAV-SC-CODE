"""便携整包 venv 自愈（launcher.cmd 每次启动前调用，幂等）。

坑（2026-08-02 首跑实证，run 30748746543）：uv `--relocatable` 只让 venv 的脚本
入口相对化，`pyvenv.cfg` 的 `home =` 仍是组装机绝对路径——整包搬移后 venv 找不到
基座解释器（exit 103 "No Python at ..."）。基座 CPython 本身完全便携，故用它把
home 指回当前包内位置即自愈。用法：python fix_venv_path.py <整包根目录>
"""
import pathlib
import sys


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    py_home = next((root / "python").glob("cpython-*"), None)
    if py_home is None:
        print(f"no managed cpython under {root / 'python'}", file=sys.stderr)
        return 1
    cfg = root / "venv" / "pyvenv.cfg"
    lines = cfg.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip().lower()
        out.append(f"home = {py_home}" if key == "home" else line)
    cfg.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"venv home -> {py_home}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
