#!/usr/bin/env python3
"""bpa-dev assembly injector + manifest writer (stdlib only, zero intranet values).

Called by assemble.cmd after extraction and launcher-family overwrite:

    python assemble_inject.py --devroot <bpa-dev> --bundle <staging/BlackPool> \
        --zip <releases/xxx.zip> [--sha <verified-sha256>]

Selection table (keeper-controlled, optional): ``<devroot>/config/assembly.txt``
INI style, five sections — [patches] [plugins] [skills] [config] [overlay].
Each entry is ``name = on`` / ``off``; ``* = on|off`` sets the section default.
Missing file or missing section = everything on (backward compatible).

    [patches]
    * = on
    some-experiment.patch = off

    [plugins]
    memory/blackpool = on

After injecting, writes the ground-truth assembly documents into the bundle:

    ASSEMBLY.md   human-readable: what went in, what was skipped, fingerprints
    MANIFEST.txt  short machine block (deploy.cmd types it after deploy)

Discipline: config file CONTENTS never enter the manifest — env.cmd may hold
credentials, so names / sizes / SHA-256 prefixes only. Progress lines go to
stdout (console) AND are appended to <devroot>/assemble.log by this script.
"""
from __future__ import annotations

import argparse
import configparser
import hashlib
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SECTIONS = ("patches", "plugins", "skills", "config", "overlay")
CONFIG_INJECT = (
    # (source name under config/, bundle-relative destination)
    ("SOUL.md", "home/SOUL.md"),
    ("env.cmd", "env.cmd"),
    ("model-prices.json", "home/model-prices.json"),
)

_log_file = None


def log(msg: str) -> None:
    print(msg)
    if _log_file:
        with open(_log_file, "a", encoding="utf-8") as fh:
            fh.write(f"[assemble_inject] {msg}\n")


def sha256_of(path: Path, limit: int = 12) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:limit]


class Selection:
    """assembly.txt reader. Absent file/section/entry defaults to ON."""

    def __init__(self, path: Path):
        self.path = path
        self.cp = None
        if path.is_file():
            cp = configparser.ConfigParser(delimiters=("=",), strict=False)
            cp.optionxform = str  # keep filename case
            cp.read(path, encoding="utf-8")
            self.cp = cp

    @staticmethod
    def _truthy(v: str) -> bool:
        return v.strip().lower() not in ("off", "false", "0", "no")

    def on(self, section: str, name: str) -> bool:
        if self.cp is None or not self.cp.has_section(section):
            return True
        sec = self.cp[section]
        if name in sec:
            return self._truthy(sec[name])
        if "*" in sec:
            return self._truthy(sec["*"])
        return True


def diffstat(patch: Path) -> tuple[int, int, int]:
    files = plus = minus = 0
    for line in patch.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("diff --git"):
            files += 1
        elif line.startswith("+") and not line.startswith("+++"):
            plus += 1
        elif line.startswith("-") and not line.startswith("---"):
            minus += 1
    return files, plus, minus


def leaf_plugin_dirs(root: Path):
    """Yield plugin dirs (contain __init__.py or plugin.yaml), as rel posix paths.

    A plugin's own subpackages also carry __init__.py — only the OUTERMOST
    matching dir is a plugin; anything under an already-yielded dir is its
    internals and must not be yielded again.
    """
    yielded: list[str] = []
    for p in sorted(root.rglob("*")):
        if p.is_dir() and ((p / "__init__.py").exists() or (p / "plugin.yaml").exists()):
            rel = p.relative_to(root).as_posix()
            if any(rel == y or rel.startswith(y + "/") for y in yielded):
                continue
            yielded.append(rel)
            yield rel, p


def plugin_meta(d: Path) -> str:
    y = d / "plugin.yaml"
    if not y.is_file():
        return ""
    text = y.read_text(encoding="utf-8", errors="replace")
    name = re.search(r"^name:\s*(.+)$", text, re.M)
    ver = re.search(r"^version:\s*(.+)$", text, re.M)
    parts = [m.group(1).strip() for m in (name, ver) if m]
    return " ".join(parts)


def copy_tree(src: Path, dst: Path) -> int:
    n = 0
    for f in sorted(src.rglob("*")):
        if f.is_file():
            target = dst / f.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)
            n += 1
    return n


def main() -> int:
    global _log_file
    ap = argparse.ArgumentParser()
    ap.add_argument("--devroot", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--zip", dest="zip_path", default="")
    ap.add_argument("--sha", default="")
    a = ap.parse_args()

    dev = Path(a.devroot).resolve()
    bundle = Path(a.bundle).resolve()
    kit = Path(__file__).resolve().parent
    _log_file = dev / "assemble.log"
    sel = Selection(dev / "config" / "assembly.txt")

    included: dict[str, list[str]] = {s: [] for s in SECTIONS}
    skipped: dict[str, list[str]] = {s: [] for s in SECTIONS}

    # -- 1. patches (filename order among enabled) ----------------------
    patches_dir = dev / "patches"
    for patch in sorted(patches_dir.glob("*.patch")) if patches_dir.is_dir() else []:
        if not sel.on("patches", patch.name):
            skipped["patches"].append(patch.name)
            log(f"补丁跳过（选装表 off）：{patch.name}")
            continue
        r = subprocess.run(
            [sys.executable, str(kit / "apply_patch.py"),
             "--root", str(bundle / "app"), str(patch)],
            capture_output=True, text=True)
        if r.returncode != 0:
            log(f"补丁应用失败：{patch.name}")
            log(r.stderr.strip()[-800:])
            return 1
        files, plus, minus = diffstat(patch)
        included["patches"].append(
            f"{patch.name}  ({files} 文件, +{plus}/-{minus} 行, sha256:{sha256_of(patch)})")
        log(f"补丁已打：{patch.name}")

    # -- 2. config injections (fingerprints only, never contents) -------
    cfg = dev / "config"
    for name, rel_dst in CONFIG_INJECT:
        src = cfg / name
        if not src.is_file():
            continue
        if not sel.on("config", name):
            skipped["config"].append(name)
            log(f"配置跳过（选装表 off）：{name}")
            continue
        dst = bundle / rel_dst
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        included["config"].append(
            f"{name} -> {rel_dst}  ({src.stat().st_size} B, sha256:{sha256_of(src)})")
        log(f"已注入 {name}")

    # -- 3. plugins (selection at plugin-dir granularity) ----------------
    plugroot = dev / "plugins"
    if plugroot.is_dir():
        for rel, d in leaf_plugin_dirs(plugroot):
            if not sel.on("plugins", rel):
                skipped["plugins"].append(rel)
                log(f"插件跳过（选装表 off）：{rel}")
                continue
            n = copy_tree(d, bundle / "app" / "plugins" / rel)
            meta = plugin_meta(d)
            included["plugins"].append(f"{rel}  ({n} 文件{', ' + meta if meta else ''})")
            log(f"插件已入包：{rel}")

    # -- 4. skills (top-level entries) -----------------------------------
    skroot = dev / "skills"
    if skroot.is_dir():
        for entry in sorted(skroot.iterdir()):
            if not sel.on("skills", entry.name):
                skipped["skills"].append(entry.name)
                log(f"技能跳过（选装表 off）：{entry.name}")
                continue
            dst = bundle / "home" / "skills" / entry.name
            if entry.is_dir():
                n = copy_tree(entry, dst)
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry, dst)
                n = 1
            included["skills"].append(f"{entry.name}  ({n} 文件)")
            log(f"技能已入包：{entry.name}")

    # -- 5. overlay (top-level entries, verbatim onto bundle root) --------
    ovroot = dev / "overlay"
    if ovroot.is_dir():
        for entry in sorted(ovroot.iterdir()):
            if not sel.on("overlay", entry.name):
                skipped["overlay"].append(entry.name)
                log(f"覆盖层跳过（选装表 off）：{entry.name}")
                continue
            if entry.is_dir():
                n = copy_tree(entry, bundle / entry.name)
            else:
                shutil.copy2(entry, bundle / entry.name)
                n = 1
            included["overlay"].append(f"{entry.name}  ({n} 文件)")
            log(f"覆盖层已应用：{entry.name}")

    # -- bundle facts ----------------------------------------------------
    version = ""
    initpy = bundle / "app" / "hermes_cli" / "__init__.py"
    if initpy.is_file():
        m = re.search(r'__version__\s*=\s*"([^"]+)"',
                      initpy.read_text(encoding="utf-8", errors="replace"))
        version = m.group(1) if m else ""
    pyruntime = ""
    pydir = bundle / "python"
    if pydir.is_dir():
        for d in sorted(pydir.glob("cpython-*")):
            pyruntime = d.name
    launcher_family = []
    for name in ("launcher.cmd", "launch_desktop.py", "fix_venv_path.py"):
        f = bundle / name
        if f.is_file():
            launcher_family.append(f"{name}  (sha256:{sha256_of(f)})")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    zip_path = Path(a.zip_path) if a.zip_path else None
    zip_line = "（未记录）"
    if zip_path and zip_path.is_file():
        size_mb = zip_path.stat().st_size / 1048576
        sha = a.sha.strip() or sha256_of(zip_path, 64)
        zip_line = f"{zip_path.name}  ({size_mb:.1f} MB, sha256:{sha[:16]}...)"

    sel_line = ("config\\assembly.txt"
                f"  (sha256:{sha256_of(sel.path)})" if sel.cp is not None
                else "未提供（缺省 = 全部拼装）")

    # -- ASSEMBLY.md ------------------------------------------------------
    def section_md(title: str, key: str) -> str:
        lines = [f"## {title}", ""]
        if included[key]:
            lines += [f"- {x}" for x in included[key]]
        else:
            lines.append("- （无）")
        if skipped[key]:
            lines.append("")
            lines.append(f"跳过（选装表 off）：{', '.join(skipped[key])}")
        lines.append("")
        return "\n".join(lines)

    md = "\n".join([
        "# Black Pool 装配清单（ASSEMBLY.md）",
        "",
        f"- 装配时间：{now}",
        f"- 进料包：{zip_line}",
        f"- 包内产品版本：{version or '（未探明）'}",
        f"- Python 运行时：{pyruntime or '（未探明）'}",
        f"- 选装表：{sel_line}",
        "",
        section_md("补丁", "patches"),
        section_md("配置注入（只记指纹，内容绝不入清单）", "config"),
        section_md("插件", "plugins"),
        section_md("技能", "skills"),
        section_md("覆盖层", "overlay"),
        "## 启动器族（套件版覆盖）",
        "",
        *([f"- {x}" for x in launcher_family] or ["- （无）"]),
        "",
        "> 本档由 assemble_inject.py 生成，是本次装配的地面真相记录。",
        "",
    ])
    (bundle / "ASSEMBLY.md").write_text(md, encoding="utf-8")

    # -- MANIFEST.txt (short machine block, deploy.cmd types it) ----------
    manifest = [
        f"assembled: {now}",
        f"source-zip: {zip_path.name if zip_path else ''}",
        f"product-version: {version}",
        f"patches-applied: {len(included['patches'])}",
        *[f"  - {x.split('  ')[0]}" for x in included["patches"]],
        f"plugins: {len(included['plugins'])}",
        f"skills: {len(included['skills'])}",
        f"overlay-entries: {len(included['overlay'])}",
        f"skipped: " + (", ".join(
            f"{k}:{v}" for k in SECTIONS for v in skipped[k]) or "none"),
        "details: ASSEMBLY.md",
    ]
    (bundle / "MANIFEST.txt").write_text("\n".join(manifest) + "\n", encoding="utf-8")

    log("装配清单已生成：ASSEMBLY.md / MANIFEST.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
