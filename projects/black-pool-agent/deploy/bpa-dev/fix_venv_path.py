"""便携整包 venv 自愈（launcher.cmd 每次启动前调用，幂等）。

治两类「组装机绝对路径钉死」问题（CI run 1 / run 4 实证，run 5 定形态）：
1. `venv/pyvenv.cfg` 的 `home =` 指基座 CPython——搬移后 venv 找不到解释器
   （exit 103 "No Python at ..."）。
2. site-packages 里项目自身的 **editable 指针**（`.pth` / `__editable__*.py`）指
   组装机的 app 源树——搬移后 `ModuleNotFoundError: No module named 'hermes_cli'`。
   上游构建后端刻意禁 wheel（「use an editable install instead」），故指针自愈是
   便携化的正解而非绕道。

「旧根」来自 `bundle-root.txt`（组装期落章，本脚本自愈后滚动更新为当前根），
新根 = argv[1]。两根相同即幂等直通。用法：python fix_venv_path.py <整包根目录>
"""
import pathlib
import sys


def _variants(root: str) -> list[str]:
    """同一路径的三种书写形态（原样 / 双反斜杠转义 / 正斜杠）。"""
    back = root.replace("/", "\\")
    return [back, back.replace("\\", "\\\\"), back.replace("\\", "/")]


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()

    # -- 1) pyvenv.cfg home --
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

    # -- 2) editable 指针改写（旧根 -> 当前根） --
    stamp = root / "bundle-root.txt"
    if not stamp.is_file():
        print("no bundle-root.txt stamp; skip editable heal", file=sys.stderr)
        return 0
    old_root = stamp.read_text(encoding="utf-8").strip()
    new_root = str(root)
    if old_root and old_root.rstrip("\\/") != new_root.rstrip("\\/"):
        site = root / "venv" / "Lib" / "site-packages"
        pairs = list(zip(_variants(old_root.rstrip("\\/")), _variants(new_root), strict=True))
        touched = 0
        for pattern in ("*.pth", "__editable__*.py"):
            for f in site.glob(pattern):
                try:
                    text = f.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                new_text = text
                for old_v, new_v in pairs:
                    new_text = new_text.replace(old_v, new_v)
                if new_text != text:
                    f.write_text(new_text, encoding="utf-8")
                    touched += 1
        print(f"editable pointers healed: {touched} file(s) ({old_root} -> {new_root})")
    stamp.write_text(new_root + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
