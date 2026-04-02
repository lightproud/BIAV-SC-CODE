#!/usr/bin/env python3
"""
Discord 月度归档脚本 — 打包超 60 天 JSONL → GitHub Releases → 从 git 删除

用法:
  python archive_discord.py                  # 实际执行：打包 + 上传 + 删除
  python archive_discord.py --dry-run        # 仅分析，不做任何修改
  python archive_discord.py --skip-upload    # 打包 + 删除，跳过 Releases 上传

数据目录: projects/news/data/discord/channels/
归档日志: projects/news/data/discord/archive-log.json
"""

import argparse
import json
import logging
import os
import subprocess
import tarfile
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DISCORD_DIR = REPO_ROOT / 'projects' / 'news' / 'data' / 'discord'
CHANNELS_DIR = DISCORD_DIR / 'channels'
ARCHIVE_LOG = DISCORD_DIR / 'archive-log.json'
CUTOFF_DAYS = 60


def find_archivable_files(cutoff_date: str) -> dict[str, list[Path]]:
    """Find all JSONL files older than cutoff_date, grouped by YYYY-MM."""
    by_month: dict[str, list[Path]] = defaultdict(list)
    if not CHANNELS_DIR.exists():
        return by_month
    for ch_dir in CHANNELS_DIR.iterdir():
        if not ch_dir.is_dir():
            continue
        for jsonl in ch_dir.glob('*.jsonl'):
            date_str = jsonl.stem  # YYYY-MM-DD
            if date_str < cutoff_date:
                month_key = date_str[:7]  # YYYY-MM
                by_month[month_key].append(jsonl)
    return dict(sorted(by_month.items()))


def create_tarball(month: str, files: list[Path]) -> tuple[Path, int]:
    """Create a tar.gz archive for a month's files. Returns (path, size_bytes)."""
    archive_path = DISCORD_DIR / f'discord-archive-{month}.tar.gz'
    with tarfile.open(archive_path, 'w:gz') as tar:
        for f in sorted(files):
            arcname = str(f.relative_to(DISCORD_DIR))
            tar.add(f, arcname=arcname)
    size = archive_path.stat().st_size
    logger.info(f'Created {archive_path.name}: {len(files)} files, {size // 1024} KB')
    return archive_path, size


def upload_to_release(archive_path: Path, month: str) -> bool:
    """Upload archive to GitHub Releases via gh CLI. Returns success."""
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if not repo:
        logger.error('GITHUB_REPOSITORY not set, cannot upload')
        return False

    tag = f'discord-archive-{month}'
    size_kb = archive_path.stat().st_size // 1024

    # Delete existing release/tag if any (idempotent re-runs)
    subprocess.run(
        ['gh', 'release', 'delete', tag, '--yes', '--cleanup-tag'],
        cwd=REPO_ROOT, capture_output=True,
    )

    result = subprocess.run([
        'gh', 'release', 'create', tag,
        str(archive_path),
        '--title', f'Discord Archive {month}',
        '--notes', (
            f'Discord message archive for {month}.\n'
            f'{archive_path.name}: {size_kb} KB compressed.'
        ),
        '--repo', repo,
    ], cwd=REPO_ROOT, capture_output=True, text=True)

    if result.returncode == 0:
        logger.info(f'Uploaded to GitHub Releases: {tag}')
        return True
    else:
        logger.error(f'Release upload failed: {result.stderr}')
        return False


def git_rm_files(files: list[Path]) -> int:
    """Remove files from git tracking. Returns count removed."""
    removed = 0
    for f in files:
        try:
            subprocess.run(
                ['git', 'rm', '-f', '--quiet', str(f)],
                cwd=REPO_ROOT, check=True, capture_output=True,
            )
            removed += 1
        except subprocess.CalledProcessError:
            # File might not be tracked; just delete it
            f.unlink(missing_ok=True)
            removed += 1
    return removed


def clean_empty_dirs():
    """Remove empty channel directories."""
    if not CHANNELS_DIR.exists():
        return
    for ch_dir in list(CHANNELS_DIR.iterdir()):
        if ch_dir.is_dir() and not any(ch_dir.iterdir()):
            ch_dir.rmdir()


def load_archive_log() -> list[dict]:
    if ARCHIVE_LOG.exists():
        try:
            with open(ARCHIVE_LOG, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_archive_log(log: list[dict]):
    ARCHIVE_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(ARCHIVE_LOG, 'w', encoding='utf-8') as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description='Discord monthly archive cleanup')
    parser.add_argument('--dry-run', action='store_true', help='Analyze only, no changes')
    parser.add_argument('--skip-upload', action='store_true', help='Skip GitHub Releases upload')
    args = parser.parse_args()

    cutoff = datetime.now(timezone.utc) - timedelta(days=CUTOFF_DAYS)
    cutoff_date = cutoff.strftime('%Y-%m-%d')
    logger.info(f'Cutoff date: {cutoff_date} ({CUTOFF_DAYS} days ago)')

    by_month = find_archivable_files(cutoff_date)
    if not by_month:
        logger.info('No files older than cutoff — nothing to archive')
        return

    # Summary
    total_files = sum(len(files) for files in by_month.values())
    total_size = sum(f.stat().st_size for files in by_month.values() for f in files)
    logger.info(f'Found {total_files} archivable files across {len(by_month)} months ({total_size // 1048576} MB)')
    for month, files in by_month.items():
        month_size = sum(f.stat().st_size for f in files)
        logger.info(f'  {month}: {len(files)} files, {month_size // 1024} KB')

    if args.dry_run:
        logger.info('DRY RUN — no changes made')
        return

    # Process each month
    archive_log = load_archive_log()

    for month, files in by_month.items():
        logger.info(f'--- Archiving {month} ---')

        # 1. Create tarball
        archive_path, archive_size = create_tarball(month, files)

        # 2. Upload to Releases (unless skipped)
        uploaded = False
        if not args.skip_upload:
            uploaded = upload_to_release(archive_path, month)
            if not uploaded:
                logger.error(f'Upload failed for {month}, keeping files in git')
                archive_path.unlink(missing_ok=True)
                continue

        # 3. Remove files from git
        removed = git_rm_files(files)
        logger.info(f'Removed {removed} files from git for {month}')

        # 4. Clean up tarball (it's on Releases now, or user chose skip-upload)
        if uploaded:
            archive_path.unlink(missing_ok=True)

        # 5. Log
        archive_log.append({
            'month': month,
            'files': len(files),
            'archive_size_bytes': archive_size,
            'uploaded_to_releases': uploaded,
            'archived_at': datetime.now(timezone.utc).isoformat(),
        })
        save_archive_log(archive_log)

    clean_empty_dirs()

    # Final summary
    logger.info(f'Archive complete: {len(by_month)} months processed, {total_files} files removed')


if __name__ == '__main__':
    main()
