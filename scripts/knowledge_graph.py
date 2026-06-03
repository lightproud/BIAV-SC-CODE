"""
knowledge_graph.py — Knowledge Graph Builder & Query Engine

Part of BIAV-SC Advanced Memory System (Sprint 2).
Builds an entity-relationship graph from structured data + memory files.

Node types: Character, Realm, Decision, File, Concept, System
Edge types: mentions, depends_on, related_to, belongs_to, contains, supersedes

Usage:
  python scripts/knowledge_graph.py --build         # Build graph
  python scripts/knowledge_graph.py --stats          # Show statistics
  python scripts/knowledge_graph.py "黑池"           # Query entity
  python scripts/knowledge_graph.py "黑池" --depth 2 # 2-hop traversal
"""

import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GRAPH_FILE = REPO / "assets" / "data" / "knowledge-graph.json"
TODAY = date.today()

# ============================================================
# Node & Edge definitions
# ============================================================

NODE_TYPES = {"Character", "Realm", "Decision", "File", "Concept", "System"}
EDGE_TYPES = {"mentions", "depends_on", "related_to", "belongs_to", "contains", "supersedes"}


def make_node_id(node_type: str, name: str) -> str:
    """Create a canonical node ID."""
    return f"{node_type.lower()}:{name}"


# ============================================================
# Entity extraction from structured data (Phase 1, zero API)
# ============================================================


def extract_characters() -> tuple[list[dict], list[dict]]:
    """Extract character nodes and edges from characters.json."""
    fp = REPO / "projects" / "wiki" / "data" / "db" / "characters.json"
    if not fp.exists():
        return [], []

    data = json.loads(fp.read_text(encoding="utf-8"))
    characters = data.get("characters", []) if isinstance(data, dict) else data

    nodes, edges = [], []
    for c in characters:
        char_id = make_node_id("character", c.get("name", c.get("id", "")))
        nodes.append({
            "id": char_id,
            "type": "Character",
            "name": c.get("name", ""),
            "properties": {
                "id": c.get("id", ""),
                "name_en": c.get("name_en", ""),
                "rarity": c.get("rarity", ""),
                "realm": c.get("realm", ""),
                "role": c.get("role", ""),
            },
        })

        # Character → belongs_to → Realm
        if c.get("realm"):
            realm_id = make_node_id("realm", c["realm"])
            edges.append({
                "source": char_id,
                "target": realm_id,
                "type": "belongs_to",
            })

        # Character → mentions by → source file
        file_id = make_node_id("file", "projects/wiki/data/extracted/categorized/character_data.txt")
        edges.append({
            "source": file_id,
            "target": char_id,
            "type": "contains",
        })

    return nodes, edges


def extract_realms() -> tuple[list[dict], list[dict]]:
    """Extract realm nodes from realms.json."""
    fp = REPO / "projects" / "wiki" / "data" / "db" / "realms.json"
    if not fp.exists():
        return [], []

    data = json.loads(fp.read_text(encoding="utf-8"))
    realms = data.get("realms", data if isinstance(data, list) else [])

    nodes = []
    for r in realms:
        name = r.get("name", r.get("id", ""))
        if name:
            nodes.append({
                "id": make_node_id("realm", name),
                "type": "Realm",
                "name": name,
                "properties": {},
            })

    return nodes, []


def extract_decisions() -> tuple[list[dict], list[dict]]:
    """Extract decision nodes from decisions.md."""
    fp = REPO / "memory" / "decisions.md"
    if not fp.exists():
        return [], []

    text = fp.read_text(encoding="utf-8")
    nodes, edges = [], []
    file_id = make_node_id("file", "memory/decisions.md")

    for i, line in enumerate(text.splitlines()):
        if not line.startswith("|") or "日期" in line or "---" in line:
            continue
        # Parse table row: | date | content | scope |
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 2:
            continue

        # Extract date and content
        date_str = ""
        content = ""
        for cell in cells:
            if re.match(r"2026-\d{2}-\d{2}", cell):
                date_str = cell[:10]
            elif len(cell) > 10 and cell != date_str:
                content = cell
                break

        if not content:
            continue

        # Create a short label from content
        label = content[:40].strip()
        dec_id = make_node_id("decision", f"d{i:03d}-{label}")

        nodes.append({
            "id": dec_id,
            "type": "Decision",
            "name": label,
            "properties": {
                "date": date_str,
                "full_text": content[:200],
                "obsolete": "已废除" in content or "已废弃" in content or "~~" in content,
            },
        })

        edges.append({
            "source": file_id,
            "target": dec_id,
            "type": "contains",
        })

    return nodes, edges


def extract_systems() -> tuple[list[dict], list[dict]]:
    """Extract system/concept nodes from known entities."""
    systems = [
        {"id": "system:银芯", "name": "银芯", "aliases": ["BIAV-SC", "Silver Core", "银芯"]},
        {"id": "system:黑池", "name": "黑池", "aliases": ["BIAV-BP", "Black Pool", "黑池"]},
        {"id": "system:Wiki", "name": "Wiki", "aliases": ["Wiki", "知识站点"]},
        {"id": "system:日报", "name": "日报系统", "aliases": ["日报", "News", "聚合器", "aggregator"]},
        {"id": "system:做梦Agent", "name": "做梦Agent", "aliases": ["做梦", "dream", "AutoDream", "Dreaming"]},
        {"id": "system:Discord归档", "name": "Discord归档", "aliases": ["Discord", "discord-archive"]},
        {"id": "system:事实圣经", "name": "事实圣经", "aliases": ["事实圣经", "Fact Bible"]},
    ]

    nodes = []
    for s in systems:
        nodes.append({
            "id": s["id"],
            "type": "System",
            "name": s["name"],
            "properties": {"aliases": s["aliases"]},
        })

    # Known relationships between systems
    edges = [
        {"source": "system:黑池", "target": "system:银芯", "type": "depends_on"},
        {"source": "system:Wiki", "target": "system:事实圣经", "type": "depends_on"},
        {"source": "system:日报", "target": "system:银芯", "type": "belongs_to"},
        {"source": "system:做梦Agent", "target": "system:银芯", "type": "belongs_to"},
        {"source": "system:Discord归档", "target": "system:日报", "type": "related_to"},
    ]

    return nodes, edges


def extract_file_nodes() -> tuple[list[dict], list[dict]]:
    """Create file nodes for all memory and context files."""
    nodes, edges = [], []

    file_patterns = [
        ("memory/*.md", "memory"),
        ("projects/*/CONTEXT.md", "context"),
        ("BIAV-SC.md", "config"),
    ]

    for pattern, category in file_patterns:
        for fp in sorted(REPO.glob(pattern)):
            if not fp.is_file():
                continue
            rel = str(fp.relative_to(REPO))
            fid = make_node_id("file", rel)
            nodes.append({
                "id": fid,
                "type": "File",
                "name": rel,
                "properties": {
                    "category": category,
                    "lines": len(fp.read_text(encoding="utf-8").splitlines()),
                },
            })

    return nodes, edges


# Canonical entity dictionaries — single source for graph building and text
# scanning. Both extract_concepts_from_text() and _build_entity_dict() use these.
CONCEPT_DICT = {
    "联动": "concept:联动",
    "沙耶之歌": "concept:沙耶之歌",
    "Steam": "concept:Steam",
    "Bilibili": "concept:Bilibili",
    "GitHub": "concept:GitHub",
    "SVN": "concept:SVN",
    "Qoder": "concept:Qoder",
    "VitePress": "concept:VitePress",
    "Phase 0": "concept:Phase0",
    "Phase 1": "concept:Phase1",
    "Phase 2": "concept:Phase2",
    "Phase 3": "concept:Phase3",
    "Phase 4": "concept:Phase4",
    "Stage 1": "concept:Stage1",
    "THPDom": "concept:THPDom",
    "方法论": "concept:方法论",
    "止血": "concept:止血",
    "记忆宫殿": "concept:记忆宫殿",
    "技术债": "concept:技术债",
    "BPT": "concept:BPT",
    "MCP": "concept:MCP",
    "Electron": "concept:Electron",
    "TF-IDF": "concept:TF-IDF",
}

SYSTEM_ALIASES = {
    "银芯": "system:银芯", "BIAV-SC": "system:银芯", "Silver Core": "system:银芯",
    "黑池": "system:黑池", "BIAV-BP": "system:黑池", "Black Pool": "system:黑池",
    "Wiki": "system:Wiki", "wiki": "system:Wiki",
    "日报": "system:日报", "聚合器": "system:日报",
    "做梦": "system:做梦Agent", "AutoDream": "system:做梦Agent",
    "Discord归档": "system:Discord归档", "discord-archive": "system:Discord归档",
    "事实圣经": "system:事实圣经",
}


def _load_char_names() -> dict:
    """Map character names (zh + en) to character node ids from characters.json."""
    names = {}
    chars_fp = REPO / "projects" / "wiki" / "data" / "db" / "characters.json"
    if chars_fp.exists():
        try:
            chars_data = json.loads(chars_fp.read_text(encoding="utf-8"))
            for c in (chars_data.get("characters", []) if isinstance(chars_data, dict) else chars_data):
                name = c.get("name", "")
                if name and len(name) >= 2:
                    names[name] = make_node_id("character", name)
                name_en = c.get("name_en", "")
                if name_en and len(name_en) >= 3:
                    names[name_en] = make_node_id("character", c.get("name", name_en))
        except (json.JSONDecodeError, OSError):
            pass
    return names


def extract_concepts_from_text() -> tuple[list[dict], list[dict]]:
    """Extract concept nodes and mention edges from memory files."""
    all_entities = _build_entity_dict()

    # Create concept nodes
    nodes = []
    seen_ids = set()
    for name, eid in CONCEPT_DICT.items():
        if eid not in seen_ids:
            nodes.append({
                "id": eid,
                "type": "Concept",
                "name": name,
                "properties": {},
            })
            seen_ids.add(eid)

    # Scan memory files for entity mentions
    edges = []
    mention_count = defaultdict(lambda: defaultdict(int))

    scan_patterns = ["memory/*.md", "projects/*/CONTEXT.md"]
    for pattern in scan_patterns:
        for fp in sorted(REPO.glob(pattern)):
            if not fp.is_file():
                continue
            try:
                text = fp.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue

            rel = str(fp.relative_to(REPO))
            file_id = make_node_id("file", rel)

            for entity_name, entity_id in all_entities.items():
                if entity_name in text:
                    mention_count[file_id][entity_id] += text.count(entity_name)

    # Create mention edges (only if mentioned 2+ times to reduce noise)
    for file_id, entities in mention_count.items():
        for entity_id, count in entities.items():
            if count >= 2:
                edges.append({
                    "source": file_id,
                    "target": entity_id,
                    "type": "mentions",
                    "properties": {"count": count},
                })

    return nodes, edges


# ============================================================
# File dependency extraction
# ============================================================


def extract_file_dependencies() -> list[dict]:
    """Extract depends_on edges from file cross-references."""
    edges = []
    seen = set()

    scan_files = (
        list(REPO.glob("memory/*.md"))
        + [REPO / "BIAV-SC.md"]
        + list(REPO.glob("projects/*/CONTEXT.md"))
    )

    ref_pattern = re.compile(r"(?:memory/[\w./-]+|assets/[\w./-]+|projects/[\w./-]+)")

    for fp in scan_files:
        if not fp.is_file():
            continue
        try:
            text = fp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        src = str(fp.relative_to(REPO))
        src_id = make_node_id("file", src)

        for m in ref_pattern.finditer(text):
            ref = m.group(0).rstrip(".,;:!?)")
            if "xxx" in ref or "YYYY" in ref or "待" in text[max(0, m.start()-10):m.start()]:
                continue
            target = REPO / ref
            if target.exists() or any(REPO.glob(ref)):
                tgt_id = make_node_id("file", ref)
                edge_key = (src_id, tgt_id)
                if edge_key not in seen:
                    seen.add(edge_key)
                    edges.append({
                        "source": src_id,
                        "target": tgt_id,
                        "type": "depends_on",
                    })

    return edges


# ============================================================
# Graph construction
# ============================================================


def build_graph() -> dict:
    """Build the complete knowledge graph."""
    all_nodes = {}
    all_edges = []

    extractors = [
        ("Characters", extract_characters),
        ("Realms", extract_realms),
        ("Decisions", extract_decisions),
        ("Systems", extract_systems),
        ("Files", extract_file_nodes),
        ("Concepts", extract_concepts_from_text),
    ]

    for label, extractor in extractors:
        nodes, edges = extractor()
        for n in nodes:
            all_nodes[n["id"]] = n
        all_edges.extend(edges)
        print(f"  {label}: {len(nodes)} nodes, {len(edges)} edges")

    # File dependencies
    dep_edges = extract_file_dependencies()
    all_edges.extend(dep_edges)
    print(f"  File dependencies: {len(dep_edges)} edges")

    # Deduplicate edges
    edge_set = set()
    unique_edges = []
    for e in all_edges:
        key = (e["source"], e["target"], e["type"])
        if key not in edge_set:
            edge_set.add(key)
            unique_edges.append(e)

    graph = {
        "meta": {
            "generated": TODAY.isoformat(),
            "generator": "knowledge_graph.py",
            "node_count": len(all_nodes),
            "edge_count": len(unique_edges),
            "node_types": dict(defaultdict(int, _count_types(all_nodes.values(), "type"))),
            "edge_types": dict(defaultdict(int, _count_types(unique_edges, "type"))),
        },
        "nodes": all_nodes,
        "edges": unique_edges,
    }

    # Save
    GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_FILE.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    size_kb = GRAPH_FILE.stat().st_size / 1024
    print(f"\n  Graph saved: {GRAPH_FILE.relative_to(REPO)} ({size_kb:.0f}KB)")
    return graph


def _count_types(items, key) -> dict:
    counts = defaultdict(int)
    for item in items:
        counts[item.get(key, "?")] += 1
    return dict(counts)


# ============================================================
# Incremental update (delta since last build)
# ============================================================


def incremental_update(hours_back: int = 24) -> dict:
    """Update graph incrementally by scanning only recently changed files.

    Detects new entities, new mention edges, and new file dependencies
    without full rebuild. Merges into existing graph.
    """
    graph = load_graph()
    if not graph:
        print("  No existing graph, doing full build")
        return build_graph()

    import time
    cutoff = time.time() - hours_back * 3600
    existing_nodes = graph["nodes"]
    existing_edge_set = {
        (e["source"], e["target"], e["type"]) for e in graph["edges"]
    }
    new_nodes = 0
    new_edges = 0

    # 1. Scan recently modified memory files for new entity mentions
    scan_patterns = ["memory/*.md", "memory/session-digests/*.md",
                     "projects/*/CONTEXT.md", "BIAV-SC.md"]
    changed_files = []
    for pattern in scan_patterns:
        for fp in REPO.glob(pattern):
            if fp.is_file() and fp.stat().st_mtime > cutoff:
                changed_files.append(fp)

    if not changed_files:
        print(f"  No files changed in last {hours_back}h, graph is current")
        return graph

    print(f"  {len(changed_files)} files changed, scanning for new entities...")

    # Build entity dictionary (same as extract_concepts_from_text)
    all_entities = _build_entity_dict()

    for fp in changed_files:
        try:
            text = fp.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        rel = str(fp.relative_to(REPO))
        file_id = make_node_id("file", rel)

        # Ensure file node exists
        if file_id not in existing_nodes:
            existing_nodes[file_id] = {
                "id": file_id, "type": "File", "name": rel,
                "properties": {"category": "memory", "lines": len(text.splitlines())},
            }
            new_nodes += 1

        # Scan for entity mentions
        for entity_name, entity_id in all_entities.items():
            count = text.count(entity_name)
            if count >= 2:
                edge_key = (file_id, entity_id, "mentions")
                if edge_key not in existing_edge_set:
                    graph["edges"].append({
                        "source": file_id, "target": entity_id,
                        "type": "mentions", "properties": {"count": count},
                    })
                    existing_edge_set.add(edge_key)
                    new_edges += 1

        # Scan for file cross-references
        ref_pattern = re.compile(r"(?:memory/[\w./-]+|assets/[\w./-]+|projects/[\w./-]+)")
        for m in ref_pattern.finditer(text):
            ref = m.group(0).rstrip(".,;:!?)")
            target = REPO / ref
            if target.exists():
                tgt_id = make_node_id("file", ref)
                edge_key = (file_id, tgt_id, "depends_on")
                if edge_key not in existing_edge_set:
                    graph["edges"].append({
                        "source": file_id, "target": tgt_id, "type": "depends_on",
                    })
                    existing_edge_set.add(edge_key)
                    new_edges += 1

    # 2. Check for new characters in characters.json
    chars_fp = REPO / "projects" / "wiki" / "data" / "db" / "characters.json"
    if chars_fp.exists() and chars_fp.stat().st_mtime > cutoff:
        try:
            chars_data = json.loads(chars_fp.read_text(encoding="utf-8"))
            for c in (chars_data.get("characters", []) if isinstance(chars_data, dict) else chars_data):
                char_id = make_node_id("character", c.get("name", ""))
                if char_id and char_id not in existing_nodes:
                    existing_nodes[char_id] = {
                        "id": char_id, "type": "Character", "name": c.get("name", ""),
                        "properties": {
                            "id": c.get("id", ""), "name_en": c.get("name_en", ""),
                            "rarity": c.get("rarity", ""), "realm": c.get("realm", ""),
                            "role": c.get("role", ""),
                        },
                    }
                    new_nodes += 1
                    # Character → belongs_to → Realm
                    if c.get("realm"):
                        realm_id = make_node_id("realm", c["realm"])
                        edge_key = (char_id, realm_id, "belongs_to")
                        if edge_key not in existing_edge_set:
                            graph["edges"].append({
                                "source": char_id, "target": realm_id, "type": "belongs_to",
                            })
                            existing_edge_set.add(edge_key)
                            new_edges += 1
        except (json.JSONDecodeError, OSError):
            pass

    # 3. Re-scan decisions.md if changed
    decisions_fp = REPO / "memory" / "decisions.md"
    if decisions_fp in changed_files:
        dec_nodes, dec_edges = extract_decisions()
        for n in dec_nodes:
            if n["id"] not in existing_nodes:
                existing_nodes[n["id"]] = n
                new_nodes += 1
        for e in dec_edges:
            edge_key = (e["source"], e["target"], e["type"])
            if edge_key not in existing_edge_set:
                graph["edges"].append(e)
                existing_edge_set.add(edge_key)
                new_edges += 1

    # Update meta
    graph["meta"]["generated"] = TODAY.isoformat()
    graph["meta"]["node_count"] = len(existing_nodes)
    graph["meta"]["edge_count"] = len(graph["edges"])
    graph["meta"]["last_incremental"] = TODAY.isoformat()
    graph["meta"]["node_types"] = dict(_count_types(existing_nodes.values(), "type"))
    graph["meta"]["edge_types"] = dict(_count_types(graph["edges"], "type"))

    # Save
    GRAPH_FILE.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8",
    )

    print(f"  +{new_nodes} nodes, +{new_edges} edges")
    print(f"  Total: {graph['meta']['node_count']} nodes, {graph['meta']['edge_count']} edges")
    return graph


def _build_entity_dict() -> dict:
    """Build the canonical entity dictionary for text scanning."""
    all_entities = {}
    all_entities.update(CONCEPT_DICT)
    all_entities.update(SYSTEM_ALIASES)
    all_entities.update(_load_char_names())
    return all_entities


# ============================================================
# Graph query
# ============================================================


def load_graph() -> dict | None:
    """Load the knowledge graph from disk."""
    if not GRAPH_FILE.exists():
        return None
    try:
        return json.loads(GRAPH_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _build_name_index(graph: dict) -> None:
    """Build an inverted name index on graph in-place (not persisted to disk).

    graph["_name_index"]: {lowercased_name_or_alias -> [node_id, ...]}

    Called lazily by find_node() on first access.  The index is stored as a
    plain dict on the in-memory graph object; json.dumps/load round-trips
    intentionally exclude it (no schema pollution, no stale-index risk after
    incremental_update adds nodes).
    """
    index: dict[str, list[str]] = defaultdict(list)
    for nid, node in graph["nodes"].items():
        name_lower = node.get("name", "").lower()
        if name_lower:
            index[name_lower].append(nid)
        for alias in node.get("properties", {}).get("aliases", []):
            alias_lower = alias.lower()
            if alias_lower:
                index[alias_lower].append(nid)
    graph["_name_index"] = dict(index)


def find_node(graph: dict, query: str) -> list[dict]:
    """Find nodes matching a query string.

    Exact name/alias hits are resolved via an inverted index (O(1) per lookup).
    Substring and node-ID matches fall back to linear scan, preserving the
    original result set and sort order (exact > partial > id).
    """
    # Lazily build the name index on first call for this graph object.
    if "_name_index" not in graph:
        _build_name_index(graph)

    query_lower = query.lower()
    matches = []
    exact_ids: set[str] = set()

    # --- Fast path: exact name / alias match via index ---
    for nid in graph["_name_index"].get(query_lower, []):
        node = graph["nodes"].get(nid)
        if node is not None:
            matches.append({"node": node, "match": "exact"})
            exact_ids.add(nid)

    # --- Slow path: substring / id scan (skip already-exact nodes) ---
    for nid, node in graph["nodes"].items():
        if nid in exact_ids:
            continue
        name = node.get("name", "").lower()
        aliases = [a.lower() for a in node.get("properties", {}).get("aliases", [])]

        if query_lower in name or any(query_lower in a for a in aliases):
            matches.append({"node": node, "match": "partial"})
        elif query_lower in nid.lower():
            matches.append({"node": node, "match": "id"})

    # Sort: exact > partial > id
    order = {"exact": 0, "partial": 1, "id": 2}
    matches.sort(key=lambda m: order.get(m["match"], 3))
    return matches


def get_neighbors(graph: dict, node_id: str, depth: int = 1) -> dict:
    """Get all nodes connected to node_id within given depth.

    Returns {
        "center": node,
        "neighbors": [{node, edge, direction, depth}],
        "paths": [{from, to, edge_type}],
    }
    """
    center = graph["nodes"].get(node_id)
    if not center:
        return {"center": None, "neighbors": [], "paths": []}

    visited = {node_id}
    neighbors = []
    paths = []
    frontier = [node_id]

    # Build adjacency index once: node_id → [(other_id, direction, edge_type)]
    adj = defaultdict(list)
    for edge in graph["edges"]:
        adj[edge["source"]].append((edge["target"], "outgoing", edge["type"]))
        adj[edge["target"]].append((edge["source"], "incoming", edge["type"]))

    for d in range(1, depth + 1):
        next_frontier = []
        for current_id in frontier:
            for other_id, direction, edge_type in adj[current_id]:
                if other_id in visited:
                    continue

                if other_id:
                    visited.add(other_id)
                    other_node = graph["nodes"].get(other_id, {"id": other_id, "type": "?", "name": other_id})
                    neighbors.append({
                        "node": other_node,
                        "edge_type": edge_type,
                        "direction": direction,
                        "depth": d,
                        "via": current_id,
                    })
                    paths.append({
                        "from": current_id,
                        "to": other_id,
                        "edge_type": edge_type,
                    })
                    next_frontier.append(other_id)

        frontier = next_frontier

    return {"center": center, "neighbors": neighbors, "paths": paths}


def graph_distance(graph: dict, node_a: str, node_b: str, max_depth: int = 4) -> int:
    """Find shortest path distance between two nodes. Returns -1 if not connected."""
    if node_a == node_b:
        return 0

    visited = {node_a}
    frontier = [node_a]

    # Build adjacency index for faster traversal
    adj = defaultdict(set)
    for edge in graph["edges"]:
        adj[edge["source"]].add(edge["target"])
        adj[edge["target"]].add(edge["source"])

    for d in range(1, max_depth + 1):
        next_frontier = []
        for current_id in frontier:
            for neighbor_id in adj[current_id]:
                if neighbor_id == node_b:
                    return d
                if neighbor_id not in visited:
                    visited.add(neighbor_id)
                    next_frontier.append(neighbor_id)
        frontier = next_frontier

    return -1


def find_related_files(graph: dict, query: str, max_depth: int = 2) -> list[dict]:
    """Find files related to a query entity, with distance scores.

    Returns [{file_path, distance, via_entities}]
    """
    matches = find_node(graph, query)
    if not matches:
        return []

    results = {}  # file_path → {distance, via}

    for match in matches[:3]:  # Top 3 matching entities
        node_id = match["node"]["id"]
        result = get_neighbors(graph, node_id, depth=max_depth)

        for neighbor in result["neighbors"]:
            n = neighbor["node"]
            if n.get("type") == "File":
                file_path = n.get("name", n["id"].replace("file:", ""))
                d = neighbor["depth"]
                if file_path not in results or results[file_path]["distance"] > d:
                    results[file_path] = {
                        "file": file_path,
                        "distance": d,
                        "via": node_id,
                        "edge_type": neighbor["edge_type"],
                    }

    # Sort by distance
    return sorted(results.values(), key=lambda x: x["distance"])


# ============================================================
# CLI
# ============================================================


def print_stats(graph: dict):
    """Print graph statistics."""
    meta = graph["meta"]
    print(f"\n  知识图谱统计")
    print(f"  生成时间：{meta.get('generated', '?')}")
    print(f"  节点总数：{meta['node_count']}")
    print(f"  边总数：{meta['edge_count']}")
    print(f"\n  节点类型分布：")
    for t, c in sorted(meta.get("node_types", {}).items(), key=lambda x: -x[1]):
        print(f"    {t}: {c}")
    print(f"\n  边类型分布：")
    for t, c in sorted(meta.get("edge_types", {}).items(), key=lambda x: -x[1]):
        print(f"    {t}: {c}")


def print_query_result(graph: dict, query: str, depth: int):
    """Print entity query result."""
    matches = find_node(graph, query)
    if not matches:
        print(f"\n  未找到与「{query}」匹配的实体")
        return

    for match in matches[:2]:
        node = match["node"]
        print(f"\n  {node['type']}: {node['name']} ({match['match']} match)")
        if node.get("properties"):
            props = {k: v for k, v in node["properties"].items() if v}
            if props:
                print(f"     属性: {json.dumps(props, ensure_ascii=False)[:120]}")

        result = get_neighbors(graph, node["id"], depth=depth)
        if result["neighbors"]:
            print(f"\n  关联实体（{depth} 跳内）：")
            # Group by type
            by_type = defaultdict(list)
            for n in result["neighbors"]:
                by_type[n["node"]["type"]].append(n)

            for ntype, items in sorted(by_type.items()):
                print(f"\n    [{ntype}]")
                for item in items[:10]:
                    arrow = "→" if item["direction"] == "outgoing" else "←"
                    print(f"      {arrow} {item['edge_type']}: {item['node']['name'][:60]} (depth={item['depth']})")

    # Also show related files
    related = find_related_files(graph, query, max_depth=depth)
    if related:
        print(f"\n  相关文件（按距离排序）：")
        for r in related[:8]:
            print(f"    [{r['distance']}跳] {r['file']} (via {r['edge_type']})")


def main():
    args = sys.argv[1:]

    do_build = "--build" in args
    do_stats = "--stats" in args
    depth = 1
    depth_value_idx = -1
    if "--depth" in args:
        idx = args.index("--depth")
        if idx + 1 < len(args):
            depth = int(args[idx + 1])
            depth_value_idx = idx + 1

    query_args = [
        a for i, a in enumerate(args)
        if not a.startswith("--") and i != depth_value_idx
    ]
    query = " ".join(query_args) if query_args else None

    if do_build:
        print(f"构建知识图谱 — {TODAY}")
        build_graph()
        print("  图谱构建完成")

    graph = load_graph()

    if do_stats and graph:
        print_stats(graph)

    if query:
        if not graph:
            print("  ⚠ 图谱不存在，请先运行: python scripts/knowledge_graph.py --build")
            return
        print_query_result(graph, query, depth)
    elif not do_build and not do_stats:
        print("用法:")
        print('  python scripts/knowledge_graph.py --build')
        print('  python scripts/knowledge_graph.py --stats')
        print('  python scripts/knowledge_graph.py "实体名"')
        print('  python scripts/knowledge_graph.py "实体名" --depth 2')


if __name__ == "__main__":
    main()
