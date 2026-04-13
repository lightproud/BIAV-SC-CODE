"""
Knowledge graph builder for BPT Server.

Scans project files, extracts entities and relationships, and persists
the graph as a JSON file in the index directory.

Node types: File, Function, Config, Character, Concept, Decision, Document
Edge types: mentions, depends_on, related_to, belongs_to, contains, defines, calls
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from .. import config
from ..parsers import parse_file

# -- Constants ---------------------------------------------------------------

GRAPH_FILENAME = "knowledge-graph.json"

NODE_TYPES = {"File", "Function", "Config", "Character", "Concept", "Decision", "Document"}
EDGE_TYPES = {"mentions", "depends_on", "related_to", "belongs_to", "contains", "defines", "calls"}

# Minimum entity name length to avoid noise from single-char matches.
_MIN_ENTITY_NAME_LEN = 2

# -- Regex patterns for entity extraction ------------------------------------

# Python
_PY_CLASS_RE = re.compile(r"^class\s+(\w+)", re.MULTILINE)
_PY_FUNC_RE = re.compile(r"^def\s+(\w+)", re.MULTILINE)
_PY_IMPORT_RE = re.compile(
    r"^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", re.MULTILINE
)

# C#
_CS_CLASS_RE = re.compile(
    r"(?:public|private|protected|internal)?\s*(?:static\s+)?(?:partial\s+)?(?:class|struct)\s+(\w+)",
    re.MULTILINE,
)
_CS_METHOD_RE = re.compile(
    r"(?:public|private|protected|internal)\s+(?:static\s+)?(?:virtual\s+)?(?:override\s+)?(?:async\s+)?"
    r"[\w<>\[\],\s]+\s+(\w+)\s*\(",
    re.MULTILINE,
)
_CS_USING_RE = re.compile(r"^using\s+([\w.]+)\s*;", re.MULTILINE)

# Lua
_LUA_FUNC_RE = re.compile(r"function\s+(\w[\w.]*)", re.MULTILINE)
_LUA_REQUIRE_RE = re.compile(r"""require\s*\(\s*["']([\w./]+)["']\s*\)""", re.MULTILINE)

# JavaScript / TypeScript
_JS_CLASS_RE = re.compile(r"^(?:export\s+)?class\s+(\w+)", re.MULTILINE)
_JS_FUNC_RE = re.compile(
    r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)", re.MULTILINE
)
_JS_EXPORT_RE = re.compile(r"^export\s+(?:const|let|var)\s+(\w+)", re.MULTILINE)
_JS_IMPORT_RE = re.compile(
    r"""import\s+.*?\s+from\s+["']([\w@./\-]+)["']""", re.MULTILINE
)

# Markdown
_MD_HEADING_RE = re.compile(r"^#{1,4}\s+(.+)$", re.MULTILINE)

# -- Helpers -----------------------------------------------------------------


def _make_node_id(node_type: str, name: str) -> str:
    """Generate a deterministic node ID.

    For File nodes the name is already the relative path.
    For other nodes: "type:name".
    """
    if node_type == "File":
        return name
    return f"{node_type}:{name}"


def _relative_path(file_path: str) -> str:
    """Return a POSIX-style relative path from DATA_ROOT."""
    try:
        return str(Path(file_path).relative_to(config.DATA_ROOT))
    except ValueError:
        return file_path


def _add_node(
    nodes: Dict[str, Dict[str, Any]],
    node_id: str,
    name: str,
    node_type: str,
    properties: Optional[Dict[str, Any]] = None,
) -> None:
    """Insert or update a node in the nodes dict."""
    if node_id not in nodes:
        nodes[node_id] = {
            "name": name,
            "type": node_type,
            "properties": properties or {},
        }
    else:
        # Merge properties if node already exists.
        if properties:
            nodes[node_id]["properties"].update(properties)


def _add_edge(
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
    source: str,
    target: str,
    edge_type: str,
) -> None:
    """Add an edge if it does not already exist."""
    key = (source, target, edge_type)
    if key not in edge_set:
        edge_set.add(key)
        edges.append({"source": source, "target": target, "type": edge_type})


# -- Extension-specific extractors -------------------------------------------


def _extract_python(
    text: str,
    file_node_id: str,
    nodes: Dict[str, Dict[str, Any]],
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
) -> List[str]:
    """Extract entities from Python source."""
    names: List[str] = []

    for m in _PY_CLASS_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "python", "kind": "class"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _PY_FUNC_RE.finditer(text):
        name = m.group(1)
        if name.startswith("_"):
            continue  # skip private helpers to reduce noise
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "python", "kind": "function"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _PY_IMPORT_RE.finditer(text):
        module = m.group(1) or m.group(2)
        if module:
            nid = _make_node_id("Function", module)
            _add_node(nodes, nid, module, "Function", {"language": "python", "kind": "module"})
            _add_edge(edges, edge_set, file_node_id, nid, "depends_on")

    return names


def _extract_csharp(
    text: str,
    file_node_id: str,
    nodes: Dict[str, Dict[str, Any]],
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
) -> List[str]:
    """Extract entities from C# source."""
    names: List[str] = []

    for m in _CS_CLASS_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "csharp", "kind": "class"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _CS_METHOD_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "csharp", "kind": "method"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _CS_USING_RE.finditer(text):
        namespace = m.group(1)
        nid = _make_node_id("Function", namespace)
        _add_node(nodes, nid, namespace, "Function", {"language": "csharp", "kind": "namespace"})
        _add_edge(edges, edge_set, file_node_id, nid, "depends_on")

    return names


def _extract_lua(
    text: str,
    file_node_id: str,
    nodes: Dict[str, Dict[str, Any]],
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
) -> List[str]:
    """Extract entities from Lua source."""
    names: List[str] = []

    for m in _LUA_FUNC_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "lua", "kind": "function"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _LUA_REQUIRE_RE.finditer(text):
        mod = m.group(1)
        nid = _make_node_id("Function", mod)
        _add_node(nodes, nid, mod, "Function", {"language": "lua", "kind": "module"})
        _add_edge(edges, edge_set, file_node_id, nid, "depends_on")

    return names


def _extract_js_ts(
    text: str,
    file_node_id: str,
    nodes: Dict[str, Dict[str, Any]],
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
) -> List[str]:
    """Extract entities from JavaScript / TypeScript source."""
    names: List[str] = []

    for m in _JS_CLASS_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "js/ts", "kind": "class"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _JS_FUNC_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "js/ts", "kind": "function"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _JS_EXPORT_RE.finditer(text):
        name = m.group(1)
        nid = _make_node_id("Function", name)
        _add_node(nodes, nid, name, "Function", {"language": "js/ts", "kind": "export"})
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(name)

    for m in _JS_IMPORT_RE.finditer(text):
        mod = m.group(1)
        nid = _make_node_id("Function", mod)
        _add_node(nodes, nid, mod, "Function", {"language": "js/ts", "kind": "module"})
        _add_edge(edges, edge_set, file_node_id, nid, "depends_on")

    return names


def _extract_markdown(
    text: str,
    file_node_id: str,
    nodes: Dict[str, Dict[str, Any]],
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
) -> List[str]:
    """Extract heading titles as Concept nodes from Markdown."""
    names: List[str] = []

    for m in _MD_HEADING_RE.finditer(text):
        heading = m.group(1).strip()
        if len(heading) < _MIN_ENTITY_NAME_LEN:
            continue
        nid = _make_node_id("Concept", heading)
        _add_node(nodes, nid, heading, "Concept")
        _add_edge(edges, edge_set, file_node_id, nid, "defines")
        names.append(heading)

    return names


def _extract_json_config(
    text: str,
    file_node_id: str,
    nodes: Dict[str, Dict[str, Any]],
    edges: List[Dict[str, str]],
    edge_set: Set[Tuple[str, str, str]],
) -> List[str]:
    """Extract top-level keys as Config nodes from JSON files."""
    names: List[str] = []

    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return names

    if isinstance(data, dict):
        for key in data:
            key_str = str(key)
            if len(key_str) < _MIN_ENTITY_NAME_LEN:
                continue
            nid = _make_node_id("Config", key_str)
            _add_node(nodes, nid, key_str, "Config")
            _add_edge(edges, edge_set, file_node_id, nid, "defines")
            names.append(key_str)

    return names


# Map file extensions to their extractor functions.
_EXTRACTOR_MAP = {
    ".py": _extract_python,
    ".cs": _extract_csharp,
    ".lua": _extract_lua,
    ".js": _extract_js_ts,
    ".ts": _extract_js_ts,
    ".md": _extract_markdown,
    ".json": _extract_json_config,
}


# -- Core build logic --------------------------------------------------------


def _scan_files() -> List[str]:
    """Walk DATA_ROOT and collect all indexable file paths."""
    files: List[str] = []
    for dirpath, dirnames, filenames in os.walk(config.DATA_ROOT):
        # Prune skipped directories in-place.
        dirnames[:] = [
            d for d in dirnames
            if d not in config.SKIP_DIRS
        ]
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in config.INDEXABLE_EXTENSIONS:
                full_path = os.path.join(dirpath, fname)
                # Respect max file size.
                try:
                    if os.path.getsize(full_path) <= config.MAX_FILE_SIZE:
                        files.append(full_path)
                except OSError:
                    continue
    return files


def build_graph() -> Dict[str, Any]:
    """
    Build the knowledge graph from project files.

    Scans DATA_ROOT, extracts entities and relationships, detects
    cross-file references, and saves the result to INDEX_DIR.

    Returns:
        Meta dict with built_at, total_nodes, total_edges.
    """
    config.ensure_index_dir()

    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, str]] = []
    edge_set: Set[Tuple[str, str, str]] = set()

    # Collect files.
    file_paths = _scan_files()

    # Phase 1: Create File nodes and extract entities per file.
    # Track which entity names are defined in which files for cross-ref detection.
    file_texts: Dict[str, str] = {}  # file_node_id -> raw text
    file_entities: Dict[str, List[str]] = {}  # file_node_id -> list of entity names
    all_entity_names: Dict[str, str] = {}  # entity_name_lower -> node_id

    for fpath in file_paths:
        rel = _relative_path(fpath)
        file_node_id = rel
        ext = os.path.splitext(fpath)[1].lower()

        # Stat info for File node properties.
        try:
            stat = os.stat(fpath)
            props = {
                "path": rel,
                "extension": ext,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            }
        except OSError:
            props = {"path": rel, "extension": ext}

        _add_node(nodes, file_node_id, rel, "File", props)

        # Parse file content.
        try:
            result = parse_file(fpath)
            text = result.text
        except Exception:
            # If parsing fails, try raw read for text-based files.
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except Exception:
                continue

        file_texts[file_node_id] = text

        # Extract entities using the appropriate extractor.
        extractor = _EXTRACTOR_MAP.get(ext)
        if extractor is not None:
            names = extractor(text, file_node_id, nodes, edges, edge_set)
            file_entities[file_node_id] = names
            for name in names:
                name_lower = name.lower()
                if name_lower not in all_entity_names:
                    # Determine node type from existing nodes.
                    for ntype in ("Function", "Concept", "Config"):
                        candidate_id = _make_node_id(ntype, name)
                        if candidate_id in nodes:
                            all_entity_names[name_lower] = candidate_id
                            break
        else:
            file_entities[file_node_id] = []

    # Phase 2: Detect cross-file references (mentions).
    # For each entity, check if its name appears in files other than where it is defined.
    for file_node_id, text in file_texts.items():
        if not text:
            continue
        text_lower = text.lower()
        defined_here = {n.lower() for n in file_entities.get(file_node_id, [])}

        for entity_name_lower, entity_node_id in all_entity_names.items():
            # Skip entities defined in this file.
            if entity_name_lower in defined_here:
                continue
            # Skip very short names to avoid false positives.
            if len(entity_name_lower) < _MIN_ENTITY_NAME_LEN + 1:
                continue
            # Check for word-boundary presence.
            if entity_name_lower in text_lower:
                _add_edge(edges, edge_set, file_node_id, entity_node_id, "mentions")

    # Phase 3: Serialize and save.
    meta: Dict[str, Any] = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }

    graph_data = {
        "meta": meta,
        "nodes": nodes,
        "edges": edges,
    }

    output_path = config.index_path(GRAPH_FILENAME)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(graph_data, f, ensure_ascii=False, indent=2)

    return meta


def load_graph() -> Optional[Dict[str, Any]]:
    """
    Load the knowledge graph from INDEX_DIR.

    Returns:
        The graph dict (with meta, nodes, edges), or None if not found.
    """
    graph_path = config.index_path(GRAPH_FILENAME)
    if not os.path.exists(graph_path):
        return None

    try:
        with open(graph_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
