#!/usr/bin/env python3
"""
Discord 图片附件下载器

扫描 JSONL 归档文件，下载图片附件到本地缓存，防止 CDN 签名链接过期。

用法:
  python download_discord_images.py                       # 下载最近 30 天内的新图片
  python download_discord_images.py --days 7              # 只处理最近 7 天
  python download_discord_images.py --days 90             # 处理最近 90 天
  python download_discord_images.py --max-images 500      # 最多处理 500 张
"""

import argparse
import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).parent.parent.parent.parent
DISCORD_DATA_DIR = _REPO_ROOT / 'projects' / 'news' / 'data' / 'discord'
CHANNELS_DIR = DISCORD_DATA_DIR / 'channels'
IMAGES_DIR = DISCORD_DATA_DIR / 'images'

DISCORD_API_BASE = 'https://discord.com/api/v10'

# 限流：最多 5 req/s（远低于 Discord 50 req/s 上限）
REQUEST_INTERVAL = 0.2  # seconds between API calls


def get_headers():
    token = os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        raise RuntimeError('DISCORD_BOT_TOKEN 环境变量未设置')
    return {'Authorization': f'Bot {token}'}


def fetch_fresh_attachment_urls(channel_id: str, message_id: str) -> dict[str, str]:
    """
    调用 Discord API 获取消息，返回 {attachment_id: fresh_url} 映射。
    如果消息不存在（403/404），返回空字典。
    """
    url = f'{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}'
    try:
        resp = requests.get(url, headers=get_headers(), timeout=15)
        if resp.status_code in (403, 404):
            logger.warning(f'消息已删或无权限 channel={channel_id} msg={message_id}: HTTP {resp.status_code}')
            return {}
        if resp.status_code == 429:
            retry_after = resp.json().get('retry_after', 5)
            logger.warning(f'Rate limited，等待 {retry_after}s...')
            time.sleep(float(retry_after))
            return fetch_fresh_attachment_urls(channel_id, message_id)
        resp.raise_for_status()
        data = resp.json()
        return {
            att['id']: att['url']
            for att in data.get('attachments', [])
            if att.get('url')
        }
    except requests.RequestException as e:
        logger.error(f'API 请求失败 channel={channel_id} msg={message_id}: {e}')
        return {}


def ext_from_filename(filename: str) -> str:
    """从文件名提取扩展名（含点），默认 .bin。"""
    suffix = Path(filename).suffix.lower()
    return suffix if suffix else '.bin'


def download_image(url: str, dest: Path) -> bool:
    """下载图片到 dest，成功返回 True。"""
    try:
        resp = requests.get(url, timeout=30, stream=True)
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=65536):
                f.write(chunk)
        logger.info(f'已下载 {dest.name} ({dest.stat().st_size} bytes)')
        return True
    except requests.RequestException as e:
        logger.error(f'下载失败 {url}: {e}')
        if dest.exists():
            dest.unlink()
        return False


def collect_pending_images(days: int) -> list[dict]:
    """
    扫描 JSONL 文件，收集所有未缓存的图片附件信息。
    返回列表，每项: {attachment_id, filename, content_type, channel_id, message_id}
    仅处理最近 `days` 天内的文件。
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_date = cutoff.date()

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    existing = {p.stem for p in IMAGES_DIR.iterdir() if p.is_file()}

    pending = []

    for jsonl_path in sorted(CHANNELS_DIR.rglob('*.jsonl'), reverse=True):
        # 从文件名解析日期（格式 YYYY-MM-DD.jsonl）
        try:
            file_date = datetime.strptime(jsonl_path.stem, '%Y-%m-%d').date()
        except ValueError:
            continue

        if file_date < cutoff_date:
            continue

        try:
            with open(jsonl_path, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    channel_id = msg.get('channel_id', '')
                    message_id = msg.get('id', '')

                    for att in msg.get('attachments', []):
                        content_type = att.get('content_type', '')
                        if not content_type.startswith('image/'):
                            continue
                        att_id = att.get('id', '')
                        if not att_id:
                            continue
                        if att_id in existing:
                            continue
                        filename = att.get('filename', 'image.bin')
                        pending.append({
                            'attachment_id': att_id,
                            'filename': filename,
                            'content_type': content_type,
                            'channel_id': channel_id,
                            'message_id': message_id,
                        })
                        existing.add(att_id)  # 同一次运行内去重
        except OSError as e:
            logger.warning(f'无法读取 {jsonl_path}: {e}')

    return pending


def process_images(pending: list[dict], max_images: int) -> tuple[int, int]:
    """
    下载 pending 列表中的图片，最多处理 max_images 张。
    返回 (成功数, 跳过/失败数)。
    """
    if not pending:
        logger.info('没有新图片需要下载')
        return 0, 0

    batch = pending[:max_images]
    logger.info(f'待下载 {len(pending)} 张，本次处理 {len(batch)} 张')

    ok = 0
    skipped = 0

    for item in batch:
        att_id = item['attachment_id']
        filename = item['filename']
        channel_id = item['channel_id']
        message_id = item['message_id']
        ext = ext_from_filename(filename)
        dest = IMAGES_DIR / f'{att_id}{ext}'

        if dest.exists():
            ok += 1
            continue

        # 通过 API 拿新鲜 URL
        time.sleep(REQUEST_INTERVAL)
        fresh_urls = fetch_fresh_attachment_urls(channel_id, message_id)

        if att_id not in fresh_urls:
            logger.warning(f'附件 {att_id} 在新鲜消息中不存在，跳过')
            skipped += 1
            continue

        fresh_url = fresh_urls[att_id]
        if download_image(fresh_url, dest):
            ok += 1
        else:
            skipped += 1

    return ok, skipped


def main():
    parser = argparse.ArgumentParser(description='下载 Discord 图片附件到本地缓存')
    parser.add_argument('--days', type=int, default=30,
                        help='扫描最近 N 天的 JSONL 文件（默认 30）')
    parser.add_argument('--max-images', type=int, default=200,
                        help='单次最多下载图片数（默认 200，避免 Actions 超时）')
    args = parser.parse_args()

    logger.info(f'扫描最近 {args.days} 天的图片附件...')
    pending = collect_pending_images(days=args.days)
    logger.info(f'共发现 {len(pending)} 张未缓存图片')

    ok, skipped = process_images(pending, max_images=args.max_images)
    logger.info(f'完成：成功 {ok} 张，跳过/失败 {skipped} 张')

    if ok == 0 and skipped == 0 and not pending:
        logger.info('全部图片已缓存，无需操作')


if __name__ == '__main__':
    main()
