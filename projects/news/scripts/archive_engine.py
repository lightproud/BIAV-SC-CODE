#!/usr/bin/env python3
"""
通用归档引擎 — 声明式来源注册表驱动，打包冷数据 → GitHub Releases → 可选从 git 删除

设计目标（守密人 2026-06-21 裁定 A + 合并）：
  - 把「每种归档来源的差异」抽进 archive_sources.json 配置表，引擎读表干活。
  - 加新归档来源 = 在注册表加一段配置，零新代码。
  - 收编原 archive_discord.py（迁进引擎，标签命名与删数据路径逐行等价）。

用法:
  python archive_engine.py --source discord              # 归档单个来源（按其 cutoff 策略）
  python archive_engine.py --source all                  # 归档注册表全部来源
  python archive_engine.py --source discord --dry-run    # 仅分析，不做任何修改
  python archive_engine.py --source discord --skip-upload
  python archive_engine.py --source discord --force-group 2026-01 [--force-group ...]

注册表: projects/news/scripts/archive_sources.json
每来源日志: <base_dir>/archive-log.json（含 source/tag 字段，向后兼容旧 Discord 日志）
统一索引: projects/news/data/releases-index.json（自动生成，治「Release 好难认」）

来源配置字段: base_dir(来源根目录) / glob(文件匹配) / group_by(分桶:
month_from_stem 按文件名 YYYY-MM-DD 取 YYYY-MM | month_from_parent_dir 按父目录名
YYYY-MM-DD 取 YYYY-MM（日期在目录名，如 fanart）| single) / group_label(single 桶名) /
cutoff_days(仅归档早于 N 天; null=不限龄) / tag_template/title_template/notes_template
(Release 模板, 占位 {group}/{filename}/{size_kb}/{files}) / after_archive(git_rm|keep) /
clean_empty_dirs(归档后清理空目录)。
"""

import argparse
import json
import logging
import os
import subprocess
import tarfile
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
REGISTRY_PATH = Path(__file__).resolve().parent / 'archive_sources.json'
RELEASES_INDEX = REPO_ROOT / 'projects' / 'news' / 'data' / 'releases-index.json'


# ---------- 注册表 ----------

def load_registry() -> dict:
    with open(REGISTRY_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


# ---------- 分桶策略 ----------

def group_of(path: Path, group_by: str, group_label: str) -> str:
    """文件归属哪个桶。"""
    if group_by == 'month_from_stem':
        return path.stem[:7]  # YYYY-MM-DD -> YYYY-MM
    if group_by == 'month_from_parent_dir':
        return path.parent.name[:7]  # 父目录 YYYY-MM-DD -> YYYY-MM（日期在目录名，如 fanart）
    if group_by == 'single':
        return group_label
    raise ValueError(f'unknown group_by: {group_by}')


def is_eligible(path: Path, group_by: str, cutoff_date: str | None) -> bool:
    """文件是否够龄可归档。cutoff_date 为 None 表示不限龄。"""
    if cutoff_date is None:
        return True
    if group_by == 'month_from_stem':
        return path.stem < cutoff_date  # 与原 archive_discord 逐字节等价
    if group_by == 'month_from_parent_dir':
        return path.parent.name < cutoff_date  # 父目录 YYYY-MM-DD 逐字节比较
    # 无日期语义的来源不应配 cutoff_days；保守判为可归档
    return True


def discover(cfg: dict, base_dir: Path, force_groups: list[str]) -> dict[str, list[Path]]:
    """扫描来源，返回 {group: [Path]}（按 group 排序）。"""
    group_by = cfg['group_by']
    group_label = cfg.get('group_label', 'all')
    groups: dict[str, list[Path]] = defaultdict(list)
    if not base_dir.exists():
        return {}

    if force_groups:
        wanted = set(force_groups)
        for f in base_dir.glob(cfg['glob']):
            if not f.is_file():  # glob 可能命中目录（如 fanart 的 thumbs/），只归档文件
                continue
            g = group_of(f, group_by, group_label)
            if g in wanted:
                groups[g].append(f)
    else:
        cutoff_date = None
        cutoff_days = cfg.get('cutoff_days')
        if cutoff_days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=cutoff_days)
            cutoff_date = cutoff.strftime('%Y-%m-%d')
            logger.info(f'Cutoff date: {cutoff_date} ({cutoff_days} days ago)')
        for f in base_dir.glob(cfg['glob']):
            if not f.is_file():  # glob 可能命中目录（如 fanart 的 thumbs/），只归档文件
                continue
            if is_eligible(f, group_by, cutoff_date):
                groups[group_of(f, group_by, group_label)].append(f)
    return dict(sorted(groups.items()))


# ---------- 打包 / 上传 / 删除 ----------

def create_tarball(cfg: dict, base_dir: Path, group: str, files: list[Path]) -> tuple[Path, int]:
    """打 tar.gz；arcname 相对 base_dir（与原 archive_discord 等价）。"""
    tag = cfg['tag_template'].format(group=group)
    archive_path = base_dir / f'{tag}.tar.gz'
    with tarfile.open(archive_path, 'w:gz') as tar:
        for f in sorted(files):
            tar.add(f, arcname=str(f.relative_to(base_dir)))
    size = archive_path.stat().st_size
    logger.info(f'Created {archive_path.name}: {len(files)} files, {size // 1024} KB')
    return archive_path, size


def upload_to_release(cfg: dict, archive_path: Path, group: str, file_count: int) -> bool:
    """经 gh CLI 上传到 GitHub Releases。幂等：先删同名 release/tag。"""
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if not repo:
        logger.error('GITHUB_REPOSITORY not set, cannot upload')
        return False

    tag = cfg['tag_template'].format(group=group)
    size_kb = archive_path.stat().st_size // 1024
    title = cfg['title_template'].format(group=group)
    notes = cfg['notes_template'].format(
        group=group, filename=archive_path.name, size_kb=size_kb, files=file_count,
    )

    subprocess.run(
        ['gh', 'release', 'delete', tag, '--yes', '--cleanup-tag'],
        cwd=REPO_ROOT, capture_output=True,
    )
    result = subprocess.run([
        'gh', 'release', 'create', tag, str(archive_path),
        '--title', title, '--notes', notes, '--repo', repo,
    ], cwd=REPO_ROOT, capture_output=True, text=True)

    if result.returncode == 0:
        logger.info(f'Uploaded to GitHub Releases: {tag}')
        return True
    logger.error(f'Release upload failed: {result.stderr}')
    return False


def git_rm_files(files: list[Path]) -> int:
    """从 git 删除文件（未跟踪则直接 unlink）。返回删除计数。"""
    removed = 0
    for f in files:
        try:
            subprocess.run(
                ['git', 'rm', '-f', '--quiet', str(f)],
                cwd=REPO_ROOT, check=True, capture_output=True,
            )
            removed += 1
        except subprocess.CalledProcessError:
            f.unlink(missing_ok=True)
            removed += 1
    return removed


def clean_empty_dirs(base_dir: Path, files: list[Path]):
    """归档后清理变空的父目录（仅 rmdir 空目录，限 base_dir 内）。"""
    parents = {f.parent for f in files}
    for d in parents:
        try:
            if d != base_dir and d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass


# ---------- 日志 / 索引 ----------

def load_log(log_path: Path) -> list[dict]:
    if log_path.exists():
        try:
            with open(log_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_log(log_path: Path, log: list[dict]):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, 'w', encoding='utf-8') as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


def rebuild_releases_index(registry: dict):
    """汇总各来源 archive-log 成统一 releases-index.json（治「好难认」）。"""
    index = []
    for source_id, cfg in registry.items():
        base_dir = REPO_ROOT / cfg['base_dir']
        log = load_log(base_dir / 'archive-log.json')
        for entry in log:
            group = entry.get('group') or entry.get('month', '')
            index.append({
                'source': entry.get('source', source_id),
                'group': group,
                'tag': entry.get('tag', cfg['tag_template'].format(group=group)),
                'files': entry.get('files'),
                'archive_size_bytes': entry.get('archive_size_bytes'),
                'uploaded_to_releases': entry.get('uploaded_to_releases'),
                'archived_at': entry.get('archived_at'),
            })
    index.sort(key=lambda e: (e['source'], e['group']))
    RELEASES_INDEX.parent.mkdir(parents=True, exist_ok=True)
    with open(RELEASES_INDEX, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    logger.info(f'releases-index.json: {len(index)} entries')


# ---------- 主流程 ----------

def archive_source(source_id: str, cfg: dict, args) -> None:
    logger.info(f'==== source: {source_id} ====')
    base_dir = REPO_ROOT / cfg['base_dir']
    by_group = discover(cfg, base_dir, args.force_group)
    if not by_group:
        logger.info(f'[{source_id}] nothing to archive')
        return

    total_files = sum(len(fs) for fs in by_group.values())
    total_size = sum(f.stat().st_size for fs in by_group.values() for f in fs)
    logger.info(f'[{source_id}] {total_files} files across {len(by_group)} groups ({total_size // 1048576} MB)')
    for group, files in by_group.items():
        logger.info(f'  {group}: {len(files)} files, {sum(f.stat().st_size for f in files) // 1024} KB')

    if args.dry_run:
        logger.info('DRY RUN — no changes made')
        return

    log_path = base_dir / 'archive-log.json'
    log = load_log(log_path)

    for group, files in by_group.items():
        logger.info(f'--- archiving [{source_id}] {group} ---')
        archive_path, archive_size = create_tarball(cfg, base_dir, group, files)

        uploaded = False
        if not args.skip_upload:
            uploaded = upload_to_release(cfg, archive_path, group, len(files))
            if not uploaded:
                logger.error(f'Upload failed for {group}, keeping files')
                archive_path.unlink(missing_ok=True)
                continue

        if cfg.get('after_archive') == 'git_rm':
            removed = git_rm_files(files)
            logger.info(f'Removed {removed} files from git for {group}')

        if uploaded:
            archive_path.unlink(missing_ok=True)

        log.append({
            'source': source_id,
            'group': group,
            'tag': cfg['tag_template'].format(group=group),
            'files': len(files),
            'archive_size_bytes': archive_size,
            'uploaded_to_releases': uploaded,
            'archived_at': datetime.now(timezone.utc).isoformat(),
        })
        save_log(log_path, log)

    if cfg.get('clean_empty_dirs'):
        clean_empty_dirs(base_dir, [f for fs in by_group.values() for f in fs])
    logger.info(f'[{source_id}] complete: {len(by_group)} groups, {total_files} files')


def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description='Declarative archive engine → GitHub Releases')
    parser.add_argument('--source', required=True, help="source id from registry, or 'all'")
    parser.add_argument('--dry-run', action='store_true', help='Analyze only, no changes')
    parser.add_argument('--skip-upload', action='store_true', help='Skip GitHub Releases upload')
    parser.add_argument(
        '--force-group', action='append', default=[], metavar='GROUP',
        help='Force-archive specific group(s), bypassing cutoff. Repeatable.',
    )
    args = parser.parse_args(argv)

    registry = load_registry()
    if args.source == 'all':
        targets = list(registry.items())
    elif args.source in registry:
        targets = [(args.source, registry[args.source])]
    else:
        logger.error(f'unknown source: {args.source} (known: {", ".join(registry)})')
        return

    for source_id, cfg in targets:
        archive_source(source_id, cfg, args)
    if not args.dry_run:
        rebuild_releases_index(registry)


if __name__ == '__main__':
    main()
