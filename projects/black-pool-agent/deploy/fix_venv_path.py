"""便携整包 venv 自愈（launcher.cmd 每次启动前调用，幂等）。

治两类「组装机绝对路径钉死」问题（CI run 1 / run 4 实证，run 5 定形态）：
1. `venv/pyvenv.cfg` 的 `home =` 指基座 CPython——搬移后 venv 找不到解释器
   （exit 103 "No Python at ..."）。
2. site-packages 里项目自身的 **editable 指针**（`.pth` / `__editable__*.py`）指
   组装机的 app 源树——搬移后 `ModuleNotFoundError: No module named 'hermes_cli'`。
   上游构建后端刻意禁 wheel（「use an editable install instead」），故指针自愈是
   便携化的正解而非绕道。

「旧根」解析两级（2026-08-03 内网首部署实证加固：印章丢失曾致自愈整段跳过、
导入自检必挂）：优先 `bundle-root.txt` 印章；印章缺失则**直接从指针文件里反推**
（指针里写的就是旧 app 源树绝对路径，取其去掉尾段 `\\app` 的众数）——印章从
必需品降级为加速缓存，丢了照样自愈。新根 = argv[1]。两根相同即幂等直通。
用法：python fix_venv_path.py <整包根目录>
"""
import pathlib
import re
import sys


def _variants(root: str) -> list[str]:
    """同一路径的三种书写形态（原样 / 双反斜杠转义 / 正斜杠）。"""
    back = root.replace("/", "\\")
    return [back, back.replace("\\", "\\\\"), back.replace("\\", "/")]


_APP_PATH_RE = re.compile(r"[A-Za-z]:[\\/][^'\";\r\n]*?app(?=['\";\r\n\\/]|$)")


def _derive_old_root(site: pathlib.Path) -> str | None:
    """从 editable 指针文件反推旧整包根（指针路径去掉尾段 \\app 的众数）。"""
    counts: dict[str, int] = {}
    for pattern in ("*.pth", "__editable__*.py"):
        for f in site.glob(pattern):
            try:
                text = f.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for m in _APP_PATH_RE.finditer(text):
                p = m.group(0).replace("\\\\", "\\").replace("/", "\\")
                if p.lower().endswith("\\app"):
                    counts[p[: -len("\\app")]] = counts.get(p[: -len("\\app")], 0) + 1
    return max(counts, key=lambda k: counts[k]) if counts else None


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
    site = root / "venv" / "Lib" / "site-packages"
    stamp = root / "bundle-root.txt"
    old_root = ""
    if stamp.is_file():
        old_root = stamp.read_text(encoding="utf-8").strip()
    if not old_root:
        derived = _derive_old_root(site)
        if derived:
            old_root = derived
            print(f"stamp missing; old root derived from editable pointers: {old_root}")
    new_root = str(root)
    if old_root and old_root.rstrip("\\/") != new_root.rstrip("\\/"):
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
