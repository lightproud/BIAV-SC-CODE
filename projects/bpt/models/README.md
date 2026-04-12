# BPE Embedding Model

> **Phase 0.5**: This directory will contain the `BAAI/bge-m3` model files for local embedding.

## Setup (when ready)

```bash
# Download bge-m3 model (2.2GB)
pip install sentence-transformers
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3', cache_folder='.')"
```

## Why bge-m3

- Chinese + code + 8192 token context
- MIT license
- CPU-runnable
- Supports dense + sparse dual retrieval

## Distribution

Model files are distributed via SVN. First `svn checkout` downloads them; subsequent `svn update` skips unchanged files.
