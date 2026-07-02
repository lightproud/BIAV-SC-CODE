"""Unit tests for projects/news/scripts/aggregator_collectors.py.

采集层是黑池信息入口（使命#1），脏数据会单向污染黑池且不可逆，所以解析逻辑
必须有测试守住。本套测试在 requests / subprocess / 文件 IO 边界打桩，绝不发真实
网络请求；对纯解析/转换函数直接喂构造样本断言字段映射、去重、时间解析、HTML
清洗与边界/空值/异常路径。
"""

import json
import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import aggregator_collectors as ac  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────────
# 测试辅助：构造假的 requests.Response
# ──────────────────────────────────────────────────────────────────────────────
class FakeResponse:
    def __init__(self, *, json_data=None, text="", status_code=200, raise_exc=None):
        self._json = json_data
        self.text = text
        self.status_code = status_code
        self._raise_exc = raise_exc
        self.ok = 200 <= status_code < 400

    def raise_for_status(self):
        if self._raise_exc is not None:
            raise self._raise_exc

    def json(self):
        if self._json is None:
            raise ValueError("No JSON object could be decoded")
        return self._json


def _recent_ts():
    """返回一个肯定落在 cutoff 窗口内的 unix 时间戳。"""
    return int(datetime.now(timezone.utc).timestamp())


def _old_ts():
    """返回一个肯定早于 cutoff 窗口的 unix 时间戳。"""
    return int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())


# ══════════════════════════════════════════════════════════════════════════════
# Reddit
# ══════════════════════════════════════════════════════════════════════════════
class TestExtractRedditMedia(unittest.TestCase):
    def test_direct_image_link(self):
        self.assertEqual(
            ac._extract_reddit_media({"url": "https://i.redd.it/abc.png"}),
            "https://i.redd.it/abc.png",
        )

    def test_direct_image_uppercase_ext(self):
        self.assertEqual(
            ac._extract_reddit_media({"url": "https://i.redd.it/abc.JPG"}),
            "https://i.redd.it/abc.JPG",
        )

    def test_preview_image_with_amp_unescaped(self):
        post = {
            "url": "https://reddit.com/r/x/comments/1",
            "preview": {"images": [{"source": {"url": "https://prev.com/a?x=1&amp;y=2"}}]},
        }
        self.assertEqual(ac._extract_reddit_media(post), "https://prev.com/a?x=1&y=2")

    def test_post_hint_image(self):
        post = {"url": "https://example.com/page", "post_hint": "image"}
        self.assertEqual(ac._extract_reddit_media(post), "https://example.com/page")

    def test_thumbnail_fallback(self):
        post = {"url": "", "thumbnail": "https://thumb.com/t.jpg"}
        self.assertEqual(ac._extract_reddit_media(post), "https://thumb.com/t.jpg")

    def test_default_thumbnails_rejected(self):
        for thumb in ("self", "default", "nsfw", "spoiler"):
            self.assertEqual(ac._extract_reddit_media({"url": "", "thumbnail": thumb}), "")

    def test_non_http_thumbnail_rejected(self):
        self.assertEqual(ac._extract_reddit_media({"url": "", "thumbnail": "image1"}), "")

    def test_no_media_returns_empty(self):
        self.assertEqual(ac._extract_reddit_media({}), "")
        self.assertEqual(ac._extract_reddit_media({"url": "https://x.com/page"}), "")


class TestFetchRedditComments(unittest.TestCase):
    def _listing(self, children):
        # Reddit comments endpoint returns [post_listing, comment_listing]
        return [{}, {"data": {"children": children}}]

    def test_parses_valid_comments(self):
        children = [
            {"kind": "t1", "data": {"author": "alice", "body": "great post", "score": 42}},
            {"kind": "t1", "data": {"author": "bob", "body": "agreed", "score": 7}},
        ]
        resp = FakeResponse(json_data=self._listing(children))
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_comments("/r/x/comments/1/", {})
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], {"author": "u/alice", "text": "great post", "score": 42})
        self.assertEqual(out[1]["author"], "u/bob")

    def test_skips_non_comment_kinds(self):
        children = [
            {"kind": "more", "data": {"body": "x"}},
            {"kind": "t1", "data": {"author": "a", "body": "real", "score": 1}},
        ]
        resp = FakeResponse(json_data=self._listing(children))
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_comments("/p/", {})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["text"], "real")

    def test_skips_deleted_removed_empty(self):
        children = [
            {"kind": "t1", "data": {"body": "[deleted]"}},
            {"kind": "t1", "data": {"body": "[removed]"}},
            {"kind": "t1", "data": {"body": ""}},
        ]
        resp = FakeResponse(json_data=self._listing(children))
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_comments("/p/", {})
        self.assertEqual(out, [])

    def test_missing_author_defaults_to_question(self):
        children = [{"kind": "t1", "data": {"body": "hi"}}]
        resp = FakeResponse(json_data=self._listing(children))
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_comments("/p/", {})
        self.assertEqual(out[0]["author"], "u/?")
        self.assertEqual(out[0]["score"], 0)

    def test_short_response_returns_empty(self):
        resp = FakeResponse(json_data=[{}])  # len < 2
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_comments("/p/", {})
        self.assertEqual(out, [])

    def test_max_comments_limit(self):
        children = [
            {"kind": "t1", "data": {"author": f"u{i}", "body": f"c{i}", "score": i}}
            for i in range(20)
        ]
        resp = FakeResponse(json_data=self._listing(children))
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_comments("/p/", {}, max_comments=5)
        self.assertEqual(len(out), 5)

    def test_network_exception_returns_empty(self):
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("blocked")):
            out = ac._fetch_reddit_comments("/p/", {})
        self.assertEqual(out, [])


class TestFetchRedditRss(unittest.TestCase):
    def _rss(self, entries):
        body = ""
        for e in entries:
            content = e.get("content", "")
            body += f"""
            <entry>
              <title>{e['title']}</title>
              <link href="{e.get('link', '')}"/>
              <updated>{e['updated']}</updated>
              <author><name>{e.get('author', '')}</name></author>
              <content>{content}</content>
            </entry>"""
        return f"""<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">{body}</feed>"""

    def test_parses_recent_entry(self):
        now = datetime.now(timezone.utc).isoformat()
        xml = self._rss([{
            "title": "Hot topic",
            "link": "https://reddit.com/r/x/1",
            "updated": now,
            "author": "alice",
            "content": "&lt;p&gt;body text&lt;/p&gt;",
        }])
        resp = FakeResponse(text=xml)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_rss("Morimens", {}, cutoff)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["title"], "Hot topic")
        self.assertEqual(out[0]["source"], "reddit")
        self.assertEqual(out[0]["author"], "alice")
        self.assertEqual(out[0]["metadata"], {"via": "rss"})

    def test_old_entry_filtered_by_cutoff(self):
        old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        xml = self._rss([{"title": "Old", "updated": old}])
        resp = FakeResponse(text=xml)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_rss("x", {}, cutoff)
        self.assertEqual(out, [])

    def test_bad_time_entry_skipped(self):
        xml = self._rss([{"title": "Bad", "updated": "not-a-date"}])
        resp = FakeResponse(text=xml)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_rss("x", {}, cutoff)
        self.assertEqual(out, [])

    def test_image_extracted_from_content(self):
        now = datetime.now(timezone.utc).isoformat()
        content = '&lt;img src="https://i.redd.it/pic.png"&gt;hello'
        xml = self._rss([{"title": "T", "updated": now, "content": content}])
        resp = FakeResponse(text=xml)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_rss("x", {}, cutoff)
        self.assertEqual(out[0]["media_url"], "https://i.redd.it/pic.png")
        self.assertEqual(out[0]["content_type"], "image")

    def test_network_failure_returns_empty(self):
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("403")):
            out = ac._fetch_reddit_rss("x", {}, cutoff)
        self.assertEqual(out, [])


class TestFetchRedditSearch(unittest.TestCase):
    def test_parses_recent_posts(self):
        children = [{
            "data": {
                "title": "Found post",
                "selftext": "body",
                "created_utc": _recent_ts(),
                "permalink": "/r/x/1",
                "score": 150,
                "num_comments": 20,
                "author": "alice",
            }
        }]
        resp = FakeResponse(json_data={"data": {"children": children}})
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_search("Morimens", {}, cutoff)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["engagement"], 170)
        self.assertTrue(out[0]["is_hot"])  # score 150 > 100
        self.assertEqual(out[0]["author"], "u/alice")
        self.assertEqual(out[0]["metadata"], {"via": "search"})

    def test_old_post_filtered(self):
        children = [{"data": {"created_utc": _old_ts(), "title": "old"}}]
        resp = FakeResponse(json_data={"data": {"children": children}})
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_search("x", {}, cutoff)
        self.assertEqual(out, [])

    def test_low_score_not_hot(self):
        children = [{"data": {"created_utc": _recent_ts(), "title": "t", "score": 5}}]
        resp = FakeResponse(json_data={"data": {"children": children}})
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_reddit_search("x", {}, cutoff)
        self.assertFalse(out[0]["is_hot"])

    def test_network_failure_returns_empty(self):
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("down")):
            out = ac._fetch_reddit_search("x", {}, cutoff)
        self.assertEqual(out, [])


class TestFetchReddit(unittest.TestCase):
    def _page(self, children, after=None):
        return FakeResponse(json_data={"data": {"children": children, "after": after}})

    def test_parses_post_with_media_and_tags(self):
        post = {
            "data": {
                "title": "Cool art",
                "selftext": "look at this",
                "created_utc": _recent_ts(),
                "permalink": "/r/Morimens/1",
                "score": 200,
                "num_comments": 0,
                "author": "artist",
                "url": "https://i.redd.it/art.png",
                "link_flair_richtext": [{"text": "Fan Art"}, {"text": ""}],
            }
        }
        with mock.patch.object(ac.requests, "get", return_value=self._page([post])):
            out = ac.fetch_reddit(subreddits=["Morimens"])
        self.assertEqual(len(out), 1)
        item = out[0]
        self.assertEqual(item["title"], "Cool art")
        self.assertTrue(item["is_hot"])  # score 200
        self.assertEqual(item["engagement"], 200)
        self.assertEqual(item["media_url"], "https://i.redd.it/art.png")
        self.assertEqual(item["tags"], ["Fan Art"])
        self.assertEqual(item["author"], "u/artist")

    def test_fetches_comments_when_num_comments_positive(self):
        post = {
            "data": {
                "title": "Discussion",
                "created_utc": _recent_ts(),
                "permalink": "/r/x/2",
                "score": 5,
                "num_comments": 3,
                "author": "u1",
            }
        }
        fake_comments = [{"author": "u/c", "text": "reply", "score": 1}]
        with mock.patch.object(ac.requests, "get", return_value=self._page([post])), \
                mock.patch.object(ac, "_fetch_reddit_comments", return_value=fake_comments) as fc, \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_reddit(subreddits=["x"])
        fc.assert_called_once()
        self.assertIn("u/c (1pt): reply", out[0]["summary"])

    def test_cutoff_stops_pagination(self):
        old_post = {"data": {"title": "old", "created_utc": _old_ts(), "permalink": "/p",
                             "score": 1, "num_comments": 0, "author": "a"}}
        with mock.patch.object(ac.requests, "get", return_value=self._page([old_post])):
            out = ac.fetch_reddit(subreddits=["x"])
        self.assertEqual(out, [])

    def test_api_failure_triggers_rss_fallback(self):
        rss_items = [{"title": "from rss", "source": "reddit"}]
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("403 Blocked")), \
                mock.patch.object(ac, "_fetch_reddit_rss", return_value=rss_items) as rss, \
                mock.patch.object(ac, "_fetch_reddit_search") as search:
            out = ac.fetch_reddit(subreddits=["x"])
        rss.assert_called_once()
        search.assert_not_called()
        self.assertEqual(out, rss_items)

    def test_rss_failure_triggers_search_fallback(self):
        search_items = [{"title": "from search", "source": "reddit"}]
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("403")), \
                mock.patch.object(ac, "_fetch_reddit_rss", return_value=[]), \
                mock.patch.object(ac, "_fetch_reddit_search", return_value=search_items) as search:
            out = ac.fetch_reddit(subreddits=["x"])
        search.assert_called_once()
        self.assertEqual(out, search_items)


# ══════════════════════════════════════════════════════════════════════════════
# Bilibili
# ══════════════════════════════════════════════════════════════════════════════
class TestFetchBilibiliComments(unittest.TestCase):
    def test_parses_replies(self):
        replies = [
            {"member": {"uname": "user1"}, "content": {"message": "good"}, "like": 5},
            {"member": {"uname": "user2"}, "content": {"message": "nice"}, "like": 3},
        ]
        resp = FakeResponse(json_data={"data": {"replies": replies}})
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_bilibili_comments(123, {})
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], {"author": "user1", "text": "good", "likes": 5})

    def test_skips_empty_message(self):
        replies = [{"member": {"uname": "u"}, "content": {"message": ""}, "like": 0}]
        resp = FakeResponse(json_data={"data": {"replies": replies}})
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_bilibili_comments(1, {})
        self.assertEqual(out, [])

    def test_missing_uname_defaults(self):
        replies = [{"content": {"message": "hi"}}]
        resp = FakeResponse(json_data={"data": {"replies": replies}})
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_bilibili_comments(1, {})
        self.assertEqual(out[0]["author"], "?")
        self.assertEqual(out[0]["likes"], 0)

    def test_network_failure_returns_empty(self):
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("412")):
            out = ac._fetch_bilibili_comments(1, {})
        self.assertEqual(out, [])


class TestBilibiliItem(unittest.TestCase):
    def setUp(self):
        # _bilibili_item 内部会调 _fetch_bilibili_comments（网络），统一打桩
        self.patcher = mock.patch.object(ac, "_fetch_bilibili_comments", return_value=[])
        self.patcher.start()
        self.sleep_patcher = mock.patch.object(ac.time, "sleep")
        self.sleep_patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.sleep_patcher.stop()

    def _created(self):
        return datetime(2026, 6, 10, tzinfo=timezone.utc)

    def test_basic_fields(self):
        v = {
            "bvid": "BV1xx",
            "aid": 100,
            "title": "Test <b>video</b>",
            "description": "desc",
            "play": 20000,
            "comment": 50,
            "typename": "游戏",
        }
        item = ac._bilibili_item(v, self._created(), "creator", {})
        self.assertEqual(item["title"], "Test video")  # html stripped
        self.assertEqual(item["url"], "https://www.bilibili.com/video/BV1xx")
        self.assertEqual(item["engagement"], 20050)  # play + comment_count
        self.assertTrue(item["is_hot"])  # play > 10000
        self.assertEqual(item["tags"], ["游戏"])
        self.assertEqual(item["author"], "creator")
        self.assertEqual(item["metadata"]["play"], 20000)

    def test_pic_https_prefix_added(self):
        v = {"bvid": "BV1", "pic": "//i0.hdslb.com/c.jpg", "play": 100}
        item = ac._bilibili_item(v, self._created(), "a", {})
        self.assertEqual(item["media_url"], "https://i0.hdslb.com/c.jpg")
        self.assertEqual(item["content_type"], "image")

    def test_pic_with_scheme_unchanged(self):
        v = {"bvid": "BV1", "pic": "https://x.com/c.jpg", "play": 1}
        item = ac._bilibili_item(v, self._created(), "a", {})
        self.assertEqual(item["media_url"], "https://x.com/c.jpg")

    def test_no_pic_no_media_key(self):
        v = {"bvid": "BV1", "play": 1}
        item = ac._bilibili_item(v, self._created(), "a", {})
        self.assertNotIn("media_url", item)

    def test_no_bvid_uses_arcurl(self):
        v = {"arcurl": "https://b.com/av1", "play": 1}
        item = ac._bilibili_item(v, self._created(), "a", {})
        self.assertEqual(item["url"], "https://b.com/av1")

    def test_search_field_aliases(self):
        # search API 用 desc/view/review 而非 description/play/comment
        v = {"bvid": "BV1", "desc": "from search", "view": 5000, "review": 10}
        item = ac._bilibili_item(v, self._created(), "a", {})
        self.assertEqual(item["summary"], "from search")
        self.assertEqual(item["engagement"], 5010)
        self.assertFalse(item["is_hot"])  # view 5000 < 10000

    def test_comments_appended_to_summary(self):
        self.patcher.stop()
        with mock.patch.object(ac, "_fetch_bilibili_comments",
                               return_value=[{"author": "u", "text": "t", "likes": 9}]):
            v = {"bvid": "BV1", "aid": 1, "description": "d", "comment": 1, "play": 1}
            item = ac._bilibili_item(v, self._created(), "a", {})
        self.patcher.start()  # 让 tearDown 的 stop 有效
        self.assertIn("u (9赞): t", item["summary"])


class TestBilibiliHeaders(unittest.TestCase):
    def test_uses_spi_cookies_when_available(self):
        with mock.patch.object(ac, "bilibili_spi_cookies", return_value={"buvid3": "X", "buvid4": "Y"}):
            headers = ac._bilibili_headers()
        self.assertIn("buvid3=X", headers["Cookie"])
        self.assertIn("buvid4=Y", headers["Cookie"])

    def test_fallback_fake_buvid_when_spi_empty(self):
        with mock.patch.object(ac, "bilibili_spi_cookies", return_value={}):
            headers = ac._bilibili_headers()
        self.assertTrue(headers["Cookie"].startswith("buvid3="))
        self.assertTrue(headers["Cookie"].endswith("infoc"))


class TestFetchBilibiliSpace(unittest.TestCase):
    def test_parses_video_list(self):
        vlist = [{"bvid": "BV1", "created": _recent_ts(), "title": "vid", "play": 100,
                  "author": "creator"}]
        resp = FakeResponse(json_data={"data": {"list": {"vlist": vlist}}})
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac, "_fetch_bilibili_comments", return_value=[]), \
                mock.patch.object(ac.requests, "get", return_value=resp), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"BILIBILI_MORIMENS_CREATORS": {"123": "Creator"}}):
            out = ac._fetch_bilibili_space()
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["source"], "bilibili")

    def test_412_breaks_without_crash(self):
        resp = FakeResponse(status_code=412)
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac.requests, "get", return_value=resp), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"BILIBILI_MORIMENS_CREATORS": {"123": "C"}}):
            out = ac._fetch_bilibili_space()
        self.assertEqual(out, [])

    def test_non_json_response_handled(self):
        resp = FakeResponse(text="<html>risk control</html>")  # .json() raises ValueError
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac.requests, "get", return_value=resp), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"BILIBILI_MORIMENS_CREATORS": {"123": "C"}}):
            out = ac._fetch_bilibili_space()
        self.assertEqual(out, [])


class TestFetchBilibiliSearch(unittest.TestCase):
    def test_parses_search_results(self):
        results = [{"bvid": "BV1", "pubdate": _recent_ts(), "title": "kw vid",
                    "view": 100, "author": "up"}]
        resp = FakeResponse(json_data={"data": {"result": results}})
        empty = FakeResponse(json_data={"data": {"result": []}})
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac, "_fetch_bilibili_comments", return_value=[]), \
                mock.patch.object(ac.requests, "get", return_value=resp), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"COLLAB_KEYWORDS": []}):
            # 第一个关键词返回结果，第二个关键词返回空（用 side_effect 控不住循环页数，
            # 这里让每次调用都返回同样的非空再靠 MAX/cutoff 收口）。简化：单关键词验证。
            out = ac._fetch_bilibili_search()
        self.assertTrue(any(i["source"] == "bilibili" for i in out))

    def test_412_then_retry(self):
        results = [{"bvid": "BV1", "pubdate": _recent_ts(), "title": "t", "view": 1}]
        resp_412 = FakeResponse(status_code=412)
        resp_ok = FakeResponse(json_data={"data": {"result": results}})
        # 412 -> retry -> ok，然后空页收口
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac, "_fetch_bilibili_comments", return_value=[]), \
                mock.patch.object(ac.requests, "get",
                                  side_effect=[resp_412, resp_ok,
                                               FakeResponse(json_data={"data": {"result": []}})] +
                                              [FakeResponse(json_data={"data": {"result": []}})] * 5), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"COLLAB_KEYWORDS": []}):
            out = ac._fetch_bilibili_search()
        self.assertTrue(any(i["source"] == "bilibili" for i in out))

    def test_non_json_search_handled(self):
        bad = FakeResponse(text="<html>risk</html>")
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac.requests, "get", return_value=bad), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"COLLAB_KEYWORDS": []}):
            out = ac._fetch_bilibili_search()
        self.assertEqual(out, [])

    def test_search_network_failure_handled(self):
        with mock.patch.object(ac, "_bilibili_headers", return_value={}), \
                mock.patch.object(ac, "get_wbi_mixin_key", return_value="key"), \
                mock.patch.object(ac, "sign_wbi_params", side_effect=lambda p, k: p), \
                mock.patch.object(ac.requests, "get", side_effect=RuntimeError("down")), \
                mock.patch.object(ac.time, "sleep"), \
                mock.patch.dict(ac.__dict__, {"COLLAB_KEYWORDS": []}):
            out = ac._fetch_bilibili_search()
        self.assertEqual(out, [])


class TestFetchBilibili(unittest.TestCase):
    def test_uses_space_when_nonempty(self):
        with mock.patch.object(ac, "_fetch_bilibili_space", return_value=[{"x": 1}]), \
                mock.patch.object(ac, "_fetch_bilibili_search") as search:
            out = ac.fetch_bilibili()
        search.assert_not_called()
        self.assertEqual(out, [{"x": 1}])

    def test_falls_back_to_search_when_space_empty(self):
        with mock.patch.object(ac, "_fetch_bilibili_space", return_value=[]), \
                mock.patch.object(ac, "_fetch_bilibili_search", return_value=[{"y": 2}]) as search:
            out = ac.fetch_bilibili()
        search.assert_called_once()
        self.assertEqual(out, [{"y": 2}])


# ══════════════════════════════════════════════════════════════════════════════
# TapTap
# ══════════════════════════════════════════════════════════════════════════════
class TestFetchTaptap(unittest.TestCase):
    def _entry(self, *, score=5, text="great game", ts=None, mid="m1"):
        ts = ts if ts is not None else _recent_ts()
        return {
            "moment": {
                "id_str": mid,
                "publish_time": ts,
                "review": {"score": score, "contents": {"text": text}},
                "stat": {"ups": 12},
                "author": {"user": {"name": "player"}},
            }
        }

    def test_parses_positive_review(self):
        resp = FakeResponse(json_data={"data": {"list": [self._entry(score=5)]}})
        with mock.patch.object(ac.requests, "get", side_effect=[resp, FakeResponse(json_data={"data": {"list": []}})]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_taptap()
        self.assertEqual(len(out), 1)
        item = out[0]
        self.assertTrue(item["title"].startswith("[TapTap 好评]"))
        self.assertEqual(item["source"], "taptap")
        self.assertEqual(item["engagement"], 12)
        self.assertEqual(item["tags"], ["好评"])
        self.assertEqual(item["author"], "player")
        self.assertIn("/moment/m1", item["url"])

    def test_sentiment_classification(self):
        cases = [(1, "差评"), (3, "中评"), (5, "好评")]
        for score, expected in cases:
            resp = FakeResponse(json_data={"data": {"list": [self._entry(score=score)]}})
            empty = FakeResponse(json_data={"data": {"list": []}})
            with mock.patch.object(ac.requests, "get", side_effect=[resp, empty]), \
                    mock.patch.object(ac.time, "sleep"):
                out = ac.fetch_taptap()
            self.assertEqual(out[0]["tags"], [expected])

    def test_old_review_filtered(self):
        resp = FakeResponse(json_data={"data": {"list": [self._entry(ts=_old_ts())]}})
        empty = FakeResponse(json_data={"data": {"list": []}})
        with mock.patch.object(ac.requests, "get", side_effect=[resp, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_taptap()
        self.assertEqual(out, [])

    def test_empty_text_skipped(self):
        resp = FakeResponse(json_data={"data": {"list": [self._entry(text="")]}})
        empty = FakeResponse(json_data={"data": {"list": []}})
        with mock.patch.object(ac.requests, "get", side_effect=[resp, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_taptap()
        self.assertEqual(out, [])

    def test_network_failure_returns_empty(self):
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("dns")), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_taptap()
        self.assertEqual(out, [])

    def test_no_moment_id_uses_app_review_url(self):
        entry = self._entry(mid="")
        resp = FakeResponse(json_data={"data": {"list": [entry]}})
        empty = FakeResponse(json_data={"data": {"list": []}})
        with mock.patch.object(ac.requests, "get", side_effect=[resp, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_taptap()
        self.assertIn("/review", out[0]["url"])


# ══════════════════════════════════════════════════════════════════════════════
# Steam Reviews (curl/subprocess based)
# ══════════════════════════════════════════════════════════════════════════════
class TestFetchSteamReviews(unittest.TestCase):
    def _result(self, *, stdout, returncode=0, stderr=""):
        r = mock.MagicMock()
        r.returncode = returncode
        r.stdout = stdout
        r.stderr = stderr
        return r

    def test_parses_review(self):
        review = {
            "timestamp_created": _recent_ts(),
            "language": "schinese",
            "voted_up": True,
            "review": "x" * 80,
            "author": {"steamid": "76561", "playtime_forever": 500},
            "votes_up": 15,
        }
        body = json.dumps({"reviews": [review], "cursor": "next"})
        empty = json.dumps({"reviews": [], "cursor": "next2"})
        with mock.patch("subprocess.run", side_effect=[self._result(stdout=body), self._result(stdout=empty)]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_reviews()
        self.assertEqual(len(out), 1)
        item = out[0]
        self.assertEqual(item["source"], "steam_review")
        self.assertTrue(item["title"].startswith("[正面]"))
        self.assertTrue(item["title"].endswith("..."))  # len > 50
        self.assertTrue(item["is_hot"])  # votes_up 15 > 10
        self.assertEqual(item["language"], "schinese")
        self.assertIn("/recommended/3052450", item["url"])
        self.assertEqual(item["region"], "global")          # 甲方案：首个 appid = global 区服
        self.assertEqual(item["archive_subtype"], "review")

    def test_negative_short_review_no_ellipsis(self):
        review = {"timestamp_created": _recent_ts(), "voted_up": False,
                  "review": "bad", "author": {"steamid": "1"}, "votes_up": 0}
        body = json.dumps({"reviews": [review], "cursor": "c"})
        with mock.patch("subprocess.run",
                        side_effect=[self._result(stdout=body), self._result(stdout=json.dumps({"reviews": []}))]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_reviews()
        self.assertTrue(out[0]["title"].startswith("[负面]"))
        self.assertFalse(out[0]["title"].endswith("..."))

    def test_old_review_stops(self):
        review = {"timestamp_created": _old_ts(), "review": "old", "author": {}}
        body = json.dumps({"reviews": [review], "cursor": "c"})
        with mock.patch("subprocess.run", return_value=self._result(stdout=body)), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_reviews()
        self.assertEqual(out, [])

    def test_curl_failure_returns_empty(self):
        with mock.patch("subprocess.run", return_value=self._result(stdout="", returncode=1, stderr="err")), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_reviews()
        self.assertEqual(out, [])

    def test_empty_body_returns_empty(self):
        with mock.patch("subprocess.run", return_value=self._result(stdout="   ")), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_reviews()
        self.assertEqual(out, [])

    def test_cursor_unchanged_stops(self):
        review = {"timestamp_created": _recent_ts(), "review": "r", "author": {}, "votes_up": 0}
        body = json.dumps({"reviews": [review], "cursor": "*"})  # same as initial cursor
        with mock.patch("subprocess.run", return_value=self._result(stdout=body)), \
                mock.patch.object(ac.time, "sleep"):
            out = ac._fetch_steam_reviews_one("3052450", "global")  # 单区服 helper：避免双 appid 翻倍
        self.assertEqual(len(out), 1)  # one page then stops (cursor unchanged)

    def test_loops_both_regions(self):
        # 甲方案：wrapper 循环 REGION_APPS['steam'] 双 appid，逐区服打 region 标后聚合
        calls = []

        def fake_one(app_id, region):
            calls.append((app_id, region))
            return [{"source": "steam_review", "region": region, "archive_subtype": "review"}]

        with mock.patch.object(ac, "_fetch_steam_reviews_one", side_effect=fake_one):
            out = ac.fetch_steam_reviews()
        regions = {r for _, r in calls}
        self.assertIn("global", regions)   # 国际版 appid 3052450
        self.assertIn("jp", regions)        # 日本版 appid 4226130（AltPlus）
        self.assertEqual(len(out), len(calls))
        self.assertEqual({it["region"] for it in out}, regions)


# ══════════════════════════════════════════════════════════════════════════════
# Steam News
# ══════════════════════════════════════════════════════════════════════════════
class TestFetchSteamNews(unittest.TestCase):
    def test_parses_announcement(self):
        news = {
            "title": "Patch <b>1.0</b>",
            "contents": "<p>notes</p>",
            "date": _recent_ts(),
            "url": "https://steam/news/1",
            "feed_type": 0,
            "author": "Dev",
            "feedlabel": "Community Announcements",
        }
        resp = FakeResponse(json_data={"appnews": {"newsitems": [news]}})
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac._fetch_steam_news_one("3052450", "global")  # 单区服 helper：避免双 appid 翻倍
        self.assertEqual(len(out), 1)
        item = out[0]
        self.assertEqual(item["title"], "[Steam公告] Patch 1.0")
        self.assertEqual(item["summary"], "notes")
        self.assertEqual(item["source"], "official")
        self.assertTrue(item["is_hot"])
        self.assertEqual(item["region"], "global")
        self.assertEqual(item["archive_subtype"], "news")  # official 折叠归档到 steam/<区服>/news

    def test_feed_type_labels(self):
        for ft, label in [(0, "公告"), (1, "新闻"), (9, "资讯")]:
            news = {"title": "T", "date": _recent_ts(), "feed_type": ft}
            resp = FakeResponse(json_data={"appnews": {"newsitems": [news]}})
            with mock.patch.object(ac.requests, "get", return_value=resp):
                out = ac.fetch_steam_news()
            self.assertTrue(out[0]["title"].startswith(f"[Steam{label}]"))

    def test_old_news_filtered(self):
        # OFFICIAL_HOURS_LOOKBACK 默认 30 天，造一条 60 天前的
        old = int((datetime.now(timezone.utc) - timedelta(days=60)).timestamp())
        news = {"title": "T", "date": old}
        resp = FakeResponse(json_data={"appnews": {"newsitems": [news]}})
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac.fetch_steam_news()
        self.assertEqual(out, [])

    def test_missing_date_skipped(self):
        news = {"title": "T", "date": 0}
        resp = FakeResponse(json_data={"appnews": {"newsitems": [news]}})
        with mock.patch.object(ac.requests, "get", return_value=resp):
            out = ac.fetch_steam_news()
        self.assertEqual(out, [])

    def test_network_failure_returns_empty(self):
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("down")):
            out = ac.fetch_steam_news()
        self.assertEqual(out, [])


# ══════════════════════════════════════════════════════════════════════════════
# Steam Discussions (HTML scraping)
# ══════════════════════════════════════════════════════════════════════════════
class TestFetchSteamDiscussions(unittest.TestCase):
    def _block(self, *, title="My Thread", ts=None, replies="5", author="poster",
               hover_text="preview body", url="https://steamcommunity.com/app/3052450/discussions/0/123/"):
        ts = ts if ts is not None else _recent_ts()
        hover = (f'<div class="topic_hover_text" >{hover_text}</div>')
        # data-tooltip-forum 内容是转义后的 HTML
        import html as _h
        hover_esc = _h.escape(hover)
        return f'''<div class="forum_topic ">
          <a class="forum_topic_overlay" href="{url}"></a>
          <div class="forum_topic_name ">{title}</div>
          <div class="forum_topic_reply_count"><span></span>{replies}</div>
          <div class="forum_topic_op" >{author}</div>
          <div class="forum_topic_lastpost" data-timestamp="{ts}"></div>
          <span data-tooltip-forum="{hover_esc}"></span>
        </div>'''

    def _page(self, blocks):
        return FakeResponse(text="<html><body>" + "".join(blocks) + "</body></html>")

    def test_parses_thread(self):
        page = self._page([self._block(title="Build help", replies="12")])
        empty = self._page([])
        with mock.patch.object(ac.requests, "get", side_effect=[page, empty, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_discussions()
        self.assertEqual(len(out), 1)
        item = out[0]
        self.assertEqual(item["title"], "[Steam论坛] Build help")
        self.assertEqual(item["engagement"], 12)
        self.assertTrue(item["is_hot"])  # replies >= 10
        self.assertEqual(item["source"], "steam_discussion")
        self.assertEqual(item["author"], "poster")
        self.assertIn("preview body", item["summary"])
        self.assertEqual(item["region"], "global")
        self.assertEqual(item["archive_subtype"], "discussion")

    def test_reply_count_with_commas(self):
        page = self._page([self._block(replies="1,234")])
        empty = self._page([])
        with mock.patch.object(ac.requests, "get", side_effect=[page, empty, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_discussions()
        self.assertEqual(out[0]["engagement"], 1234)

    def test_old_thread_stops(self):
        page = self._page([self._block(ts=_old_ts())])
        with mock.patch.object(ac.requests, "get", return_value=page), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_discussions()
        self.assertEqual(out, [])

    def test_block_without_url_or_title_skipped(self):
        bad = '<div class="forum_topic ">no useful fields here</div>'
        page = self._page([bad])
        empty = self._page([])
        with mock.patch.object(ac.requests, "get", side_effect=[page, empty, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_discussions()
        self.assertEqual(out, [])

    def test_no_timestamp_marks_approximate(self):
        block = '''<div class="forum_topic ">
          <a class="forum_topic_overlay" href="https://steamcommunity.com/app/3052450/discussions/0/1/"></a>
          <div class="forum_topic_name ">No TS</div>
        </div>'''
        page = self._page([block])
        empty = self._page([])
        with mock.patch.object(ac.requests, "get", side_effect=[page, empty, empty]), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_discussions()
        self.assertTrue(out[0]["time_is_approximate"])

    def test_network_failure_returns_empty(self):
        with mock.patch.object(ac.requests, "get", side_effect=RuntimeError("timeout")), \
                mock.patch.object(ac.time, "sleep"):
            out = ac.fetch_steam_discussions()
        self.assertEqual(out, [])


# ══════════════════════════════════════════════════════════════════════════════
# Discord (local file reads)
# ══════════════════════════════════════════════════════════════════════════════
class TestBuildReplyChains(unittest.TestCase):
    def test_groups_direct_replies(self):
        messages = [
            {"id": "1", "timestamp": "2026-06-10T01:00:00"},
            {"id": "2", "reply_to": "1", "timestamp": "2026-06-10T02:00:00"},
            {"id": "3", "reply_to": "1", "timestamp": "2026-06-10T01:30:00"},
            {"id": "4", "reply_to": "99", "timestamp": "2026-06-10T03:00:00"},
        ]
        chains = ac._build_reply_chains(messages, {"1"})
        self.assertIn("1", chains)
        self.assertNotIn("99", chains)  # not a target
        # 按 timestamp 升序：id 3 (01:30) 在 id 2 (02:00) 之前
        self.assertEqual([m["id"] for m in chains["1"]], ["3", "2"])

    def test_max_depth_limit(self):
        messages = [{"id": "p", "timestamp": "t0"}]
        for i in range(10):
            messages.append({"id": str(i), "reply_to": "p", "timestamp": f"t{i:02d}"})
        chains = ac._build_reply_chains(messages, {"p"}, max_depth=3)
        self.assertEqual(len(chains["p"]), 3)

    def test_no_replies_returns_empty_dict(self):
        messages = [{"id": "1", "timestamp": "t"}]
        self.assertEqual(ac._build_reply_chains(messages, {"1"}), {})


class TestLoadDiscordChannelIndex(unittest.TestCase):
    def test_builds_maps_from_index(self):
        index = {
            "111": {"name": "general", "dir": "aaa"},
            "222": {"name": "fan-art", "dir": "bbb"},
        }
        m = mock.mock_open(read_data=json.dumps(index))
        with mock.patch("pathlib.Path.exists", return_value=True), \
                mock.patch("builtins.open", m):
            ch_names, dir_to_id = ac._load_discord_channel_index()
        self.assertEqual(ch_names, {"111": "general", "222": "fan-art"})
        self.assertEqual(dir_to_id, {"aaa": "111", "bbb": "222"})

    def test_missing_file_returns_empty(self):
        with mock.patch("pathlib.Path.exists", return_value=False):
            ch_names, dir_to_id = ac._load_discord_channel_index()
        self.assertEqual(ch_names, {})
        self.assertEqual(dir_to_id, {})

    def test_corrupt_json_returns_empty(self):
        m = mock.mock_open(read_data="{not json")
        with mock.patch("pathlib.Path.exists", return_value=True), \
                mock.patch("builtins.open", m):
            ch_names, dir_to_id = ac._load_discord_channel_index()
        self.assertEqual(ch_names, {})
        self.assertEqual(dir_to_id, {})


class TestFetchDiscordLocal(unittest.TestCase):
    """fetch_discord_local 纯本地文件读，无网络。在 _read_discord_jsonl 与统计文件
    读取边界打桩，验证日报摘要项与高互动消息项的字段映射。"""

    def _patch_no_stats(self):
        # activity_daily 统计文件不存在
        return mock.patch("pathlib.Path.exists", return_value=False)

    def test_no_data_returns_empty(self):
        with self._patch_no_stats(), \
                mock.patch.object(ac, "_read_discord_jsonl", return_value=[]):
            out = ac.fetch_discord_local()
        self.assertEqual(out, [])

    def test_summary_item_from_stats(self):
        stats = {"messages": 1234, "unique_authors": 56, "reactions_total": 789,
                 "channel_activity": {"general": 500, "fan-art": 300}}
        m = mock.mock_open(read_data=json.dumps(stats))
        with mock.patch("pathlib.Path.exists", return_value=True), \
                mock.patch("builtins.open", m), \
                mock.patch.object(ac, "_read_discord_jsonl", return_value=[]):
            out = ac.fetch_discord_local()
        self.assertEqual(len(out), 1)
        item = out[0]
        self.assertTrue(item["title"].startswith("Discord 社区日报"))
        self.assertEqual(item["source"], "discord")
        self.assertEqual(item["engagement"], 1234)
        self.assertIn("general(500)", item["summary"])

    def test_high_engagement_message_extracted(self):
        msgs = [
            {"id": "m1", "author_name": "alice", "_channel_name": "general",
             "channel_id": "c1", "content": "important news about the game",
             "timestamp": "2026-06-10T01:00:00+00:00",
             "reactions": [{"emoji": "🔥", "count": 5}], "attachments": []},
            {"id": "m2", "reply_to": "m1", "author_name": "bob", "content": "agree",
             "timestamp": "2026-06-10T01:05:00+00:00", "reactions": [], "attachments": []},
        ]
        with self._patch_no_stats(), \
                mock.patch.object(ac, "_read_discord_jsonl", return_value=msgs):
            out = ac.fetch_discord_local()
        # m1: react 5*3=15 score >=3, gets extracted; m2 reply tracked
        self.assertTrue(any("[DC] alice@general" in i["title"] for i in out))
        dc = next(i for i in out if i["author"] == "alice")
        self.assertEqual(dc["source"], "discord")
        self.assertIn("important news", dc["summary"])
        self.assertIn("bob: agree", dc["summary"])  # reply chain appended
        self.assertEqual(dc["metadata"]["reply_count"], 1)
        self.assertIn("🔥×5", dc["metadata"]["reactions"])

    def test_bot_messages_excluded_from_ranking(self):
        msgs = [
            {"id": "b1", "author_bot": True, "author_name": "Bot", "content": "spam",
             "timestamp": "t", "reactions": [{"emoji": "x", "count": 99}], "attachments": []},
        ]
        with self._patch_no_stats(), \
                mock.patch.object(ac, "_read_discord_jsonl", return_value=msgs):
            out = ac.fetch_discord_local()
        self.assertEqual(out, [])  # bot filtered, no human high-engagement msgs

    def test_image_attachment_becomes_media_url(self):
        msgs = [
            {"id": "m1", "author_name": "a", "_channel_name": "art", "channel_id": "c",
             "content": "look", "timestamp": "2026-06-10T00:00:00+00:00",
             "reactions": [{"emoji": "👍", "count": 3}],
             "attachments": [{"filename": "art.png", "url": "https://cdn/art.png",
                              "content_type": "image/png"}]},
        ]
        with self._patch_no_stats(), \
                mock.patch.object(ac, "_read_discord_jsonl", return_value=msgs):
            out = ac.fetch_discord_local()
        dc = next(i for i in out if i["author"] == "a")
        self.assertEqual(dc["media_url"], "https://cdn/art.png")
        self.assertEqual(dc["content_type"], "image")
        self.assertIn("[附件: art.png]", dc["summary"])

    def test_low_engagement_messages_skipped(self):
        # 无反应、无回复、无附件 → score 0，react_total 0 < 2，被过滤
        msgs = [
            {"id": "m1", "author_name": "a", "content": "meh", "timestamp": "t",
             "reactions": [], "attachments": []},
        ]
        with self._patch_no_stats(), \
                mock.patch.object(ac, "_read_discord_jsonl", return_value=msgs):
            out = ac.fetch_discord_local()
        self.assertEqual(out, [])  # score 0 < 3 且 react_total 0 < 2


class TestReadDiscordJsonl(unittest.TestCase):
    def test_no_channels_dir_returns_empty(self):
        with mock.patch("pathlib.Path.exists", return_value=False):
            out = ac._read_discord_jsonl("2026-06-10")
        self.assertEqual(out, [])

    def test_reads_jsonl_with_channel_annotation(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ch_dir = root / "projects" / "news" / "data" / "discord" / "channels" / "suffixA"
            ch_dir.mkdir(parents=True)
            (ch_dir / "2026-06-10.jsonl").write_text(
                json.dumps({"id": "1", "content": "hi"}) + "\n"
                + "\n"  # 空行应被跳过
                + json.dumps({"id": "2", "content": "yo"}) + "\n",
                encoding="utf-8",
            )
            # channel_index.json 把 suffixA 映射到频道名
            index_dir = root / "projects" / "news" / "data" / "discord"
            (index_dir / "channel_index.json").write_text(
                json.dumps({"cid9": {"name": "general", "dir": "suffixA"}}), encoding="utf-8")
            with mock.patch.object(ac, "REPO_ROOT", root):
                out = ac._read_discord_jsonl("2026-06-10")
        self.assertEqual(len(out), 2)
        self.assertTrue(all(m["_channel_name"] == "general" for m in out))

    def test_missing_date_file_skipped(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ch_dir = root / "projects" / "news" / "data" / "discord" / "channels" / "suffixB"
            ch_dir.mkdir(parents=True)
            (ch_dir / "2026-06-09.jsonl").write_text("{}\n", encoding="utf-8")
            with mock.patch.object(ac, "REPO_ROOT", root):
                out = ac._read_discord_jsonl("2026-06-10")  # 不同日期
        self.assertEqual(out, [])

    def test_corrupt_line_logged_not_crash(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ch_dir = root / "projects" / "news" / "data" / "discord" / "channels" / "suffixC"
            ch_dir.mkdir(parents=True)
            (ch_dir / "2026-06-10.jsonl").write_text("{bad json\n", encoding="utf-8")
            with mock.patch.object(ac, "REPO_ROOT", root):
                out = ac._read_discord_jsonl("2026-06-10")
        # 坏行触发异常被 except 捕获，整文件中断但不崩溃
        self.assertEqual(out, [])


if __name__ == "__main__":
    unittest.main()
