#!/usr/bin/env python3
"""
deliverable_path.py — 银芯产物路径生成器 / 注册表守卫

为何存在：产物路径「每次会话各编一套」会发散(分隔符/日期格式/版本后缀漂移)。
本脚本让路径由代码确定性算出、由开放注册表挡住类型同义分裂，
把「弱约定(文档)」升级为「强约束(脚本)」。

落点规则(强约定)：
    Public-Info-Pool/Resource/{类型}/{主题}-{YYYYMMDD}[-rN].{ext}
  - 类型: 受控开放词表(types.json)，形式定死(kebab-case)、清单可增、新类型须显式登记
  - 主题: kebab-case；「全量/精简」等变体进主题段，不做随手后缀
  - 日期: YYYYMMDD(或区间 YYYYMMDD-DD)；时间维度在文件名，不再建月目录
  - 修订: 仅允许 -rN(r2/r3...)；同产物同日重跑默认覆盖，留版本才升 -rN

子命令：
    path     生成并校验一条 Resource 路径
    register 登记一个新类型(near-match 提示防同义分裂)
    list     列出已登记类型
    promote  把 Rough/ 草稿晋升进 Resource/(按命名规整 + 登记)
    rename-type  类型改名(移目录 + 更新注册表)，provisional 暂定名回头可改

用法示例：
    python scripts/deliverable_path.py path --type daily-news --topic morimens-daily --date 20260601
    python scripts/deliverable_path.py path --type daily-news --topic morimens-daily --date 20260601 --rev 2 --ext pdf
    python scripts/deliverable_path.py register --type wiki-build --desc "wiki 站点构建产物"
    python scripts/deliverable_path.py promote Public-Info-Pool/Rough/draft.md --type community-analysis --topic foo --date 20260621
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
POOL = REPO_ROOT / "Public-Info-Pool"
RESOURCE = POOL / "Resource"
ROUGH = POOL / "Rough"
REGISTRY = POOL / "types.json"

# 形式定死：全小写 kebab-case，仅 [a-z0-9-]，不以连字符起止
KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# 日期：YYYYMMDD 或区间 YYYYMMDD-DD/-MMDD；亦容许 YYYYMM 月精度(历史/月度产物)
DATE_RE = re.compile(r"^\d{6}(?:\d{2})?(?:-\d{2,8})?$")


def _load_registry() -> dict:
    if not REGISTRY.exists():
        die(f"注册表不存在: {REGISTRY}")
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def _save_registry(data: dict) -> None:
    REGISTRY.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def die(msg: str) -> None:
    print(f"[deliverable_path] 拒绝: {msg}", file=sys.stderr)
    sys.exit(1)


def check_form(label: str, value: str) -> None:
    if not KEBAB.match(value):
        die(f"{label} 形式不合规 '{value}'：须全小写 kebab-case(仅 a-z 0-9 连字符)。")


def known_types(reg: dict) -> dict:
    return reg.get("types", {})


def cmd_path(args) -> None:
    reg = _load_registry()
    types = known_types(reg)
    t = args.type
    check_form("类型", t)
    if t not in types:
        near = difflib.get_close_matches(t, list(types), n=3, cutoff=0.5)
        hint = f" 是否想用已登记的 {near}?" if near else ""
        die(
            f"类型 '{t}' 未登记，不静默放行(防同义分裂)。{hint}\n"
            f"  确属新类型请先: deliverable_path.py register --type {t} --desc '<一句话>'"
        )
    check_form("主题", args.topic)
    if not DATE_RE.match(args.date):
        die(f"日期 '{args.date}' 形式不合规：须 YYYYMMDD 或区间 YYYYMMDD-DD。")
    ext = args.ext.lstrip(".")
    rev = f"-r{args.rev}" if args.rev and int(args.rev) > 1 else ""
    name = f"{args.topic}-{args.date}{rev}.{ext}"
    rel = Path("Public-Info-Pool/Resource") / t / name
    print(rel.as_posix())


def cmd_register(args) -> None:
    reg = _load_registry()
    types = known_types(reg)
    t = args.type
    check_form("类型", t)
    if t in types:
        die(f"类型 '{t}' 已存在。")
    near = difflib.get_close_matches(t, list(types), n=3, cutoff=0.6)
    if near and not args.force:
        die(
            f"'{t}' 与已有类型高度相似 {near}，疑似同义分裂。\n"
            f"  确认要新增请加 --force；或改用已有类型。"
        )
    types[t] = {"desc": args.desc or "", "status": "provisional"}
    reg["types"] = dict(sorted(types.items()))
    _save_registry(reg)
    (RESOURCE / t).mkdir(parents=True, exist_ok=True)
    print(f"已登记类型 '{t}' 并建目录 Public-Info-Pool/Resource/{t}/")


def cmd_list(args) -> None:
    reg = _load_registry()
    for name, meta in sorted(known_types(reg).items()):
        print(f"{name:24} [{meta.get('status','?')}] {meta.get('desc','')}")


def cmd_promote(args) -> None:
    src = Path(args.src)
    if not src.exists():
        die(f"草稿不存在: {src}")
    reg = _load_registry()
    if args.type not in known_types(reg):
        die(f"类型 '{args.type}' 未登记，先 register。")
    check_form("主题", args.topic)
    if not DATE_RE.match(args.date):
        die(f"日期 '{args.date}' 形式不合规。")
    ext = (args.ext or src.suffix.lstrip(".")) or "md"
    rev = f"-r{args.rev}" if args.rev and int(args.rev) > 1 else ""
    dst = RESOURCE / args.type / f"{args.topic}-{args.date}{rev}.{ext}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    print(f"晋升: {src} -> {dst.relative_to(REPO_ROOT).as_posix()}")


def cmd_rename_type(args) -> None:
    reg = _load_registry()
    types = known_types(reg)
    old, new = args.old, args.new
    if old not in types:
        die(f"类型 '{old}' 未登记。")
    check_form("新类型", new)
    if new in types:
        die(f"目标类型 '{new}' 已存在。")
    old_dir, new_dir = RESOURCE / old, RESOURCE / new
    if old_dir.exists():
        old_dir.rename(new_dir)
    types[new] = types.pop(old)
    reg["types"] = dict(sorted(types.items()))
    _save_registry(reg)
    print(f"类型改名: {old} -> {new}（目录 + 注册表已同步）")


def main() -> None:
    ap = argparse.ArgumentParser(description="银芯产物路径生成器 / 注册表守卫")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("path", help="生成并校验 Resource 路径")
    p.add_argument("--type", required=True)
    p.add_argument("--topic", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--rev", default="")
    p.add_argument("--ext", default="md")
    p.set_defaults(func=cmd_path)

    p = sub.add_parser("register", help="登记新类型")
    p.add_argument("--type", required=True)
    p.add_argument("--desc", default="")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_register)

    p = sub.add_parser("list", help="列出已登记类型")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("promote", help="Rough 草稿晋升进 Resource")
    p.add_argument("src")
    p.add_argument("--type", required=True)
    p.add_argument("--topic", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--rev", default="")
    p.add_argument("--ext", default="")
    p.set_defaults(func=cmd_promote)

    p = sub.add_parser("rename-type", help="类型改名(移目录+更新注册表)")
    p.add_argument("old")
    p.add_argument("new")
    p.set_defaults(func=cmd_rename_type)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
