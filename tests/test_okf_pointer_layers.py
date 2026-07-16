"""Tests for the whole-repo knowledge organization (okf_pointer_layers).

守密人 2026-07-04「用 ultracode 组织整个仓库所有知识」的产物守护：验证 OKF bundle
从 4 层扩到覆盖全仓知识域，且三条铁律不破——
1. 覆盖：预期的新层都生成了非空概念。
2. 放指针不放本体：full_archive 大本体层（community/unpacked/extracted）概念文件极小，
   证明只放指针、未复刻本体（discord 2.1G、解包 44M 绝不进概念正文）。
3. data_layer 标层（防 lesson #30）：各层 data_layer tag 正确，输出层描述明示「非全量」。
4. 指针不落空：每个仓内 resource 指针落到实存本体。
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
RESERVED = {"index.md", "log.md"}
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)

# 新层 -> 期望的 data_layer（None = 混合，逐概念查 tag 存在即可）
NEW_LAYERS = {
    "assets": "curated",
    "wiki-data": "curated",
    "community": "full_archive",
    "news-output": "output",
    # "unpacked" / "extracted" 层已随源数据退役（解包 text 层与 wiki 独占残件整删，守密人 2026-07-12 裁定）
    "resource": "curated",
    "projects": "curated",
}
# 全量大本体层：概念必须只放指针（文件小），防复刻 2.1G/44M 本体
POINTER_ONLY_SMALL = ("community", "news-output")

_ARCHIVE_PRESENT = (REPO / "Public-Info-Pool" / "Record" / "Community").exists()
_SPARSE_EXCLUDED = ("Public-Info-Pool/Record/", "Public-Info-Pool/Reference/")


def _fm(path: Path) -> dict:
    m = FM_RE.match(path.read_text(encoding="utf-8"))
    fields: dict = {}
    if not m:
        return fields
    for line in m.group(1).splitlines():
        if not line.strip() or line.startswith(" ") or ":" not in line:
            continue
        k, _, v = line.partition(":")
        k, v = k.strip(), v.strip()
        if v.startswith("[") and v.endswith("]"):
            fields[k] = [x.strip().strip('"') for x in v[1:-1].split(",") if x.strip()]
        else:
            fields[k] = v.strip('"')
    return fields


def _concepts(layer: str) -> list[Path]:
    d = BUNDLE / layer
    return [p for p in d.glob("*.md") if p.name not in RESERVED] if d.is_dir() else []


@pytest.mark.parametrize("layer", sorted(NEW_LAYERS))
def test_new_layer_has_concepts(layer):
    assert _concepts(layer), f"层 {layer} 无概念——run scripts/build_okf_bundle.py"


@pytest.mark.parametrize("layer,expected_dl", sorted(NEW_LAYERS.items()))
def test_layer_data_layer_discipline(layer, expected_dl):
    """每概念必带某 data_layer tag；非文档类概念须为该层主 data_layer（防 lesson #30）。

    文档/README 类概念（type=documentation）本体是策展文字，标 curated 属正当例外
    （如 extracted/ 的 README 与 full_archive 数据目录共存）。
    """
    for p in _concepts(layer):
        fm = _fm(p)
        tags = fm.get("tags", [])
        dl_tags = [t for t in tags if t.startswith("data_layer:")]
        assert dl_tags, f"{p} 无任何 data_layer tag（防 lesson #30）"
        if fm.get("type") != "documentation":
            assert f"data_layer:{expected_dl}" in tags, (
                f"{p} 缺 data_layer:{expected_dl}（实际 tags={tags}）"
            )


def test_news_output_declares_not_full():
    """输出展示层描述必须明示『非全量』，把消费者导回全量档案层。"""
    for p in _concepts("news-output"):
        desc = _fm(p).get("description", "")
        assert ("非全量" in desc or "抽样" in desc), f"{p} 输出层未声明抽样/非全量"


@pytest.mark.parametrize("layer", POINTER_ONLY_SMALL)
def test_pointer_only_bodies_are_small(layer):
    """全量大本体层：概念只放指针，文件必须小（未复刻 2.1G/44M 本体）。"""
    for p in _concepts(layer):
        size = p.stat().st_size
        assert size < 4096, f"{p} 过大（{size}B）——疑复刻了本体，违『放指针不放本体』"


@pytest.mark.parametrize("layer", sorted(NEW_LAYERS))
def test_resource_pointers_resolve(layer):
    """每个仓内 resource 指针落到实存本体（防指针落空）。"""
    for p in _concepts(layer):
        res = _fm(p).get("resource", "").strip()
        if not res.startswith("/"):
            continue
        rel = res.lstrip("/").split("#", 1)[0]
        if not _ARCHIVE_PRESENT and rel.startswith(_SPARSE_EXCLUDED):
            continue  # sparse checkout: archive layer excluded, skip like test_okf_bundle
        assert (REPO / rel).exists(), f"{p} 指针落空: {res}"


def test_community_covers_archive_and_index():
    """归档社区数据（头等诉求）：分析索引 + 平台概念 + 时序都在。"""
    ids = {p.stem for p in _concepts("community")}
    assert "community-index" in ids, "缺社区档案分析索引概念"
    assert "community-timeline" in ids, "缺社区时序概念"
    # 至少覆盖若干主流平台
    plats = {i for i in ids if i.startswith("community-") and i not in ("community-index", "community-timeline")}
    assert len(plats) >= 10, f"社区平台概念偏少（{len(plats)}）"


def test_cross_layer_platform_edges_exist():
    """跨层可导航：community/news-output ↔ sources 平台 join 边已建（rel_type=cross）。"""
    import json

    graph = json.loads((BUNDLE / "graph.json").read_text(encoding="utf-8"))
    cross = [e for e in graph["edges"] if e.get("rel_type") == "cross"]
    assert cross, "缺跨层 cross 边——新层沦为孤立节点"
    rels = {e["rel"] for e in cross}
    assert "同平台" in rels, "缺 community↔sources 平台 join 边"
    assert "聚合于" in rels, "缺 community 平台→索引 聚合边"


def test_no_blackpool_leak_in_pointers():
    """黑池防火墙同向：无概念指针指向黑池/内网源。"""
    forbidden = ("BIAV-BP", "black-pool-data", "svn://", "qoder-internal")
    for layer in NEW_LAYERS:
        for p in _concepts(layer):
            res = _fm(p).get("resource", "")
            assert not any(f in res for f in forbidden), f"{p} 指针疑触黑池: {res}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
