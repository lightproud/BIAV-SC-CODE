"""
memory_writeback.py — Long-term Memory Write-back Loop

Detects what changed during a Claude Code session (via git diff),
extracts new knowledge facts, and writes them back to:
  1. Knowledge graph (new nodes/edges)
  2. Session digest (compact summary of what happened)
  3. Triggers incremental reindex of affected files

Inspired by Mem0 fact extraction + Zep Graphiti episode processing.

Usage:
  python scripts/memory_writeback.py                    # Auto-detect changes
  python scripts/memory_writeback.py --verbose          # Detailed output
  python scripts/memory_writeback.py --dry-run          # Show what would be written
"""

import json
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DREAMS_DIR = REPO / "memory" / "dreams"
DIGESTS_DIR = REPO / "memory" / "session-digests"
GRAPH_FILE = REPO / "assets" / "data" / "knowledge-graph.json"
VECTOR_INDEX = REPO / "assets" / "data" / "vectors.json.gz"

TODAY = date.today()
VERBOSE = "--verbose" in sys.argv
DRY_RUN = "--dry-run" in sys.argv

# File patterns worth tracking for knowledge extraction
KNOWLEDGE_DIRS = {"memory/", "assets/lore/", "assets/design/", "projects/"}
IGNORE_PATTERNS = {".pyc", "__pycache__", "node_modules", ".git", "dist/", "build/"}


def log(msg: str):
    if VERBOSE:
        print(msg)


# ============================================================
# Git change detection
# ============================================================


def get_session_changes() -> dict:
    """Detect files changed since last session (uncommitted + recent commits)."""
    changes = {
        "modified": [],
        "added": [],
        "deleted": [],
        "commits": [],
    }

    # Uncommitted changes
    try:
        result = subprocess.run(
            ["git", "diff", "--name-status", "HEAD"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        for line in result.stdout.strip().splitlines():
            if not line:
                continue
            parts = line.split("\t", 1)
            if len(parts) < 2:
                continue
            status, filepath = parts[0], parts[1]
            if any(p in filepath for p in IGNORE_PATTERNS):
                continue
            if status.startswith("M"):
                changes["modified"].append(filepath)
            elif status.startswith("A"):
                changes["added"].append(filepath)
            elif status.startswith("D"):
                changes["deleted"].append(filepath)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    # Recent commits (last 3 from today)
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "--since=midnight", "-10"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        for line in result.stdout.strip().splitlines():
            if line.strip():
                changes["commits"].append(line.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    # Files from today's commits
    try:
        result = subprocess.run(
            ["git", "log", "--since=midnight", "--name-only", "--pretty=format:", "HEAD"],
            capture_output=True, text=True, cwd=str(REPO), timeout=10,
        )
        for filepath in result.stdout.strip().splitlines():
            filepath = filepath.strip()
            if filepath and filepath not in changes["modified"] and filepath not in changes["added"]:
                if not any(p in filepath for p in IGNORE_PATTERNS):
                    changes["modified"].append(filepath)
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.CalledProcessError):
        pass

    return changes


# ============================================================
# Fact extraction from changed files
# ============================================================


def extract_facts_from_file(filepath: str) -> list[dict]:
    """Extract knowledge facts from a changed file."""
    full_path = REPO / filepath
    if not full_path.exists() or not full_path.is_file():
        return []

    ext = full_path.suffix.lower()
    if ext not in {".md", ".json", ".py", ".ts", ".tsx", ".yaml", ".yml", ".txt"}:
        return []

    facts = []

    try:
        content = full_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []

    # Extract facts based on file location and type
    if filepath.startswith("memory/"):
        facts.extend(_extract_from_memory(filepath, content))
    elif filepath.startswith("projects/"):
        facts.extend(_extract_from_project(filepath, content))
    elif filepath.startswith("scripts/"):
        facts.extend(_extract_from_script(filepath, content))

    return facts


def _extract_from_memory(filepath: str, content: str) -> list[dict]:
    """Extract facts from memory files (decisions, lessons, etc.)."""
    facts = []
    name = Path(filepath).stem

    if "decisions" in name:
        # Extract recent decisions
        for line in content.splitlines():
            if line.startswith("|") and "2026-" in line:
                cells = [c.strip() for c in line.split("|")[1:-1]]
                for cell in cells:
                    if len(cell) > 15 and not re.match(r"^\d{4}-", cell):
                        facts.append({
                            "type": "Decision",
                            "content": cell[:200],
                            "source": filepath,
                            "confidence": 0.9,
                        })
                        break

    elif "lessons" in name:
        # Extract lessons (## N. title format)
        for match in re.finditer(r"## \d+\.\s+(.+?)(?=\n## |\n---|\Z)", content, re.DOTALL):
            title_line = match.group(1).split("\n")[0].strip()
            facts.append({
                "type": "Concept",
                "content": title_line[:200],
                "source": filepath,
                "confidence": 0.85,
            })

    return facts


def _extract_from_project(filepath: str, content: str) -> list[dict]:
    """Extract facts from project files."""
    facts = []

    # Track new components and modules
    if filepath.endswith((".tsx", ".ts")):
        # Extract component/function names
        for match in re.finditer(r"(?:export\s+(?:default\s+)?function|const)\s+(\w+)", content):
            name = match.group(1)
            if len(name) > 3 and name[0].isupper():
                facts.append({
                    "type": "System",
                    "content": f"Component: {name} in {filepath}",
                    "source": filepath,
                    "confidence": 0.7,
                })

    elif filepath.endswith(".py"):
        # Extract class/function definitions
        for match in re.finditer(r"(?:class|def)\s+(\w+)", content):
            name = match.group(1)
            if not name.startswith("_") and len(name) > 3:
                facts.append({
                    "type": "System",
                    "content": f"Module: {name} in {filepath}",
                    "source": filepath,
                    "confidence": 0.7,
                })

    return facts


def _extract_from_script(filepath: str, content: str) -> list[dict]:
    """Extract facts from scripts (system capabilities)."""
    facts = []
    name = Path(filepath).stem

    # Docstring extraction
    match = re.search(r'"""(.+?)"""', content, re.DOTALL)
    if match:
        docstring = match.group(1).strip().split("\n")[0]
        facts.append({
            "type": "System",
            "content": f"Script {name}: {docstring[:150]}",
            "source": filepath,
            "confidence": 0.8,
        })

    return facts


# ============================================================
# Knowledge graph update
# ============================================================


def update_knowledge_graph(facts: list[dict], dry_run: bool = False) -> int:
    """Add new facts as nodes/edges to the knowledge graph."""
    if dry_run:
        log(f"  [DRY RUN] Would add {len(facts)} facts to graph")
        return len(facts)

    if not GRAPH_FILE.exists():
        log("  ⚠ Graph file not found, skipping graph update")
        return 0

    try:
        graph = json.loads(GRAPH_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0

    nodes = graph.get("nodes", {})
    edges = graph.get("edges", [])

    # Handle both dict and list formats
    if isinstance(nodes, list):
        nodes = {n["id"]: n for n in nodes}
    existing_ids = set(nodes.keys())

    if isinstance(edges, dict):
        edges = list(edges.values()) if edges else []

    new_count = 0
    for fact in facts:
        node_type = fact["type"].lower()
        # Create deterministic ID from content
        content_key = re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", fact["content"].lower())[:50]
        node_id = f"{node_type}:{content_key}"

        if node_id in existing_ids:
            continue

        nodes[node_id] = {
            "id": node_id,
            "type": fact["type"],
            "name": fact["content"][:80],
            "properties": {
                "source": fact["source"],
                "confidence": fact["confidence"],
                "created": TODAY.isoformat(),
                "auto_extracted": True,
            },
        }
        existing_ids.add(node_id)

        # Link to source file
        file_id = f"file:{fact['source']}"
        if file_id not in existing_ids:
            nodes[file_id] = {
                "id": file_id,
                "type": "File",
                "name": fact["source"],
                "properties": {"path": fact["source"]},
            }
            existing_ids.add(file_id)

        edges.append({
            "source": file_id,
            "target": node_id,
            "type": "contains",
        })
        new_count += 1

    if new_count > 0:
        graph["nodes"] = nodes
        graph["edges"] = edges
        graph["meta"]["node_count"] = len(nodes)
        graph["meta"]["edge_count"] = len(edges)
        graph["meta"]["last_updated"] = TODAY.isoformat()
        GRAPH_FILE.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")

    return new_count


# ============================================================
# Session digest
# ============================================================


def write_session_digest(changes: dict, facts: list[dict], graph_updates: int, dry_run: bool = False):
    """Write a compact session digest for future reference."""
    DIGESTS_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    digest_file = DIGESTS_DIR / f"{timestamp}.json"

    digest = {
        "date": TODAY.isoformat(),
        "timestamp": datetime.now().isoformat(),
        "changes": {
            "files_modified": len(changes["modified"]),
            "files_added": len(changes["added"]),
            "files_deleted": len(changes["deleted"]),
            "commits_today": len(changes["commits"]),
        },
        "knowledge": {
            "facts_extracted": len(facts),
            "graph_nodes_added": graph_updates,
            "key_facts": [f["content"][:100] for f in facts[:10]],
        },
        "files_touched": (changes["modified"] + changes["added"])[:20],
        "commit_messages": changes["commits"][:5],
    }

    if not dry_run:
        digest_file.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"  Digest written: {digest_file.name}")

        # Cleanup: keep last 50 digests
        digests = sorted(DIGESTS_DIR.glob("*.json"), reverse=True)
        for old in digests[50:]:
            old.unlink()
    else:
        log(f"  [DRY RUN] Would write digest: {json.dumps(digest, ensure_ascii=False, indent=2)}")

    return digest


# ============================================================
# Incremental reindex
# ============================================================


def trigger_incremental_reindex(changed_files: list[str], dry_run: bool = False):
    """Trigger incremental reindex for changed knowledge files."""
    knowledge_files = [
        f for f in changed_files
        if any(f.startswith(d) for d in KNOWLEDGE_DIRS)
        and Path(f).suffix.lower() in {".md", ".json", ".yaml", ".yml", ".txt"}
    ]

    if not knowledge_files:
        log("  No knowledge files changed, skipping reindex")
        return

    log(f"  {len(knowledge_files)} knowledge file(s) changed, triggering reindex...")

    if dry_run:
        log(f"  [DRY RUN] Would reindex: {knowledge_files[:5]}")
        return

    # Rebuild vector index (lightweight — only re-scans changed files)
    try:
        sys.path.insert(0, str(REPO / "scripts"))
        from memory_search import build_index
        build_index()
        log("  Vector index rebuilt")
    except Exception as e:
        log(f"  ⚠ Vector reindex failed: {e}")

    # Rebuild knowledge graph
    try:
        from knowledge_graph import build_graph
        build_graph()
        log("  Knowledge graph rebuilt")
    except Exception as e:
        log(f"  ⚠ Graph rebuild failed: {e}")


# ============================================================
# Main
# ============================================================


def run_writeback(dry_run: bool = False) -> dict:
    """Run the full write-back loop."""
    log(f"Memory Write-back — {TODAY}\n")

    # 1. Detect changes
    changes = get_session_changes()
    all_changed = changes["modified"] + changes["added"]
    log(f"  Changes detected: {len(changes['modified'])} modified, {len(changes['added'])} added, {len(changes['deleted'])} deleted")
    log(f"  Today's commits: {len(changes['commits'])}")

    if not all_changed and not changes["commits"]:
        log("  No changes detected, nothing to write back")
        return {"status": "no_changes"}

    # 2. Extract facts
    all_facts = []
    for filepath in all_changed:
        facts = extract_facts_from_file(filepath)
        all_facts.extend(facts)
    log(f"\n  Facts extracted: {len(all_facts)}")
    for f in all_facts[:5]:
        log(f"    [{f['type']}] {f['content'][:80]}")

    # 3. Update knowledge graph
    graph_updates = 0
    if all_facts:
        graph_updates = update_knowledge_graph(all_facts, dry_run=dry_run)
        log(f"\n  Graph updates: {graph_updates} new node(s)")

    # 4. Write session digest
    digest = write_session_digest(changes, all_facts, graph_updates, dry_run=dry_run)

    # 5. Incremental reindex (only if substantial changes)
    if len(all_changed) >= 3 or graph_updates > 0:
        trigger_incremental_reindex(all_changed, dry_run=dry_run)

    summary = {
        "status": "ok",
        "changes": len(all_changed),
        "facts_extracted": len(all_facts),
        "graph_nodes_added": graph_updates,
        "digest_written": True,
    }

    log(f"\n  Write-back complete: {len(all_facts)} facts, {graph_updates} graph updates")
    return summary


def main():
    try:
        result = run_writeback(dry_run=DRY_RUN)

        if not VERBOSE and result.get("facts_extracted", 0) > 0:
            print(f"[WriteBack] {result['facts_extracted']} facts → {result['graph_nodes_added']} graph updates")

    except Exception as e:
        if VERBOSE:
            print(f"  Write-back error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
