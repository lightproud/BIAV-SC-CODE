"""okf_pointer_layers.py — 全仓知识组织：OKF bundle 新增指针概念层（import-only 库）。

守密人 2026-07-04 裁定「用 ultracode 组织整个仓库所有知识（含归档社区数据）」。本模块
是那次编排（9 域测绘 + 合成 + 完备性批判，workflow organize-repo-knowledge）产出规格的
**确定性实现**：把 OKF bundle 从 4 层扩到覆盖全仓知识域。

三条铁律照旧（放指针不放本体 / data_layer 标层 / 黑池防火墙同向）：除 characters/ 唯一
本体层外，本模块所有层**只出 pointer 概念**——概念正文仅放元信息与统计数字，`resource`
指向仓内绝对路径本体，本体原地不动（discord 全量 2.1G、lore 1026 条、解包 44M 等硬红线
本体绝不复刻）。data_layer 分层：社区/解包全量→full_archive、输出展示→output、策展/事实→curated。

本模块为 import-only 部件（不设独立 CLI 入口），由 build_okf_bundle.py 在 4 个原生层之后调用。
community/news-output 的归档路径解析**共用 archive_layout 单一真相源**（不自撰第二套，防漂移）。
"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE = REPO / "okf"
TODAY = date.today().isoformat()

sys.path.insert(0, str(REPO / "projects" / "news" / "scripts"))
import archive_layout  # noqa: E402  归档布局单一真相源（community/news-output 路径推导共用）

# ---------------------------------------------------------------------------
# YAML frontmatter helpers — 与 build_okf_bundle 同契约（刻意自持，避免循环 import）
# ---------------------------------------------------------------------------

_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def _yaml_scalar(value: str) -> str:
    s = str(value).replace("\r", " ").replace("\n", " ").strip()
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def frontmatter(fields: dict) -> str:
    assert fields.get("type"), "OKF concept frontmatter MUST carry a non-empty 'type'"
    lines = ["---"]
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body.rstrip() + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Shared derivation helpers (deterministic, zero-throw: single file never aborts a layer)
# ---------------------------------------------------------------------------

def _rel(path: Path) -> str:
    """Repo-relative absolute pointer, always leading-slash."""
    return "/" + str(path.relative_to(REPO)).replace("\\", "/")


def slug(s: str) -> str:
    s = re.sub(r"[^0-9a-zA-Z]+", "-", str(s).strip().lower()).strip("-")
    return s or "item"


def _human_size(n: int) -> str:
    f = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if f < 1024 or unit == "GB":
            return f"{int(f)}B" if unit == "B" else f"{f:.1f}{unit}"
        f /= 1024
    return f"{f:.1f}GB"


def _size_of(path: Path) -> str:
    try:
        if path.is_dir():
            total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        else:
            total = path.stat().st_size
    except OSError:
        return "n/a"
    return _human_size(total)


def json_meta(path: Path) -> dict:
    """Safely read a JSON file's meta/_meta block; {} on any failure."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, ValueError):
        return {}
    if isinstance(data, dict):
        m = data.get("_meta") or data.get("meta")
        if isinstance(m, dict):
            return m
    return {}


def _first_total(meta: dict) -> str:
    for k, v in meta.items():
        if k.startswith("total") and isinstance(v, (int, float)):
            return f"{k}={v}"
    return ""


def md_title_blurb(path: Path, max_len: int = 240) -> tuple[str, str]:
    """First '# ' H1 and first prose/blockquote blurb (skips frontmatter/tables)."""
    title, blurb = path.stem, ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return title, blurb
    text = _FM_RE.sub("", text, count=1)
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("# ") and title == path.stem:
            title = s[2:].strip()
            continue
        if not blurb and not s.startswith(("#", "|", "---", "```", "!", "<")):
            blurb = s.lstrip("> ").strip()
            if blurb:
                break
    return title, blurb[:max_len]


# ---------------------------------------------------------------------------
# Generic layer writer: emit one concept per entry + a reserved index.md
# ---------------------------------------------------------------------------

def write_layer(layer: str, entries: list[dict], index_title: str, index_intro: str) -> list[dict]:
    """entries: [{id,type,title,description,resource,tags,timestamp?}]. Writes okf/<layer>/."""
    out_dir = BUNDLE / layer
    out_dir.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    written: list[dict] = []
    for e in entries:
        cid = e["id"]
        if cid in ("index", "log") or cid in seen:
            continue
        seen.add(cid)
        fields = {
            "type": e["type"],
            "title": e["title"],
            "description": e.get("description", "") or e["title"],
            "resource": e["resource"],
            "tags": e.get("tags", []),
            "timestamp": e.get("timestamp", TODAY),
        }
        body = [
            "# 指针概念",
            "",
            f"> 放指针不放本体：本体权威在 `{e['resource'].lstrip('/')}`，本 concept 仅描述与定位、不复刻正文。",
            "",
            f"- 本体路径：`{e['resource'].lstrip('/')}`",
        ]
        if e.get("description"):
            body.append(f"- 摘要：{e['description']}")
        if e.get("tags"):
            body.append(f"- 标签：{' · '.join(e['tags'])}")
        write_concept(out_dir / f"{cid}.md", fields, "\n".join(body))
        written.append({**e, "node_id": f"/{layer}/{cid}.md"})

    idx = [f"# {index_title} ({len(written)})", "", index_intro, "", "## 概念", ""]
    for e in written:
        idx.append(f"* [{e['title']}](/{layer}/{e['id']}.md) - {e.get('description', '')[:80]}".rstrip(" -"))
    write_plain(out_dir / "index.md", "\n".join(idx))
    return written


# ---------------------------------------------------------------------------
# Layer: assets (事实圣经层，curated)
# ---------------------------------------------------------------------------

_ASSETS_DIAG = {"archive-integrity", "sentinel-baseline"}


def build_assets() -> list[dict]:
    entries = []
    ddir = REPO / "assets" / "data"
    for f in sorted(ddir.glob("*.json")) + sorted(ddir.glob("*.md")):
        stem = f.stem
        tags = ["data_layer:curated", "fact-bible"]
        typ = "reference"
        if stem in _ASSETS_DIAG:
            typ = "dataset"
            tags += ["diagnostics", "snapshot"]
        if f.suffix == ".json":
            meta = json_meta(f)
            desc = meta.get("description") or meta.get("note") or ""
            tot = _first_total(meta)
            desc = (desc or f"{stem} 事实数据") + (f"（{tot}）" if tot else "")
        else:
            _t, desc = md_title_blurb(f)
        entries.append({
            "id": f"assets-{slug(stem)}", "type": typ, "title": stem,
            "description": desc, "resource": _rel(f), "tags": tags,
        })
    # persona files (prefix to avoid clashing with characters/ ids)
    pdir = ddir / "character-personas"
    for f in sorted(pdir.glob("*.json")) + sorted(pdir.glob("*.md")):
        _t, blurb = ("", "")
        if f.suffix == ".md":
            _t, blurb = md_title_blurb(f)
        else:
            m = json_meta(f)
            blurb = m.get("description") or f"{f.stem} 角色人格数据"
        entries.append({
            "id": f"persona-{slug(f.stem)}", "type": "reference", "title": f.stem,
            "description": blurb, "resource": _rel(f),
            "tags": ["data_layer:curated", "persona", "character:erica"],
        })
    # public images: one directory-level pointer (critic low gap)
    idir = REPO / "assets" / "images"
    if idir.is_dir():
        entries.append({
            "id": "assets-images", "type": "dataset", "title": "公开图像资产",
            "description": f"立绘 / CG 等公开图像资产目录（{_size_of(idir)}），二进制本体原地。",
            "resource": _rel(idir) + "/", "tags": ["data_layer:curated", "fact-bible", "media:image"],
        })
    return write_layer("assets", entries, "事实圣经层（策展权威源）",
                       "银芯事实圣经层：角色卡 / 采访 / 叙事 / 设计决策 / 卡牌 / 人格等策展权威源的指针。")


# ---------------------------------------------------------------------------
# Layer: wiki-data (processed 非角色结构化数据集，curated)
# ---------------------------------------------------------------------------

_WIKI_DOMAIN = {
    "voice_lines": "story", "world_lore": "story", "item_stories": "story",
    "story_character_map": "story", "voice_character_map": "story",
    "summon": "gameplay", "potency": "gameplay", "stages": "gameplay",
    "cg_gallery": "gameplay", "feature_unlock": "gameplay", "tasks": "gameplay",
    "banners_by_character": "gameplay", "drops_by_item": "gameplay",
    "character_index": "index",
    "language_config": "localization", "panel_text": "localization",
    "update_notices": "localization",
}


def build_wiki_data() -> list[dict]:
    pdir = REPO / "projects" / "wiki" / "data" / "processed"
    entries = []
    for f in sorted(pdir.glob("*.json")):
        if f.name == "characters.json":  # covered by characters/ layer
            continue
        stem = f.stem
        meta = json_meta(f)
        src = meta.get("source", "")
        tot = _first_total(meta)
        gen = meta.get("generated", "")
        desc = " · ".join(x for x in [src, tot, (f"生成 {gen}" if gen else "")] if x) or f"{stem} 数据集"
        domain = _WIKI_DOMAIN.get(stem, "misc")
        entries.append({
            "id": f"wiki-data-{slug(stem)}", "type": "dataset", "title": stem,
            "description": desc, "resource": _rel(f),
            "tags": ["data_layer:curated", "unpacked-bootstrap", f"domain:{domain}"],
        })
    # character_skills.md (community-sourced, not unpacked)
    csk = pdir / "character_skills.md"
    if csk.exists():
        _t, blurb = md_title_blurb(csk)
        entries.append({
            "id": "wiki-data-character-skills", "type": "dataset", "title": "character_skills",
            "description": blurb or "角色技能（社区攻略源，随版本波动）", "resource": _rel(csk),
            "tags": ["data_layer:curated", "community-sourced", "version-volatile", "domain:gameplay"],
        })
    # data-model schemas (契约来源)
    sdir = pdir / "schemas"
    for f in sorted(sdir.glob("*.json")):
        entries.append({
            "id": f"wiki-schema-{slug(f.stem)}", "type": "reference", "title": f.name,
            "description": f"wiki 数据模型 schema 定义（{f.stem}），派生 JSON 的契约来源。",
            "resource": _rel(f), "tags": ["data_layer:curated", "schema", "contract"],
        })
    return write_layer("wiki-data", entries, "wiki 结构化数据集（解包自举）",
                       "projects/wiki/data/processed/ 下非角色结构化数据集与 schema 契约的指针（角色本体见 characters/）。")


# ---------------------------------------------------------------------------
# Layer: community (归档社区全量档案分析镜头，full_archive) —— 头等
# ---------------------------------------------------------------------------

def _archive_resource(name: str) -> str | None:
    """复用 archive_layout 单一真相源解析平台归档落点；回落平级目录；均无则 None。"""
    try:
        plat, region, subtype = archive_layout.resolve_write_layout(name)
    except Exception:
        plat, region, subtype = name, None, None
    layered = "Public-Info-Pool/Record/Community/" + "/".join(p for p in (plat, region, subtype) if p)
    flat = f"Public-Info-Pool/Record/Community/{name}"
    if (REPO / layered).exists():
        return "/" + layered + "/"
    if (REPO / flat).exists():
        return "/" + flat + "/"
    return None


def build_community() -> tuple[list[dict], list[str]]:
    idx_path = REPO / "projects" / "news" / "index" / "community_index.json"
    flags: list[str] = []
    entries: list[dict] = []
    if not idx_path.exists():
        return [], ["community_index.json 缺失，community 层跳过"]
    try:
        data = json.loads(idx_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return [], ["community_index.json 解析失败，community 层跳过"]
    meta = data.get("_meta", {})
    platforms = data.get("platforms", {})
    timeline = data.get("timeline", {})

    # (A) analysis-index concept
    entries.append({
        "id": "community-index", "type": "dataset", "title": "社区全量档案分析索引",
        "description": (f"全量社区档案静态分析台账：{meta.get('total_records', '?')} 条 / "
                        f"{meta.get('platform_count', '?')} 平台，词典法零 ML。{meta.get('data_note', '')[:80]}"),
        "resource": _rel(idx_path),
        "tags": ["data_layer:full_archive", "kind:analysis-index", "zero-ml"],
    })
    # (B) per-platform pointer concepts
    for name in sorted(platforms):
        info = platforms[name] if isinstance(platforms[name], dict) else {}
        res = _archive_resource(name)
        if res is None:
            flags.append(f"community/{name}: 归档目录未落盘，指针跳过")
            continue
        by_month = info.get("by_month", {})
        total = info.get("total") or info.get("total_records") or info.get("count", "?")
        entries.append({
            "id": f"community-{slug(name)}", "type": "dataset", "title": f"{name} 社区全量档案",
            "description": (f"{name} 平台全量档案层（分析镜头）：约 {total} 条 / "
                            f"{len(by_month)} 个月。长窗口分析 / 情感长尾 / 完整性审计走此全量层。"),
            "resource": res,
            "tags": ["data_layer:full_archive", f"platform:{name}", "lens:analysis"],
        })
    # (C) timeline concept
    if timeline:
        months = sorted(timeline)
        entries.append({
            "id": "community-timeline", "type": "dataset", "title": "社区活动时序（全量）",
            "description": (f"全量社区月度时序：{months[0]}..{months[-1]}（{len(months)} 月），"
                            f"vol_index 抓量异常（本月量÷前6月中位数）。"),
            "resource": _rel(idx_path),
            "tags": ["data_layer:full_archive", "kind:timeseries", "zero-ml"],
        })
    written = write_layer("community", entries, "归档社区全量档案（分析镜头）",
                          "全量社区档案（7.5M+ 条 / 17 平台）的分析镜头指针——与 sources/ 采集健康镜头正交。"
                          "放指针不放本体：消息正文原地在 resource，绝不复刻。")
    return written, flags


# ---------------------------------------------------------------------------
# Layer: news-output (输出展示层，output)
# ---------------------------------------------------------------------------

def build_news_output() -> tuple[list[dict], list[str]]:
    odir = REPO / "projects" / "news" / "output"
    flags: list[str] = []
    entries: list[dict] = []
    for f in sorted(odir.glob("*-latest.json")):
        if f.name == "all-latest.json":
            continue
        src = f.stem.replace("-latest", "")
        dl = None
        try:
            top = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(top, dict):
                dl = top.get("data_layer")
        except (json.JSONDecodeError, OSError):
            pass
        if dl is not None and dl != "output":
            flags.append(f"news-output/{src}: data_layer={dl}!=output，跳过（防全量误标输出）")
            continue
        entries.append({
            "id": f"news-output-{slug(src)}", "type": "dataset", "title": f"输出展示层 · {src} 最新快照",
            "description": (f"{src} 输出展示层最新快照（抽样选样，非全量）。长窗口分析 / 完整性审计 / "
                            f"情感长尾须改用全量档案层（见 community/ 与 sources/ 的 full_archive 指针，lesson #30）。"),
            "resource": _rel(f), "tags": ["data_layer:output", f"platform:{src}", "sampled"],
        })
    # 3 aggregates
    for fname, cid, title, desc in [
        ("all-latest.json", "news-output-all", "输出展示层 · 全平台聚合", "全平台最新快照聚合（抽样，非全量）。"),
        ("feed.xml", "news-output-feed", "输出展示层 · RSS/Atom 订阅", "24h 热点 RSS 2.0 订阅源。"),
        ("news.json", "news-output-newsjs", "输出展示层 · 合并流", "合并全量层 news.json（构建期快照）。"),
    ]:
        f = odir / fname
        if f.exists():
            entries.append({
                "id": cid, "type": "dataset", "title": title,
                "description": desc + " 抽样/展示用途，非全量档案层。",
                "resource": _rel(f), "tags": ["data_layer:output", "aggregate", "sampled"],
            })
    written = write_layer("news-output", entries, "输出展示层（抽样，快查/日报）",
                          "projects/news/output/ 输出展示层指针（抽样非全量）。凡长窗口/审计/情感长尾一律回全量档案层。")
    return written, flags


# ---------------------------------------------------------------------------
# Layer: unpacked (解包 text，full_archive)
# ---------------------------------------------------------------------------

_UNPACKED_ALIAS = {"Lua表还原": "lua-tables", "全部游戏数据": "game-data-all", "游戏文本": "game-text"}


def _sniff_encoding(d: Path) -> str:
    for f in sorted(d.rglob("*")):
        if f.is_file():
            try:
                head = f.read_bytes()[:8]
            except OSError:
                continue
            if head[:4] == b"\x1bLua" or head[:5] == b"LuaT0":
                return "encoding:luac"
            return "encoding:text"
    return "encoding:text"


def build_unpacked() -> list[dict]:
    root = REPO / "Public-Info-Pool" / "Reference" / "Game-Unpacked"
    entries = []
    if not root.is_dir():
        return []
    for d in sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name):
        name = d.name
        cid = _UNPACKED_ALIAS.get(name, slug(name))
        nfiles = sum(1 for _ in d.rglob("*") if _.is_file())
        entries.append({
            "id": f"unpacked-{cid}", "type": "dataset", "title": name,
            "description": f"客户端解包 text 子集「{name}」：{nfiles} 文件 / {_size_of(d)}。一手解包，本体原地。",
            "resource": _rel(d) + "/",
            "tags": ["data_layer:full_archive", f"content:{cid}", _sniff_encoding(d), "first-hand-unpack"],
        })
    return write_layer("unpacked", entries, "解包 text（客户端一手）",
                       "Public-Info-Pool/Reference/Game-Unpacked/ 解包 text 子集指针（二进制本体在 Releases，见 releases/）。"
                       "含未上线内容可能，下游受『不推断未发布』约束。")


# ---------------------------------------------------------------------------
# Layer: extracted (processed 上游一手可读解包源，full_archive) —— 批判者高优先补齐
# ---------------------------------------------------------------------------

def build_extracted() -> list[dict]:
    root = REPO / "projects" / "wiki" / "data" / "extracted"
    entries = []
    if not root.is_dir():
        return []
    for d in sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name):
        nfiles = sum(1 for _ in d.rglob("*") if _.is_file())
        entries.append({
            "id": f"extracted-{slug(d.name)}", "type": "dataset", "title": d.name,
            "description": f"一手可读解包源「{d.name}」：{nfiles} 文件 / {_size_of(d)}。processed/*.json 的上游权威（血缘：extracted 原始→processed 派生）。",
            "resource": _rel(d) + "/",
            "tags": ["data_layer:full_archive", "first-hand-unpack", "upstream-of:processed", f"content:{slug(d.name)}"],
        })
    rd = root / "README.md"
    if rd.exists():
        _t, blurb = md_title_blurb(rd)
        entries.append({
            "id": "extracted-readme", "type": "documentation", "title": "extracted 说明",
            "description": blurb or "解包一手层说明与数据血缘。", "resource": _rel(rd),
            "tags": ["data_layer:curated", "documentation"],
        })
    return write_layer("extracted", entries, "解包一手可读源（processed 上游）",
                       "projects/wiki/data/extracted/ 一手可读解包源指针（明文 lua 表 + 分类 txt），processed 派生层的权威上游。")


# ---------------------------------------------------------------------------
# Layer: resource (银芯正式产物，curated)
# ---------------------------------------------------------------------------

def build_resource() -> list[dict]:
    root = REPO / "Public-Info-Pool" / "Resource"
    entries = []
    if not root.is_dir():
        return []
    for tdir in sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name):
        topic = tdir.name
        # group same-stem multi-ext deliverables (md primary, else first)
        by_stem: dict[str, list[Path]] = {}
        for f in sorted(tdir.iterdir()):
            if f.is_file():
                by_stem.setdefault(f.stem, []).append(f)
        for stem, files in sorted(by_stem.items()):
            primary = next((f for f in files if f.suffix == ".md"), files[0])
            exts = sorted({f.suffix.lstrip(".") for f in files})
            if primary.suffix == ".md":
                _t, blurb = md_title_blurb(primary)
            else:
                blurb = f"{topic} 产物（{'/'.join(exts)}）"
            entries.append({
                "id": f"resource-{slug(topic)}-{slug(stem)}", "type": "documentation",
                "title": stem, "description": (blurb or f"{topic} 交付物") + f"（格式：{'/'.join(exts)}）",
                "resource": _rel(primary),
                "tags": ["data_layer:curated", "deliverable", f"topic:{topic}"],
            })
    return write_layer("resource", entries, "银芯正式产物（报告/分析）",
                       "Public-Info-Pool/Resource/ 下 A 类正式产物指针（按主题类型分组，同 stem 多格式合并为一交付物）。")


# ---------------------------------------------------------------------------
# Layer: projects (子项目会话上下文 + 藏宝图 + 工程文档，curated) —— 批判者补齐
# ---------------------------------------------------------------------------

def build_projects() -> list[dict]:
    entries = []
    for name in ("news", "wiki", "site", "game", "bpt-agent-sdk"):
        ctx = REPO / "projects" / name / "CONTEXT.md"
        if ctx.exists():
            _t, blurb = md_title_blurb(ctx)
            entries.append({
                "id": f"project-{slug(name)}", "type": "documentation", "title": f"{name} 子项目上下文",
                "description": blurb or f"{name} 子项目会话上下文与当前 milestone（动手前必读）。",
                "resource": _rel(ctx), "tags": ["data_layer:curated", "sub-project-context", "milestone"],
            })
    # RELEASES.md treasure map (binary assets pointer)
    rel_md = REPO / "RELEASES.md"
    if rel_md.exists():
        _t, blurb = md_title_blurb(rel_md)
        entries.append({
            "id": "releases-treasure-map", "type": "documentation", "title": "Releases 藏宝图",
            "description": blurb or "仓内藏宝图：指向只存在于 GitHub Releases 的二进制本体（立绘/音视频/lua 字节码/fanart）。",
            "resource": _rel(rel_md), "tags": ["data_layer:curated", "treasure-map", "binary-assets-pointer"],
        })
    # engineering docs
    for p, cid, title in [
        (REPO / "docs" / "testing-strategy.md", "doc-testing-strategy", "测试策略"),
        (REPO / "extracted_lua" / "README_提取说明.md", "extracted-lua-readme", "解包提取说明"),
    ]:
        if p.exists():
            _t, blurb = md_title_blurb(p)
            entries.append({
                "id": cid, "type": "documentation", "title": title,
                "description": blurb or title, "resource": _rel(p),
                "tags": ["data_layer:curated", "engineering-doc"],
            })
    # lua inventory csv (manifest of .luac bodies in Releases)
    csvp = REPO / "extracted_lua" / "lua_scripts_inventory.csv"
    if csvp.exists():
        n = 0
        try:
            with csvp.open(encoding="utf-8", errors="ignore") as fh:
                n = max(0, sum(1 for _ in csv.reader(fh)) - 1)
        except OSError:
            pass
        entries.append({
            "id": "extracted-lua-inventory", "type": "dataset", "title": "解包 lua 清单",
            "description": f"逐条列 .luac 本体位置的清单（{n} 条），字节码本体在 Releases「解包」桶。",
            "resource": _rel(csvp), "tags": ["data_layer:curated", "manifest", "binary-assets-pointer"],
        })
    return write_layer("projects", entries, "子项目上下文 + 藏宝图 + 工程文档",
                       "各子项目 CONTEXT.md（动手前必读）+ RELEASES.md 藏宝图 + 工程文档的导航指针。")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def build_all() -> tuple[dict, list[str]]:
    """Build every new pointer layer. Returns ({layer: count}, discipline_flags)."""
    flags: list[str] = []
    counts: dict[str, int] = {}

    counts["assets"] = len(build_assets())
    counts["wiki-data"] = len(build_wiki_data())
    community, cflags = build_community()
    counts["community"] = len(community)
    flags += cflags
    news_out, nflags = build_news_output()
    counts["news-output"] = len(news_out)
    flags += nflags
    counts["unpacked"] = len(build_unpacked())
    counts["extracted"] = len(build_extracted())
    counts["resource"] = len(build_resource())
    counts["projects"] = len(build_projects())
    return counts, flags
