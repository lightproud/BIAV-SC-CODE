#!/usr/bin/env python3
"""YouTube 视频评论采集器 — 抓忘却前夜相关视频（尤其官方 PV）下的热门评论。

第 4 条需求：报告要呈现「官方动作下大家的 PV 视频评论」，但现有 youtube 源只存视频
元数据、不存评论。本脚本用 YouTube Data API v3 的 commentThreads 拉取窗口内相关视频的
热门评论，归档到 platforms/youtube_comments/{date}.json 供报告引用（含发言人+原文）。

需 YOUTUBE_API_KEY（CI secrets 已有；本地通常无，故本地仅作 dry 校验）。

用法：
  YOUTUBE_API_KEY=xxx python projects/news/scripts/collect_video_comments.py --date 2026-06-02 \
      --top-videos 12 --per-video 20
输出：platforms/youtube_comments/{date}.json（每条含 video_title/video_url/author/text/likes/published）
"""
import os, json, argparse, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

API = "https://www.googleapis.com/youtube/v3"


def _get(path, params):
    url = f"{API}/{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "silver-core/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search_videos(key, n):
    """搜索忘却前夜相关视频，按相关度取近窗口，返回 [(id,title,channel)]。"""
    out = {}
    for q in ["Morimens", "忘却前夜", "Morimens Saya"]:
        try:
            data = _get("search", {"part": "snippet", "q": q, "type": "video",
                                   "order": "relevance", "maxResults": 15, "key": key})
            for it in data.get("items", []):
                vid = it.get("id", {}).get("videoId")
                if vid:
                    sn = it.get("snippet", {})
                    out[vid] = (sn.get("title", ""), sn.get("channelTitle", ""))
        except Exception as e:
            print(f"  search '{q}' 失败: {type(e).__name__}")
    return list(out.items())[:n]


def top_comments(key, vid, per):
    try:
        data = _get("commentThreads", {"part": "snippet", "videoId": vid,
                                       "order": "relevance", "maxResults": per,
                                       "textFormat": "plainText", "key": key})
    except urllib.error.HTTPError as e:
        # 评论关闭/视频不可用时跳过
        print(f"  {vid} commentThreads HTTP {e.code}")
        return []
    rows = []
    for t in data.get("items", []):
        c = t.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
        rows.append({"author": c.get("authorDisplayName", ""),
                     "text": (c.get("textDisplay") or "")[:600],
                     "likes": c.get("likeCount", 0),
                     "published": c.get("publishedAt", "")})
    return rows


def main():
    ap = argparse.ArgumentParser(description="YouTube 视频评论采集器")
    ap.add_argument("--date", required=True, help="归档日期标签 YYYY-MM-DD")
    ap.add_argument("--top-videos", type=int, default=12)
    ap.add_argument("--per-video", type=int, default=20)
    a = ap.parse_args()

    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        print("YOUTUBE_API_KEY 未设置——跳过（本地无 key 属正常，CI 会跑）")
        return

    vids = search_videos(key, a.top_videos)
    out = []
    for vid, (title, ch) in vids:
        for c in top_comments(key, vid, a.per_video):
            c.update({"video_id": vid, "video_title": title, "channel": ch,
                      "video_url": f"https://www.youtube.com/watch?v={vid}"})
            out.append(c)
    out.sort(key=lambda x: -x.get("likes", 0))

    dest_dir = "projects/news/data/platforms/youtube_comments"
    os.makedirs(dest_dir, exist_ok=True)
    dest = f"{dest_dir}/{a.date}.json"
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"采集 {len(out)} 条评论（{len(vids)} 视频）→ {dest}")


if __name__ == "__main__":
    main()
