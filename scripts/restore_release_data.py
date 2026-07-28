#!/usr/bin/env python3
"""构建期从 GitHub Releases 临时还原全量档案到工作树（用完即弃，不进 git）。

背景：银芯瘦身把全量历史 / 大资产移出 git、存入 Releases（决策 178/179/199，见
RELEASES.md）。但「全量档案层」分析索引（build_community_index.py）需要看到全量
数据才名副其实。本脚本在**构建期**把指定 release 的档案下载+解包到工作树，建完
索引即可丢弃——数据本体仍只留 Releases，git 零膨胀（守密人 2026-06-21 裁定：
构建期取用还原，不拿回 git）。

幂等：归档解包是覆盖/补全，已存在的目标目录照常在其上重解（`--force` 只关掉那句提示，
不改变下载行为）。无第三方依赖（urllib + tarfile）。公开 repo 的 release 资产可匿名
下载；私有 repo 在 CI 用 GITHUB_TOKEN。

退出码（抢救网的绿色只许有一种含义）：0 = 匹配到的资产**全部**还原成功；
非零 = 一件都没匹配上，或有任何一件下载 / 解包失败（失败者逐件点名）。

资产形态两类：``.tar.gz``/``.tgz`` 解包进 dest；其余（如向量索引 ``kb_vectors.json.gz``
——纯 gzip JSON，非 tarball）按原名平拷贝进 dest（勿对非 tar 资产走 tarfile，会炸
ReadError）。

用法：
    # 还原 community-data 里的 discord 月归档到 discord 数据目录
    python3 scripts/restore_release_data.py \\
        --tag community-data --pattern 'discord-archive-*.tar.gz' \\
        --dest Public-Info-Pool/Record/Community/discord

    # 还原向量腿真索引（chunk2，守密人 2026-07-05 裁定 1）
    python3 scripts/restore_release_data.py \\
        --tag community-assets --pattern 'kb_vectors.json.gz' --dest okf
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# 仓库标识：CI 内取 GITHUB_REPOSITORY（永远是当下真名），否则回落现名常量。
# 此前硬编码的是**改名前**的 `lightproud/brain-in-a-vat`。今天它仍可达——GitHub 的
# 改名重定向在起作用（实测 raw 与 releases 主机均 200），所以这不是「已经断了」;
# 但把 §6.3 三张抢救网之一的还原路径押在一条重定向上并不合适：owner 一旦重新创建
# 同名仓库，重定向即失效，而本脚本恰是数据永久丢失时的最后一手。
OWNER_REPO = os.environ.get("GITHUB_REPOSITORY") or "lightproud/BIAV-SC-CODE"
API = "https://api.github.com"


def _req(url: str) -> urllib.request.Request:
    r = urllib.request.Request(url)
    r.add_header("Accept", "application/vnd.github+json")
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        r.add_header("Authorization", f"Bearer {tok}")
    return r


DOWNLOAD = f"https://github.com/{OWNER_REPO}/releases/download"


def list_assets(tag: str) -> list[dict]:
    url = f"{API}/repos/{OWNER_REPO}/releases/tags/{tag}"
    with urllib.request.urlopen(_req(url), timeout=60) as resp:
        data = json.loads(resp.read())
    return data.get("assets", [])


def _month_range(lo: str, hi: str) -> list[str]:
    y, m = int(lo[:4]), int(lo[5:7])
    ey, em = int(hi[:4]), int(hi[5:7])
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def assets_from_months(tag: str, pattern: str, months: list[str]) -> list[dict]:
    """绕过 API：把 pattern 里的 '*' 用每个月展开，直接拼下载主机 URL。

    用于沙箱封禁 api.github.com 的受限环境（如云容器会话）；下载主机 github.com
    通常仍可达。CI 有 GITHUB_TOKEN + 全网，走 list_assets() 即可。
    """
    out = []
    for mo in months:
        name = pattern.replace("*", mo)
        out.append({"name": name, "size": 0,
                    "browser_download_url": f"{DOWNLOAD}/{tag}/{name}"})
    return out


def download(url: str, dest: Path) -> None:
    """下载到 dest，并**核对 Content-Length**——短读一律判失败，绝不留半截文件。

    urllib 的 `read(n)` 在连接被提前关闭时**返回空串而不抛异常**（CPython 自己在
    http/client.py 注着「Ideally, we would raise IncompleteRead」），于是 `while chunk :=`
    正常收尾、调用方看到的是一次成功。落到本脚本上：`kb_vectors.json.gz` 这类非 tarball
    资产会被**逐字拷进 dest**，`restore` 照打「restored 1 asset(s)」并退 0——一次静默的
    半截还原。而本脚本是 §6.3 三张抢救网之一，它的「成功」不许有第二种含义。
    """
    written = 0
    with urllib.request.urlopen(_req(url), timeout=600) as resp, dest.open("wb") as fh:
        # 假响应对象（单测）没有 getheader：拿不到声明长度就跳过核对，不改既有契约。
        try:
            raw = resp.getheader("Content-Length")
            declared = int(raw) if raw is not None else None
        except (AttributeError, TypeError, ValueError):
            declared = None
        while chunk := resp.read(1 << 20):
            fh.write(chunk)
            written += len(chunk)
    if declared is not None and written != declared:
        dest.unlink(missing_ok=True)  # 半截文件比没有更坏：它会被下游当成完整档案读
        raise OSError(
            f"下载不完整: {url} 声明 {declared} 字节，实收 {written} 字节（已删除半截文件）")


def _safe_extractall(tar: tarfile.TarFile, dest: Path) -> None:
    """把 tar 解到 dest，拒绝任何会写到 dest 之外的成员。

    tarfile.extractall 默认完全信任归档内的成员名：`../../x` 或 `/etc/x` 会照写不误
    （Zip Slip），链接成员还能把后续写入重定向到任意路径。Python 3.12 起提供
    `filter='data'` 做标准加固；3.11 没有该参数，故这里给出等价的显式校验，
    两条路径行为一致。
    """
    try:
        tar.extractall(dest, filter="data")  # Python 3.12+（及 3.11.4+ 的回移版）
        return
    except TypeError:
        pass  # 3.11.3 及更早：无 filter 参数，走下面的显式校验
    except tarfile.TarError as e:
        # 两条分支的失败形态必须一致：filter='data' 抛的是 tarfile.FilterError 家族
        # （OutsideDestinationError / AbsoluteLinkError 等），若原样上抛，调用方在
        # 新旧 Python 上会看到完全不同的异常类型，出错信息也不指向本脚本。
        raise SystemExit(f"[restore] 归档成员被安全过滤器拒绝: {e}") from e

    root = dest.resolve()
    for member in tar.getmembers():
        if member.issym() or member.islnk():
            raise SystemExit(f"[restore] 拒绝解压链接成员（可重定向写入）: {member.name!r}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"[restore] 拒绝解压特殊文件成员: {member.name!r}")
        target = (root / member.name).resolve()
        if target != root and root not in target.parents:
            raise SystemExit(f"[restore] 拒绝越出目标目录的成员（路径穿越）: {member.name!r}")
    tar.extractall(dest)  # noqa: S202  成员已逐个校验，不会越界


def restore(tag: str, pattern: str, dest: Path, force: bool,
            months: list[str] | None = None) -> int:
    dest = (REPO / dest) if not dest.is_absolute() else dest
    dest.mkdir(parents=True, exist_ok=True)
    try:
        assets = [a for a in list_assets(tag) if fnmatch.fnmatch(a["name"], pattern)]
    except Exception as e:  # api.github.com 不可达（受限环境）→ 月份展开回退
        if not months:
            raise SystemExit(
                f"[restore] release API unreachable ({e}); pass --months LO..HI to "
                f"download via the github.com release host directly.") from e
        print(f"[restore] release API unreachable ({e}); falling back to month expansion")
        assets = assets_from_months(tag, pattern, months)
    if not assets:
        print(f"[restore] no asset matches {pattern!r} in release {tag!r}")
        return 0
    n = 0
    failed: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for a in sorted(assets, key=lambda x: x["name"]):
            tgz = Path(tmp) / a["name"]
            print(f"[restore] {a['name']} ({a['size'] / 1e6:.1f} MB)")
            # 逐件兜住：原先第一件失败就整轮抛出，后面的月份**一件都不再试**——
            # 33 个月的历史里缺一个月的资产，就永远拿不到它后面的 28 个月，而现场只留
            # 一份 traceback，没有「哪些还原成了 / 哪些没有」的清单。改为每件独立记账、
            # 跑完再统一判红：能救的全救回来，救不回的逐件点名。
            try:
                download(a["browser_download_url"], tgz)
                if a["name"].endswith((".tar.gz", ".tgz")):
                    with tarfile.open(tgz, "r:gz") as tar:
                        # 归档内**应当**是相对路径 channels/{id}/*.jsonl，但 extractall 会照
                        # 单全收：成员名里的 `../` 或绝对路径能把文件写到 dest 之外（Zip Slip),
                        # 符号链接成员还能把后续写入重定向到任意位置。这条路径吃的是从网络
                        # 下载的 Release 资产，「我们自己传的」不是安全边界——资产可被替换、
                        # 传输可被劫持，而这份脚本常以仓库写权限运行。
                        # filter='data' 是 Python 3.12+ 的标准加固（拒绝绝对/穿越路径、
                        # 剥离特殊文件与链接）；3.11 无此参数，退回自实现的同等校验。
                        _safe_extractall(tar, dest)
                else:
                    # 非 tarball 资产（如 kb_vectors.json.gz 纯 gzip JSON）：按原名平拷贝。
                    shutil.copy2(tgz, dest / a["name"])
            except (OSError, tarfile.TarError, EOFError) as e:
                # SystemExit（_safe_extractall 的安全拒绝）不在此列：那是**必须整轮中止**
                # 的安全事件，不是「这一件没拿到」。
                print(f"[restore] !! {a['name']} 失败: {type(e).__name__}: {e}")
                failed.append(a["name"])
                continue
            n += 1
    # --dest 显式支持绝对路径（见上方 is_absolute 分支）；仓外目标 relative_to 会抛
    # ValueError——那会让**已经成功还原**的一次运行以 traceback 收场（假失败），
    # 而调用方通常据退出码决定要不要重跑。仅是打印，落不下相对路径就打绝对的。
    try:
        shown = dest.relative_to(REPO)
    except ValueError:
        shown = dest
    print(f"[restore] restored {n} asset(s) into {shown}/")
    if failed:
        raise SystemExit(
            f"[restore] {len(failed)}/{len(assets)} 件未还原（本次为**部分还原**，"
            f"dest 内容不完整）: {', '.join(failed)}")
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="Restore full-archive data from a GitHub Release (build-time, ephemeral).")
    ap.add_argument("--tag", required=True, help="release tag, e.g. community-data")
    ap.add_argument("--pattern", required=True, help="asset name glob, e.g. 'discord-archive-*.tar.gz'")
    ap.add_argument("--dest", required=True, type=Path, help="extract destination (repo-relative ok)")
    ap.add_argument("--force", action="store_true", help="re-download even if dest non-empty")
    ap.add_argument("--months", metavar="LO..HI",
                    help="回退：api.github.com 不可达时，按 'YYYY-MM..YYYY-MM' 展开 "
                         "pattern 的 '*' 直连下载主机（受限环境用）")
    args = ap.parse_args()

    months = None
    if args.months:
        lo, _, hi = args.months.partition("..")
        months = _month_range(lo.strip(), hi.strip())

    dest = (REPO / args.dest) if not args.dest.is_absolute() else args.dest
    if dest.exists() and any(dest.iterdir()) and not args.force:
        # 已有数据：仍补下载（归档解包是覆盖/补全，幂等安全），但提示。
        print(f"[restore] dest {args.dest} non-empty — extracting on top (idempotent). Use --force to force.")
    n = restore(args.tag, args.pattern, args.dest, args.force, months)
    if not n:
        # 「一件都没匹配上」不是成功。tag 改名、资产改后缀、pattern 打错——三种都让
        # 这条 §6.3 抢救网**一声不吭地退 0**，而链式调用（`restore && build_index`）
        # 会照常往下走，在一个空目录上建索引。抢救网的绿色只许有一种含义。
        print("[restore] 未还原任何资产 —— 视为失败（检查 --tag / --pattern 是否仍与 "
              "Release 资产名一致）")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
