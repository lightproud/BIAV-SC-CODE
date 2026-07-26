"""test_status_doc_facts.py —— 状态档版本事实跨档对账哨兵（守密人 2026-07-26 裁定「建，入门禁」）

背景：2026-07-26 SDK 审视会话实测发现，`projects/silver-core-sdk/CHANGELOG.md` 已发到
0.76.0（2026-07-22），而 `CONTEXT.md`「当前状态」与 `memory/project-status.md`「## Silver
Core SDK」两处**都还停在 v0.69.0**——12 个发布无人回写。CLAUDE.md §5.3 定 project-status.md
为「状态唯一权威」，权威档却不权威。

为何现有哨兵接不住（分工边界，不重叠）：
  - `scripts/memory_freshness.py` 管**档案级** git 龄与头部日期错位——粒度错配。
    project-status.md 天天被别的子项目改，git 龄永远新鲜，SDK 那一节烂在里面无人喊；
    且该项刻意只报告不进门禁。
  - `tests/test_claude_md_coverage.py` 把 project-status.md 当「作者名单」用（校验核心脚本
    有没有被某份权威档提到），**不校验档内任何一条事实**。
  - `projects/silver-core-sdk/scripts/check-version-bump.mjs` 做的是包内三方对账
    （package.json ↔ src/version.ts ↔ CHANGELOG），射程**不出包目录**，且 maestro 无对应守卫。
  - `scripts/build_status_facts.py` + `tests/test_status_facts.py`（同日另一路落地的抗漂移
    「招一 · 生成取代对账」）把版本 / 规模 / 台账条数**生成**进 project-status.md 的
    STATUS-FACTS 块——**生成严格强于哨兵**（漂移不可能，而非被发现），但它只覆盖**事实表**。
    实证（2026-07-26）：生成块已正确写着 maestro 0.76.0 的同时，下方 maestro **叙述节仍停在
    0.69.0**——「0.75.0 做了什么」是判断、生成不出来，生成块对叙述层一无所知。
  - 本哨兵管「CHANGELOG 最新版本号 ↔ package.json ↔ 状态**叙述层**」这一段，是上面四者都没盖到
    的角落。**注意语义**：钉的不是「把版本号抄成第二份事实表」（那正是招一要消灭的），
    而是「发布台账最新一版必须在叙述里留下痕迹」——叙述不得停在 7 个版本之前。

钉什么、不钉什么（刻意的取舍）：
  只钉「最新版本号必须被状态档提及」——机器能判「有没有」，判不了「写得好不好」。
  **不钉测试数**：每改一次测试就要改档，噪音压过信号。
  这一条已足以让本次的 12 版落后当场翻红，够用即止。

纯标准库：unittest + pathlib + re + json。
"""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_STATUS = ROOT / "memory" / "project-status.md"

# CHANGELOG 里的发布标题形态：`## 0.76.0 — 2026-07-22`。散文里的版本提及（「as of 0.41.0」）
# 永远不是 `## ` 标题，故不会被误当成最新发布——与 check-version-bump.mjs 同款判据。
CHANGELOG_HEADING_RE = re.compile(r"^##\s+(\d+\.\d+\.\d+)\b", re.M)

# 受管包：每项 = (包目录名, CONTEXT.md 内的状态节标题, project-status.md 内的节标题前缀)。
# 节标题前缀须能唯一定位——「## Silver Core SDK」与「## Silver Core Maestro SDK」不同前缀，
# 逐字符前缀匹配即可区分（Maestro 那条不以 "## Silver Core SDK" 开头）。
WATCHED_PACKAGES = (
    ("silver-core-sdk", "## 当前状态", "## Silver Core SDK"),
    ("silver-core-maestro-sdk", "## 当前状态", "## Silver Core Maestro SDK"),
)

# 豁免清单：确属受管包但「按设计」暂不要求状态档提及最新版本号的情形。
# 每条必须写明理由——**空 allowlist 是目标**，任何新增都得是经核实的「哨兵已知盲区」
# 而非「懒得回写」。真实漂移应当 fail，由守密人决定「补回写」还是「加豁免」。
# 形态：{ "包目录名": "豁免理由" }
ALLOWLIST: dict[str, str] = {
    # 当前为空。
}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _latest_changelog_version(changelog_text: str) -> str | None:
    """CHANGELOG 顶部起第一个 `## X.Y.Z` 标题的版本号；无标题返回 None。"""
    m = CHANGELOG_HEADING_RE.search(changelog_text)
    return m.group(1) if m else None


def _section(text: str, heading: str) -> str | None:
    """抽出以 `heading` 开头的那一节正文（到下一个同级 `## ` 标题或文末为止）。

    `heading` 按**行首前缀**匹配，故 "## Silver Core SDK" 不会误吃
    "## Silver Core Maestro SDK"（后者不以前者为前缀）。找不到返回 None。
    """
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.startswith(heading):
            start = i
            break
    if start is None:
        return None
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            return "\n".join(lines[start:j])
    return "\n".join(lines[start:])


class StatusDocFactsTest(unittest.TestCase):
    """CHANGELOG 最新版本号 ↔ package.json ↔ 两份状态档 的跨档对账。"""

    def test_changelog_matches_package_json(self):
        """发布台账顶部版本必须等于 package.json 版本。

        agent 侧 check-version-bump.mjs 已在包内查这一条，但它是 CI 里的独立脚本、
        且 maestro 没有对应守卫——在此统一钉死，两包同办，锁步制才有机器依据。
        """
        for pkg, _, _ in WATCHED_PACKAGES:
            with self.subTest(package=pkg):
                pkg_dir = ROOT / "projects" / pkg
                declared = json.loads(_read(pkg_dir / "package.json"))["version"]
                latest = _latest_changelog_version(_read(pkg_dir / "CHANGELOG.md"))
                self.assertIsNotNone(latest, f"{pkg}/CHANGELOG.md 无任何 `## X.Y.Z` 发布标题")
                self.assertEqual(
                    latest,
                    declared,
                    f"{pkg}：CHANGELOG 顶部 {latest} 与 package.json {declared} 不符——"
                    "发布台账与包版本必须同步（消费方按版本 pin tarball）",
                )

    def test_latest_version_reaches_context_md(self):
        """最新版本号必须出现在该包 CONTEXT.md 的「当前状态」节内。"""
        for pkg, ctx_heading, _ in WATCHED_PACKAGES:
            with self.subTest(package=pkg):
                if pkg in ALLOWLIST:
                    self.skipTest(f"{pkg} 已豁免：{ALLOWLIST[pkg]}")
                pkg_dir = ROOT / "projects" / pkg
                latest = _latest_changelog_version(_read(pkg_dir / "CHANGELOG.md"))
                section = _section(_read(pkg_dir / "CONTEXT.md"), ctx_heading)
                self.assertIsNotNone(
                    section, f"{pkg}/CONTEXT.md 找不到「{ctx_heading}」节"
                )
                self.assertIn(
                    latest,
                    section,
                    f"{pkg}/CONTEXT.md「{ctx_heading}」节未提及最新版本 {latest}——"
                    "状态档落后于发布台账（2026-07-26 落后 12 版的同款漂移）。"
                    "回写一条摘要即可，逐版全文仍以 CHANGELOG 为唯一权威",
                )

    def test_latest_version_reaches_project_status(self):
        """最新版本号必须出现在 memory/project-status.md 对应子项目节内。

        CLAUDE.md §5.3 定该档为「状态唯一权威，进度数字只在此维护」——权威档落后即失权威。
        """
        status_text = _read(PROJECT_STATUS)
        for pkg, _, status_heading in WATCHED_PACKAGES:
            with self.subTest(package=pkg):
                if pkg in ALLOWLIST:
                    self.skipTest(f"{pkg} 已豁免：{ALLOWLIST[pkg]}")
                latest = _latest_changelog_version(
                    _read(ROOT / "projects" / pkg / "CHANGELOG.md")
                )
                section = _section(status_text, status_heading)
                self.assertIsNotNone(
                    section,
                    f"memory/project-status.md 找不到「{status_heading}」节——"
                    "节标题改名须同步本哨兵的 WATCHED_PACKAGES",
                )
                self.assertIn(
                    latest,
                    section,
                    f"memory/project-status.md「{status_heading}」节未提及最新版本 {latest}"
                    "——状态唯一权威档落后于发布台账（CLAUDE.md §5.3）",
                )

    def test_watched_packages_all_exist(self):
        """受管包目录与其三件套档案都在——防「包改名/删档后哨兵静默空转」。"""
        for pkg, _, _ in WATCHED_PACKAGES:
            with self.subTest(package=pkg):
                pkg_dir = ROOT / "projects" / pkg
                for name in ("package.json", "CHANGELOG.md", "CONTEXT.md"):
                    self.assertTrue(
                        (pkg_dir / name).is_file(),
                        f"{pkg}/{name} 不存在——包改名或档案迁移后须同步 WATCHED_PACKAGES",
                    )

    def test_allowlist_entries_are_watched_packages(self):
        """豁免清单不得留孤儿键——包退出受管后，其豁免必须一并删除。"""
        watched = {pkg for pkg, _, _ in WATCHED_PACKAGES}
        orphans = sorted(set(ALLOWLIST) - watched)
        self.assertEqual(
            orphans,
            [],
            f"ALLOWLIST 有孤儿键 {orphans}——不在 WATCHED_PACKAGES 里的豁免是死条目，删掉",
        )


if __name__ == "__main__":
    unittest.main()
