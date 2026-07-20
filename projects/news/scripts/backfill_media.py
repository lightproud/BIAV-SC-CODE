#!/usr/bin/env python3
"""媒体补录器 — 扫全量归档，把仍存活的图片全部下载归档，二进制走 Releases（决策 038/059）。

关键认知（守密人 2026-06-02 指正）：归档丢的只是带签名的 CDN 链接，**附件本体仍在 Discord**。
Discord 附件 URL 的过期只在查询参数（ex/is/hm）；用 Bot Token 调
`POST /attachments/refresh-urls` 可把过期链接换成新签名链接，再下载。所以 Discord 图几乎
全部可补，不是只有最近 1 天。持久平台源（YouTube/Bilibili/Reddit/Pixiv）带 Referer 直接下。

流程：
  1. 扫 platforms/*/*.json 的 media_url + discord/channels/*/*.jsonl 的 image 附件（全历史）；
  2. Discord 过期 URL 经 refresh-urls 批量刷新（需 DISCORD_BOT_TOKEN，bot 须能访问该频道）；
  3. 按源带正确 Referer 下载到 media/files/（gitignore，不进 git）；
  4. 写 media/backfill_manifest.json（进 git 的文本清单）；
  5. --upload：打包 media/files/ 传 GitHub Releases（tag=community-assets「社区二创」，需 GH_TOKEN）。

清单已 ok 的跳过（可续跑）；--budget 秒级预算，超时优雅退出。

用法：
  DISCORD_BOT_TOKEN=xxx python projects/news/scripts/backfill_media.py        # 全量补录
  python projects/news/scripts/backfill_media.py --no-discord                 # 只补持久平台源
  python projects/news/scripts/backfill_media.py --upload                     # 打包传 Releases
"""
import os, sys, json, re, glob, time, argparse, subprocess, hashlib, html
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import news_common  # SSRF 守卫 + safe_get 单一真源（R2-H1：补齐姊妹下载路径）
import archive_layout  # 归档布局单一真相源（分仓桥接：env BIAV_SC_DATA_ROOT 或在树默认）
import requests

ROOT = "projects/news/data"            # media 输出（二进制，gitignore，留原地）
SRC = str(archive_layout.community_root())  # 源读取根（分仓桥接：随 community_root() 换位 data 仓 / 在树）
FILES = f"{ROOT}/media/files"
MANIFEST = f"{ROOT}/media/backfill_manifest.json"
UA = "Mozilla/5.0 (silver-core media backfill)"
REFERER = {"pixiv": "https://www.pixiv.net/", "bilibili": "https://www.bilibili.com/"}
RELEASE_TAG = "community-assets"  # 2026-06-21 收敛：media 并入「社区二创」桶
REFRESH_API = "https://discord.com/api/v10/attachments/refresh-urls"
REFRESH_BATCH = 50


def load_manifest():
    return json.load(open(MANIFEST, encoding="utf-8")) if os.path.isfile(MANIFEST) else {}


def save_manifest(m):
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump(m, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def ext_of(url, d="jpg"):
    m = re.search(r"\.(jpg|jpeg|png|gif|webp|mp4)(\?|$)", url, re.I)
    return m.group(1).lower() if m else d


def fname(url, source):
    return f"{source}_{hashlib.md5(url.encode()).hexdigest()[:12]}.{ext_of(url)}"


def fetch(url, dest, source):
    url = html.unescape(url)  # 归档 URL 常含 &amp; 等实体，破坏签名导致 403
    headers = {"User-Agent": UA}
    if source in REFERER:
        headers["Referer"] = REFERER[source]
    # 经 news_common.safe_get：SSRF 守卫 + 逐跳重校验 + IP pin，禁用自动重定向（R2-H1）。
    try:
        resp = news_common.safe_get(url, headers=headers, timeout=20)
    except ValueError:
        return "err_unsafe_url"  # 不安全 URL / 坏重定向，拒绝
    try:
        resp.raise_for_status()
        data = resp.content
    except requests.HTTPError:
        return f"http_{resp.status_code}"
    except requests.RequestException as e:
        return f"err_{type(e).__name__}"
    if len(data) < 200:
        return "empty"
    open(dest, "wb").write(data)
    return "ok"


def refresh_discord(urls, token):
    """批量把过期 Discord 链接换成新签名链接。返回 {original: refreshed}。"""
    out = {}
    for i in range(0, len(urls), REFRESH_BATCH):
        batch = urls[i:i + REFRESH_BATCH]
        body = json.dumps({"attachment_urls": batch}).encode()
        req = urllib.request.Request(REFRESH_API, data=body, method="POST", headers={
            "Authorization": f"Bot {token}", "Content-Type": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.load(r)
            for item in res.get("refreshed_urls", []):
                out[item["original"]] = item["refreshed"]
        except Exception as e:
            print(f"  refresh 批 {i//REFRESH_BATCH} 失败: {type(e).__name__}")
        time.sleep(0.3)
    return out


def collect_urls(include_discord):
    urls = []
    for fp in glob.glob(f"{SRC}/*/*.json"):
        if "/discord/" in fp:           # discord 单独处理（下方 jsonl），非平台 json
            continue
        src = fp.split("/")[-2]; d = os.path.basename(fp)[:-5]
        if len(d) != 10:
            continue
        try:
            items = json.load(open(fp, encoding="utf-8"))
        except Exception:
            continue
        items = items if isinstance(items, list) else items.get("items", [])
        for it in items:
            if isinstance(it, dict) and it.get("media_url"):
                urls.append((it["media_url"], src, d))
    if include_discord:
        # 三区服全量遍历（2026-07-10 方案甲布局，新旧布局经 SSOT 回落）
        import archive_layout
        for fpath in archive_layout.iter_discord_message_files(Path(SRC) / "discord"):
            fp = str(fpath)
            # 冷热双扩展名（.jsonl / .jsonl.gz，2026-07-12 甲案）：按名截日期
            d = os.path.basename(fp).replace(".jsonl.gz", "").replace(".jsonl", "")
            if len(d) != 10:
                continue
            for line in archive_layout.open_archive_text(fp):
                if '"content_type": "image' not in line:
                    continue
                try:
                    m = json.loads(line)
                except Exception:
                    continue
                for att in (m.get("attachments") or []):
                    if str(att.get("content_type", "")).startswith("image") and att.get("url"):
                        urls.append((att["url"], "discord", d))
    return urls


def upload_release():
    files = glob.glob(f"{FILES}/*")
    if not files:
        print("无可上传文件"); return
    tar = f"{ROOT}/media/media-files.tar"
    subprocess.run(["tar", "-cf", tar, "-C", FILES, "."], check=True)
    # 2026-06-21 收敛：media 二进制并入「社区二创」community-assets（与 fanart 同桶），
    # 不再单独建 media-archive-v1。往现有 release 追加资产（--clobber 覆盖同名），
    # 绝不 delete release（会连 fanart 一起删）。
    r = subprocess.run(["gh", "release", "upload", RELEASE_TAG, tar, "--clobber"],
                       capture_output=True, text=True)
    print(r.stdout or r.stderr)


def main():
    ap = argparse.ArgumentParser(description="媒体补录器")
    ap.add_argument("--no-discord", action="store_true", help="只补持久平台源，跳过 Discord")
    ap.add_argument("--budget", type=int, default=1800, help="运行预算秒数")
    ap.add_argument("--delay", type=float, default=0.12)
    ap.add_argument("--upload", action="store_true", help="补录后打包传 Releases")
    a = ap.parse_args()

    if a.upload:
        upload_release(); return

    os.makedirs(FILES, exist_ok=True)
    token = os.environ.get("DISCORD_BOT_TOKEN")
    manifest = load_manifest()
    urls = collect_urls(include_discord=not a.no_discord)

    seen = set(); todo = []
    for url, src, d in urls:
        if url in seen:
            continue
        seen.add(url)
        if manifest.get(url, {}).get("status") == "ok":
            continue
        todo.append((url, src, d))

    # Discord 过期链接先刷新（需 token）
    refreshed = {}
    disc = [u for u, s, _ in todo if s == "discord"]
    if disc and token:
        print(f"刷新 {len(disc)} 个 Discord 链接（refresh-urls）...")
        refreshed = refresh_discord(disc, token)
        print(f"  刷新成功 {len(refreshed)} 个")
    elif disc and not token:
        print(f"警告：{len(disc)} 个 Discord 链接多已过期，但未提供 DISCORD_BOT_TOKEN，无法刷新；"
              f"将直接尝试原链接（多半 404）。设置 DISCORD_BOT_TOKEN 后续跑可补回。")

    start = time.time(); done = 0; stats = {}
    for url, src, d in todo:
        if time.time() - start > a.budget:
            print(f"预算耗尽，已处理 {done}/{len(todo)}，下次续跑"); break
        dl_url = refreshed.get(url, url)
        fn = fname(url, src)
        status = fetch(dl_url, os.path.join(FILES, fn), src)
        manifest[url] = {"filename": fn if status == "ok" else None, "source": src,
                         "date": d, "status": status, "refreshed": url in refreshed,
                         "checked_at": datetime.utcnow().isoformat()}
        stats[status] = stats.get(status, 0) + 1
        done += 1
        if done % 200 == 0:
            save_manifest(manifest); print(f"  ...{done}/{len(todo)}")
        time.sleep(a.delay)

    save_manifest(manifest)
    ok = sum(1 for v in manifest.values() if v.get("status") == "ok")
    print(f"本次处理 {done}；状态 {stats}")
    print(f"清单累计存活图 {ok} 张 / 候选 {len(seen)} URL。清单 {MANIFEST}")


if __name__ == "__main__":
    main()
