#!/usr/bin/env python3
"""
Discord 图片附件缓存脚本

功能：
  - 扫描优先频道的 JSONL 归档，找到所有图片附件
  - 用 Discord API 刷新过期 CDN URL，下载并本地缓存
  - 在 JSONL 中为已下载图片添加 local_path 字段
  - 支持断点续传（checkpoint 文件记录进度）

用法:
  python discord_fetch_images.py [--dry-run] [--reset-checkpoint]

环境变量:
  DISCORD_BOT_TOKEN  — Discord Bot Token（必须）
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ── 路径 ─────────────────────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parent.parent.parent.parent
DISCORD_DATA_DIR = _REPO_ROOT / 'assets' / 'data' / 'discord'
CHANNELS_DIR = DISCORD_DATA_DIR / 'channels'
IMAGES_DIR = DISCORD_DATA_DIR / 'images'
CHECKPOINT_PATH = IMAGES_DIR / '.fetch_checkpoint.json'

# ── 配置 ─────────────────────────────────────────────────────────────────────

# 优先下载的频道（按重要性排序）
# 格式：{channel_id: dir_suffix}
PRIORITY_CHANNELS = {
    '1174185304027045969': '27045969',  # 同人创作（forum）
    '1181135756958371881': '58371881',  # 游戏公告（forum）
    '1174983699935277147': '35277147',  # 晒卡分享
    '1131840077237067837': '37067837',  # 遊戲問題及bug回報
}

API_DELAY = 0.5          # 2 req/s（保守）
MAX_RUNTIME_SECONDS = 30 * 60   # 30 分钟上限
MAX_DOWNLOADS_PER_RUN = 200     # 每次 workflow 最多下载数量
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024   # 5MB 上限

DISCORD_API_BASE = 'https://discord.com/api/v10'


# ── Checkpoint ────────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    if CHECKPOINT_PATH.exists():
        with open(CHECKPOINT_PATH) as f:
            return json.load(f)
    return {'processed_attachments': [], 'last_run': None}


def save_checkpoint(cp: dict):
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    cp['last_run'] = datetime.now(timezone.utc).isoformat()
    with open(CHECKPOINT_PATH, 'w') as f:
        json.dump(cp, f, indent=2)


# ── Discord API ───────────────────────────────────────────────────────────────

def get_fresh_message(session: requests.Session, channel_id: str, message_id: str) -> dict | None:
    """从 Discord API 拉取消息，获取新鲜 CDN URL。"""
    url = f'{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}'
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        elif resp.status_code == 429:
            retry_after = resp.json().get('retry_after', 5)
            logger.warning(f'Rate limited, sleeping {retry_after}s')
            time.sleep(retry_after)
            resp2 = session.get(url, timeout=15)
            return resp2.json() if resp2.status_code == 200 else None
        elif resp.status_code in (403, 404):
            logger.debug(f'Cannot access message {message_id} in channel {channel_id}: {resp.status_code}')
            return None
        else:
            logger.warning(f'Unexpected status {resp.status_code} for message {message_id}')
            return None
    except requests.RequestException as e:
        logger.warning(f'Request failed for message {message_id}: {e}')
        return None


def download_image(session: requests.Session, url: str, dest: Path) -> bool:
    """下载图片到目标路径，超过大小限制则跳过。返回是否成功。"""
    try:
        resp = session.get(url, timeout=30, stream=True)
        if resp.status_code != 200:
            logger.warning(f'Download failed {url}: HTTP {resp.status_code}')
            return False

        # 先检查 Content-Length
        content_length = int(resp.headers.get('Content-Length', 0))
        if content_length > MAX_FILE_SIZE_BYTES:
            logger.info(f'Skipping {dest.name}: size {content_length/1024/1024:.1f}MB > 5MB limit')
            return False

        dest.parent.mkdir(parents=True, exist_ok=True)
        downloaded = 0
        with open(dest, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=65536):
                downloaded += len(chunk)
                if downloaded > MAX_FILE_SIZE_BYTES:
                    f.close()
                    dest.unlink(missing_ok=True)
                    logger.info(f'Skipping {dest.name}: exceeded 5MB during download')
                    return False
                f.write(chunk)
        return True
    except requests.RequestException as e:
        logger.warning(f'Download error for {url}: {e}')
        dest.unlink(missing_ok=True)
        return False


# ── JSONL 处理 ────────────────────────────────────────────────────────────────

def get_ext(filename: str, content_type: str) -> str:
    """从文件名或 content_type 推断扩展名。"""
    suffix = Path(filename).suffix.lower()
    if suffix in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff'):
        return suffix.lstrip('.')
    # fallback to content_type
    ct_map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/avif': 'avif',
    }
    return ct_map.get(content_type, 'jpg')


def collect_pending_images(channel_suffix: str, processed_ids: set) -> list[dict]:
    """
    扫描一个频道目录下所有 JSONL，返回待下载的图片条目列表。
    每条：{attachment_id, message_id, channel_id, filename, content_type, jsonl_path, line_idx}
    """
    channel_dir = CHANNELS_DIR / channel_suffix
    if not channel_dir.exists():
        logger.debug(f'Channel dir not found: {channel_dir}')
        return []

    pending = []
    for jsonl_path in sorted(channel_dir.glob('*.jsonl')):
        with open(jsonl_path) as f:
            for line_idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                for att in msg.get('attachments', []):
                    if not att.get('content_type', '').startswith('image'):
                        continue
                    att_id = att['id']
                    if att_id in processed_ids:
                        continue
                    # 检查本地是否已有文件（跨 run 恢复时 checkpoint 可能不完整）
                    ext = get_ext(att.get('filename', ''), att.get('content_type', ''))
                    local_file = IMAGES_DIR / channel_suffix / f'{att_id}.{ext}'
                    if local_file.exists():
                        processed_ids.add(att_id)
                        continue
                    pending.append({
                        'attachment_id': att_id,
                        'message_id': msg['id'],
                        'channel_id': msg['channel_id'],
                        'filename': att.get('filename', ''),
                        'content_type': att.get('content_type', 'image/jpeg'),
                        'jsonl_path': str(jsonl_path),
                        'line_idx': line_idx,
                        'channel_suffix': channel_suffix,
                    })
    return pending


def update_jsonl_local_path(jsonl_path: str, line_idx: int, attachment_id: str, local_path: str):
    """
    在指定 JSONL 的指定行消息中，为对应附件添加 local_path 字段。
    采用原地重写（读全文件 → 改一行 → 写回）。
    """
    path = Path(jsonl_path)
    lines = path.read_text().splitlines()
    if line_idx >= len(lines):
        return
    try:
        msg = json.loads(lines[line_idx])
    except json.JSONDecodeError:
        return

    updated = False
    for att in msg.get('attachments', []):
        if att['id'] == attachment_id:
            att['local_path'] = local_path
            updated = True

    if updated:
        lines[line_idx] = json.dumps(msg, ensure_ascii=False)
        path.write_text('\n'.join(lines) + '\n')


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Discord 图片附件缓存脚本')
    parser.add_argument('--dry-run', action='store_true', help='只扫描统计，不实际下载')
    parser.add_argument('--reset-checkpoint', action='store_true', help='清除断点，从头开始')
    args = parser.parse_args()

    token = os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        logger.error('DISCORD_BOT_TOKEN not set')
        sys.exit(1)

    # 加载 checkpoint
    cp = load_checkpoint()
    if args.reset_checkpoint:
        cp = {'processed_attachments': [], 'last_run': None}
        logger.info('Checkpoint reset')

    processed_ids = set(cp.get('processed_attachments', []))
    logger.info(f'Already processed: {len(processed_ids)} attachments')

    # 创建 HTTP session
    session = requests.Session()
    session.headers.update({
        'Authorization': f'Bot {token}',
        'User-Agent': 'DiscordBot (brain-in-a-vat, 1.0)',
    })

    # 收集所有待下载图片
    all_pending = []
    for channel_id, channel_suffix in PRIORITY_CHANNELS.items():
        pending = collect_pending_images(channel_suffix, processed_ids)
        logger.info(f'Channel {channel_suffix}: {len(pending)} images pending')
        all_pending.extend(pending)

    logger.info(f'Total pending: {len(all_pending)} images')
    if args.dry_run:
        logger.info('Dry run mode, exiting without downloading')
        return

    # 开始下载
    start_time = time.monotonic()
    downloaded = 0
    skipped = 0
    failed = 0

    for item in all_pending:
        # 检查运行时限
        elapsed = time.monotonic() - start_time
        if elapsed >= MAX_RUNTIME_SECONDS:
            logger.info(f'Time limit reached ({MAX_RUNTIME_SECONDS/60:.0f}min), stopping')
            break
        if downloaded >= MAX_DOWNLOADS_PER_RUN:
            logger.info(f'Download limit reached ({MAX_DOWNLOADS_PER_RUN}), stopping')
            break

        att_id = item['attachment_id']
        channel_suffix = item['channel_suffix']
        ext = get_ext(item['filename'], item['content_type'])
        dest = IMAGES_DIR / channel_suffix / f'{att_id}.{ext}'

        logger.info(f'[{downloaded+1}] Fetching message {item["message_id"]} for attachment {att_id}')

        # 拉取新鲜消息以获取有效 URL
        msg_data = get_fresh_message(session, item['channel_id'], item['message_id'])
        time.sleep(API_DELAY)

        if not msg_data:
            logger.warning(f'Could not fetch message {item["message_id"]}, skipping')
            failed += 1
            continue

        # 从返回消息中找到对应附件的新鲜 URL
        fresh_url = None
        for att in msg_data.get('attachments', []):
            if att['id'] == att_id:
                fresh_url = att.get('url')
                break

        if not fresh_url:
            logger.warning(f'Attachment {att_id} not found in fresh message, skipping')
            skipped += 1
            continue

        # 下载图片
        success = download_image(session, fresh_url, dest)
        if success:
            downloaded += 1
            processed_ids.add(att_id)
            # 相对路径（相对 repo root）
            rel_path = str(dest.relative_to(_REPO_ROOT))
            update_jsonl_local_path(
                item['jsonl_path'], item['line_idx'], att_id, rel_path
            )
            logger.info(f'Saved: {rel_path}')
        else:
            skipped += 1
            # 跳过的也标记为"已处理"，避免重复尝试
            processed_ids.add(att_id)

        # 每 20 张保存一次 checkpoint
        if (downloaded + skipped) % 20 == 0:
            cp['processed_attachments'] = list(processed_ids)
            save_checkpoint(cp)

    # 最终保存 checkpoint
    cp['processed_attachments'] = list(processed_ids)
    save_checkpoint(cp)

    elapsed = time.monotonic() - start_time
    logger.info(
        f'Done in {elapsed:.0f}s — downloaded: {downloaded}, skipped: {skipped}, failed: {failed}'
    )
    logger.info(f'Total processed (cumulative): {len(processed_ids)}')


if __name__ == '__main__':
    main()
