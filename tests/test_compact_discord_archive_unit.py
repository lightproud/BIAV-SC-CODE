"""compact_discord_archive.process_file 文件级编排测试（P1）。

该脚本会**原地重写 721 万条** Discord 全量归档记录，自述「幂等、可重入、临时文件原子
rename、无法解析的行不丢」。这些安全保证此前 0% 覆盖——一个会改写全量档案层本体的
工具，幂等性与无损性全靠自述。本测试用小样 fixture 钉死这些保证。

compact_record 本身的 schema 契约已由 test_discord_compact_unit 覆盖，此处不重复，
只测 process_file 的文件级行为。
"""
import importlib.util
import json
import sys
import unittest
import unittest.mock
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / 'projects' / 'news' / 'scripts'))

# compact_discord_archive 在 scripts/ 下，且 import 时会 sys.path 注入 discord_compact
_spec = importlib.util.spec_from_file_location(
    'compact_discord_archive', _ROOT / 'scripts' / 'compact_discord_archive.py')
cda = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cda)


def _full_record(**over):
    """一条完整 schema 记录（多数字段为默认值，紧凑化时应被删除）。"""
    rec = {
        'id': '1', 'channel_id': 'c1', 'type': 0, 'author_id': 'a1',
        'author_name': 'nick', 'author_bot': False, 'content': 'hello',
        'timestamp': '2026-06-01T00:00:00', 'edited_timestamp': None,
        'pinned': False, 'mentions': [], 'reactions': [], 'attachments': [],
        'embeds': [], 'reply_to': None, 'has_thread': False, 'thread_id': None,
        'flags': 0,
    }
    rec.update(over)
    return rec


def _write_jsonl(path, records):
    lines = [json.dumps(r, ensure_ascii=False) for r in records]
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


class TestProcessFile(unittest.TestCase):
    def setUp(self):
        self._tmpdir = Path(__file__).resolve().parent / '_tmp_cda'
        self._tmpdir.mkdir(exist_ok=True)
        self.f = self._tmpdir / 'sample.jsonl'

    def tearDown(self):
        for p in self._tmpdir.glob('*'):
            p.unlink()
        self._tmpdir.rmdir()

    def _read_records(self):
        return [json.loads(l) for l in self.f.read_text(encoding='utf-8').splitlines() if l]

    def test_compacts_and_shrinks(self):
        _write_jsonl(self.f, [_full_record(), _full_record(id='2')])
        orig, new, n = cda.process_file(self.f, dry_run=False)
        self.assertEqual(n, 2)
        self.assertLess(new, orig, '紧凑后字节应小于原始')
        # 默认值字段应已被删除，恒留字段仍在
        recs = self._read_records()
        self.assertEqual(recs[0].get('id'), '1')
        self.assertNotIn('type', recs[0])      # type=0 默认值删除
        self.assertNotIn('pinned', recs[0])

    def test_idempotent_second_run_no_change(self):
        _write_jsonl(self.f, [_full_record(type=19, author_bot=True)])
        cda.process_file(self.f, dry_run=False)
        after_first = self.f.read_text(encoding='utf-8')
        orig2, new2, _ = cda.process_file(self.f, dry_run=False)
        after_second = self.f.read_text(encoding='utf-8')
        self.assertEqual(after_first, after_second, '第二次运行不应再改动文件（幂等）')
        self.assertEqual(orig2, new2, '已紧凑文件原字节应等于新字节')

    def test_dry_run_does_not_write(self):
        _write_jsonl(self.f, [_full_record()])
        before = self.f.read_text(encoding='utf-8')
        orig, new, n = cda.process_file(self.f, dry_run=True)
        self.assertEqual(self.f.read_text(encoding='utf-8'), before, 'dry-run 不得落盘')
        self.assertEqual(n, 1)
        self.assertLess(new, orig, 'dry-run 仍应正确预估省字节')

    def test_unparseable_lines_preserved(self):
        # 无法解析的行必须原样保留，绝不丢数据
        good = json.dumps(_full_record(), ensure_ascii=False)
        self.f.write_text(good + '\n' + 'this-is-not-json\n', encoding='utf-8')
        orig, new, n = cda.process_file(self.f, dry_run=False)
        self.assertEqual(n, 1, '只统计可解析记录')
        content = self.f.read_text(encoding='utf-8')
        self.assertIn('this-is-not-json', content, '坏行必须保留')

    def test_blank_lines_skipped(self):
        good = json.dumps(_full_record(), ensure_ascii=False)
        self.f.write_text(good + '\n\n\n', encoding='utf-8')
        orig, new, n = cda.process_file(self.f, dry_run=False)
        self.assertEqual(n, 1)

    def test_nondefault_values_preserved_through_rewrite(self):
        _write_jsonl(self.f, [_full_record(type=19, flags=2, reply_to='99',
                                           reactions=[{'emoji': 'x', 'count': 3}])])
        cda.process_file(self.f, dry_run=False)
        rec = self._read_records()[0]
        self.assertEqual(rec['type'], 19)
        self.assertEqual(rec['flags'], 2)
        self.assertEqual(rec['reply_to'], '99')
        self.assertEqual(rec['reactions'], [{'emoji': 'x', 'count': 3}])


class TestMain(unittest.TestCase):
    """main() 编排层：目录遍历 / --dry-run / --limit / 统计汇总（P1 补齐，此前 0 覆盖）。"""

    def setUp(self):
        self._tmpdir = Path(__file__).resolve().parent / '_tmp_cda_main'
        chan = self._tmpdir / 'channels' / '0001'
        chan.mkdir(parents=True, exist_ok=True)
        self.files = []
        for i, day in enumerate(('2026-06-01', '2026-06-02', '2026-06-03')):
            f = chan / f'{day}.jsonl'
            _write_jsonl(f, [_full_record(id=str(i * 10 + j)) for j in range(2)])
            self.files.append(f)
        self._orig_dir = cda.DISCORD_DIR
        cda.DISCORD_DIR = self._tmpdir

    def tearDown(self):
        cda.DISCORD_DIR = self._orig_dir
        for p in sorted(self._tmpdir.rglob('*'), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
        self._tmpdir.rmdir()

    def _run_main(self, *argv):
        import contextlib
        import io
        buf = io.StringIO()
        with unittest.mock.patch.object(sys, 'argv', ['compact_discord_archive.py', *argv]):
            with contextlib.redirect_stdout(buf):
                cda.main()
        return buf.getvalue()

    def test_dry_run_touches_nothing_and_reports(self):
        before = {f: f.read_text(encoding='utf-8') for f in self.files}
        out = self._run_main('--dry-run')
        for f, content in before.items():
            self.assertEqual(f.read_text(encoding='utf-8'), content, 'dry-run 不得改任何文件')
        self.assertIn('DRY-RUN（未写盘）', out)
        self.assertIn('文件      : 3', out)
        self.assertIn('记录      : 6', out)

    def test_real_run_rewrites_all_files_and_reports_savings(self):
        out = self._run_main()
        self.assertIn('已重写', out)
        # 全部文件已紧凑：默认值字段消失、恒留字段与记录数无损
        total = 0
        for f in self.files:
            recs = [json.loads(l) for l in f.read_text(encoding='utf-8').splitlines() if l]
            total += len(recs)
            for r in recs:
                self.assertNotIn('pinned', r)
                self.assertIn('id', r)
        self.assertEqual(total, 6, '重写后记录数必须无损')
        # 节省百分比是真实数字而非 n/a
        self.assertNotIn('(n/a)', out)

    def test_limit_processes_only_first_n_files(self):
        before = {f: f.read_text(encoding='utf-8') for f in self.files}
        out = self._run_main('--limit', '1')
        self.assertIn('文件      : 1', out)
        # rglob 排序后仅第一个文件被重写，其余原样
        untouched = [f for f in self.files if f.read_text(encoding='utf-8') == before[f]]
        self.assertEqual(len(untouched), 2)

    def test_rewrite_leaves_no_tmp_files(self):
        self._run_main()
        leftovers = list(self._tmpdir.rglob('*.tmp'))
        self.assertEqual(leftovers, [], '原子 rename 后不得残留临时文件')

    def test_empty_dir_reports_na(self):
        for f in self.files:
            f.unlink()
        out = self._run_main()
        self.assertIn('文件      : 0', out)
        self.assertIn('n/a', out)


if __name__ == '__main__':
    unittest.main()
