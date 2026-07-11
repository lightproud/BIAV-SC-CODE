#!/usr/bin/env python3
"""kb_telemetry.py — 知识库使用遥测（北极星评判体系 #2，「追踪」的地基）。

守密人 2026-07-04「如何追踪评判知识库是否有效」→ 建议 #2：MCP 工具埋点。
给运行时 `kb_*` 工具装「借阅记录」——每次调用追一条 JSONL，随时间攒出**需求侧现实**：
哪些概念从没被导航到（死白盒重量·剪枝候选）、哪些查询总零命中（覆盖哨兵看不见的需求缺口）、
哪些 kb_activate 总死在稀疏邻域。**借阅记录比藏书目录更诚实地说明图书馆有没有用。**

设计取舍：
- **只在 MCP 消费边界埋点**（`mcp_server.py` 调 `log_call`），不在 `kb_navigator` 库层——
  故只记**真实消费**，不记测试/CLI 跑动。库层保持纯净、可测。
- 日志落 **git 内** `Public-Info-Pool/Record/kb-usage/{YYYY-MM-DD}.jsonl`（按日一文件，
  随会话正常提交入库，**跨会话累计**）。守密人 2026-07-11 裁定方案甲：云容器每会话全新
  克隆，原 gitignored `Rough/kb_usage.jsonl` 落点令借阅记录每会话归零——需求侧有效性、
  死概念剪枝、零命中回流三机制全部断粮，故迁 git-tracked 落点。路径唯一源即本模块
  `KB_USAGE_DIR`（写方读方同一常量）。
- `log_call` **best-effort**：任何异常吞掉，绝不因埋点失败拖垮工具本身。

用法：
  python3 scripts/kb_telemetry.py            # 打印使用报告（调用分布 / 死概念 / 零命中查询）
  python3 scripts/kb_telemetry.py --json      # 机读汇总
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# 借阅记录唯一落点（git-tracked，按日一文件，跨会话累计；2026-07-11 方案甲）。
# KB_USAGE_DIR 为运行时落点（tests/conftest.py 自动改道 tmp，守「只记真实消费」）；
# _DEFAULT 供纪律测试断言配置本身，不随改道变。
KB_USAGE_DIR_DEFAULT = REPO / "Public-Info-Pool" / "Record" / "kb-usage"
KB_USAGE_DIR = KB_USAGE_DIR_DEFAULT


def _log_files(p: Path) -> list[Path]:
    """把落点解析成待读文件列表：目录 → 全部按日 JSONL（排序）；单文件 → 自身。"""
    if p.is_dir():
        return sorted(p.glob("*.jsonl"))
    return [p] if p.exists() else []


def log_call(tool: str, query: str, result_ids: list[str] | None = None,
             log_path: Path | None = None) -> None:
    """追一条使用记录（best-effort，绝不抛出）。只该由 MCP 消费边界调用。"""
    try:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        ids = list(result_ids or [])
        rec = {
            "ts": now.isoformat(),
            "tool": tool,
            "query": (query or "")[:200],
            "n": len(ids),
            "top": ids[0] if ids else None,
            "ids": ids[:10],
        }
        p = log_path or (KB_USAGE_DIR / f"{now:%Y-%m-%d}.jsonl")
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass  # 埋点绝不拖垮工具


def _all_concept_ids() -> set[str]:
    idx = REPO / "okf" / "kb_index.json"
    if not idx.exists():
        return set()
    try:
        return set(json.loads(idx.read_text(encoding="utf-8")).get("concepts", {}))
    except (json.JSONDecodeError, OSError):
        return set()


def summarize(log_path: Path | None = None) -> dict:
    """读使用 JSONL（目录=全部按日文件聚合，或单文件），产出需求侧使用报告。"""
    p = log_path or KB_USAGE_DIR
    calls = []
    for f in _log_files(p):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                calls.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    by_tool = Counter(c.get("tool", "?") for c in calls)
    reach = Counter()
    zero_hit = Counter()
    for c in calls:
        for cid in c.get("ids", []):
            reach[cid] += 1
        if c.get("n", 0) == 0 and c.get("tool") in ("kb_search", "kb_activate"):
            zero_hit[c.get("query", "")] += 1

    all_ids = _all_concept_ids()
    reached = set(reach)
    dead = sorted(all_ids - reached) if all_ids else []
    return {
        "total_calls": len(calls),
        "by_tool": dict(by_tool.most_common()),
        "distinct_concepts_reached": len(reached),
        "total_concepts": len(all_ids),
        "reach_ratio": round(len(reached) / len(all_ids), 4) if all_ids else None,
        "top_reached": reach.most_common(15),
        "zero_hit_queries": zero_hit.most_common(20),
        "dead_concepts_count": len(dead),
        "dead_concepts_sample": dead[:20],
        "log_path": _display_path(p),
    }


def harvest_gaps(log_path: Path | None = None, min_count: int = 1) -> dict:
    """把遥测里的**零命中查询**回流成 held-out 难题候选（闭合评判 #1↔#2）。

    图驱动生成的黄金集（评判 #1）对 KB 是「送分题」（activate 顺边走必中），测的是覆盖与
    grep-gap 稳不稳、非刁难 KB。**真·held-out 难题**只能来自需求侧现实——用户真的问了、KB 却
    零命中的查询。本函数把这些查询抽成黄金题 stub（`expect` 待人工分诊填），供并入黄金集：
    生成集管「够多够全」，遥测回流管「够难够真」，两条腿缺一不可。"""
    rep = summarize(log_path)
    seen: set[str] = set()
    cands = []
    for q, n in rep["zero_hit_queries"]:
        q = (q or "").strip()
        if not q or n < min_count or q in seen:
            continue
        seen.add(q)
        cands.append({
            "q": q, "expect": [], "mode": "search",
            "capability": "held_out", "distinctive": True,
            "source": "telemetry_zero_hit", "seen": n, "needs_triage": True,
        })
    return {
        "candidates": cands,
        "count": len(cands),
        "note": ("真实需求缺口回流为 held-out 难题候选；expect 待人工分诊后并入黄金集。"
                 "与生成集互补：生成管够多够全、遥测管够难够真。"),
    }


def _display_path(p: Path) -> str:
    try:
        rel = str(p.relative_to(REPO))
    except ValueError:
        rel = str(p)
    return rel if _log_files(p) else f"{rel}（尚无记录）"


def _print_report(rep: dict) -> None:
    print("KB 使用遥测报告（借阅记录）")
    print(f"  总调用 = {rep['total_calls']}   触达概念 = {rep['distinct_concepts_reached']}"
          f"/{rep['total_concepts']}"
          + (f"（{rep['reach_ratio']:.0%}）" if rep['reach_ratio'] is not None else ""))
    print(f"  按工具：{rep['by_tool'] or '（暂无记录）'}")
    if rep["top_reached"]:
        print("  最常触达：")
        for cid, n in rep["top_reached"][:8]:
            print(f"    {n:4d}  {cid}")
    if rep["zero_hit_queries"]:
        print(f"  零命中查询（需求缺口，{len(rep['zero_hit_queries'])}）：")
        for q, n in rep["zero_hit_queries"][:8]:
            print(f"    {n:4d}  {q!r}")
    print(f"  死概念（从未被触达，{rep['dead_concepts_count']}/{rep['total_concepts']}）"
          + ("——剪枝/改进候选" if rep['dead_concepts_count'] else ""))
    print(f"  日志：{rep['log_path']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="知识库使用遥测报告")
    ap.add_argument("--json", action="store_true", help="输出机读汇总")
    ap.add_argument("--harvest", action="store_true",
                    help="把零命中查询回流成 held-out 难题候选（评判 #1↔#2 闭环）")
    args = ap.parse_args()
    if args.harvest:
        h = harvest_gaps()
        if args.json:
            print(json.dumps(h, ensure_ascii=False))
        else:
            print(f"零命中回流：{h['count']} 条 held-out 难题候选（expect 待分诊）")
            for c in h["candidates"][:20]:
                print(f"    ×{c['seen']:<3d} {c['q']!r}")
            print(f"  {h['note']}")
        return
    rep = summarize()
    if args.json:
        print(json.dumps(rep, ensure_ascii=False))
    else:
        _print_report(rep)


if __name__ == "__main__":
    main()
