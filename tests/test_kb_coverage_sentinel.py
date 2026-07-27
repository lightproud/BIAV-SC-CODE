"""KB 覆盖哨兵（Pillar C）—— 守白盒的招牌死法「假完备」。

守密人 2026-07-04 北极星（`memory/knowledge-layer-design.md`）命令三：白盒以遗漏撒谎——
有界地图感觉是全的，其实只和策展一样全。本哨兵扫全仓**有知识价值的文件**，断言每个都被
某 OKF 概念的 `resource` 指针覆盖（直接指向、或被某目录指针涵盖）；发现未覆盖即报错，
逼「建层 / 补指针 / 显式豁免」。自动化 ultracode 批判员当初的人工活（曾漏 CLAUDE.md、extracted/）。

sparse checkout（归档层缺席）下相应 glob 自动落空、跳过，不放水。

两档制（守密人 2026-07-27 裁定，修「哨兵与 §6.1 打架」）：§6.1 明文内容 PR 不必
随包重建 OKF（合并 main 后自动重建收编），旧哨兵却对任何新知识文件立即硬红——
每加一个文件必带红过门，逼人肉豁免。现按 okf/coverage_inventory.json（上次重建
时点的知识文件存量，build_okf_bundle.py 落）分两档：**清单内未覆盖 = 生成器见过
仍漏 = 硬红**；**清单外未覆盖 = 重建后新增 = 软报（打印待收编清单）不红**——下次
重建把它收进清单，届时仍未覆盖照样硬红，洞最多活一个重建周期。清单缺席时回退
旧全严格行为。
"""
from __future__ import annotations

import re
from pathlib import Path

import _paths  # noqa: F401
import kb_coverage

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
RESERVED = {"index.md", "log.md"}
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)

# 知识文件 glob 单一真相源已下沉 scripts/kb_coverage.py（生成器落存量清单
# 用同一份，抄两份必漂移）。

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

    knowledge = kb_coverage.collect_knowledge_files(REPO)
    uncovered = sorted(
        rel for rel in knowledge
        if rel not in ALLOWLIST and not _covered(rel, targets)
    )

    inventory = kb_coverage.read_inventory(REPO)
    if inventory is None:
        # 清单缺席（重建尚未产出过）：回退旧全严格行为。
        assert uncovered == [], (
            "知识库假完备——以下知识文件无任何概念指向（建层/补指针 okf_pointer_layers，"
            f"或加 ALLOWLIST 附理由）：{uncovered}"
        )
        return

    hard = [rel for rel in uncovered if rel in inventory]
    pending = [rel for rel in uncovered if rel not in inventory]
    if pending:
        # 重建后新增、待下次 OKF 重建收编（§6.1 push 触发器）。软报不红——
        # 但下次重建后它进清单，仍未覆盖即硬红。
        print(
            "kb-coverage: pending next OKF rebuild (added after the last one, "
            f"not failing yet): {pending}"
        )
    assert hard == [], (
        "知识库假完备——以下知识文件在上次 OKF 重建时已存在、生成器仍未覆盖"
        f"（建层/补指针 okf_pointer_layers，或加 ALLOWLIST 附理由）：{hard}"
    )


def test_allowlist_not_rotten():
    """ALLOWLIST 条目若已不存在于磁盘=死条，剪掉保持诚实。"""
    stale = sorted(k for k in ALLOWLIST if not (REPO / k).exists())
    assert stale == [], f"ALLOWLIST 含已消失文件（清理）：{stale}"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
