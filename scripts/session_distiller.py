#!/usr/bin/env python3
"""
session_distiller.py — Claude Code SessionEnd transcript distiller (v0.1 structural).

Reads a Claude Code session JSONL transcript and writes a structured digest
to memory/session-digests/. This version does NO API calls — it only does
structural parsing, so we can verify the hook plumbing works before spending
tokens on LLM inference.

Called by .claude/session-end-distill.sh when SessionEnd fires.

Usage:
    python scripts/session_distiller.py \\
        --transcript /root/.claude/projects/.../XXX.jsonl \\
        --session-id XXX \\
        --digest-dir memory/session-digests \\
        --cwd /home/user/brain-in-a-vat
"""

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def parse_timestamp(ts: str):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except ValueError:
        return None


def distill(transcript_path: Path, session_id: str, cwd: str) -> dict:
    turns = {'user': 0, 'assistant': 0}
    tool_calls: Counter = Counter()
    files_read: set = set()
    files_edited: set = set()
    files_written: set = set()
    bash_descriptions: list = []
    user_prompts: list = []
    assistant_texts: list = []
    thinking_count = 0
    thinking_chars = 0

    earliest = None
    latest = None
    git_branches: set = set()
    compact_events = 0
    total_lines = 0
    parse_errors = 0

    with open(transcript_path, encoding='utf-8') as f:
        for line in f:
            total_lines += 1
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                parse_errors += 1
                continue

            etype = entry.get('type')
            ts = parse_timestamp(entry.get('timestamp', ''))
            if ts:
                if earliest is None or ts < earliest:
                    earliest = ts
                if latest is None or ts > latest:
                    latest = ts

            gb = entry.get('gitBranch')
            if gb:
                git_branches.add(gb)

            if etype == 'system':
                if entry.get('subtype') == 'compact_boundary':
                    compact_events += 1
                continue

            if etype == 'user':
                turns['user'] += 1
                msg = entry.get('message', {}) or {}
                content = msg.get('content')
                # Real user prompts are strings; tool_result items come as lists
                if isinstance(content, str):
                    text = content.strip()
                    # Skip system-reminder and tool-injected content
                    if text and not text.startswith('<'):
                        user_prompts.append(text[:500])
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            text = (item.get('text') or '').strip()
                            if text and not text.startswith('<'):
                                user_prompts.append(text[:500])
                continue

            if etype == 'assistant':
                turns['assistant'] += 1
                msg = entry.get('message', {}) or {}
                content = msg.get('content', [])
                if not isinstance(content, list):
                    continue
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    itype = item.get('type', '')
                    if itype == 'text':
                        text = (item.get('text') or '').strip()
                        if text:
                            assistant_texts.append(text[:400])
                    elif itype == 'thinking':
                        thinking_count += 1
                        thinking_chars += len(item.get('thinking') or '')
                    elif itype == 'tool_use':
                        name = item.get('name', '?')
                        tool_calls[name] += 1
                        tinput = item.get('input') or {}
                        if not isinstance(tinput, dict):
                            continue
                        if name == 'Read':
                            fp = tinput.get('file_path', '')
                            if fp:
                                files_read.add(fp)
                        elif name == 'Edit':
                            fp = tinput.get('file_path', '')
                            if fp:
                                files_edited.add(fp)
                        elif name == 'Write':
                            fp = tinput.get('file_path', '')
                            if fp:
                                files_written.add(fp)
                        elif name == 'Bash':
                            desc = tinput.get('description', '')
                            if desc:
                                bash_descriptions.append(desc[:120])

    duration_s = None
    if earliest and latest:
        duration_s = int((latest - earliest).total_seconds())

    return {
        'schema_version': 1,
        'distiller_version': 'v0.1-structural',
        'session_id': session_id,
        'cwd': cwd,
        'transcript_path': str(transcript_path),
        'transcript_size_bytes': transcript_path.stat().st_size,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'earliest_ts': earliest.isoformat() if earliest else None,
        'latest_ts': latest.isoformat() if latest else None,
        'duration_seconds': duration_s,
        'git_branches': sorted(git_branches),
        'compact_events': compact_events,
        'turns': turns,
        'thinking': {
            'blocks': thinking_count,
            'total_chars': thinking_chars,
        },
        'tool_calls': dict(tool_calls.most_common()),
        'files': {
            'read_count': len(files_read),
            'edited_count': len(files_edited),
            'written_count': len(files_written),
            'read': sorted(files_read)[:50],
            'edited': sorted(files_edited)[:50],
            'written': sorted(files_written)[:50],
        },
        'bash_descriptions': bash_descriptions[:30],
        'user_prompts_sample': user_prompts[:15],
        'assistant_texts_sample': [t[:200] for t in assistant_texts[:10]],
        'jsonl_stats': {
            'total_lines': total_lines,
            'parse_errors': parse_errors,
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--transcript', required=True, type=Path)
    ap.add_argument('--session-id', required=True)
    ap.add_argument('--digest-dir', required=True, type=Path)
    ap.add_argument('--cwd', required=True)
    args = ap.parse_args()

    if not args.transcript.exists():
        print(f'ERROR: transcript not found: {args.transcript}', file=sys.stderr)
        return 1

    digest = distill(args.transcript, args.session_id, args.cwd)

    args.digest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    sid_short = (args.session_id or 'unknown')[:8]
    out_path = args.digest_dir / f'{stamp}-{sid_short}.json'
    out_path.write_text(
        json.dumps(digest, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'Wrote digest: {out_path}')
    print(
        f'  turns: user={digest["turns"]["user"]} '
        f'assistant={digest["turns"]["assistant"]} '
        f'tools={sum(digest["tool_calls"].values())} '
        f'files: read={digest["files"]["read_count"]} '
        f'edit={digest["files"]["edited_count"]} '
        f'write={digest["files"]["written_count"]}'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
