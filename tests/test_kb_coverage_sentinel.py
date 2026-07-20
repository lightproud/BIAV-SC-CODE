"""KB 覆盖哨兵（Pillar C）—— 守白盒的招牌死法「假完备」。

守密人 2026-07-04 北极星（`memory/knowledge-layer-design.md`）命令三：白盒以遗漏撒谎——
有界地图感觉是全的，其实只和策展一样全。本哨兵扫全仓**有知识价值的文件**，断言每个都被
某 OKF 概念的 `resource` 指针覆盖（直接指向、或被某目录指针涵盖）；发现未覆盖即报错，
逼「建层 / 补指针 / 显式豁免」。自动化 ultracode 批判员当初的人工活（曾漏 CLAUDE.md、extracted/）。

sparse checkout（归档层缺席）下相应 glob 自动落空、跳过，不放水。
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
RESERVED = {"index.md", "log.md"}
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)

# 应被知识库覆盖的「知识文件」glob（相对仓根）。纯代码/生成物/瞬态不在内。
KNOWLEDGE_GLOBS = [
    "assets/data/*.json", "assets/data/*.md",
    "assets/data/character-personas/*.json", "assets/data/character-personas/*.md",
    "memory/*.md", "memory/*.json",
    "memory/active/*.md", "memory/research/*.md", "memory/strategy/*.md",
    "projects/wiki/data/processed/*.json", "projects/wiki/data/processed/*.md",
    "projects/wiki/data/processed/story/*.json", "projects/wiki/data/processed/story/*.md",
    "projects/wiki/data/schemas/*.json",
    "projects/news/index/community_index.json",
    "projects/news/output/*-latest.json",
    "Public-Info-Pool/Resource/*/*.md",
    "projects/news/CONTEXT.md", "projects/wiki/CONTEXT.md", "projects/site/CONTEXT.md",
    "projects/game/CONTEXT.md", "projects/silver-core-sdk/CONTEXT.md",
    "projects/silver-core-sdk/docs/*.md",
    "projects/site/design/*.html", "projects/site/design/*.css",
]
# 单列的顶层知识文件
KNOWLEDGE_FILES = ["CLAUDE.md", "README.md", "RELEASES.md"]

# 正当不覆盖的例外（每条须有理由；覆盖到位后可删条以复归严格）。
ALLOWLIST = {
    # 层索引导航 meta（它索引的数据集已各自被 wiki-data/story 概念覆盖），非知识数据集本身。
    "projects/wiki/data/processed/README.md": "processed 层索引 README；所索引数据集已被 wiki-data 概念逐一覆盖",
}


def _resource_targets() -> list[str]:
    """所有概念 frontmatter 的 resource（去 #fragment、去前导斜杠）。"""
    out = []
    for p in BUNDLE.rglob("*.md"):
        if p.name in RESERVED:
            continue
        m = FM_RE.match(p.read_text(encoding="utf-8"))
        if not m:
            continue
        for line in m.group(1).splitlines():
            if line.startswith("resource:"):
                v = line.partition(":")[2].strip().strip('"')
                if v.startswith("/"):
                    out.append(v.lstrip("/").split("#", 1)[0])
                break
    return out


def _covered(rel: str, targets: list[str]) -> bool:
    for t in targets:
        if t == rel:
            return True
        if t.endswith("/") and (rel == t.rstrip("/") or rel.startswith(t)):
            return True  # 目录指针涵盖其下所有文件
    return False


def test_every_knowledge_file_is_covered():
    targets = _resource_targets()
    assert targets, "无任何概念 resource——bundle 可能未生成"

    knowledge: set[str] = set()
    for g in KNOWLEDGE_GLOBS:
        for p in REPO.glob(g):
            if p.is_file():
                knowledge.add(p.relative_to(REPO).as_posix())
    for f in KNOWLEDGE_FILES:
        if (REPO / f).exists():
            knowledge.add(f)

    uncovered = sorted(
        rel for rel in knowledge
        if rel not in ALLOWLIST and not _covered(rel, targets)
    )
    assert uncovered == [], (
        "知识库假完备——以下知识文件无任何概念指向（建层/补指针 okf_pointer_layers，"
        f"或加 ALLOWLIST 附理由）：{uncovered}"
    )


def test_allowlist_not_rotten():
    """ALLOWLIST 条目若已不存在于磁盘=死条，剪掉保持诚实。"""
    stale = sorted(k for k in ALLOWLIST if not (REPO / k).exists())
    assert stale == [], f"ALLOWLIST 含已消失文件（清理）：{stale}"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
