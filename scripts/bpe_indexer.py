#!/usr/bin/env python3
"""
bpe_indexer.py — Black Pool Explorer Index Builder.

Scans a repository, chunks code and config files, builds FTS5 keyword indexes
(and optionally bge-m3 vector indexes) into SQLite databases for BPE search.

Usage:
    # Full rebuild (FTS5 only, no model needed)
    python scripts/bpe_indexer.py --repo /path/to/black-pool --output projects/bpt/.bpe-index

    # Incremental update (only changed files)
    python scripts/bpe_indexer.py --repo /path/to/black-pool --output projects/bpt/.bpe-index --incremental

    # With vector embeddings (requires bge-m3 model)
    python scripts/bpe_indexer.py --repo /path/to/black-pool --output projects/bpt/.bpe-index --embed --model-path models/bge-m3

Output:
    chunks.db    — chunk text + metadata (file, line range, language)
    keywords.db  — FTS5 full-text search index
    vectors.db   — (optional) sqlite-vss vector index

Chunking strategy:
    - Code files (*.cs, *.lua, *.py, *.js, *.ts): by function/class via tree-sitter (if available), else by line window
    - Config JSON: by top-level key or array element
    - Config Lua tables: by top-level table entry
    - CSV: by N-row groups
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Optional

# ── Configuration ────────────────────────────────────────────────

# File extensions to index
CODE_EXTENSIONS = {'.cs', '.lua', '.py', '.js', '.ts', '.jsx', '.tsx'}
CONFIG_EXTENSIONS = {'.json', '.csv'}
LUA_CONFIG_PATTERN = re.compile(r'(config|data|table|def).*\.lua$', re.IGNORECASE)

# Directories to skip
SKIP_DIRS = {
    '.git', '.svn', 'node_modules', '__pycache__', '.venv', 'venv',
    'dist', 'build', 'out', '.bpe-index', 'models', '.next',
    'dist-electron', 'packages',
}

# Max file size to process (2MB)
MAX_FILE_SIZE = 2 * 1024 * 1024

# Line-based chunking defaults
CHUNK_LINES = 30       # lines per chunk for code
CHUNK_OVERLAP = 5      # overlap lines between chunks
CSV_CHUNK_ROWS = 50    # rows per chunk for CSV files


# ── Chunking ─────────────────────────────────────────────────────

class Chunk:
    """A single indexed chunk of text."""
    __slots__ = ('file', 'line_start', 'line_end', 'text', 'language', 'hash')

    def __init__(self, file: str, line_start: int, line_end: int, text: str, language: str):
        self.file = file
        self.line_start = line_start
        self.line_end = line_end
        self.text = text
        self.language = language
        self.hash = hashlib.md5(f"{file}:{line_start}:{text[:200]}".encode()).hexdigest()


def detect_language(filepath: str) -> str:
    """Detect programming language from file extension."""
    ext = Path(filepath).suffix.lower()
    lang_map = {
        '.cs': 'csharp', '.lua': 'lua', '.py': 'python',
        '.js': 'javascript', '.ts': 'typescript', '.jsx': 'javascript',
        '.tsx': 'typescript', '.json': 'json', '.csv': 'csv',
    }
    return lang_map.get(ext, 'unknown')


def chunk_by_lines(text: str, filepath: str, language: str,
                   chunk_size: int = CHUNK_LINES,
                   overlap: int = CHUNK_OVERLAP) -> list[Chunk]:
    """Chunk text by fixed line windows with overlap."""
    lines = text.split('\n')
    chunks = []
    i = 0
    while i < len(lines):
        end = min(i + chunk_size, len(lines))
        chunk_text = '\n'.join(lines[i:end])
        if chunk_text.strip():
            chunks.append(Chunk(
                file=filepath,
                line_start=i + 1,
                line_end=end,
                text=chunk_text,
                language=language,
            ))
        i += chunk_size - overlap
    return chunks


def chunk_json_config(text: str, filepath: str) -> list[Chunk]:
    """Chunk JSON config by top-level keys or array elements."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return chunk_by_lines(text, filepath, 'json')

    chunks = []
    if isinstance(data, dict):
        for key, value in data.items():
            chunk_text = json.dumps({key: value}, ensure_ascii=False, indent=2)
            if len(chunk_text) > MAX_FILE_SIZE:
                chunk_text = chunk_text[:MAX_FILE_SIZE]
            chunks.append(Chunk(
                file=filepath, line_start=1, line_end=1,
                text=f"// key: {key}\n{chunk_text}",
                language='json',
            ))
    elif isinstance(data, list):
        # Chunk array into groups of 20 elements
        for i in range(0, len(data), 20):
            batch = data[i:i+20]
            chunk_text = json.dumps(batch, ensure_ascii=False, indent=2)
            chunks.append(Chunk(
                file=filepath, line_start=i+1, line_end=min(i+20, len(data)),
                text=chunk_text,
                language='json',
            ))
    else:
        chunks.append(Chunk(
            file=filepath, line_start=1, line_end=1,
            text=json.dumps(data, ensure_ascii=False, indent=2),
            language='json',
        ))

    return chunks


def chunk_csv(text: str, filepath: str) -> list[Chunk]:
    """Chunk CSV by row groups, keeping header with each chunk."""
    lines = text.split('\n')
    if len(lines) < 2:
        return [Chunk(file=filepath, line_start=1, line_end=len(lines), text=text, language='csv')]

    header = lines[0]
    data_lines = lines[1:]
    chunks = []
    for i in range(0, len(data_lines), CSV_CHUNK_ROWS):
        batch = data_lines[i:i+CSV_CHUNK_ROWS]
        chunk_text = header + '\n' + '\n'.join(batch)
        if chunk_text.strip():
            chunks.append(Chunk(
                file=filepath,
                line_start=i + 2,  # +2 for header + 0-index
                line_end=min(i + CSV_CHUNK_ROWS + 1, len(lines)),
                text=chunk_text,
                language='csv',
            ))
    return chunks


def chunk_lua_config(text: str, filepath: str) -> list[Chunk]:
    """Chunk Lua config tables by top-level entries."""
    # Simple heuristic: split on lines that start with a key assignment pattern
    # like `key = {` or `["key"] = {`
    pattern = re.compile(r'^(\s*(?:\[?"?\w+"?\]?\s*=\s*\{))', re.MULTILINE)
    matches = list(pattern.finditer(text))

    if not matches:
        return chunk_by_lines(text, filepath, 'lua')

    chunks = []
    lines = text.split('\n')
    for idx, match in enumerate(matches):
        start_line = text[:match.start()].count('\n')
        if idx + 1 < len(matches):
            end_pos = matches[idx + 1].start()
        else:
            end_pos = len(text)
        end_line = text[:end_pos].count('\n')

        chunk_text = '\n'.join(lines[start_line:end_line + 1])
        if chunk_text.strip():
            chunks.append(Chunk(
                file=filepath,
                line_start=start_line + 1,
                line_end=end_line + 1,
                text=chunk_text,
                language='lua',
            ))

    return chunks if chunks else chunk_by_lines(text, filepath, 'lua')


def try_treesitter_chunk(text: str, filepath: str, language: str) -> Optional[list[Chunk]]:
    """Try to chunk using tree-sitter for semantic boundaries.
    Returns None if tree-sitter is not available or fails."""
    try:
        import tree_sitter
    except ImportError:
        return None

    # Map language to tree-sitter grammar
    lang_map = {
        'python': 'python',
        'javascript': 'javascript',
        'typescript': 'typescript',
        'csharp': 'c_sharp',
        'lua': 'lua',
    }

    ts_lang = lang_map.get(language)
    if not ts_lang:
        return None

    try:
        # Try to load the language
        lang_module = __import__(f'tree_sitter_{ts_lang}')
        lang = tree_sitter.Language(lang_module.language())
        parser = tree_sitter.Parser(lang)
        tree = parser.parse(text.encode('utf-8'))

        chunks = []
        lines = text.split('\n')

        # Extract top-level function/class/method definitions
        query_patterns = {
            'python': '(function_definition) @fn (class_definition) @cls',
            'javascript': '(function_declaration) @fn (class_declaration) @cls (method_definition) @method',
            'typescript': '(function_declaration) @fn (class_declaration) @cls (method_definition) @method',
            'c_sharp': '(method_declaration) @method (class_declaration) @cls',
            'lua': '(function_declaration) @fn (function_definition) @fndef',
        }

        pattern = query_patterns.get(ts_lang)
        if not pattern:
            return None

        query = lang.query(pattern)
        matches = query.matches(tree.root_node)

        for _, captures in matches:
            for node_list in captures.values():
                for node in (node_list if isinstance(node_list, list) else [node_list]):
                    start_line = node.start_point[0]
                    end_line = node.end_point[0]
                    chunk_text = '\n'.join(lines[start_line:end_line + 1])
                    if chunk_text.strip() and len(chunk_text) > 20:
                        chunks.append(Chunk(
                            file=filepath,
                            line_start=start_line + 1,
                            line_end=end_line + 1,
                            text=chunk_text,
                            language=language,
                        ))

        return chunks if chunks else None

    except Exception:
        return None


def chunk_file(filepath: str, text: str) -> list[Chunk]:
    """Chunk a file based on its type."""
    ext = Path(filepath).suffix.lower()
    language = detect_language(filepath)

    # CSV files
    if ext == '.csv':
        return chunk_csv(text, filepath)

    # JSON config files
    if ext == '.json':
        return chunk_json_config(text, filepath)

    # Lua config files (matched by name pattern)
    if ext == '.lua' and LUA_CONFIG_PATTERN.search(filepath):
        return chunk_lua_config(text, filepath)

    # Code files — try tree-sitter first, fall back to line-based
    if ext in CODE_EXTENSIONS:
        ts_chunks = try_treesitter_chunk(text, filepath, language)
        if ts_chunks:
            return ts_chunks
        return chunk_by_lines(text, filepath, language)

    # Anything else — line-based
    return chunk_by_lines(text, filepath, language)


# ── File scanner ─────────────────────────────────────────────────

def should_index(filepath: str) -> bool:
    """Check if a file should be indexed."""
    ext = Path(filepath).suffix.lower()
    if ext in CODE_EXTENSIONS or ext in CONFIG_EXTENSIONS:
        return True
    if ext == '.lua':
        return True
    return False


def scan_repo(repo_root: str) -> list[str]:
    """Scan repository for indexable files."""
    files = []
    for dirpath, dirnames, filenames in os.walk(repo_root):
        # Skip excluded directories
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(filepath, repo_root)

            if not should_index(rel_path):
                continue

            try:
                size = os.path.getsize(filepath)
                if size > MAX_FILE_SIZE:
                    continue
                if size == 0:
                    continue
            except OSError:
                continue

            files.append(rel_path)

    return files


# ── Database operations ──────────────────────────────────────────

def create_chunks_db(db_path: str) -> sqlite3.Connection:
    """Create or reset the chunks database."""
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file TEXT NOT NULL,
            line_start INTEGER NOT NULL,
            line_end INTEGER NOT NULL,
            text TEXT NOT NULL,
            language TEXT NOT NULL,
            hash TEXT NOT NULL UNIQUE
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_chunks_lang ON chunks(language)')
    return conn


def create_keywords_db(db_path: str) -> sqlite3.Connection:
    """Create or reset the keywords FTS5 database."""
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS keywords_fts USING fts5(
            file, text, language,
            content='',
            tokenize='unicode61'
        )
    ''')
    return conn


def build_index(repo_root: str, output_dir: str, incremental: bool = False) -> dict:
    """Build the BPE index from a repository."""
    os.makedirs(output_dir, exist_ok=True)

    chunks_db_path = os.path.join(output_dir, 'chunks.db')
    keywords_db_path = os.path.join(output_dir, 'keywords.db')

    # Get existing hashes for incremental mode
    existing_hashes: set[str] = set()
    if incremental and os.path.exists(chunks_db_path):
        conn = sqlite3.connect(chunks_db_path)
        existing_hashes = {row[0] for row in conn.execute('SELECT hash FROM chunks').fetchall()}
        conn.close()

    chunks_conn = create_chunks_db(chunks_db_path)
    keywords_conn = create_keywords_db(keywords_db_path)

    # Scan and process files
    files = scan_repo(repo_root)
    stats = {
        'files_scanned': len(files),
        'files_processed': 0,
        'chunks_created': 0,
        'chunks_skipped': 0,
        'errors': 0,
    }

    print(f"Scanning {len(files)} files in {repo_root}...")

    for i, rel_path in enumerate(files):
        if (i + 1) % 100 == 0:
            print(f"  Processing {i + 1}/{len(files)}...")

        filepath = os.path.join(repo_root, rel_path)
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                text = f.read()
        except Exception as e:
            print(f"  Error reading {rel_path}: {e}")
            stats['errors'] += 1
            continue

        chunks = chunk_file(rel_path, text)
        stats['files_processed'] += 1

        for chunk in chunks:
            if incremental and chunk.hash in existing_hashes:
                stats['chunks_skipped'] += 1
                continue

            # Insert into chunks.db
            try:
                chunks_conn.execute(
                    'INSERT OR IGNORE INTO chunks (file, line_start, line_end, text, language, hash) VALUES (?, ?, ?, ?, ?, ?)',
                    (chunk.file, chunk.line_start, chunk.line_end, chunk.text, chunk.language, chunk.hash),
                )
            except sqlite3.IntegrityError:
                stats['chunks_skipped'] += 1
                continue

            # Get the rowid for FTS5
            cursor = chunks_conn.execute('SELECT id FROM chunks WHERE hash = ?', (chunk.hash,))
            row = cursor.fetchone()
            if row:
                rowid = row[0]
                keywords_conn.execute(
                    'INSERT INTO keywords_fts (rowid, file, text, language) VALUES (?, ?, ?, ?)',
                    (rowid, chunk.file, chunk.text, chunk.language),
                )
                stats['chunks_created'] += 1

    chunks_conn.commit()
    keywords_conn.commit()
    chunks_conn.close()
    keywords_conn.close()

    return stats


# ── Embedding (optional, Phase 0.5) ─────────────────────────────

def build_vectors(output_dir: str, model_path: str) -> dict:
    """Build vector embeddings for all chunks using bge-m3.
    Phase 0.5 — requires: pip install sentence-transformers sqlite-vss"""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("ERROR: sentence-transformers not installed. Run: pip install sentence-transformers")
        return {'error': 'sentence-transformers not installed'}

    chunks_db_path = os.path.join(output_dir, 'chunks.db')
    vectors_db_path = os.path.join(output_dir, 'vectors.db')

    if not os.path.exists(chunks_db_path):
        return {'error': 'chunks.db not found. Run without --embed first.'}

    print(f"Loading model from {model_path}...")
    model = SentenceTransformer(model_path)

    # Read all chunks
    conn = sqlite3.connect(chunks_db_path)
    rows = conn.execute('SELECT id, text FROM chunks').fetchall()
    conn.close()

    print(f"Embedding {len(rows)} chunks...")

    # Batch encode
    texts = [row[1][:8192] for row in rows]  # bge-m3 max 8192 tokens
    ids = [row[0] for row in rows]

    embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)

    # Store in vectors.db
    vec_conn = sqlite3.connect(vectors_db_path)
    vec_conn.execute('PRAGMA journal_mode = WAL')
    vec_conn.execute('''
        CREATE TABLE IF NOT EXISTS vectors (
            chunk_id INTEGER PRIMARY KEY,
            embedding BLOB NOT NULL
        )
    ''')

    for chunk_id, embedding in zip(ids, embeddings):
        vec_conn.execute(
            'INSERT OR REPLACE INTO vectors (chunk_id, embedding) VALUES (?, ?)',
            (chunk_id, embedding.tobytes()),
        )

    vec_conn.commit()
    vec_conn.close()

    return {'chunks_embedded': len(rows), 'dimension': embeddings[0].shape[0]}


# ── CLI ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='BPE Index Builder — chunk code/config and build search indexes',
    )
    parser.add_argument('--repo', required=True, help='Path to repository root')
    parser.add_argument('--output', required=True, help='Output directory for index files')
    parser.add_argument('--incremental', action='store_true', help='Only process new/changed files')
    parser.add_argument('--embed', action='store_true', help='Build vector embeddings (requires bge-m3)')
    parser.add_argument('--model-path', default='models/bge-m3', help='Path to bge-m3 model')
    args = parser.parse_args()

    if not os.path.isdir(args.repo):
        print(f"ERROR: Repository path does not exist: {args.repo}")
        sys.exit(1)

    start = time.time()

    # Build FTS5 index
    print("=== Building FTS5 keyword index ===")
    stats = build_index(args.repo, args.output, incremental=args.incremental)
    elapsed = time.time() - start

    print(f"\n=== Index build complete ({elapsed:.1f}s) ===")
    print(f"  Files scanned:   {stats['files_scanned']}")
    print(f"  Files processed: {stats['files_processed']}")
    print(f"  Chunks created:  {stats['chunks_created']}")
    print(f"  Chunks skipped:  {stats['chunks_skipped']}")
    print(f"  Errors:          {stats['errors']}")

    # Optional: build vector embeddings
    if args.embed:
        print("\n=== Building vector embeddings ===")
        vec_stats = build_vectors(args.output, args.model_path)
        print(f"  Vector stats: {vec_stats}")

    print(f"\nOutput: {args.output}/")
    print("  chunks.db    — chunk text + metadata")
    print("  keywords.db  — FTS5 keyword search index")
    if args.embed:
        print("  vectors.db   — vector embeddings")


if __name__ == '__main__':
    main()
