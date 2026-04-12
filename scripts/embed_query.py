#!/usr/bin/env python3
"""
embed_query.py -- Embed a query string using bge-m3 and output the vector as JSON.

Why a separate script: The Electron main process needs query embeddings for
BPE vector search, but bge-m3 runs in Python (sentence-transformers).
This script is spawned as a subprocess; it loads the model once per invocation,
embeds the query, and prints a JSON array of floats to stdout.

Usage:
    python scripts/embed_query.py --model-path models/bge-m3 --query "search text"

Output (stdout):
    {"embedding": [0.123, -0.456, ...], "dimension": 1024}
"""

import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description='Embed a query string using bge-m3')
    parser.add_argument('--model-path', required=True, help='Path to bge-m3 model directory')
    parser.add_argument('--query', required=True, help='Query text to embed')
    args = parser.parse_args()

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print(json.dumps({'error': 'sentence-transformers not installed'}))
        sys.exit(1)

    try:
        model = SentenceTransformer(args.model_path)
        # bge-m3 max 8192 tokens; truncate input for safety
        query_text = args.query[:8192]
        embedding = model.encode(query_text, normalize_embeddings=True)

        result = {
            'embedding': embedding.tolist(),
            'dimension': len(embedding),
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
