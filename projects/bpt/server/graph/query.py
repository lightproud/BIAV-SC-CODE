"""
Knowledge graph query module for BPT Server.

Provides functions to search nodes, explore neighborhoods via BFS,
and find related files for a given entity.
"""

from collections import deque
from typing import Any, Dict, List, Optional, Tuple


# -- Node lookup -------------------------------------------------------------


def find_node(graph: Dict[str, Any], name: str) -> Optional[Dict[str, Any]]:
    """
    Search for a node by name in the knowledge graph.

    Matching priority:
      1. Exact match (case-insensitive)
      2. Prefix match (case-insensitive)
      3. Substring match (case-insensitive)

    Args:
        graph: The knowledge graph dict (must contain "nodes").
        name: The name to search for.

    Returns:
        The matching node dict (including its "id" field), or None.
    """
    if not graph or "nodes" not in graph or not name:
        return None

    nodes = graph["nodes"]
    name_lower = name.lower()

    # Pass 1: Exact match on node name.
    for node_id, node in nodes.items():
        if node.get("name", "").lower() == name_lower:
            result = dict(node)
            result["id"] = node_id
            return result

    # Pass 2: Exact match on node ID (for File nodes where ID == relative path).
    for node_id, node in nodes.items():
        if node_id.lower() == name_lower:
            result = dict(node)
            result["id"] = node_id
            return result

    # Pass 3: Prefix match on node name.
    for node_id, node in nodes.items():
        if node.get("name", "").lower().startswith(name_lower):
            result = dict(node)
            result["id"] = node_id
            return result

    # Pass 4: Substring match on node name.
    for node_id, node in nodes.items():
        if name_lower in node.get("name", "").lower():
            result = dict(node)
            result["id"] = node_id
            return result

    return None


# -- BFS neighbor discovery --------------------------------------------------


def _build_adjacency(
    edges: List[Dict[str, str]],
) -> Dict[str, List[Tuple[str, str, str]]]:
    """
    Build a bidirectional adjacency list from the edge list.

    Returns a dict mapping node_id to a list of
    (neighbor_id, edge_type, direction) tuples.
    direction is "outgoing" if the node is source, "incoming" if target.
    """
    adj: Dict[str, List[Tuple[str, str, str]]] = {}

    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        etype = edge["type"]

        if src not in adj:
            adj[src] = []
        adj[src].append((tgt, etype, "outgoing"))

        if tgt not in adj:
            adj[tgt] = []
        adj[tgt].append((src, etype, "incoming"))

    return adj


def query_entity(
    graph: Dict[str, Any],
    entity_name: str,
    depth: int = 1,
) -> Dict[str, Any]:
    """
    Find an entity and explore its neighborhood via BFS.

    Args:
        graph: The knowledge graph dict.
        entity_name: Name of the entity to look up.
        depth: Maximum BFS hops (clamped to 1..3).

    Returns:
        Dict with:
          - "entity": the matched node dict (or None)
          - "neighbors": list of neighbor dicts with name, type, edge, direction, depth
          - "total_neighbors": count of neighbors found
    """
    depth = max(1, min(3, depth))

    entity = find_node(graph, entity_name)
    if entity is None:
        return {"entity": None, "neighbors": [], "total_neighbors": 0}

    entity_id = entity["id"]
    nodes = graph.get("nodes", {})
    edges = graph.get("edges", [])
    adj = _build_adjacency(edges)

    # BFS
    visited: set = {entity_id}
    queue: deque = deque()  # (node_id, current_depth, edge_type, direction)

    # Seed with direct neighbors.
    for neighbor_id, etype, direction in adj.get(entity_id, []):
        if neighbor_id not in visited:
            queue.append((neighbor_id, 1, etype, direction))
            visited.add(neighbor_id)

    neighbors: List[Dict[str, Any]] = []

    while queue:
        nid, d, etype, direction = queue.popleft()

        node_data = nodes.get(nid, {})
        neighbors.append({
            "name": node_data.get("name", nid),
            "type": node_data.get("type", "Unknown"),
            "edge": etype,
            "direction": direction,
            "depth": d,
        })

        # Continue BFS if within depth limit.
        if d < depth:
            for next_id, next_etype, next_dir in adj.get(nid, []):
                if next_id not in visited:
                    visited.add(next_id)
                    queue.append((next_id, d + 1, next_etype, next_dir))

    return {
        "entity": entity,
        "neighbors": neighbors,
        "total_neighbors": len(neighbors),
    }


def find_related_files(
    graph: Dict[str, Any],
    entity_name: str,
    max_depth: int = 2,
) -> Dict[str, Any]:
    """
    Find File-type nodes connected to a given entity via BFS.

    Args:
        graph: The knowledge graph dict.
        entity_name: Name of the entity to start from.
        max_depth: Maximum BFS depth (clamped to 1..3).

    Returns:
        Dict with:
          - "entity": the entity name searched for
          - "related_files": list of dicts (up to 10), each with:
              file, distance, via (intermediate node name), edge_type
    """
    max_depth = max(1, min(3, max_depth))

    entity = find_node(graph, entity_name)
    if entity is None:
        return {"entity": entity_name, "related_files": []}

    entity_id = entity["id"]
    nodes = graph.get("nodes", {})
    edges = graph.get("edges", [])
    adj = _build_adjacency(edges)

    # BFS tracking: (node_id, depth, via_node_name, edge_type)
    visited: set = {entity_id}
    queue: deque = deque()

    # Seed neighbors.
    for neighbor_id, etype, _ in adj.get(entity_id, []):
        if neighbor_id not in visited:
            via_name = entity.get("name", entity_id)
            queue.append((neighbor_id, 1, via_name, etype))
            visited.add(neighbor_id)

    # Collect File nodes, sorted by distance.
    file_results: List[Dict[str, Any]] = []

    # If the entity itself is a File node, include it at distance 0.
    if entity.get("type") == "File":
        file_results.append({
            "file": entity.get("name", entity_id),
            "distance": 0,
            "via": entity.get("name", entity_id),
            "edge_type": "self",
        })

    while queue:
        nid, d, via_name, etype = queue.popleft()
        node_data = nodes.get(nid, {})

        if node_data.get("type") == "File":
            file_results.append({
                "file": node_data.get("name", nid),
                "distance": d,
                "via": via_name,
                "edge_type": etype,
            })

        # Continue BFS if within depth limit.
        if d < max_depth:
            current_name = node_data.get("name", nid)
            for next_id, next_etype, _ in adj.get(nid, []):
                if next_id not in visited:
                    visited.add(next_id)
                    queue.append((next_id, d + 1, current_name, next_etype))

    # Sort by distance (closer = better), then alphabetically by file name.
    file_results.sort(key=lambda r: (r["distance"], r["file"]))

    # Return top 10.
    return {
        "entity": entity_name,
        "related_files": file_results[:10],
    }
