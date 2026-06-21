#!/usr/bin/env python3
"""把 unpacked-data release 的 **text 部分** 迁入 git（二进制留 Releases）。

守密人 2026-06-21 裁定：Releases 只留真·二进制（立绘/音频/视频 + lua-bytecode +
config 的 binary/debug 块）；可 diff/grep/溯源的 text 解包数据迁回 git。本脚本下载
unpacked-data 的 text-bearing 资产，**按 text-only 过滤解包**到目标目录。

text vs 二进制分类（实测 2026-06-21）：
  gamescript  2295 .txt           → 全收
  sdk-scripts 1007 .txt + 127 json → 全收
  text-data   94 .txt + 24 .lua    → 全收
  config      150 .txt + config_binary/ + config_debug/ + .luac → 仅收 text，滤二进制
  lua-bytecode 1592 .luac          → 不下载（纯二进制，留 Releases）

执行约束（决策 2026-06-20）：云容器无 Releases 写权限、大推易触发 413；本脚本
经 GitHub Actions（migrate-data-to-git.yml）跑，在 GitHub 基建上提交。受限环境
本地可跑「下载+解包」验证产出，但**不要从容器直推**。

下载双路径同 restore_release_data：release API（CI 带 token）/ github.com 下载主机。
"""
from __future__ import annotations

import argparse
import sys
import tarfile
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restore_release_data import download, list_assets, DOWNLOAD  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
TAG = "unpacked-data"
# text-bearing 资产（lua-bytecode 纯二进制，不取）
TEXT_ASSETS = [
    "morimens-gamescript.tar.gz",
    "morimens-sdk-scripts.tar.gz",
    "morimens-text-data.tar.gz",
    "morimens-config.tar.gz",   # 混合：解包时滤掉 binary 成员
]
# 二进制成员特征（config 内）：路径片段 / 扩展名
_BINARY_DIRS = ("config_binary/", "config_debug/", "hook_capture/")
_BINARY_EXT = (".luac",)


def _is_text_member(name: str) -> bool:
    low = name.lower()
    if any(d in low for d in _BINARY_DIRS):
        return False
    if low.endswith(_BINARY_EXT):
        return False
    return True


def _asset_urls() -> list[tuple[str, str]]:
    """(name, url)。优先 release API（拿真实 URL），失败回落下载主机直拼。"""
    try:
        assets = {a["name"]: a["browser_download_url"] for a in list_assets(TAG)}
        return [(n, assets[n]) for n in TEXT_ASSETS if n in assets]
    except Exception as e:
        print(f"[migrate] release API unreachable ({e}); using download host directly")
        return [(n, f"{DOWNLOAD}/{TAG}/{n}") for n in TEXT_ASSETS]


def migrate(dest: Path) -> tuple[int, int]:
    dest = (REPO / dest) if not dest.is_absolute() else dest
    dest.mkdir(parents=True, exist_ok=True)
    files, skipped = 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, url in _asset_urls():
            tgz = Path(tmp) / name
            print(f"[migrate] {name}")
            download(url, tgz)
            with tarfile.open(tgz, "r:gz") as tar:
                members = []
                for m in tar.getmembers():
                    if m.isdir():
                        continue
                    if _is_text_member(m.name):
                        members.append(m)
                        files += 1
                    else:
                        skipped += 1
                tar.extractall(dest, members=members)
    try:
        shown = dest.relative_to(REPO)
    except ValueError:
        shown = dest
    print(f"[migrate] extracted {files} text file(s) into {shown}/ "
          f"({skipped} binary member(s) skipped, left in Releases)")
    return files, skipped


def main() -> None:
    ap = argparse.ArgumentParser(description="Migrate text portion of unpacked-data release into git.")
    ap.add_argument("--dest", type=Path, default=Path("Public-Info-Pool/game-unpacked-data"),
                    help="目标目录（repo-relative；默认 Public-Info-Pool/game-unpacked-data）")
    args = ap.parse_args()
    migrate(args.dest)


if __name__ == "__main__":
    main()
