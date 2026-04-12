#!/usr/bin/env python3
"""
session_distiller.py — Claude Code SessionEnd transcript distiller (v0.2 archive).

Reads a Claude Code session JSONL transcript and writes three outputs to
memory/session-digests/:

  1. {stamp}-{sid}.json   — structural metadata index (turns, tools, files)
  2. {stamp}-{sid}.md     — human-readable Markdown conversation record
  3. {stamp}-{sid}.jsonl.gz — gzipped verbatim copy of the raw transcript

All three are committed to git as a public growth record. No API calls —
pure structural parsing + file copy.

Called by .claude/session-end-distill.sh when SessionEnd fires.

Usage:
    python scripts/session_distiller.py \\
        --transcript /root/.claude/projects/.../XXX.jsonl \\
        --session-id XXX \\
        --digest-dir memory/session-digests \\
        --cwd /home/user/brain-in-a-vat
"""

import argparse
import gzip
import json
import shutil
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
        'schema_version': 2,
        'distiller_version': 'v0.2-archive',
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


def _tool_summary(name: str, tinput: dict) -> str:
    """One-line summary of a tool_use call for the Markdown record."""
    if name == 'Bash':
        desc = tinput.get('description', '')
        cmd = tinput.get('command', '')
        if len(cmd) > 300:
            cmd = cmd[:300] + '...'
        parts = [f'`{desc}`'] if desc else []
        if cmd:
            parts.append(f'\n```bash\n{cmd}\n```')
        return ' '.join(parts) if not cmd else (parts[0] + parts[1] if desc else f'```bash\n{cmd}\n```')
    if name == 'Read':
        fp = tinput.get('file_path', '?')
        extra = []
        if tinput.get('offset') is not None:
            extra.append(f'offset={tinput["offset"]}')
        if tinput.get('limit') is not None:
            extra.append(f'limit={tinput["limit"]}')
        suffix = f' ({", ".join(extra)})' if extra else ''
        return f'`{fp}`{suffix}'
    if name in ('Edit', 'Write'):
        fp = tinput.get('file_path', '?')
        return f'`{fp}`'
    if name == 'Grep':
        return f'pattern=`{tinput.get("pattern", "")[:100]}`'
    if name == 'Glob':
        return f'pattern=`{tinput.get("pattern", "")[:100]}`'
    if name == 'TodoWrite':
        todos = tinput.get('todos', [])
        return f'{len(todos)} items'
    if name == 'Agent':
        return tinput.get('description', '') or tinput.get('prompt', '')[:120]
    # Generic fallback
    keys = list(tinput.keys())[:5]
    return f'({", ".join(keys)})' if keys else ''


def render_markdown(transcript_path: Path, session_id: str, metadata: dict) -> str:
    """Second pass over the JSONL: render a human-readable Markdown record."""
    lines: list[str] = []
    sid8 = session_id[:8]
    earliest = metadata.get('earliest_ts', '')
    latest = metadata.get('latest_ts', '')
    dur = metadata.get('duration_seconds')
    turns = metadata.get('turns', {})
    tools_total = sum(metadata.get('tool_calls', {}).values())

    lines.append(f'# Session `{sid8}` — {earliest[:10] if earliest else "unknown"}')
    lines.append('')
    lines.append(f'- **session_id**: `{session_id}`')
    lines.append(f'- **cwd**: `{metadata.get("cwd", "")}`')
    lines.append(f'- **time**: {earliest} .. {latest}')
    if dur is not None:
        m, s = divmod(dur, 60)
        lines.append(f'- **duration**: {m}m {s}s')
    lines.append(f'- **turns**: user={turns.get("user", 0)} / assistant={turns.get("assistant", 0)}')
    lines.append(f'- **tool calls**: {tools_total}')
    lines.append(f'- **compact events**: {metadata.get("compact_events", 0)}')
    lines.append('')
    lines.append('---')
    lines.append('')

    user_idx = 0
    asst_idx = 0

    with open(transcript_path, encoding='utf-8') as f:
        for raw_line in f:
            try:
                entry = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            etype = entry.get('type')
            ts_raw = entry.get('timestamp', '')
            ts_short = ts_raw[11:19] if len(ts_raw) >= 19 else ts_raw

            # --- system ---
            if etype == 'system':
                if entry.get('subtype') == 'compact_boundary':
                    lines.append('---')
                    lines.append('')
                    lines.append(f'*[compact boundary at {ts_short}]*')
                    lines.append('')
                    lines.append('---')
                    lines.append('')
                continue

            # --- user ---
            if etype == 'user':
                msg = entry.get('message', {}) or {}
                content = msg.get('content')
                text_blocks: list[str] = []
                if isinstance(content, str):
                    t = content.strip()
                    if t and not t.startswith('<'):
                        text_blocks.append(t)
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            t = (item.get('text') or '').strip()
                            if t and not t.startswith('<'):
                                text_blocks.append(t)
                if text_blocks:
                    user_idx += 1
                    lines.append(f'## User [{user_idx}] {ts_short}')
                    lines.append('')
                    for t in text_blocks:
                        lines.append(t)
                        lines.append('')
                continue

            # --- assistant ---
            if etype == 'assistant':
                msg = entry.get('message', {}) or {}
                content = msg.get('content', [])
                if not isinstance(content, list):
                    continue
                has_renderable = any(
                    isinstance(it, dict) and it.get('type') in ('text', 'thinking', 'tool_use')
                    for it in content
                )
                if not has_renderable:
                    continue

                asst_idx += 1
                lines.append(f'## Assistant [{asst_idx}] {ts_short}')
                lines.append('')

                for item in content:
                    if not isinstance(item, dict):
                        continue
                    itype = item.get('type', '')

                    if itype == 'thinking':
                        t = (item.get('thinking') or '').strip()
                        if t:
                            lines.append('<details><summary>thinking</summary>')
                            lines.append('')
                            lines.append(t)
                            lines.append('')
                            lines.append('</details>')
                            lines.append('')

                    elif itype == 'text':
                        t = (item.get('text') or '').strip()
                        if t:
                            lines.append(t)
                            lines.append('')

                    elif itype == 'tool_use':
                        name = item.get('name', '?')
                        tinput = item.get('input') or {}
                        if not isinstance(tinput, dict):
                            tinput = {}
                        summary = _tool_summary(name, tinput)
                        lines.append(f'> **{name}** {summary}')
                        lines.append('')
                continue

    return '\n'.join(lines)


def copy_transcript_gz(src: Path, dst: Path):
    """Gzip-copy the raw JSONL transcript for archival."""
    with open(src, 'rb') as fin, gzip.open(dst, 'wb', compresslevel=6) as fout:
        shutil.copyfileobj(fin, fout)


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

    metadata = distill(args.transcript, args.session_id, args.cwd)

    args.digest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    sid_short = (args.session_id or 'unknown')[:8]
    base = f'{stamp}-{sid_short}'

    # 1. JSON metadata index
    json_path = args.digest_dir / f'{base}.json'
    json_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )

    # 2. Markdown conversation record
    md_path = args.digest_dir / f'{base}.md'
    md_text = render_markdown(args.transcript, args.session_id, metadata)
    md_path.write_text(md_text, encoding='utf-8')

    # 3. Gzipped verbatim transcript copy
    gz_path = args.digest_dir / f'{base}.jsonl.gz'
    copy_transcript_gz(args.transcript, gz_path)

    gz_kb = gz_path.stat().st_size / 1024
    print(f'Wrote: {json_path.name} / {md_path.name} / {gz_path.name} ({gz_kb:.0f} KB)')
    print(
        f'  turns: user={metadata["turns"]["user"]} '
        f'assistant={metadata["turns"]["assistant"]} '
        f'tools={sum(metadata["tool_calls"].values())} '
        f'files: read={metadata["files"]["read_count"]} '
        f'edit={metadata["files"]["edited_count"]} '
        f'write={metadata["files"]["written_count"]}'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
