#!/usr/bin/env python3
"""Build an Open Knowledge Format (OKF v0.1) bundle for 银芯 (BIAV-SC).

OKF v0.1 (Google Cloud, 2026-06-12) represents knowledge as a directory of
markdown files with YAML frontmatter. Each non-reserved ``.md`` file is one
*concept* whose only required frontmatter field is ``type``; ``index.md`` and
``log.md`` are reserved. Spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

银芯定位说明（受限/非公开层）：本 bundle 面向**内部消费**——艾瑞卡人格、
银芯→黑池单向接口、白嫖 OKF 静态可视化器，而非对外互操作。三条铁律落地于此：
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
from datetime import date, datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"

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
        # full-archive layer location (本体原地，仅指针)。双布局感知：迁移后
        # 在 Public-Info-Pool/Record/Community，迁移前回落旧 projects/news/data。
        new_rel = f"Public-Info-Pool/Record/Community/{name}"
        old_rel = "projects/news/data/discord" if name == "discord" \
            else f"projects/news/data/platforms/{name}"
        if (REPO / new_rel).exists():
            archive = "/" + new_rel + "/"
        elif (REPO / old_rel).exists():
            archive = "/" + old_rel + "/"
        else:
            # 放指针不放本体：两布局均无此源档案 → 跳过，避免指针落空。
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
    ("contribution-protocol.md", "knowledge-pointer", "贡献协议 v1.0"),
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

    idx = [f"# 银芯记忆层指针 ({count})", "",
           "每张卡是一份**指针** concept，正文权威在 `memory/*.md`，此处不复刻。", "",
           "## 档案"]
    idx.append("")
    for fname, _typ, desc in MEMORY_DOCS:
        if (REPO / "memory" / fname).exists():
            idx.append(f"* [{fname}](/memory/{fname}) - {desc}")
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
        write_concept(out_dir / (fname.replace(".json", "").replace(".md", "") + ".md"), fields, "\n".join(body))
        count += 1

    idx = [f"# 剧情/世界观层指针 ({count})", "",
           f"源目录：`{STORY_DIR.relative_to(REPO)}`。指针 concept，本体原地。", "", "## 档案", ""]
    for fname, _typ, desc in STORY_POINTERS:
        if (STORY_DIR / fname).exists():
            stem = fname.replace(".json", "").replace(".md", "")
            idx.append(f"* [{fname}](/story/{stem}.md) - {desc}")
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
        "受限/非公开层，面向内部消费（艾瑞卡人格 / 银芯→黑池单向接口 / OKF 可视化器）。",
        "",
        "## 章节",
        "",
        f"* [角色 characters](/characters/index.md) - {counts['characters']} 个唤醒体 concept（一概念一文件）",
        f"* [数据源 sources](/sources/index.md) - {counts['sources']} 个社区平台**指针** concept",
        f"* [记忆 memory](/memory/index.md) - {counts['memory']} 份记忆层**指针** concept",
        f"* [剧情 story](/story/index.md) - {counts['story']} 份剧情结构层**指针** concept",
        "",
        "## 变更史",
        "",
        "* [log.md](/log.md)",
    ]
    write_plain(BUNDLE / "index.md", "\n".join(idx))

    total = sum(counts.values())
    log_path = BUNDLE / "log.md"
    entry_today = (
        f"## {TODAY}\n\n"
        f"- **Creation** 由 `scripts/build_okf_bundle.py` 生成银芯 OKF v0.1 bundle，"
        f"共 {total} 份 concept（角色 {counts['characters']} / 数据源 {counts['sources']} / "
        f"记忆 {counts['memory']} / 剧情 {counts['story']}）。"
        f"角色层一概念一文件；其余层放指针不放本体。\n"
    )
    # log.md: newest first; preserve prior entries if re-run on a later date
    prior = ""
    if log_path.exists():
        existing = log_path.read_text(encoding="utf-8")
        # drop a same-day heading block to avoid dupes, keep older ones
        blocks = [b for b in existing.split("\n## ") if b.strip()]
        kept = []
        for i, b in enumerate(blocks):
            head = b if i == 0 else "## " + b
            head = head.lstrip("# ").strip()
            if head.startswith(TODAY):
                continue
            kept.append(b if b.startswith("## ") or i == 0 else "## " + b)
        # simpler: just re-read non-today date sections
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
        "description": "本 bundle 的说明、银芯受限层定位、三条落地铁律与重生成方式。",
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

银芯是**受限/非公开层**。OKF 官方主卖点「跨组织互操作」对银芯打折——
本 bundle 面向**内部**：艾瑞卡人格消费、银芯→黑池单向接口的线格式候选、
白嫖 OKF 静态可视化器看角色关系图。**不对外发布**。

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


def build_graph() -> dict:
    """Scan the bundle into a {nodes, edges} graph for the visualizer."""
    nodes, edges = [], []
    id_set = set()
    bodies: dict[str, str] = {}
    fm_by_id: dict[str, dict] = {}

    for f in sorted(BUNDLE.rglob("*.md")):
        if f.name in RESERVED:
            continue
        rel = "/" + str(f.relative_to(BUNDLE))
        text = f.read_text(encoding="utf-8")
        fm = _read_frontmatter(text)
        fm_by_id[rel] = fm
        bodies[rel] = text
        id_set.add(rel)
        nodes.append({
            "id": rel,
            "type": fm.get("type", "unknown"),
            "title": fm.get("title", f.stem),
            "tags": fm.get("tags", []) if isinstance(fm.get("tags"), list) else [],
        })

    # explicit markdown-link edges (graph richness, if any)
    seen = set()
    for src, text in bodies.items():
        for tgt in _LINK_RE.findall(text):
            if tgt in id_set and tgt != src and (src, tgt) not in seen:
                seen.add((src, tgt))
                edges.append({"source": src, "target": tgt, "rel": "link"})

    # tag-cluster star edges (画师 / CV) — keeps角色 grouped without edge blow-up
    groups: dict[str, list[str]] = {}
    for n in nodes:
        for t in n["tags"]:
            if t.startswith("画师:") or t.startswith("CV:"):
                groups.setdefault(t, []).append(n["id"])
    for tag, members in groups.items():
        if len(members) < 2:
            continue
        rep = members[0]
        for m in members[1:]:
            edges.append({"source": rep, "target": m, "rel": tag})

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
<title>银芯 OKF Bundle — 关系图</title>
<style>
  html,body{margin:0;height:100%;background:#0c0e14;color:#cdd6f4;font-family:system-ui,sans-serif}
  #hud{position:fixed;top:10px;left:10px;z-index:10;font-size:13px;line-height:1.6;
       background:rgba(20,22,30,.85);padding:10px 12px;border:1px solid #2a2f40;border-radius:8px;max-width:260px}
  #hud b{color:#a6e3a1}
  .legend span{display:inline-block;margin:2px 6px 2px 0}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
  #tip{position:fixed;pointer-events:none;z-index:20;background:#181b26;border:1px solid #45475a;
       padding:6px 9px;border-radius:6px;font-size:12px;display:none;max-width:280px}
  canvas{display:block}
</style>
</head>
<body>
<div id="hud">
  <div><b>银芯 OKF Bundle</b> 关系图</div>
  <div id="meta"></div>
  <div class="legend" id="legend"></div>
  <div style="margin-top:6px;color:#7f849c">拖动节点 / 滚轮缩放 / 悬停看详情</div>
</div>
<div id="tip"></div>
<canvas id="c"></canvas>
<script>
const G = __GRAPH_DATA__;
const palette = ["#89b4fa","#a6e3a1","#f9e2af","#f38ba8","#cba6f7","#94e2d5","#fab387","#f5c2e7"];
const types = [...new Set(G.nodes.map(n=>n.type))];
const colorOf = t => palette[types.indexOf(t) % palette.length];
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
let W,H; function resize(){W=cv.width=innerWidth;H=cv.height=innerHeight;} resize(); addEventListener('resize',resize);
document.getElementById('meta').textContent = `${G.stats.nodes} 概念 / ${G.stats.edges} 关系 · ${G.generated}`;
document.getElementById('legend').innerHTML = types.map(t=>`<span><i class="dot" style="background:${colorOf(t)}"></i>${t}</span>`).join('');

const idx = new Map(G.nodes.map((n,i)=>[n.id,i]));
const N = G.nodes.map((n,i)=>({...n, x:W/2+Math.cos(i)*200+Math.random()*40, y:H/2+Math.sin(i)*200+Math.random()*40, vx:0, vy:0}));
const E = G.edges.map(e=>({s:idx.get(e.source), t:idx.get(e.target), rel:e.rel})).filter(e=>e.s!=null&&e.t!=null);
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
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);
  ctx.setTransform(cam.k,0,0,cam.k,cam.x,cam.y);
  ctx.strokeStyle="rgba(120,130,160,.18)";ctx.lineWidth=1/cam.k;
  for(const e of E){ctx.beginPath();ctx.moveTo(N[e.s].x,N[e.s].y);ctx.lineTo(N[e.t].x,N[e.t].y);ctx.stroke();}
  for(let i=0;i<N.length;i++){const n=N[i],r=4+Math.min(deg[i],8)*0.9;
    ctx.beginPath();ctx.arc(n.x,n.y,r,0,7);ctx.fillStyle=colorOf(n.type);ctx.fill();}
}
function loop(){sim();draw();requestAnimationFrame(loop);} loop();

function screenToWorld(mx,my){return {x:(mx-cam.x)/cam.k, y:(my-cam.y)/cam.k};}
function pick(mx,my){const p=screenToWorld(mx,my);let best=null,bd=1e9;
  for(let i=0;i<N.length;i++){let dx=N[i].x-p.x,dy=N[i].y-p.y,d=dx*dx+dy*dy;
    if(d<bd){bd=d;best=i;}} return bd< (14/cam.k)**2 ? best:null;}
const tip=document.getElementById('tip');
cv.addEventListener('mousedown',e=>{const i=pick(e.clientX,e.clientY);
  if(i!=null){drag={node:N[i]};}else{pan={x:e.clientX,y:e.clientY,cx:cam.x,cy:cam.y};}});
addEventListener('mousemove',e=>{
  if(drag){const p=screenToWorld(e.clientX,e.clientY);drag.node.x=p.x;drag.node.y=p.y;drag.node.vx=0;drag.node.vy=0;}
  else if(pan){cam.x=pan.cx+(e.clientX-pan.x);cam.y=pan.cy+(e.clientY-pan.y);}
  const i=pick(e.clientX,e.clientY);
  if(i!=null){const n=N[i];tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';
    tip.innerHTML=`<b>${n.title}</b><br><span style="color:#7f849c">${n.type}</span><br>${(n.tags||[]).join(' · ')}<br><span style="color:#585b70">${n.id}</span>`;}
  else tip.style.display='none';});
addEventListener('mouseup',()=>{drag=null;pan=null;});
cv.addEventListener('wheel',e=>{e.preventDefault();const s=e.deltaY<0?1.1:0.9;
  const wx=(e.clientX-cam.x)/cam.k,wy=(e.clientY-cam.y)/cam.k;cam.k*=s;
  cam.x=e.clientX-wx*cam.k;cam.y=e.clientY-wy*cam.k;},{passive:false});
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
    build_root(counts)
    graph = build_graph()
    build_visualizer(graph)
    total = sum(counts.values())
    print(f"OKF bundle built at {BUNDLE.relative_to(REPO)}/")
    for k, v in counts.items():
        print(f"  {k}: {v} concepts")
    print(f"  total: {total} concepts")
    print(f"  graph: {graph['stats']['nodes']} nodes / {graph['stats']['edges']} edges")
    print(f"  visualizer: okf/visualizer.html (self-contained)")
    if args.tarball:
        out = export_tarball(Path(args.tarball))
        size = out.stat().st_size
        print(f"  tarball: {out} ({size} bytes) — 银芯→黑池单向输出物")


if __name__ == "__main__":
    main()
