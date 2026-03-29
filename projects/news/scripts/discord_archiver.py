#!/usr/bin/env python3
"""
Discord 全量数据归档器
按频道/日期结构化存储所有消息，支持增量抓取。

存储结构:
  assets/data/discord/
  ├── guild_meta.json          # 服务器元信息（频道列表、角色等）
  ├── channels/
  │   ├── {channel_id}/
  │   │   ├── meta.json        # 频道元信息
  │   │   ├── 2026-03-29.jsonl # 按天分片的消息（一行一条）
  │   │   └── 2026-03-28.jsonl
  │   └── ...
  ├── threads/
  │   ├── {thread_id}.jsonl    # 线程内所有消息
  │   └── ...
  ├── members.json             # 成员信息快照
  ├── activity_daily/
  │   └── 2026-03-29.json      # 每日活跃度统计
  └── state.json               # 增量抓取游标状态

数据分类:
  1. 原始消息 (channels/*.jsonl) - 全量保存，按天分片
  2. 线程/论坛帖 (threads/*.jsonl) - 按线程ID存储
  3. 成员快照 (members.json) - 定期更新
  4. 每日统计 (activity_daily/*.json) - 聚合分析数据
  5. 抓取状态 (state.json) - 每个频道的最后消息ID

使用方式:
  python projects/news/scripts/discord_archiver.py
"""

import json
import os
import time
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).parent.parent.parent.parent
DISCORD_DATA_DIR = _REPO_ROOT / 'assets' / 'data' / 'discord'
STATE_PATH = DISCORD_DATA_DIR / 'state.json'

# Rate limit: stay well under 50 req/s
REQUEST_DELAY = 1.2  # seconds between requests (conservative)
MAX_RUNTIME_SECONDS = 45 * 60  # 45 min hard limit (GitHub Actions safe margin)
MAX_MESSAGES_PER_CHANNEL = 5000  # per run, prevents first-run from running forever


# ============================================================
# HTTP Helper (reuse from aggregator)
# ============================================================

def request_with_retry(method, url, max_retries=3, backoff_base=2, **kwargs):
    """HTTP request with exponential backoff, respects Discord rate limits."""
    import requests

    kwargs.setdefault('timeout', 15)
    last_exc = None

    for attempt in range(max_retries + 1):
        try:
            resp = requests.request(method, url, **kwargs)
            # Handle Discord rate limits
            if resp.status_code == 429:
                retry_after = max(resp.json().get('retry_after', 5), 2.0)
                logger.warning(f'Rate limited, waiting {retry_after}s...')
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp
        except requests.exceptions.ConnectionError as e:
            last_exc = e
            logger.warning(f'Connection error (attempt {attempt + 1}): {e}')
        except requests.exceptions.Timeout as e:
            last_exc = e
            logger.warning(f'Timeout (attempt {attempt + 1}): {e}')
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else 0
            if status in (500, 502, 503, 504):
                last_exc = e
                logger.warning(f'HTTP {status} (attempt {attempt + 1}): {e}')
            else:
                raise

        if attempt < max_retries:
            wait = backoff_base ** attempt
            time.sleep(wait)

    raise last_exc


# ============================================================
# Discord API Client
# ============================================================

class DiscordArchiver:
    API_BASE = 'https://discord.com/api/v10'

    def __init__(self):
        self.token = os.environ.get('DISCORD_BOT_TOKEN', '')
        self.guild_id = os.environ.get('DISCORD_GUILD_ID', '')
        if not self.token or not self.guild_id:
            raise RuntimeError('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID required')

        self.headers = {
            'Authorization': f'Bot {self.token}',
            'Content-Type': 'application/json',
        }
        self.state = self._load_state()
        self._start_time = time.time()
        self._pending_threads = []  # defer thread fetching
        self.daily_stats = defaultdict(lambda: {
            'messages': 0,
            'reactions_total': 0,
            'attachments': 0,
            'threads_active': 0,
            'unique_authors': set(),
            'channel_activity': defaultdict(int),
            'hourly_activity': defaultdict(int),
            'top_reacted': [],
            'message_types': defaultdict(int),
        })

    def _api(self, path, **params):
        url = f'{self.API_BASE}{path}'
        resp = request_with_retry('GET', url, headers=self.headers, params=params)
        return resp.json()

    # ---- State persistence ----

    def _load_state(self):
        try:
            if STATE_PATH.exists():
                with open(STATE_PATH, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f'Failed to load state: {e}')
        return {'channels': {}, 'last_run': None}

    def _save_state(self):
        self.state['last_run'] = datetime.now(timezone.utc).isoformat()
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(self.state, f, ensure_ascii=False, indent=2)

    # ---- Guild metadata ----

    def fetch_guild_meta(self):
        """Fetch and save guild metadata: channels, roles."""
        channels = self._api(f'/guilds/{self.guild_id}/channels')
        # Save channel list
        meta = {
            'guild_id': self.guild_id,
            'updated_at': datetime.now(timezone.utc).isoformat(),
            'channels': [
                {
                    'id': ch['id'],
                    'name': ch.get('name', ''),
                    'type': ch.get('type', 0),
                    'parent_id': ch.get('parent_id'),
                    'position': ch.get('position', 0),
                    'topic': ch.get('topic', ''),
                    'nsfw': ch.get('nsfw', False),
                }
                for ch in channels
            ],
        }
        meta_path = DISCORD_DATA_DIR / 'guild_meta.json'
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        logger.info(f'Guild meta saved: {len(channels)} channels')
        return channels

    # ---- Member snapshot ----

    def fetch_members(self):
        """Fetch all guild members and save snapshot."""
        members = []
        after = '0'
        while True:
            batch = self._api(f'/guilds/{self.guild_id}/members', limit=1000, after=after)
            if not batch:
                break
            for m in batch:
                user = m.get('user', {})
                members.append({
                    'id': user.get('id', ''),
                    'username': user.get('username', ''),
                    'global_name': user.get('global_name', ''),
                    'nick': m.get('nick', ''),
                    'bot': user.get('bot', False),
                    'roles': m.get('roles', []),
                    'joined_at': m.get('joined_at', ''),
                    'premium_since': m.get('premium_since'),
                })
            after = batch[-1].get('user', {}).get('id', '0')
            time.sleep(REQUEST_DELAY)
            if len(batch) < 1000:
                break

        out = {
            'updated_at': datetime.now(timezone.utc).isoformat(),
            'total': len(members),
            'members': members,
        }
        members_path = DISCORD_DATA_DIR / 'members.json'
        members_path.parent.mkdir(parents=True, exist_ok=True)
        with open(members_path, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        logger.info(f'Members snapshot: {len(members)} members')

    # ---- Message archival ----

    def _slim_message(self, msg):
        """Extract relevant fields from a raw message for storage."""
        reactions = []
        for r in msg.get('reactions', []):
            emoji = r.get('emoji', {})
            reactions.append({
                'emoji': emoji.get('name', '?'),
                'emoji_id': emoji.get('id'),
                'count': r.get('count', 0),
                'normal': r.get('count_details', {}).get('normal', 0),
                'burst': r.get('count_details', {}).get('burst', 0),
            })

        attachments = [
            {
                'id': a.get('id', ''),
                'filename': a.get('filename', ''),
                'content_type': a.get('content_type', ''),
                'size': a.get('size', 0),
                'url': a.get('url', ''),
            }
            for a in msg.get('attachments', [])
        ]

        embeds = [
            {
                'type': e.get('type', ''),
                'title': e.get('title', ''),
                'url': e.get('url', ''),
                'description': (e.get('description', '') or '')[:300],
            }
            for e in msg.get('embeds', [])
        ]

        ref = msg.get('message_reference')
        reply_to = ref.get('message_id', '') if ref else None

        author = msg.get('author', {})

        return {
            'id': msg['id'],
            'channel_id': msg.get('channel_id', ''),
            'type': msg.get('type', 0),
            'author_id': author.get('id', ''),
            'author_name': author.get('username', ''),
            'author_bot': author.get('bot', False),
            'content': msg.get('content', ''),
            'timestamp': msg.get('timestamp', ''),
            'edited_timestamp': msg.get('edited_timestamp'),
            'pinned': msg.get('pinned', False),
            'mention_everyone': msg.get('mention_everyone', False),
            'mentions': [u.get('id', '') for u in msg.get('mentions', [])],
            'mention_roles': msg.get('mention_roles', []),
            'reactions': reactions,
            'attachments': attachments,
            'embeds': embeds,
            'reply_to': reply_to,
            'has_thread': bool(msg.get('thread')),
            'thread_id': msg.get('thread', {}).get('id') if msg.get('thread') else None,
            'sticker_count': len(msg.get('sticker_items', [])),
            'flags': msg.get('flags', 0),
        }

    def _append_to_daily_file(self, channel_id, date_str, slim_msg):
        """Append a message to the daily JSONL file for a channel."""
        ch_dir = DISCORD_DATA_DIR / 'channels' / str(channel_id)
        ch_dir.mkdir(parents=True, exist_ok=True)
        file_path = ch_dir / f'{date_str}.jsonl'
        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(slim_msg, ensure_ascii=False) + '\n')

    def _update_daily_stats(self, slim_msg, channel_name=''):
        """Accumulate daily statistics from a message."""
        try:
            ts = datetime.fromisoformat(slim_msg['timestamp'].replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return

        date_str = ts.strftime('%Y-%m-%d')
        hour = ts.hour
        stats = self.daily_stats[date_str]

        stats['messages'] += 1
        stats['unique_authors'].add(slim_msg['author_id'])
        stats['channel_activity'][channel_name or slim_msg['channel_id']] += 1
        stats['hourly_activity'][str(hour)] += 1
        stats['message_types'][str(slim_msg['type'])] += 1
        stats['attachments'] += len(slim_msg['attachments'])

        total_reactions = sum(r['count'] for r in slim_msg['reactions'])
        stats['reactions_total'] += total_reactions

        if total_reactions > 0:
            stats['top_reacted'].append({
                'id': slim_msg['id'],
                'content': slim_msg['content'][:80],
                'author': slim_msg['author_name'],
                'reactions': total_reactions,
                'channel': channel_name,
            })

    def _is_time_up(self):
        """Check if we've exceeded the runtime limit."""
        return (time.time() - self._start_time) > MAX_RUNTIME_SECONDS

    def fetch_channel_messages(self, channel_id, channel_name=''):
        """Fetch new messages from a channel since last archived message."""
        last_id = self.state.get('channels', {}).get(str(channel_id), {}).get('last_message_id', '0')
        total = 0

        while total < MAX_MESSAGES_PER_CHANNEL:
            if self._is_time_up():
                logger.warning(f'Runtime limit reached during channel {channel_name}, saving progress...')
                break

            params = {'limit': 100}
            if last_id != '0':
                params['after'] = last_id

            try:
                messages = self._api(f'/channels/{channel_id}/messages', **params)
            except Exception as e:
                logger.warning(f'Channel {channel_id} fetch failed: {e}')
                break

            if not isinstance(messages, list) or not messages:
                break

            # Messages come newest-first, reverse for chronological order
            messages.sort(key=lambda m: m['id'])

            for msg in messages:
                slim = self._slim_message(msg)
                # Determine date for file sharding
                try:
                    ts = datetime.fromisoformat(slim['timestamp'].replace('Z', '+00:00'))
                    date_str = ts.strftime('%Y-%m-%d')
                except (ValueError, TypeError):
                    date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

                self._append_to_daily_file(channel_id, date_str, slim)
                self._update_daily_stats(slim, channel_name)

                # Queue threads for later instead of fetching inline
                if slim['has_thread'] and slim['thread_id']:
                    self._pending_threads.append(slim['thread_id'])

                total += 1

            # Update cursor to newest message
            newest_id = messages[-1]['id']
            if str(channel_id) not in self.state.get('channels', {}):
                self.state.setdefault('channels', {})[str(channel_id)] = {}
            self.state['channels'][str(channel_id)]['last_message_id'] = newest_id
            self.state['channels'][str(channel_id)]['name'] = channel_name

            time.sleep(REQUEST_DELAY)

            # If fewer than 100 messages, we've caught up
            if len(messages) < 100:
                break

        if total >= MAX_MESSAGES_PER_CHANNEL:
            logger.info(f'Channel {channel_name}({channel_id}): hit {MAX_MESSAGES_PER_CHANNEL} cap, will continue next run')
        else:
            logger.info(f'Channel {channel_name}({channel_id}): archived {total} new messages')
        return total

    # ---- Thread archival ----

    def _fetch_thread(self, thread_id):
        """Fetch all messages from a thread."""
        thread_dir = DISCORD_DATA_DIR / 'threads'
        thread_dir.mkdir(parents=True, exist_ok=True)
        file_path = thread_dir / f'{thread_id}.jsonl'

        # Load existing message IDs to avoid duplicates
        existing_ids = set()
        if file_path.exists():
            with open(file_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            existing_ids.add(json.loads(line).get('id', ''))
                        except json.JSONDecodeError:
                            pass

        total = 0
        after = '0'
        while True:
            params = {'limit': 100}
            if after != '0':
                params['after'] = after

            try:
                messages = self._api(f'/channels/{thread_id}/messages', **params)
            except Exception as e:
                logger.warning(f'Thread {thread_id} fetch failed: {e}')
                break

            if not isinstance(messages, list) or not messages:
                break

            messages.sort(key=lambda m: m['id'])

            with open(file_path, 'a', encoding='utf-8') as f:
                for msg in messages:
                    if msg['id'] in existing_ids:
                        continue
                    slim = self._slim_message(msg)
                    f.write(json.dumps(slim, ensure_ascii=False) + '\n')
                    total += 1

            after = messages[-1]['id']
            time.sleep(REQUEST_DELAY)

            if len(messages) < 100:
                break

        if total > 0:
            logger.info(f'Thread {thread_id}: archived {total} new messages')

    # ---- Forum channel threads ----

    def fetch_forum_threads(self, channel_id, channel_name=''):
        """Fetch all threads from a forum channel."""
        total_threads = 0
        before = None

        while True:
            params = {'limit': 100}
            if before:
                params['before'] = before

            try:
                data = self._api(f'/channels/{channel_id}/threads/archived/public', **params)
            except Exception as e:
                logger.warning(f'Forum {channel_id} threads failed: {e}')
                break

            threads = data.get('threads', [])
            if not threads:
                break

            for thread in threads:
                thread_id = thread.get('id', '')
                self._fetch_thread(thread_id)
                total_threads += 1

                # Save thread metadata
                thread_meta = {
                    'id': thread_id,
                    'name': thread.get('name', ''),
                    'owner_id': thread.get('owner_id', ''),
                    'message_count': thread.get('message_count', 0),
                    'member_count': thread.get('member_count', 0),
                    'archived': thread.get('thread_metadata', {}).get('archived', False),
                    'archive_timestamp': thread.get('thread_metadata', {}).get('archive_timestamp', ''),
                    'parent_channel': channel_name,
                }
                meta_path = DISCORD_DATA_DIR / 'threads' / f'{thread_id}_meta.json'
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(thread_meta, f, ensure_ascii=False, indent=2)

                time.sleep(REQUEST_DELAY)

            if not data.get('has_more', False):
                break

            # Use the oldest thread's archive_timestamp for pagination
            oldest = threads[-1]
            before = oldest.get('thread_metadata', {}).get('archive_timestamp', '')
            if not before:
                break

        logger.info(f'Forum {channel_name}({channel_id}): {total_threads} threads archived')

    # ---- Daily stats output ----

    def _save_channel_index(self, channels):
        """Save a channel ID -> name index for external tools (e.g. claude.ai)."""
        index = {}
        for ch in channels:
            ch_id = ch.get('id', '') if isinstance(ch, dict) else ch
            ch_name = ch.get('name', '') if isinstance(ch, dict) else ''
            ch_type = ch.get('type', 0) if isinstance(ch, dict) else 0
            type_label = {0: 'text', 5: 'announcement', 15: 'forum'}.get(ch_type, 'other')
            index[str(ch_id)] = {
                'name': ch_name,
                'type': type_label,
                'parent_id': ch.get('parent_id', '') if isinstance(ch, dict) else '',
            }

        index_path = DISCORD_DATA_DIR / 'channel_index.json'
        index_path.parent.mkdir(parents=True, exist_ok=True)
        with open(index_path, 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        logger.info(f'Channel index saved: {len(index)} channels')

    def _save_daily_stats(self):
        """Write aggregated daily stats to JSON files."""
        stats_dir = DISCORD_DATA_DIR / 'activity_daily'
        stats_dir.mkdir(parents=True, exist_ok=True)

        for date_str, stats in self.daily_stats.items():
            # Convert sets to counts for JSON serialization
            top_reacted = sorted(stats['top_reacted'], key=lambda x: x['reactions'], reverse=True)[:20]

            output = {
                'date': date_str,
                'messages': stats['messages'],
                'unique_authors': len(stats['unique_authors']),
                'reactions_total': stats['reactions_total'],
                'attachments': stats['attachments'],
                'channel_activity': dict(stats['channel_activity']),
                'hourly_activity': dict(stats['hourly_activity']),
                'message_types': dict(stats['message_types']),
                'top_reacted_messages': top_reacted,
            }

            file_path = stats_dir / f'{date_str}.json'
            # Merge with existing stats if file exists
            if file_path.exists():
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                    output['messages'] += existing.get('messages', 0)
                    output['unique_authors'] = max(output['unique_authors'], existing.get('unique_authors', 0))
                    output['reactions_total'] += existing.get('reactions_total', 0)
                    output['attachments'] += existing.get('attachments', 0)
                    # Merge channel activity
                    for ch, cnt in existing.get('channel_activity', {}).items():
                        output['channel_activity'][ch] = output['channel_activity'].get(ch, 0) + cnt
                    # Merge hourly activity
                    for h, cnt in existing.get('hourly_activity', {}).items():
                        output['hourly_activity'][h] = output['hourly_activity'].get(h, 0) + cnt
                    # Merge top reacted
                    all_top = top_reacted + existing.get('top_reacted_messages', [])
                    seen = set()
                    deduped = []
                    for item in sorted(all_top, key=lambda x: x['reactions'], reverse=True):
                        if item['id'] not in seen:
                            seen.add(item['id'])
                            deduped.append(item)
                    output['top_reacted_messages'] = deduped[:20]
                except Exception:
                    pass

            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(output, f, ensure_ascii=False, indent=2)

        logger.info(f'Daily stats saved for {len(self.daily_stats)} day(s)')

    # ---- Main pipeline ----

    def run(self):
        """Full archival pipeline."""
        run_start = time.time()
        logger.info(f'Starting Discord archival for guild {self.guild_id}...')

        # 1. Fetch guild metadata
        channels = self.fetch_guild_meta()

        # 2. Fetch member snapshot (once per run)
        try:
            self.fetch_members()
        except Exception as e:
            logger.warning(f'Member fetch failed (may lack permission): {e}')

        # 3. Process each readable channel
        # Type 0=text, 5=announcement, 15=forum
        readable_types = {0, 5, 15}
        text_channels = [ch for ch in channels if ch.get('type', 0) in readable_types]

        total_messages = 0
        for ch in text_channels:
            if self._is_time_up():
                logger.warning('Runtime limit reached, stopping channel iteration')
                break

            ch_id = ch['id']
            ch_name = ch.get('name', '')
            ch_type = ch.get('type', 0)

            if ch_type == 15:
                # Forum channel: fetch threads
                self.fetch_forum_threads(ch_id, ch_name)
            else:
                # Text/announcement channel: fetch messages
                count = self.fetch_channel_messages(ch_id, ch_name)
                total_messages += count

        # 4. Process deferred threads (if time allows)
        if self._pending_threads and not self._is_time_up():
            logger.info(f'Fetching {len(self._pending_threads)} deferred threads...')
            for thread_id in self._pending_threads:
                if self._is_time_up():
                    logger.warning(f'Runtime limit reached, {len(self._pending_threads)} threads remaining for next run')
                    break
                self._fetch_thread(thread_id)

        # 5. Save channel index (ID -> name mapping for external access)
        self._save_channel_index(text_channels)

        # 6. Save daily stats
        self._save_daily_stats()

        # 7. Save state (always save, even on timeout, to preserve progress)
        self._save_state()

        elapsed = int(time.time() - run_start)
        logger.info(f'Discord archival complete: {total_messages} new messages, {len(text_channels)} channels, {elapsed}s')


if __name__ == '__main__':
    archiver = DiscordArchiver()
    archiver.run()
