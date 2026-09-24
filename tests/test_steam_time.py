"""Isolated execution of production Steam functions, no network or credentials."""
import ast
import datetime as dt
import logging
from pathlib import Path
import re
import types
import unittest

SOURCE = Path(__file__).parents[1] / 'projects/news/scripts/global_collectors.py'

def functions():
    tree=ast.parse(SOURCE.read_text(encoding='utf-8'))
    names={'_steam_thread_created_at','_fetch_steam_discussions_one'}
    selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
    assert len(selected)==2
    scope={'datetime':dt.datetime,'timedelta':dt.timedelta,'UTC':dt.timezone.utc,
           'HOURS_LOOKBACK':48,'logger':logging.getLogger('test'),
           '_strip_html_tags':lambda x:re.sub('<[^>]+>','',x),
           'time':types.SimpleNamespace(sleep=lambda _:None)}
    exec(compile(ast.Module(body=selected,type_ignores=[]),str(SOURCE),'exec'),scope)
    return scope

class SteamTimeTest(unittest.TestCase):
    def test_actual_op_timestamp_not_reply(self):
        # Original page's exact OP epoch; a later reply must not replace it.
        html='<div class="forum_op " id="forum_op_123"><div class="date commentthread_comment_timestamp" title="2 September, 2026 @ 10:13:27 am PDT" data-timestamp="1788369207"></div></div><div class="commentthread_comment_timestamp" data-timestamp="1789585799"></div>'
        f=functions();self.assertEqual(f['_steam_thread_created_at'](html),'2026-09-02T17:13:27+00:00')
    def test_missing_op_never_falls_back_to_reply(self):
        f=functions()
        for html in ['<div class="commentthread_comment_timestamp" data-timestamp="1789585799"></div>', '<div class="forum_op"></div><div class="commentthread_comment_timestamp" data-timestamp="1789585799"></div>']:
            self.assertIsNone(f['_steam_thread_created_at'](html))
    def test_writer_separates_creation_activity_fetch(self):
        f=functions();now=int(dt.datetime.now(dt.timezone.utc).timestamp())
        listing=f'<div class="forum_topic unread"><a class="forum_topic_overlay" href="https://steamcommunity.com/app/3052450/discussions/0/123/"></a><div class="forum_topic_name">old thread</div><div class="forum_topic_lastpost" data-timestamp="{now}"></div></div>'
        topic='<div class="forum_op"><div class="commentthread_comment_timestamp" data-timestamp="1788369207"></div></div>'
        calls=[]
        def get(url,**kwargs):
            calls.append(url);return types.SimpleNamespace(text=listing if len(calls)==1 else topic,raise_for_status=lambda:None)
        f['requests']=types.SimpleNamespace(get=get,RequestException=Exception)
        rows=f['_fetch_steam_discussions_one']('3052450','global',max_pages=1)
        self.assertEqual(len(rows),1);self.assertEqual(len(calls),2)
        self.assertEqual(rows[0]['created_at'],'2026-09-02T17:13:27+00:00')
        self.assertEqual(rows[0]['time_semantics'],'last_activity')
        self.assertEqual(rows[0]['time'],rows[0]['last_activity_at'])
        self.assertNotEqual(rows[0]['created_at'],rows[0]['last_activity_at'])
        self.assertTrue(rows[0]['fetched_at'])

    def test_topic_fetch_failure_keeps_activity_without_guessing_creation(self):
        f = functions()
        now = int(dt.datetime.now(dt.timezone.utc).timestamp())
        listing = (
            '<div class="forum_topic unread">'
            '<a class="forum_topic_overlay" href="https://steamcommunity.com/app/3052450/discussions/0/123/"></a>'
            '<div class="forum_topic_name">thread</div>'
            f'<div class="forum_topic_lastpost" data-timestamp="{now}"></div>'
            '</div>'
        )
        calls = []

        def get(url, **kwargs):
            calls.append(url)
            if len(calls) == 1:
                return types.SimpleNamespace(text=listing, raise_for_status=lambda: None)
            raise OSError('topic unavailable')

        f['requests'] = types.SimpleNamespace(get=get, RequestException=OSError)
        rows = f['_fetch_steam_discussions_one']('3052450', 'global', max_pages=1)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['created_at'])
        self.assertIsNone(rows[0]['time_provenance'])
        self.assertEqual(rows[0]['time'], rows[0]['last_activity_at'])

if __name__=='__main__':unittest.main()
