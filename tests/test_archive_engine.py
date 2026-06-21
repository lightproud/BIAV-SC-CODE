import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "projects" / "news" / "scripts"))

import archive_engine as ae


def _touch(p: Path, content: str = "{}\n"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


class RegistryInvariants(unittest.TestCase):
    """锁住向后兼容：Discord 标签/cutoff/删数据策略不得漂移。"""

    def test_discord_entry_backward_compatible(self):
        cfg = ae.load_registry()["discord"]
        # 标签必须仍是 discord-archive-YYYY-MM，否则现存 20 个 Release 成孤儿
        self.assertEqual(cfg["tag_template"], "discord-archive-{group}")
        self.assertEqual(cfg["title_template"], "Discord Archive {group}")
        self.assertEqual(cfg["cutoff_days"], 60)
        self.assertEqual(cfg["group_by"], "month_from_stem")
        self.assertEqual(cfg["after_archive"], "git_rm")
        self.assertEqual(cfg["base_dir"], "projects/news/data/discord")
        # 标签实际渲染等价于原 archive_discord
        self.assertEqual(cfg["tag_template"].format(group="2026-01"), "discord-archive-2026-01")


class GroupingAndCutoff(unittest.TestCase):
    def test_group_of_month_from_stem(self):
        p = Path("channels/abc/2026-01-15.jsonl")
        self.assertEqual(ae.group_of(p, "month_from_stem", "all"), "2026-01")

    def test_group_of_single(self):
        p = Path("media/x.png")
        self.assertEqual(ae.group_of(p, "single", "v1"), "v1")

    def test_is_eligible_cutoff_compare(self):
        # 与原 archive_discord 的字符串日期比较逐字节等价
        self.assertTrue(ae.is_eligible(Path("a/2026-01-15.jsonl"), "month_from_stem", "2026-04-22"))
        self.assertFalse(ae.is_eligible(Path("a/2026-05-01.jsonl"), "month_from_stem", "2026-04-22"))
        # 边界：等于 cutoff 当日不归档（< 严格小于）
        self.assertFalse(ae.is_eligible(Path("a/2026-04-22.jsonl"), "month_from_stem", "2026-04-22"))

    def test_is_eligible_no_cutoff(self):
        self.assertTrue(ae.is_eligible(Path("a/whatever.jsonl"), "month_from_stem", None))


class Discover(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        for ch in ("aaa", "bbb"):
            _touch(self.base / "channels" / ch / "2026-01-05.jsonl")
            _touch(self.base / "channels" / ch / "2026-01-20.jsonl")
            _touch(self.base / "channels" / ch / "2026-04-30.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def _cfg(self, **over):
        cfg = {"glob": "channels/*/*.jsonl", "group_by": "month_from_stem", "cutoff_days": None}
        cfg.update(over)
        return cfg

    def test_no_cutoff_groups_all_by_month(self):
        groups = ae.discover(self._cfg(), self.base, [])
        self.assertEqual(set(groups), {"2026-01", "2026-04"})
        self.assertEqual(len(groups["2026-01"]), 4)  # 2 channels x 2 files
        self.assertEqual(len(groups["2026-04"]), 2)

    def test_force_group_bypasses_cutoff(self):
        groups = ae.discover(self._cfg(cutoff_days=60), self.base, ["2026-04"])
        self.assertEqual(set(groups), {"2026-04"})
        self.assertEqual(len(groups["2026-04"]), 2)

    def test_missing_base_dir_returns_empty(self):
        self.assertEqual(ae.discover(self._cfg(), self.base / "nope", []), {})


class Tarball(unittest.TestCase):
    def test_arcname_relative_to_base_and_filename(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            f = base / "channels" / "xx" / "2026-01-01.jsonl"
            _touch(f)
            cfg = {"tag_template": "discord-archive-{group}"}
            path, size = ae.create_tarball(cfg, base, "2026-01", [f])
            # 文件名向后兼容
            self.assertEqual(path.name, "discord-archive-2026-01.tar.gz")
            self.assertGreater(size, 0)
            # tar 内路径相对 base_dir（与原 archive_discord 一致）
            with tarfile.open(path, "r:gz") as tar:
                self.assertEqual(tar.getnames(), ["channels/xx/2026-01-01.jsonl"])


class GitRm(unittest.TestCase):
    def test_git_rm_called_per_file(self):
        files = [Path("/repo/a.jsonl"), Path("/repo/b.jsonl")]
        with mock.patch.object(ae.subprocess, "run") as run:
            run.return_value = mock.Mock(returncode=0)
            removed = ae.git_rm_files(files)
        self.assertEqual(removed, 2)
        self.assertEqual(run.call_count, 2)
        # 确实调用的是 git rm -f
        first = run.call_args_list[0].args[0]
        self.assertEqual(first[:3], ["git", "rm", "-f"])

    def test_git_rm_untracked_falls_back_to_unlink(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.jsonl"
            f.write_text("x")
            err = ae.subprocess.CalledProcessError(1, "git")
            with mock.patch.object(ae.subprocess, "run", side_effect=err):
                removed = ae.git_rm_files([f])
            self.assertEqual(removed, 1)
            self.assertFalse(f.exists())  # 已 unlink


class DryRun(unittest.TestCase):
    def test_dry_run_creates_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            repo = Path(d)
            base = repo / "projects" / "news" / "data" / "discord"
            _touch(base / "channels" / "xx" / "2026-01-01.jsonl")
            cfg = ae.load_registry()["discord"]
            args = mock.Mock(dry_run=True, skip_upload=False, force_group=["2026-01"])
            with mock.patch.object(ae, "REPO_ROOT", repo):
                ae.archive_source("discord", cfg, args)
            # dry-run 不得产出任何 tarball
            self.assertEqual(list(base.glob("*.tar.gz")), [])


if __name__ == "__main__":
    unittest.main()
