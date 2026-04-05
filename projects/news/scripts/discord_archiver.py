#!/usr/bin/env python3
"""
Discord 全量数据归档器 v2 — 双轨并行 + 断点续传 + JSONL 去重

存储结构:
  projects/news/data/discord/
  ├── guild_meta.json              # 服务器元信息
  ├── channels/
  │   ├── {channel_id[-8:]}/       # 目录名用 ID 后 8 位（避免 emoji/特殊字符在路径中）
  │   │   └── YYYY-MM-DD.jsonl    # 按自然日分片的消息
  ├── activity_daily/
  │   └── YYYY-MM-DD.json         # 每日纯统计摘要（永久保留）
  ├── monthly_reports/
  │   └── YYYY-MM.md              # Claude 生成月报（失败时写 YYYY-MM-SKIPPED.md）
  ├── channel_index.json          # ID → {name, type, dir} 映射（含 emoji 的完整名称在此）
  └── state.json                  # 增量游标 + 历史偿还进度（每频道粒度）

运行模式:
  python discord_archiver.py                         # 常规：今日增量 + 历史偿还一个月
  python discord_archiver.py --archive-monthly       # 月度归档（每月 1 日由 workflow 触发）
  python discord_archiver.py --generate-report YYYY-MM  # 补生成指定月份月报
"""

import argparse
import json
import os
import subprocess
import tarfile
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).parent.parent.parent.parent
DISCORD_DATA_DIR = _REPO_ROOT / 'projects' / 'news' / 'data' / 'discord'
STATE_PATH = DISCORD_DATA_DIR / 'state.json'

REQUEST_DELAY = 0.25          # seconds between API calls (Discord allows 50 req/s per bot)
MAX_RUNTIME_SECONDS = 45 * 60         # 45-minute limit (GitHub Actions safe margin)
MAX_MESSAGES_PER_CHANNEL = 5000     # incremental cap per channel per run


# ── Snowflake helpers ────────────────────────────────────────────────────────

DISCORD_EPOCH_MS = 1420070400000


def _sf_from_dt(dt: datetime) -> str:
    """Minimum Discord snowflake string for a given UTC datetime."""
    ms = int(dt.timestamp() * 1000) - DISCORD_EPOCH_MS
    return str(max(ms, 0) << 22)


def _dt_from_sf(snowflake: str | int) -> datetime:
    """Extract UTC datetime from a Discord snowflake ID."""
    ts_ms = (int(snowflake) >> 22) + DISCORD_EPOCH_MS
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)


def _month_bounds(year: int, month: int):
    """Return (after_sf, before_sf) snowflake strings bracketing a calendar month."""
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) if month == 12 \
        else datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return _sf_from_dt(start), _sf_from_dt(end)


def _prev_month(year: int, month: int):
    """Return (year, month) for the previous calendar month."""
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _mstr(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


# ── HTTP helper ──────────────────────────────────────────────────────────────

def request_with_retry(method, url, max_retries=3, backoff_base=2, **kwargs):
    """HTTP with exponential backoff; respects Discord 429 rate limits."""
    import requests

    kwargs.setdefault('timeout', 15)
    last_exc = None

    for attempt in range(max_retries + 1):
        try:
            resp = requests.request(method, url, **kwargs)
            if resp.status_code == 429:
                retry_after = max(resp.json().get('retry_after', 5), 2.0)
                logger.warning(f'Rate limited, waiting {retry_after}s...')
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp
        except Exception as e:
            import requests as _req
            if isinstance(e, _req.exceptions.HTTPError):
                status = e.response.status_code if e.response is not None else 0
                if status not in (429, 500, 502, 503, 504):
                    raise
            last_exc = e
            logger.warning(f'Request error (attempt {attempt + 1}): {e}')
            if attempt < max_retries:
                time.sleep(backoff_base ** attempt)

    raise last_exc


# ── Main class ───────────────────────────────────────────────────────────────

class DiscordArchiver:
    API_BASE = 'https://discord.com/api/v10'

    def __init__(self):
        self.token = os.environ.get('DISCORD_BOT_TOKEN', '')
        self.guild_id = os.environ.get('DISCORD_GUILD_ID') or '1131791637933199470'
        if not self.token:
            raise RuntimeError('DISCORD_BOT_TOKEN is required')

        self.headers = {
            'Authorization': f'Bot {self.token}',
            'Content-Type': 'application/json',
        }
        self.state = self._load_state()
        self._start_time = time.time()
        self._pending_threads: list = []
        # Per-run cache of JSONL file → set of already-stored message IDs (dedup guard)
        self._file_ids_cache: dict = {}
        self.daily_stats: dict = defaultdict(lambda: {
            'messages': 0,
            'reactions_total': 0,
            'attachments': 0,
            'unique_authors': set(),
            'channel_activity': defaultdict(int),
            'hourly_activity': defaultdict(int),
            'top_reacted': [],
            'message_types': defaultdict(int),
        })

    # ── API ──────────────────────────────────────────────────────────────────

    def _api(self, path, **params):
        url = f'{self.API_BASE}{path}'
        resp = request_with_retry('GET', url, headers=self.headers, params=params)
        return resp.json()

    # ── State persistence ────────────────────────────────────────────────────

    def _load_state(self) -> dict:
        if STATE_PATH.exists():
            try:
                with open(STATE_PATH, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f'Failed to load state: {e}')
        return {'channels': {}, 'historical_month': None, 'last_run': None}

    def _save_state(self):
        self.state['last_run'] = datetime.now(timezone.utc).isoformat()
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(self.state, f, ensure_ascii=False, indent=2)

    def _ch_state(self, channel_id) -> dict:
        """Return (and initialise if missing) per-channel state dict."""
        return self.state['channels'].setdefault(str(channel_id), {})

    # ── Storage helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _ch_dir(channel_id) -> Path:
        """Channel data directory: last 8 chars of ID (no emoji in filesystem path)."""
        return DISCORD_DATA_DIR / 'channels' / str(channel_id)[-8:]

    def _file_ids(self, file_path: Path) -> set:
        """Cached set of message IDs already present in a JSONL file (dedup support)."""
        if file_path not in self._file_ids_cache:
            ids: set = set()
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                ids.add(json.loads(line).get('id', ''))
                            except json.JSONDecodeError:
                                pass
            self._file_ids_cache[file_path] = ids
        return self._file_ids_cache[file_path]

    def _write_msg(self, channel_id, date_str: str, slim: dict):
        """Write a slim message to its daily JSONL, skipping duplicates."""
        ch_dir = self._ch_dir(channel_id)
        ch_dir.mkdir(parents=True, exist_ok=True)
        file_path = ch_dir / f'{date_str}.jsonl'
        ids = self._file_ids(file_path)
        msg_id = slim.get('id', '')
        if not msg_id or msg_id in ids:
            return  # already stored — dedup guard
        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(slim, ensure_ascii=False) + '\n')
        ids.add(msg_id)

    # ── Guild metadata ───────────────────────────────────────────────────────

    def fetch_guild_meta(self) -> list:
        """Fetch channel list, save guild_meta.json, return channel list."""
        channels = self._api(f'/guilds/{self.guild_id}/channels')
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

    def _save_channel_index(self, channels: list):
        """
        channel_index.json: full ID → {name (with emoji), type, dir} mapping.
        Full channel names (including emoji) live ONLY here, not in filesystem paths.
        """
        index = {}
        for ch in channels:
            ch_id = str(ch.get('id', ''))
            ch_type = ch.get('type', 0)
            type_label = {0: 'text', 5: 'announcement', 15: 'forum'}.get(ch_type, 'other')
            index[ch_id] = {
                'name': ch.get('name', ''),
                'type': type_label,
                'parent_id': str(ch.get('parent_id') or ''),
                'dir': ch_id[-8:],   # quick reference: the storage directory name
            }
        index_path = DISCORD_DATA_DIR / 'channel_index.json'
        index_path.parent.mkdir(parents=True, exist_ok=True)
        with open(index_path, 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        logger.info(f'Channel index saved: {len(index)} entries')

    # ── Message processing ───────────────────────────────────────────────────

    def _slim_message(self, msg: dict) -> dict:
        """Extract and slim a raw Discord message for storage."""
        reactions = [
            {
                'emoji': r.get('emoji', {}).get('name', '?'),
                'emoji_id': r.get('emoji', {}).get('id'),
                'count': r.get('count', 0),
            }
            for r in msg.get('reactions', [])
        ]
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
                'description': (e.get('description') or '')[:300],
            }
            for e in msg.get('embeds', [])
        ]
        ref = msg.get('message_reference')
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
            'mentions': [u.get('id', '') for u in msg.get('mentions', [])],
            'reactions': reactions,
            'attachments': attachments,
            'embeds': embeds,
            'reply_to': ref.get('message_id') if ref else None,
            'has_thread': bool(msg.get('thread')),
            'thread_id': msg.get('thread', {}).get('id') if msg.get('thread') else None,
            'flags': msg.get('flags', 0),
        }

    def _process_message(self, msg: dict, channel_id, channel_name: str = ''):
        """Slim, write to JSONL, update daily stats, queue threads."""
        slim = self._slim_message(msg)
        try:
            ts = datetime.fromisoformat(slim['timestamp'].replace('Z', '+00:00'))
            date_str = ts.strftime('%Y-%m-%d')
        except (ValueError, TypeError):
            date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        self._write_msg(channel_id, date_str, slim)
        self._update_daily_stats(slim, channel_name)
        if slim['has_thread'] and slim['thread_id']:
            self._pending_threads.append(slim['thread_id'])
        return slim

    def _update_daily_stats(self, slim: dict, channel_name: str = ''):
        try:
            ts = datetime.fromisoformat(slim['timestamp'].replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return
        date_str = ts.strftime('%Y-%m-%d')
        stats = self.daily_stats[date_str]
        stats['messages'] += 1
        stats['unique_authors'].add(slim['author_id'])
        stats['channel_activity'][channel_name or slim['channel_id']] += 1
        stats['hourly_activity'][str(ts.hour)] += 1
        stats['message_types'][str(slim['type'])] += 1
        stats['attachments'] += len(slim['attachments'])
        total_reactions = sum(r['count'] for r in slim['reactions'])
        stats['reactions_total'] += total_reactions
        if total_reactions > 0:
            stats['top_reacted'].append({
                'id': slim['id'],
                'content': slim['content'][:80],
                'author': slim['author_name'],
                'reactions': total_reactions,
                'channel': channel_name,
            })

    def _is_time_up(self) -> bool:
        return (time.time() - self._start_time) > MAX_RUNTIME_SECONDS

    # ── Track 1: Incremental (new messages since last run) ───────────────────

    def fetch_channel_incremental(self, channel_id, channel_name: str = '') -> int:
        """Fetch all new messages since last archived message. Returns count."""
        ch_key = str(channel_id)
        last_id = self._ch_state(ch_key).get('last_message_id', '0')
        total = 0

        while total < MAX_MESSAGES_PER_CHANNEL:
            if self._is_time_up():
                logger.warning(f'Runtime limit during incremental fetch: {channel_name}')
                break
            params = {'limit': 100}
            if last_id != '0':
                params['after'] = last_id
            try:
                messages = self._api(f'/channels/{channel_id}/messages', **params)
            except Exception as e:
                logger.warning(f'Channel {channel_id} incremental fetch failed: {e}')
                break
            if not isinstance(messages, list) or not messages:
                break
            messages.sort(key=lambda m: m['id'])
            for msg in messages:
                self._process_message(msg, channel_id, channel_name)
                total += 1
            last_id = messages[-1]['id']
            self._ch_state(ch_key)['last_message_id'] = last_id
            self._ch_state(ch_key)['name'] = channel_name
            time.sleep(REQUEST_DELAY)
            if len(messages) < 100:
                break

        if total >= MAX_MESSAGES_PER_CHANNEL:
            logger.info(f'Incremental {channel_name}({channel_id}): hit cap {MAX_MESSAGES_PER_CHANNEL}, continues next run')
        else:
            logger.info(f'Incremental {channel_name}({channel_id}): {total} new messages')
        return total

    # ── Track 2: Historical backfill (one month per run) ─────────────────────

    def _guild_start_month(self):
        """Derive guild creation year/month from its Snowflake ID (no extra API call)."""
        try:
            dt = _dt_from_sf(self.guild_id)
            return dt.year, dt.month
        except (ValueError, TypeError):
            return 2023, 1

    def _init_historical_month(self):
        """Initialise historical_month to last month if not already set."""
        if not self.state.get('historical_month'):
            now = datetime.now(timezone.utc)
            y, m = _prev_month(now.year, now.month)
            self.state['historical_month'] = _mstr(y, m)
            self._save_state()

    @staticmethod
    def _channel_created_month(channel_id) -> tuple[int, int]:
        """Derive channel creation year/month from its Snowflake ID."""
        try:
            dt = _dt_from_sf(channel_id)
            return dt.year, dt.month
        except (ValueError, TypeError):
            return 2023, 1

    def fetch_channel_history_month(
        self, channel_id, channel_name: str, year: int, month: int
    ) -> int:
        """
        Fetch all messages for a channel in a specific calendar month (historical backfill).
        Saves state after completion for断点续传 (resume from breakpoint).
        Returns count of newly archived messages.
        Returns -1 if channel was skipped (created after target month).
        """
        ch_key = str(channel_id)
        month_str = _mstr(year, month)
        after_sf, before_sf = _month_bounds(year, month)

        # ── Optimisation 1: skip channels created after this month (no API call) ──
        ch_created_y, ch_created_m = self._channel_created_month(channel_id)
        if (ch_created_y, ch_created_m) > (year, month):
            ch_st = self._ch_state(ch_key)
            ch_st['last_historical_message_id'] = before_sf
            ch_st['last_historical_month'] = month_str
            return -1  # skip — channel didn't exist yet

        ch_st = self._ch_state(ch_key)

        # ── Optimisation 2: check empty-months set (skip without API call) ──
        empty_months = set(ch_st.get('empty_months', []))
        if month_str in empty_months:
            ch_st['last_historical_message_id'] = before_sf
            ch_st['last_historical_month'] = month_str
            return 0

        # Resume from per-channel cursor if it belongs to this month
        if ch_st.get('last_historical_month') == month_str:
            cursor = ch_st.get('last_historical_message_id', after_sf)
        else:
            cursor = after_sf  # starting fresh for this month

        # Already complete for this month?
        if int(cursor) >= int(before_sf):
            return 0

        total = 0
        after = cursor

        while True:
            if self._is_time_up():
                logger.warning(f'Runtime limit during historical fetch: {channel_name} {month_str}')
                break

            params = {'limit': 100, 'after': after}
            try:
                messages = self._api(f'/channels/{channel_id}/messages', **params)
            except Exception as e:
                logger.warning(f'Channel {channel_id} history {month_str} failed: {e}')
                break

            if not isinstance(messages, list) or not messages:
                # No more messages — channel exhausted for this month
                after = before_sf
                break

            messages.sort(key=lambda m: m['id'])

            # Only process messages within this month's boundaries
            in_month = [m for m in messages if m['id'] < before_sf]
            for msg in in_month:
                self._process_message(msg, channel_id, channel_name)
                total += 1

            newest = messages[-1]['id']
            after = newest

            if not in_month or newest >= before_sf:
                after = before_sf  # reached end of month
                break
            if len(messages) < 100:
                after = before_sf  # exhausted before end of month
                break

            time.sleep(REQUEST_DELAY)

        # ── Optimisation 2b: remember empty months to skip in future ──
        if total == 0 and int(after) >= int(before_sf):
            empty_months.add(month_str)
            ch_st['empty_months'] = sorted(empty_months)

        # Persist cursor — every channel's month completion triggers a state save (断点续传)
        ch_st['last_historical_message_id'] = after
        ch_st['last_historical_month'] = month_str
        self._save_state()

        if total > 0:
            logger.info(f'History {channel_name}({channel_id}) {month_str}: {total} messages')
        return total

    def _all_channels_done_for_month(
        self, channel_ids: list, month_str: str, before_sf: str
    ) -> bool:
        """Return True if every channel has fully processed the given historical month."""
        for ch_id in channel_ids:
            ch_st = self.state['channels'].get(str(ch_id), {})
            if ch_st.get('last_historical_month') != month_str:
                return False
            if int(ch_st.get('last_historical_message_id', '0')) < int(before_sf):
                return False
        return True

    # ── Forum channels ───────────────────────────────────────────────────────

    def _fetch_archived_threads(self, forum_channel_id, channel_name: str = '') -> list:
        """
        Fetch all archived public threads for a forum channel, handling pagination.
        Discord paginates via archive_timestamp of the last result.
        Returns a flat list of thread objects.
        """
        threads = []
        before = None
        page = 0
        while True:
            params: dict = {'limit': 100}
            if before:
                params['before'] = before
            try:
                data = self._api(
                    f'/channels/{forum_channel_id}/threads/archived/public', **params
                )
            except Exception as e:
                logger.warning(
                    f'Forum {channel_name}({forum_channel_id}) archived page {page} failed: {e}'
                )
                break
            batch = data.get('threads', [])
            threads.extend(batch)
            page += 1
            if not data.get('has_more', False) or not batch:
                break
            # Pagination cursor: archive_timestamp of the last thread in the batch
            last_meta = batch[-1].get('thread_metadata', {})
            before = last_meta.get('archive_timestamp', '')
            if not before:
                break
            time.sleep(REQUEST_DELAY)
        logger.info(
            f'Forum {channel_name}({forum_channel_id}): {len(threads)} archived threads found'
        )
        return threads

    def _fetch_forum_thread(
        self,
        thread_id,
        forum_channel_id,
        thread_meta: dict,
        api_last_message_id: str = '',
    ) -> int:
        """
        Fetch new messages from a forum thread incrementally.
        Messages are stored in the *forum channel's* directory (not the thread's own dir),
        and each message is annotated with thread metadata (title, forum_channel_id).
        Returns count of newly archived messages.
        """
        ch_key = f'thread:{thread_id}'
        stored_last_id = self._ch_state(ch_key).get('last_message_id', '0')

        # Skip if the thread's last_message_id hasn't changed since our last fetch
        if api_last_message_id and api_last_message_id != '0' and stored_last_id >= api_last_message_id:
            return 0

        last_id = stored_last_id
        total = 0

        while True:
            if self._is_time_up():
                break
            params: dict = {'limit': 100}
            if last_id != '0':
                params['after'] = last_id
            try:
                messages = self._api(f'/channels/{thread_id}/messages', **params)
            except Exception as e:
                logger.warning(f'Forum thread {thread_id} fetch failed: {e}')
                break
            if not isinstance(messages, list) or not messages:
                break
            messages.sort(key=lambda m: m['id'])
            for msg in messages:
                slim = self._slim_message(msg)
                # Annotate with thread metadata so consumers know which post this belongs to
                slim.update(thread_meta)
                try:
                    ts = datetime.fromisoformat(slim['timestamp'].replace('Z', '+00:00'))
                    date_str = ts.strftime('%Y-%m-%d')
                except (ValueError, TypeError):
                    date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
                # Store under the forum channel directory, not the individual thread directory
                self._write_msg(forum_channel_id, date_str, slim)
                self._update_daily_stats(slim, thread_meta.get('thread_title', ''))
                total += 1
            last_id = messages[-1]['id']
            self._ch_state(ch_key)['last_message_id'] = last_id
            time.sleep(REQUEST_DELAY)
            if len(messages) < 100:
                break

        return total

    def fetch_forum_threads(self, channel_id, channel_name: str = '') -> int:
        """
        Fetch messages from a forum channel by iterating over all threads:
          - Active threads  (via guild-level active-threads endpoint)
          - Archived threads (via /channels/{id}/threads/archived/public)
        Each thread is fetched incrementally; messages are stored in the forum
        channel's own directory with thread metadata attached.
        Returns total message count across all threads.
        """
        # 1. Active threads (guild-wide endpoint, filtered to this forum)
        active_threads: list = []
        try:
            data = self._api(f'/guilds/{self.guild_id}/threads/active')
            active_threads = [
                t for t in data.get('threads', [])
                if str(t.get('parent_id', '')) == str(channel_id)
            ]
        except Exception as e:
            logger.warning(f'Forum {channel_name}({channel_id}) active threads failed: {e}')

        # 2. Archived threads
        archived_threads: list = []
        try:
            archived_threads = self._fetch_archived_threads(channel_id, channel_name)
        except Exception as e:
            logger.warning(f'Forum {channel_name}({channel_id}) archived threads error: {e}')

        all_threads = active_threads + archived_threads
        seen_ids: set = set()
        total = 0

        for thread in all_threads:
            if self._is_time_up():
                logger.warning(f'Runtime limit: forum {channel_name}({channel_id}) incomplete')
                break
            t_id = str(thread.get('id', ''))
            if not t_id or t_id in seen_ids:
                continue
            seen_ids.add(t_id)

            thread_meta = {
                'thread_id': t_id,
                'thread_title': thread.get('name', ''),
                'forum_channel_id': str(channel_id),
            }
            applied_tags = thread.get('applied_tags', [])
            if applied_tags:
                thread_meta['thread_tags'] = applied_tags  # type: ignore[assignment]

            api_last_msg_id = str(thread.get('last_message_id') or '0')
            count = self._fetch_forum_thread(t_id, channel_id, thread_meta, api_last_msg_id)
            total += count
            if count > 0:
                self._save_state()  # persist per-thread for 断点续传

        logger.info(
            f'Forum {channel_name}({channel_id}): {total} messages from {len(seen_ids)} threads'
        )
        return total

    def _fetch_thread_incremental(self, thread_id) -> int:
        """Fetch new messages from a thread since last seen (incremental)."""
        ch_key = f'thread:{thread_id}'
        last_id = self._ch_state(ch_key).get('last_message_id', '0')
        total = 0

        while True:
            params = {'limit': 100}
            if last_id != '0':
                params['after'] = last_id
            try:
                messages = self._api(f'/channels/{thread_id}/messages', **params)
            except Exception as e:
                logger.warning(f'Thread {thread_id} fetch failed: {e}')
                break
            if not isinstance(messages, list) or not messages:
                break
            messages.sort(key=lambda m: m['id'])
            for msg in messages:
                self._process_message(msg, thread_id)
                total += 1
            last_id = messages[-1]['id']
            self._ch_state(ch_key)['last_message_id'] = last_id
            time.sleep(REQUEST_DELAY)
            if len(messages) < 100:
                break

        return total

    # ── Daily statistics output ───────────────────────────────────────────────

    def _save_daily_stats(self):
        """Write (and merge with existing) daily stats JSON files."""
        stats_dir = DISCORD_DATA_DIR / 'activity_daily'
        stats_dir.mkdir(parents=True, exist_ok=True)

        for date_str, stats in self.daily_stats.items():
            top_reacted = sorted(
                stats['top_reacted'], key=lambda x: x['reactions'], reverse=True
            )[:20]
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
            if file_path.exists():
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                    output['messages'] += existing.get('messages', 0)
                    output['unique_authors'] = max(
                        output['unique_authors'], existing.get('unique_authors', 0)
                    )
                    output['reactions_total'] += existing.get('reactions_total', 0)
                    output['attachments'] += existing.get('attachments', 0)
                    for ch, cnt in existing.get('channel_activity', {}).items():
                        output['channel_activity'][ch] = output['channel_activity'].get(ch, 0) + cnt
                    for h, cnt in existing.get('hourly_activity', {}).items():
                        output['hourly_activity'][h] = output['hourly_activity'].get(h, 0) + cnt
                    all_top = top_reacted + existing.get('top_reacted_messages', [])
                    seen: set = set()
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

    # ── Monthly archive ───────────────────────────────────────────────────────

    def run_monthly_archive(self):
        """
        Package last month's JSONL → GitHub Releases, generate monthly report,
        then remove archived JSONL from git. Called on 1st of each month.
        """
        now = datetime.now(timezone.utc)
        arch_year, arch_month = _prev_month(now.year, now.month)
        month_str = _mstr(arch_year, arch_month)
        logger.info(f'Starting monthly archive for {month_str}...')

        # Collect all JSONL files for this month across all channels
        channels_dir = DISCORD_DATA_DIR / 'channels'
        jsonl_files = []
        if channels_dir.exists():
            for ch_dir in sorted(channels_dir.iterdir()):
                if ch_dir.is_dir():
                    jsonl_files.extend(sorted(ch_dir.glob(f'{month_str}-*.jsonl')))

        if not jsonl_files:
            logger.info(f'No JSONL files found for {month_str}, nothing to archive')
            return

        # Create tarball
        archive_name = f'discord-archive-{month_str}.tar.gz'
        archive_path = DISCORD_DATA_DIR / archive_name
        with tarfile.open(archive_path, 'w:gz') as tar:
            for f in jsonl_files:
                tar.add(f, arcname=str(f.relative_to(DISCORD_DATA_DIR)))
        size_kb = archive_path.stat().st_size // 1024
        logger.info(f'Created {archive_name}: {len(jsonl_files)} files, {size_kb} KB')

        # Upload to GitHub Releases
        repo = os.environ.get('GITHUB_REPOSITORY', '')
        tag = f'discord-archive-{month_str}'
        try:
            # Delete any existing release/tag first (idempotent re-runs)
            subprocess.run(
                ['gh', 'release', 'delete', tag, '--yes', '--cleanup-tag'],
                cwd=_REPO_ROOT, capture_output=True,
            )
            subprocess.run([
                'gh', 'release', 'create', tag,
                str(archive_path),
                '--title', f'Discord Archive {month_str}',
                '--notes', (
                    f'Full Discord message archive for {month_str}.\n'
                    f'{len(jsonl_files)} daily JSONL files, {size_kb} KB compressed.'
                ),
                '--repo', repo,
            ], cwd=_REPO_ROOT, check=True)
            logger.info(f'Uploaded to GitHub Releases: {tag}')
        except subprocess.CalledProcessError as e:
            logger.error(f'GitHub Release upload failed: {e}')
            raise
        finally:
            archive_path.unlink(missing_ok=True)

        # Generate monthly report (failure must NOT abort the archive)
        self._generate_monthly_report(month_str)

        # Remove archived JSONL from git
        removed = 0
        for f in jsonl_files:
            try:
                subprocess.run(
                    ['git', 'rm', '-f', str(f)],
                    cwd=_REPO_ROOT, check=True, capture_output=True,
                )
                removed += 1
            except subprocess.CalledProcessError:
                f.unlink(missing_ok=True)
                removed += 1
        logger.info(f'Removed {removed} JSONL files from git for {month_str}')

    def _generate_monthly_report(self, month_str: str):
        """
        Generate a Claude-powered monthly community report.
        On ANY failure, write a SKIPPED marker instead of raising.
        The archive flow is never blocked by report failures.
        """
        report_dir = DISCORD_DATA_DIR / 'monthly_reports'
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / f'{month_str}.md'
        skipped_path = report_dir / f'{month_str}-SKIPPED.md'

        # Load daily stats for this month
        stats_dir = DISCORD_DATA_DIR / 'activity_daily'
        monthly_stats = []
        if stats_dir.exists():
            for f in sorted(stats_dir.glob(f'{month_str}-*.json')):
                try:
                    with open(f, 'r', encoding='utf-8') as fp:
                        monthly_stats.append(json.load(fp))
                except Exception:
                    pass

        total_msgs = sum(s.get('messages', 0) for s in monthly_stats)
        active_days = len(monthly_stats)

        try:
            import anthropic
            client = anthropic.Anthropic()

            top_channels: dict = defaultdict(int)
            for s in monthly_stats:
                for ch, cnt in s.get('channel_activity', {}).items():
                    top_channels[ch] += cnt
            top_5 = sorted(top_channels.items(), key=lambda x: x[1], reverse=True)[:5]

            prompt = (
                f"你是忘却前夜（Morimens）Discord 社区的月度分析师。\n"
                f"请根据以下 {month_str} 的活跃数据，生成一份简洁的中文月报（600字以内），包含：\n"
                f"1. 月度总览（消息量、活跃天数）\n"
                f"2. 最活跃的频道 Top 5\n"
                f"3. 社区动态亮点（如有异常峰值请注明）\n\n"
                f"数据摘要：\n"
                f"- 月份：{month_str}\n"
                f"- 总消息数：{total_msgs:,}\n"
                f"- 活跃天数：{active_days}\n"
                f"- 最活跃频道（消息数）：{json.dumps(top_5, ensure_ascii=False)}\n"
            )
            response = client.messages.create(
                model='claude-opus-4-6',
                max_tokens=1500,
                messages=[{'role': 'user', 'content': prompt}],
            )
            content = response.content[0].text
            report = (
                f'# 忘却前夜 Discord 月报 {month_str}\n\n'
                f'> 自动生成于 {datetime.now(timezone.utc).strftime("%Y-%m-%d")} by discord_archiver\n\n'
                f'{content}\n'
            )
            with open(report_path, 'w', encoding='utf-8') as f:
                f.write(report)
            logger.info(f'Monthly report generated: {report_path.name}')

        except Exception as e:
            logger.error(f'Monthly report generation failed (writing SKIPPED marker): {e}')
            skipped = (
                f'# Discord 月报 {month_str} — 生成失败，已跳过\n\n'
                f'**失败原因**: `{e}`\n\n'
                f'**跳过时间**: {datetime.now(timezone.utc).isoformat()}\n\n'
                f'**补生成命令**:\n'
                f'```bash\n'
                f'python projects/news/scripts/discord_archiver.py --generate-report {month_str}\n'
                f'```\n'
            )
            with open(skipped_path, 'w', encoding='utf-8') as f:
                f.write(skipped)
            logger.info(f'SKIPPED marker written: {skipped_path.name}')

    # ── Main pipeline ─────────────────────────────────────────────────────────

    def run(self):
        """
        Regular run: dual-track parallel execution.
          Track 1 — Incremental: fetch new messages since last run (all channels)
          Track 2 — Historical:  backfill one calendar month per run (text channels)
        """
        run_start = time.time()
        logger.info(f'Discord archiver v2 starting (guild {self.guild_id})...')

        # ── Metadata ──
        channels = self.fetch_guild_meta()
        readable_types = {0, 5, 15}
        workable = [ch for ch in channels if ch.get('type', 0) in readable_types]
        text_channels = [ch for ch in workable if ch.get('type', 0) != 15]  # text + announcement
        forum_channels = [ch for ch in workable if ch.get('type', 0) == 15]
        self._save_channel_index(workable)

        # ── Track 1: Incremental ──
        total_incremental = 0
        for ch in text_channels:
            if self._is_time_up():
                logger.warning('Runtime limit: stopping incremental track')
                break
            count = self.fetch_channel_incremental(ch['id'], ch.get('name', ''))
            total_incremental += count
            self._save_state()  # per-channel save for 断点续传

        # Forum channels: active + archived threads, incremental (no historical backfill)
        for ch in forum_channels:
            if self._is_time_up():
                break
            self.fetch_forum_threads(ch['id'], ch.get('name', ''))

        # ── Track 2: Historical backfill (multi-month per run) ──
        self._init_historical_month()
        guild_start_y, guild_start_m = self._guild_start_month()
        ch_ids = [ch['id'] for ch in text_channels]

        months_completed = 0
        while not self._is_time_up():
            hist_month_str = self.state.get('historical_month')
            if not hist_month_str:
                break

            hist_y = int(hist_month_str[:4])
            hist_m = int(hist_month_str[5:7])
            _, before_sf = _month_bounds(hist_y, hist_m)
            total_historical = 0
            skipped = 0

            for ch in text_channels:
                if self._is_time_up():
                    logger.warning(f'Runtime limit: historical {hist_month_str} incomplete')
                    break
                count = self.fetch_channel_history_month(
                    ch['id'], ch.get('name', ''), hist_y, hist_m
                )
                if count == -1:
                    skipped += 1
                else:
                    total_historical += count

            logger.info(
                f'Historical {hist_month_str}: {total_historical} msgs, '
                f'{skipped} channels skipped (not yet created)'
            )

            # Advance to previous month if all channels completed this one
            if self._all_channels_done_for_month(ch_ids, hist_month_str, before_sf):
                months_completed += 1
                prev_y, prev_m = _prev_month(hist_y, hist_m)
                if (prev_y, prev_m) < (guild_start_y, guild_start_m):
                    logger.info('Historical backfill complete: reached guild creation date')
                    self.state['historical_month'] = None
                else:
                    new_month = _mstr(prev_y, prev_m)
                    logger.info(f'Historical month complete → advancing to {new_month} (#{months_completed})')
                    self.state['historical_month'] = new_month
                self._save_state()
            else:
                break  # month not yet complete, continue next run

        if months_completed:
            logger.info(f'Completed {months_completed} historical months this run')

        # ── Deferred threads from incremental track ──
        if self._pending_threads and not self._is_time_up():
            logger.info(f'Fetching {len(self._pending_threads)} deferred threads...')
            for thread_id in self._pending_threads:
                if self._is_time_up():
                    logger.warning(f'{len(self._pending_threads)} threads deferred to next run')
                    break
                self._fetch_thread_incremental(thread_id)

        # ── Daily stats + final state save ──
        self._save_daily_stats()
        self._save_state()

        elapsed = int(time.time() - run_start)
        logger.info(
            f'Archival complete: {total_incremental} incremental msgs, '
            f'{len(workable)} channels, {elapsed}s elapsed'
        )


    def run_history_only(self):
        """
        History-only mode: skip incremental, dedicate full runtime to historical backfill.
        Used by the dedicated history-backfill workflow for maximum throughput.
        """
        run_start = time.time()
        logger.info(f'Discord archiver HISTORY-ONLY mode (guild {self.guild_id})...')

        channels = self.fetch_guild_meta()
        readable_types = {0, 5}
        text_channels = [ch for ch in channels if ch.get('type', 0) in readable_types]
        ch_ids = [ch['id'] for ch in text_channels]

        self._init_historical_month()
        guild_start_y, guild_start_m = self._guild_start_month()

        months_completed = 0
        while not self._is_time_up():
            hist_month_str = self.state.get('historical_month')
            if not hist_month_str:
                logger.info('All historical months complete!')
                break

            hist_y = int(hist_month_str[:4])
            hist_m = int(hist_month_str[5:7])
            _, before_sf = _month_bounds(hist_y, hist_m)
            total_historical = 0
            skipped = 0

            for ch in text_channels:
                if self._is_time_up():
                    break
                count = self.fetch_channel_history_month(
                    ch['id'], ch.get('name', ''), hist_y, hist_m
                )
                if count == -1:
                    skipped += 1
                else:
                    total_historical += count

            logger.info(
                f'Historical {hist_month_str}: {total_historical} msgs, '
                f'{skipped} skipped'
            )

            if self._all_channels_done_for_month(ch_ids, hist_month_str, before_sf):
                months_completed += 1
                prev_y, prev_m = _prev_month(hist_y, hist_m)
                if (prev_y, prev_m) < (guild_start_y, guild_start_m):
                    logger.info('Historical backfill complete: reached guild creation date')
                    self.state['historical_month'] = None
                else:
                    new_month = _mstr(prev_y, prev_m)
                    logger.info(f'Month done → {new_month} (#{months_completed})')
                    self.state['historical_month'] = new_month
                self._save_state()
            else:
                break

        self._save_daily_stats()
        self._save_state()
        elapsed = int(time.time() - run_start)
        logger.info(
            f'History-only complete: {months_completed} months, '
            f'{len(text_channels)} channels, {elapsed}s'
        )


def main():
    parser = argparse.ArgumentParser(description='Discord data archiver v2')
    parser.add_argument(
        '--archive-monthly', action='store_true',
        help='Run monthly archive: package → GitHub Releases, generate report, remove old JSONL'
    )
    parser.add_argument(
        '--generate-report', metavar='YYYY-MM',
        help='(Re)generate monthly report for a specific month (use after API key restored)'
    )
    parser.add_argument(
        '--history-only', action='store_true',
        help='Skip incremental, dedicate full runtime to historical backfill'
    )
    args = parser.parse_args()

    archiver = DiscordArchiver()
    if args.archive_monthly:
        archiver.run_monthly_archive()
    elif args.generate_report:
        archiver._generate_monthly_report(args.generate_report)
    elif args.history_only:
        archiver.run_history_only()
    else:
        archiver.run()


if __name__ == '__main__':
    main()
