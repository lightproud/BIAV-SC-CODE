"""KB 治理不变量（Pillar B）—— 白盒 = 唯一能写测试/程序操作的知识。

守密人 2026-07-04 北极星（`memory/knowledge-layer-design.md`）命令二「把不变量测起来」的落地。
这些是**生成器假设绊线**：生成器里硬编码了领域映射（_WIKI_DOMAIN / _UNPACKED_ALIAS /
memory 白名单 / STORY_POINTERS），repo 一长它们会**和现实静默脱节**——优雅降级的另一面是
静默丢真。本组测试把「映射脱节」变成 CI 硬报错，守的是「维护者自己」。

零重建：只读已 committed 的 okf/ + 硬编码映射 + 磁盘实况对账。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO / "projects" / "news" / "scripts"))

import build_okf_bundle as bok  # noqa: E402
import okf_pointer_layers as opl  # noqa: E402

RESERVED = {"index.md", "log.md"}
FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _tags(path: Path) -> list[str]:
    m = FM_RE.match(path.read_text(encoding="utf-8"))
    if not m:
        return []
    for line in m.group(1).splitlines():
        if line.startswith("tags:"):
            v = line.partition(":")[2].strip()
            if v.startswith("[") and v.endswith("]"):
                return [x.strip().strip('"') for x in v[1:-1].split(",") if x.strip()]
    return []


def _concepts(layer: str) -> list[Path]:
    d = BUNDLE / layer
    return [p for p in d.glob("*.md") if p.name not in RESERVED] if d.is_dir() else []


# --- 绊线 1：wiki-data 领域映射不脱节（无兜底 domain:misc） -----------------

def test_no_wiki_data_domain_misc():
    """任一 wiki-data 概念落到 domain:misc = _WIKI_DOMAIN 映射漏了新数据集，须补映射。"""
    offenders = [p.name for p in _concepts("wiki-data")
                 if "domain:misc" in _tags(p)]
    assert offenders == [], (
        f"wiki-data 概念落入兜底 domain:misc（_WIKI_DOMAIN 映射脱节，补 okf_pointer_layers._WIKI_DOMAIN）：{offenders}"
    )


def test_wiki_domain_map_keys_exist():
    """_WIKI_DOMAIN 的键必须对应实存的 processed/*.json（防映射引用已消失的文件）。"""
    pdir = REPO / "projects" / "wiki" / "data" / "processed"
    stale = sorted(k for k in opl._WIKI_DOMAIN if not (pdir / f"{k}.json").exists())
    assert stale == [], f"_WIKI_DOMAIN 含已消失文件的键（清理）：{stale}"


# --- 绊线 2：unpacked 别名/slug 不脱节 --------------------------------------

def test_unpacked_ids_well_formed():
    """每个 unpacked 概念 id 是干净 slug（非空、非退化），防中文目录 slug 成乱码。"""
    bad = []
    for p in _concepts("unpacked"):
        stem = p.stem
        assert stem.startswith("unpacked-"), stem
        tail = stem[len("unpacked-"):]
        if not tail or not re.fullmatch(r"[0-9a-z][0-9a-z-]*", tail):
            bad.append(p.name)
    assert bad == [], f"unpacked 概念 id 退化（补 _UNPACKED_ALIAS 别名）：{bad}"


def test_unpacked_alias_keys_exist():
    """_UNPACKED_ALIAS 的键必须对应实存的 Game-Unpacked 子目录。"""
    root = REPO / "Public-Info-Pool" / "Reference" / "Game-Unpacked"
    if not root.is_dir():
        pytest.skip("Game-Unpacked 缺席（sparse checkout）")
    stale = sorted(k for k in opl._UNPACKED_ALIAS if not (root / k).is_dir())
    assert stale == [], f"_UNPACKED_ALIAS 含已消失目录的键（清理）：{stale}"


# --- 绊线 3：memory 白名单 ⊆ 实况，且扩展层不与白名单重复 -------------------

def test_memory_whitelist_all_exist():
    """build_okf_bundle.MEMORY_DOCS（核心 10 白名单）文件必须都实存。"""
    missing = sorted(f for f, _t, _d in bok.MEMORY_DOCS
                     if not (REPO / "memory" / f).exists())
    assert missing == [], f"MEMORY_DOCS 白名单含不存在文件：{missing}"


def test_memory_extension_disjoint_from_whitelist():
    """扩展 memory 概念（memory-ext-* / memory-archive-* 等）不得与核心白名单概念同名，
    防同一文档被登记两次（白名单走 fname.md、扩展走 id.md，命名空间必须不撞）。"""
    whitelist_stems = {f.replace(".md", "") for f, _t, _d in bok.MEMORY_DOCS}
    ext_stems = {p.stem for p in _concepts("memory") if p.stem.startswith(("memory-ext-", "memory-archive-", "memory-research-", "memory-strategy-"))}
    assert whitelist_stems.isdisjoint(ext_stems), (
        f"memory 扩展概念与白名单撞名：{whitelist_stems & ext_stems}"
    )


# --- 绊线 4：声明的层都生成了且非空（build_all 无静默丢层） ------------------

def test_all_declared_layers_present_and_nonempty():
    """okf_pointer_layers.build_all 声明的每层都必须在 bundle 里有概念。"""
    declared = ["assets", "wiki-data", "community", "news-output", "unpacked", "extracted", "resource", "projects"]
    empty = [layer for layer in declared if not _concepts(layer)]
    assert empty == [], f"声明的层为空（生成器静默丢层）：{empty}"


# --- 绊线 5：story 白名单 ⊆ 实况 --------------------------------------------

def test_story_pointer_whitelist_exists():
    stale = sorted(f for f, _t, _d in bok.STORY_POINTERS
                   if not (bok.STORY_DIR / f).exists())
    assert stale == [], f"STORY_POINTERS 含不存在文件：{stale}"


# --- 绊线 6（keystone）：committed bundle 的结构 == 源重建的结构 -------------

def test_structural_fingerprint_deterministic():
    """结构指纹是纯函数：同一 bundle 连算两次必相同（锁哈希机制）。"""
    fp1 = bok.structural_fingerprint(BUNDLE)
    fp2 = bok.structural_fingerprint(BUNDLE)
    assert fp1 == fp2 and len(fp1) == 64


def test_committed_bundle_structure_matches_sources(tmp_path, monkeypatch):
    """把 bundle 重建进临时目录，其**结构指纹**必须等于已 committed okf/ 的结构指纹。

    失败=有人改了源结构却忘重建（stale commit），或生成器非幂等。排除易变量（时间戳/活计数）
    故不会被每日漂移误报。sparse checkout（归档层缺席）下重建会少 community/unpacked/extracted，跳过。
    """
    if not (REPO / "Public-Info-Pool" / "Record" / "Community").exists():
        pytest.skip("归档层缺席（sparse checkout）——重建会少层，无法对账结构")

    import build_kb_index as bki

    tmp_bundle = tmp_path / "okf"
    monkeypatch.setattr(bok, "BUNDLE", tmp_bundle)
    monkeypatch.setattr(opl, "BUNDLE", tmp_bundle)
    monkeypatch.setattr(bki, "BUNDLE", tmp_bundle)
    monkeypatch.setattr(bki, "INDEX_PATH", tmp_bundle / "kb_index.json")
    tmp_bundle.mkdir(parents=True)

    # 复刻 main() 的构建序列（改动 main 序列时同步此处）
    counts = {
        "characters": bok.build_characters(),
        "sources": bok.build_sources(),
        "memory": bok.build_memory(),
        "story": bok.build_story(),
    }
    new_counts, _flags = opl.build_all()
    counts.update(new_counts)
    bok.build_root(counts)
    graph = bok.build_graph()
    bok.build_visualizer(graph)
    bki.build_kb_index()

    # 守密人 2026-07-06「乙+丙」裁定：sources 层派生自每小时更新的社区档案，fresh 重建可
    # 合法地比 committed 多出概念/边（新平台/新档案），定时重建（丙，build-okf-bundle.yml
    # 的每日 cron）随后把 committed 同步上来。故本测试从「整包精确相等」放宽为**子集**比对：
    # 容忍源集增长（committed ⊆ fresh），但仍抓真回归——committed 概念从 fresh 缺失
    # （丢失/改名）、公共概念结构不一致（type/resource/tags 变、生成器非幂等）、committed
    # 边从 fresh 缺失。锁「已有不丢/不变」，不锁「不许新增」。
    fresh_c, fresh_e = bok.structural_parts(tmp_bundle)
    committed_c, committed_e = bok.structural_parts(REPO / "okf")

    dropped = sorted(k for k in committed_c if k not in fresh_c)
    assert not dropped, (
        "committed 概念在源重建中消失（丢失/改名）——需 `python3 scripts/build_okf_bundle.py` "
        f"重建并提交：{dropped[:10]}"
    )
    changed = sorted(
        k for k in committed_c if k in fresh_c and committed_c[k] != fresh_c[k]
    )
    assert not changed, (
        "committed 概念结构与源重建不一致（type/resource/tags 变或生成器非幂等）——需重建："
        f"{changed[:10]}"
    )
    # `mention` 边（community/sources → 角色）是内容派生的：哪个角色被社区文本提及随每小时
    # 档案更新而双向 churn（掉几条、长几条），不是结构。故边子集检查排除 mention，只锁
    # **结构边**（层骨架 / 角色关系 / 抽样自 / 聚合自 等）不丢。
    committed_stable_e = {e for e in committed_e if e[2] != "mention"}
    fresh_stable_e = {e for e in fresh_e if e[2] != "mention"}
    dropped_edges = sorted(committed_stable_e - fresh_stable_e)
    assert not dropped_edges, (
        f"committed 结构边在源重建中消失——需 `python3 scripts/build_okf_bundle.py` 重建：{dropped_edges[:10]}"
    )


# --- 绊线 7：两层结构（北极星 Pillar A，选项 1）显式且骨架真连通 ----------

def _graph() -> dict:
    import json
    return json.loads((BUNDLE / "graph.json").read_text(encoding="utf-8"))


def test_every_node_has_consistent_tier():
    """每节点带 tier，且与 SKELETON_LAYERS 声明一致（tier 是白盒对自身形状的显式声明）。"""
    import build_kb_index as bki
    bad = []
    for n in _graph()["nodes"]:
        layer = n["id"].strip("/").split("/")[0]
        expected = "skeleton" if layer in bki.SKELETON_LAYERS else "search"
        if n.get("tier") != expected:
            bad.append((n["id"], n.get("tier"), expected))
    assert bad == [], f"tier 标注与 SKELETON_LAYERS 声明不一致：{bad[:5]}"


def test_skeleton_is_actually_connected():
    """骨架层必须**真的**是网络：连通率不得跌破 60%（否则骨架名不副实）。

    参考层（search）孤立是**有意**的（选项 1：不强连大容器成员=噪声星），故不对其连通性设限——
    本测试把「200/293 孤立」从『缺陷指标』锁成『骨架连通 + 参考层有意孤立』的设计属性。
    """
    import collections
    g = _graph()
    deg = collections.Counter()
    for e in g["edges"]:
        deg[e["source"]] += 1
        deg[e["target"]] += 1
    skel = [n for n in g["nodes"] if n.get("tier") == "skeleton"]
    connected = sum(1 for n in skel if deg[n["id"]] > 0)
    assert skel, "无骨架节点"
    ratio = connected / len(skel)
    assert ratio >= 0.60, (
        f"骨架连通率 {ratio:.0%} < 60%——骨架名不副实（skeleton 应为真可遍历网络）"
    )


# --- 绊线 8：提及边（Pillar A+）存在、高信号、连回角色 ------------------------

def test_mention_edges_are_high_signal():
    """提及边必须真高信号：目标是角色，且源正文确实字面点名该角色（非误连）。"""
    import json

    g = _graph()
    mentions = [e for e in g["edges"] if e.get("rel_type") == "mention"]
    assert len(mentions) >= 20, f"提及边过少（{len(mentions)}），A+ 抽取疑失效"
    # 全部指向角色概念
    for e in mentions:
        tgt = e["source"] if e["source"].startswith("/characters/") else e["target"]
        assert tgt.startswith("/characters/"), f"提及边未连回角色：{e}"
    # 抽 5 条核验源正文确实点名（rel 形如 "提及:沙耶"）
    concepts = json.loads((BUNDLE / "kb_index.json").read_text(encoding="utf-8"))["concepts"]
    checked = 0
    for e in mentions:
        name = e["rel"].split(":", 1)[1] if ":" in e["rel"] else ""
        # 提及边恒为 非角色源 → 角色；取非角色端为源概念
        src_concept = e["source"] if not e["source"].startswith("/characters/") else e["target"]
        res = concepts.get(src_concept, {}).get("resource", "").lstrip("/")
        p = REPO / res
        if name and res.endswith(".md") and p.exists():
            assert name in p.read_text(encoding="utf-8"), f"提及边误连：{res} 未点名 {name}"
            checked += 1
        if checked >= 5:
            break
    assert checked >= 3, "无法抽验足够提及边的高信号性"


def test_islands_reduced_by_mention_edges():
    """提及边应显著压低孤立率（守密人 Q2：孤岛其实有据可连）。"""
    import collections

    g = _graph()
    deg = collections.Counter()
    for e in g["edges"]:
        deg[e["source"]] += 1
        deg[e["target"]] += 1
    iso = sum(1 for n in g["nodes"] if deg[n["id"]] == 0)
    ratio = iso / len(g["nodes"])
    assert ratio < 0.50, f"孤立率 {ratio:.0%} 偏高——提及边抽取疑退化（应 <50%）"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
