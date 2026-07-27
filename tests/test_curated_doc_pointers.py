"""策展操作层指针守卫 —— 「照着旧地址取货」的门禁。

2026-07-26 全仓 md 重复度 / 矛盾扫描的**唯一实质发现**（守密人 2026-07-26 裁定「扩为
策展层守卫」）：重复度三维（字面重复 7 行 / 规则重复 0 组 / 权威声明无双认领）实测健康，
真正的病是**传导缺口**——数据湖迁仓（T62 P2-5，2026-07-20）记进了 3 份记账档，却一份
操作档都没改。`.claude/commands/biav-report.md` 当时仍明写「text 全量永驻 git」，与
CLAUDE.md §5.2 正面冲突；照着它走的会话会空手而归，还以为自己走对了。

`tests/test_claude_md*.py` 只守 CLAUDE.md 一份，够不着这一层。本组把同一判据扩到
**真正被会话当指令执行**的档案：slash 命令 / 技能 / 各子项目 CONTEXT / memory/active
入口卡。判据机器可判：反引号里的仓内路径，按包根解析后是否真的存在。

**落空不是自动红——落空必须有具名理由。** 四类合法豁免各自显式登记（见下），新增的
落空指针没有理由就红。这样「为什么这条可以不存在」永远是写下来的，不是猜的。

守卫本身比它守的东西简单：无子进程、无启发式词表、只读 committed 文件 + 一张豁免表。
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

# 被会话当指令执行的档案。dated 范例（example-*.md）是定格快照、不是指令，排除。
def _curated_docs() -> list[Path]:
    docs = (
        sorted(REPO.glob(".claude/commands/*.md"))
        + sorted(REPO.glob(".claude/skills/**/*.md"))
        + sorted(REPO.glob("projects/*/CONTEXT.md"))
        + sorted(REPO.glob("memory/active/*.md"))
    )
    return [d for d in docs if not d.name.startswith("example-")]


# 路径可能相对仓根，也可能相对所属包根（SDK 档案里的 `src/…` / `tests/…`）。
_PACKAGE_ROOTS = [
    "silver-core-sdk",
    "silver-core-maestro-sdk",
    "silver-core-testbed",
    "wiki",
    "news",
    "site",
    "game",
]
BASES = [REPO] + [REPO / "projects" / p for p in _PACKAGE_ROOTS]

# 只认这些顶层段开头的串是「仓内路径」，其余反引号内容（命令、字段名、URL）不管。
ROOT_SEGMENTS = {
    ".claude",
    ".github",
    "Public-Info-Pool",
    "assets",
    "docs",
    "memory",
    "okf",
    "projects",
    "scripts",
    "src",
    "tests",
}

# 反引号内的路径。尾斜杠的目录引用（`a/b/`）必须一并抓——首轮扫描的正则漏了这一形态，
# 结果把「Public-Info-Pool/Record/Community/ 在 code 仓已整个不存在」这条最大的落空
# 给漏报了。
_BACKTICKED = re.compile(r"`([A-Za-z0-9_.-][A-Za-z0-9_./{}*-]*)`")

# ---------------------------------------------------------------------------
# 豁免一：数据湖内路径。本体在 BIAV-SC-DATA 数据仓（T62 P2-5，2026-07-20），经
# BIAV_SC_DATA_ROOT 解析；CI 与本地会话容器都没挂载它，**本组无从验证、故不判**。
# 这不是网开一面：这些路径的正确性由 `tests/test_archive_layout.py` 的读写往返契约守。
# ---------------------------------------------------------------------------
DATA_LAKE_PREFIX = "Public-Info-Pool/Record/Community"

# ---------------------------------------------------------------------------
# 豁免二~四：逐条具名。key = (档案相对路径, 被引路径)，value = 为什么它可以不存在。
# 加条目 = 声明「这条落空是有意的」；理由写不出来的，就该去修档案而不是加豁免。
# ---------------------------------------------------------------------------
EXCUSED: dict[tuple[str, str], str] = {
    # 否定式断言：档案正文就在说「这个不存在」，存在反而是错的。
    (".claude/commands/validate-data.md", "projects/wiki/data/db/"):
        "该层 2026-06-15 守密人裁定整层清空；命令正文明写「其缺失是预期」",
    (".claude/skills/domain-modeling/SKILL.md", "docs/adr/"):
        "正文断言「银芯没有 docs/adr/ 树」，是在讲上游概念如何映射到银芯，非指针",
    # gitignored 产物：按设计不进 git。
    (".claude/skills/intel-weekly/reference.md", "projects/news/data/fanart/"):
        "渲染用缩图目录，gitignored（该行自注）",
    # 规划路径：需求档里尚未验收的目标状态。
    ("memory/active/self-improvement-requirements.md", "memory/pitfalls/"):
        "REQ-3.2 尚未启用的目标路径（验收项未勾），非现存指针",
    # 退役史叙述：档案正文就是在讲「这个东西曾经在、现已删除」，指针指向过去。
    ("projects/wiki/CONTEXT.md", "Public-Info-Pool/Reference/Game-Unpacked/"):
        "档首横幅即宣告该层 2026-07-12 整层删除，全档对它的引用按历史状态理解",
    ("memory/active/policy-direct-push-main.md", ".claude/hooks/session-start-sync.sh"):
        "会话钩子 2026-06-14 已退役删除；该档两处均为「原 X 已退役、改由 Y」的更替叙述",
}


def _dangling(doc: Path) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    rel_doc = str(doc.relative_to(REPO))
    for lineno, line in enumerate(doc.read_text(encoding="utf-8").splitlines(), 1):
        for raw in _BACKTICKED.findall(line):
            if "/" not in raw or any(c in raw for c in "{}*"):
                continue
            path = raw.rstrip("/")
            if path.split("/")[0] not in ROOT_SEGMENTS:
                continue
            if path.startswith(DATA_LAKE_PREFIX):
                continue
            if (rel_doc, raw) in EXCUSED:
                continue
            if any((base / path).exists() for base in BASES):
                continue
            out.append((lineno, raw))
    return out


@pytest.mark.parametrize("doc", _curated_docs(), ids=lambda p: str(p.relative_to(REPO)))
def test_curated_doc_has_no_dangling_pointer(doc: Path) -> None:
    """会话照着操作档取货，取不到东西不会报错——只会拿空手当结论。"""
    dangling = _dangling(doc)
    assert not dangling, (
        f"{doc.relative_to(REPO)} 引用了不存在的仓内路径: "
        + "; ".join(f"L{n} `{p}`" for n, p in dangling)
        + "。修档案改成现行路径；确属有意（已删除层 / gitignored / 尚未创建）"
        f" 则在 {Path(__file__).name} 的 EXCUSED 里具名登记理由。"
    )


def test_excused_entries_still_point_at_something_real() -> None:
    """豁免表里的死条目会让本组慢慢变成摆设：档案改写后旧豁免仍挂着，
    下一条真落空就可能被人顺手塞进这张表。故豁免必须仍被其档案实际引用。"""
    stale = []
    for (rel_doc, raw), _reason in EXCUSED.items():
        doc = REPO / rel_doc
        if not doc.exists() or f"`{raw}`" not in doc.read_text(encoding="utf-8"):
            stale.append(f"{rel_doc} → {raw}")
    assert not stale, f"EXCUSED 里的条目已不再被引用，请删除: {stale}"


def test_every_excuse_has_a_reason() -> None:
    """空理由的豁免等于没豁免——它只是把问题藏进了字典。"""
    empty = [k for k, v in EXCUSED.items() if not v.strip()]
    assert not empty, f"以下豁免没写理由: {empty}"


def test_the_guard_actually_covers_the_operational_surface() -> None:
    """覆盖面塌了本组就静默失效：档案改名 / 目录搬家后 glob 可能一份都扫不到，
    那时全组会「全绿」——绿得毫无信息量。"""
    docs = {str(d.relative_to(REPO)) for d in _curated_docs()}
    for must in (
        ".claude/commands/biav-report.md",
        ".claude/skills/intel-weekly/SKILL.md",
        "projects/news/CONTEXT.md",
    ):
        assert must in docs, f"守卫未覆盖 {must}——glob 范围塌了"
    assert len(docs) >= 15, f"策展操作档只扫到 {len(docs)} 份，覆盖面异常收缩"
