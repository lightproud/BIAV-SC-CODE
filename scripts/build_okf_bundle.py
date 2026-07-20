#!/usr/bin/env python3
"""Build an Open Knowledge Format (OKF v0.1) bundle for 银芯 (BIAV-SC).

OKF v0.1 (Google Cloud, 2026-06-12) represents knowledge as a directory of
markdown files with YAML frontmatter. Each non-reserved ``.md`` file is one
*concept* whose only required frontmatter field is ``type``; ``index.md`` and
``log.md`` are reserved. Spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

银芯定位说明（公开信息层，整层公开）：本 bundle 作为工程产物亦属公开信息，主供**内部消费**——
艾瑞卡人格、银芯→黑池单向接口、白嫖 OKF 静态可视化器，非以对外互操作为目标。三条铁律落地于此：
1. 一概念一文件（characters 层）；
2. **放指针不放本体**（sources/memory/story 层：``resource`` 指向仓内权威源，
   本体原地不动，呼应 RELEASES.md 「藏宝图」与 CLAUDE.md「只指针不复刻」）；
3. **全量档案层 vs 输出展示层语义不可互换**（sources 指针 concept 用 ``tags``
   显式标注 data_layer，防 lesson #30「把抽样当全量」复发）。

This is a *producer* (reproducible build artifact). 本体各自原地不动；本脚本只
生成 okf/ 目录。重跑覆盖。消费端工具（可视化器/搜索/agent）独立可换。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tarfile
from datetime import date
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"

sys.path.insert(0, str(REPO / "projects" / "news" / "scripts"))
import archive_layout  # noqa: E402  归档布局单一真相源（source 指针落点推导）
import build_kb_index  # noqa: E402  运行时导航索引生成器（消费本 bundle，跑在末尾）
import okf_pointer_layers as opl  # noqa: E402  全仓知识组织：新增指针概念层（放指针不放本体）
import silver_aliases  # noqa: E402  厚锚别名侧表（chunk3；缺表优雅返空，构建不炸）

CHARACTERS_SRC = REPO / "projects/wiki/data/processed/characters.json"
SOURCE_HEALTH = REPO / "projects/news/output/source-health.json"
NEWS_DATA = REPO / "projects/news/data"
STORY_DIR = REPO / "projects/wiki/data/processed/story"

TODAY = date.today().isoformat()

# ---------------------------------------------------------------------------
# YAML frontmatter helpers (minimal, dependency-free; OKF frontmatter is a
# small flat set of scalar/list fields so we hand-emit conformant YAML).
# ---------------------------------------------------------------------------

def _yaml_scalar(value: str) -> str:
    """Quote a scalar so it round-trips through any YAML parser."""
    s = str(value).replace("\r", " ").replace("\n", " ").strip()
    # Always double-quote; escape backslash and quote.
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def frontmatter(fields: dict) -> str:
    """Emit a YAML frontmatter block. ``type`` is required by OKF."""
    assert fields.get("type"), "OKF concept frontmatter MUST carry a non-empty 'type'"
    lines = ["---"]
    # priority order per OKF spec: type, title, description, resource, tags, timestamp
    order = ["type", "title", "description", "resource", "tags", "timestamp"]
    for key in order + [k for k in fields if k not in order]:
        if key not in fields:
            continue
        val = fields[key]
        if val is None or val == "" or val == []:
            continue
        if isinstance(val, list):
            inner = ", ".join(_yaml_scalar(v) for v in val)
            lines.append(f"{key}: [{inner}]")
        else:
            lines.append(f"{key}: {_yaml_scalar(val)}")
    lines.append("---")
    return "\n".join(lines)


def write_concept(path: Path, fields: dict, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter(fields) + "\n\n" + body.rstrip() + "\n", encoding="utf-8")


def write_plain(path: Path, body: str) -> None:
    """Reserved files (index.md / log.md) carry NO frontmatter."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.rstrip() + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Layer 1: characters (一概念一文件) — high-value wiki concept layer
# ---------------------------------------------------------------------------

def build_characters() -> int:
    data = json.loads(CHARACTERS_SRC.read_text(encoding="utf-8"))
    meta = data.get("_meta", {})
    chars = data.get("characters", [])
    ts = meta.get("generated", TODAY)
    if len(str(ts)) == 10:  # YYYY-MM-DD -> ISO datetime
        ts = f"{ts}T00:00:00Z"

    out_dir = BUNDLE / "characters"
    for c in chars:
        cid = c["id"]
        name = c.get("name") or c.get("title") or str(cid)
        characteristic = (c.get("characteristic") or "").strip()
        intro = (c.get("introduction") or "").strip()
        desc = " ".join(x for x in [characteristic, intro] if x)[:200] or name

        tags = [c.get("category")]
        if c.get("painter"):
            tags.append(f"画师:{c['painter']}")
        if c.get("voice_actor"):
            tags.append(f"CV:{c['voice_actor']}")
        if c.get("variant_of_name_prefix") is True:
            tags.append("变体")
        tags = [t for t in tags if t]

        fields = {
            "type": "character",
            "title": name,
            "description": desc,
            # pointer back to the structured source-of-truth (not a copy)
            "resource": f"/projects/wiki/data/processed/characters.json#{cid}",
            "tags": tags,
            "timestamp": ts,
        }

        # --- body ---
        rows = [
            ("游戏内 ID", cid),
            ("称号", c.get("title")),
            ("性别", c.get("gender")),
            ("生日", c.get("birthday")),
            ("身高", c.get("height")),
            ("体重", c.get("weight")),
            ("GI", c.get("gi")),
            ("声优", c.get("voice_actor")),
            ("画师", c.get("painter")),
            ("特性", characteristic),
            ("分类", c.get("category")),
            ("人工裁定", c.get("confirmed_by")),
            # 厚锚别名（侧表 aliases.json，chunk3）：已确认照列；未确认显式标注压权重
            # （不进 domain_dict / mention 边，仅浮出供检索与人工否决）。
            ("社区别名", "、".join(
                a["alias"] + ("" if a["confirmed"] else "（未确认）")
                for a in silver_aliases.aliases_for(cid, include_unconfirmed=True)
            ) or None),
        ]
        body = ["# 基础档案", "", "| 字段 | 值 |", "|------|------|"]
        for k, v in rows:
            if v not in (None, "", []):
                cell = str(v).replace("\n", " ").replace("|", "\\|")
                body.append(f"| {k} | {cell} |")

        if intro:
            body += ["", "# 简介", "", intro]
        if c.get("gameplay_intro"):
            body += ["", "# 玩法", "", c["gameplay_intro"].strip()]
        if c.get("summon_slogan"):
            body += ["", "# 召唤台词", "", f"> {c['summon_slogan'].strip()}"]

        ev = c.get("playable_evidence") or []
        if ev:
            body += ["", "# 可玩性证据", "", ", ".join(ev)]

        write_concept(out_dir / f"{cid}.md", fields, "\n".join(body))

    # characters/index.md (reserved, no frontmatter) grouped by category
    by_cat: dict[str, list[dict]] = {}
    for c in chars:
        by_cat.setdefault(c.get("category", "uncertain"), []).append(c)
    cat_label = {
        "playable": "正式可玩",
        "unreleased": "未上线",
        "easter_egg": "彩蛋 NPC",
        "boss": "纯敌方",
    }
    idx = [f"# 唤醒体角色 ({len(chars)})", "",
           f"源：`{CHARACTERS_SRC.relative_to(REPO)}`（解包基线）。每个角色一份 concept。", ""]
    for cat, items in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        idx.append(f"## {cat_label.get(cat, cat)} ({len(items)})")
        idx.append("")
        for c in sorted(items, key=lambda x: x["id"]):
            d = (c.get("characteristic") or "").strip().replace("\n", " ")
            idx.append(f"* [{c.get('name')}](/characters/{c['id']}.md) - {d}".rstrip(" -"))
        idx.append("")
    write_plain(out_dir / "index.md", "\n".join(idx))
    return len(chars)


# ---------------------------------------------------------------------------
# Layer 2: sources (放指针不放本体) — news data-layer pointer concepts
# ---------------------------------------------------------------------------

def build_sources() -> int:
    health = json.loads(SOURCE_HEALTH.read_text(encoding="utf-8"))
    platforms = health.get("platforms", {})
    updated = health.get("updated_at", TODAY)
    out_dir = BUNDLE / "sources"

    count = 0
    emitted: list[tuple[str, dict]] = []
    for name, info in sorted(platforms.items()):
        total = info.get("total_items", 0)
        level = info.get("level", "unknown")
        # full-archive layer location (本体原地，仅指针)。布局感知走 archive_layout
        # 单一真相源（2026-07-02 P0-1）：折叠源（official→steam/global/news 等）指向
        # 分层落点；回落顺序 = 分层落点 → 平级源目录 → 迁移前旧根 → 跳过。
        _plat, _region, _subtype = archive_layout.resolve_write_layout(name)
        rel_layered = "/".join(p for p in (_plat, _region, _subtype) if p)
        old_rel = "projects/news/data/discord" if name == "discord" \
            else f"projects/news/data/platforms/{name}"
        # 存在性检查经 archive_layout.community_root()（env BIAV_SC_DATA_ROOT 感知，分仓后随
        # 数据换位 data 仓；未设 env = 在树默认，逐字节等价旧行为）。指针字符串仍保**逻辑相对
        # 路径**（OKF 指针逻辑定位、不随物理仓变，计划 P2-3b 倾向）：门控用物理根、返回值用逻辑前缀。
        community = archive_layout.community_root()
        if rel_layered and (community / rel_layered).exists():
            archive = "/Public-Info-Pool/Record/Community/" + rel_layered + "/"
        elif (community / name).exists():
            archive = f"/Public-Info-Pool/Record/Community/{name}/"
        elif (REPO / old_rel).exists():
            archive = "/" + old_rel + "/"
        else:
            # 放指针不放本体：各布局均无此源档案 → 跳过，避免指针落空。
            continue
        output = f"/projects/news/output/{name}-latest.json"

        fields = {
            "type": "dataset",
            "title": f"{name} 社区数据源",
            "description": f"{name} 平台采集档案，全量 {total} 条，健康度 {level}。",
            "resource": archive,  # 指向全量档案层本体
            # data_layer 标签是硬纪律：消费端据此区分全量 vs 输出，防 lesson #30
            "tags": [f"data_layer:full_archive", f"platform:{name}", f"health:{level}"],
            "timestamp": updated,
        }
        body = [
            "# 数据层指针",
            "",
            "> 放指针不放本体：原始数据原地存放于 `resource`，本 concept 仅描述与定位。",
            "",
            "| 项 | 值 |",
            "|------|------|",
            f"| 平台 | {name} |",
            f"| 全量档案层（本体） | `{archive.lstrip('/')}` |",
            f"| 输出展示层（抽样） | `{output.lstrip('/')}` |",
            f"| 全量条数 | {total} |",
            f"| 采集健康度 | {level} |",
            f"| 最后成功 | {info.get('last_success_date', 'n/a')} |",
            "",
            "# 数据纪律（硬约束）",
            "",
            "- 长窗口分析 / 完整性审计 / 历史回溯 → **必须用全量档案层**（本 concept 的 `resource`）。",
            "- 日报展示 / 快查 / 热度榜 → 用输出展示层即可。",
            "- 两层语义**不可互换**（CLAUDE.md §4.1，lesson #30）。",
        ]
        write_concept(out_dir / f"{name}.md", fields, "\n".join(body))
        emitted.append((name, info))
        count += 1

    idx = [f"# 社区情报数据源 ({count})", "",
           f"源：`{SOURCE_HEALTH.relative_to(REPO)}`。每个平台一份**指针** concept；",
           "本体（JSONL/JSON 时序档案）原地不动，concept 仅持 `resource` 指针。",
           "注册表中尚无档案目录的平台（未落盘）不生成指针，避免指针落空。", "",
           "## 平台"]
    idx.append("")
    for name, info in emitted:
        idx.append(f"* [{name}](/sources/{name}.md) - 全量 {info.get('total_items', 0)} 条 / {info.get('level', '?')}")
    write_plain(out_dir / "index.md", "\n".join(idx))
    return count


# ---------------------------------------------------------------------------
# Layer 3 + 4: memory & story pointer concepts (放指针不放本体)
# ---------------------------------------------------------------------------

MEMORY_DOCS = [
    ("project-status.md", "knowledge-pointer", "子项目状态与实时进度（状态唯一权威）"),
    ("decisions.md", "knowledge-pointer", "决策日志（决策溯源权威 + 当前有效决策速览）"),
    ("decisions-archive.md", "knowledge-pointer", "决策归档层（长理由 + 已退役决策 + 编年史）"),
    ("strategic-plan-2026.md", "knowledge-pointer", "2026 战略规划"),
    ("methodology.md", "knowledge-pointer", "协作方法论"),
    ("lessons-learned.md", "knowledge-pointer", "踩坑记录（持续追加编号）"),
    ("contribution-protocol.md", "knowledge-pointer", "贡献协议 v1.0（已退役 2026-07-10：社区贡献取消，仅供追溯）"),
    ("style-guide.md", "knowledge-pointer", "视觉规范"),
    ("capability-index.md", "knowledge-pointer", "银芯全功能目录 + 动态编排可达性"),
    ("morimens-context.md", "knowledge-pointer", "世界观术语 + 历史时间线"),
]

STORY_POINTERS = [
    ("STORY_RESEARCH.md", "research", "剧情/世界观/神话原型深度研究综述（社区源，带置信标签）"),
    ("story_units.json", "dataset", "剧情单元脊柱（解包结构层，机器可读）"),
    ("lore_entries.json", "dataset", "1026 条 lore 含正文（解包结构层）"),
    ("index.json", "dataset", "章节↔lore↔关卡↔角色聚合索引"),
    ("character_story_links.json", "dataset", "角色↔剧情关联"),
]


def _story_stem(fname: str) -> str:
    """index.json 的 concept 落名须避让 OKF 保留名 index.md（层级索引），
    否则会被 build_story 末尾写的层级索引覆盖（2026-07-02 修复：5 写 4 存）。"""
    stem = fname.replace(".json", "").replace(".md", "")
    return "story_index" if stem == "index" else stem


def build_memory() -> int:
    out_dir = BUNDLE / "memory"
    count = 0
    for fname, typ, desc in MEMORY_DOCS:
        src = REPO / "memory" / fname
        if not src.exists():
            continue
        fields = {
            "type": typ,
            "title": fname,
            "description": desc,
            "resource": f"/memory/{fname}",  # 本体原地，仅指针
            "tags": ["memory", "pointer"],
            "timestamp": TODAY,
        }
        body = [
            "# 记忆层指针",
            "",
            f"> 放指针不放本体：正文权威在 `memory/{fname}`，本 concept 不复刻其内容。",
            "",
            f"- 本体路径：`memory/{fname}`",
            f"- 用途：{desc}",
        ]
        write_concept(out_dir / fname, fields, "\n".join(body))
        count += 1

    # --- 扩展：覆盖 memory/ 全层（顶层非白名单 md + 机器权威 json + active/archive/research/strategy）---
    whitelist = {fname for fname, _t, _d in MEMORY_DOCS}
    extra: list[tuple[str, str, str, str, list[str]]] = []  # (concept_id, title, resource, desc, tags)
    mem = REPO / "memory"

    def _md_entry(f: Path, cid: str, extra_tags: list[str]):
        title, blurb = opl.md_title_blurb(f)
        extra.append((cid, title or f.stem, opl._rel(f),
                      blurb or title or f.stem, ["memory", "data_layer:curated", *extra_tags]))

    for f in sorted(mem.glob("*.md")):  # 顶层非白名单
        if f.name in whitelist:
            continue
        _md_entry(f, f"memory-ext-{opl.slug(f.stem)}", [])
    for f in sorted(mem.glob("*.json")):  # 机器权威数据（capability-registry/annotations 等）
        meta = opl.json_meta(f)
        desc = meta.get("description") or meta.get("note") or f"{f.stem} 机器权威数据"
        extra.append((f"memory-ext-{opl.slug(f.stem)}", f.name, opl._rel(f), desc,
                      ["memory", "data_layer:curated", "machine-authority"]))
    for f in sorted((mem / "active").glob("*.md")):  # active hub 入口卡
        _md_entry(f, f"memory-ext-active-{opl.slug(f.stem)}", ["active-hub"])
    for f in sorted((mem / "archive").rglob("*.md")):  # 归档层（冻结快照）
        tags = ["archive", "frozen-snapshot"]
        low = f.stem.lower()
        if "bpt" in low or "bpt" in str(f.parent).lower():
            tags.append("bpt")
        if "blackpool" in low or "black-pool" in low or "blackpool" in str(f).lower():
            tags.append("blackpool-design")
        _md_entry(f, f"memory-archive-{opl.slug(str(f.relative_to(mem / 'archive').with_suffix('')))}", tags)
    for f in sorted((mem / "research").glob("*.md")):
        _md_entry(f, f"memory-research-{opl.slug(f.stem)}", ["research"])
    for f in sorted((mem / "strategy").glob("*.md")):
        _md_entry(f, f"memory-strategy-{opl.slug(f.stem)}", ["strategy"])

    seen_ids: set[str] = set()
    for cid, title, res, desc, tags in extra:
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        typ = "dataset" if res.endswith(".json") else "knowledge-pointer"
        write_concept(out_dir / f"{cid}.md", {
            "type": typ, "title": title, "description": desc[:240],
            "resource": res, "tags": tags, "timestamp": TODAY,
        }, "\n".join([
            "# 记忆层指针", "",
            f"> 放指针不放本体：正文权威在 `{res.lstrip('/')}`，本 concept 不复刻其内容。", "",
            f"- 本体路径：`{res.lstrip('/')}`", f"- 摘要：{desc[:240]}",
        ]))
        count += 1

    idx = [f"# 银芯记忆层指针 ({count})", "",
           "每张卡是一份**指针** concept，正文权威在 `memory/**`，此处不复刻。核心 10 份 + 全层扩展。", "",
           "## 核心档案", ""]
    for fname, _typ, desc in MEMORY_DOCS:
        if (REPO / "memory" / fname).exists():
            idx.append(f"* [{fname}](/memory/{fname}) - {desc}")
    idx += ["", "## 全层扩展（active / archive / research / strategy / 机器权威）", ""]
    idx_seen: set[str] = set()
    for cid, title, _res, desc, _tags in extra:
        if cid in idx_seen:
            continue
        idx_seen.add(cid)
        idx.append(f"* [{title}](/memory/{cid}.md) - {desc[:70]}".rstrip(" -"))
    write_plain(out_dir / "index.md", "\n".join(idx))
    return count


def build_story() -> int:
    out_dir = BUNDLE / "story"
    count = 0
    for fname, typ, desc in STORY_POINTERS:
        src = STORY_DIR / fname
        if not src.exists():
            continue
        rel = src.relative_to(REPO)
        fields = {
            "type": typ,
            "title": fname,
            "description": desc,
            "resource": f"/{rel}",
            "tags": ["story", "pointer", "data_layer:full_archive" if typ == "dataset" else "research"],
            "timestamp": TODAY,
        }
        body = [
            "# 剧情结构层指针",
            "",
            f"> 放指针不放本体：本体在 `{rel}`，本 concept 仅定位。",
            "",
            f"- 本体路径：`{rel}`",
            f"- 用途：{desc}",
        ]
        write_concept(out_dir / (_story_stem(fname) + ".md"), fields, "\n".join(body))
        count += 1

    # --- 扩展：覆盖 story/ 层剩余文件（检索索引 / lore_by_unit / stages_by_unit + README/RESEARCH_NOTES/TODO）---
    covered = {fname for fname, _t, _d in STORY_POINTERS}
    extra_story: list[tuple[str, str]] = []  # (concept_id, title)
    for f in sorted(STORY_DIR.glob("*.json")) + sorted(STORY_DIR.glob("*.md")):
        if f.name in covered:
            continue
        stem_id = _story_stem(f.name)
        if f.suffix == ".md":  # 前缀防与结构层撞名
            stem_id = "story_" + {"README": "layer_readme", "TODO": "research_todo",
                                  "RESEARCH_NOTES": "research_notes"}.get(f.stem, opl.slug(f.stem))
        if f.suffix == ".json":
            meta = opl.json_meta(f)
            desc = meta.get("purpose") or meta.get("method") or opl._first_total(meta) or f"{f.stem} 剧情结构层"
            typ, dl = "dataset", "data_layer:full_archive"
            tags = ["story", typ, dl]
        else:
            _t, desc = opl.md_title_blurb(f)
            typ = "documentation" if f.stem == "README" else "research"
            tags = ["story", typ, "data_layer:curated"]
            desc = desc or f"{f.stem} 剧情层文档"
        rel = f.relative_to(REPO)
        write_concept(out_dir / f"{stem_id}.md", {
            "type": typ, "title": f.name, "description": desc[:240],
            "resource": f"/{rel}", "tags": tags, "timestamp": TODAY,
        }, "\n".join([
            "# 剧情结构层指针", "",
            f"> 放指针不放本体：本体在 `{rel}`，本 concept 仅定位。", "",
            f"- 本体路径：`{rel}`", f"- 摘要：{desc[:240]}",
        ]))
        extra_story.append((stem_id, f.name))
        count += 1

    idx = [f"# 剧情/世界观层指针 ({count})", "",
           f"源目录：`{STORY_DIR.relative_to(REPO)}`。指针 concept，本体原地。", "", "## 档案", ""]
    for fname, _typ, desc in STORY_POINTERS:
        if (STORY_DIR / fname).exists():
            idx.append(f"* [{fname}](/story/{_story_stem(fname)}.md) - {desc}")
    for stem_id, title in extra_story:
        idx.append(f"* [{title}](/story/{stem_id}.md)")
    write_plain(out_dir / "index.md", "\n".join(idx))
    return count


# ---------------------------------------------------------------------------
# Bundle root: index.md / log.md / README.md
# ---------------------------------------------------------------------------

def build_root(counts: dict) -> None:
    idx = [
        "# 银芯 OKF Bundle",
        "",
        "银芯（BIAV-SC）知识层的 Open Knowledge Format (v0.1) 捆绑包。",
        "公开信息层（整层公开）；本 bundle 主供内部消费（艾瑞卡人格 / 银芯→黑池单向接口 / OKF 可视化器）。",
        "",
        "## 章节",
        "",
    ]
    # 章节动态列出所有层（原生 4 层 + 全仓知识组织新增层，2026-07-04）
    _LAYER_LABEL = {
        "characters": "角色 characters · 唤醒体 concept（一概念一文件）",
        "sources": "数据源 sources · 社区平台采集健康指针",
        "memory": "记忆 memory · 记忆层全层指针",
        "story": "剧情 story · 剧情结构层指针",
        "assets": "事实圣经 assets · 角色卡/采访/叙事/设计决策指针",
        "wiki-data": "wiki 数据 wiki-data · 解包自举结构化数据集指针",
        "community": "社区档案 community · 全量档案分析镜头（full_archive）",
        "news-output": "输出展示 news-output · 抽样展示层（output）",
        "unpacked": "解包 unpacked · 客户端一手 text 指针（full_archive）",
        "extracted": "解包上游 extracted · processed 权威上游（full_archive）",
        "resource": "产物 resource · 银芯正式报告/分析指针",
        "projects": "子项目 projects · CONTEXT/藏宝图/工程文档指针",
    }
    for layer, label in _LAYER_LABEL.items():
        if layer in counts:
            idx.append(f"* [{label.split(' · ')[0]}](/{layer}/index.md) - {counts[layer]} concept · {label.split(' · ',1)[1] if ' · ' in label else ''}")
    idx += [
        "",
        "## 运行时导航（LLM 可动态导航）",
        "",
        "`kb_index.json` 是本 bundle 的**运行时导航索引**（倒排表 + 邻接表，零 ML，",
        "由 `scripts/build_kb_index.py` 生成）。艾瑞卡经 MCP `kb_*` 工具",
        "（`kb_search` / `kb_get` / `kb_neighbors` / `kb_overview`，后端 `scripts/kb_navigator.py`）",
        "在运行时按需检索概念、取全档、顺关系图遍历——把静态知识层升级为可动态编排的知识库。",
        "",
        "## 变更史",
        "",
        "* [log.md](/log.md)",
    ]
    write_plain(BUNDLE / "index.md", "\n".join(idx))

    total = sum(counts.values())
    log_path = BUNDLE / "log.md"
    breakdown = " / ".join(f"{k} {v}" for k, v in counts.items())
    entry_today = (
        f"## {TODAY}\n\n"
        f"- **Creation** 由 `scripts/build_okf_bundle.py` 生成银芯 OKF v0.1 bundle，"
        f"共 {total} 份 concept（{breakdown}）。"
        f"角色层一概念一文件；其余层放指针不放本体（全仓知识组织 2026-07-04）。\n"
    )
    # log.md: newest first; preserve prior entries if re-run on a later date
    prior = ""
    if log_path.exists():
        existing = log_path.read_text(encoding="utf-8")
        # keep all non-today date sections, dropping same-day heading blocks to avoid dupes
        prior_sections = []
        for sec in existing.split("\n## "):
            sec = sec.strip()
            if not sec or sec.startswith("# "):
                continue
            if sec.startswith(TODAY):
                continue
            prior_sections.append("## " + sec)
        prior = ("\n\n".join(prior_sections) + "\n") if prior_sections else ""
    body = "# 变更史\n\n" + entry_today + ("\n" + prior if prior else "")
    write_plain(log_path, body)

    readme_fm = frontmatter({
        "type": "documentation",
        "title": "银芯 OKF Bundle README",
        "description": "本 bundle 的说明、银芯公开层定位、三条落地铁律与重生成方式。",
        "tags": ["meta", "documentation"],
        "timestamp": TODAY,
    })
    readme = f"""{readme_fm}

# 银芯 OKF Bundle —— README

本目录是银芯知识层的 **Open Knowledge Format (OKF v0.1)** 捆绑包。
OKF 是 Google Cloud 2026-06-12 发布的厂商中立开放规范：知识 = 一目录带
YAML frontmatter 的 markdown，每文件一 concept，唯一必填字段 `type`，
`index.md`/`log.md` 为保留名。规范：
https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

## 银芯定位（重要）

银芯为**公开信息层**（整层公开，守密人 2026-06-21 裁定；本 bundle 作为工程产物亦属公开信息）。
OKF 官方主卖点「跨组织互操作」对银芯打折——本 bundle 主供**内部消费**：艾瑞卡人格消费、
银芯→黑池单向接口的线格式候选、白嫖 OKF 静态可视化器看角色关系图，**非以对外互操作为目标**。

## 三条落地铁律

1. **一概念一文件**：`characters/` 层 72 角色，各自一份 concept。
2. **放指针不放本体**：`sources/` `memory/` `story/` 层只持 `resource` 指针，
   本体（JSONL 时序档案 / memory *.md / 解包 JSON）原地不动。呼应 RELEASES.md
   「藏宝图」与 CLAUDE.md「只指针不复刻」。
3. **全量 vs 输出层不可互换**：`sources/` 指针 concept 用 `tags: data_layer:*`
   显式标层，防 lesson #30「把抽样当全量」复发。

## 重新生成

```bash
python3 scripts/build_okf_bundle.py            # 仅重建 bundle
python3 scripts/build_okf_bundle.py --tarball okf-bundle.tar.gz  # 顺带导出单向输出物
```

生成物，重跑覆盖。本体各自原地不动。

## 消费：自包含可视化器

`okf/visualizer.html` 是一个**零后端、零安装、数据不离开页面**的单文件静态
关系图（对齐 OKF 消费端参考实现精神，自写零依赖力导向图）。双击直接在浏览器
打开即可：节点按 `type` 上色，角色按画师 / CV 聚类成簇，拖动 / 缩放 / 悬停看详情。
图数据另存 `okf/graph.json` 供其他消费端（搜索 / agent）取用。

## 消费：运行时导航（LLM 可动态导航的知识库）

`okf/kb_index.json` 是本 bundle 的**运行时导航索引**——倒排表（词→概念）+ 邻接表
（概念→邻居），由 `scripts/build_kb_index.py` 从 concept 元数据 + 正文 + `graph.json`
关系边生成（词典法分词，**确定性、零 ML、零常驻**）。艾瑞卡在唯一的运行时动态
平面（MCP）上经 `kb_*` 四工具动态导航（后端 `scripts/kb_navigator.py`）：

- `kb_search(query)` —— 按词检索概念，返回排序摘要 + `resource` 指针；
- `kb_get(concept_id)` —— 取单个概念全档（元数据 + 正文 + 邻居）；
- `kb_neighbors(concept_id)` —— 顺 OKF 关系图遍历邻居；
- `kb_overview()` —— 知识库楼层平面图（分区 / 类型 / 入口）。

思想溯源：OKF（一概念一文件 + 关系图）为底座，LLMwiki（LLM 顺图逐跳导航、按需
取概念）为消费范式。放指针不放本体：导航层只返回元信息 + 指针，本体仍原地不动。

## 银芯 → 黑池单向线格式

OKF 的「格式即契约，两端工具独立可换」正是银芯→黑池**单向输出**的理想载体：
黑池**无需银芯任何 SDK / 账号**即可消费本 bundle 的策展知识（concept + 指针）。
`--tarball` 产出 `.tar.gz` 即单向输出物（信息只出不回，黑池→银芯始终关闭）。
注意：仅**策展知识层**走此线，原始时序数据本体仍只放指针、不进 bundle。

## 一致性

`tests/test_okf_bundle.py` 校验 OKF v0.1 一致性（每个非保留 .md 带非空
`type`；保留文件无 frontmatter）。
"""
    write_plain(BUNDLE / "README.md", readme)


# ---------------------------------------------------------------------------
# Consumer: self-contained graph + static HTML visualizer
# (OKF consumer reference: zero-backend single file, data never leaves the page)
# ---------------------------------------------------------------------------

RESERVED = {"index.md", "log.md"}
_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_LINK_RE = re.compile(r"\]\((/[A-Za-z0-9_./-]+\.md)\)")


def _read_frontmatter(text: str) -> dict:
    m = _FM_RE.match(text)
    fields: dict = {}
    if not m:
        return fields
    for line in m.group(1).splitlines():
        if not line.strip() or line.startswith(" ") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if val.startswith("[") and val.endswith("]"):
            fields[key] = [v.strip().strip('"') for v in val[1:-1].split(",") if v.strip()]
        else:
            fields[key] = val.strip('"')
    return fields


# Deployed-page deep-links (verified live 200 on GitHub Pages). The visualizer is
# served at /kb/, so the JS prepends "../" to these site-root-relative paths.
_WIKI_AWAKENERS = REPO / "projects/wiki/docs/zh/awakeners"


def _node_url(rel: str) -> str | None:
    """Site-root-relative deep-link for a node id, or None if it has no public page.

    放指针不放本体的延伸：图节点只带跳转指针，本体仍在 wiki / news 原地渲染。
    """
    if rel.startswith("/characters/"):
        cid = rel[len("/characters/"):].removesuffix(".md")
        # 58/72 唤醒体有真实 wiki 页；无页的（未发布变体等）不给死链
        return f"wiki/zh/awakeners/{cid}" if (_WIKI_AWAKENERS / f"{cid}.md").exists() else None
    if rel.startswith("/story/"):
        return "wiki/story"
    if rel.startswith("/sources/"):
        return "news/"
    return None


def structural_parts(bundle: Path) -> "tuple[dict, set]":
    """返回 bundle 的**结构组件**（未哈希）：concept 映射 `rel → (type, resource, tags元组)`
    + 边集合 `{(source, target, rel_type)}`。只覆盖结构、排除易变量（timestamp/活计数）。

    暴露未哈希组件是为让治理测试做**子集**比对（守密人 2026-07-06 乙裁定：sources 层派生自
    每小时更新的社区档案，fresh 重建可合法地比 committed 多出概念，定时重建（丙）随后同步——
    治理测试改为「committed ⊆ fresh + 公共概念结构相等」，仍抓丢失/改名/结构变/非幂等，
    但容忍源集增长）。`structural_fingerprint` 仍在其上取整包哈希，供需精确相等的场景。
    """
    concepts: dict = {}
    for f in sorted(bundle.rglob("*.md")):
        if f.name in RESERVED:
            continue
        rel = "/" + str(f.relative_to(bundle))
        fm = _read_frontmatter(f.read_text(encoding="utf-8"))
        tags = tuple(sorted(fm.get("tags", []))) if isinstance(fm.get("tags"), list) else ()
        concepts[rel] = (fm.get("type", ""), fm.get("resource", ""), tags)
    edges: set = set()
    gp = bundle / "graph.json"
    if gp.exists():
        g = json.loads(gp.read_text(encoding="utf-8"))
        edges = {
            (e["source"], e["target"], e.get("rel_type", e.get("rel", "")))
            for e in g.get("edges", [])
        }
    return concepts, edges


def structural_fingerprint(bundle: Path) -> str:
    """规范化结构哈希：只覆盖**结构**（concept id→type/resource/排序 tags + 排序边），
    **排除易变量**（timestamp、描述里的活计数）。整包精确相等场景用；容忍增长的分层比对见
    `structural_parts` + 治理测试。哈希格式与历史一致（未哈希组件由 structural_parts 提供）。
    """
    import hashlib

    concepts_map, edges_set = structural_parts(bundle)
    concepts = sorted(
        [rel, t, r, list(tags)] for rel, (t, r, tags) in concepts_map.items()
    )
    edges = sorted([s, t, rt] for (s, t, rt) in edges_set)
    blob = json.dumps({"concepts": concepts, "edges": edges}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def build_graph() -> dict:
    """Scan the bundle into a {nodes, edges} graph for the visualizer.

    Edges are typed and *grounded* — no fabricated relationships:
      - ``variant``  本体↔异变/本源形态（角色名前缀干净推导，高信号）
      - ``lore``     同篇 lore 正文共现的角色（叙事关联，高信号）
      - ``cv``       同声优（弱信号，背景纹理）
      - ``link``     bundle 内显式 markdown 链接
    画师边被**刻意剔除**：全 72 角色同为「巴拉巴拉」，连成的是零区分度的噪声星。
    """
    nodes, edges = [], []
    id_set = set()
    bodies: dict[str, str] = {}
    resources: dict[str, str] = {}  # concept id -> resource 指针（供提及边扫正文源）

    for f in sorted(BUNDLE.rglob("*.md")):
        if f.name in RESERVED:
            continue
        rel = "/" + str(f.relative_to(BUNDLE))
        text = f.read_text(encoding="utf-8")
        fm = _read_frontmatter(text)
        bodies[rel] = text
        resources[rel] = fm.get("resource", "")
        id_set.add(rel)
        parts = rel.strip("/").split("/")
        node = {
            "id": rel,
            "type": fm.get("type", "unknown"),
            "title": fm.get("title", f.stem),
            "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
            # 两层结构（北极星 Pillar A）：skeleton 可遍历骨架 vs search 参考层
            "tier": build_kb_index.tier_of(parts[0] if len(parts) > 1 else ""),
        }
        url = _node_url(rel)
        if url:
            node["url"] = url
        nodes.append(node)

    # dedupe by unordered id-pair; higher-signal edge types win over lower.
    pair_seen: set[frozenset] = set()

    def add_edge(a: str, b: str, rel: str, rel_type: str) -> None:
        if a not in id_set or b not in id_set or a == b:
            return
        key = frozenset((a, b))
        if key in pair_seen:
            return
        pair_seen.add(key)
        edges.append({"source": a, "target": b, "rel": rel, "rel_type": rel_type})

    # explicit markdown-link edges (graph richness, if any)
    for src, text in bodies.items():
        for tgt in _LINK_RE.findall(text):
            add_edge(src, tgt, "link", "link")

    cnode = lambda cid: f"/characters/{cid}.md"
    cdata = json.loads(CHARACTERS_SRC.read_text(encoding="utf-8")).get("characters", [])
    by_name = {c["name"]: c for c in cdata if c.get("name")}

    # 1) variant edges — base ↔ variant/origin form (clean name-prefix derivation)
    for c in cdata:
        name = c.get("name", "")
        base = None
        if "·" in name:
            base = name.split("·", 1)[1]
        elif name.startswith("本源") and len(name) > 2:
            base = name[2:]
        if base and base in by_name and base != name:
            add_edge(cnode(c["id"]), cnode(by_name[base]["id"]), "变体", "variant")

    # 2) lore co-mention edges — two characters named in the same lore entry body
    lore_path = STORY_DIR / "lore_entries.json"
    if lore_path.exists():
        lore = json.loads(lore_path.read_text(encoding="utf-8")).get("entries", [])
        long_names = {n: c["id"] for n, c in by_name.items() if len(n) >= 2}
        from itertools import combinations
        for e in lore:
            blob = f"{e.get('title', '')} {e.get('desc') or ''} {e.get('lock_tip') or ''}"
            hit = sorted({n for n in long_names if n in blob})
            for a, b in combinations(hit, 2):
                add_edge(cnode(long_names[a]), cnode(long_names[b]), "同篇提及", "lore")

    # 3) CV cluster edges (demoted, faint) — same voice actor, star from rep
    cv_groups: dict[str, list[int]] = {}
    for c in cdata:
        if c.get("voice_actor"):
            cv_groups.setdefault(c["voice_actor"], []).append(c["id"])
    for cv, members in cv_groups.items():
        if len(members) < 2:
            continue
        rep = cnode(members[0])
        for m in members[1:]:
            add_edge(rep, cnode(m), f"CV:{cv}", "cv")

    # 提及边（Pillar A+，2026-07-04）：从策展正文里确定性抽「谁点名了谁」，把孤岛连进骨架。
    # 白盒办法做联想（区别于向量黑盒）：概念指向的正文源若字面点名某角色（distinctive
    # CJK 专名，≥2 字，最长优先），即建一条带类型 mention 边。
    # 3-甲（守密人 2026-07-05 裁定）：mention 边**不刻意排除社区档案**——原白名单把
    # Public-Info-Pool/Record/Community/ 挡在外，真实黑话进不了别名边。现允许社区归档
    # 作扫描源：文件指针直读（text 后缀），目录指针做**有界确定性抽样**（文件名字典序
    # 取最新 ≤3 个 text 文件、单文件 ≤500KB——只为让高频黑话可见，绝不全量扫归档本体）。
    # 每条边可解释可单测；只连「真被点名」的，天然防噪声星。
    _CURATED = ("memory/", "public-info-pool/resource/", "assets/",
                "projects/wiki/data/processed/story/", "projects/", "docs/",
                "claude.md", "readme.md", "releases.md")
    _COMMUNITY_REC = "public-info-pool/record/community/"
    _TEXT_SUFFIX = (".md", ".json", ".jsonl")
    _SCAN_SIZE_CAP = 500_000
    _ARCHIVE_SAMPLE_CAP = 3

    def _sample_archive_files(d: Path) -> list[Path]:
        files = [p for p in d.rglob("*")
                 if p.suffix in _TEXT_SUFFIX and p.is_file()]
        files.sort(key=lambda p: (p.name, str(p)))  # 文件名多为日期 → 尾部=最新
        return files[-_ARCHIVE_SAMPLE_CAP:]

    def _mention_texts(res: str) -> list[str]:
        """概念 resource 指针 → 可扫正文块（有界；读不了就返空，绝不炸构建）。"""
        low = res.lower()
        # 分仓桥接：community 资源本体随 archive_layout.community_root() 换位（env
        # BIAV_SC_DATA_ROOT）；指针字符串保逻辑（Public-Info-Pool/...），此处把逻辑前缀
        # 重定向到物理数据根，令 mention 扫描分仓后仍读到 archive 本体（否则边整批掉）。
        if low.startswith(_COMMUNITY_REC):
            src = archive_layout.community_root() / res[len(_COMMUNITY_REC):]
        else:
            src = REPO / res
        out: list[str] = []
        try:
            if low.startswith(_COMMUNITY_REC):
                if src.is_dir():
                    for p in _sample_archive_files(src):
                        if p.stat().st_size <= _SCAN_SIZE_CAP:
                            out.append(p.read_text(encoding="utf-8"))
                elif (src.suffix in _TEXT_SUFFIX and src.exists()
                      and src.stat().st_size <= _SCAN_SIZE_CAP):
                    out.append(src.read_text(encoding="utf-8"))
            elif low.endswith(".md") and any(low.startswith(p) for p in _CURATED):
                if src.exists() and src.stat().st_size <= _SCAN_SIZE_CAP:
                    out.append(src.read_text(encoding="utf-8"))
        except OSError:
            pass
        return out

    names_by_len = sorted((n for n in by_name if len(n) >= 2), key=len, reverse=True)
    # 别名提及边（chunk3 厚锚）：只用侧表**已确认**别名（未确认压权重、不进图）。
    # 拉丁别名按整词边界匹配（防 'Saya' 撞 'Sayaka' 之类子串误连）；CJK 别名照
    # 专名子串匹配。这就是「从只写别名的文档跳到角色概念」的关系腿（裁定 3-乙）。
    known_ids = {str(c["id"]) for c in cdata}
    alias_matchers: list[tuple[str, str, re.Pattern | None]] = []
    for alias, target in sorted(silver_aliases.alias_map(confirmed_only=True).items()):
        if target not in known_ids:
            continue
        if re.fullmatch(r"[A-Za-z0-9 .'\-]+", alias):
            pat = re.compile(
                rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", re.IGNORECASE)
            alias_matchers.append((alias, target, pat))
        else:
            alias_matchers.append((alias, target, None))

    for n in nodes:
        nid = n["id"]
        if nid.startswith("/characters/"):
            continue  # 角色源已由 variant/lore 连；不扫角色互提及
        res = (resources.get(nid, "") or "").lstrip("/")
        if not res:
            continue
        texts = _mention_texts(res)
        if not texts:
            continue
        text = "\n".join(texts)
        hit = 0
        for name in names_by_len:
            if name in text:
                add_edge(nid, cnode(by_name[name]["id"]), f"提及:{name}", "mention")
                hit += 1
                if hit >= 12:  # 单概念提及边封顶，防超大文档连成星
                    break
        for alias, target, pat in alias_matchers:
            if hit >= 12:
                break
            if pat.search(text) if pat else (alias in text):
                add_edge(nid, cnode(target), f"提及:{alias}", "mention")
                hit += 1

    # 模式化跨层关系边（全仓知识组织 2026-07-04）：让新增指针层可被 kb_neighbors 顺图导航，
    # 不沦为孤立节点。确定性 join，经 add_edge（#393 typed-edge + pair_seen 去重），rel_type=cross。
    for n in nodes:
        nid = n["id"]
        # platform join: sources ↔ community（同平台异镜头）/ sources ↔ news-output（抽样自）
        if nid.startswith("/sources/") and nid.endswith(".md"):
            p = opl.slug(nid[len("/sources/"):-3])
            add_edge(f"/community/community-{p}.md", nid, "同平台", "cross")
            add_edge(f"/news-output/news-output-{p}.md", nid, "抽样自", "cross")
        # community 平台概念 → 分析索引（aggregated_in）
        if (nid.startswith("/community/community-") and
                not nid.endswith(("community-index.md", "community-timeline.md"))):
            add_edge(nid, "/community/community-index.md", "聚合于", "cross")

    # bundle 总入口连边（评审：CLAUDE.md 概念须连入 graph 作总入口）：
    # CLAUDE.md ↔ README.md 双入口，且 CLAUDE.md → 各子项目 CONTEXT（动手前必读链）。
    add_edge("/projects/entry-claude-md.md", "/projects/entry-readme.md", "双入口", "cross")
    for n in nodes:
        if n["id"].startswith("/projects/project-"):
            add_edge("/projects/entry-claude-md.md", n["id"], "入口→上下文", "cross")

    return {
        "generated": TODAY,
        "stats": {"nodes": len(nodes), "edges": len(edges)},
        "nodes": nodes,
        "edges": edges,
    }


def build_visualizer(graph: dict) -> None:
    """Emit a single self-contained HTML force-graph (no backend, no install)."""
    (BUNDLE / "graph.json").write_text(
        json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    data = json.dumps(graph, ensure_ascii=False)
    html = _VISUALIZER_HTML.replace("__GRAPH_DATA__", data)
    (BUNDLE / "visualizer.html").write_text(html, encoding="utf-8")


_VISUALIZER_HTML = r"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>银芯 OKF Bundle — 关系图</title>
<style>
  html,body{margin:0;height:100%;background:#0c0e14;color:#cdd6f4;font-family:system-ui,sans-serif;overflow:hidden}
  #hud{position:fixed;top:10px;left:10px;z-index:10;font-size:13px;line-height:1.6;
       background:rgba(20,22,30,.85);padding:10px 12px;border:1px solid #2a2f40;border-radius:8px;max-width:260px}
  #hud b{color:#a6e3a1}
  .legend span{display:inline-block;margin:2px 6px 2px 0}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
  #tip{position:fixed;pointer-events:none;z-index:20;background:#181b26;border:1px solid #45475a;
       padding:6px 9px;border-radius:6px;font-size:12px;display:none;max-width:280px}
  canvas{display:block;touch-action:none}
</style>
</head>
<body>
<div id="hud">
  <div><b>银芯 OKF Bundle</b> 关系图</div>
  <div id="meta"></div>
  <div class="legend" id="legend"></div>
  <div class="legend" id="legendEdge" style="margin-top:4px"></div>
  <div style="margin-top:6px;color:#7f849c">桌面：拖动 / 滚轮缩放 / 悬停看详情<br>手机：单指拖动平移 / 双指捏合缩放<br><b style="color:#f9e2af">点/轻触节点进档案</b>（角色→Wiki，剧情→剧情档案，社区→情报）</div>
</div>
<div id="tip"></div>
<canvas id="c"></canvas>
<script>
const G = __GRAPH_DATA__;
const palette = ["#89b4fa","#a6e3a1","#f9e2af","#f38ba8","#cba6f7","#94e2d5","#fab387","#f5c2e7"];
const types = [...new Set(G.nodes.map(n=>n.type))];
const colorOf = t => palette[types.indexOf(t) % palette.length];
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let W,H,dpr=1; function resize(){dpr=Math.min(window.devicePixelRatio||1,2);W=innerWidth;H=innerHeight;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';} resize(); addEventListener('resize',resize);
document.getElementById('meta').textContent = `${G.stats.nodes} 概念 / ${G.stats.edges} 关系 · ${G.generated}`;
document.getElementById('legend').innerHTML = types.map(t=>`<span><i class="dot" style="background:${colorOf(t)}"></i>${t}</span>`).join('');

// typed edges: high-signal (variant/lore/link) drawn bold on top, cv faint below
const EDGE_STYLE = {
  variant:{color:"rgba(249,226,175,0.62)", w:2.2, z:1, label:"变体"},
  lore:   {color:"rgba(148,226,213,0.62)", w:2.0, z:1, label:"同篇提及"},
  link:   {color:"rgba(137,180,250,0.38)", w:1.4, z:1, label:"链接"},
  cross:  {color:"rgba(203,166,247,0.50)", w:1.6, z:1, label:"跨层"},
  mention:{color:"rgba(166,227,161,0.42)", w:1.4, z:1, label:"提及"},
  cv:     {color:"rgba(120,130,160,0.10)", w:1.0, z:0, label:"同声优"},
};
const es = t => EDGE_STYLE[t] || EDGE_STYLE.cv;
{
  const present = [...new Set(G.edges.map(e=>e.rel_type||'cv'))].sort((a,b)=>es(b).z-es(a).z);
  document.getElementById('legendEdge').innerHTML = present.map(t=>`<span style="color:#9aa0b5"><i style="display:inline-block;width:14px;height:0;border-top:2px solid ${es(t).color.replace(/0\.\d+/,'0.9')};margin-right:4px;vertical-align:middle"></i>${es(t).label}</span>`).join('');
}

const idx = new Map(G.nodes.map((n,i)=>[n.id,i]));
const N = G.nodes.map((n,i)=>({...n, x:W/2+Math.cos(i)*200+Math.random()*40, y:H/2+Math.sin(i)*200+Math.random()*40, vx:0, vy:0}));
const E = G.edges.map(e=>({s:idx.get(e.source), t:idx.get(e.target), rel:e.rel, rt:e.rel_type||'cv'})).filter(e=>e.s!=null&&e.t!=null);
E.sort((a,b)=>es(a.rt).z-es(b.rt).z);  // faint first, bold last (painted on top)
const deg = N.map(()=>0); E.forEach(e=>{deg[e.s]++;deg[e.t]++;});

let cam={x:0,y:0,k:1}, drag=null, pan=null;
function sim(){
  for(const n of N){n.vx*=0.85;n.vy*=0.85;}
  for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){
    let dx=N[i].x-N[j].x, dy=N[i].y-N[j].y, d2=dx*dx+dy*dy+0.01, d=Math.sqrt(d2);
    let f=1400/d2; if(d<1){d=1;} let fx=dx/d*f, fy=dy/d*f;
    N[i].vx+=fx;N[i].vy+=fy;N[j].vx-=fx;N[j].vy-=fy;
  }
  for(const e of E){
    let a=N[e.s],b=N[e.t],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01;
    let f=(d-90)*0.02,fx=dx/d*f,fy=dy/d*f;
    a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;
  }
  for(const n of N){let dx=W/2-n.x,dy=H/2-n.y;n.vx+=dx*0.0008;n.vy+=dy*0.0008;
    if(n!==(drag&&drag.node)){n.x+=n.vx;n.y+=n.vy;}}
}
function draw(){
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(cam.k*dpr,0,0,cam.k*dpr,cam.x*dpr,cam.y*dpr);
  for(const e of E){const st=es(e.rt);ctx.strokeStyle=st.color;ctx.lineWidth=st.w/cam.k;
    ctx.beginPath();ctx.moveTo(N[e.s].x,N[e.s].y);ctx.lineTo(N[e.t].x,N[e.t].y);ctx.stroke();}
  const showLabel = cam.k>0.5;
  for(let i=0;i<N.length;i++){const n=N[i],r=4+Math.min(deg[i],8)*0.9;
    ctx.beginPath();ctx.arc(n.x,n.y,r,0,7);ctx.fillStyle=colorOf(n.type);ctx.fill();
    if(n.url){ctx.lineWidth=1.6/cam.k;ctx.strokeStyle="rgba(249,226,175,0.55)";ctx.stroke();}
    if(showLabel||deg[i]>=3){ctx.fillStyle="rgba(205,214,244,0.82)";ctx.font=(11/cam.k).toFixed(2)+"px system-ui";
      ctx.fillText(n.title, n.x+r+3/cam.k, n.y+4/cam.k);}
  }
}
function loop(){sim();draw();requestAnimationFrame(loop);} loop();

function screenToWorld(mx,my){return {x:(mx-cam.x)/cam.k, y:(my-cam.y)/cam.k};}
function pick(mx,my,tol){const p=screenToWorld(mx,my);let best=null,bd=1e9;
  for(let i=0;i<N.length;i++){let dx=N[i].x-p.x,dy=N[i].y-p.y,d=dx*dx+dy*dy;
    if(d<bd){bd=d;best=i;}} return bd< ((tol||14)/cam.k)**2 ? best:null;}
const tip=document.getElementById('tip');
let down=null, moved=false;
cv.addEventListener('mousedown',e=>{const i=pick(e.clientX,e.clientY);down={x:e.clientX,y:e.clientY,i};moved=false;
  if(i!=null){drag={node:N[i]};}else{pan={x:e.clientX,y:e.clientY,cx:cam.x,cy:cam.y};}});
addEventListener('mousemove',e=>{
  if(down && Math.abs(e.clientX-down.x)+Math.abs(e.clientY-down.y)>4) moved=true;
  if(drag){const p=screenToWorld(e.clientX,e.clientY);drag.node.x=p.x;drag.node.y=p.y;drag.node.vx=0;drag.node.vy=0;}
  else if(pan){cam.x=pan.cx+(e.clientX-pan.x);cam.y=pan.cy+(e.clientY-pan.y);}
  const i=pick(e.clientX,e.clientY);
  cv.style.cursor = i==null ? 'default' : (N[i].url ? 'pointer' : 'grab');
  if(i!=null){const n=N[i];tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';
    tip.innerHTML=`<b>${n.title}</b><br><span style="color:#7f849c">${n.type}</span><br>${(n.tags||[]).join(' · ')}<br><span style="color:#585b70">${n.id}</span>`+(n.url?'<br><span style="color:#f9e2af">▸ 点击查看档案</span>':'');}
  else tip.style.display='none';});
addEventListener('mouseup',()=>{
  if(down && !moved && down.i!=null){const n=N[down.i]; if(n.url) window.open('../'+n.url,'_blank','noopener');}
  drag=null;pan=null;down=null;});
cv.addEventListener('wheel',e=>{e.preventDefault();const s=e.deltaY<0?1.1:0.9;
  const wx=(e.clientX-cam.x)/cam.k,wy=(e.clientY-cam.y)/cam.k;cam.k*=s;
  cam.x=e.clientX-wx*cam.k;cam.y=e.clientY-wy*cam.k;},{passive:false});

// ---- touch (mobile): 1-finger drag/pan + tap-to-open, 2-finger pinch zoom ----
function tpos(t){const r=cv.getBoundingClientRect();return {x:t.clientX-r.left,y:t.clientY-r.top};}
let tNode=null,tPan=null,pinch=null,tStart=null,tMoved=false;
cv.addEventListener('touchstart',e=>{e.preventDefault();
  if(e.touches.length===1){const p=tpos(e.touches[0]),i=pick(p.x,p.y,22);tStart={x:p.x,y:p.y,i};tMoved=false;
    if(i!=null){tNode=N[i];}else{tPan={x:p.x,y:p.y,cx:cam.x,cy:cam.y};}}
  else if(e.touches.length===2){tNode=null;tPan=null;tStart=null;
    const a=tpos(e.touches[0]),b=tpos(e.touches[1]);
    pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2};}
},{passive:false});
cv.addEventListener('touchmove',e=>{e.preventDefault();
  if(pinch&&e.touches.length===2){const a=tpos(e.touches[0]),b=tpos(e.touches[1]);
    const d=Math.hypot(a.x-b.x,a.y-b.y)||1,mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    const wx=(pinch.mx-cam.x)/cam.k,wy=(pinch.my-cam.y)/cam.k;   // world point under midpoint
    cam.k=Math.max(0.15,Math.min(6,cam.k*(d/pinch.d)));
    cam.x=mx-wx*cam.k;cam.y=my-wy*cam.k;                          // keep it under fingers + follow drift
    pinch.d=d;pinch.mx=mx;pinch.my=my;}
  else if(e.touches.length===1){const p=tpos(e.touches[0]);
    if(tStart&&Math.abs(p.x-tStart.x)+Math.abs(p.y-tStart.y)>6)tMoved=true;
    if(tNode){const w=screenToWorld(p.x,p.y);tNode.x=w.x;tNode.y=w.y;tNode.vx=0;tNode.vy=0;}
    else if(tPan){cam.x=tPan.cx+(p.x-tPan.x);cam.y=tPan.cy+(p.y-tPan.y);}}
},{passive:false});
cv.addEventListener('touchend',e=>{
  if(tStart&&!tMoved&&tStart.i!=null){const n=N[tStart.i];if(n.url)window.open('../'+n.url,'_blank','noopener');}
  if(e.touches.length===0){tNode=null;tPan=null;pinch=null;tStart=null;}
},{passive:false});
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# 银芯 → 黑池 single-direction wire format: pack the bundle as a tarball
# (信息单向输出；黑池不回流。云容器无 Releases 写权限，故落普通文件路径)
# ---------------------------------------------------------------------------

def export_tarball(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(dest, "w:gz") as tar:
        tar.add(BUNDLE, arcname="okf")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser(description="Build 银芯 OKF v0.1 bundle.")
    ap.add_argument("--tarball", metavar="PATH",
                    help="额外打包 bundle 为 .tar.gz（银芯→黑池单向输出物）")
    args = ap.parse_args()

    if BUNDLE.exists():
        shutil.rmtree(BUNDLE)
    BUNDLE.mkdir(parents=True)
    counts = {
        "characters": build_characters(),
        "sources": build_sources(),
        "memory": build_memory(),
        "story": build_story(),
    }
    # 全仓知识组织（2026-07-04）：在 4 个原生层之后追加覆盖全仓知识域的指针层。
    new_counts, discipline_flags = opl.build_all()
    counts.update(new_counts)
    build_root(counts)
    graph = build_graph()
    build_visualizer(graph)
    # 运行时导航层底座：扫描刚生成的 bundle（concept + graph）造 kb_index.json。
    # 必须跑在 build_visualizer 之后（依赖 graph.json）、tarball 之前（随单向输出物一起走）。
    kb = build_kb_index.build_kb_index()
    total = sum(counts.values())
    print(f"OKF bundle built at {BUNDLE.relative_to(REPO)}/")
    for k, v in counts.items():
        print(f"  {k}: {v} concepts")
    print(f"  total: {total} concepts")
    print(f"  graph: {graph['stats']['nodes']} nodes / {graph['stats']['edges']} edges")
    print(f"  visualizer: okf/visualizer.html (self-contained)")
    print(f"  kb_index: okf/kb_index.json ({kb['stats']['concepts']} concepts / "
          f"{kb['stats']['terms']} terms — 运行时导航底座)")
    if discipline_flags:
        print(f"  discipline flags ({len(discipline_flags)}):")
        for fl in discipline_flags:
            print(f"    ! {fl}")
    if args.tarball:
        out = export_tarball(Path(args.tarball))
        size = out.stat().st_size
        print(f"  tarball: {out} ({size} bytes) — 银芯→黑池单向输出物")


if __name__ == "__main__":
    main()
