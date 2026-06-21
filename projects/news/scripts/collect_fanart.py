#!/usr/bin/env python3
"""同人图采集器 — 把某日各信息源的玩家二创图抓到本地，供日报附录嵌图。

信息源（每个 Discord 频道亦视作独立源）：
  - Discord 二创类频道附件（image/*）：同人创作 / art-and-memes / 官方素材 / 晒卡分享等
  - Pixiv media_url（需 Referer 头绕过热链保护）

注意：Discord 附件本体长期在 Discord，过期的只是带签名的 CDN 链接。带 DISCORD_BOT_TOKEN 时
经 refresh-urls 接口刷新即可全量补回（历史日亦可）；无 token 时仅能下到最近 ~24h 仍存活的。

用法：
  DISCORD_BOT_TOKEN=xxx python projects/news/scripts/collect_fanart.py --date 2026-06-01 --out projects/news/data/fanart/2026-06-01
输出：out/ 下图片文件 + gallery_manifest.json（每条含 source/channel/author/text/file/status）。
"""
import os, json, re, time, argparse, hashlib, urllib.request, urllib.error

# discord 数据迁至 Public-Info-Pool/Record/Community（2026-06-21）；ROOT 仅用于读 discord
ROOT = "Public-Info-Pool/Record/Community"
FANART_CH = ["同人创作", "art-and-memes", "官方素材", "official-materials",
             "fanart", "创作", "二创", "绘"]
HEADERS = {"User-Agent": "Mozilla/5.0 (silver-core fanart collector)"}
# Discord API 要求合规 Bot User-Agent（DiscordBot (url, version)），否则可能被拒
DISCORD_UA = "DiscordBot (https://github.com/lightproud/brain-in-a-vat, 1.0)"
REFRESH_API = "https://discord.com/api/v10/attachments/refresh-urls"


def refresh_discord(urls, token):
    """批量把过期 Discord 链接换成新签名链接，返回 {original: refreshed}。"""
    out = {}
    for i in range(0, len(urls), 50):
        body = json.dumps({"attachment_urls": urls[i:i + 50]}).encode()
        req = urllib.request.Request(REFRESH_API, data=body, method="POST", headers={
            "Authorization": f"Bot {token}", "Content-Type": "application/json",
            "User-Agent": DISCORD_UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                for item in json.load(r).get("refreshed_urls", []):
                    out[item["original"]] = item["refreshed"]
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode()[:300]
            except Exception:
                pass
            print(f"  refresh 批 {i // 50} 失败: HTTP {e.code} {detail}")
        except Exception as e:
            print(f"  refresh 批 {i // 50} 失败: {type(e).__name__}")
        time.sleep(0.3)
    return out


def fetch(url, dest, referer=None):
    req = urllib.request.Request(url, headers={**HEADERS, **({"Referer": referer} if referer else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        if len(data) < 200:
            return "empty"
        with open(dest, "wb") as f:
            f.write(data)
        return "ok"
    except urllib.error.HTTPError as e:
        return f"http_{e.code}"
    except Exception as e:
        return f"err_{type(e).__name__}"


def ext_of(url, default="jpg"):
    m = re.search(r"\.(jpg|jpeg|png|gif|webp)(\?|$)", url, re.I)
    return m.group(1).lower() if m else default


def main():
    ap = argparse.ArgumentParser(description="同人图采集器")
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    gallery = []
    token = os.environ.get("DISCORD_BOT_TOKEN")

    # ---- Discord 二创频道附件：先收集，再（带 token）刷新过期链接，最后下载 ----
    idx = json.load(open(f"{ROOT}/discord/channel_index.json", encoding="utf-8"))
    dir2name = {v["dir"]: v["name"] for v in idx.values()}
    disc = []  # [{channel, author, text, orig_filename, url, fn}]
    for d, name in dir2name.items():
        if not any(k in name for k in FANART_CH):
            continue
        fp = f"{ROOT}/discord/channels/{d}/{a.date}.jsonl"
        if not os.path.isfile(fp):
            continue
        for line in open(fp, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
            except Exception:
                continue
            for att in (m.get("attachments") or []):
                if not str(att.get("content_type", "")).startswith("image"):
                    continue
                url = att.get("url", "")
                disc.append({"channel": name, "author": m.get("author_id", ""),
                             "text": (m.get("content") or "")[:200],
                             "orig_filename": att.get("filename", ""), "url": url,
                             "fn": f"discord_{att.get('id','')}.{ext_of(att.get('filename', url))}"})
    refreshed = {}
    if disc and token:
        print(f"刷新 {len(disc)} 个 Discord 二创附件链接...")
        refreshed = refresh_discord([x["url"] for x in disc], token)
        print(f"  刷新成功 {len(refreshed)}")
    elif disc and not token:
        print(f"警告：{len(disc)} 个 Discord 附件链接多已过期，无 DISCORD_BOT_TOKEN 无法刷新；"
              f"仅试原链接（历史日多 404）。")
    for x in disc:
        status = fetch(refreshed.get(x["url"], x["url"]), os.path.join(a.out, x["fn"]))
        gallery.append({"source": "discord", "channel": x["channel"], "author": x["author"],
                        "text": x["text"], "orig_filename": x["orig_filename"],
                        "refreshed": x["url"] in refreshed,
                        "file": x["fn"] if status == "ok" else None, "status": status})

    # ---- Pixiv ----
    pfp = f"{ROOT}/platforms/pixiv/{a.date}.json"
    if os.path.isfile(pfp):
        items = json.load(open(pfp, encoding="utf-8"))
        items = items if isinstance(items, list) else items.get("items", [])
        for it in items:
            if not isinstance(it, dict) or not it.get("media_url"):
                continue
            url = it["media_url"]
            fn = f"pixiv_{hashlib.md5(url.encode()).hexdigest()[:10]}.{ext_of(url)}"
            status = fetch(url, os.path.join(a.out, fn), referer="https://www.pixiv.net/")
            gallery.append({"source": "pixiv", "channel": "pixiv",
                            "author": it.get("author", ""),
                            "text": (it.get("title") or "")[:200],
                            "url": it.get("url", ""),
                            "file": fn if status == "ok" else None, "status": status})

    ok = [g for g in gallery if g["status"] == "ok"]
    json.dump(gallery, open(os.path.join(a.out, "gallery_manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    by_status = {}
    for g in gallery:
        by_status[g["status"]] = by_status.get(g["status"], 0) + 1
    print(f"同人图采集 {a.date}: 候选 {len(gallery)} / 成功下载 {len(ok)}")
    print(f"状态分布: {by_status}")
    print(f"manifest: {os.path.join(a.out, 'gallery_manifest.json')}")


if __name__ == "__main__":
    main()
