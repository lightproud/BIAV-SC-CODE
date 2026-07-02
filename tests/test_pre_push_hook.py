"""`.githooks/pre-push` 防 413 胖包钩子的行为验证（P7，2026-07-02）。

该钩子是 lesson #28/#34/#39（陈旧基底推胖包 → HTTP 413）的唯一自动化防线，此前
零测试——坏掉的发现方式将是再踩一次 413。本档在 tmp 里搭「裸远端 + 双克隆」演习场，
把真实钩子文件装进克隆，钉住四条行为：

  1. 基底新鲜 → 放行（push 成功）
  2. 基底陈旧 → 自动 rebase 对齐 + exit 1 拦下本次 push，重推成功且历史已含最新 main
  3. rebase 冲突 → abort 回到 push 前状态 + exit 1 拦下，工作树不留 rebase 残局
  4. 非 origin remote → 直接放行，不做对齐

真实钩子文件原样拷入（非复刻脚本内容），钩子改动即测试同步受检。
"""
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOK_SRC = REPO_ROOT / ".githooks" / "pre-push"


def _git(cwd, *args, check=True):
    r = subprocess.run(
        ["git", "-c", "user.email=erica@test", "-c", "user.name=erica",
         "-c", "commit.gpgsign=false", *args],
        cwd=str(cwd), capture_output=True, text=True,
    )
    if check and r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed:\n{r.stdout}\n{r.stderr}")
    return r


class PrePushHookHarness(unittest.TestCase):
    """裸远端 origin.git + 克隆 work（被测）+ 克隆 other（制造远端前进）。"""

    def setUp(self):
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.origin = tmp / "origin.git"
        _git(tmp, "init", "--bare", "-b", "main", str(self.origin))

        # 种子提交进 main
        seed = tmp / "seed"
        _git(tmp, "clone", "-q", str(self.origin), str(seed))
        (seed / "base.txt").write_text("base\n", encoding="utf-8")
        _git(seed, "add", "."); _git(seed, "commit", "-qm", "base")
        _git(seed, "push", "-q", "origin", "main")

        # 被测克隆：装配真实钩子（与 CLAUDE.md §7.4 相同的 hooksPath 方式）
        self.work = tmp / "work"
        _git(tmp, "clone", "-q", str(self.origin), str(self.work))
        hooks = self.work / ".githooks"
        hooks.mkdir()
        shutil.copy(HOOK_SRC, hooks / "pre-push")
        (hooks / "pre-push").chmod(0o755)
        _git(self.work, "config", "core.hooksPath", ".githooks")

        # 另一克隆，用于让 origin/main 前进（制造工作克隆基底陈旧）
        self.other = tmp / "other"
        _git(tmp, "clone", "-q", str(self.origin), str(self.other))

    def tearDown(self):
        self._tmp.cleanup()

    def _advance_origin_main(self, fname="upstream.txt", content="upstream\n"):
        (self.other / fname).write_text(content, encoding="utf-8")
        _git(self.other, "add", "."); _git(self.other, "commit", "-qm", f"advance {fname}")
        _git(self.other, "push", "-q", "origin", "main")

    def _feature_commit(self, fname="feature.txt", content="feature\n"):
        _git(self.work, "checkout", "-qb", "feature")
        (self.work / fname).write_text(content, encoding="utf-8")
        _git(self.work, "add", "."); _git(self.work, "commit", "-qm", f"feature {fname}")

    def test_fresh_base_passes_first_push(self):
        self._feature_commit()
        r = _git(self.work, "push", "-q", "-u", "origin", "feature")
        self.assertEqual(r.returncode, 0)

    def test_stale_base_rebased_blocked_then_repush_succeeds(self):
        self._feature_commit()
        self._advance_origin_main()

        first = _git(self.work, "push", "-q", "-u", "origin", "feature", check=False)
        self.assertNotEqual(first.returncode, 0, "陈旧基底的首推必须被拦下")
        self.assertIn("落后 origin/main", first.stderr)
        self.assertIn("已对齐", first.stderr)

        # rebase 已就位：origin/main 最新提交成为分支祖先
        origin_main = _git(self.work, "rev-parse", "origin/main").stdout.strip()
        anc = _git(self.work, "merge-base", "--is-ancestor", origin_main, "HEAD", check=False)
        self.assertEqual(anc.returncode, 0, "拦下时分支必须已 rebase 到最新 origin/main 之上")

        second = _git(self.work, "push", "-q", "-u", "origin", "feature")
        self.assertEqual(second.returncode, 0, "对齐后的重推必须放行")

    def test_rebase_conflict_aborts_and_blocks(self):
        self._feature_commit("clash.txt", "ours\n")
        self._advance_origin_main("clash.txt", "theirs\n")
        head_before = _git(self.work, "rev-parse", "HEAD").stdout.strip()

        r = _git(self.work, "push", "-q", "-u", "origin", "feature", check=False)
        self.assertNotEqual(r.returncode, 0, "冲突时必须拦下 push")
        self.assertIn("冲突", r.stderr)

        # abort 干净：HEAD 回到 push 前，无 rebase 残局
        self.assertEqual(_git(self.work, "rev-parse", "HEAD").stdout.strip(), head_before,
                         "abort 后必须回到 push 前状态")
        self.assertFalse((self.work / ".git" / "rebase-merge").exists(), "不得残留 rebase 状态目录")
        status = _git(self.work, "status", "--porcelain").stdout
        self.assertEqual(status.strip(), "", "工作树必须干净")

    def test_non_origin_remote_passes_without_alignment(self):
        self._feature_commit()
        self._advance_origin_main()  # 基底陈旧，但推往非 origin remote
        mirror = Path(self._tmp.name) / "mirror.git"
        _git(Path(self._tmp.name), "init", "--bare", "-b", "main", str(mirror))
        _git(self.work, "remote", "add", "mirror", str(mirror))

        head_before = _git(self.work, "rev-parse", "HEAD").stdout.strip()
        r = _git(self.work, "push", "-q", "mirror", "feature")
        self.assertEqual(r.returncode, 0, "非 origin remote 必须放行")
        self.assertEqual(_git(self.work, "rev-parse", "HEAD").stdout.strip(), head_before,
                         "非 origin 放行时不得做任何对齐改动")


if __name__ == "__main__":
    unittest.main()
