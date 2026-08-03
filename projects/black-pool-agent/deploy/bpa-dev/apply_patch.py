#!/usr/bin/env python3
"""统一 diff 补丁应用器（bpa-dev 组装件，纯标准库零依赖）。

存在理由：内网组装机不保证有 git，而便携包自带 CPython——本器用包内 Python
即可把 `git diff` 格式的补丁打进源树。刻意**响亮失败**：上下文对不上就整张
补丁拒绝并报出行号，绝不静默错打（组装期错打 = 部署期离奇故障）。

支持子集（覆盖内网 Python 面补丁的全部常规形态）：
- 修改现有文件（@@ hunk，上下文精确匹配，允许 ±50 行漂移搜索）
- 新建文件（--- /dev/null）与删除文件（+++ /dev/null）
- CRLF/LF 容差：匹配时行尾归一化，写回沿用目标文件的主导行尾

用法：python apply_patch.py --root <源树根> <补丁文件> [补丁文件...]
      --check 只校验可应用性，不落盘
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SEARCH_WINDOW = 50  # hunk 起点允许的上下漂移行数


class PatchError(Exception):
    pass


def _norm(line: str) -> str:
    return line.rstrip("\n").rstrip("\r")


def _detect_eol(lines: list[str]) -> str:
    crlf = sum(1 for l in lines if l.endswith("\r\n"))
    return "\r\n" if crlf > len(lines) / 2 else "\n"


class FilePatch:
    def __init__(self) -> None:
        self.old_path: str | None = None
        self.new_path: str | None = None
        self.hunks: list[tuple[int, list[str], list[str]]] = []  # (old_start, old_block, new_block)


def parse(patch_text: str) -> list[FilePatch]:
    files: list[FilePatch] = []
    cur: FilePatch | None = None
    lines = patch_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("diff --git "):
            cur = FilePatch()
            files.append(cur)
        elif line.startswith("--- "):
            if cur is None:
                cur = FilePatch()
                files.append(cur)
            arg = line[4:].split("\t")[0].strip()
            cur.old_path = None if arg == "/dev/null" else arg[2:] if arg.startswith(("a/", "b/")) else arg
        elif line.startswith("+++ ") and cur is not None:
            arg = line[4:].split("\t")[0].strip()
            cur.new_path = None if arg == "/dev/null" else arg[2:] if arg.startswith(("a/", "b/")) else arg
        elif line.startswith("@@ ") and cur is not None:
            head = line.split("@@")[1].strip()          # "-l,s +l,s"
            old_start = int(head.split(" ")[0].lstrip("-").split(",")[0])
            i += 1
            old_block: list[str] = []
            new_block: list[str] = []
            while i < len(lines):
                l = lines[i]
                if l.startswith("\\ No newline"):
                    i += 1
                    continue
                if l.startswith(("diff --git ", "--- ", "@@ ")) or (
                    l.startswith("+++ ") and not l.startswith("+++++")
                ):
                    break
                if l.startswith("+"):
                    new_block.append(l[1:])
                elif l.startswith("-"):
                    old_block.append(l[1:])
                elif l.startswith(" ") or l == "":
                    old_block.append(l[1:] if l else "")
                    new_block.append(l[1:] if l else "")
                else:
                    break
                i += 1
            cur.hunks.append((old_start, old_block, new_block))
            continue
        i += 1
    return [f for f in files if f.hunks or f.old_path is None or f.new_path is None]


def _find_anchor(target: list[str], block: list[str], want: int) -> int:
    """在 want（0 基）附近搜索 block 的精确匹配位置，找不到抛错。"""
    n, m = len(target), len(block)
    normed = [_norm(l) for l in target]
    nb = [_norm(l) for l in block]

    def match_at(pos: int) -> bool:
        return pos >= 0 and pos + m <= n and normed[pos:pos + m] == nb

    if match_at(want):
        return want
    for off in range(1, SEARCH_WINDOW + 1):
        if match_at(want - off):
            return want - off
        if match_at(want + off):
            return want + off
    raise PatchError(f"上下文匹配失败（期望第 {want + 1} 行附近，含 ±{SEARCH_WINDOW} 行搜索）")


def apply_file(root: Path, fp: FilePatch, check_only: bool) -> str:
    if fp.old_path is None:                      # 新建
        dest = root / fp.new_path
        if dest.exists():
            raise PatchError(f"新建目标已存在: {fp.new_path}")
        content = "\n".join(fp.hunks[0][2]) + "\n" if fp.hunks else ""
        if not check_only:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("w", encoding="utf-8", newline="") as fh:
                fh.write(content)
        return f"A {fp.new_path}"
    if fp.new_path is None:                      # 删除
        dest = root / fp.old_path
        if not dest.is_file():
            raise PatchError(f"删除目标不存在: {fp.old_path}")
        if not check_only:
            dest.unlink()
        return f"D {fp.old_path}"

    dest = root / fp.old_path                    # 修改
    if not dest.is_file():
        raise PatchError(f"修改目标不存在: {fp.old_path}")
    with dest.open(encoding="utf-8", newline="") as fh:
        raw = fh.read()
    lines = raw.splitlines(keepends=True)
    eol = _detect_eol(lines) if lines else "\n"
    body = [_norm(l) for l in lines]
    drift = 0
    for old_start, old_block, new_block in fp.hunks:
        want = old_start - 1 + drift
        pos = _find_anchor(lines, old_block, want)
        body[pos:pos + len(old_block)] = [_norm(l) for l in new_block]
        lines = [l + "\n" for l in body]         # 归一化中间态供下一 hunk 匹配
        drift += (pos - (old_start - 1)) + (len(new_block) - len(old_block))
    out = eol.join(body)
    if raw.endswith(("\n", "\r\n")) or not body:
        out += eol
    if not check_only:
        with dest.open("w", encoding="utf-8", newline="") as fh:
            fh.write(out)
    return f"M {fp.old_path}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("patches", nargs="+")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"✗ 源树根不存在: {root}", file=sys.stderr)
        return 2
    for name in args.patches:
        p = Path(name)
        try:
            files = parse(p.read_text(encoding="utf-8"))
            if not files:
                raise PatchError("补丁内容为空或无法解析")
            for fp in files:                     # 先全量 check 再落盘：半张补丁绝不落
                apply_file(root, fp, check_only=True)
            results = [apply_file(root, fp, check_only=args.check) for fp in files]
            verb = "check" if args.check else "applied"
            print(f"[{verb}] {p.name}: " + ", ".join(results))
        except (PatchError, OSError, ValueError) as e:
            print(f"✗ {p.name}: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
