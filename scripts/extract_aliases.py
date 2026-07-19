#!/usr/bin/env python3
"""extract_aliases.py — 厚锚别名生成期工作面（AI 自动识别的落表 CLI）。

§八 8.2 节 6：别名由 **生成期** AI 会话抽取（一次 subagent / 会话跑，非运行时黑盒）,
人零维护、只留近零成本最终否决。本 CLI 是那个生成期动作的工具面——AI 会话用它
核证据、落条目、确认 / 撤回；运行时消费只走 ``silver_aliases``（import-only）。

三墙在此落地：
  - ``add``     必须带 provenance（source/ref/quote/inferred_by），**严禁伪造**——
                quote 须是社区档案真实原文（用 ``grep-evidence`` 先核）；默认落
                ``confirmed=false``（未确认压权重）。
  - ``confirm`` / ``revoke``  确认态翻转 / 单条撤回（revoke 直接删条）。
  - ``harvest`` 读消费失败喂料（kb_anchor 锚不到时自动写入 gitignored
                ``Public-Info-Pool/Rough/alias_gaps.jsonl``），列零锚查询作新候选。

用法：
    python3 scripts/extract_aliases.py grep-evidence 融朵          # 档案核证据
    python3 scripts/extract_aliases.py add --concept-id 15602 --alias 融朵 \\
        --source bilibili --ref <归档文件> --quote <真实原文> --inferred-by <会话标识>
    python3 scripts/extract_aliases.py confirm 融朵
    python3 scripts/extract_aliases.py revoke 融朵
    python3 scripts/extract_aliases.py list
    python3 scripts/extract_aliases.py harvest
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "projects" / "news" / "scripts"))

import silver_aliases  # noqa: E402
import archive_layout  # noqa: E402  分仓桥接：社区数据根 SSOT

COMMUNITY = archive_layout.community_root()  # 分仓桥接：env BIAV_SC_DATA_ROOT 或在树默认
GAPS_PATH = REPO / "Public-Info-Pool" / "Rough" / "alias_gaps.jsonl"
CHARACTERS = REPO / "projects" / "wiki" / "data" / "processed" / "characters.json"


def _read_table() -> dict:
    p = silver_aliases.ALIASES_PATH
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"_meta": {"description": "厚锚别名侧表", "version": 1}, "aliases": []}


def _write_table(data: dict) -> None:
    p = silver_aliases.ALIASES_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                 encoding="utf-8")
    silver_aliases.cache_clear()


def _known_concept_ids() -> set[str]:
    try:
        chars = json.loads(CHARACTERS.read_text(encoding="utf-8")).get("characters", [])
        return {str(c.get("id")) for c in chars}
    except (OSError, ValueError):
        return set()


def cmd_grep_evidence(term: str, limit: int = 10) -> int:
    """在社区全量档案里核证据：打印真实 quote + 档案定位（provenance 素材）。"""
    try:
        out = subprocess.run(
            ["grep", "-rn", "-m", "1", term, str(COMMUNITY)],
            capture_output=True, text=True, timeout=300,
        ).stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"[extract_aliases] grep 失败：{e}", file=sys.stderr)
        return 1
    lines = out.splitlines()[:limit]
    if not lines:
        print(f"[extract_aliases] 档案零命中：{term!r}（证据不存在 → 不得落表）")
        return 1
    for ln in lines:
        print(ln[:400])
    print(f"\n[extract_aliases] 命中 {len(lines)} 处（上限 {limit}）——据此填 --ref/--quote，严禁伪造")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    known = _known_concept_ids()
    if known and args.concept_id not in known:
        print(f"[extract_aliases] 拒绝：concept_id {args.concept_id} 不在 characters.json 基线内",
              file=sys.stderr)
        return 1
    data = _read_table()
    for r in data["aliases"]:
        if r.get("alias") == args.alias and str(r.get("concept_id")) == args.concept_id:
            print(f"[extract_aliases] 已存在：{args.alias} → {args.concept_id}（幂等跳过）")
            return 0
    data["aliases"].append({
        "concept_id": args.concept_id,
        "alias": args.alias,
        "provenance": {
            "source": args.source,
            "ref": args.ref,
            "quote": args.quote,
            "inferred_by": args.inferred_by,
        },
        "confirmed": False,  # 三墙：新条目一律未确认（压权重），确认走 confirm
        "added": date.today().isoformat(),
    })
    _write_table(data)
    print(f"[extract_aliases] 已落表（未确认）：{args.alias} → {args.concept_id}")
    return 0


def _flip(alias: str, remove: bool) -> int:
    data = _read_table()
    rows = data["aliases"]
    hit = [r for r in rows if r.get("alias") == alias]
    if not hit:
        print(f"[extract_aliases] 未找到别名：{alias}", file=sys.stderr)
        return 1
    if remove:
        data["aliases"] = [r for r in rows if r.get("alias") != alias]
        _write_table(data)
        print(f"[extract_aliases] 已撤回（删条）：{alias} × {len(hit)}")
    else:
        for r in hit:
            r["confirmed"] = True
        _write_table(data)
        print(f"[extract_aliases] 已确认：{alias} × {len(hit)}（进 domain_dict / mention 边需重建 bundle）")
    return 0


def cmd_list() -> int:
    rows = silver_aliases.load()
    if not rows:
        print("[extract_aliases] 侧表为空")
        return 0
    for r in rows:
        state = "已确认" if r.get("confirmed") else "未确认"
        prov = r.get("provenance", {})
        print(f"{state}  {r['alias']} → {r['concept_id']}  [{prov.get('source', '?')}] {prov.get('ref', '')}")
    print(f"\n共 {len(rows)} 条（已确认 {sum(1 for r in rows if r.get('confirmed'))}）")
    return 0


def feed_gap(query: str) -> None:
    """消费失败喂料（§8.4 锚不到 → 自动成为新别名候选）。best-effort，绝不抛。

    由 ``kb_anchor.anchor_expand`` 在零锚时调用；落 gitignored Rough/，harvest 收割。
    """
    try:
        GAPS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with GAPS_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"query": query, "added": date.today().isoformat()},
                                ensure_ascii=False) + "\n")
    except Exception:
        pass


def cmd_harvest() -> int:
    if not GAPS_PATH.exists():
        print("[extract_aliases] 无消费失败喂料（alias_gaps.jsonl 不存在）")
        return 0
    seen: dict[str, int] = {}
    for ln in GAPS_PATH.read_text(encoding="utf-8").splitlines():
        try:
            q = json.loads(ln).get("query", "").strip()
        except ValueError:
            continue
        if q:
            seen[q] = seen.get(q, 0) + 1
    for q, n in sorted(seen.items(), key=lambda kv: -kv[1]):
        print(f"{n:4d}  {q}")
    print(f"\n[extract_aliases] {len(seen)} 个零锚查询候选——逐个 grep-evidence 核证据后 add")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="厚锚别名生成期工作面（核证据 / 落表 / 确认 / 撤回 / 收割）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("grep-evidence", help="社区档案核证据（provenance 素材）")
    g.add_argument("term")
    g.add_argument("--limit", type=int, default=10)

    a = sub.add_parser("add", help="落一条候选（默认未确认）")
    a.add_argument("--concept-id", required=True)
    a.add_argument("--alias", required=True)
    a.add_argument("--source", required=True)
    a.add_argument("--ref", required=True)
    a.add_argument("--quote", required=True, help="社区档案真实原文（先 grep-evidence 核）")
    a.add_argument("--inferred-by", required=True)

    c = sub.add_parser("confirm", help="确认别名（翻 confirmed=true）")
    c.add_argument("alias")
    r = sub.add_parser("revoke", help="撤回别名（删条）")
    r.add_argument("alias")

    sub.add_parser("list", help="列全表")
    sub.add_parser("harvest", help="收割消费失败喂料（零锚查询候选）")

    args = ap.parse_args()
    if args.cmd == "grep-evidence":
        return cmd_grep_evidence(args.term, args.limit)
    if args.cmd == "add":
        return cmd_add(args)
    if args.cmd == "confirm":
        return _flip(args.alias, remove=False)
    if args.cmd == "revoke":
        return _flip(args.alias, remove=True)
    if args.cmd == "list":
        return cmd_list()
    if args.cmd == "harvest":
        return cmd_harvest()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
