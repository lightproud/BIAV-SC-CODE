"""
context_manager.py — Virtual Context Manager (MemGPT-style)

Dynamically recommends which knowledge files to load based on
the current conversation topic, session role, and memory utility.

Unlike static file loading, this adapts to what the user is actually
talking about — like MemGPT's virtual memory paging for AI context.

Usage:
  python scripts/context_manager.py "用户的第一句话"
  python scripts/context_manager.py "话题" --role Code-wiki
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

# Role-based default file priorities
ROLE_DEFAULTS = {
    "Code-wiki": [
        "projects/wiki/CONTEXT.md",
        "memory/task-wiki-data-audit-2026-04.md",
        "memory/morimens-context.md",
    ],
    "Code-news": [
        "projects/news/CONTEXT.md",
        "memory/discord-archiver-design.md",
    ],
    "Code-site": [
        "projects/site/CONTEXT.md",
        "memory/style-guide.md",
    ],
    "Code-game": [
        "projects/game/CONTEXT.md",
        "memory/morimens-context.md",
    ],
    "Code-主控台": [
        "memory/project-status.md",
        "memory/strategic-assessment.md",
        "memory/pending-discussions.md",
    ],
}

# Files that should always be available (already loaded via BIAV-SC.md)
ALWAYS_LOADED = {"BIAV-SC.md"}


def recommend_context(
    query: str,
    role: str = "",
    max_files: int = 5,
) -> dict:
    """Recommend knowledge files to load based on topic + role.

    Combines:
    1. Role-based defaults (if role specified)
    2. Semantic search results (vector + reranker)
    3. Knowledge graph related files
    4. MemRL utility scores for tiebreaking

    Returns {
        query, role,
        recommended_files: [{file, score, reason}],
        context_summary: str,
    }
    """
    candidates = {}  # file → {score, reasons}

    # Layer 1: Role defaults
    if role:
        normalized_role = role.strip()
        for key, files in ROLE_DEFAULTS.items():
            if key.lower() in normalized_role.lower() or normalized_role.lower() in key.lower():
                for f in files:
                    if (REPO / f).exists():
                        candidates[f] = {"score": 0.8, "reasons": ["role_default"]}
                break

    # Layer 2: Semantic search
    try:
        from memory_search import search
        results = search(query, top_k=max_files * 2, use_reranker=True)
        for r in results:
            fp = r["file"]
            score = r.get("final_score", r.get("score", 0))
            if fp in candidates:
                candidates[fp]["score"] = max(candidates[fp]["score"], score)
                candidates[fp]["reasons"].append("semantic_match")
            else:
                candidates[fp] = {"score": score, "reasons": ["semantic_match"]}
    except Exception:
        pass

    # Layer 3: Knowledge graph
    try:
        from knowledge_graph import load_graph, find_related_files
        graph = load_graph()
        if graph:
            related = find_related_files(graph, query, max_depth=2)
            for r in related[:max_files]:
                fp = r["file"]
                # Convert distance to score: 1 hop → 0.7, 2 hops → 0.4
                graph_score = 0.7 if r["distance"] == 1 else 0.4
                if fp in candidates:
                    candidates[fp]["score"] = max(candidates[fp]["score"], graph_score)
                    candidates[fp]["reasons"].append("graph_related")
                else:
                    candidates[fp] = {"score": graph_score, "reasons": ["graph_related"]}
    except Exception:
        pass

    # Layer 4: MemRL utility boost
    try:
        utility_file = REPO / "assets" / "data" / "memory-utility.json"
        if utility_file.exists():
            utility = json.loads(utility_file.read_text(encoding="utf-8"))
            for fp in candidates:
                u = utility.get(fp, {}).get("utility", 0.5)
                # Small boost for high-utility files
                candidates[fp]["score"] += (u - 0.5) * 0.2
    except Exception:
        pass

    # Remove always-loaded files
    for f in ALWAYS_LOADED:
        candidates.pop(f, None)

    # Sort and select top-N
    sorted_candidates = sorted(
        candidates.items(),
        key=lambda x: x[1]["score"],
        reverse=True,
    )[:max_files]

    recommended = []
    for fp, data in sorted_candidates:
        recommended.append({
            "file": fp,
            "score": round(data["score"], 3),
            "reason": "+".join(data["reasons"]),
        })

    # Generate summary
    file_list = [r["file"] for r in recommended]
    summary = f"建议加载 {len(recommended)} 个文件"
    if role:
        summary += f"（角色：{role}）"
    summary += f"：{', '.join(Path(f).stem for f in file_list[:3])}"
    if len(file_list) > 3:
        summary += f" 等"

    return {
        "query": query,
        "role": role,
        "recommended_files": recommended,
        "context_summary": summary,
    }


def session_context_plan(role: str) -> dict:
    """Generate a full context loading plan for a new session.

    Returns the files to load in order, with priorities.
    """
    # Start with role defaults
    plan = {"role": role, "phases": []}

    # Phase 1: Always load
    plan["phases"].append({
        "phase": "always",
        "files": ["BIAV-SC.md", "memory/project-status.md"],
        "reason": "核心配置 + 项目状态",
    })

    # Phase 2: Role-specific
    role_files = []
    normalized_role = role.strip()
    for key, files in ROLE_DEFAULTS.items():
        if key.lower() in normalized_role.lower() or normalized_role.lower() in key.lower():
            role_files = [f for f in files if (REPO / f).exists()]
            break

    if role_files:
        plan["phases"].append({
            "phase": "role",
            "files": role_files,
            "reason": f"{role} 角色所需知识",
        })

    # Phase 3: On-demand (loaded when topic emerges)
    plan["phases"].append({
        "phase": "on_demand",
        "files": [],
        "reason": "根据对话话题动态加载（调用 recommend_context）",
    })

    return plan


# ============================================================
# CLI
# ============================================================

def main():
    args = sys.argv[1:]
    role = ""
    if "--role" in args:
        idx = args.index("--role")
        if idx + 1 < len(args):
            role = args[idx + 1]
        args = [a for a in args if a != "--role" and a != role]

    query = " ".join(args) if args else None

    if query:
        result = recommend_context(query, role=role)
        print(f"\n  🧠 上下文推荐 — 「{query}」")
        if role:
            print(f"     角色：{role}")
        print(f"     {result['context_summary']}\n")
        for r in result["recommended_files"]:
            print(f"  [{r['score']:.3f}] {r['file']}")
            print(f"         原因：{r['reason']}")
        print()
    else:
        print("用法:")
        print('  python scripts/context_manager.py "话题"')
        print('  python scripts/context_manager.py "话题" --role Code-wiki')


if __name__ == "__main__":
    main()
