#!/usr/bin/env python3
"""Silver Core 品牌换装补丁生成器（守密人 2026-08-02 需求 #1）。

定位：patches/ 里的品牌补丁**不手写**——本脚本持有替换规则与排除谓词，
对 upstream/ 快照的临时副本做确定性变换，产出可审计的统一 diff 落
`patches/silver-core-rebrand.patch`。移 pin 后重跑本脚本即重生成补丁，
不存在「手改补丁追上游」的维护深渊。

红线（与施工边界文书裁 10 / MIT 一致，机械守卫 tests/test_hermes_charter.py）：
- LICENSE / 版权行 / 上游 URL / HERMES_* 环境变量名 / X-Client-Name 遥测头
  / 配置键 / 路径（~/.hermes）一律不碰——只换「用户感知的显示名」，
  不抹来源事实。
- upstream/ 本体零修改：补丁只在部署组装期应用（见 deploy/README.md），
  vendor 快照与官方测试基线保持逐字节纯净。

用法：
  python3 deploy/rebrand.py            # 生成/刷新 patches/silver-core-rebrand.patch
  python3 deploy/rebrand.py --check    # 只校验现存补丁与规则输出一致（漂移守卫）
  python3 deploy/rebrand.py --apply DEST  # 对 DEST（upstream 的组装副本）就地应用变换
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUB = HERE.parent
UPSTREAM = SUB / "upstream"
PATCH_PATH = SUB / "patches" / "silver-core-rebrand.patch"

# 扫描范围：用户可感知的 runtime 面（白名单目录）。website/apps/docs 等
# 非部署面刻意不扫（残留清单见 BRANDING.md）。
RUNTIME_DIRS = ["agent", "hermes_cli", "gateway", "tools", "plugins", "ui-tui/src"]
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".sh", ".yaml", ".yml", ".json"}

# 特例规则（先于通用规则与跳线谓词，整句替换）：
# 兜底身份句——SOUL.md 缺席时的产品自述。品牌换 Silver Core；
# 「created by Nous Research」不保留在自述里（来源事实由 LICENSE 与
# 合规口径「基于 MIT 开源组件二次开发」承载，见文书裁 10）。
SPECIAL_RULES = [
    (
        "You are Hermes Agent, an intelligent AI assistant created by Nous Research. ",
        "You are Silver Core, an intelligent AI assistant. ",
    ),
]

# 跳线谓词：含以下片段的行不做任何替换（保 URL / 环境变量 / 遥测 / 版权）。
LINE_SKIP_MARKERS = [
    "http://", "https://", "HERMES_", "X-Client-Name",
    "Copyright", "copyright", "SPDX-License-Identifier",
]

# 通用规则（逐行、按序应用）。刻意不把裸词 "Hermes"/"hermes" 入规则——
# 那会波及模块名 / 路径 / 配置键（功能标识符），属 fork 级改动。
GENERIC_RULES = [
    ("Hermes Agent", "Silver Core"),
    ("Hermes profile", "Silver Core profile"),
    ("hermes-tui", "silver-core-tui"),
]

# 文件级排除：测试 / LICENSE / 锁文件 / 文档。
def _skip_file(rel: Path) -> bool:
    s = rel.as_posix()
    name = rel.name
    if "LICENSE" in name or name.endswith((".md", ".lock", ".min.js")):
        return True
    if "/tests/" in f"/{s}" or name.startswith("test_") or name.endswith("_test.py"):
        return True
    return rel.suffix not in TEXT_SUFFIXES


def transform_text(text: str) -> str:
    for old, new in SPECIAL_RULES:
        text = text.replace(old, new)
    out_lines = []
    for line in text.splitlines(keepends=True):
        if any(m in line for m in LINE_SKIP_MARKERS):
            out_lines.append(line)
            continue
        for old, new in GENERIC_RULES:
            line = line.replace(old, new)
        out_lines.append(line)
    return "".join(out_lines)


def apply_tree(root: Path) -> int:
    """对 root（upstream 布局的副本）就地应用变换，返回改动文件数。"""
    changed = 0
    for d in RUNTIME_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root)
            if _skip_file(rel):
                continue
            try:
                text = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            new = transform_text(text)
            if new != text:
                p.write_text(new, encoding="utf-8")
                changed += 1
    return changed


def generate_patch() -> str:
    """在临时 git 仓里做变换，产出相对 upstream 根的统一 diff。"""
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "w"
        shutil.copytree(UPSTREAM, work, symlinks=False,
                        ignore=shutil.ignore_patterns(".venv", "__pycache__"))
        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run(["git", "-C", str(work), *args],
                                  capture_output=True, text=True, check=True)
        run("init", "-q")
        run("config", "user.email", "rebrand@silver-core.local")
        run("config", "user.name", "rebrand")
        run("add", "-A")
        run("commit", "-qm", "pristine")
        n = apply_tree(work)
        diff = run("diff").stdout
        print(f"transformed files: {n}", file=sys.stderr)
        return diff


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", metavar="DEST")
    args = ap.parse_args()

    if args.apply:
        n = apply_tree(Path(args.apply).resolve())
        print(f"applied rebrand to {args.apply}: {n} files changed")
        return 0

    diff = generate_patch()
    if args.check:
        current = PATCH_PATH.read_text(encoding="utf-8") if PATCH_PATH.exists() else ""
        if current != diff:
            print("DRIFT: patches/silver-core-rebrand.patch 与规则输出不一致，"
                  "跑 python3 deploy/rebrand.py 重生成", file=sys.stderr)
            return 1
        print("patch is in sync with rules")
        return 0
    PATCH_PATH.write_text(diff, encoding="utf-8")
    print(f"wrote {PATCH_PATH} ({len(diff.splitlines())} diff lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
