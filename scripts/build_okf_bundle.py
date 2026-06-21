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

import json
import shutil
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
    for name, info in sorted(platforms.items()):
        total = info.get("total_items", 0)
        level = info.get("level", "unknown")
        # full-archive layer location (本体原地，仅指针)
        if name == "discord":
            archive = "/projects/news/data/discord/"
        else:
            archive = f"/projects/news/data/platforms/{name}/"
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
        count += 1

    idx = [f"# 社区情报数据源 ({count})", "",
           f"源：`{SOURCE_HEALTH.relative_to(REPO)}`。每个平台一份**指针** concept；",
           "本体（JSONL/JSON 时序档案）原地不动，concept 仅持 `resource` 指针。", "",
           "## 平台"]
    idx.append("")
    for name, info in sorted(platforms.items()):
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
python3 scripts/build_okf_bundle.py
```

生成物，重跑覆盖。本体各自原地不动。

## 消费（白嫖 Google 参考实现）

OKF 随规范放出一个**零后端单文件静态 HTML 可视化器**，可把本 bundle 渲染成
交互式关系图。取用方式见上方规范仓库 `okf/` 目录。

## 一致性

`tests/test_okf_bundle.py` 校验 OKF v0.1 一致性（每个非保留 .md 带非空
`type`；保留文件无 frontmatter）。
"""
    write_plain(BUNDLE / "README.md", readme)


def main() -> None:
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
    total = sum(counts.values())
    print(f"OKF bundle built at {BUNDLE.relative_to(REPO)}/")
    for k, v in counts.items():
        print(f"  {k}: {v} concepts")
    print(f"  total: {total} concepts")


if __name__ == "__main__":
    main()
