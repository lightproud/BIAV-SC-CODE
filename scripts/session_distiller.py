#!/usr/bin/env python3
"""
session_distiller.py — Claude Code SessionEnd transcript distiller (v0.4 md+meta).

Reads a Claude Code session JSONL transcript and writes:
1. A human-readable Markdown conversation record (.md)
2. A structured metadata file (.meta.json) for machine consumption

The .meta.json enables the Memory Flywheel: session continuity chain,
MemRL engagement tracking, and REM cross-session intelligence.

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
import re
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


# ============================================================
# Structured metadata extraction (P0: Memory Flywheel)
# ============================================================

# Decision-related patterns (Chinese + English)
_DECISION_PATTERNS = [
    re.compile(r'(?:选择|采用|改为|替代|决定|选用|换成|换用|改用|选了|迁移到|升级到)\s*(.{2,100})'),
    re.compile(r'(?:chose|selected|switched to|replaced .{2,30} with|decided to|upgraded to)\s+(.{2,100})', re.I),
]

# Open item patterns
_OPEN_ITEM_PATTERNS = [
    re.compile(r'(?:还需要|待完成|遗留|TODO|未完成|下一步|后续)\s*[:：]?\s*(.{5,100})'),
    re.compile(r'(?:still need|remaining|TODO|left to do|next step)\s*[:：]?\s*(.{5,100})', re.I),
]


def _load_entity_dict() -> dict[str, str]:
    """Load entity dictionary from knowledge graph for topic extraction.

    Returns {surface_form: entity_id} mapping.
    Falls back to a minimal built-in dict if knowledge_graph is unavailable.
    """
    try:
        scripts_dir = Path(__file__).resolve().parent
        sys.path.insert(0, str(scripts_dir))
        from knowledge_graph import _build_entity_dict
        return _build_entity_dict()
    except Exception:
        # Minimal fallback — most important concepts
        return {
            "银芯": "system:银芯", "BIAV-SC": "system:银芯",
            "黑池": "system:黑池", "Wiki": "system:Wiki",
            "BPT": "concept:BPT", "MCP": "concept:MCP",
            "TF-IDF": "concept:TF-IDF", "记忆系统": "concept:记忆系统",
            "知识图谱": "concept:知识图谱", "索引": "concept:索引",
            "做梦": "system:做梦Agent", "日报": "system:日报",
        }


def extract_structured_metadata(raw_metadata: dict) -> dict:
    """Extract structured metadata from raw distill() output.

    Produces machine-readable session summary for:
    - Session continuity chain (P1)
    - MemRL engagement tracking (P3)
    - REM cross-session intelligence (P4)
    """
    # --- Topic extraction ---
    entity_dict = _load_entity_dict()
    topic_counts: Counter = Counter()

    # Scan user prompts + assistant texts for entity mentions
    all_text = ' '.join(raw_metadata.get('user_prompts_sample', []))
    all_text += ' ' + ' '.join(raw_metadata.get('assistant_texts_sample', []))
    # Also scan bash descriptions for context
    all_text += ' ' + ' '.join(raw_metadata.get('bash_descriptions', []))

    for surface, eid in entity_dict.items():
        if len(surface) < 2:
            continue
        count = all_text.count(surface)
        if count > 0:
            # Use entity_id as canonical topic name, strip type prefix
            topic_name = eid.split(':', 1)[-1] if ':' in eid else eid
            topic_counts[topic_name] += count

    # Top topics (filter noise: only keep topics mentioned 2+ times)
    topics = [t for t, c in topic_counts.most_common(15) if c >= 2]

    # --- Decision extraction ---
    decisions = []
    user_texts = raw_metadata.get('user_prompts_sample', [])
    asst_texts = raw_metadata.get('assistant_texts_sample', [])
    for text in user_texts + asst_texts:
        if len(decisions) >= 10:
            break
        for pat in _DECISION_PATTERNS:
            for m in pat.finditer(text):
                content = m.group(1).strip().rstrip('。.，,')
                if len(content) >= 5 and content not in [d['content'] for d in decisions]:
                    decisions.append({'content': content[:120], 'source': 'conversation'})
                    if len(decisions) >= 10:
                        break
            if len(decisions) >= 10:
                break

    # --- Files engagement ladder ---
    files_data = raw_metadata.get('files', {})
    read_set = set(files_data.get('read', []))
    edited_set = set(files_data.get('edited', []))
    written_set = set(files_data.get('written', []))

    # Infer committed files: if session had any git commit, files that were
    # both edited AND written (via Edit/Write tools) are likely committed.
    # This is a heuristic — we can't perfectly track which files were in
    # which commit from bash descriptions alone.
    has_commit = any(
        'commit' in desc.lower()
        for desc in raw_metadata.get('bash_descriptions', [])
    )
    # Only mark files committed if they were actively edited (not just read)
    committed_set = (edited_set | written_set) if has_commit else set()

    engagement = {}
    all_files = read_set | edited_set | written_set
    for fp in all_files:
        level = 'read_only'
        if fp in written_set or fp in edited_set:
            level = 'read_and_edited'
            if fp in committed_set:
                level = 'read_edit_commit'
        engagement[fp] = level

    # --- Open items extraction ---
    open_items = []
    # Check last few assistant texts for unfinished items
    last_texts = asst_texts[-5:] if len(asst_texts) > 5 else asst_texts
    for text in last_texts:
        if len(open_items) >= 5:
            break
        for pat in _OPEN_ITEM_PATTERNS:
            for m in pat.finditer(text):
                item = m.group(1).strip().rstrip('。.，,')
                if len(item) >= 5 and item not in open_items:
                    open_items.append(item[:150])
                    if len(open_items) >= 5:
                        break
            if len(open_items) >= 5:
                break

    # --- Build structured metadata ---
    duration_s = raw_metadata.get('duration_seconds')
    return {
        'schema_version': 1,
        'session_id': raw_metadata['session_id'],
        'timestamp_range': [
            raw_metadata.get('earliest_ts'),
            raw_metadata.get('latest_ts'),
        ],
        'duration_minutes': round(duration_s / 60, 1) if duration_s else None,
        'git_branches': raw_metadata.get('git_branches', []),
        'topics': topics,
        'decisions': decisions,
        'open_items': open_items,
        'files_engagement': engagement,
        'key_files': sorted(edited_set | written_set)[:20],
        'search_queries': [],  # Populated if search tool calls detected
        'turns': raw_metadata.get('turns', {}),
        'tool_calls': raw_metadata.get('tool_calls', {}),
        'user_prompts_digest': [p[:200] for p in raw_metadata.get('user_prompts_sample', [])[:20]],
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


def update_session_continuity(structured_meta: dict, cwd: str):
    """Update memory/session-continuity.json with latest session info.

    Maintains a rolling window of recent sessions + accumulated momentum.
    """
    repo = Path(cwd)
    continuity_file = repo / 'memory' / 'session-continuity.json'

    existing = {'last_session': None, 'recent_sessions': [], 'momentum': {
        'topic_weights': {}, 'hot_files': [], 'total_sessions': 0,
    }}
    if continuity_file.exists():
        try:
            existing = json.loads(continuity_file.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, OSError):
            pass

    # Build session summary
    session_summary = {
        'id': structured_meta.get('session_id', '')[:8],
        'timestamp': structured_meta.get('timestamp_range', [None, None])[1],
        'duration_minutes': structured_meta.get('duration_minutes'),
        'branch': (structured_meta.get('git_branches') or [''])[0],
        'topics': structured_meta.get('topics', []),
        'decisions': [d['content'] for d in structured_meta.get('decisions', [])],
        'files_changed': structured_meta.get('key_files', []),
        'open_items': structured_meta.get('open_items', []),
    }

    # Shift previous last_session into recent_sessions
    recent = existing.get('recent_sessions', [])
    if existing.get('last_session'):
        recent.insert(0, existing['last_session'])
    recent = recent[:9]  # Keep last 10 (including new last_session)

    # Update momentum
    momentum = existing.get('momentum', {'topic_weights': {}, 'hot_files': [], 'total_sessions': 0})
    topic_weights = momentum.get('topic_weights', {})

    # Decay all existing weights by 0.8
    for k in list(topic_weights.keys()):
        topic_weights[k] = round(topic_weights[k] * 0.8, 2)
        if topic_weights[k] < 0.1:
            del topic_weights[k]

    # Add current session topics
    for topic in structured_meta.get('topics', []):
        topic_weights[topic] = round(topic_weights.get(topic, 0) + 1.0, 2)

    # Hot files: files changed in recent sessions (frequency-based)
    file_counter: Counter = Counter()
    for s in [session_summary] + recent[:4]:
        for f in s.get('files_changed', []):
            file_counter[f] += 1
    hot_files = [f for f, _ in file_counter.most_common(10) if _ >= 2]

    updated = {
        'last_session': session_summary,
        'recent_sessions': recent,
        'momentum': {
            'topic_weights': dict(sorted(topic_weights.items(), key=lambda x: x[1], reverse=True)[:20]),
            'hot_files': hot_files,
            'total_sessions': momentum.get('total_sessions', 0) + 1,
        },
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }

    continuity_file.parent.mkdir(parents=True, exist_ok=True)
    continuity_file.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    return continuity_file


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

    # 1. Markdown conversation record
    md_path = args.digest_dir / f'{base}.md'
    md_text = render_markdown(args.transcript, args.session_id, metadata)
    md_path.write_text(md_text, encoding='utf-8')

    # 2. Structured metadata (P0: Memory Flywheel)
    structured = extract_structured_metadata(metadata)
    meta_path = args.digest_dir / f'{base}.meta.json'
    meta_path.write_text(
        json.dumps(structured, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    # 3. Update session continuity chain (P1)
    try:
        cont_path = update_session_continuity(structured, args.cwd)
        print(f'Updated: {cont_path.name}')
    except Exception as e:
        print(f'WARNING: continuity update failed: {e}', file=sys.stderr)

    print(f'Wrote: {md_path.name} + {meta_path.name}')
    print(
        f'  turns: user={metadata["turns"]["user"]} '
        f'assistant={metadata["turns"]["assistant"]} '
        f'tools={sum(metadata["tool_calls"].values())} '
        f'files: read={metadata["files"]["read_count"]} '
        f'edit={metadata["files"]["edited_count"]} '
        f'write={metadata["files"]["written_count"]}'
    )
    print(f'  topics: {", ".join(structured["topics"][:5]) or "(none detected)"}')
    print(f'  decisions: {len(structured["decisions"])}')
    print(f'  open items: {len(structured["open_items"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
