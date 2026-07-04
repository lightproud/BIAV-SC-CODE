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

    fresh = bok.structural_fingerprint(tmp_bundle)
    committed = bok.structural_fingerprint(REPO / "okf")
    assert fresh == committed, (
        "committed okf/ 的结构与源重建不一致——请 `python3 scripts/build_okf_bundle.py` 重建并提交"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
